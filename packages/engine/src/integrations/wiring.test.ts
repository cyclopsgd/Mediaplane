import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Catalog } from '../catalog/types';
import { AppApiError } from '../http/client';
import { JoinFailed, OwnContainerUnknown, WiringRefused } from '../runtime/docker';
import { RuntimeError } from '../runtime/types';
import type { SecretStore } from '../secrets/store';
import { fakeRuntime } from '../testing/fakes';
import { FIXTURE_API, fixtureCatalog } from '../testing/fixtures';
import { fakeHttpApp } from '../testing/http';
import {
  FAKE_LOGIN,
  fakeSonarr,
  WIRED_CATALOG,
  WIRING_RUNNING as RUNNING,
  wiringStack as stackOf,
} from '../testing/wiring';
import type { KnownResources } from './resources';
import type { ResourceSpec } from './types';
import {
  joinFailure,
  knownSecrets,
  PLAN_DEADLINE_MS,
  planWiring,
  reachApps,
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
      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
    ]);
    sonarr.state.user = 'admin';
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
  });

  it('checks no secret while a field differs: the update sets them all the same', async () => {
    // The password is right, but under another user name: a sign-in as the wanted user
    // would fail, and name a password that is fine.
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
  });

  it("gives a resource the stack's keys, and its check what the app holds", async () => {
    const seen: unknown[] = [];
    const linked: ResourceSpec = {
      ...FAKE_LOGIN,
      desired: (ctx) => {
        seen.push(ctx.keys);
        return FAKE_LOGIN.desired(ctx);
      },
      verify: (api, desired, observed) => {
        seen.push(observed);
        return FAKE_LOGIN.verify?.(api, desired, observed) ?? Promise.resolve(false);
      },
    };
    const stack = stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr'
          ? { ...def, integration: { after: [], resources: [linked] } }
          : def,
      ),
    );
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const keys = { sonarr: { apiKey: KEY }, qbittorrent: { apiKey: 'fake-qbt-key' } };
    await planWiring(options(sonarr, { stack, keys, known: RECORDED }));
    expect(seen).toContainEqual(keys);
    expect(seen).toContainEqual({ id: null, name: 'login', fields: { user: 'admin' } });
  });

  it('looks a resource up with what the stack wants of it: a name that comes from the stack', async () => {
    // Jellyfin's admin is the user named as the shared admin, before resources.json
    // records its id.
    const seen: unknown[] = [];
    const named: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: (api, known, desired) => {
        seen.push(desired);
        return FAKE_LOGIN.observe(api, known);
      },
    };
    const stack = stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr'
          ? { ...def, integration: { after: [], resources: [named] } }
          : def,
      ),
    );
    await planWiring(options(await fakeSonarr({ key: KEY }), { stack }));
    expect(seen).toEqual([
      { name: 'login', fields: { user: 'admin' }, secrets: { password: PASSWORD } },
    ]);
  });

  /** WIRED_CATALOG, with Sonarr's resources replaced by `resources`. */
  function sonarrWith(resources: ResourceSpec[]) {
    return stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
      ),
    );
  }

  it('leaves the secrets unchecked while a resource they require is yet to be made', async () => {
    // "sonarr.first", which holds no secret, is missing, so apply would create it;
    // "sonarr.login" requires it.
    const first: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      secrets: [],
      observe: () => Promise.resolve(undefined),
    };
    const login: ResourceSpec = { ...FAKE_LOGIN, requires: ['sonarr.first'] };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'other' });
    const stack = sonarrWith([first, login]);
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      { resource: 'sonarr.first', action: 'create' },
      { resource: 'sonarr.login', action: 'adopt' },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
    // Once it is in place, the secrets are checked, and found refused.
    const there: ResourceSpec = {
      ...first,
      observe: () =>
        Promise.resolve({ id: null, name: 'first', fields: { user: 'admin' } }),
    };
    const known: KnownResources = {
      ...RECORDED,
      'sonarr.first': {
        id: null,
        name: 'first',
        fields: { user: 'admin' },
        secrets: [],
        appliedAt: '2026-10-10T12:00:00.000Z',
      },
    };
    expect(
      (await planWiring(options(sonarr, { stack: sonarrWith([there, login]), known })))
        .changes,
    ).toEqual([
      { resource: 'sonarr.first', action: 'unchanged' },
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(true);
  });

  it('leaves the secrets unchecked while a resource they require is to be updated, or could not be looked at', async () => {
    // "sonarr.first" holds another user, so apply would update it; then the app refuses
    // it (404), so plan can't say. Either way it isn't in place yet.
    const differs: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      secrets: [],
      observe: () =>
        Promise.resolve({ id: null, name: 'first', fields: { user: 'someone' } }),
    };
    const refused: ResourceSpec = {
      ...differs,
      observe: (api) => api.get('/api/v3/missing', z.unknown()).then(() => undefined),
    };
    const login: ResourceSpec = { ...FAKE_LOGIN, requires: ['sonarr.first'] };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'other' });
    const planned = (resources: ResourceSpec[]) =>
      planWiring(options(sonarr, { stack: sonarrWith(resources) })).then((p) =>
        p.changes.map((c) => [c.resource, c.action]),
      );
    expect(await planned([differs, login])).toEqual([
      ['sonarr.first', 'update'],
      ['sonarr.login', 'adopt'],
    ]);
    expect(await planned([refused, login])).toEqual([
      ['sonarr.first', 'unknown'],
      ['sonarr.login', 'adopt'],
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
  });

  it('leaves the secrets unchecked while what they require of another app is checked after the start', async () => {
    // Apply changes qBittorrent's container, so its "thing" is checked after the start.
    const thing: ResourceSpec = { ...FAKE_LOGIN, name: 'thing', secrets: [] };
    const login: ResourceSpec = { ...FAKE_LOGIN, requires: ['qbittorrent.thing'] };
    const stack = stackOf(
      WIRED_CATALOG.map((def) => {
        if (def.id === 'qbittorrent') {
          return {
            ...def,
            api: FIXTURE_API,
            integration: { after: [], resources: [thing] },
          };
        }
        return def.id === 'sonarr'
          ? { ...def, integration: { after: ['qbittorrent'], resources: [login] } }
          : def;
      }),
    );
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'other' });
    const planned = await planWiring(
      options(sonarr, { stack, changing: new Set(['qbittorrent']) }),
    );
    expect(planned.changes).toEqual([
      { resource: 'qbittorrent.thing', action: 'after-start' },
      { resource: 'sonarr.login', action: 'adopt' },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
  });

  it('leaves unchecked what requires a resource whose own secrets went unchecked', async () => {
    // "first" is to be made, so "second"'s password goes unchecked, and may be wrong:
    // "third", which requires "second", isn't checked either.
    const first: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      secrets: [],
      observe: () => Promise.resolve(undefined),
    };
    const second: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'second',
      requires: ['sonarr.first'],
    };
    const third: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'third',
      requires: ['sonarr.second'],
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'other' });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([first, second, third]) }),
    );
    expect(planned.changes).toEqual([
      { resource: 'sonarr.first', action: 'create' },
      { resource: 'sonarr.second', action: 'adopt' },
      { resource: 'sonarr.third', action: 'adopt' },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
  });

  it('stops at an app that no longer answers in time, as at one that stops answering', async () => {
    const slow: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: () =>
        Promise.reject(
          new AppApiError(
            'sonarr at http://sonarr:8989 did not answer within 30 s (GET /api/v3/login)',
            { kind: 'timeout', transient: true },
          ),
        ),
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([slow, FAKE_LOGIN]) }),
    );
    expect(planned.changes.map((c) => [c.resource, c.action])).toEqual([
      ['sonarr.first', 'unknown'],
      ['sonarr.login', 'unknown'],
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        code: 'wire.timeout',
        hint: `check it with "mediaplane status sonarr", then see ${WIRING_RUNBOOK}`,
      }),
    ]);
    // The second resource wasn't asked.
    expect(sonarr.app.requests.some((r) => r.path === '/api/v3/login')).toBe(false);
  });

  it("keeps asking an app's other resources when one fails, and stops when the app stops answering", async () => {
    const refused: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      // The fake Sonarr answers 404: a refusal of this resource, not of the app.
      observe: (api) => api.get('/api/v3/missing', z.unknown()).then(() => undefined),
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([refused, FAKE_LOGIN]) }),
    );
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.first',
        action: 'unknown',
        reason: expect.stringContaining('refused the request (HTTP 404)') as string,
      },
      { resource: 'sonarr.login', action: 'create' },
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({ code: 'wire.rejected', hint: `see ${WIRING_RUNBOOK}` }),
    ]);
    // Nothing answering is the app's failure: what is left of it is unknown too.
    const gone: ResourceSpec = {
      ...refused,
      observe: () =>
        Promise.reject(
          new AppApiError(
            'sonarr at http://sonarr:8989 could not be reached (ECONNREFUSED)',
            {
              kind: 'unreachable',
              reachedApp: false,
            },
          ),
        ),
    };
    const stopped = await planWiring(
      options(sonarr, { stack: sonarrWith([gone, FAKE_LOGIN]) }),
    );
    expect(stopped.changes.map((c) => [c.resource, c.action])).toEqual([
      ['sonarr.first', 'unknown'],
      ['sonarr.login', 'unknown'],
    ]);
    expect(stopped.diagnostics).toEqual([
      expect.objectContaining({
        code: 'wire.unreachable',
        hint: `check it with "mediaplane status sonarr", then see ${WIRING_RUNBOOK}`,
      }),
    ]);
  });

  it("keeps every secret out of a resource's warning, whoever wrote its message", async () => {
    // A resource's own AppApiError: the client never saw it, so plan redacts it.
    const own: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.reject(
          new AppApiError(`Sonarr would not take ${PASSWORD}`, { kind: 'rejected' }),
        ),
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(options(sonarr, { stack: sonarrWith([own]) }));
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason: 'Sonarr would not take ***',
      },
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        code: 'wire.rejected',
        message: 'Sonarr would not take ***',
      }),
    ]);
  });

  it('says a managed field that holds a secret is one apply would refuse, and asks nothing of it', async () => {
    // The user name "admin" holds a value of the stack's secrets.
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, { secrets: [KEY, PASSWORD, 'dmi'] }),
    );
    const reason =
      "sonarr.login.user holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value";
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'unknown', reason },
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'wire.secret-field',
        message: reason,
        hint: `see ${WIRING_RUNBOOK}`,
      }),
    ]);
    // Only the app's own check: the resource was neither looked at nor signed in to.
    expect(sonarr.app.requests.map((r) => r.path)).toEqual([
      '/ping',
      '/api/v3/system/status',
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

  it("gives an app that keeps failing plan's 15 s once, not once for each resource", async () => {
    // Up, and taking the key, then 503 to everything else: each resource would wait.
    const app = await fakeHttpApp((request) =>
      ['/ping', '/api/v3/system/status'].includes(request.path)
        ? { status: 200, body: {} }
        : { status: 503 },
    );
    let clock = 0;
    const seams: WiringSeams = {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: {
        now: () => clock,
        sleep: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
        random: () => 0.1,
      },
    };
    const stack = sonarrWith([
      { ...FAKE_LOGIN, name: 'first' },
      { ...FAKE_LOGIN, name: 'second' },
      FAKE_LOGIN,
    ]);
    const planned = await planWiring(
      options({ seams, addresses: { 'fake-sonarr': '127.0.0.1' } }, { stack }),
    );
    const reason = expect.stringContaining(
      'failed (HTTP 503) (GET /api/v3/login), and still did after 15 s',
    ) as string;
    expect(planned.changes).toEqual(
      ['sonarr.first', 'sonarr.second', 'sonarr.login'].map((resource) => ({
        resource,
        action: 'unknown',
        reason,
      })),
    );
    // The app's warning, once: the rest of it wasn't asked.
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        code: 'wire.server',
        hint: `check it with "mediaplane status sonarr", then see ${WIRING_RUNBOOK}`,
      }),
    ]);
    expect(clock).toBeLessThanOrEqual(PLAN_DEADLINE_MS);
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

describe('reachApps', () => {
  it('says so, rather than reach an app on port 0, when its API names a port it lacks', async () => {
    const [sonarr] = stackOf().apps.filter((a) => a.def.id === 'sonarr');
    if (sonarr === undefined) throw new Error('no Sonarr in the stack');
    await expect(
      reachApps([{ ...sonarr, containerPorts: {} }], {
        runtime: fakeRuntime({ addresses: { 'fake-sonarr': '172.18.0.2' } }),
        current: RUNNING,
        keys: {},
        secrets: [],
        deadlineMs: 0,
      }),
    ).rejects.toThrow('sonarr has no web port for its API');
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
