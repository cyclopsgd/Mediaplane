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
import type * as FsPromises from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDefinition, Catalog } from '../catalog/types';
import { listRecords } from '../history/records';
import { readResources } from '../integrations/resources';
import { runbookUrl } from '../runbooks';
import {
  COMPOSE_PATH,
  COMPOSE_PREV_PATH,
  ENV_PATH,
  LOCK_PATH,
  RESOURCES_PATH,
  SECRETS_PATH,
} from '../paths';
import { WiringRefused } from '../runtime/docker';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { fakeDocker, fakeProbe, HEALTHY_PROBE, probeOutput } from '../testing/fakes';
import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from '../testing/wiring';
import { apply, unhealthyServices, type ApplyOptions, type StepEvent } from './apply';
import { tempDir } from '../testing/temp';

// chmod() passes straight through, except where a test refuses it for one path, as the
// system does for a folder another user owns (which a test can't make without root).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, chmod: vi.fn(actual.chmod) };
});
const real = await vi.importActual<typeof FsPromises>('node:fs/promises');

beforeEach(() => {
  vi.mocked(chmod).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** chmod() fails on `path` with EPERM, as for a folder another user owns. */
function refuseChmodOf(path: string): void {
  vi.mocked(chmod).mockImplementation((target, mode) => {
    if (target === path) {
      return Promise.reject(
        Object.assign(new Error(`EPERM: operation not permitted, chmod '${path}'`), {
          code: 'EPERM',
        }),
      );
    }
    return real.chmod(target, mode);
  });
}

/**
 * Mediaplane runs as the next uid up from the one that owns what the test creates, so that
 * folders it makes belong to "another user". Returns the owner's uid.
 */
function runAsAnotherUser(): number {
  const owner = process.getuid?.() ?? 0;
  vi.spyOn(process, 'geteuid').mockReturnValue(owner + 1);
  return owner;
}

/** What apply says when appdata/ belongs to uid `owner`, and Mediaplane runs as the next. */
const NOT_PRIVATE = (home: string, owner: number) => ({
  message: `cannot make ${join(home, 'appdata')} private (EPERM): it belongs to uid ${String(owner)}, not to the user Mediaplane runs as (uid ${String(owner + 1)})`,
  hint: 'give appdata/ itself, not what is in it, to the user Mediaplane runs as (MEDIAPLANE_UID in its container), then run apply again',
});

const RUNBOOK = runbookUrl('wiring-failed');

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

/** `docker`, with `service` stopped by hand until up starts it again. */
function stoppedUntilUp(docker: Runtime, service: string): Runtime {
  let started = false;
  return {
    ...docker,
    containers: async () =>
      (await docker.containers()).map((c) =>
        !started && c.service === service ? { ...c, state: 'exited', health: '' } : c,
      ),
    up: (seconds, values) => {
      started = true;
      return docker.up(seconds, values);
    },
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
      ['wire', 'done'],
      ['verify', 'done'],
    ]);
    expect(result.actions[0]?.detail).toBe(
      'generated admin.password, gluetun.controlApiKey, sonarr.apiKey',
    );
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
      apps: {
        gluetun: { controlApiKey: 'ab'.repeat(16) },
        sonarr: { apiKey: 'ab'.repeat(16) },
      },
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
      'gluetun.controlApiKey',
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
    // compose.yaml and .env were already current, as plan said: nothing was written.
    expect(result.plan.files.filter((f) => f.status !== 'unchanged')).toEqual([]);
    expect(result.actions[1]?.detail).toBe('none needed');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'done'],
      ['ownership', 'done'],
      ['start', 'done'],
      ['wire', 'done'],
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

  it('names the wiring left after the start, and why what could not be checked was not', async () => {
    // The wire step reaches a fake Sonarr; what verify finds after it is the runtime's.
    const verifyFailure = async (
      runtime: (home: string, addresses: Record<string, string>) => Runtime,
    ) => {
      const home = await makeHome();
      const sonarr = await fakeSonarr();
      const result = await apply(
        options(home, runtime(home, sonarr.addresses), {
          catalog: WIRED_CATALOG,
          wiring: sonarr.seams,
        }),
      );
      expect(result.outcome).toBe('failed');
      expect(result.actions.find((a) => a.resource === 'sonarr.login')?.result).toBe(
        'done',
      );
      return result.diagnostics.find((d) => d.code === 'apply.verify-failed')?.message;
    };
    // Sonarr's container leaves the wiring network once it is wired: verify can't ask it.
    const leaving = (home: string, addresses: Record<string, string>): Runtime => {
      const docker = fakeDocker(home, { addresses });
      let wired = false;
      return {
        ...docker,
        wiringAddresses: async (ids) => {
          if (wired) return {};
          const found = await docker.wiringAddresses(ids);
          wired = Object.keys(found).length > 0;
          return found;
        },
      };
    };
    expect(await verifyFailure(leaving)).toBe(
      "changes remain after apply: sonarr.login (unknown: sonarr's container is not on the stack's wiring network, so Mediaplane can't reach it)",
    );
    // Sonarr isn't healthy after the start: its wiring waits for it.
    const relapsing = (home: string, addresses: Record<string, string>): Runtime => {
      const docker = fakeDocker(home, { addresses });
      let started = false;
      return {
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
    };
    expect(await verifyFailure(relapsing)).toBe(
      'changes remain after apply: sonarr (unhealthy), sonarr.login (after-start)',
    );
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
      ['wire', 'skipped'],
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
      ['wire', 'skipped'],
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
      ['wire', 'done'],
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
      ['wire', 'skipped'],
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
        hint: 'run "mediaplane status" to see each app, fix the cause, then run apply again; see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/app-wont-start.md',
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
      ['wire', 'skipped'],
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
      ['wire', 'skipped'],
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

  it('writes no file on an apply that only starts a stopped app, as plan said', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    const env = join(home, ENV_PATH);
    const before = await stat(env);
    // Plan's only change is to start Gluetun.
    const result = await apply(options(home, stoppedUntilUp(docker, 'gluetun')));
    expect(result.outcome).toBe('success');
    expect(result.plan.containers).toContainEqual({
      service: 'gluetun',
      action: 'start',
    });
    expect(result.plan.files.filter((f) => f.status !== 'unchanged')).toEqual([]);
    expect(result.actions[1]).toEqual({
      step: 'files',
      result: 'done',
      detail: 'none needed',
    });
    const after = await stat(env);
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(await modeOf(env)).toBe(0o600);
  });

  it("rewrites an unchanged .env it can't make private, as apply did before", async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    const env = join(home, ENV_PATH);
    const before = await stat(env);
    // Another user's file, as after a run with sudo: chmod() is refused, a rename isn't.
    refuseChmodOf(env);
    const result = await apply(options(home, stoppedUntilUp(docker, 'gluetun')));
    expect(result.outcome).toBe('success');
    expect(result.actions[1]).toEqual({
      step: 'files',
      result: 'done',
      detail: 'wrote generated/.env',
    });
    expect((await stat(env)).ino).not.toBe(before.ino);
    expect(await modeOf(env)).toBe(0o600);
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

    // Prowlarr brings Byparr, which has no appdata folder. Neither has a secret, so .env
    // stays as it was.
    await writeFile(join(home, 'stack.yaml'), `${STACK}  prowlarr: {}\n`);
    const second = await apply(options(home, docker));
    expect(second.outcome).toBe('success');
    expect(second.actions[1]?.detail).toBe('wrote generated/compose.yaml');
    expect(await readFile(join(home, COMPOSE_PREV_PATH), 'utf8')).toBe(first);
    expect(await readFile(join(home, COMPOSE_PATH), 'utf8')).not.toBe(first);
    expect(await modeOf(join(home, COMPOSE_PREV_PATH))).toBe(0o644);
  });

  it('never generates a secret twice', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    const stored = JSON.stringify({
      version: 1,
      apps: {
        gluetun: { controlApiKey: '1'.repeat(32) },
        sonarr: { apiKey: '0'.repeat(32) },
      },
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

  it('keeps appdata/ private on every apply, even one with nothing to change', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    // Opened up by hand, or by an old backup tool, since the last apply.
    await chmod(join(home, 'appdata'), 0o755);
    const again = await apply(options(home, docker));
    expect(again.outcome).toBe('no-changes');
    expect(await modeOf(join(home, 'appdata'))).toBe(0o700);
  });

  it('leaves a missing appdata/ to the files step when nothing else would change', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    await rm(join(home, 'appdata'), { recursive: true });
    // Plan still finds nothing to change (appdata/ holds no file it checks).
    const again = await apply(options(home, docker));
    expect(again.outcome).toBe('no-changes');
    await expect(stat(join(home, 'appdata'))).rejects.toThrow('ENOENT');
  });

  it('says appdata/ belongs to another user when the files step cannot make it private', async () => {
    const home = await makeHome();
    refuseChmodOf(join(home, 'appdata'));
    const owner = runAsAnotherUser();
    const result = await apply(options(home, fakeDocker(home)));
    expect(result.outcome).toBe('failed');
    expect(result.actions[1]).toMatchObject({ step: 'files', result: 'failed' });
    expect(result.diagnostics).toContainEqual({
      severity: 'error',
      code: 'apply.files-failed',
      ...NOT_PRIVATE(home, owner),
    });
  });

  it('says so too on an apply with nothing else to change, and changes nothing', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    refuseChmodOf(join(home, 'appdata'));
    const owner = runAsAnotherUser();
    const again = await apply(options(home, docker));
    expect(again.outcome).toBe('invalid');
    expect(again.actions).toEqual([]);
    expect(again.diagnostics).toContainEqual({
      severity: 'error',
      code: 'apply.appdata-not-private',
      ...NOT_PRIVATE(home, owner),
    });
    // Plan said so first, in the same words, as a warning.
    expect(again.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'appdata.not-owned',
        hint: NOT_PRIVATE(home, owner).hint,
      }),
    );
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
      ['wire', 'skipped'],
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

describe('apply: qBittorrent behind Gluetun', () => {
  it('restarts qBittorrent when it starts a Gluetun stopped by hand, and verifies the VPN', async () => {
    // The owner's trial: "docker stop" on Gluetun, then apply. qBittorrent kept running
    // with the network the old Gluetun had; Compose would start Gluetun alone.
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    docker.calls.length = 0;
    const result = await apply(options(home, stoppedUntilUp(docker, 'gluetun')));
    expect(result.outcome).toBe('success');
    expect(result.plan.containers).toEqual(
      expect.arrayContaining([
        { service: 'gluetun', action: 'start' },
        { service: 'qbittorrent', action: 'restart' },
      ]),
    );
    expect(docker.calls.indexOf('stop qbittorrent')).toBeLessThan(
      docker.calls.indexOf('up'),
    );
    expect(result.actions.find((a) => a.step === 'start')?.detail).toBe(
      'every app is running and healthy; restarted qbittorrent',
    );
    expect(result.actions.find((a) => a.step === 'verify')).toEqual({
      step: 'verify',
      result: 'done',
      detail:
        "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up",
    });
    // The VPN check's probe ran, in qBittorrent's network, without asking the internet.
    const probe = docker.calls.filter(
      (call) => call === 'run qbittorrent sh as 65534:65534',
    );
    expect(probe).toHaveLength(1);
  });

  it('fails verify, with what to do, when the VPN check finds the VPN down', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home, {
      run: () => ({
        code: 0,
        stdout: probeOutput({
          ...HEALTHY_PROBE,
          status: [0, '{"status":"stopped"}\n200'],
        }),
        stderr: '',
      }),
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.verify-failed',
        message:
          "the VPN check found the VPN down: Gluetun's control server says the VPN is stopped",
        hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
      }),
    );
  });

  it("fails verify with a leak, naming the check's own hint", async () => {
    const home = await makeHome();
    // Docker says qBittorrent has a network of its own, which the plan can't see.
    const docker = fakeDocker(home, {
      details: { 'fake-qbittorrent': { networkMode: 'bridge' } },
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.verify-failed',
        message:
          'the VPN check found a leak: qBittorrent has a network of its own ("bridge"), not Gluetun\'s: its traffic does not go through the VPN',
        hint: 'run "mediaplane apply" to recreate it behind Gluetun, and check compose.override.yaml for a network_mode of its own',
      }),
    );
  });

  it('fails verify, with the check and its hint, when the VPN check cannot run', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home, {
      run: () => ({ code: 125, stdout: '', stderr: 'fake: no such image' }),
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.verify-failed',
        message:
          "the VPN check could not run: the probe in qBittorrent's network could not run: fake: no such image",
        hint: 'check that the qBittorrent image is present ("docker image ls"), then run vpn-check again',
      }),
    );
  });

  it('stops at a restart that fails, before up', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    docker.calls.length = 0;
    const failing: Runtime = {
      ...stoppedUntilUp(docker, 'gluetun'),
      stop: () => Promise.resolve({ ok: false, error: 'fake: cannot stop qbittorrent' }),
    };
    const result = await apply(options(home, failing));
    expect(result.outcome).toBe('failed');
    expect(result.actions.find((a) => a.step === 'start')).toEqual({
      step: 'start',
      result: 'failed',
      error: 'fake: cannot stop qbittorrent',
    });
    expect(docker.calls).not.toContain('up');
    expect(result.actions.at(-1)).toEqual({ step: 'verify', result: 'skipped' });
  });

  it('does not check the VPN when qBittorrent is not behind Gluetun', async () => {
    const home = await makeHome(
      STACK.replace('qbittorrent: {}', 'qbittorrent: { vpn: false }'),
    );
    const docker = fakeDocker(home);
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('success');
    expect(result.actions.find((a) => a.step === 'verify')?.detail).toBe(
      'no changes remain',
    );
    expect(docker.calls.filter((call) => call.startsWith('run '))).toEqual([]);
  });
});

