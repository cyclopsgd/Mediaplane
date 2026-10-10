import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import { JoinFailed, OwnContainerUnknown, WiringRefused } from '../runtime/docker';
import { RuntimeError } from '../runtime/types';
import type { SecretStore } from '../secrets/store';
import { fakeRuntime } from '../testing/fakes';
import { FIXTURE_API, fixtureCatalog } from '../testing/fixtures';
import { fakeHttpApp } from '../testing/http';
import {
  FAKE_LOGIN,
  fakeSonarr,
  WIRING_RUNNING as RUNNING,
  wiringStack as stackOf,
} from '../testing/wiring';
import type { KnownResources } from './resources';
import type { ResourceSpec } from './types';
import {
  joinFailure,
  knownSecrets,
  planWiring,
  settled,
  WIRING_RUNBOOK,
  wiringOrder,
  type PlanWiringOptions,
  type WiringSeams,
} from './wiring';

const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';
/** A fake app's seams, and where its container is on the wiring network. */
interface Fake {
  seams: WiringSeams;
  addresses: Record<string, string>;
}

function options(fake: Fake, extra: Partial<PlanWiringOptions> = {}): PlanWiringOptions {
  const { seams, addresses } = fake;
  return {
    stack: stackOf(),
    current: RUNNING,
    changing: new Set(),
    onNetwork: true,
    runtime: fakeRuntime({ addresses }),
    keys: { sonarr: { apiKey: KEY } },
    admin: { username: 'admin', password: PASSWORD },
    secrets: [KEY, PASSWORD],
    known: {},
    seams,
    ...extra,
  };
}

const RECORDED: KnownResources = {
  'sonarr.login': {
    id: null,
    name: 'login',
    fields: { user: 'admin' },
    secrets: ['password'],
    appliedAt: '2026-10-10T12:00:00.000Z',
  },
};

