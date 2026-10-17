import { join } from 'node:path';
import {
  AppApiError,
  bootstrapApps,
  BootstrapFailed,
  createAppApi,
  HelperError,
  inspectBootstrap,
  readSecretStore,
  resolveStack,
  RuntimeError,
  SetupWaiting,
  type AppApi,
  type AppApiErrorKind,
  type BootstrapContext,
  type PlexTv,
  type ResolvedStack,
  type SecretStore,
} from '@mediaplane/engine';
import {
  claimFakePlex,
  FAKE_PLEX_ACCOUNT,
  fakeContainer,
  fakeJellyfinSetUp,
  fakePlexTv,
  fakeRuntime,
  fakeStackApis,
  FIXTURE_HOST,
  fixtureConfig,
  freshAppState,
  NO_SETUP_CONTEXT,
  SEERR_JELLYFIN,
  SET_UP_JELLYFIN,
  tempDir,
  thrown,
  wiringStack,
  type FakeAppState,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { seerrBootstrap } from './bootstrap';

const PASSWORD = SET_UP_JELLYFIN.password;
const ADMIN = { username: 'admin', password: PASSWORD };
const JELLYFIN_KEY = SET_UP_JELLYFIN.key;
const SEERR_KEY = '5'.repeat(32);
/** The key Seerr made itself in Jellyfin, which the client isn't told of. */
const SEERRS_OWN = '6'.repeat(32);

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;

/** The stack's fakes, Seerr as it first starts unless `seerr` says, and a client of it. */
async function seerrOf(
  jellyfin: FakeAppState = fakeJellyfinSetUp(),
  seerr: Partial<FakeAppState['seerr']> = {},
) {
  const apis = await fakeStackApis();
  apis.apps.set('jellyfin', jellyfin);
  const state = { ...freshAppState(), key: SEERR_KEY };
  Object.assign(state.seerr, structuredClone(seerr));
  apis.apps.set('seerr', state);
  const api = createAppApi({
    name: 'Seerr',
    service: 'seerr',
    port: 5055,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SEERR_KEY },
    secrets: [PASSWORD, JELLYFIN_KEY, SEERR_KEY],
    retry: { deadlineMs: 0 },
  });
  const calls = () => apis.app.requests.map(callOf);
  return { api, state, calls, stack: wiringStack(catalog, STACK) };
}

/** `api`, but for `path`, which fails as `kind` from its `nth` call on (1 by default). */
function failingAt(api: AppApi, path: string, kind: AppApiErrorKind, nth = 1): AppApi {
  let calls = 0;
  return {
    ...api,
    get: (at: string, schema: never) => {
      if (at === path && ++calls >= nth) {
        return Promise.reject(
          new AppApiError(`fake ${kind} (GET ${at})`, { kind, reachedApp: true }),
        );
      }
      return api.get(at, schema);
    },
  };
}

/** "METHOD /path" of a request. */
const callOf = ({ method, path }: FakeRequest) => `${method} ${path}`;

/** Seerr as its first sign-in left it: the admin, and Jellyfin at its service. */
const SET_UP = {
  mediaServerType: SEERR_JELLYFIN,
  users: ['admin'],
  jellyfin: {
    ip: 'jellyfin',
    port: 8096,
    useSsl: false,
    urlBase: '',
    apiKey: JELLYFIN_KEY,
    libraries: [],
  },
};

/**
 * Someone who signed in first through Jellyfin's service and port, as Mediaplane would,
 * but with a URL base that takes Seerr to a host of their own: Seerr calls
 * `http://jellyfin:8096@198.51.100.7`, where they made a user named as the shared admin.
 */
const THROUGH_ANOTHER_HOST = {
  user: 'admin',
  jellyfin: 'jellyfin',
  urlBase: '@198.51.100.7',
};

