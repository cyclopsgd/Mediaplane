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
  WIRING_STACK,
  wiringStack as stackOf,
} from '../testing/wiring';
import { foundSecrets } from '../util/redact';
import type { KnownResource, KnownResources } from './resources';
import type { Fields, ResourceSpec } from './types';
import {
  joinFailure,
  knownSecrets,
  listItems,
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

/**
 * WIRED_CATALOG's stack, with Sonarr's resources replaced by `resources`, and the
 * stack's overrides (spec §4.2) given, one line each.
 */
function sonarrWith(resources: ResourceSpec[], ...overrides: string[]) {
  return stackOf(
    WIRED_CATALOG.map((def) =>
      def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
    ),
    overrides.length === 0
      ? undefined
      : `${WIRING_STACK}overrides:\n${overrides.map((line) => `  ${line}`).join('\n')}\n`,
  );
}

describe('planWiring', () => {
  it('would create a resource the app has none of, and changes nothing itself', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(options(sonarr));
    expect(planned).toEqual({
      changes: [{ resource: 'sonarr.login', action: 'create' }],
      diagnostics: [],
      drift: [],
      checks: [
        {
          resource: 'sonarr.login',
          secret: 'password',
          verdict: 'unchecked',
          reason: 'the app has none to check: apply makes it with them',
        },
      ],
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

  it('takes a secret apply generates as a change, never signing in with it: no app holds it yet', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const fresh = 'fake-new-password';
    const planned = await planWiring(
      options(sonarr, {
        known: RECORDED,
        admin: { username: 'admin', password: fresh },
        fresh: [fresh],
      }),
    );
    expect(planned).toMatchObject({
      changes: [{ resource: 'sonarr.login', action: 'update', changes: ['password'] }],
      drift: [],
      checks: [
        {
          resource: 'sonarr.login',
          secret: 'password',
          verdict: 'unchecked',
          reason: 'apply generates it, and sets it: no app holds it yet',
        },
      ],
    });
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
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
        // As the wire step records it: the name desired() gives.
        name: 'login',
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

  /**
   * A login whose `profile`, a managed field, only the app can say (`resolve`): it wants
   * "HD", and the app holds `held`. `asked` counts the resolutions.
   */
  function profiled(held: string, more: Partial<ResourceSpec> = {}) {
    const asked: string[] = [];
    const seen: unknown[] = [];
    const spec: ResourceSpec = {
      ...FAKE_LOGIN,
      fields: ['user', 'profile'],
      resolve: (_api, desired) => {
        asked.push(desired.name);
        return Promise.resolve({
          ...desired,
          fields: { ...desired.fields, profile: 'HD' },
        });
      },
      observe: async (api, known, desired) => {
        seen.push(desired?.fields);
        const found = await FAKE_LOGIN.observe(api, known);
        return found && { ...found, fields: { ...found.fields, profile: held } };
      },
      ...more,
    };
    return { spec, asked, seen };
  }

  /** resources.json, with the login recorded as wanted: its user, and the "HD" profile. */
  const PROFILED: KnownResources = {
    'sonarr.login': {
      id: null,
      name: 'login',
      fields: { user: 'admin', profile: 'HD' },
      secrets: ['password'],
      appliedAt: '2026-10-10T12:00:00.000Z',
    },
  };

  it('fills in what only the app can say before it compares, and looks the resource up with it', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const same = profiled('HD');
    expect(
      (
        await planWiring(
          options(sonarr, { stack: sonarrWith([same.spec]), known: PROFILED }),
        )
      ).changes,
    ).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
    expect(same.asked).toEqual(['login']);
    expect(same.seen).toEqual([{ user: 'admin', profile: 'HD' }]);
    const other = profiled('SD');
    expect(
      (
        await planWiring(
          options(sonarr, { stack: sonarrWith([other.spec]), known: PROFILED }),
        )
      ).changes,
    ).toEqual([{ resource: 'sonarr.login', action: 'update', changes: ['profile'] }]);
  });

  it('leaves it unfilled, and uncompared, while a resource it requires is yet to be made', async () => {
    const first: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      secrets: [],
      observe: () => Promise.resolve(undefined),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const waiting = profiled('SD', { requires: ['sonarr.first'] });
    expect(
      (
        await planWiring(
          options(sonarr, { stack: sonarrWith([first, waiting.spec]), known: PROFILED }),
        )
      ).changes,
    ).toEqual([
      { resource: 'sonarr.first', action: 'create' },
      // Only its user is compared, which resources.json records as wanted.
      { resource: 'sonarr.login', action: 'unchanged' },
    ]);
    expect(waiting.asked).toEqual([]);
    expect(waiting.seen).toEqual([{ user: 'admin' }]);
  });

  it('compares every field of a resource without `resolve`, one its desired() leaves out too', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    // The app holds a profile; desired() gives none, and nothing resolves it.
    const spec: ResourceSpec = { ...profiled('HD').spec };
    delete spec.resolve;
    expect(
      (await planWiring(options(sonarr, { stack: sonarrWith([spec]), known: PROFILED })))
        .changes,
    ).toEqual([{ resource: 'sonarr.login', action: 'update', changes: ['profile'] }]);
  });

  it('compares every field of a resource without `resolve` while a resource it requires is yet to be made', async () => {
    const first: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      secrets: [],
      observe: () => Promise.resolve(undefined),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    // Nothing resolves the profile: not running `resolve` is no reason to skip it.
    const spec: ResourceSpec = { ...profiled('HD', { requires: ['sonarr.first'] }).spec };
    delete spec.resolve;
    expect(
      (
        await planWiring(
          options(sonarr, { stack: sonarrWith([first, spec]), known: PROFILED }),
        )
      ).changes,
    ).toEqual([
      { resource: 'sonarr.first', action: 'create' },
      { resource: 'sonarr.login', action: 'update', changes: ['profile'] },
    ]);
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

  it('keeps a secret a resource read in an answer out of every warning after it', async () => {
    const HELD = 'e'.repeat(32);
    // One reads a key the app holds in clear, then fails in its own words, quoting it;
    // the next quotes it too.
    const reads: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: (api) => {
        api.addSecret(HELD);
        return Promise.reject(
          new AppApiError(`Sonarr holds ${HELD}`, { kind: 'rejected' }),
        );
      },
    };
    const quotes: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.reject(new AppApiError(`still ${HELD}`, { kind: 'rejected' })),
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([reads, quotes]) }),
    );
    expect(planned.diagnostics.map((d) => d.message)).toEqual([
      'Sonarr holds ***',
      'still ***',
    ]);
    expect(JSON.stringify(planned)).not.toContain(HELD);
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

  it('waits for an app that says when it has started, and checks it after it has, or says it is still starting', async () => {
    let asked = 0;
    const app = await fakeHttpApp((request) => {
      if (request.path === '/ping') return { status: 200 };
      if (request.path === '/started') {
        asked += 1;
        return { status: 200, body: { starting: asked < 3 } };
      }
      return request.path === '/api/v3/system/status'
        ? { status: 200, body: {} }
        : { status: 200, body: { user: 'admin' } };
    });
    const started = {
      path: '/started',
      done: (answer: unknown) =>
        typeof answer === 'object' &&
        answer !== null &&
        (answer as { starting?: unknown }).starting === false,
    };
    const catalog: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr' ? { ...def, api: { ...FIXTURE_API, started } } : def,
    );
    let clock = 0;
    const waiting = {
      seams: {
        endpoint: () => ({ host: '127.0.0.1', port: app.port }),
        retry: {
          deadlineMs: 60_000,
          now: () => clock,
          sleep: (ms: number) => {
            clock += ms;
            return Promise.resolve();
          },
        },
      },
      addresses: { 'fake-sonarr': '127.0.0.1' },
    };
    const planned = await planWiring(options(waiting, { stack: stackOf(catalog) }));
    expect(planned.diagnostics).toEqual([]);
    expect(asked).toBe(3);
    // Out of time while it is still starting: unknown, with why.
    asked = -100;
    const early = await planWiring(
      options(
        { ...waiting, seams: { ...waiting.seams, retry: { deadlineMs: 0 } } },
        { stack: stackOf(catalog) },
      ),
    );
    expect(early.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason:
          'sonarr at http://sonarr:8989 (127.0.0.1) is still starting (GET /started)',
      },
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
        found: foundSecrets(),
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

describe('planWiring: drift (spec §6.3)', () => {
  const AT = '2026-10-20T08:00:00.000Z';

  it('says what was applied and what the app holds of a field changed in it', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const planned = await planWiring(options(sonarr, { known: RECORDED }));
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
    ]);
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        actual: 'someone',
      },
    ]);
    // The update sets the password with the user, so it isn't checked.
    expect(planned.checks).toEqual([
      {
        resource: 'sonarr.login',
        secret: 'password',
        verdict: 'unchecked',
        reason: 'a managed field differs: apply sets the secrets with it',
      },
    ]);
  });

  it('finds no drift without a record, or where the app holds what the stack now wants', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    // Never applied: an update, not a change made outside Mediaplane.
    expect((await planWiring(options(sonarr))).drift).toEqual([]);
    // Applied as "admin", and the stack now wants the user the app holds: adopted.
    sonarr.state.user = 'admin';
    const old = {
      'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'old' } },
    };
    const planned = await planWiring(options(sonarr, { known: old as KnownResources }));
    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'adopt' }]);
    expect(planned.drift).toEqual([]);
    expect(planned.checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'passed' },
    ]);
  });

  it('says what apply sets, and what was applied, when stack.yaml and the app both changed it', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const old = {
      'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'old' } },
    };
    const planned = await planWiring(options(sonarr, { known: old as KnownResources }));
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        applied: 'old',
        actual: 'someone',
      },
    ]);
  });

  it('finds no drift against a record of another name than the stack now wants: that is its own change', async () => {
    // qBittorrent's category, once Sonarr's is kept as another: the stack wants another.
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const before = {
      'sonarr.login': { ...RECORDED['sonarr.login'], name: 'before' },
    } as KnownResources;
    const planned = await planWiring(options(sonarr, { known: before }));
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
    ]);
    expect(planned.drift).toEqual([]);
    sonarr.state.user = 'admin';
    // Not recorded under the name it now has: adopted.
    expect((await planWiring(options(sonarr, { known: before }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'adopt' },
    ]);
    const missing = await fakeSonarr({ key: KEY });
    expect((await planWiring(options(missing, { known: before }))).drift).toEqual([]);
  });

  it('says a resource it applied was deleted outside Mediaplane', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(options(sonarr, { known: RECORDED }));
    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'create' }]);
    expect(planned.drift).toEqual([{ resource: 'sonarr.login', kind: 'missing' }]);
    expect(planned.checks).toEqual([
      {
        resource: 'sonarr.login',
        secret: 'password',
        verdict: 'unchecked',
        reason: 'the app has none to check: apply makes it with them',
      },
    ]);
  });

  it("says a secret the app's own check refuses, by name only", async () => {
    const sonarr = await fakeSonarr({
      key: KEY,
      user: 'admin',
      password: 'fake-changed',
    });
    const planned = await planWiring(options(sonarr, { known: RECORDED }));
    expect(planned.drift).toEqual([
      { resource: 'sonarr.login', kind: 'secret', secret: 'password' },
    ]);
    expect(planned.checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'refused' },
    ]);
    expect(JSON.stringify(planned)).not.toContain(PASSWORD);
  });

  it('takes a secret drift found refused as refused, with no check, until apply sets it', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const found = {
      'sonarr.login': {
        ...RECORDED['sonarr.login'],
        checks: { password: { verdict: 'refused', at: AT } },
      },
    } as KnownResources;
    const planned = await planWiring(options(sonarr, { known: found }));
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
    expect(planned.drift).toEqual([
      { resource: 'sonarr.login', kind: 'secret', secret: 'password', since: AT },
    ]);
    expect(planned.checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'refused', at: AT },
    ]);
    // No sign-in: each one that fails counts towards qBittorrent's ban.
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
    // A check drift found passing is checked again.
    const passed = {
      'sonarr.login': {
        ...RECORDED['sonarr.login'],
        checks: { password: { verdict: 'passed', at: AT } },
      },
    } as KnownResources;
    expect((await planWiring(options(sonarr, { known: passed }))).checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'passed' },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(true);
  });

  it('leaves the other secrets unchecked beside one found refused, and one with no check', async () => {
    const two: ResourceSpec = { ...FAKE_LOGIN, secrets: ['password', 'token'] };
    const found = {
      'sonarr.login': {
        ...RECORDED['sonarr.login'],
        secrets: ['password', 'token'],
        checks: { password: { verdict: 'refused', at: AT } },
      },
    } as KnownResources;
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([two]), known: found }),
    );
    expect(planned.checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'refused', at: AT },
      {
        resource: 'sonarr.login',
        secret: 'token',
        verdict: 'unchecked',
        reason: 'apply sets it with the refused one',
      },
    ]);
    const unverified: ResourceSpec = {
      name: FAKE_LOGIN.name,
      fields: FAKE_LOGIN.fields,
      secrets: FAKE_LOGIN.secrets,
      desired: (ctx) => FAKE_LOGIN.desired(ctx),
      observe: (api, known) => FAKE_LOGIN.observe(api, known),
      create: (api, desired) => FAKE_LOGIN.create(api, desired),
      update: (api, desired, observed) => FAKE_LOGIN.update(api, desired, observed),
    };
    const blind = await planWiring(
      options(sonarr, { stack: sonarrWith([unverified]), known: RECORDED }),
    );
    expect(blind.checks).toEqual([
      {
        resource: 'sonarr.login',
        secret: 'password',
        verdict: 'unchecked',
        reason: 'it has no check',
      },
    ]);
  });

  it("reports a field the app holds in a shape it can't read, never as empty", async () => {
    const odd: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.resolve({
          id: null,
          name: 'login',
          fields: {},
          unreadable: { user: 'a number, not text' },
        }),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([odd]), known: RECORDED }),
    );
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
    ]);
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        actual: null,
        unreadable: 'a number, not text',
      },
    ]);
  });

  it("keeps a secret out of what it says of a value it can't read", async () => {
    const odd: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.resolve({
          id: null,
          name: 'login',
          fields: {},
          unreadable: { user: `a folder with a comma in its name, /x,${PASSWORD}` },
        }),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([odd]), known: RECORDED }),
    );
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        actual: null,
        unreadable: 'a folder with a comma in its name, /x,***',
        redacted: true,
      },
    ]);
  });

  it('keeps a secret out of a value the app holds, and says it did', async () => {
    const sonarr = await fakeSonarr({
      key: KEY,
      user: `x${PASSWORD}`,
      password: PASSWORD,
    });
    const planned = await planWiring(options(sonarr, { known: RECORDED }));
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        actual: 'x***',
        redacted: true,
      },
    ]);
  });

  it('keeps out a secret the run reads after the drift it is in, and out of every reason', async () => {
    const HELD = 'e'.repeat(32);
    // The first resource drifted to a value that holds a key the second reads after it.
    const first: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: () =>
        Promise.resolve({ id: null, name: 'first', fields: { user: `x${HELD}` } }),
    };
    const second: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: (api) => {
        api.addSecret(HELD);
        return FAKE_LOGIN.observe(api, undefined);
      },
      // A check that says why it left itself undone, quoting what the app holds.
      verify: () => Promise.resolve({ unchecked: `the app holds ${HELD} and ${KEY}` }),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, {
        stack: sonarrWith([first, second]),
        known: {
          ...RECORDED,
          'sonarr.first': RECORDED['sonarr.login'] as KnownResource,
        },
      }),
    );
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.first',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        actual: 'x***',
        redacted: true,
      },
    ]);
    expect(planned.checks).toContainEqual({
      resource: 'sonarr.login',
      secret: 'password',
      verdict: 'unchecked',
      reason: 'the app holds *** and ***',
    });
    expect(JSON.stringify(planned)).not.toContain(HELD);
    expect(JSON.stringify(planned)).not.toContain(KEY);
  });

  it('says a field the app gives none of has drifted, and holds no value', async () => {
    const none: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () => Promise.resolve({ id: null, name: 'login', fields: {} }),
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([none]), known: RECORDED }),
    );
    expect(planned.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'field',
        field: 'user',
        expected: 'admin',
        actual: null,
        unreadable: 'the app gave none',
      },
    ]);
  });

  it("finds no drift in a field the stack no longer sets: apply doesn't set it", async () => {
    // Applied with a user name, which the stack no longer gives.
    const unset: ResourceSpec = {
      ...FAKE_LOGIN,
      desired: (ctx) => {
        const wanted = FAKE_LOGIN.desired(ctx);
        return wanted === undefined ? undefined : { ...wanted, fields: {} };
      },
    };
    for (const held of [{}, { user: 'someone' }] as Fields[]) {
      const odd: ResourceSpec = {
        ...unset,
        observe: () => Promise.resolve({ id: null, name: 'login', fields: held }),
      };
      const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
      const planned = await planWiring(
        options(sonarr, { stack: sonarrWith([odd]), known: RECORDED }),
      );
      expect(planned.drift, JSON.stringify(held)).toEqual([]);
    }
  });

  it('gives a check what it may do and ask in plan, and says why it left one undone', async () => {
    const seen: unknown[] = [];
    const careful: ResourceSpec = {
      ...FAKE_LOGIN,
      verify: (_api, _desired, _observed, ctx) => {
        seen.push(ctx?.readOnly, ctx?.peer('sonarr')?.name, ctx?.peer('radarr'));
        return Promise.resolve({ unchecked: 'it would make a category' });
      },
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([careful]), known: RECORDED }),
    );
    // The fixture's Sonarr is named by its id.
    expect(seen).toEqual([true, 'sonarr', undefined]);
    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
    expect(planned.checks).toEqual([
      {
        resource: 'sonarr.login',
        secret: 'password',
        verdict: 'unchecked',
        reason: 'it would make a category',
      },
    ]);
  });
});