describe('apply: the wiring', () => {
  it('steps off the wiring network for up, wires each app after it, and records it', async () => {
    const home = await makeHome();
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, { addresses: sonarr.addresses });
    const wired = { catalog: WIRED_CATALOG, wiring: sonarr.seams };
    // Each step's start goes in among Docker's calls, so each call shows its step.
    const onStep = (event: StepEvent) => {
      if (event.phase === 'start') docker.calls.push(`step ${event.step}`);
    };
    const first = await apply(options(home, docker, { ...wired, onStep }));
    expect(first.outcome).toBe('success');
    expect(first.plan.wiring).toEqual([
      { resource: 'sonarr.login', action: 'after-start' },
    ]);
    expect(first.actions.map((a) => [a.step, a.resource ?? '', a.result])).toEqual([
      ['keys', '', 'done'],
      ['files', '', 'done'],
      ['pull', '', 'done'],
      ['ownership', '', 'done'],
      ['start', '', 'done'],
      ['wire', 'sonarr.login', 'done'],
      ['wire', '', 'done'],
      ['verify', '', 'done'],
    ]);
    expect(
      first.actions.find((a) => a.step === 'wire' && a.resource === undefined)?.detail,
    ).toBe('sonarr.login created');
    const during = (step: string, next: string) =>
      docker.calls.slice(
        docker.calls.indexOf(`step ${step}`) + 1,
        docker.calls.indexOf(`step ${next}`),
      );
    // The start step steps off before up; the wire step itself joins again, before it
    // looks for the apps (verify's plan joins too, but later).
    expect(during('start', 'wire')).toEqual(['leave-wiring', 'up']);
    expect(during('wire', 'verify').slice(0, 3)).toEqual([
      'join-wiring',
      'containers',
      'wiring-addresses fake-sonarr',
    ]);
    expect(sonarr.state.user).toBe('admin');
    expect(Object.keys(await readResources(home))).toEqual(['sonarr.login']);
    const [record] = (await listRecords(home)).records;
    expect(record?.plan.wiring).toEqual([
      { resource: 'sonarr.login', action: 'after-start' },
    ]);
    // Sonarr was sent its key and the password; nothing Mediaplane keeps or shows holds them.
    const kept = [
      JSON.stringify(first),
      JSON.stringify(record),
      await readFile(join(home, RESOURCES_PATH), 'utf8'),
    ].join('\n');
    expect(sonarr.state.password).not.toBe('');
    for (const secret of [sonarr.state.password, 'ab'.repeat(16)]) {
      expect(kept).not.toContain(secret);
    }

    const second = await apply(options(home, docker, wired));
    expect(second.outcome).toBe('no-changes');
    expect(second.plan.wiring).toEqual([
      { resource: 'sonarr.login', action: 'unchanged' },
    ]);
  });

  it("fails the wire step with the app's own message, and skips verify", async () => {
    const home = await makeHome();
    const sonarr = await fakeSonarr({ key: 'f'.repeat(32) });
    const docker = fakeDocker(home, { addresses: sonarr.addresses });
    const result = await apply(
      options(home, docker, { catalog: WIRED_CATALOG, wiring: sonarr.seams }),
    );
    expect(result.outcome).toBe('failed');
    expect(
      result.actions.slice(-3).map((a) => [a.step, a.resource ?? '', a.result]),
    ).toEqual([
      ['wire', 'sonarr.login', 'failed'],
      ['wire', '', 'failed'],
      ['verify', '', 'skipped'],
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'wire.auth',
      'apply.wire-failed',
    ]);
    expect(result.diagnostics[0]?.message).toContain(
      "refused Mediaplane's API key (HTTP 401)",
    );
    expect(result.diagnostics[1]).toMatchObject({
      message: 'the wiring failed for sonarr.login',
      hint: "the apps' own messages are above; fix what they say, then run apply again. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md",
    });
    // The fake Sonarr repeated the key it refused: neither the result nor the record has it.
    const { records } = await listRecords(home);
    expect(JSON.stringify(records)).toContain('Unauthorized: ***');
    expect(JSON.stringify([result, records])).not.toContain('ab'.repeat(16));
  });
});

