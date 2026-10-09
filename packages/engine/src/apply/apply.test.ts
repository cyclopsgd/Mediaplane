import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../catalog/types';
import { listRecords } from '../history/records';
import { ENV_PATH, LOCK_PATH, SECRETS_PATH } from '../paths';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { fakeDocker, fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
import { apply, unhealthyServices, type ApplyOptions } from './apply';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

/** Always 0xab, so generated secrets and record ids are predictable. */
const random = (size: number) => Buffer.alloc(size, 0xab);
const now = () => new Date('2026-10-09T09:43:12.000Z');
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

async function makeHome(stack = STACK): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-apply-'));
  await writeFile(join(home, 'stack.yaml'), stack);
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  return home;
}

function options(
  home: string,
  runtime: Runtime,
  extra: Partial<ApplyOptions> = {},
): ApplyOptions {
  return {
    home,
    catalog: fixtureCatalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    probe: fakeProbe(),
    confirm: () => Promise.resolve(true),
    random,
    now,
    ...extra,
  };
}

describe('apply', () => {
  it('generates keys, writes files, pulls, starts, verifies and records', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const events: string[] = [];
    const result = await apply(
      options(home, docker, {
        onStep: (event) => events.push(`${event.step}:${event.phase}`),
      }),
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outcome).toBe('success');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'done'],
      ['ownership', 'done'],
      ['start', 'done'],
      ['verify', 'done'],
    ]);
    expect(result.actions[0]?.detail).toBe('generated sonarr.apiKey');
    expect(events.slice(0, 4)).toEqual([
      'keys:start',
      'keys:end',
      'files:start',
      'files:end',
    ]);

    const env = await readFile(join(home, ENV_PATH), 'utf8');
    expect(env).toContain(`MP_SONARR_API_KEY='${'ab'.repeat(16)}'`);
    expect(env).toContain("MP_GLUETUN_WIREGUARD_KEY='fake-wireguard-key-for-tests'");
    expect(await modeOf(join(home, ENV_PATH))).toBe(0o600);
    expect(JSON.parse(await readFile(join(home, SECRETS_PATH), 'utf8'))).toEqual({
      version: 1,
      apps: { sonarr: { apiKey: 'ab'.repeat(16) } },
    });
    expect(await modeOf(join(home, SECRETS_PATH))).toBe(0o600);
    expect((await readdir(join(home, 'appdata'))).sort()).toEqual([
      'gluetun',
      'jellyfin',
      'qbittorrent',
      'sonarr',
    ]);
    expect(docker.calls.indexOf('pull')).toBeLessThan(docker.calls.indexOf('up'));
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();

    const { records } = await listRecords(home);
    expect(records).toEqual([
      expect.objectContaining({
        id: result.recordId,
        outcome: 'success',
        trigger: 'cli',
      }),
    ]);
    expect(result.recordId).toBe('20261009T094312Z-abababab');
    expect(records[0]?.plan.secrets.generate).toEqual(['sonarr.apiKey']);
    const recorded = JSON.stringify(records);
    expect(recorded).not.toContain('ab'.repeat(16));
    expect(recorded).not.toContain('fake-wireguard-key-for-tests');
  });

  it('reports no changes on a second apply, without asking or recording', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    const confirm = vi.fn(() => Promise.resolve(true));
    const second = await apply(options(home, docker, { confirm }));
    expect(second.outcome).toBe('no-changes');
    expect(confirm).not.toHaveBeenCalled();
    expect((await listRecords(home)).records).toHaveLength(1);
  });

  it('waits again for an app that is still unhealthy, rather than reporting no changes', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    // The state `up --wait` leaves behind when an app fails its health check: running,
    // with the config hash Compose would give it now.
    const stillSick: Runtime = {
      ...docker,
      containers: async () =>
        (await docker.containers()).map((c) =>
          c.service === 'sonarr' ? { ...c, health: 'unhealthy' } : c,
        ),
      up: () => Promise.resolve({ ok: false, error: 'container sonarr is unhealthy' }),
    };
    const confirm = vi.fn(() => Promise.resolve(true));
    const result = await apply(options(home, stillSick, { confirm }));
    expect(result.outcome).toBe('failed');
    expect(result.plan).toMatchObject({
      changed: true,
      unhealthy: ['sonarr (unhealthy)'],
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(result.actions.find((a) => a.step === 'start')).toMatchObject({
      result: 'failed',
      error:
        'these apps did not start healthy: sonarr (unhealthy). Compose said: container sonarr is unhealthy',
    });
    expect((await listRecords(home)).records[0]?.outcome).toBe('failed');
  });

  it('succeeds once an app that was still starting becomes healthy', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    await apply(options(home, docker));
    let waited = false;
    const starting: Runtime = {
      ...docker,
      containers: async () =>
        (await docker.containers()).map((c) =>
          !waited && c.service === 'sonarr' ? { ...c, health: 'starting' } : c,
        ),
      up: (seconds, values) => {
        waited = true;
        return docker.up(seconds, values);
      },
    };
    const result = await apply(options(home, starting));
    expect(result.outcome).toBe('success');
    expect(result.plan.unhealthy).toEqual(['sonarr (starting)']);
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'done'],
      ['ownership', 'done'],
      ['start', 'done'],
      ['verify', 'done'],
    ]);
  });

  it('fails verification while an app is still not healthy after starting', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    let started = false;
    const relapsing: Runtime = {
      ...docker,
      containers: async () =>
        (await docker.containers()).map((c) =>
          started && c.service === 'sonarr' ? { ...c, health: 'unhealthy' } : c,
        ),
      up: async (seconds, values) => {
        const result = await docker.up(seconds, values);
        started = true;
        return result;
      },
    };
    const result = await apply(options(home, relapsing));
    expect(result.outcome).toBe('failed');
    expect(
      result.diagnostics.find((d) => d.code === 'apply.verify-failed')?.message,
    ).toBe('changes remain after apply: sonarr (unhealthy)');
  });

  it('changes nothing when the plan is declined', async () => {
    const home = await makeHome();
    const result = await apply(
      options(home, fakeDocker(home), { confirm: () => Promise.resolve(false) }),
    );
    expect(result).toMatchObject({
      outcome: 'cancelled',
      actions: [],
      recordId: undefined,
    });
    await expect(stat(join(home, 'generated'))).rejects.toThrow();
    await expect(stat(join(home, SECRETS_PATH))).rejects.toThrow();
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();
  });

  it('refuses to run while another apply holds the lock', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, LOCK_PATH),
      JSON.stringify({
        pid: process.pid,
        host: hostname(),
        startedAt: '2026-10-09T09:00:00.000Z',
      }),
    );
    const confirm = vi.fn(() => Promise.resolve(true));
    const result = await apply(options(home, fakeDocker(home), { confirm }));
    expect(result.outcome).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'apply.locked' }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(await readFile(join(home, LOCK_PATH), 'utf8')).toContain(
      '2026-10-09T09:00:00.000Z',
    );
  });

  it("doesn't create state/ in a folder without a stack.yaml", async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-apply-'));
    const result = await apply(options(home, fakeDocker(home)));
    expect(result.outcome).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'config.missing' }),
    );
    await expect(stat(join(home, 'state'))).rejects.toThrow();
  });

  it('stops at a failed pull, skips the rest and records the failure', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home, {
      pull: { ok: false, error: 'fake registry unreachable' },
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'failed'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.pull-failed',
        message: 'fake registry unreachable',
      }),
    );
    expect(docker.calls).not.toContain('up');
    expect((await listRecords(home)).records[0]?.outcome).toBe('failed');
  });

  it('treats a runtime that throws like a failed step, and still records it', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const timedOut: Runtime = {
      ...docker,
      pull: () =>
        Promise.reject(new RuntimeError('docker compose pull timed out after 600s')),
    };
    const result = await apply(options(home, timedOut));
    expect(result.outcome).toBe('failed');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'failed'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.pull-failed',
        message: 'docker compose pull timed out after 600s',
      }),
    );
    expect((await listRecords(home)).records[0]).toMatchObject({
      outcome: 'failed',
      actions: expect.arrayContaining([
        {
          step: 'pull',
          result: 'failed',
          error: 'docker compose pull timed out after 600s',
        },
      ]) as unknown,
    });
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();
  });

  it("keeps apply's result when the change record cannot be saved", async () => {
    const home = await makeHome();
    // A file where the history folder should be: the record write cannot succeed.
    await mkdir(join(home, 'state'));
    await writeFile(join(home, 'state', 'history'), 'not a folder');
    const result = await apply(options(home, fakeDocker(home)));
    expect(result.outcome).toBe('failed');
    expect(result.recordId).toBeUndefined();
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'done'],
      ['ownership', 'done'],
      ['start', 'done'],
      ['verify', 'done'],
    ]);
    const failure = result.diagnostics.find((d) => d.code === 'apply.record-failed');
    expect(failure).toMatchObject({
      severity: 'error',
      hint: 'the stack was changed, but this apply was not recorded; free up disk space or check that this user can write to state/history',
    });
    expect(failure?.message).toMatch(/^the change record could not be saved: \S/);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([failure]);
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();
  });

  it('reports the failed step as well as the unsaved record', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(join(home, 'state', 'history'), 'not a folder');
    const docker = fakeDocker(home, { pull: { ok: false, error: 'fake disk full' } });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    expect(result.recordId).toBeUndefined();
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'failed'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'apply.pull-failed',
      'apply.record-failed',
    ]);
    expect(result.diagnostics[0]?.message).toBe('fake disk full');
  });

  it('names the apps that did not become healthy', async () => {
    const home = await makeHome();
    const unhealthy: ContainerState = {
      service: 'sonarr',
      id: 'fake-sonarr',
      state: 'running',
      health: 'unhealthy',
      configHash: undefined,
      published: [],
    };
    const docker = fakeDocker(home, {
      containers: [unhealthy],
      up: { ok: false, error: 'application not healthy after 10m0s' },
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    const failure = result.diagnostics.find((d) => d.code === 'apply.start-failed');
    expect(failure?.message).toContain('sonarr (unhealthy)');
    expect(failure?.message).toContain('application not healthy after 10m0s');
  });

  it('fails verification when changes remain after starting', async () => {
    const home = await makeHome();
    const result = await apply(
      options(home, fakeDocker(home, { upChangesNothing: true })),
    );
    expect(result.outcome).toBe('failed');
    expect(result.actions.at(-1)).toMatchObject({ step: 'verify', result: 'failed' });
    expect(
      result.diagnostics.find((d) => d.code === 'apply.verify-failed')?.message,
    ).toContain('changes remain after apply');
  });

  it('never generates a secret twice', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    const stored = JSON.stringify({
      version: 1,
      apps: { sonarr: { apiKey: '0'.repeat(32) } },
    });
    await writeFile(join(home, SECRETS_PATH), stored);
    const result = await apply(options(home, fakeDocker(home)));
    expect(result.actions[0]).toEqual({
      step: 'keys',
      result: 'done',
      detail: 'none needed',
    });
    expect(await readFile(join(home, SECRETS_PATH), 'utf8')).toBe(stored);
  });

  it('gives appdata folders the owner their app needs before starting', async () => {
    const catalog: Catalog = [
      ...fixtureCatalog,
      fixtureApp({
        id: 'requests',
        category: 'requests',
        runAs: 'fixed:2000',
        volumes: { appdata: '/app/config' },
      }),
    ];
    const home = await makeHome(`${STACK}  requests: {}\n`);
    const docker = fakeDocker(home);
    const result = await apply(options(home, docker, { catalog }));
    expect(result.outcome).toBe('success');
    const chown = docker.calls.indexOf('chown requests 2000:2000 /app/config');
    expect(chown).toBeGreaterThan(docker.calls.indexOf('pull'));
    expect(chown).toBeLessThan(docker.calls.indexOf('up'));
    expect(result.actions.find((a) => a.step === 'ownership')?.detail).toBe(
      'requests → 2000:2000',
    );
  });
});

describe('unhealthyServices', () => {
  it('lists services that are not running or not healthy', () => {
    const base = { id: 'x', configHash: undefined, published: [] };
    expect(
      unhealthyServices([
        { ...base, service: 'sonarr', state: 'running', health: 'healthy' },
        { ...base, service: 'byparr', state: 'running', health: 'starting' },
        { ...base, service: 'seerr', state: 'exited', health: '' },
        { ...base, service: 'gluetun', state: 'running', health: '' },
      ]),
    ).toEqual(['byparr (starting)', 'seerr (exited)']);
  });
});
