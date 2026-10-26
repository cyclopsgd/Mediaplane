import {
  chmod,
  link,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDefinition, BootstrapContext, Catalog } from '../catalog/types';
import { AppApiError, type AppApi } from '../http/client';
import { listRecords } from '../history/records';
import { readResources } from '../integrations/resources';
import { plan } from '../plan/plan';
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
import { readSecretStore, writeSecretStore, type SecretStore } from '../secrets/store';
import {
  FAKE_ADMIN,
  fakeSetUpApp,
  SET_UP_CATALOG,
  SET_UP_KEY,
  SIGN_IN_CATALOG,
} from '../testing/bootstrap';
import { fakePlexTv } from '../testing/plextv';
import {
  fakeDocker,
  fakeProbe,
  HEALTHY_PROBE,
  probeOutput,
  type FakeRuntimeOptions,
} from '../testing/fakes';
import {
  FIXTURE_API,
  FIXTURE_HOST,
  fixtureApp,
  fixtureCatalog,
} from '../testing/fixtures';
import type { WiringSeams } from '../integrations/wiring';
import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from '../testing/wiring';
import { apply, unhealthyServices, type ApplyOptions, type StepEvent } from './apply';
import { BootstrapFailed } from './bootstrap';
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

/** A key in a file of the app's own, on a `key=` line, written back in its place. */
const KEY_LINE = {
  path: 'auth.toml',
  read: (text: string) => /^key=(.*)$/m.exec(text)?.[1],
  write: (text: string, key: string) => text.replace(/^key=.*$/m, () => `key=${key}`),
};

