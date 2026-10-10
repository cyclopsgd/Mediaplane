import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppDefinition, Catalog } from '../catalog/types';
import { listRecords } from '../history/records';
import {
  COMPOSE_PATH,
  COMPOSE_PREV_PATH,
  ENV_PATH,
  LOCK_PATH,
  SECRETS_PATH,
} from '../paths';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { fakeDocker, fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
import { apply, unhealthyServices, type ApplyOptions } from './apply';
import { tempDir } from '../testing/temp';

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

/** Sonarr with one pre-start file, from its key and the admin login. */
const configFiles: AppDefinition['configFiles'] = (ctx) => [
  {
    path: 'config/app.ini',
    content: `key=${ctx.secret('apiKey')}\nuser=${ctx.admin.username}\n`,
    seeded: /^key=/m,
  },
];
const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr' ? { ...app, configFiles } : app,
);

async function makeHome(stack = STACK): Promise<string> {
  const home = await tempDir('mediaplane-apply-');
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
    expect(result.actions[0]?.detail).toBe('generated admin.password, sonarr.apiKey');
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
      shared: { adminPassword: 'l'.repeat(24) },
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
    expect(records[0]?.plan.secrets.generate).toEqual([
      'admin.password',
      'sonarr.apiKey',
    ]);
    const recorded = JSON.stringify(records);
    expect(recorded).not.toContain('ab'.repeat(16));
    expect(recorded).not.toContain('fake-wireguard-key-for-tests');
    expect(recorded).not.toContain('l'.repeat(24));
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
    // compose.yaml was already current, so only .env was written.
    expect(result.actions[1]?.detail).toBe('wrote generated/.env');
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
    const home = await tempDir('mediaplane-apply-');
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

  it('pulls again after a temporary registry error', async () => {
    const home = await makeHome();
    const slept: number[] = [];
    const docker = fakeDocker(home, {
      pull: [{ ok: false, error: 'net/http: TLS handshake timeout' }, { ok: true }],
    });
    const sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    const result = await apply(options(home, docker, { sleep }));
    expect(result.outcome).toBe('success');
    expect(result.actions[2]).toEqual({
      step: 'pull',
      result: 'done',
      detail: 'images present, after 1 retry',
    });
    expect(slept).toEqual([5_000]);
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

  it('says so when the start fails with every app healthy', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    let started = false;
    const portTaken: Runtime = {
      ...docker,
      // Docker stops answering after up, so only Compose's own message is left.
      containers: () =>
        started
          ? Promise.reject(new RuntimeError('fake: docker stopped answering'))
          : docker.containers(),
      up: () => {
        started = true;
        return Promise.resolve({ ok: false, error: 'fake: port is already allocated' });
      },
    };
    const result = await apply(options(home, portTaken));
    expect(result.diagnostics.find((d) => d.code === 'apply.start-failed')).toMatchObject(
      {
        message: 'docker compose up failed: fake: port is already allocated',
        hint: 'run "mediaplane status" to see each app, fix the cause, then run apply again',
      },
    );
  });

  it('fails verification when it cannot plan again after starting', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    let started = false;
    const gone: Runtime = {
      ...docker,
      versions: () =>
        started
          ? Promise.reject(new RuntimeError('fake: cannot talk to Docker'))
          : docker.versions(),
      up: (seconds, values) => {
        started = true;
        return docker.up(seconds, values);
      },
    };
    const result = await apply(options(home, gone));
    expect(result.outcome).toBe('failed');
    expect(result.actions.at(-1)).toEqual({
      step: 'verify',
      result: 'failed',
      error: 'could not plan again: fake: cannot talk to Docker',
    });
  });

  it('stops at a failed key generation, and still records it', async () => {
    const home = await makeHome();
    let draws = 0;
    // The first draw (the admin password) fails; later ones (the record id) work.
    const flaky = (size: number) => {
      if (draws++ === 0) throw new Error('fake: no entropy available');
      return random(size);
    };
    const result = await apply(options(home, fakeDocker(home), { random: flaky }));
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'failed'],
      ['files', 'skipped'],
      ['pull', 'skipped'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.keys-failed',
        message: 'fake: no entropy available',
      }),
    );
    await expect(stat(join(home, SECRETS_PATH))).rejects.toThrow();
    expect((await listRecords(home)).records[0]?.outcome).toBe('failed');
  });

  it('stops at files it cannot write', async () => {
    const home = await makeHome();
    // A file where the appdata folder should be: the apps' folders cannot be created.
    await writeFile(join(home, 'appdata'), 'not a folder');
    const docker = fakeDocker(home);
    const result = await apply(options(home, docker));
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'failed'],
      ['pull', 'skipped'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics.find((d) => d.code === 'apply.files-failed')?.hint).toBe(
      'check that this user can write to the Mediaplane home, then run apply again',
    );
    expect(docker.calls).not.toContain('pull');
  });

  it('stops at an appdata folder whose owner it cannot fix, naming the app', async () => {
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
    const docker = fakeDocker(home, {
      chown: { ok: false, error: 'fake: chown: /app/config: Operation not permitted' },
    });
    const result = await apply(options(home, docker, { catalog }));
    expect(result.actions.find((a) => a.step === 'ownership')).toEqual({
      step: 'ownership',
      result: 'failed',
      error: 'requests: fake: chown: /app/config: Operation not permitted',
    });
    expect(result.actions.find((a) => a.step === 'start')?.result).toBe('skipped');
    expect(docker.calls).not.toContain('up');
  });

  it('stops when the plan is invalid, changing nothing and releasing the lock', async () => {
    const home = await makeHome();
    await rm(join(home, 'secrets', 'wg.key'));
    const confirm = vi.fn(() => Promise.resolve(true));
    const result = await apply(options(home, fakeDocker(home), { confirm }));
    expect(result).toMatchObject({
      outcome: 'invalid',
      actions: [],
      recordId: undefined,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'secret.missing' }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(await readdir(join(home, 'state'))).toEqual([]);
    await expect(stat(join(home, 'generated'))).rejects.toThrow();
  });

  it('lets an unexpected error taking the lock through', async () => {
    const home = await makeHome();
    // A file where the state folder should be: this is not "another apply is running".
    await writeFile(join(home, 'state'), 'not a folder');
    await expect(apply(options(home, fakeDocker(home)))).rejects.toThrow();
  });

  it('keeps the previous compose.yaml as compose.prev.yaml when it changes', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    await expect(stat(join(home, COMPOSE_PREV_PATH))).rejects.toThrow();
    const first = await readFile(join(home, COMPOSE_PATH), 'utf8');

    // Prowlarr brings Byparr, which has no appdata folder.
    await writeFile(join(home, 'stack.yaml'), `${STACK}  prowlarr: {}\n`);
    const second = await apply(options(home, docker));
    expect(second.outcome).toBe('success');
    expect(second.actions[1]?.detail).toBe(
      'wrote generated/compose.yaml and generated/.env',
    );
    expect(await readFile(join(home, COMPOSE_PREV_PATH), 'utf8')).toBe(first);
    expect(await readFile(join(home, COMPOSE_PATH), 'utf8')).not.toBe(first);
    expect(await modeOf(join(home, COMPOSE_PREV_PATH))).toBe(0o644);
  });

  it('never generates a secret twice', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    const stored = JSON.stringify({
      version: 1,
      apps: { sonarr: { apiKey: '0'.repeat(32) } },
      shared: { adminPassword: 'fake-admin-password' },
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

  it('writes pre-start files before the first start, private, and never again', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const path = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
    let presentAtStart = false;
    const watching: Runtime = {
      ...docker,
      up: async (seconds, values) => {
        presentAtStart = (await readFile(path, 'utf8').catch(() => '')) !== '';
        return docker.up(seconds, values);
      },
    };
    const first = await apply(options(home, watching, { catalog: WITH_FILES }));
    expect(first.outcome).toBe('success');
    expect(presentAtStart).toBe(true);
    expect(first.actions[1]?.detail).toBe(
      'wrote generated/compose.yaml and generated/.env; created appdata/sonarr/config/app.ini',
    );
    expect(first.plan.files).toContainEqual({
      path: 'appdata/sonarr/config/app.ini',
      status: 'create',
      diff: '',
      content: '',
      sensitive: true,
      prestart: true,
    });
    expect(await readFile(path, 'utf8')).toBe(`key=${'ab'.repeat(16)}\nuser=admin\n`);
    expect(await modeOf(path)).toBe(0o600);
    // No temporary copy of the file is left in its folder.
    expect(await readdir(join(home, 'appdata', 'sonarr', 'config'))).toEqual(['app.ini']);
    // The apps rewrite their files readable by all: appdata/ itself keeps them private.
    expect(await modeOf(join(home, 'appdata'))).toBe(0o700);

    // The app rewrites its own file; apply leaves it alone from now on.
    await writeFile(path, 'key=rewritten-by-the-app\n');
    const second = await apply(options(home, docker, { catalog: WITH_FILES }));
    expect(second.outcome).toBe('no-changes');
    expect(await readFile(path, 'utf8')).toBe('key=rewritten-by-the-app\n');
  });

  it('changes nothing when a pre-start file is from before Mediaplane seeded the app', async () => {
    const home = await makeHome();
    const path = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
    await mkdir(join(home, 'appdata', 'sonarr', 'config'), { recursive: true });
    await writeFile(path, 'user=someone\n');
    const confirm = vi.fn(() => Promise.resolve(true));
    const result = await apply(
      options(home, fakeDocker(home), { catalog: WITH_FILES, confirm }),
    );
    expect(result.outcome).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'sonarr.not-seeded', severity: 'error' }),
    );
    expect(confirm).not.toHaveBeenCalled();
    await expect(stat(join(home, 'generated'))).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('user=someone\n');
  });

  it('leaves existing pre-start files as they are when another change runs the files step', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const path = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
    expect((await apply(options(home, docker, { catalog: WITH_FILES }))).outcome).toBe(
      'success',
    );
    await writeFile(path, 'key=rewritten-by-the-app\n');
    const before = await stat(path);
    // A stale .env is a pending change, so the files step runs again.
    await writeFile(join(home, ENV_PATH), 'MP_STALE=1\n');
    const second = await apply(options(home, docker, { catalog: WITH_FILES }));
    expect(second.outcome).toBe('success');
    expect(second.actions[1]).toEqual({
      step: 'files',
      result: 'done',
      detail: 'wrote generated/.env',
    });
    expect(second.plan.files).toContainEqual(
      expect.objectContaining({
        path: 'appdata/sonarr/config/app.ini',
        status: 'unchanged',
      }),
    );
    const after = await stat(path);
    expect(await readFile(path, 'utf8')).toBe('key=rewritten-by-the-app\n');
    // The same file, not a new one: apply never wrote or replaced it.
    expect([after.ino, after.mtimeMs, after.mode]).toEqual([
      before.ino,
      before.mtimeMs,
      before.mode,
    ]);
    expect(await readdir(join(home, 'appdata', 'sonarr', 'config'))).toEqual(['app.ini']);
  });

  // root can write anywhere, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    "skips a pre-start file in a folder the app owns and Mediaplane can't write to",
    async () => {
      const home = await makeHome();
      const docker = fakeDocker(home);
      const folder = join(home, 'appdata', 'sonarr', 'config');
      expect((await apply(options(home, docker, { catalog: WITH_FILES }))).outcome).toBe(
        'success',
      );
      await chmod(folder, 0o555);
      try {
        await writeFile(join(home, ENV_PATH), 'MP_STALE=1\n');
        const second = await apply(options(home, docker, { catalog: WITH_FILES }));
        expect(second.outcome).toBe('success');
        expect(second.actions[1]?.detail).toBe('wrote generated/.env');
        expect(await readdir(folder)).toEqual(['app.ini']);
      } finally {
        // So that the temporary folder can be removed.
        await chmod(folder, 0o755);
      }
    },
  );

  it('stops at a pre-start file whose folder links outside the app folder, writing nothing there', async () => {
    const home = await makeHome();
    const outside = await tempDir('mediaplane-apply-outside-');
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await symlink(outside, join(home, 'appdata', 'sonarr', 'config'));
    const docker = fakeDocker(home);
    const result = await apply(options(home, docker, { catalog: WITH_FILES }));
    expect(result.outcome).toBe('failed');
    expect(result.actions.find((a) => a.step === 'files')).toEqual({
      step: 'files',
      result: 'failed',
      error:
        'appdata/sonarr/config/app.ini: a folder on its way leads outside appdata/sonarr',
    });
    expect(docker.calls).not.toContain('pull');
    expect(await readdir(outside)).toEqual([]);
  });

  it('stops at a pre-start file whose folder is a file, naming the path and not the content', async () => {
    const home = await makeHome();
    const blocker = join(home, 'appdata', 'sonarr', 'config');
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    // A file where the pre-start file's folder should be: plan counts the file as absent
    // (ENOTDIR), and apply can't create it.
    await writeFile(blocker, 'not a folder');
    const docker = fakeDocker(home);
    const result = await apply(options(home, docker, { catalog: WITH_FILES }));
    expect(result.outcome).toBe('failed');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'failed'],
      ['pull', 'skipped'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    const failed = result.diagnostics.find((d) => d.code === 'apply.files-failed');
    expect(failed?.message).toContain(blocker);
    const shown = JSON.stringify([result.actions, result.diagnostics]);
    expect(shown).not.toContain('ab'.repeat(16));
    expect(shown).not.toContain('user=admin');
    expect(docker.calls).not.toContain('pull');
    expect(await readdir(join(home, 'appdata', 'sonarr'))).toEqual(['config']);
    expect(await readFile(blocker, 'utf8')).toBe('not a folder');
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