describe('planWiring', () => {
  it('would create a resource the app has none of, and changes nothing itself', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(options(sonarr));
    expect(planned).toEqual({
      changes: [{ resource: 'sonarr.login', action: 'create' }],
      diagnostics: [],
    });
    expect(sonarr.app.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /ping',
      'GET /api/v3/system/status',
      'GET /api/v3/login',
    ]);
  });

  it('adopts one already as wanted that resources.json lacks, and leaves a recorded one', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    expect((await planWiring(options(sonarr))).changes).toEqual([
      { resource: 'sonarr.login', action: 'adopt' },
    ]);
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'unchanged' },
    ]);
  });

  it('would update a field that differs, and a secret the app refuses, by name only', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['user', 'password'] },
    ]);
    sonarr.state.user = 'admin';
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
  });

  it('checks after the start an app whose container apply changes, or that is not ready', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const after = [{ resource: 'sonarr.login', action: 'after-start' }];
    for (const extra of [
      { changing: new Set(['sonarr']) },
      { current: RUNNING.filter((c) => c.service !== 'sonarr') },
      {
        current: RUNNING.map((c) =>
          c.service === 'sonarr' ? { ...c, health: 'starting' } : c,
        ),
      },
      // Not on the wiring network yet: there is none.
      { onNetwork: false },
    ]) {
      expect((await planWiring(options(sonarr, extra))).changes).toEqual(after);
    }
    expect(sonarr.app.requests).toEqual([]);
  });

  it('says so when an app that stays as it is has no address on the wiring network', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { runtime: fakeRuntime({ addresses: {} }) }),
    );
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason:
          "sonarr's container is not on the stack's wiring network, so Mediaplane can't reach it",
      },
    ]);
    expect(planned.diagnostics.map((d) => d.code)).toEqual(['wire.not-on-network']);
  });

  it('says what stopped it from asking an app, with no secret, and goes on to the next', async () => {
    const sonarr = await fakeSonarr({ key: 'f'.repeat(32) });
    const planned = await planWiring(options(sonarr));
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        // The app repeated the key it refused: the redaction took it out.
        reason: expect.stringContaining(
          "refused Mediaplane's API key (HTTP 401): Unauthorized: ***",
        ) as string,
      },
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'wire.auth',
        hint: 'check it with "mediaplane status sonarr", then see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md',
      }),
    ]);
    expect(JSON.stringify(planned)).not.toContain(KEY);
  });

  it('keeps every secret it is given out of what an app says, not only the key it sends', async () => {
    // The app repeats the admin password, which no call here sends: only the secrets
    // given to the client take it out (preflight M5).
    const app = await fakeHttpApp((request) =>
      request.path === '/api/v3/login'
        ? { status: 500, body: { message: `no login for admin/${PASSWORD}` } }
        : { status: 200, body: {} },
    );
    const planned = await planWiring(
      options({
        seams: {
          endpoint: () => ({ host: '127.0.0.1', port: app.port }),
          retry: { deadlineMs: 0 },
        },
        addresses: { 'fake-sonarr': '127.0.0.1' },
      }),
    );
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason: expect.stringContaining(
          'failed (HTTP 500): no login for admin/***',
        ) as string,
      },
    ]);
    expect(JSON.stringify(planned)).not.toContain(PASSWORD);
  });

  it('only checks an app with an API and nothing to wire: it is up, and takes the key', async () => {
    const catalog = fixtureCatalog.map((def) =>
      def.id === 'sonarr' ? { ...def, api: FIXTURE_API } : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const stack = stackOf(catalog);
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      { resource: 'sonarr', action: 'unchanged' },
    ]);
    sonarr.state.up = false;
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      {
        resource: 'sonarr',
        action: 'unknown',
        reason: expect.stringContaining('failed (HTTP 503)') as string,
      },
    ]);
  });

  it('lists only the resources the stack wants, whatever it finds', async () => {
    const unwanted: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'unwanted',
      desired: () => undefined,
    };
    const stackWith = (resources: ResourceSpec[]) =>
      stackOf(
        fixtureCatalog.map((def) =>
          def.id === 'sonarr'
            ? { ...def, api: FIXTURE_API, integration: { after: [], resources } }
            : def,
        ),
      );
    const stack = stackWith([unwanted, FAKE_LOGIN]);
    const sonarr = await fakeSonarr({ key: KEY });
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'create' },
    ]);
    expect(
      (await planWiring(options(sonarr, { stack, onNetwork: false }))).changes,
    ).toEqual([{ resource: 'sonarr.login', action: 'after-start' }]);
    // A refused key: what is left unasked is what the stack wants, not the rest.
    sonarr.state.key = 'f'.repeat(32);
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason: expect.stringContaining("refused Mediaplane's API key") as string,
      },
    ]);
    // Wanting none of its resources, Mediaplane only checks the app.
    sonarr.state.key = KEY;
    const none = stackWith([unwanted]);
    expect((await planWiring(options(sonarr, { stack: none }))).changes).toEqual([
      { resource: 'sonarr', action: 'unchanged' },
    ]);
  });

  it("gives an app that is still starting plan's 15 s, and no more", async () => {
    const sonarr = await fakeSonarr({ key: KEY, up: false });
    // A clock that moves only while the client waits; each wait is a tenth of its cap.
    let clock = 0;
    const seams: WiringSeams = {
      ...sonarr.seams,
      retry: {
        now: () => clock,
        sleep: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
        random: () => 0.1,
      },
    };
    const planned = await planWiring(options({ seams, addresses: sonarr.addresses }));
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason: expect.stringContaining(
          'failed (HTTP 503) (GET /ping), and still did after 15 s',
        ) as string,
      },
    ]);
  });
});

describe('knownSecrets', () => {
  it("holds every secret the stack knows, and the stored admin password when it isn't in use", () => {
    const store: SecretStore = {
      version: 1,
      apps: { sonarr: { apiKey: KEY } },
      shared: { adminPassword: 'fake-stored-password' },
    };
    const values = {
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key',
      MP_SONARR_API_KEY: KEY,
      MP_UNSET: '',
    };
    // admin.password is a file of yours: the stored one may still be in an app.
    expect(knownSecrets(values, store, { password: 'fake-own-password' })).toEqual([
      'fake-wireguard-key',
      KEY,
      'fake-stored-password',
      'fake-own-password',
    ]);
  });
});