describe("apply: a resources.json it can't read", () => {
  const UNREADABLE = '{"schema": "mediaplane.resources/v1", "resources": {';

  async function withUnreadable(home: string): Promise<string> {
    await mkdir(join(home, 'state'), { recursive: true });
    const path = join(home, RESOURCES_PATH);
    await writeFile(path, UNREADABLE);
    return path;
  }

  it('stops before changing anything, and leaves the file as it is', async () => {
    const home = await makeHome();
    const path = await withUnreadable(home);
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, { addresses: sonarr.addresses });
    const result = await apply(
      options(home, docker, { catalog: WIRED_CATALOG, wiring: sonarr.seams }),
    );
    expect(result.outcome).toBe('invalid');
    expect(result.diagnostics.map((d) => d.code)).toContain('resources.invalid');
    expect(result.actions).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe(UNREADABLE);
    expect(sonarr.app.requests).toEqual([]);
  });

  it('fails the wire step when it stops parsing during the start, and never writes over it', async () => {
    const home = await makeHome();
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, { addresses: sonarr.addresses });
    let path = '';
    const breaking: Runtime = {
      ...docker,
      up: async (seconds, values) => {
        path = await withUnreadable(home);
        return docker.up(seconds, values);
      },
    };
    const result = await apply(
      options(home, breaking, { catalog: WIRED_CATALOG, wiring: sonarr.seams }),
    );
    expect(result.outcome).toBe('failed');
    expect(
      result.actions.slice(-2).map((a) => [a.step, a.resource ?? '', a.result]),
    ).toEqual([
      ['wire', '', 'failed'],
      ['verify', '', 'skipped'],
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'resources.invalid',
      'apply.wire-failed',
    ]);
    expect(result.diagnostics[1]?.hint).toBe(
      `state/resources.json was left as it is; fix it or move it aside as the error above says, then run apply again. See ${RUNBOOK}`,
    );
    expect(await readFile(path, 'utf8')).toBe(UNREADABLE);
    expect(sonarr.app.requests).toEqual([]);
  });
});