/** WITH_FILES, with Sonarr's key read back from its pre-start file (spec §6.1). */
const WITH_KEYS: Catalog = WITH_FILES.map((app) =>
  app.id === 'sonarr'
    ? {
        ...app,
        keyFiles: {
          apiKey: {
            path: 'config/app.ini',
            read: (text) => /^key=(.*)$/m.exec(text)?.[1],
          },
        },
      }
    : app,
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
  it("saves the keys it recovers from the apps' appdata with those it generates, and writes no file over them", async () => {
    const home = await makeHome();
    const key = 'f'.repeat(32);
    const file = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, `key=${key}\nuser=someone\n`);
    const result = await apply(options(home, fakeDocker(home), { catalog: WITH_KEYS }));
    expect(result.outcome).toBe('success');
    expect(result.plan.secrets).toEqual({
      generate: ['admin.password', 'gluetun.controlApiKey'],
      recover: ['sonarr.apiKey'],
      restore: [],
    });
    expect(result.actions[0]).toEqual({
      step: 'keys',
      result: 'done',
      detail:
        'recovered sonarr.apiKey from appdata; generated admin.password, gluetun.controlApiKey',
    });
    expect((await readSecretStore(home)).apps.sonarr).toEqual({ apiKey: key });
    expect(await readFile(file, 'utf8')).toBe(`key=${key}\nuser=someone\n`);
    expect(await readFile(join(home, ENV_PATH), 'utf8')).toContain(key);
    // `restore` names none, so the record has none: an older release reads it.
    const [record] = (await listRecords(home)).records;
    expect(record?.plan.secrets).toEqual({
      generate: ['admin.password', 'gluetun.controlApiKey'],
      recover: ['sonarr.apiKey'],
    });
  });

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
      expect.objectContaining({
        code: 'apply.locked',
        // drift and keep hold it too: deleting it is safe only with none running.
        hint: 'wait for it to finish; if no Mediaplane command is running (apply, drift or keep), delete state/lock',
      }),
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
    expect(docker.calls).toContain('stop qbittorrent');
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

  it("keeps the VPN check's warnings, and doesn't say the VPN is up", async () => {
    const home = await makeHome();
    // Gluetun's control server answers without a key, and refuses Mediaplane's.
    const docker = fakeDocker(home, {
      run: () => ({
        code: 0,
        stdout: probeOutput({
          ...HEALTHY_PROBE,
          anonymous: [0, '200'],
          status: [0, '{"status":"running"}\n401'],
        }),
        stderr: '',
      }),
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('success');
    expect(result.actions.find((a) => a.step === 'verify')).toEqual({
      step: 'verify',
      result: 'done',
      detail:
        "no changes remain, and qBittorrent's network is Gluetun's, but the VPN check has 2 warnings",
    });
    const warnings = result.diagnostics.filter((d) => d.code.startsWith('vpn.'));
    expect(warnings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'vpn.control',
        message: "Gluetun's control server refused Mediaplane's key",
      }),
      expect.objectContaining({
        severity: 'warning',
        code: 'vpn.control-key',
        message:
          "Gluetun's control server answers anyone on the stack's network, without a key: Gluetun has not read its key file since Mediaplane wrote it",
        hint: expect.stringContaining('restart Gluetun, then qBittorrent') as string,
      }),
    ]);
    // In the change record's outcome too: the apply still succeeded.
    const [record] = (await listRecords(home)).records;
    expect(record?.actions.find((a) => a.step === 'verify')?.detail).toContain(
      'the VPN check has 2 warnings',
    );
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

  it("puts Gluetun's key back in its file while it is stopped, restarting qBittorrent too", async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const catalog = fixtureCatalog.map((app) =>
      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
    );
    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
    const file = join(home, 'appdata', 'gluetun', 'auth.toml');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, `user=someone\nkey=${'9'.repeat(32)}\n`, { mode: 0o640 });
    docker.calls.length = 0;
    const result = await apply(options(home, docker, { catalog }));
    expect(result.outcome).toBe('success');
    expect(result.plan.secrets.restore).toEqual(['gluetun.controlApiKey']);
    const stored = (await readSecretStore(home)).apps.gluetun?.controlApiKey ?? '';
    expect(await readFile(file, 'utf8')).toBe(`user=someone\nkey=${stored}\n`);
    expect(await modeOf(file)).toBe(0o640);
    expect(docker.calls.indexOf('stop gluetun qbittorrent')).toBeGreaterThanOrEqual(0);
    expect(docker.calls.indexOf('stop gluetun qbittorrent')).toBeLessThan(
      docker.calls.indexOf('up'),
    );
    expect(result.actions.find((a) => a.step === 'start')?.detail).toBe(
      "every app is running and healthy; restarted gluetun, qbittorrent; put gluetun.controlApiKey back in its app's file",
    );
    // Gluetun holds the key Mediaplane does: nothing is left to put back.
    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('no-changes');
  });

  it('starts every app again when a key it was to put back cannot be, then fails the step', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const catalog = fixtureCatalog.map((app) =>
      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
    );
    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
    const file = join(home, 'appdata', 'gluetun', 'auth.toml');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, `key=${'9'.repeat(32)}\n`);
    // Between the plan and the write, the file gets a second name: no longer safe to
    // replace.
    const linking: Runtime = {
      ...docker,
      stop: async (services, values) => {
        await link(file, `${file}.other-name`);
        return docker.stop(services, values);
      },
    };
    docker.calls.length = 0;
    const result = await apply(options(home, linking, { catalog }));
    expect(result.outcome).toBe('failed');
    expect(result.actions.find((a) => a.step === 'start')).toEqual({
      step: 'start',
      result: 'failed',
      error:
        'cannot put gluetun.controlApiKey back in appdata/gluetun/auth.toml: it has other names (hard links), which a rewrite would part from it',
    });
    expect(docker.calls).toContain('up');
    expect(await readFile(file, 'utf8')).toBe(`key=${'9'.repeat(32)}\n`);
  });

  it('stops an app whose key goes back in its file in any state but stopped, before the write', async () => {
    const catalog = fixtureCatalog.map((app) =>
      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
    );
    for (const state of ['restarting', 'paused', 'exited', 'created'] as const) {
      const home = await makeHome();
      const docker = fakeDocker(home);
      expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
      const file = join(home, 'appdata', 'gluetun', 'auth.toml');
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, `key=${'9'.repeat(32)}\n`);
      // Crash-looping, or paused: Docker may start it, or it may write its file, any time.
      let written = '';
      const inState: Runtime = {
        ...docker,
        containers: async () =>
          (await docker.containers()).map((c) =>
            c.service === 'gluetun' ? { ...c, state, health: '' } : c,
          ),
        stop: async (services, values) => {
          written = await readFile(file, 'utf8');
          return docker.stop(services, values);
        },
      };
      docker.calls.length = 0;
      const result = await apply(options(home, inState, { catalog }));
      expect(result.plan.secrets.restore).toEqual(['gluetun.controlApiKey']);
      const stops = docker.calls.filter((c) => c.startsWith('stop'));
      if (state === 'exited' || state === 'created') {
        expect(stops.join(' ')).not.toContain('gluetun');
      } else {
        expect(stops, state).toEqual(['stop gluetun qbittorrent']);
        // Stopped first, then written.
        expect(written).toBe(`key=${'9'.repeat(32)}\n`);
      }
      const stored = (await readSecretStore(home)).apps.gluetun?.controlApiKey ?? '';
      expect(await readFile(file, 'utf8')).toBe(`key=${stored}\n`);
    }
  });

  it('stops an app whose key goes back in its file that up recreates, before the write', async () => {
    const catalog = fixtureCatalog.map((app) =>
      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
    );
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
    const file = join(home, 'appdata', 'gluetun', 'auth.toml');
    await writeFile(file, `key=${'9'.repeat(32)}\n`);
    let written = '';
    const changed: Runtime = {
      ...docker,
      // Its service changed in compose.yaml: up recreates it.
      configHashes: async (compose, values) => {
        const hashed = await docker.configHashes(compose, values);
        return hashed.ok
          ? { ok: true, hashes: { ...hashed.hashes, gluetun: 'fake-changed-hash' } }
          : hashed;
      },
      stop: async (services, values) => {
        written = await readFile(file, 'utf8');
        return docker.stop(services, values);
      },
    };
    docker.calls.length = 0;
    const result = await apply(options(home, changed, { catalog }));
    expect(result.plan.containers.find((c) => c.service === 'gluetun')?.action).toBe(
      'recreate',
    );
    // qBittorrent, in Gluetun's network, is recreated with it (its hash names Gluetun's
    // container): never left on the old network.
    expect(result.plan.containers.find((c) => c.service === 'qbittorrent')?.action).toBe(
      'recreate',
    );
    expect(docker.calls.filter((c) => c.startsWith('stop'))).toEqual(['stop gluetun']);
    expect(written).toBe(`key=${'9'.repeat(32)}\n`);
    expect(docker.calls.indexOf('up')).toBeGreaterThan(
      docker.calls.findIndex((c) => c.startsWith('stop')),
    );
  });

  it('says both when a key it was to put back cannot be and up fails too, and what it did put back', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const catalog = fixtureCatalog.map((app) =>
      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
    );
    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
    const file = join(home, 'appdata', 'gluetun', 'auth.toml');
    await writeFile(file, `key=${'9'.repeat(32)}\n`);
    const failing: Runtime = {
      ...docker,
      stop: async (services, values) => {
        await link(file, `${file}.other-name`);
        return docker.stop(services, values);
      },
      up: () => Promise.resolve({ ok: false, error: 'fake: no space left on device' }),
    };
    const result = await apply(options(home, failing, { catalog }));
    expect(result.actions.find((a) => a.step === 'start')).toEqual({
      step: 'start',
      result: 'failed',
      error:
        'docker compose up failed: fake: no space left on device; and cannot put gluetun.controlApiKey back in appdata/gluetun/auth.toml: it has other names (hard links), which a rewrite would part from it',
    });
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

describe('apply: rotating the admin password', () => {
  it('generates a new one, sets it in each app with its key, and the next apply changes nothing', async () => {
    const home = await makeHome();
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, { addresses: sonarr.addresses });
    const wired = { catalog: WIRED_CATALOG, wiring: sonarr.seams };
    expect((await apply(options(home, docker, wired))).outcome).toBe('success');
    const before = (await readSecretStore(home)).shared?.adminPassword ?? '';
    const signIns = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
    const signedIn = signIns();
    const random = (size: number) => Buffer.alloc(size, 0xcd);
    const rotated = await apply(
      options(home, docker, { ...wired, random, rotate: ['admin.password'] }),
    );
    expect(rotated.outcome).toBe('success');
    expect(rotated.actions[0]).toEqual({
      step: 'keys',
      result: 'done',
      detail: 'generated admin.password',
    });
    const after = (await readSecretStore(home)).shared?.adminPassword ?? '';
    expect(after !== '' && after !== before, 'a new password was saved').toBe(true);
    expect(sonarr.state.password === after, 'Sonarr has the new password').toBe(true);
    // One sign-in, with the new one, by verify's plan: none with a password no app had.
    expect(signIns() - signedIn).toBe(1);
    expect((await apply(options(home, docker, wired))).outcome).toBe('no-changes');
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

  it('signs in once with a password the app refuses, then sets it without asking again', async () => {
    const home = await makeHome();
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, { addresses: sonarr.addresses });
    const wired = { catalog: WIRED_CATALOG, wiring: sonarr.seams };
    expect((await apply(options(home, docker, wired))).outcome).toBe('success');
    sonarr.state.password = 'fake-other-password';
    const signIns = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
    const before = signIns();
    const result = await apply(options(home, docker, wired));
    expect(result.outcome).toBe('success');
    expect(result.plan.wiring).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
    expect(result.actions.find((a) => a.resource === 'sonarr.login')?.detail).toBe(
      'updated password',
    );
    // Its plan's sign-in failed; the wire step signed in no more; verify's worked.
    expect(signIns() - before).toBe(2);
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
      home,
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

  it('keeps the secrets out of the record and the diagnostics of an unexpected error', async () => {
    let password = '';
    const leaky: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [
                {
                  ...FAKE_LOGIN,
                  create: (_api, desired) => {
                    password = desired.secrets.password ?? '';
                    return Promise.reject(new Error(`a fake bug, near ${password}`));
                  },
                },
              ],
            },
          }
        : def,
    );
    const { home, result, own } = await stepFailure('wire', undefined, leaky);
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(own?.message).toBe('a fake bug, near ***');
    const { records } = await listRecords(home);
    expect(records).toHaveLength(1);
    expect(records[0]?.actions).toContainEqual({
      step: 'wire',
      resource: 'sonarr.login',
      result: 'failed',
      error: 'a fake bug, near ***',
    });
    const shown = JSON.stringify([result, records]);
    for (const secret of [password, 'ab'.repeat(16)]) {
      expect(shown).not.toContain(secret);
    }
  });

  it("keeps a secret the wire step found out of verify's message, though verify's own clients never read it", async () => {
    const HELD = 'e'.repeat(32);
    type Rest =
      Parameters<typeof FAKE_LOGIN.observe> extends [unknown, ...infer R] ? R : never;
    let calls = 0;
    const holding: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [
                {
                  ...FAKE_LOGIN,
                  // Asked in the wire step, it reads a key the app holds in clear; asked
                  // again by verify's plan, it fails quoting it, without reading it again.
                  observe: (api: AppApi, ...rest: Rest) => {
                    calls += 1;
                    if (calls === 1) {
                      api.addSecret(HELD);
                      return FAKE_LOGIN.observe(api, ...rest);
                    }
                    return Promise.reject(
                      new AppApiError(`Sonarr holds ${HELD}`, { kind: 'rejected' }),
                    );
                  },
                },
              ],
            },
          }
        : def,
    );
    const home = await makeHome();
    const sonarr = await fakeSonarr();
    const result = await apply(
      options(home, fakeDocker(home, { addresses: sonarr.addresses }), {
        catalog: holding,
        wiring: sonarr.seams,
      }),
    );
    expect(result.outcome).toBe('failed');
    const said = result.diagnostics.find((d) => d.code === 'apply.verify-failed');
    expect(said?.message).toBe(
      'changes remain after apply: sonarr.login (unknown: Sonarr holds ***)',
    );
    expect(JSON.stringify(result)).not.toContain(HELD);
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

describe('apply: first-run setup before the ports are published', () => {
  /** A store with the admin password alone: apply generates the keys, not it. */
  const WITH_PASSWORD: SecretStore = {
    version: 1,
    apps: {},
    shared: { adminPassword: 'fake-admin-password' },
  };
  /**
   * The fake setup's stack, and a Docker that notes, at each up, which apps it starts
   * without their ports and whether the setup is done then.
   */
  async function setUpStack(more: FakeRuntimeOptions = {}) {
    const home = await makeHome();
    const setup = await fakeSetUpApp(home);
    const docker = fakeDocker(home, { addresses: setup.addresses, ...more });
    const ups: string[] = [];
    const runtime: Runtime = {
      ...docker,
      up: (seconds, values, unpublished = []) => {
        const shown =
          unpublished.length === 0
            ? 'all published'
            : `${unpublished.join(' ')} unpublished`;
        ups.push(`${shown}, setup ${setup.state.done ? 'done' : 'open'}`);
        return docker.up(seconds, values, unpublished);
      },
    };
    const extra = { catalog: SET_UP_CATALOG, wiring: setup.seams };
    const run = (more: Partial<ApplyOptions> = {}) =>
      apply(options(home, runtime, { ...extra, ...more }));
    return { home, setup, docker, runtime, ups, run, extra };
  }

  it('names the setup in plan, and never runs it there', async () => {
    const { home, setup, runtime, extra } = await setUpStack();
    const shown = await plan(options(home, runtime, extra));
    expect(shown.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(shown.changed).toBe(true);
    expect(setup.app.requests).toEqual([]);
  });

  it('starts an app whose setup is open without its ports, sets it up, saves its key at once, then publishes it', async () => {
    const { home, setup, docker, ups, run } = await setUpStack();
    const onStep = (event: StepEvent) => {
      if (event.phase === 'start') docker.calls.push(`step ${event.step}`);
    };
    const first = await run({ onStep });
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(first.outcome).toBe('success');
    expect(first.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(first.plan.wiring).toEqual([{ resource: 'jellyfin', action: 'after-start' }]);
    expect(first.actions.map((a) => a.step)).toEqual([
      'keys',
      'files',
      'pull',
      'ownership',
      'start',
      'bootstrap',
      'wire',
      'verify',
    ]);
    expect(first.actions.find((a) => a.step === 'start')?.detail).toBe(
      'every app is running and healthy; started jellyfin without its ports, to set it up first',
    );
    expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
      'set up jellyfin and saved jellyfin.apiKey; published jellyfin',
    );
    // Its ports were published only once its setup was done, as the shared admin.
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'all published, setup done',
    ]);
    expect(setup.state.admin).toBe('admin');
    const during = docker.calls.slice(
      docker.calls.indexOf('step bootstrap') + 1,
      docker.calls.indexOf('step wire'),
    );
    expect(during).toEqual([
      'join-wiring',
      'containers',
      'wiring-addresses fake-jellyfin',
      // Off the wiring network before up, as the start step steps off (ADR 0011).
      'leave-wiring',
      'up',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
    const [record] = (await listRecords(home)).records;
    expect(record?.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(JSON.stringify([first, record])).not.toContain(SET_UP_KEY);
    expect((await run()).outcome).toBe('no-changes');
  });

  it("keeps an app whose setup fails while it is open unpublished, and fails with the app's words", async () => {
    const { home, setup, ups, run } = await setUpStack();
    setup.state.refuse = 'fake refusal';
    const result = await run();
    expect(result.outcome).toBe('failed');
    // The wire step runs past it, skipping the app whose setup failed (spec §5.1).
    expect(result.actions.slice(-4).map((a) => [a.step, a.resource, a.result])).toEqual([
      ['bootstrap', undefined, 'failed'],
      ['wire', 'jellyfin', 'skipped'],
      ['wire', undefined, 'done'],
      ['verify', undefined, 'skipped'],
    ]);
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'jellyfin unpublished, setup open',
    ]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        'the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the request (HTTP 400): fake refusal (POST /setup)',
      hint: `fix what the error says, then run apply again: an app whose setup is still open keeps its ports unpublished until then. See ${RUNBOOK}`,
    });
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('publishes nothing when the setup fails before it reaches the app', async () => {
    // No wiring network after the start: the setup can't reach the app, so it stays open.
    const { home, setup, ups, run } = await setUpStack({ join: 'no-network' });
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
      ['bootstrap', 'failed'],
      ['wire', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message: 'the stack has no wiring network, though apply has just started it',
    });
    // Only the start step's up, which left it unpublished.
    expect(ups).toEqual(['jellyfin unpublished, setup open']);
    expect(setup.app.requests).toEqual([]);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('publishes an app whose setup is done though making its key failed, then only makes the key', async () => {
    const { home, setup, ups, run } = await setUpStack();
    setup.state.keyFails = true;
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)?.message).toBe(
      'the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) failed (HTTP 500): fake failure (GET /key)',
    );
    // Nobody can claim it any more: it is published all the same.
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'all published, setup done',
    ]);
    setup.state.keyFails = false;
    const again = await run();
    expect(again.outcome).toBe('success');
    expect(again.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
    expect(again.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
      'unchanged',
    );
    expect(again.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
      'set up jellyfin and saved jellyfin.apiKey',
    );
    // Only the start step's up: the bootstrap step had nothing to publish.
    expect(ups.slice(2)).toEqual(['all published, setup done']);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
  });

  it('makes the key again, signed in and published throughout, for an app that refuses the one its setup made', async () => {
    const { home, setup, ups, run } = await setUpStack();
    expect((await run()).outcome).toBe('success');
    // Its key deleted by hand, and another made: the app refuses the stored one.
    setup.state.key = '7'.repeat(32);
    const again = await run();
    expect(again.outcome).toBe('success');
    expect(again.plan.drift).toEqual([
      { resource: 'jellyfin', kind: 'key', secret: 'apiKey' },
    ]);
    expect(again.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
    expect(again.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
      'unchanged',
    );
    expect(again.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
      'set up jellyfin and saved jellyfin.apiKey',
    );
    // The start step's up alone: it was never unpublished.
    expect(ups.slice(2)).toEqual(['all published, setup done']);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({
      apiKey: '7'.repeat(32),
    });
    expect((await run()).outcome).toBe('no-changes');
  });

  it('sets up again, without its ports, an app whose appdata lost its setup, and keeps its new key', async () => {
    const { home, setup, ups, run } = await setUpStack();
    expect((await run()).outcome).toBe('success');
    // Its appdata emptied by hand: it starts its setup again, with the old key stored.
    await rm(join(home, 'appdata', 'jellyfin', 'setup.txt'));
    Object.assign(setup.state, { done: false, key: '' });
    const store = await readSecretStore(home);
    await writeSecretStore(home, {
      ...store,
      apps: { ...store.apps, jellyfin: { apiKey: '8'.repeat(32) } },
    });
    const again = await run();
    expect(again.outcome).toBe('success');
    expect(again.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(again.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
      'recreate',
    );
    expect(ups.slice(2)).toEqual([
      'jellyfin unpublished, setup open',
      'all published, setup done',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
  });

  it('keeps an app it cannot reach on the wiring network unpublished, and stores no key', async () => {
    // No address for Jellyfin's container: the setup can't ask it anything.
    const { home, ups, run } = await setUpStack({ addresses: {} });
    const result = await run();
    expect(result.outcome).toBe('failed');
    // The wire step runs past it, skipping the app whose setup failed (spec §5.1).
    expect(result.actions.slice(-4).map((a) => [a.step, a.resource, a.result])).toEqual([
      ['bootstrap', undefined, 'failed'],
      ['wire', 'jellyfin', 'skipped'],
      ['wire', undefined, 'done'],
      ['verify', undefined, 'skipped'],
    ]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin's container is not on the stack's wiring network, so Mediaplane can't reach it",
    });
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'jellyfin unpublished, setup open',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('keeps an app unpublished when it cannot say whether its setup is open, and stores no key', async () => {
    const { home, setup, ups, run } = await setUpStack();
    Object.assign(setup.state, { openFails: true, refuse: 'fake refusal' });
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics.at(-1)).toMatchObject({ code: 'apply.bootstrap-failed' });
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'jellyfin unpublished, setup open',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('asks again before it publishes: a setup that says it is done but leaves the app open stays unpublished, its key kept', async () => {
    const { home, setup, ups, run } = await setUpStack();
    setup.state.staysOpen = true;
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin's setup reported success, but the app still looks open (or can't be asked), so it stays unpublished",
    });
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'jellyfin unpublished, setup open',
    ]);
    // The app made the key, so it is kept for the next run.
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
  });

  it('keeps an app unpublished whose setup someone else finished while Mediaplane set it up, though it no longer looks open', async () => {
    const { home, setup, ups, run } = await setUpStack();
    // Open when apply started it (no setup.txt), then finished as another login before
    // the bootstrap step reached it: the shared admin's sign-in is refused.
    Object.assign(setup.state, { done: true, admin: 'someone-else', key: SET_UP_KEY });
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    // The wire step runs past it, skipping the app whose setup failed (spec §5.1).
    expect(result.actions.slice(-4).map((a) => [a.step, a.resource, a.result])).toEqual([
      ['bootstrap', undefined, 'failed'],
      ['wire', 'jellyfin', 'skipped'],
      ['wire', undefined, 'done'],
      ['verify', undefined, 'skipped'],
    ]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished: its setup was finished with another login while Mediaplane set it up. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says",
    });
    // Whatever the app says now, nothing publishes it.
    expect(ups).toEqual([
      'jellyfin unpublished, setup done',
      'jellyfin unpublished, setup done',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('says the next apply would publish a setup claimed while Mediaplane set it up, once its appdata says it is done', async () => {
    const { home, setup, ups, runtime, extra } = await setUpStack();
    Object.assign(setup.state, { done: true, admin: 'someone-else', key: SET_UP_KEY });
    // The claimant's Jellyfin writes its file as its wizard completes, after the start.
    const claiming: Runtime = {
      ...runtime,
      up: async (seconds, values, unpublished) => {
        const result = await runtime.up(seconds, values, unpublished);
        await writeFile(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
        return result;
      },
    };
    const result = await apply(options(home, claiming, extra));
    expect(result.diagnostics.at(-1)?.message).toBe(
      "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished: its setup was finished with another login while Mediaplane set it up, and the next apply would publish it. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says",
    );
    expect(ups).toEqual([
      'jellyfin unpublished, setup done',
      'jellyfin unpublished, setup done',
    ]);
  });

  it("keeps unpublished, and says not to start afresh, a set-up app whose appdata Mediaplane can't read", async () => {
    const { home, setup, ups, run } = await setUpStack();
    // Finished by hand, with no key stored, and a file Mediaplane can't read (a folder).
    await mkdir(join(home, 'appdata', 'jellyfin', 'setup.txt'), { recursive: true });
    Object.assign(setup.state, { done: true, admin: 'someone-else', key: SET_UP_KEY });
    // An admin password apply has, not one to generate: its setup signs in with it.
    await writeSecretStore(home, WITH_PASSWORD);
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished. Mediaplane can't read appdata/jellyfin/setup.txt, which says whether it is set up, so this may be a jellyfin you set up yourself: don't start it afresh. Make that file readable by Mediaplane, or set admin.username and admin.password to its login, then run apply again, as the runbook says",
    });
    expect(ups).toEqual([
      'jellyfin unpublished, setup done',
      'jellyfin unpublished, setup done',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('publishes as before a setup finished by hand before Mediaplane started it, when the shared admin is refused', async () => {
    const { home, setup, ups, run } = await setUpStack();
    // Finished by hand before this apply, as before Slice 5: its appdata says it is done.
    await mkdir(join(home, 'appdata', 'jellyfin'), { recursive: true });
    await writeFile(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
    Object.assign(setup.state, { done: true, admin: 'someone-else', key: SET_UP_KEY });
    // An admin password apply has, not one to generate: its setup signs in with it.
    await writeSecretStore(home, WITH_PASSWORD);
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin)",
    });
    // Only the start step's up, which published it: nobody can claim it.
    expect(ups).toEqual(['all published, setup done']);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it('publishes a setup Mediaplane finished and signed in to, though making its key then failed', async () => {
    const { setup, ups, run } = await setUpStack();
    setup.state.keyFails = true;
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(setup.state.admin).toBe('admin');
    expect(setup.app.requests.map((r) => `${r.method} ${r.path}`)).toContain(
      'POST /signin',
    );
    expect(result.diagnostics.at(-1)?.message).toBe(
      'the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) failed (HTTP 500): fake failure (GET /key)',
    );
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'all published, setup done',
    ]);
  });

  it('says an app it had published is published, when it still looks open after its setup', async () => {
    const { home, setup, ups, run } = await setUpStack();
    // Its appdata says the setup is done, so it starts published, but it says it is open.
    await mkdir(join(home, 'appdata', 'jellyfin'), { recursive: true });
    await writeFile(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
    setup.state.staysOpen = true;
    // An admin password apply has, not one to generate: its setup signs in with it.
    await writeSecretStore(home, WITH_PASSWORD);
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        'the first-run setup failed: jellyfin\'s setup reported success, but the app still looks open (or can\'t be asked), and it is published: stop it ("docker stop mediaplane-jellyfin-1") and see the runbook',
    });
    expect(ups).toEqual(['all published, setup open']);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
  });

  it('redacts the key the setup just made from a failure that follows it', async () => {
    const { home, setup, ups, run } = await setUpStack();
    // The re-check before publishing fails, and its answer holds the new key.
    setup.state.echoKey = true;
    const result = await run();
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin's setup reported success, but the app still looks open (or can't be asked), so it stays unpublished: jellyfin at http://jellyfin:8096 (127.0.0.1) failed (HTTP 500): fake failure with *** (GET /setup)",
    });
    const [record] = (await listRecords(home)).records;
    expect(JSON.stringify([result, record])).not.toContain(SET_UP_KEY);
    expect(ups).toEqual([
      'jellyfin unpublished, setup open',
      'jellyfin unpublished, setup done',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
  });

  it('publishes nothing, and fails the step, when joining the wiring network fails', async () => {
    let inBootstrap = false;
    const { home, setup, ups, run } = await setUpStack({
      join: () => {
        if (inBootstrap) throw new RuntimeError('fake: Docker stopped answering');
        return 'not-needed';
      },
    });
    const result = await run({
      onStep: (event) => {
        if (event.step === 'bootstrap') inBootstrap = true;
      },
    });
    expect(result.outcome).toBe('failed');
    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
      ['bootstrap', 'failed'],
      ['wire', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message: 'fake: Docker stopped answering',
    });
    // Only the start step's up, which left it unpublished.
    expect(ups).toEqual(['jellyfin unpublished, setup open']);
    expect(setup.app.requests).toEqual([]);
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
  });

  it("says why it couldn't step off the network to publish, publishes nothing, and keeps the key", async () => {
    const { home, docker, ups, runtime, extra } = await setUpStack();
    let leaves = 0;
    const failing: Runtime = {
      ...runtime,
      // The start step's leave works; the bootstrap step's does not.
      leaveWiring: () => {
        leaves += 1;
        return leaves === 1
          ? docker.leaveWiring()
          : Promise.reject(
              new RuntimeError('could not leave the wiring network fake_wiring: fake'),
            );
      },
    };
    const result = await apply(options(home, failing, extra));
    expect(result.outcome).toBe('failed');
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message: 'could not leave the wiring network fake_wiring: fake',
      hint: `Mediaplane steps off the stack's wiring network before Compose publishes the apps, and couldn't, so nothing was published; fix what the error says, then run apply again. See ${RUNBOOK}`,
    });
    // Only the start step's up: no publishing one.
    expect(ups).toEqual(['jellyfin unpublished, setup open']);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
    // A failure to publish stops the wiring, as a failure to reach the apps does.
    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
      ['bootstrap', 'failed'],
      ['wire', 'skipped'],
      ['verify', 'skipped'],
    ]);
  });

  it('stops the wiring when publishing fails after a setup failed too', async () => {
    const { home, setup, docker, runtime, extra } = await setUpStack();
    // Its setup fails, then the publishing up can't step off the network: the step's
    // failure is the one that stops the wiring, not the setup's, which wouldn't.
    setup.state.refuse = 'fake refusal';
    let leaves = 0;
    const failing: Runtime = {
      ...runtime,
      leaveWiring: () => {
        leaves += 1;
        return leaves === 1
          ? docker.leaveWiring()
          : Promise.reject(new RuntimeError('could not leave fake_wiring: fake'));
      },
    };
    const result = await apply(options(home, failing, extra));
    expect(result.outcome).toBe('failed');
    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
      ['bootstrap', 'failed'],
      ['wire', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message: 'could not leave fake_wiring: fake',
    });
  });
});