describe("Seerr's first-run setup", () => {
  it('signs in through Jellyfin as the shared admin, which sets it up, then signs out', async () => {
    const { api, state, calls, stack } = await seerrOf();
    expect(await seerrBootstrap.open(api)).toBe(true);
    // Its key does nothing yet.
    expect(await thrown(api.check('/api/v1/auth/me'))).toMatchObject({
      kind: 'auth',
      status: 403,
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
    expect(state.seerr).toMatchObject({
      mediaServerType: SEERR_JELLYFIN,
      users: ['admin'],
      jellyfin: { ip: 'jellyfin', port: 8096 },
      // Signed out again.
      sessions: [],
    });
    expect(await seerrBootstrap.open(api)).toBe(false);
    await api.check('/api/v1/auth/me');
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/public',
      'POST /api/v1/auth/jellyfin',
      'POST /api/v1/auth/logout',
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
    ]);
  });

  it("waits while Jellyfin refuses the shared admin's password, leaving Seerr open", async () => {
    const { api, state, stack } = await seerrOf(
      fakeJellyfinSetUp({ password: 'fake-other-password' }),
    );
    const waited = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
    expect(waited).toBeInstanceOf(SetupWaiting);
    expect((waited as Error).message).toBe(
      "Seerr at http://seerr:5055 (127.0.0.1) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)",
    );
    expect(state.seerr.users).toEqual([]);
    expect(await seerrBootstrap.open(api)).toBe(true);
  });

  it("fails, in Seerr's words and without the password, when Seerr can't reach Jellyfin", async () => {
    const { api, stack } = await seerrOf(fakeJellyfinSetUp({ up: false }));
    const failed = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
    expect(failed).toBeInstanceOf(AppApiError);
    expect((failed as AppApiError).message).toBe(
      'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 404): INVALID_URL (POST /api/v1/auth/jellyfin)',
    );
  });

  it("takes as done a Seerr set up with the shared admin and the stack's Jellyfin, asked with the key, never the password", async () => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), SET_UP);
    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/jellyfin',
    ]);
  });

  it.each([
    ['another admin', { users: ['someone'] }],
    ['another Jellyfin', { jellyfin: { ...SET_UP.jellyfin, ip: 'elsewhere' } }],
    ['another port', { jellyfin: { ...SET_UP.jellyfin, port: 4444 } }],
    [
      'a URL base to another host',
      { jellyfin: { ...SET_UP.jellyfin, urlBase: '@198.51.100.7' } },
    ],
    ['a URL base', { jellyfin: { ...SET_UP.jellyfin, urlBase: '/jellyfin' } }],
    ['TLS', { jellyfin: { ...SET_UP.jellyfin, useSsl: true } }],
    ['no admin at all', { users: [] }],
  ])('refuses as not its own a Seerr set up with %s', async (_what, more) => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      ...SET_UP,
      ...more,
    });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
    expect(refused).toBeInstanceOf(AppApiError);
    expect(refused).toMatchObject({ kind: 'auth' });
    expect(calls()).not.toContain('POST /api/v1/auth/jellyfin');
  });

  it('refuses a Seerr someone else signed in to between its look and its sign-in, and signs in once', async () => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      claimant: { user: 'someone', jellyfin: 'jellyfin' },
    });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
    expect(refused).toBeInstanceOf(AppApiError);
    expect(refused).toMatchObject({
      kind: 'auth',
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin)',
    });
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'POST /api/v1/auth/jellyfin',
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/jellyfin',
    ]);
  });

  it("refuses a Seerr someone signed in to first through the stack's Jellyfin address, with a URL base to their own host", async () => {
    const { api, state, stack } = await seerrOf(fakeJellyfinSetUp(), {
      claimant: THROUGH_ANOTHER_HOST,
    });
    expect(
      await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)),
    ).toMatchObject({
      kind: 'auth',
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin)',
    });
    // Its admin has the shared admin's name, and its Jellyfin the stack's ip and port.
    expect(state.seerr).toMatchObject({
      users: ['admin'],
      jellyfin: { ip: 'jellyfin', port: 8096, urlBase: '@198.51.100.7' },
    });
  });

  it('takes as done a Seerr found set up as its own once the sign-in fails, as when its answer was lost', async () => {
    // Set up as Mediaplane's sign-in sets it up, and then the sign-in fails (500).
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      claimant: { user: 'admin', jellyfin: 'jellyfin' },
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
    expect(calls().filter((c) => c === 'POST /api/v1/auth/jellyfin')).toHaveLength(1);
  });

  it('keeps the Jellyfin key Seerr holds out of what it says after', async () => {
    const { api, state, stack } = await seerrOf(fakeJellyfinSetUp(), {
      ...SET_UP,
      jellyfin: { ...SET_UP.jellyfin, apiKey: SEERRS_OWN },
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
    state.seerr.echoKey = true;
    expect(await thrown(api.check('/api/v1/nosuch'))).toMatchObject({
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 404): fake failure, holding *** *** (GET /api/v1/nosuch)',
    });
  });

  it('fails, asking nothing, in a Plex stack without your Plex token to sign in with', async () => {
    const { api, calls } = await seerrOf();
    const plex: ResolvedStack = wiringStack(
      catalog,
      STACK.replace(
        'media_server: jellyfin',
        'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
      ),
    );
    expect(
      await thrown(seerrBootstrap.run(api, ADMIN, plex, NO_SETUP_CONTEXT)),
    ).toMatchObject({
      kind: 'rejected',
      message:
        "Seerr at http://seerr:5055 (127.0.0.1) can't be set up: the stack runs no Plex, or Mediaplane has no Plex token, for it to sign in with",
    });
    expect(calls()).toEqual([]);
  });

  it('says it is done once settings.json names a media server', () => {
    const { pattern } = seerrBootstrap.done;
    expect(seerrBootstrap.done.path).toBe('settings.json');
    // As Seerr writes it: JSON.stringify with a one-space indent.
    expect(pattern.test('{\n "main": {\n  "mediaServerType": 2,\n')).toBe(true);
    expect(pattern.test('{\n "main": {\n  "mediaServerType": 4,\n')).toBe(false);
    expect(pattern.test('{}')).toBe(false);
  });
});

describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", () => {
  /** A question that went unanswered: Mediaplane couldn't tell. */
  const UNANSWERED: AppApiErrorKind[] = ['timeout', 'server', 'unreachable'];
  /** One Seerr answered, in a way that doesn't show the setup is Mediaplane's. */
  const ANSWERED: AppApiErrorKind[] = ['protocol', 'rejected'];

  it.each(UNANSWERED)(
    "refuses as one it couldn't tell is its own, when a question goes unanswered (%s)",
    async (kind) => {
      const { api, stack } = await seerrOf(fakeJellyfinSetUp(), SET_UP);
      for (const path of ['/api/v1/auth/me', '/api/v1/settings/jellyfin']) {
        const refused = await thrown(
          seerrBootstrap.run(failingAt(api, path, kind), ADMIN, stack, NO_SETUP_CONTEXT),
        );
        expect(refused).toBeInstanceOf(AppApiError);
        expect(refused).toMatchObject({ kind: 'auth', unsure: true });
        expect((refused as Error).message).toBe(
          `Seerr at http://seerr:5055 (127.0.0.1) is set up, and Mediaplane couldn't tell whether it is its own: fake ${kind} (GET ${path})`,
        );
      }
    },
  );

  it.each(ANSWERED)(
    "refuses as not its own, not as one it couldn't tell, when Seerr's answer doesn't show it is (%s)",
    async (kind) => {
      const { api, stack } = await seerrOf(fakeJellyfinSetUp(), SET_UP);
      for (const path of ['/api/v1/auth/me', '/api/v1/settings/jellyfin']) {
        const refused = await thrown(
          seerrBootstrap.run(failingAt(api, path, kind), ADMIN, stack, NO_SETUP_CONTEXT),
        );
        expect(refused).toBeInstanceOf(AppApiError);
        expect(refused).toMatchObject({ kind: 'auth', unsure: false });
        expect((refused as Error).message).toBe(
          `Seerr at http://seerr:5055 (127.0.0.1) is set up, and its answers don't show that it is Mediaplane's: fake ${kind} (GET ${path})`,
        );
      }
    },
  );

  it("refuses a Seerr whose Jellyfin settings it can't read, and one claimed through Plex", async () => {
    const { api, stack } = await seerrOf(fakeJellyfinSetUp(), {
      ...SET_UP,
      failing: ['/api/v1/settings/jellyfin'],
    });
    expect(
      await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)),
    ).toMatchObject({
      kind: 'auth',
    });
    // Claimed through Plex: a media-server type of 1, another login, no Jellyfin.
    const plex = await seerrOf(fakeJellyfinSetUp(), {
      mediaServerType: 1,
      users: ['someone'],
    });
    expect(
      await thrown(seerrBootstrap.run(plex.api, ADMIN, plex.stack, NO_SETUP_CONTEXT)),
    ).toMatchObject({
      kind: 'auth',
    });
  });

  it('treats a Seerr it cannot ask about its setup as set up, and checks it', async () => {
    // The look at the start fails: a Seerr that is set up as Mediaplane's is accepted,
    // and an open one is refused (its key does nothing yet), not signed in to blindly.
    const own = await seerrOf(fakeJellyfinSetUp(), SET_UP);
    const lookFails = (api: AppApi) =>
      failingAt(api, '/api/v1/settings/public', 'timeout');
    expect(
      await seerrBootstrap.run(lookFails(own.api), ADMIN, own.stack, NO_SETUP_CONTEXT),
    ).toBeUndefined();
    const fresh = await seerrOf();
    expect(
      await thrown(
        seerrBootstrap.run(lookFails(fresh.api), ADMIN, fresh.stack, NO_SETUP_CONTEXT),
      ),
    ).toMatchObject({ kind: 'auth' });
    expect(fresh.calls()).not.toContain('POST /api/v1/auth/jellyfin');
  });

  it('refuses, as not its own, a Seerr someone else signed in to when the second look fails', async () => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      claimant: { user: 'someone', jellyfin: 'jellyfin' },
    });
    // The second look (after the failed sign-in) is the second call for the public
    // settings.
    const refused = await thrown(
      seerrBootstrap.run(
        failingAt(api, '/api/v1/settings/public', 'server', 2),
        ADMIN,
        stack,
        NO_SETUP_CONTEXT,
      ),
    );
    expect(refused).toMatchObject({ kind: 'auth' });
    expect(calls()).toContain('GET /api/v1/settings/jellyfin');
  });

  it('is done even when signing out fails, which fails nothing', async () => {
    const { api, state, stack } = await seerrOf(fakeJellyfinSetUp(), {
      failing: ['/api/v1/auth/logout'],
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
    expect(state.seerr.mediaServerType).toBe(SEERR_JELLYFIN);
    // Its session runs out by itself.
    expect(state.seerr.sessions).toHaveLength(1);
  });

  it('refuses without inventing an HTTP status that Seerr never sent', async () => {
    const { api, stack } = await seerrOf(fakeJellyfinSetUp(), {
      ...SET_UP,
      users: ['someone'],
    });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
    expect(refused).toMatchObject({ kind: 'auth', status: undefined });
  });
});