describe('apply: what a failed wiring says to do', () => {
  /** apply with a fake Sonarr, and the step's own diagnostic. */
  async function stepFailure(
    step: 'start' | 'wire',
    runtime: (docker: Runtime) => Runtime = (docker) => docker,
    catalog: Catalog = WIRED_CATALOG,
    extra: Parameters<typeof fakeDocker>[1] = {},
  ) {
    const home = await makeHome();
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, { addresses: sonarr.addresses, ...extra });
    const result = await apply(
      options(home, runtime(docker), { catalog, wiring: sonarr.seams }),
    );
    expect(result.outcome).toBe('failed');
    return {
      result,
      docker,
      sonarr,
      own: result.diagnostics.find((d) => d.code === `apply.${step}-failed`),
    };
  }

  it('says to look for the network, when there is none after the start', async () => {
    const { own, sonarr } = await stepFailure('wire', undefined, WIRED_CATALOG, {
      join: 'no-network',
    });
    expect(own).toMatchObject({
      message: 'the stack has no wiring network, though apply has just started it',
      hint: `run "docker network ls" and look for mediaplane_wiring (<project>_wiring under another project name); a compose.override.yaml that sets the apps' networks can drop it. Then run apply again. See ${RUNBOOK}`,
    });
    expect(sonarr.app.requests).toEqual([]);
  });

  it("says nothing was changed in the apps, when Mediaplane can't reach them", async () => {
    const { result, own } = await stepFailure('wire', undefined, WIRED_CATALOG, {
      join: () => {
        throw new WiringRefused('refusing to join fake_wiring: it is not internal');
      },
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'wire.network',
      'apply.wire-failed',
    ]);
    expect(own?.hint).toBe(
      `the error above says why Mediaplane couldn't reach the apps; nothing was changed in them. Fix it, then run apply again. See ${RUNBOOK}`,
    );
  });

  it("gives the step's own hint for what isn't the app's, after each resource's", async () => {
    const broken: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [
                { ...FAKE_LOGIN, create: () => Promise.reject(new Error('a fake bug')) },
              ],
            },
          }
        : def,
    );
    const { result, own } = await stepFailure('wire', undefined, broken);
    expect(own).toMatchObject({
      message: 'a fake bug',
      hint: `fix what the error says, then run apply again; see ${RUNBOOK}`,
    });
    expect(
      result.actions.slice(-3).map((a) => [a.step, a.resource ?? '', a.result]),
    ).toEqual([
      ['wire', 'sonarr.login', 'failed'],
      ['wire', '', 'failed'],
      ['verify', '', 'skipped'],
    ]);
  });

  it("says why it couldn't step off the network, and starts nothing", async () => {
    const { own, docker } = await stepFailure('start', (inner) => ({
      ...inner,
      leaveWiring: () =>
        Promise.reject(
          new RuntimeError('could not leave the wiring network fake_wiring: fake'),
        ),
    }));
    expect(own).toMatchObject({
      message: 'could not leave the wiring network fake_wiring: fake',
      hint: `Mediaplane steps off the stack's wiring network before Compose starts the apps, and couldn't, so nothing was started; fix what the error says, then run apply again. See ${RUNBOOK}`,
    });
    expect(docker.calls).not.toContain('up');
  });
});