describe('apply: no sign-in with an admin password an app has never had', () => {
  /**
   * SET_UP_CATALOG, with Jellyfin's FAKE_ADMIN and a key it keeps in appdata/jellyfin/key.txt
   * (absent until a test writes it), and Sonarr's FAKE_LOGIN, wired past Jellyfin.
   */
  const BOTH: Catalog = SET_UP_CATALOG.map((def) => {
    if (def.id === 'sonarr') {
      return {
        ...def,
        api: FIXTURE_API,
        integration: { after: [], resources: [FAKE_LOGIN] },
      };
    }
    if (def.id === 'jellyfin') {
      return {
        ...def,
        integration: { after: [], resources: [FAKE_ADMIN] },
        keyFiles: {
          apiKey: { path: 'key.txt', read: (text: string) => /^(\w+)$/m.exec(text)?.[1] },
        },
      };
    }
    return def;
  });
  /** Another random source: what apply generates anew differs from the first apply's. */
  const other = (size: number) => Buffer.alloc(size, 0xcd);
  const REBUILD = runbookUrl('rebuilding-a-host');
  /** What plan says of a Jellyfin held back, after a lost store. */
  const HELD = {
    severity: 'warning',
    code: 'bootstrap.needs-password',
    message:
      "jellyfin takes no key Mediaplane holds, and only its first-run setup can find one, by signing in as the shared admin; but jellyfin has never had the admin password Mediaplane gives the apps, so apply doesn't sign in to it, and leaves it unwired",
    hint: `set admin.password to a file holding the password jellyfin's admin has, or make an API key named Mediaplane in jellyfin, then run apply again; see ${REBUILD}`,
  };
  /** The wire step's skip of a held app's resource. */
  const SKIPPED = {
    step: 'wire',
    resource: 'jellyfin.admin',
    result: 'skipped',
    detail:
      "jellyfin's first-run setup is held: the app it signs in to has never had the admin password",
  };

  /** FAKE_SETUP's Jellyfin and a fake Sonarr, each on its own fake server. */
  async function twoApps(catalog: Catalog = BOTH) {
    const home = await makeHome();
    const setup = await fakeSetUpApp(home);
    const sonarr = await fakeSonarr();
    const docker = fakeDocker(home, {
      addresses: { ...setup.addresses, ...sonarr.addresses },
    });
    const wiring: WiringSeams = {
      endpoint: (app) => ({
        host: '127.0.0.1',
        port: app.def.id === 'jellyfin' ? setup.app.port : sonarr.app.port,
      }),
      retry: { deadlineMs: 0 },
    };
    /** What Docker apply and plan use from now on: `docker`, unless a test wraps it. */
    let runtime: Runtime = docker;
    const useRuntime = (next: Runtime) => {
      runtime = next;
    };
    const run = (more: Partial<ApplyOptions> = {}) =>
      apply(options(home, runtime, { catalog, wiring, ...more }));
    const planned = (more: Partial<ApplyOptions> = {}) =>
      plan(options(home, runtime, { catalog, wiring, ...more }));
    const signIns = () => setup.app.requests.filter((r) => r.path === '/signin').length;
    return { home, setup, sonarr, docker, useRuntime, run, planned, signIns };
  }

  /** A stack applied once, then its store lost, and applied again: Jellyfin held. */
  async function heldAfterLostStore() {
    const stack = await twoApps();
    expect((await stack.run()).outcome).toBe('success');
    const old = stack.setup.state.password;
    expect(old !== '', 'Jellyfin has an admin password').toBe(true);
    await rm(join(stack.home, SECRETS_PATH));
    const signedIn = stack.signIns();
    const shown = await stack.planned({ random: other });
    const result = await stack.run({ random: other });
    return { ...stack, old, signedIn, shown, result };
  }

  it('holds back the sign-in of an app whose key went with the store, with a warning, and wires the rest', async () => {
    const { home, setup, sonarr, old, shown, result } = await heldAfterLostStore();
    expect(shown.ok).toBe(true);
    expect(shown.secrets.generate).toContain('admin.password');
    // Jellyfin's setup is done: only a sign-in, with a password it never had, is left.
    expect(shown.bootstrap).toEqual([]);
    expect(shown.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(shown.diagnostics).toContainEqual(HELD);
    expect(shown.wiring).toContainEqual({
      resource: 'jellyfin.admin',
      action: 'after-start',
    });
    expect(result.actions.find((a) => a.resource === 'jellyfin.admin')).toEqual(SKIPPED);
    expect(result.actions.find((a) => a.resource === 'sonarr.login')).toMatchObject({
      result: 'done',
      detail: 'updated password',
    });
    const store = await readSecretStore(home);
    const password = store.shared?.adminPassword ?? '';
    expect(password !== '' && password !== old, 'a new password was saved').toBe(true);
    expect(sonarr.state.password === password, 'Sonarr has the new password').toBe(true);
    // Jellyfin is left as it is, with the password it had: verify says so.
    expect(setup.state.password === old, 'Jellyfin keeps its password').toBe(true);
    expect(setup.state.refusedSignIns).toBe(0);
    expect(result.outcome).toBe('failed');
    expect(result.actions.at(-1)).toMatchObject({ step: 'verify', result: 'failed' });
    // The apps that never had it, by name only, in the write that saved it.
    const saved = JSON.parse(await readFile(join(home, SECRETS_PATH), 'utf8')) as {
      shared: Record<string, unknown>;
    };
    expect(Object.keys(saved.shared).sort()).toEqual([
      'adminPassword',
      'adminPasswordNotIn',
    ]);
    expect(saved.shared.adminPasswordNotIn).toEqual(['jellyfin']);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it('holds it back on every later run, never signing in with the stored password', async () => {
    const { home, setup, planned, run, signIns, signedIn } = await heldAfterLostStore();
    const again = await planned();
    expect(again.ok).toBe(true);
    expect(again.bootstrap).toEqual([]);
    expect(again.diagnostics).toContainEqual(HELD);
    const later = await run();
    expect(later.actions.find((a) => a.resource === 'jellyfin.admin')).toEqual(SKIPPED);
    expect(setup.state.refusedSignIns).toBe(0);
    expect(signIns()).toBe(signedIn);
    expect((await readSecretStore(home)).shared?.adminPasswordNotIn).toEqual([
      'jellyfin',
    ]);
  });

  it('sets the password in it through its key once it is found, and forgets it then', async () => {
    const { home, setup, planned, run } = await heldAfterLostStore();
    // An API key named Mediaplane made in the app, which the next plan recovers.
    await writeFile(join(home, 'appdata', 'jellyfin', 'key.txt'), `${setup.state.key}\n`);
    const shown = await planned();
    expect(shown.secrets.recover).toEqual(['jellyfin.apiKey']);
    expect(shown.bootstrap).toEqual([]);
    expect(shown.diagnostics.map((d) => d.code)).not.toContain(
      'bootstrap.needs-password',
    );
    // Not checked by a sign-in: the app has never had it.
    expect(shown.wiring).toContainEqual({
      resource: 'jellyfin.admin',
      action: 'update',
      changes: ['password'],
    });
    expect(shown.checks).toContainEqual({
      resource: 'jellyfin.admin',
      secret: 'password',
      verdict: 'unchecked',
      reason: 'the app has never had it: apply sets it',
    });
    const fixed = await run();
    expect(fixed.outcome).toBe('success');
    const store = await readSecretStore(home);
    expect(setup.state.password === store.shared?.adminPassword).toBe(true);
    expect(store.shared?.adminPasswordNotIn).toBeUndefined();
    expect(setup.state.refusedSignIns).toBe(0);
    expect((await run()).outcome).toBe('no-changes');
  });

  it('forgets it once its setup signs in, as when it starts afresh', async () => {
    const { home, setup, run } = await heldAfterLostStore();
    // Its appdata moved aside: its startup wizard is open again.
    await rm(join(home, 'appdata', 'jellyfin', 'setup.txt'));
    Object.assign(setup.state, { done: false, key: '', admin: '', password: '' });
    const fresh = await run();
    expect(fresh.outcome).toBe('success');
    expect(fresh.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
    const store = await readSecretStore(home);
    expect(setup.state.password === store.shared?.adminPassword).toBe(true);
    expect(store.shared?.adminPasswordNotIn).toBeUndefined();
    expect((await run()).outcome).toBe('no-changes');
  });

  it('forgets every app once admin.password names a file of your own', async () => {
    const { home, setup, old, run } = await heldAfterLostStore();
    // Its key found in its appdata: no setup runs, and nothing else takes it off the list.
    await writeFile(join(home, 'appdata', 'jellyfin', 'key.txt'), `${setup.state.key}\n`);
    await writeFile(join(home, 'secrets', 'admin'), `${old}\n`);
    await writeFile(
      join(home, 'stack.yaml'),
      STACK.replace('apps:', 'admin: { password: { file: secrets/admin } }\napps:'),
    );
    const yours = await run();
    expect(yours.outcome).toBe('success');
    expect(yours.plan.bootstrap).toEqual([]);
    expect(yours.actions.map((a) => a.step)).not.toContain('bootstrap');
    expect((await readSecretStore(home)).shared?.adminPasswordNotIn).toBeUndefined();
    expect(setup.state.refusedSignIns).toBe(0);
  });

  it('rotates past an app that never had the password, which stays held', async () => {
    const { home, planned, run } = await heldAfterLostStore();
    const before = (await readSecretStore(home)).shared?.adminPassword ?? '';
    const shown = await planned({ rotate: ['admin.password'] });
    expect(shown.ok).toBe(true);
    expect(shown.diagnostics).toContainEqual(HELD);
    const rotated = await run({ rotate: ['admin.password'] });
    expect(rotated.actions[0]).toMatchObject({
      step: 'keys',
      detail: 'generated admin.password',
    });
    const store = await readSecretStore(home);
    expect((store.shared?.adminPassword ?? '') !== before).toBe(true);
    expect(store.shared?.adminPasswordNotIn).toEqual(['jellyfin']);
  });

  it('rotates a store that holds no password as a lost one: a warning, and what is lost said', async () => {
    const { home, run, planned } = await twoApps();
    expect((await run()).outcome).toBe('success');
    await rm(join(home, SECRETS_PATH));
    const lost = await planned({ random: other });
    const rotated = await planned({ random: other, rotate: ['admin.password'] });
    expect(rotated.ok).toBe(true);
    expect(rotated.diagnostics).toContainEqual(HELD);
    expect(rotated.diagnostics).toEqual(lost.diagnostics);
    // With keys recovered from the apps' appdata, it says the generated one went.
    const keyed = await makeHome();
    const docker = fakeDocker(keyed);
    expect((await apply(options(keyed, docker, { catalog: WITH_KEYS }))).outcome).toBe(
      'success',
    );
    await rm(join(keyed, SECRETS_PATH));
    const recovered = await plan(
      options(keyed, docker, { catalog: WITH_KEYS, rotate: ['admin.password'] }),
    );
    expect(recovered.secrets.recover).toEqual(['sonarr.apiKey']);
    expect(recovered.diagnostics.map((d) => d.code)).toContain(
      'secrets.admin-password-lost',
    );
  });

  it('refuses to rotate the password while an app that has it can only be signed in to', async () => {
    const { home, setup, sonarr, run, planned, signIns } = await twoApps();
    expect((await run()).outcome).toBe('success');
    const before = (await readSecretStore(home)).shared?.adminPassword ?? '';
    // Jellyfin's key deleted by hand, and another made: it refuses the stored one.
    setup.state.key = '7'.repeat(32);
    const signedIn = signIns();
    // Without --rotate, its setup signs in to make the key again, with the password it has.
    expect((await planned()).bootstrap).toEqual([
      { app: 'jellyfin', unpublished: false },
    ]);
    const shown = await planned({ rotate: ['admin.password'] });
    expect(shown.ok).toBe(false);
    expect(shown.diagnostics).toContainEqual({
      severity: 'error',
      code: 'bootstrap.needs-password',
      message:
        'jellyfin takes no key Mediaplane holds, and only its first-run setup can find one, by signing in as the shared admin with the admin password it has: rotating that password now would leave jellyfin with one Mediaplane no longer holds',
      hint: `run apply without --rotate first, which finds jellyfin's key, then rotate it; see ${REBUILD}`,
    });
    const rotated = await run({ random: other, rotate: ['admin.password'] });
    expect(rotated.outcome).toBe('invalid');
    expect(rotated.actions).toEqual([]);
    // Nothing changed: no new password saved, nor set in any app.
    expect((await readSecretStore(home)).shared?.adminPassword === before).toBe(true);
    expect(sonarr.state.password === before, 'Sonarr keeps its password').toBe(true);
    expect(setup.state.password === before, 'Jellyfin keeps its password').toBe(true);
    expect(signIns()).toBe(signedIn);
  });

  it('says once why an app is left unwired when its key file holds none', async () => {
    const { home, run, planned } = await twoApps();
    expect((await run()).outcome).toBe('success');
    await writeFile(join(home, 'appdata', 'jellyfin', 'key.txt'), '\n');
    await rm(join(home, SECRETS_PATH));
    const shown = await planned({ random: other });
    expect(shown.ok).toBe(true);
    expect(shown.bootstrap).toEqual([]);
    expect(
      shown.diagnostics
        .filter((d) => d.message.includes('jellyfin'))
        .map((d) => [d.severity, d.code]),
    ).toEqual([['warning', 'keys.unrecoverable']]);
  });

  it('sets nothing up for an app whose key is recovered from its appdata, and holds none', async () => {
    const { home, setup, run, planned } = await twoApps();
    expect((await run()).outcome).toBe('success');
    await writeFile(join(home, 'appdata', 'jellyfin', 'key.txt'), `${SET_UP_KEY}\n`);
    await rm(join(home, SECRETS_PATH));
    const shown = await planned({ random: other });
    expect(shown.secrets.recover).toEqual(['jellyfin.apiKey']);
    expect(shown.bootstrap).toEqual([]);
    expect(shown.diagnostics.map((d) => d.code)).not.toContain(
      'bootstrap.needs-password',
    );
    const rebuilt = await run({ random: other });
    expect(rebuilt.outcome).toBe('success');
    expect(rebuilt.actions.map((a) => a.step)).not.toContain('bootstrap');
    // The new password, set through its key, and nothing held.
    const store = await readSecretStore(home);
    expect(setup.state.password === store.shared?.adminPassword).toBe(true);
    expect(store.shared?.adminPasswordNotIn).toBeUndefined();
    // Set through the apps' keys before any sign-in with it: none they refuse.
    expect(setup.state.refusedSignIns).toBe(0);
    expect(rebuilt.actions.find((a) => a.resource === 'jellyfin.admin')).toMatchObject({
      result: 'done',
      detail: 'updated password',
    });
    expect((await run({ random: other })).outcome).toBe('no-changes');
  });

  it('signs in to no recreated app with the new password before its key has set it there', async () => {
    const { home, setup, sonarr, docker, useRuntime, run } = await twoApps();
    expect((await run()).outcome).toBe('success');
    await writeFile(join(home, 'appdata', 'jellyfin', 'key.txt'), `${SET_UP_KEY}\n`);
    await rm(join(home, SECRETS_PATH));
    // Stopped: the plan asks it nothing, and the wire step asks it once up starts it.
    useRuntime(stoppedUntilUp(docker, 'jellyfin'));
    const logins = () =>
      sonarr.app.requests
        .filter((r) => r.path === '/login')
        .map((r) => new URLSearchParams(r.body).get('password'));
    const before = logins().length;
    const rebuilt = await run({ random: other });
    expect(rebuilt.plan.wiring).toContainEqual({
      resource: 'jellyfin.admin',
      action: 'after-start',
    });
    expect(rebuilt.outcome).toBe('success');
    expect(setup.state.refusedSignIns).toBe(0);
    const password = (await readSecretStore(home)).shared?.adminPassword ?? '';
    // Sonarr is asked with the new password only once it has it: by verify's plan.
    expect(
      logins()
        .slice(before)
        .every((sent) => sent === password),
    ).toBe(true);
  });

  it('starts a held app whose setup file it cannot read without its ports', async () => {
    const { home, docker, run } = await twoApps();
    expect((await run()).outcome).toBe('success');
    await rm(join(home, SECRETS_PATH));
    await rm(join(home, 'appdata', 'jellyfin', 'setup.txt'));
    await mkdir(join(home, 'appdata', 'jellyfin', 'setup.txt'));
    const calls = docker.calls.length;
    const held = await run({ random: other });
    expect(held.plan.bootstrap).toEqual([]);
    expect(held.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
      'recreate',
    );
    expect(docker.calls.slice(calls).filter((c) => c.startsWith('up'))).toEqual([
      'up unpublished jellyfin',
    ]);
  });

  /** The store's shared.adminPasswordNotIn as it is on disk now, read at once. */
  const listedIn = (home: string) =>
    (
      JSON.parse(readFileSync(join(home, SECRETS_PATH), 'utf8')) as {
        shared?: { adminPasswordNotIn?: string[] };
      }
    ).shared?.adminPasswordNotIn;

  /** At the end of each step that ran, what the store listed then, as "<step>: <apps>". */
  function listedAtEachStep(home: string): {
    seen: string[];
    onStep: (event: StepEvent) => void;
  } {
    const seen: string[] = [];
    return {
      seen,
      onStep: (event) => {
        if (event.phase !== 'end' || event.action.resource !== undefined) return;
        if (event.action.result !== 'done') return;
        seen.push(`${event.step}: ${(listedIn(home) ?? []).join(' ') || 'none'}`);
      },
    };
  }

  it('lists every app that holds a new password in the write that saves it, and each leaves it as the run gives it the password', async () => {
    const { home, setup, sonarr, run } = await twoApps();
    const { seen, onStep } = listedAtEachStep(home);
    const first = await run({ onStep });
    expect(first.outcome).toBe('success');
    // A first install: Jellyfin's setup makes its admin with it; Sonarr's is set through
    // its key. The list ends empty, and the next apply changes nothing.
    expect(seen).toEqual([
      'keys: jellyfin sonarr',
      'files: jellyfin sonarr',
      'pull: jellyfin sonarr',
      'ownership: jellyfin sonarr',
      'start: jellyfin sonarr',
      'bootstrap: sonarr',
      'wire: none',
      'verify: none',
    ]);
    expect(first.actions.find((a) => a.resource === 'sonarr.login')?.detail).toBe(
      'created',
    );
    // Its wizard made the admin with the password: found as wanted, checked by sign-in.
    expect(first.actions.find((a) => a.resource === 'jellyfin.admin')?.detail).toBe(
      'adopted',
    );
    expect(setup.state.refusedSignIns).toBe(0);
    const password = (await readSecretStore(home)).shared?.adminPassword;
    expect(sonarr.state.password === password, 'Sonarr has the password').toBe(true);
    expect((await run()).outcome).toBe('no-changes');
  });

  it('leaves listed each app a start that fails never reached: no later plan signs in to it with the new password', async () => {
    const { home, setup, sonarr, docker, useRuntime, run, planned, signIns } =
      await twoApps();
    expect((await run()).outcome).toBe('success');
    const logins = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
    // Saved by the keys step, then the start fails: a health check timing out.
    useRuntime({
      ...docker,
      up: () => Promise.resolve({ ok: false, error: 'fake health timeout' }),
    });
    const rotated = await run({ random: other, rotate: ['admin.password'] });
    expect(rotated.outcome).toBe('failed');
    expect(rotated.actions.map((a) => [a.step, a.result])).toContainEqual([
      'start',
      'failed',
    ]);
    expect(listedIn(home)).toEqual(['jellyfin', 'sonarr']);
    useRuntime(docker);
    const before = [logins(), signIns()];
    const shown = await planned();
    expect(shown.ok).toBe(true);
    // Neither is asked with it: each is set through its key.
    expect([logins(), signIns()]).toEqual(before);
    for (const resource of ['jellyfin.admin', 'sonarr.login']) {
      expect(shown.wiring).toContainEqual({
        resource,
        action: 'update',
        changes: ['password'],
      });
    }
    const fixed = await run();
    expect(fixed.outcome).toBe('success');
    expect(listedIn(home)).toBeUndefined();
    const password = (await readSecretStore(home)).shared?.adminPassword;
    expect(sonarr.state.password === password, 'Sonarr has the new password').toBe(true);
    expect(setup.state.password === password, 'Jellyfin has the new password').toBe(true);
    expect(setup.state.refusedSignIns).toBe(0);
    expect((await run()).outcome).toBe('no-changes');
  });

  it("leaves listed an app whose admin couldn't be set in the wire step, and asks it with the password on no later run until it is", async () => {
    const { home, setup, sonarr, run, planned } = await twoApps();
    expect((await run()).outcome).toBe('success');
    const logins = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
    // Sonarr stops answering once the wire step starts: its update fails.
    const onStep = (event: StepEvent) => {
      if (event.step === 'wire' && event.phase === 'start') sonarr.state.up = false;
    };
    const rotated = await run({ random: other, rotate: ['admin.password'], onStep });
    expect(rotated.outcome).toBe('failed');
    expect(rotated.actions.find((a) => a.resource === 'sonarr.login')?.result).toBe(
      'failed',
    );
    expect(listedIn(home)).toEqual(['sonarr']);
    sonarr.state.up = true;
    const before = logins();
    expect((await planned()).wiring).toContainEqual({
      resource: 'sonarr.login',
      action: 'update',
      changes: ['password'],
    });
    expect(logins()).toBe(before);
    expect((await run()).outcome).toBe('success');
    expect(listedIn(home)).toBeUndefined();
    expect(setup.state.refusedSignIns).toBe(0);
  });

  it('takes an app as given the password by a pre-start file only when the catalog says the file holds it', async () => {
    // Sonarr's file gives its login, as qBittorrent's conf does: the fake takes it as it
    // starts.
    const given = (gives: boolean): Catalog =>
      BOTH.map((def) =>
        def.id === 'sonarr'
          ? {
              ...def,
              configFiles: (ctx) => [
                {
                  path: 'login.txt',
                  content: `${ctx.admin.username}:${ctx.admin.password}\n`,
                  seeded: /:/,
                  ...(gives ? { givesAdminPassword: true } : {}),
                },
              ],
            }
          : def,
      );
    for (const gives of [true, false]) {
      const { home, sonarr, docker, useRuntime, run } = await twoApps(given(gives));
      useRuntime({
        ...docker,
        up: async (seconds, values, unpublished, env) => {
          const [user = '', password = ''] = (
            await readFile(join(home, 'appdata', 'sonarr', 'login.txt'), 'utf8')
          )
            .trim()
            .split(':');
          Object.assign(sonarr.state, { user, password });
          return docker.up(seconds, values, unpublished, env);
        },
      });
      const { seen, onStep } = listedAtEachStep(home);
      const first = await run({ onStep });
      expect(first.outcome).toBe('success');
      expect(seen.find((s) => s.startsWith('start:'))).toBe(
        gives ? 'start: jellyfin' : 'start: jellyfin sonarr',
      );
      // Given it by its file, it is checked by a sign-in; else it is set through its key.
      expect(first.actions.find((a) => a.resource === 'sonarr.login')?.detail).toBe(
        gives ? 'adopted' : 'updated password',
      );
      expect(listedIn(home)).toBeUndefined();
    }
  });
});

describe('apply: a setup that signs in through an app that is held', () => {
  /** SIGN_IN_CATALOG, with Jellyfin's key in appdata/jellyfin/key.txt (none written). */
  const CATALOG: Catalog = SIGN_IN_CATALOG.map((def) =>
    def.id === 'jellyfin'
      ? {
          ...def,
          keyFiles: {
            apiKey: {
              path: 'key.txt',
              read: (text: string) => /^(\w+)$/m.exec(text)?.[1],
            },
          },
        }
      : def,
  );
  const other = (size: number) => Buffer.alloc(size, 0xcd);

  it('holds it too, starting it without its ports, and sends Jellyfin no sign-in from it', async () => {
    const home = await makeHome();
    const setup = await fakeSetUpApp(home);
    const docker = fakeDocker(home, { addresses: setup.addresses });
    const run = (more: Partial<ApplyOptions> = {}) =>
      apply(options(home, docker, { catalog: CATALOG, wiring: setup.seams, ...more }));
    expect((await run()).outcome).toBe('success');
    // The store lost, and Sonarr's sign-in setup open again (its appdata emptied).
    await rm(join(home, SECRETS_PATH));
    await rm(join(home, 'appdata', 'sonarr', 'signed-in.txt'));
    Object.assign(setup.signIn, { done: false, owner: undefined });
    const signedInBefore = setup.signIn.signedIn.length;
    const shown = await plan(
      options(home, docker, { catalog: CATALOG, wiring: setup.seams, random: other }),
    );
    expect(shown.ok).toBe(true);
    expect(shown.bootstrap).toEqual([]);
    expect(shown.diagnostics).toContainEqual({
      severity: 'warning',
      code: 'bootstrap.needs-password',
      message:
        "sonarr's first-run setup signs in through jellyfin, whose own is held: it is held too, and waits on jellyfin's admin password",
      hint: `once jellyfin has the admin password Mediaplane gives the apps, apply sets sonarr up; see ${runbookUrl('rebuilding-a-host')}`,
    });
    const calls = docker.calls.length;
    const result = await run({ random: other });
    expect(setup.signIn.signedIn.length).toBe(signedInBefore);
    expect(setup.state.refusedSignIns).toBe(0);
    expect(result.actions.find((a) => a.resource === 'sonarr')).toEqual({
      step: 'wire',
      resource: 'sonarr',
      result: 'skipped',
      detail:
        "sonarr's first-run setup is held: the app it signs in to has never had the admin password",
    });
    // Its setup open, it never has its ports; only Jellyfin is listed as lacking it.
    expect(docker.calls.slice(calls).filter((c) => c.startsWith('up'))).toEqual([
      'up unpublished sonarr',
    ]);
    expect((await readSecretStore(home)).shared?.adminPasswordNotIn).toEqual([
      'jellyfin',
    ]);
  });

  /** CATALOG, with Jellyfin's FAKE_ADMIN, which sets the password through its key. */
  const WITH_ADMIN: Catalog = CATALOG.map((def) =>
    def.id === 'jellyfin'
      ? { ...def, integration: { after: [], resources: [FAKE_ADMIN] } }
      : def,
  );

  async function signInStack(catalog: Catalog) {
    const home = await makeHome();
    const setup = await fakeSetUpApp(home);
    const docker = fakeDocker(home, { addresses: setup.addresses });
    const run = (more: Partial<ApplyOptions> = {}) =>
      apply(options(home, docker, { catalog, wiring: setup.seams, ...more }));
    const planned = (more: Partial<ApplyOptions> = {}) =>
      plan(options(home, docker, { catalog, wiring: setup.seams, ...more }));
    expect((await run()).outcome).toBe('success');
    return { home, setup, docker, run, planned };
  }

  it('sets up, publishes and records one whose setup is done: it signs in through nothing', async () => {
    const { home, setup, docker, run, planned } = await signInStack(CATALOG);
    // The store lost: Jellyfin held, and Sonarr's record that its setup is Mediaplane's
    // gone, though Sonarr's appdata says it is done.
    await rm(join(home, SECRETS_PATH));
    const signedInBefore = setup.signIn.signedIn.length;
    const shown = await planned({ random: other });
    expect(shown.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
    expect(
      shown.diagnostics.filter((d) => d.message.startsWith("sonarr's first-run setup")),
    ).toEqual([]);
    const calls = docker.calls.length;
    const result = await run({ random: other });
    expect(setup.signIn.signedIn.length).toBe(signedInBefore);
    expect(setup.state.refusedSignIns).toBe(0);
    expect(result.actions.find((a) => a.step === 'bootstrap')).toMatchObject({
      result: 'done',
      detail: 'set up sonarr; published sonarr',
    });
    // Checked unpublished, then published: from now on it keeps its ports.
    expect(docker.calls.slice(calls).filter((c) => c.startsWith('up'))).toEqual([
      'up unpublished sonarr',
      'up',
    ]);
    expect((await readSecretStore(home)).setUp).toEqual(['sonarr']);
    const next = await planned({ random: other });
    expect(next.bootstrap).toEqual([]);
    expect(next.containers.find((c) => c.service === 'sonarr')?.action).toBe('unchanged');
  });

  it("holds an open one while the app it signs in through hasn't the password yet, and sets it up once that app has it", async () => {
    const { home, setup, run } = await signInStack(WITH_ADMIN);
    // The store lost, Jellyfin's key found in its appdata, and Sonarr's setup open again.
    await rm(join(home, SECRETS_PATH));
    await writeFile(join(home, 'appdata', 'jellyfin', 'key.txt'), `${setup.state.key}\n`);
    await rm(join(home, 'appdata', 'sonarr', 'signed-in.txt'));
    Object.assign(setup.signIn, { done: false, owner: undefined });
    const signedInBefore = setup.signIn.signedIn.length;
    const rebuilt = await run({ random: other });
    expect(rebuilt.plan.secrets.recover).toEqual(['jellyfin.apiKey']);
    expect(rebuilt.plan.bootstrap).toEqual([]);
    expect(rebuilt.plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'bootstrap.needs-password',
        message:
          "sonarr's first-run setup signs in through jellyfin, which doesn't have the admin password Mediaplane gives the apps yet: it is held, and waits until apply has set it in jellyfin through jellyfin's key",
      }),
    );
    // No sign-in through Jellyfin before the wire step set its password.
    expect(setup.signIn.signedIn.length).toBe(signedInBefore);
    expect(setup.state.refusedSignIns).toBe(0);
    expect(rebuilt.actions.find((a) => a.resource === 'jellyfin.admin')).toMatchObject({
      result: 'done',
      detail: 'updated password',
    });
    expect((await readSecretStore(home)).shared?.adminPasswordNotIn).toBeUndefined();
    const next = await run({ random: other });
    expect(next.plan.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
    expect(next.outcome).toBe('success');
    expect(setup.state.refusedSignIns).toBe(0);
  });
});

describe('apply: a first-run setup that makes no key, after another', () => {
  /** What a claimed setup that makes no key says it is, and what to do. */
  const CLAIMED =
    "sonarr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. First: sign in to mediaplane-sonarr-1 as the shared admin, then run apply again. Last: start it afresh";
  /**
   * The stack with Jellyfin's FAKE_SETUP and Sonarr's FAKE_SIGN_IN, after it, and a Docker
   * that notes, at each up, which apps it starts without their ports and where each setup
   * stands then.
   */
  async function signInStack(catalog: Catalog = SIGN_IN_CATALOG) {
    const home = await makeHome();
    const setup = await fakeSetUpApp(home);
    const docker = fakeDocker(home, { addresses: setup.addresses });
    const ups: string[] = [];
    const runtime: Runtime = {
      ...docker,
      up: (seconds, values, unpublished = []) => {
        const shown =
          unpublished.length === 0
            ? 'all published'
            : `${unpublished.join(' ')} unpublished`;
        const jellyfin = setup.state.done ? 'done' : 'open';
        const sonarr = setup.signIn.done ? 'done' : 'open';
        ups.push(`${shown}; jellyfin ${jellyfin}, sonarr ${sonarr}`);
        return docker.up(seconds, values, unpublished);
      },
    };
    const run = () => apply(options(home, runtime, { catalog, wiring: setup.seams }));
    return { home, setup, ups, run };
  }

  it('sets it up after the app it signs in through, keeps no key for it, signs out, and publishes both', async () => {
    const { home, setup, ups, run } = await signInStack();
    const first = await run();
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(first.outcome).toBe('success');
    expect(first.plan.bootstrap).toEqual([
      { app: 'jellyfin', unpublished: true },
      { app: 'sonarr', unpublished: true },
    ]);
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
      'all published; jellyfin done, sonarr done',
    ]);
    expect(first.actions.find((a) => a.step === 'start')?.detail).toBe(
      'every app is running and healthy; started jellyfin, sonarr without their ports, to set them up first',
    );
    expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
      'set up jellyfin, sonarr and saved jellyfin.apiKey; published jellyfin, sonarr',
    );
    // As the shared admin, in the stack it was given, and signed out of again.
    expect(setup.signIn.signedIn).toEqual([{ user: 'admin', through: 'jellyfin' }]);
    expect(setup.signIn.sessions).toEqual([]);
    // Sonarr's key is Mediaplane's own, as generated: the setup made none.
    expect((await readSecretStore(home)).apps.sonarr).toEqual({
      apiKey: 'ab'.repeat(16),
    });
    expect((await run()).outcome).toBe('no-changes');
  });

  it("wires the rest past a setup that failed, skipping that app's resources, and verifies nothing", async () => {
    const { setup, run } = await signInStack();
    // Someone signed in to Sonarr first: its setup fails, as claimed.
    setup.signIn.refuse = true;
    setup.signIn.claimant = true;
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(
      failed.actions.slice(-4).map((a) => [a.step, a.resource ?? '', a.result]),
    ).toEqual([
      ['bootstrap', '', 'failed'],
      ['wire', 'sonarr', 'skipped'],
      ['wire', '', 'done'],
      ['verify', '', 'skipped'],
    ]);
    // The wire step asked Jellyfin, set up, whether it takes its key: the rest is wired.
    expect(
      setup.app.requests.some(
        (r) => r.path === '/check' && (r.headers.host ?? '').startsWith('jellyfin:'),
      ),
    ).toBe(true);
    expect(failed.actions.find((a) => a.resource === 'sonarr')?.detail).toBe(
      "sonarr's first-run setup failed",
    );
    expect(failed.diagnostics.filter((d) => d.severity === 'error')).toEqual([
      expect.objectContaining({ code: 'apply.bootstrap-failed' }),
    ]);
  });

  it('sets the apps up in the order of their integrations, not of their names', async () => {
    // Jellyfin after Sonarr, here: Sonarr signs in first.
    const catalog = SIGN_IN_CATALOG.map((def) => {
      if (def.id === 'jellyfin') {
        return { ...def, integration: { after: ['sonarr'], resources: [] } };
      }
      if (def.id === 'sonarr')
        return { ...def, integration: { after: [], resources: [] } };
      return def;
    });
    const { setup, run } = await signInStack(catalog);
    expect((await run()).outcome).toBe('success');
    const posts = setup.app.requests
      .filter((r) => r.method === 'POST')
      .map((r) => r.path);
    expect(posts.slice(0, 2)).toEqual(['/sign-in', '/sign-out']);
    expect(posts).toContain('/setup');
  });

  it('leaves one whose setup waits unpublished, wires the rest without it, and fails only at verify, which says what is left', async () => {
    const { home, setup, ups, run } = await signInStack();
    setup.signIn.refuse = true;
    const waited = await run();
    expect(waited.outcome).toBe('failed');
    expect(waited.actions.map((a) => [a.step, a.resource ?? '', a.result])).toEqual([
      ['keys', '', 'done'],
      ['files', '', 'done'],
      ['pull', '', 'done'],
      ['ownership', '', 'done'],
      ['start', '', 'done'],
      ['bootstrap', '', 'done'],
      ['wire', 'sonarr', 'skipped'],
      ['wire', '', 'done'],
      ['verify', '', 'failed'],
    ]);
    const reason =
      "sonarr at http://sonarr:8989 (127.0.0.1) can't sign in yet: Jellyfin refused the shared admin (POST /sign-in)";
    expect(waited.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
      `set up jellyfin and saved jellyfin.apiKey; published jellyfin; sonarr waits: ${reason}`,
    );
    expect(waited.actions.find((a) => a.resource === 'sonarr')?.detail).toBe(
      "sonarr's first-run setup waits",
    );
    expect(waited.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'bootstrap.waiting',
        message: reason,
        hint: `the rest of the stack is wired without sonarr, and the next apply sets it up; if it still waits, see ${RUNBOOK}`,
      }),
    );
    expect(waited.diagnostics.at(-1)?.message).toContain('sonarr (first-run setup)');
    // Jellyfin was published once set up; Sonarr, whose setup is still open, never was.
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
      'sonarr unpublished; jellyfin done, sonarr open',
    ]);
    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
    // Once the sign-in works, the next apply sets it up and publishes it.
    setup.signIn.refuse = false;
    const then = await run();
    expect(then.outcome).toBe('success');
    expect(then.plan.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
    expect(ups.slice(2)).toEqual([
      'sonarr unpublished; jellyfin done, sonarr open',
      'all published; jellyfin done, sonarr done',
    ]);
  });

  it('fails one whose setup waits as a claimed one, unpublished, when someone else finished it meanwhile, and again on the next apply, until it is shown to be its own', async () => {
    const { home, setup, ups, run } = await signInStack();
    // Refused because someone inside the stack signed in first: the setup now looks done.
    setup.signIn.refuse = true;
    setup.signIn.claimant = true;
    const waited = await run();
    expect(waited.outcome).toBe('failed');
    expect(waited.diagnostics.some((d) => d.code === 'bootstrap.waiting')).toBe(false);
    expect(waited.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message: `the first-run setup failed: sonarr at http://sonarr:8989 (127.0.0.1) can't sign in yet: Jellyfin refused the shared admin (POST /sign-in); ${CLAIMED}`,
    });
    expect(waited.actions.find((a) => a.step === 'wire')?.result).toBe('skipped');
    expect(setup.signIn.done).toBe(true);
    // Both ups keep it unpublished: Jellyfin was published once set up, Sonarr never.
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
      'sonarr unpublished; jellyfin done, sonarr done',
    ]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    // Its file now says it is done, but Mediaplane doesn't know the setup is its own: the
    // next apply starts it unpublished again, asks who signed in, and refuses it.
    setup.signIn.refuse = false;
    for (const attempt of [2, 3]) {
      const next = await run();
      expect(next.outcome, `apply ${String(attempt)}`).toBe('failed');
      expect(next.plan.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
      expect(next.diagnostics.at(-1)).toMatchObject({
        code: 'apply.bootstrap-failed',
        message: `the first-run setup failed: sonarr at http://sonarr:8989 (127.0.0.1) was set up with another login (GET /signed-in/own); ${CLAIMED}`,
      });
      expect(next.actions.find((a) => a.step === 'wire')?.result).toBe('skipped');
      expect(ups.at(-1)).toBe('sonarr unpublished; jellyfin done, sonarr done');
    }
    // It never signed in, and nothing was recorded.
    expect(setup.app.requests.filter((r) => r.path === '/sign-in')).toHaveLength(1);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it('checks, records and publishes an app set up before, signed in as the shared admin; the next apply changes nothing, and plan reads the record but writes nothing', async () => {
    const { home, setup, ups, run } = await signInStack();
    // As an older Mediaplane left it: set up, its file saying so, no record of it.
    setup.signIn.done = true;
    setup.signIn.owner = 'admin';
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    const first = await run();
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(first.outcome).toBe('success');
    expect(first.plan.bootstrap).toEqual([
      { app: 'jellyfin', unpublished: true },
      { app: 'sonarr', unpublished: true },
    ]);
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr done',
      'all published; jellyfin done, sonarr done',
    ]);
    // Checked with the key, never signed in again.
    expect(setup.app.requests.some((r) => r.path === '/sign-in')).toBe(false);
    expect((await readSecretStore(home)).setUp).toEqual(['sonarr']);
    const stored = await readFile(join(home, SECRETS_PATH), 'utf8');
    const planned = await plan({
      home,
      catalog: SIGN_IN_CATALOG,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeDocker(home, { addresses: setup.addresses }),
      probe: fakeProbe(),
      wiring: setup.seams,
    });
    expect(planned.bootstrap).toEqual([]);
    expect(await readFile(join(home, SECRETS_PATH), 'utf8')).toBe(stored);
    expect((await run()).outcome).toBe('no-changes');
  });

  it('keeps unpublished, and fails as a claimed one, an app set up before by someone else', async () => {
    const { home, setup, ups, run } = await signInStack();
    // Set up with another login: its file says so, and the shared admin never signed in.
    setup.signIn.done = true;
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.plan.bootstrap).toContainEqual({ app: 'sonarr', unpublished: true });
    expect(failed.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message: `the first-run setup failed: sonarr at http://sonarr:8989 (127.0.0.1) was set up with another login (GET /signed-in/own); ${CLAIMED}`,
    });
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr done',
      'sonarr unpublished; jellyfin done, sonarr done',
    ]);
    expect(setup.app.requests.some((r) => r.path === '/sign-in')).toBe(false);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it('records an app it set up and signed out of, and none that waits', async () => {
    const { home, setup, run } = await signInStack();
    setup.signIn.refuse = true;
    expect((await run()).outcome).toBe('failed');
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    setup.signIn.refuse = false;
    expect((await run()).outcome).toBe('success');
    expect((await readSecretStore(home)).setUp).toEqual(['sonarr']);
  });

  it("keeps unpublished an app that is set up when its API is not ready in time, as one not shown to be Mediaplane's", async () => {
    const { home, setup, ups, run } = await signInStack();
    // Set up by someone else, and slow to start: the setup can't even ask it.
    setup.signIn.done = true;
    setup.signIn.owner = 'someone';
    setup.signIn.notReady = true;
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)?.message).toContain('sonarr at http://sonarr:8989');
    // Jellyfin is published once set up; Sonarr stays without its ports in that up.
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr done',
      'sonarr unpublished; jellyfin done, sonarr done',
    ]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it('keeps unpublished an app set up by someone else between the setup failing and the look after it', async () => {
    let claim = (): void => undefined;
    const catalog = SIGN_IN_CATALOG.map((def) => {
      const bootstrap = def.bootstrap;
      if (def.id !== 'sonarr' || bootstrap === undefined) return def;
      return {
        ...def,
        bootstrap: {
          ...bootstrap,
          // The setup fails (not as a refusal), and the app is set up by the next look.
          run: (api: AppApi) => {
            claim();
            return Promise.reject(
              new AppApiError(`${api.name} fake failure`, {
                kind: 'server',
                status: 500,
              }),
            );
          },
        },
      };
    });
    const { home, setup, ups, run } = await signInStack(catalog);
    claim = () => {
      setup.signIn.done = true;
      setup.signIn.owner = 'someone';
    };
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)?.message).toContain('sonarr fake failure');
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
      'sonarr unpublished; jellyfin done, sonarr done',
    ]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it('drops the record of a setup whose file no longer says it is done, before setting the app up again; plan writes nothing', async () => {
    const { home, setup, ups, run } = await signInStack();
    expect((await run()).outcome).toBe('success');
    expect((await readSecretStore(home)).setUp).toEqual(['sonarr']);
    // Its appdata was reset, and someone else set it up before the next apply.
    await rm(join(home, 'appdata', 'sonarr', 'signed-in.txt'));
    setup.signIn.owner = 'someone';
    const stored = await readFile(join(home, SECRETS_PATH), 'utf8');
    const planned = await plan({
      home,
      catalog: SIGN_IN_CATALOG,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeDocker(home, { addresses: setup.addresses }),
      probe: fakeProbe(),
      wiring: setup.seams,
    });
    expect(planned.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
    expect(await readFile(join(home, SECRETS_PATH), 'utf8')).toBe(stored);
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)?.message).toContain(CLAIMED);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    expect(ups.at(-1)).toBe('sonarr unpublished; jellyfin done, sonarr done');
    // Its file says done again, as the other user's sign-in wrote it: no record, no trust.
    await writeFile(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    const next = await run();
    expect(next.outcome).toBe('failed');
    expect(next.plan.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
  });

  it('fails, unpublished, a setup that makes a key but gives none', async () => {
    const catalog = SIGN_IN_CATALOG.map((def) => {
      const bootstrap = def.bootstrap;
      if (def.id !== 'jellyfin' || bootstrap === undefined) return def;
      return {
        ...def,
        bootstrap: {
          ...bootstrap,
          run: async (...args: Parameters<typeof bootstrap.run>) => {
            await bootstrap.run(...args);
            return undefined;
          },
        },
      };
    });
    const { home, ups, run } = await signInStack(catalog);
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)?.message).toBe(
      "the first-run setup failed: jellyfin's setup finished without giving its apiKey, which it makes; sonarr waits: sonarr waits for jellyfin's first-run setup, which isn't done",
    );
    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
      'jellyfin sonarr unpublished; jellyfin done, sonarr open',
    ]);
  });

  it("fails every apply at verify while a setup that makes no key can't read its file", async () => {
    const { home, setup, ups, run } = await signInStack();
    // The app says it is set up, by the shared admin; its file can't be read to say so.
    setup.signIn.done = true;
    setup.signIn.owner = 'admin';
    await mkdir(join(home, 'appdata', 'sonarr', 'signed-in.txt'), { recursive: true });
    for (const attempt of [1, 2]) {
      const result = await run();
      expect(result.outcome, `apply ${String(attempt)}`).toBe('failed');
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'bootstrap.unreadable', severity: 'warning' }),
      );
      expect(result.diagnostics.at(-1)?.message).toContain('sonarr (first-run setup)');
    }
    // Started unpublished on each apply, and published only once its setup has shown it
    // is Mediaplane's (its owner is the shared admin).
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr done',
      'all published; jellyfin done, sonarr done',
      'sonarr unpublished; jellyfin done, sonarr done',
      'all published; jellyfin done, sonarr done',
    ]);
  });

  it('keeps unpublished, and fails, an app with a setup but no API to finish it through', async () => {
    const catalog = SET_UP_CATALOG.map((def) =>
      def.id === 'jellyfin' ? { ...def, api: undefined } : def,
    );
    const { ups, run } = await signInStack(catalog);
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)?.message).toBe(
      "the first-run setup failed: jellyfin's container is not on the stack's wiring network, so Mediaplane can't reach it",
    );
    expect(ups).toEqual([
      'jellyfin unpublished; jellyfin open, sonarr open',
      'jellyfin unpublished; jellyfin open, sonarr open',
    ]);
  });

  it('waits, without asking it, one that comes after an app whose setup failed', async () => {
    const { setup, ups, run } = await signInStack();
    setup.state.refuse = 'fake refusal';
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)).toMatchObject({
      code: 'apply.bootstrap-failed',
      message:
        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the request (HTTP 400): fake refusal (POST /setup); sonarr waits: sonarr waits for jellyfin's first-run setup, which isn't done",
    });
    expect(setup.app.requests.some((r) => r.path === '/sign-in')).toBe(false);
    expect(ups).toEqual([
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
    ]);
  });

  it('says to start it afresh if you did not set it up, when its setup gives no remedies of its own', async () => {
    const catalog = SIGN_IN_CATALOG.map((def) =>
      def.id === 'sonarr' && def.bootstrap !== undefined
        ? { ...def, bootstrap: { ...def.bootstrap, claimedHint: undefined } }
        : def,
    );
    const { home, setup, run } = await signInStack(catalog);
    setup.signIn.done = true;
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    const failed = await run();
    expect(failed.diagnostics.at(-1)?.message).toBe(
      "the first-run setup failed: sonarr at http://sonarr:8989 (127.0.0.1) was set up with another login (GET /signed-in/own); sonarr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. If you did not set it up: start it afresh, as the runbook says",
    );
  });
});