describe('joinFailure', () => {
  it('says how to put back the network compose.yaml makes, for one Mediaplane refuses', () => {
    const cause = new WiringRefused(
      'refusing to join mediaplane_wiring: it is not the wiring network of the Compose project "mediaplane"',
    );
    expect(joinFailure(cause, {})).toEqual({
      severity: 'error',
      code: 'wire.network',
      message: cause.message,
      hint: `the wiring network must be the one compose.yaml makes: take out any networks: entry that changes it in compose.override.yaml (or a network of that name made by hand), then remove the network on the host, as the runbook shows, and run apply: ${WIRING_RUNBOOK}`,
    });
  });

  it("says how to run Mediaplane when it can't tell which container it runs in", () => {
    const cause = new OwnContainerUnknown(
      "Mediaplane can't tell which container it runs in (no container ID in /proc/self/mountinfo), so it can't join the stack's wiring network",
    );
    expect(joinFailure(cause, {})).toEqual({
      severity: 'error',
      code: 'wire.network',
      message: cause.message,
      hint: `run Mediaplane with Docker, as deploy/mediaplane.compose.yaml does, or from source on the host, where it joins nothing; see ${WIRING_RUNBOOK}`,
    });
  });

  it('says what to do when Docker refused the join itself', () => {
    const cause = new JoinFailed(
      'could not join the wiring network mediaplane_wiring: Error response from daemon: network 0123 not found',
    );
    expect(joinFailure(cause, {})).toEqual({
      severity: 'error',
      code: 'wire.network',
      message: cause.message,
      hint: `the reason after the colon is Docker's. If it says "not found", the network was removed or made anew meanwhile: run apply again. Otherwise see "could not join" in ${WIRING_RUNBOOK}`,
    });
  });

  it("is Docker's failure for anything else", () => {
    const cause = new RuntimeError('docker network inspect failed: permission denied');
    expect(joinFailure(cause, {})).toEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'docker.unavailable',
        message: cause.message,
      }),
    );
  });
});

describe('wiringOrder', () => {
  const withAfter = (after: Record<string, string[]>): Catalog =>
    fixtureCatalog.map((def) =>
      def.id in after
        ? {
            ...def,
            api: FIXTURE_API,
            integration: { after: after[def.id] ?? [], resources: [] },
          }
        : def,
    );

  it("puts an app after the apps its integration names, and ignores the stack's absent ones", () => {
    const stack = stackOf(
      withAfter({
        qbittorrent: [],
        sonarr: ['qbittorrent', 'radarr'],
        jellyfin: ['sonarr'],
      }),
    );
    expect(wiringOrder(stack).map((app) => app.def.id)).toEqual([
      'qbittorrent',
      'sonarr',
      'jellyfin',
    ]);
  });

  it('refuses a loop', () => {
    const stack = stackOf(
      withAfter({ qbittorrent: ['sonarr'], sonarr: ['qbittorrent'] }),
    );
    expect(() => wiringOrder(stack)).toThrow('loops: qbittorrent → sonarr → qbittorrent');
  });
});

describe('settled', () => {
  it('needs the app and the one whose network it uses running, healthy and unchanged', () => {
    const qbittorrent = stackOf().apps.find((app) => app.def.id === 'qbittorrent');
    if (qbittorrent === undefined) throw new Error('no qbittorrent');
    expect(settled(qbittorrent, RUNNING, new Set())).toBe(true);
    expect(settled(qbittorrent, RUNNING, new Set(['gluetun']))).toBe(false);
    const stopped = RUNNING.map((c) =>
      c.service === 'gluetun' ? { ...c, state: 'exited' } : c,
    );
    expect(settled(qbittorrent, stopped, new Set())).toBe(false);
    const noHealthCheck = RUNNING.map((c) => ({ ...c, health: '' }));
    expect(settled(qbittorrent, noHealthCheck, new Set())).toBe(true);
  });
});
