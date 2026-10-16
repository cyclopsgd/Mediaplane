import {
  AppApiError,
  createAppApi,
  SetupWaiting,
  type ResolvedStack,
} from '@mediaplane/engine';
import {
  fakeJellyfinSetUp,
  fakeStackApis,
  freshAppState,
  SEERR_JELLYFIN,
  SET_UP_JELLYFIN,
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

/** "METHOD /path" of a request. */
const callOf = ({ method, path }: FakeRequest) => `${method} ${path}`;

/** Seerr as its first sign-in left it: the admin, and Jellyfin at its service. */
const SET_UP = {
  mediaServerType: SEERR_JELLYFIN,
  users: ['admin'],
  jellyfin: { ip: 'jellyfin', port: 8096, apiKey: JELLYFIN_KEY, libraries: [] },
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
    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
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
    const waited = await thrown(seerrBootstrap.run(api, ADMIN, stack));
    expect(waited).toBeInstanceOf(SetupWaiting);
    expect((waited as Error).message).toBe(
      "Seerr at http://seerr:5055 (127.0.0.1) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)",
    );
    expect(state.seerr.users).toEqual([]);
    expect(await seerrBootstrap.open(api)).toBe(true);
  });

  it("fails, in Seerr's words and without the password, when Seerr can't reach Jellyfin", async () => {
    const { api, stack } = await seerrOf(fakeJellyfinSetUp({ up: false }));
    const failed = await thrown(seerrBootstrap.run(api, ADMIN, stack));
    expect(failed).toBeInstanceOf(AppApiError);
    expect((failed as AppApiError).message).toBe(
      'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 404): INVALID_URL (POST /api/v1/auth/jellyfin)',
    );
  });

  it("takes as done a Seerr set up with the shared admin and the stack's Jellyfin, asked with the key, never the password", async () => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), SET_UP);
    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/jellyfin',
    ]);
  });

  it.each([
    ['another admin', { users: ['someone'] }],
    ['another Jellyfin', { jellyfin: { ...SET_UP.jellyfin, ip: 'elsewhere' } }],
    ['no admin at all', { users: [] }],
  ])('refuses as not its own a Seerr set up with %s', async (_what, more) => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      ...SET_UP,
      ...more,
    });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack));
    expect(refused).toBeInstanceOf(AppApiError);
    expect(refused).toMatchObject({ kind: 'auth' });
    expect(calls()).not.toContain('POST /api/v1/auth/jellyfin');
  });

  it('refuses a Seerr someone else signed in to between its look and its sign-in, and signs in once', async () => {
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      claimant: { user: 'someone', jellyfin: 'jellyfin' },
    });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack));
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

  it('takes as done a Seerr found set up as its own once the sign-in fails, as when its answer was lost', async () => {
    // Set up as Mediaplane's sign-in sets it up, and then the sign-in fails (500).
    const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), {
      claimant: { user: 'admin', jellyfin: 'jellyfin' },
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
    expect(calls().filter((c) => c === 'POST /api/v1/auth/jellyfin')).toHaveLength(1);
  });

  it('keeps the Jellyfin key Seerr holds out of what it says after', async () => {
    const { api, state, stack } = await seerrOf(fakeJellyfinSetUp(), {
      ...SET_UP,
      jellyfin: { ...SET_UP.jellyfin, apiKey: SEERRS_OWN },
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
    state.seerr.echoKey = true;
    expect(await thrown(api.check('/api/v1/nosuch'))).toMatchObject({
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 404): fake failure, holding *** *** (GET /api/v1/nosuch)',
    });
  });

  it('fails in a stack with no Jellyfin to sign in through', async () => {
    const { api, calls } = await seerrOf();
    const plex: ResolvedStack = wiringStack(
      catalog,
      STACK.replace(
        'media_server: jellyfin',
        'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
      ),
    );
    expect(await thrown(seerrBootstrap.run(api, ADMIN, plex))).toMatchObject({
      kind: 'rejected',
      message:
        "Seerr at http://seerr:5055 (127.0.0.1) can't be set up: the stack runs no Jellyfin for it to sign in through",
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