describe('planWiring: overrides (spec §4.2, §6.3)', () => {
  it("wants the override's value, so that what the app holds now matches", async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, {
        stack: sonarrWith([FAKE_LOGIN], 'sonarr.login.user: someone'),
        known: RECORDED,
      }),
    );
    // Applied as "admin": what the app holds is what the stack now wants, so no drift.
    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'adopt' }]);
    expect(planned.drift).toEqual([]);
  });

  it('lists nothing for a resource it no longer manages, and asks nothing of it', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([FAKE_LOGIN], 'sonarr.login: unmanaged') }),
    );
    expect(planned.changes).toEqual([{ resource: 'sonarr', action: 'unchanged' }]);
    expect(sonarr.app.requests.map((r) => r.path)).toEqual([
      '/ping',
      '/api/v3/system/status',
    ]);
  });

  it('keeps the override over what only the app can say', async () => {
    const resolved: ResourceSpec = {
      ...FAKE_LOGIN,
      resolve: (_api, desired) =>
        Promise.resolve({ ...desired, fields: { ...desired.fields, user: 'chosen' } }),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'kept', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, {
        stack: sonarrWith([resolved], 'sonarr.login.user: kept'),
        known: {
          'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'kept' } },
        } as KnownResources,
      }),
    );
    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
  });

  it('compares a list as a set, whatever its order', async () => {
    const listed: ResourceSpec = {
      ...FAKE_LOGIN,
      lists: ['user'],
      observe: () =>
        Promise.resolve({ id: null, name: 'login', fields: { user: 'b,a' } }),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const known = {
      'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'a,b' } },
    } as KnownResources;
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([listed], 'sonarr.login.user: a,b'), known }),
    );
    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
    expect(planned.drift).toEqual([]);
    // Written with spaces after its commas, it is the same list.
    const spaced = await planWiring(
      options(sonarr, {
        stack: sonarrWith([listed], 'sonarr.login.user: "a, b"'),
        known,
      }),
    );
    expect(spaced.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
    expect(listItems(' a , ,b ')).toEqual(['a', 'b']);
  });
});