describe("Seerr's first-run setup, through the engine's bootstrap step", () => {
  /**
   * Seerr as `seerr` says, in a home of its own, set up by the engine's step as `apply`
   * would run it: planned from its settings.json and the store, then set up. `published`
   * has, for each publishing up, the apps it leaves unpublished.
   */
  async function stepOf(seerr: Partial<FakeAppState['seerr']> = {}) {
    /** Seerr's key is Mediaplane's, generated before it first started. */
    const store: SecretStore = {
      version: 1,
      apps: { seerr: { apiKey: SEERR_KEY } },
      shared: { adminPassword: PASSWORD },
    };
    const home = await tempDir('mediaplane-seerr-');
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', fakeJellyfinSetUp());
    const state = { ...freshAppState(), key: SEERR_KEY };
    Object.assign(state.seerr, structuredClone(seerr), {
      configDir: join(home, 'appdata', 'seerr'),
    });
    apis.apps.set('seerr', state);
    const resolved = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, home);
    if (resolved.stack === undefined)
      throw new Error(JSON.stringify(resolved.diagnostics));
    const { stack } = resolved;
    const runtime = fakeRuntime({
      containers: ['jellyfin', 'seerr'].map((s) => fakeContainer(s, `fake-${s}`)),
      addresses: apis.addresses,
    });
    const published: string[][] = [];
    const run = async (from: SecretStore) => {
      const pending = (await inspectBootstrap(stack, from)).changes.filter(
        (change) => change.app === 'seerr',
      );
      const set = await bootstrapApps({
        home,
        stack,
        store: from,
        values: {},
        env: {},
        runtime,
        project: 'mediaplane',
        pending,
        publish: (unpublished) => {
          published.push([...unpublished]);
          return Promise.resolve();
        },
        seams: apis.seams,
      });
      return { pending, ...set };
    };
    return { home, state, published, run, store, apis };
  }

  it('signs a fresh Seerr in, records it, and publishes it', async () => {
    const { home, state, published, run, store } = await stepOf();
    const first = await run(store);
    expect(first.pending).toEqual([{ app: 'seerr', unpublished: true }]);
    expect(first.detail).toBe('set up seerr; published seerr');
    expect(published).toEqual([[]]);
    expect(state.seerr).toMatchObject({ mediaServerType: SEERR_JELLYFIN, sessions: [] });
    expect((await readSecretStore(home)).setUp).toEqual(['seerr']);
    // Recorded, and its file says so: nothing more to do.
    const again = await run(first.store);
    expect(again.pending).toEqual([]);
  });

  it("keeps unpublished, unrecorded, a Seerr claimed through the stack's Jellyfin address with a URL base to another host", async () => {
    const { home, state, published, run, store } = await stepOf({
      claimant: THROUGH_ANOTHER_HOST,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await thrown(run(store));
      expect(failed).toBeInstanceOf(BootstrapFailed);
      expect((failed as Error).message).toContain(
        'was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin)',
      );
    }
    expect(state.seerr.jellyfin).toMatchObject({
      ip: 'jellyfin',
      urlBase: '@198.51.100.7',
    });
    expect(published).toEqual([['seerr'], ['seerr']]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it("keeps unpublished a Seerr it couldn't tell is its own, and says to run apply again first, never to start it afresh", async () => {
    const { home, state, published, run, store } = await stepOf({
      ...SET_UP,
      failing: ['/api/v1/settings/jellyfin'],
      failStatus: 500,
    });
    const failed = await thrown(run(store));
    expect(failed).toBeInstanceOf(BootstrapFailed);
    expect((failed as Error).message).toContain(
      "Seerr at http://seerr:5055 (127.0.0.1) is set up, and Mediaplane couldn't tell whether it is its own: Seerr at http://seerr:5055 (127.0.0.1) failed (HTTP 500): fake failure (GET /api/v1/settings/jellyfin); Seerr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. Run apply again first: a failure that was temporary clears, and Seerr, if it is Mediaplane's, is then recorded and published. If it fails again, see the runbook",
    );
    expect((failed as Error).message).not.toContain('afresh');
    expect(published).toEqual([['seerr']]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    // The failure clears: the next apply records it and publishes it.
    state.seerr.failing = [];
    const set = await run(store);
    expect(set.detail).toBe('set up seerr; published seerr');
    expect(set.store.setUp).toEqual(['seerr']);
  });

  it('keeps unpublished, with the claimed routes, a Seerr claimed through a port that takes it to another host', async () => {
    // Seerr doesn't check the sign-in's port, and puts it into the URL as sent:
    // http://jellyfin:8096@198.51.100.7.
    const { home, published, run, store } = await stepOf({
      claimant: { user: 'admin', jellyfin: 'jellyfin', port: '8096@198.51.100.7' },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await thrown(run(store));
      expect(failed).toBeInstanceOf(BootstrapFailed);
      const said = (failed as Error).message;
      expect(said).toContain(
        "Seerr at http://seerr:5055 (127.0.0.1) is set up, and its answers don't show that it is Mediaplane's",
      );
      expect(said).toContain(
        'First: if the Jellyfin login it was set up with is yours, set admin.username and admin.password to it.',
      );
      expect(said).toContain('Last, if you did not set it up: start it afresh');
      expect(said).not.toContain('Run apply again first');
    }
    expect(published).toEqual([['seerr'], ['seerr']]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it('keeps a claimed Seerr unpublished, now and on every later apply, and a Seerr shown to be its own is published', async () => {
    const { home, state, published, run, store } = await stepOf({
      ...SET_UP,
      users: ['someone'],
    });
    // Set up with another login, its file saying so: planned unpublished all the same.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await thrown(run(store));
      expect(failed).toBeInstanceOf(BootstrapFailed);
      expect((failed as Error).message).toContain(
        "was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin); Seerr is set up, but Mediaplane can't show that it is its own, so it stays unpublished",
      );
      // The three ways out, the safe one first: its admin is its first user, and its
      // Jellyfin has to be the stack's.
      expect((failed as Error).message).toContain(
        "Seerr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. First: if the Jellyfin login it was set up with is yours, set admin.username and admin.password to it. Or second: make its admin (its first user) the Jellyfin login that admin.username names. Either needs its Jellyfin already at jellyfin:8096, with no URL base and no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says",
      );
    }
    expect(published).toEqual([['seerr'], ['seerr']]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    // Its admin is the shared admin's: shown to be Mediaplane's, recorded and published.
    state.seerr.users = ['admin'];
    const set = await run(store);
    expect(set.detail).toBe('set up seerr; published seerr');
    expect(published.at(-1)).toEqual([]);
    expect(set.store.setUp).toEqual(['seerr']);
  });
});

describe("Seerr's first-run setup, with Plex", () => {
  const TOKEN = FAKE_PLEX_ACCOUNT.token;
  /** Another plex.tv account, which could sign in to Seerr first. */
  const SOMEONE = { id: 7_000_099, token: 'someone-plex-token-9' };
  const PLEX_STACK = STACK.replace(
    'media_server: jellyfin',
    'media_server: plex\nplex: { token: { file: secrets/plex-token } }',
  );

  /** The stack's fakes: a Plex your account claimed, Seerr as `seerr` says, a client of it. */
  async function plexSeerrOf(seerr: Partial<FakeAppState['seerr']> = {}) {
    const plexTv = await fakePlexTv();
    plexTv.state.accounts.push({ ...SOMEONE });
    const apis = await fakeStackApis(plexTv.state);
    const plex = freshAppState();
    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    apis.apps.set('plex', plex);
    const state = { ...freshAppState(), key: SEERR_KEY };
    Object.assign(state.seerr, structuredClone(seerr));
    apis.apps.set('seerr', state);
    const api = createAppApi({
      name: 'Seerr',
      service: 'seerr',
      port: 5055,
      endpoint: { host: '127.0.0.1', port: apis.app.port },
      key: { scheme: 'x-api-key', value: SEERR_KEY },
      secrets: [SEERR_KEY, TOKEN],
      retry: { deadlineMs: 0 },
    });
    const ctx: BootstrapContext = {
      keys: { plex: { token: TOKEN } },
      plexTv: plexTv.client,
    };
    return {
      api,
      state,
      plexTv,
      ctx,
      calls: () => apis.app.requests.map(callOf),
      stack: wiringStack(catalog, PLEX_STACK),
    };
  }

  /** Seerr as its first sign-in with your plex.tv account left it: Plex not set yet. */
  const SIGNED_IN = {
    mediaServerType: 1,
    plexUsers: [FAKE_PLEX_ACCOUNT.id],
    plexTokens: { [FAKE_PLEX_ACCOUNT.id]: TOKEN },
  };

  it('signs in with your plex.tv token, which makes your account its admin, then signs out', async () => {
    const { api, state, calls, ctx, stack } = await plexSeerrOf();
    expect(await seerrBootstrap.open(api)).toBe(true);
    expect(await seerrBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
    expect(state.seerr).toMatchObject({
      mediaServerType: 1,
      plexUsers: [FAKE_PLEX_ACCOUNT.id],
      sessions: [],
    });
    expect(await seerrBootstrap.open(api)).toBe(false);
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/settings/public',
      'POST /api/v1/auth/plex',
      'POST /api/v1/auth/logout',
      'GET /api/v1/settings/public',
    ]);
    // The shared admin's password never went to Seerr: your token did, once.
    expect(JSON.stringify(state.seerr)).not.toContain(PASSWORD);
  });

  it("says why when Seerr can't check your token at plex.tv", async () => {
    const { api, plexTv, stack } = await plexSeerrOf();
    const refused = await thrown(
      seerrBootstrap.run(api, ADMIN, stack, {
        keys: { plex: { token: 'revoked-plex-token-0' } },
        plexTv: plexTv.client,
      }),
    );
    expect(refused).toMatchObject({
      kind: 'rejected',
      message:
        "Seerr at http://seerr:5055 (127.0.0.1) couldn't sign in with your Plex token, which it checks at plex.tv: Seerr at http://seerr:5055 (127.0.0.1) failed (HTTP 500): Unable to authenticate. (POST /api/v1/auth/plex). Check that Seerr reaches plex.tv, then run apply again",
    });
  });

  it("takes as its own a Seerr set up with your plex.tv account, its Plex unset or the stack's, asking plex.tv, never signing in", async () => {
    for (const plex of [
      { ip: '', port: 32400, useSsl: false, libraries: [] },
      { ip: 'plex', port: 32400, useSsl: false, libraries: [] },
    ]) {
      const { api, calls, ctx, stack, plexTv } = await plexSeerrOf({
        ...SIGNED_IN,
        plex,
      });
      expect(await seerrBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
      expect(calls()).not.toContain('POST /api/v1/auth/plex');
      expect(plexTv.state.calls.at(-1)).toBe('GET /api/v2/user');
    }
  });

  it('refuses a Seerr set up with another plex.tv account, or another Plex, as claimed', async () => {
    for (const seerr of [
      { ...SIGNED_IN, plexUsers: [SOMEONE.id] },
      {
        ...SIGNED_IN,
        plex: { ip: 'plex', port: 32400, useSsl: true, libraries: [] },
      },
      {
        ...SIGNED_IN,
        plex: { ip: '198.51.100.7', port: 32400, useSsl: false, libraries: [] },
      },
    ]) {
      const { api, ctx, stack, calls } = await plexSeerrOf(seerr);
      expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
        kind: 'auth',
        unsure: false,
        message:
          'Seerr at http://seerr:5055 (127.0.0.1) was set up with another plex.tv account or another Plex (GET /api/v1/auth/me, GET /api/v1/settings/plex)',
      });
      // Your token never went to that Seerr.
      expect(calls()).not.toContain('POST /api/v1/auth/plex');
    }
  });

  it("refuses, as unsure, a set-up Seerr when plex.tv can't say whose your token is", async () => {
    const { api, ctx, stack, plexTv } = await plexSeerrOf(SIGNED_IN);
    plexTv.state.failing.push({ path: '/api/v2/user', status: 503 });
    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
      kind: 'auth',
      unsure: true,
    });
  });

  it('refuses, as unsure, a set-up Seerr when plex.tv answers 403, which is not a refusal of your token', async () => {
    const { api, ctx, stack, plexTv } = await plexSeerrOf(SIGNED_IN);
    plexTv.state.failing.push({ path: '/api/v2/user', status: 403 });
    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
      kind: 'auth',
      unsure: true,
    });
  });

  it('refuses, as not its own, a set-up Seerr when plex.tv refuses your token (401), and says to sign in again', async () => {
    const { api, ctx, stack, plexTv } = await plexSeerrOf(SIGNED_IN);
    plexTv.state.failing.push({ path: '/api/v2/user', status: 401 });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx));
    expect(refused).toMatchObject({ kind: 'rejected' });
    expect((refused as Error).message).toContain(
      'plex.tv refused your Plex token when asked whose it is',
    );
    expect((refused as Error).message).toContain('mediaplane plex-login');
  });

  it('treats a failure to call plex.tv at all, for a set-up Seerr, as unsure, naming only its kind', async () => {
    const { api, ctx, stack, plexTv, calls } = await plexSeerrOf(SIGNED_IN);
    const text = `fake: the helper said ${TOKEN}`;
    // A rejection that needn't be an Error, to see what a failure of any kind shows.
    /* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
    const broken = (cause: unknown): PlexTv => ({
      ...plexTv.client,
      accountId: () => Promise.reject(cause),
    });
    /* eslint-enable @typescript-eslint/prefer-promise-reject-errors */
    for (const [cause, kind] of [
      [new HelperError(text), 'HelperError'],
      [new RuntimeError(text), 'RuntimeError'],
      [text, 'not an Error'],
    ] as const) {
      const failed = await thrown(
        seerrBootstrap.run(api, ADMIN, stack, { ...ctx, plexTv: broken(cause) }),
      );
      expect(failed).toBeInstanceOf(AppApiError);
      expect(failed).toMatchObject({
        kind: 'auth',
        unsure: true,
        message: `Seerr at http://seerr:5055 (127.0.0.1) is set up, and Mediaplane couldn't tell whether it is its own: the call to plex.tv failed (${kind})`,
      });
      expect((failed as Error).message).not.toContain(TOKEN);
    }
    // Your token never went to that Seerr.
    expect(calls()).not.toContain('POST /api/v1/auth/plex');
  });

  it('refuses a Seerr someone signed in to first, with their own plex.tv account', async () => {
    const { api, ctx, stack, state } = await plexSeerrOf({
      plexClaimant: { plexId: SOMEONE.id, token: SOMEONE.token },
    });
    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
      kind: 'auth',
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) was set up with another plex.tv account or another Plex (GET /api/v1/auth/me, GET /api/v1/settings/plex)',
    });
    expect(state.seerr.plexUsers).toEqual([SOMEONE.id]);
  });

  it('gives the remedies for a claimed Seerr on a Plex stack, starting afresh last', () => {
    expect(seerrBootstrap.claimedHint?.(wiringStack(catalog, PLEX_STACK), 'x')).toBe(
      'First: if the plex.tv account it was set up with is yours, run "mediaplane plex-login" and sign in as it, with its Plex unset or at plex:32400, with no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says',
    );
  });
});