describe("apply: a setup's first start, and what it is given", () => {
  /** The value Sonarr's first start is given, as a claim token would be: a secret. */
  const FIRST = 'fake-first-start-value';
  /**
   * SIGN_IN_CATALOG, Sonarr's setup giving its first start FIRST in FIRST_START, and
   * noting what it and its run were given.
   */
  function startCatalog(seen: BootstrapContext[], fails?: Error): Catalog {
    return SIGN_IN_CATALOG.map((def) => {
      const bootstrap = def.bootstrap;
      if (def.id !== 'sonarr' || bootstrap === undefined) return def;
      return {
        ...def,
        bootstrap: {
          ...bootstrap,
          firstStart: (ctx) => {
            seen.push(ctx);
            return fails === undefined
              ? Promise.resolve({ FIRST_START: FIRST })
              : Promise.reject(fails);
          },
          run: (api, admin, stack, ctx) => {
            seen.push(ctx);
            return bootstrap.run(api, admin, stack, ctx);
          },
        },
      };
    });
  }

  /** The stack of the setups' tests, with the start variables each up was given. */
  async function startStack(catalog: Catalog) {
    const home = await makeHome();
    const setup = await fakeSetUpApp(home);
    const docker = fakeDocker(home, { addresses: setup.addresses });
    const given: string[] = [];
    const runtime: Runtime = {
      ...docker,
      up: (seconds, values, unpublished = [], startEnv = {}) => {
        given.push(JSON.stringify(startEnv));
        return docker.up(seconds, values, unpublished, startEnv);
      },
    };
    const plexTv = (await fakePlexTv()).client;
    const run = () =>
      apply(options(home, runtime, { catalog, wiring: setup.seams, plexTv }));
    return { home, setup, calls: docker.calls, given, plexTv, run };
  }

  it('gives an app it starts unpublished what its setup gives its first start, and only then', async () => {
    const seen: BootstrapContext[] = [];
    const { calls, given, plexTv, run } = await startStack(startCatalog(seen));
    const first = await run();
    expect(first.outcome).toBe('success');
    expect(calls).toContain('up unpublished jellyfin sonarr with sonarr.FIRST_START');
    // The publishing up keeps it only for an app still unpublished: none here.
    expect(given).toEqual([JSON.stringify({ sonarr: { FIRST_START: FIRST } }), '{}']);
    // The first start and the setup are given plex.tv as apply was given it, and of the
    // stack's keys only those you give that an app's API takes as its key: none here.
    // Neither state/secrets.json's (Sonarr's key) nor the VPN key you give.
    expect(seen).toHaveLength(2);
    for (const ctx of seen) {
      expect(ctx.plexTv).toBe(plexTv);
      expect(ctx.given).toEqual({});
    }
    // Never in a record or a result.
    expect(JSON.stringify(first)).not.toContain(FIRST);
    // Set up: its done file says so, so the next apply gives nothing.
    const again = await run();
    expect(again.outcome).toBe('no-changes');
    expect(seen).toHaveLength(2);
  });

  it('keeps giving it to an app the publishing up leaves unpublished, so it is not recreated', async () => {
    const seen: BootstrapContext[] = [];
    const { setup, given, run } = await startStack(startCatalog(seen));
    setup.signIn.refuse = true;
    setup.signIn.claimant = true;
    expect((await run()).outcome).toBe('failed');
    expect(given).toEqual([
      JSON.stringify({ sonarr: { FIRST_START: FIRST } }),
      JSON.stringify({ sonarr: { FIRST_START: FIRST } }),
    ]);
  });

  it('starts nothing when a first start can not be given what it needs, with what to do', async () => {
    const seen: BootstrapContext[] = [];
    const { calls, run } = await startStack(
      startCatalog(
        seen,
        new BootstrapFailed('fake: no claim token', 'fake: sign in again'),
      ),
    );
    const failed = await run();
    expect(failed.outcome).toBe('failed');
    expect(failed.diagnostics.at(-1)).toMatchObject({
      code: 'apply.start-failed',
      message: 'fake: no claim token',
      hint: 'fake: sign in again',
    });
    expect(calls.some((call) => call.startsWith('up'))).toBe(false);
    // Asked before anything changed: Mediaplane is still on the wiring network.
    expect(calls).not.toContain('leave-wiring');
    expect(failed.actions.map((a) => `${a.step} ${a.result}`)).toContain('start failed');
  });
});