describe('planWiring: what drift adds (spec §6.3)', () => {
  const AT = '2026-10-20T08:00:00.000Z';
  const DAY = 24 * 60 * 60 * 1000;
  const passed = {
    'sonarr.login': {
      ...RECORDED['sonarr.login'],
      checks: { password: { verdict: 'passed', at: AT } },
    },
  } as KnownResources;

  it('checks a secret that passed again only once its resource says it may', async () => {
    const seldom: ResourceSpec = { ...FAKE_LOGIN, checkEvery: DAY };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const at = (iso: string) => ({ now: () => new Date(iso) });
    const soon = await planWiring(
      options(sonarr, {
        stack: sonarrWith([seldom]),
        known: passed,
        drift: at('2026-10-20T20:00:00.000Z'),
      }),
    );
    expect(soon.checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'passed', at: AT },
    ]);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
    // A day on, it signs in again; and plan always does.
    const later = await planWiring(
      options(sonarr, {
        stack: sonarrWith([seldom]),
        known: passed,
        drift: at('2026-10-21T08:00:00.000Z'),
      }),
    );
    expect(later.checks).toEqual([
      { resource: 'sonarr.login', secret: 'password', verdict: 'passed' },
    ]);
    const signIns = sonarr.app.requests.filter((r) => r.path === '/login').length;
    await planWiring(options(sonarr, { stack: sonarrWith([seldom]), known: passed }));
    expect(sonarr.app.requests.filter((r) => r.path === '/login').length).toBe(
      signIns + 1,
    );
  });

  it('says an app refuses the key Mediaplane holds for it, and which resources hold that key', async () => {
    // Sonarr refuses its key, changed in Sonarr; qBittorrent's resource holds it.
    const holds: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'link',
      desired: (ctx) => ({
        name: 'link',
        fields: { user: 'admin' },
        secrets: { password: ctx.keys.sonarr?.apiKey ?? '' },
      }),
    };
    const catalog: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'qbittorrent'
        ? {
            ...def,
            api: FIXTURE_API,
            integration: { after: ['sonarr'], resources: [holds] },
          }
        : def,
    );
    const QBT = '7'.repeat(32);
    const sonarr = await fakeSonarr({ key: QBT, user: 'admin', password: KEY });
    const planned = await planWiring(
      options(sonarr, {
        stack: stackOf(catalog),
        keys: { sonarr: { apiKey: KEY }, qbittorrent: { apiKey: QBT } },
        secrets: [KEY, QBT, PASSWORD],
      }),
    );
    expect(planned.drift).toEqual([
      { resource: 'sonarr', kind: 'key', secret: 'apiKey' },
      {
        resource: 'qbittorrent.link',
        kind: 'key',
        secret: 'password',
        source: 'sonarr',
      },
    ]);
    expect(planned.changes[0]).toMatchObject({
      resource: 'sonarr.login',
      action: 'unknown',
    });
    expect(JSON.stringify(planned)).not.toContain(KEY);
  });

  it('says what Mediaplane made that the stack no longer wants is still in the app', async () => {
    const gone: ResourceSpec = { ...FAKE_LOGIN, name: 'gone', desired: () => undefined };
    const vanished: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'vanished',
      desired: () => undefined,
      observe: () => Promise.resolve(undefined),
    };
    const failing: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'failing',
      desired: () => undefined,
      observe: () => Promise.reject(new AppApiError('no', { kind: 'rejected' })),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const record = (name: string) => ({ ...RECORDED['sonarr.login'], name }) as never;
    const planned = await planWiring(
      options(sonarr, {
        stack: sonarrWith([FAKE_LOGIN, gone, vanished, failing]),
        known: {
          ...RECORDED,
          'sonarr.gone': record('gone'),
          'sonarr.vanished': record('vanished'),
          'sonarr.failing': record('failing'),
        },
      }),
    );
    expect(planned.drift).toEqual([{ resource: 'sonarr.gone', kind: 'left' }]);
    // One the app can't say about is never said to be gone: it couldn't be looked at.
    const said =
      "Mediaplane made sonarr.failing, which the stack no longer wants, and couldn't tell whether sonarr still holds it: no";
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'unchanged' },
      { resource: 'sonarr.failing', action: 'unknown', reason: said },
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'drift.left-unknown',
        message: said,
      }),
    ]);
  });

  it('sends an app no key it was found refusing, until apply checks it, nor checks what holds it', async () => {
    // qBittorrent's resource holds Sonarr's key, and asks Sonarr with it to say a value.
    let resolved = 0;
    const holds: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'link',
      desired: (ctx) => ({
        name: 'link',
        fields: { user: 'admin' },
        secrets: { password: ctx.keys.sonarr?.apiKey ?? '' },
      }),
      resolve: (_api, desired) => {
        resolved++;
        return Promise.resolve(desired);
      },
      verify: () => Promise.reject(new Error('never checked while the key is refused')),
    };
    const catalog: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'qbittorrent'
        ? {
            ...def,
            api: FIXTURE_API,
            integration: { after: ['sonarr'], resources: [holds] },
          }
        : def,
    );
    const QBT = '7'.repeat(32);
    // One fake answers for both: it takes qBittorrent's key.
    const sonarr = await fakeSonarr({ key: QBT, user: 'admin', password: PASSWORD });
    const both = {
      ...sonarr,
      // qBittorrent is reached through Gluetun, whose network it shares.
      addresses: { ...sonarr.addresses, 'fake-gluetun': '127.0.0.1' },
    };
    const planned = await planWiring(
      options(both, {
        stack: stackOf(catalog),
        keys: { sonarr: { apiKey: KEY }, qbittorrent: { apiKey: QBT } },
        secrets: [KEY, QBT, PASSWORD],
        known: {
          ...RECORDED,
          'sonarr.gone': { ...(RECORDED['sonarr.login'] as KnownResource), name: 'gone' },
        },
        refusedKeys: { 'sonarr.apiKey': { verdict: 'refused', at: AT } },
      }),
    );
    // Sonarr isn't sent its key at all.
    expect(sonarr.app.requests.filter((r) => r.headers['x-api-key'] === KEY)).toEqual([]);
    expect(planned.drift).toEqual([
      { resource: 'sonarr', kind: 'key', secret: 'apiKey', since: AT },
      { resource: 'qbittorrent.link', kind: 'key', secret: 'password', source: 'sonarr' },
    ]);
    const reason = `sonarr refused the key Mediaplane holds for it (apiKey) at ${AT}, so it isn't sent again until apply checks it; see ${WIRING_RUNBOOK}`;
    expect(planned.changes.slice(0, 1)).toEqual([
      { resource: 'sonarr.login', action: 'unknown', reason },
    ]);
    // What only the holder's app can say isn't asked, nor are its secrets checked.
    expect(resolved).toBe(0);
    expect(planned.checks).toEqual([
      {
        resource: 'qbittorrent.link',
        secret: 'password',
        verdict: 'unchecked',
        reason: `sonarr refuses its own key, which this holds, so neither is checked until the key is put back, as ${WIRING_RUNBOOK} shows`,
      },
    ]);
  });

  it('asks nothing only the app can say of a resource with a secret found refused, until apply', async () => {
    let resolved = 0;
    const asks: ResourceSpec = {
      ...FAKE_LOGIN,
      resolve: (_api, desired) => {
        resolved++;
        return Promise.resolve(desired);
      },
    };
    const found = {
      'sonarr.login': {
        ...RECORDED['sonarr.login'],
        checks: { password: { verdict: 'refused', at: AT } },
      },
    } as KnownResources;
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, { stack: sonarrWith([asks]), known: found }),
    );
    expect(resolved).toBe(0);
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
    // Without one found refused, it is asked.
    await planWiring(options(sonarr, { stack: sonarrWith([asks]), known: RECORDED }));
    expect(resolved).toBe(1);
  });

  it("asks nothing more of an app that stopped answering: what is left there isn't looked at", async () => {
    let looked = 0;
    const stops: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.reject(new AppApiError('gone quiet', { kind: 'unreachable' })),
    };
    const gone: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'gone',
      desired: () => undefined,
      observe: () => {
        looked++;
        return Promise.resolve(undefined);
      },
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const planned = await planWiring(
      options(sonarr, {
        stack: sonarrWith([stops, gone]),
        known: {
          ...RECORDED,
          'sonarr.gone': { ...(RECORDED['sonarr.login'] as KnownResource), name: 'gone' },
        },
      }),
    );
    expect(looked).toBe(0);
    expect(planned.changes).toEqual([
      { resource: 'sonarr.login', action: 'unknown', reason: 'gone quiet' },
      {
        resource: 'sonarr.gone',
        action: 'unknown',
        reason:
          "Mediaplane made sonarr.gone, which the stack no longer wants, and couldn't ask sonarr whether it still holds it: gone quiet",
      },
    ]);
  });

  it("reads the app's own health check in drift only, and says what it found", async () => {
    const watched: ResourceSpec = {
      ...FAKE_LOGIN,
      health: () => Promise.resolve(`the proxy is down, ${PASSWORD}`),
    };
    const failing: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'other',
      health: () => Promise.reject(new AppApiError('no', { kind: 'server' })),
    };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const stack = sonarrWith([watched, failing]);
    expect((await planWiring(options(sonarr, { stack }))).diagnostics).toEqual([]);
    const found = await planWiring(
      options(sonarr, { stack, drift: { now: () => new Date(AT) } }),
    );
    expect(found.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'drift.health',
        message: 'sonarr.login: the proxy is down, ***',
      }),
      // One it can't read is said to be, never taken as healthy.
      expect.objectContaining({
        code: 'drift.health',
        message: "sonarr.other: its app's own health check could not be read: no",
      }),
    ]);
  });
});
