import {
  AppApiError,
  createAppApi,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeStackApis,
  freshAppState,
  wiringStack,
  type FakeAppState,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import integration from './integration';

const KEY = `qbt_${'0'.repeat(28)}`;
const PASSWORD = 'fake-admin-password';

/** A stack with Sonarr and qBittorrent behind the VPN, on the LAN, as `extra` says. */
function stack(extra = '', apps = '  sonarr: {}\n') {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: lan }
${extra}media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
${apps}  qbittorrent: {}
`,
  );
}

function contextOf(resolved = stack()): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'qbittorrent');
  if (app === undefined) throw new Error('no qBittorrent in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: PASSWORD },
    keys: { qbittorrent: { apiKey: KEY } },
  };
}

function resource(name: string): ResourceSpec {
  const found = integration.resources.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no ${name} resource`);
  return found;
}

/**
 * qBittorrent behind Gluetun, as fakeStackApis fakes it, holding the shared login and its
 * key, then `held`; and a client for it.
 */
async function qbittorrent(held: Partial<FakeAppState> = {}) {
  const apis = await fakeStackApis();
  const state: FakeAppState = {
    ...freshAppState(),
    user: 'admin',
    password: PASSWORD,
    key: KEY,
    ...held,
  };
  apis.apps.set('qbittorrent', state);
  const api = createAppApi({
    name: 'qBittorrent',
    service: 'gluetun',
    port: 8080,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'bearer', value: KEY },
    secrets: [KEY, PASSWORD],
    retry: { deadlineMs: 0 },
  });
  return { api, app: apis.app, state };
}

describe("qBittorrent's integration", () => {
  it('manages the login, the settings, and a category for each arr, in that order', () => {
    expect(integration.after).toEqual([]);
    expect(integration.resources.map((r) => [r.name, r.fields, r.secrets])).toEqual([
      ['admin', ['username'], ['password']],
      [
        'preferences',
        ['savePath', 'autoTmm', 'authSubnetWhitelistEnabled', 'authSubnetWhitelist'],
        [],
      ],
      ['category_tv', ['savePath'], []],
      ['category_movies', ['savePath'], []],
    ]);
  });

  describe('admin', () => {
    const admin = resource('admin');
    const desired = admin.desired(contextOf());
    if (desired === undefined) throw new Error('the admin is always wanted');

    it('reads the user name from the preferences, and checks the password by signing in', async () => {
      const { api, app } = await qbittorrent();
      const observed = await admin.observe(api, undefined);
      expect(observed).toEqual({
        id: null,
        name: 'admin',
        fields: { username: 'admin' },
      });
      if (observed === undefined) throw new Error('no admin observed');
      expect(await admin.verify?.(api, desired, observed)).toBe(true);
      const login = app.requests.find((r) => r.path === '/api/v2/auth/login');
      // A sign-in carries no key.
      expect(login?.headers.authorization).toBeUndefined();
      expect(
        await admin.verify?.(
          api,
          { ...desired, secrets: { password: 'other-password' } },
          observed,
        ),
      ).toBe(false);
    });

    it('sets the user name and the password through the preferences, with the key', async () => {
      const { api, app, state } = await qbittorrent({
        user: 'someone',
        password: 'old-password',
      });
      const observed = await admin.observe(api, undefined);
      if (observed === undefined) throw new Error('no admin observed');
      await admin.update(api, desired, observed);
      expect(state).toMatchObject({ user: 'admin', password: PASSWORD });
      const set = app.requests.find((r) => r.path === '/api/v2/app/setPreferences');
      expect(set?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(JSON.parse(new URLSearchParams(set?.body).get('json') ?? '')).toEqual({
        web_ui_username: 'admin',
        web_ui_password: PASSWORD,
      });
    });

    it('says when qBittorrent has banned the address from signing in, never that the password is wrong', async () => {
      // Five wrong passwords in a row, and qBittorrent refuses every sign-in.
      const { api, state } = await qbittorrent({ password: 'changed-in-the-web-ui' });
      const observed = await admin.observe(api, undefined);
      if (observed === undefined) throw new Error('no admin observed');
      for (let failed = 0; failed < 5; failed++) {
        expect(await admin.verify?.(api, desired, observed)).toBe(false);
      }
      state.password = PASSWORD;
      const failure = await admin
        .verify?.(api, desired, observed)
        .catch((thrown: unknown) => thrown);
      expect(failure).toBeInstanceOf(AppApiError);
      expect((failure as AppApiError).message).toContain(
        'refused the request (HTTP 403): Your IP address has been banned after too many failed authentication attempts.',
      );
      // Its key still works, so the password can still be set; a restart lifts the ban.
      await admin.update(api, desired, observed);
      state.signInFailures = 0;
      expect(await admin.verify?.(api, desired, observed)).toBe(true);
    });
  });

  describe('preferences', () => {
    const settings = resource('preferences');

    it('wants the save path and Automatic Torrent Management, and no LAN without a login', () => {
      expect(settings.desired(contextOf())).toEqual({
        name: 'preferences',
        fields: {
          savePath: '/data/torrents',
          autoTmm: true,
          authSubnetWhitelistEnabled: false,
          authSubnetWhitelist: '',
        },
        secrets: {},
      });
    });

    it('lets the LAN skip the login only when the stack says so, on the LAN', () => {
      const lanless = 'security: { login_on_lan: false }\n';
      expect(settings.desired(contextOf(stack(lanless)))?.fields).toMatchObject({
        authSubnetWhitelistEnabled: true,
        authSubnetWhitelist: '192.168.1.0/24',
      });
      const local = wiringStack(
        catalog,
        `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
security: { login_on_lan: false }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`,
      );
      expect(settings.desired(contextOf(local))?.fields).toMatchObject({
        authSubnetWhitelistEnabled: false,
        authSubnetWhitelist: '',
      });
    });

    it("reads them as qBittorrent keeps them, and sets them with qBittorrent's own types", async () => {
      const { api, app, state } = await qbittorrent();
      state.preferences = {
        ...state.preferences,
        save_path: '/data/downloads/',
        auto_tmm_enabled: false,
        bypass_auth_subnet_whitelist_enabled: true,
        bypass_auth_subnet_whitelist: '10.10.0.0/16\n192.168.2.0/24',
      };
      const observed = await settings.observe(api, undefined);
      expect(observed?.fields).toEqual({
        savePath: '/data/downloads',
        autoTmm: false,
        authSubnetWhitelistEnabled: true,
        authSubnetWhitelist: '10.10.0.0/16,192.168.2.0/24',
      });
      if (observed === undefined) throw new Error('no preferences observed');
      const desired = settings.desired(
        contextOf(stack('security: { login_on_lan: false }\n')),
      );
      if (desired === undefined) throw new Error('the preferences are always wanted');
      await settings.update(api, desired, observed);
      const set = app.requests.find((r) => r.path === '/api/v2/app/setPreferences');
      expect(JSON.parse(new URLSearchParams(set?.body).get('json') ?? '')).toEqual({
        save_path: '/data/torrents',
        auto_tmm_enabled: true,
        bypass_auth_subnet_whitelist_enabled: true,
        bypass_auth_subnet_whitelist: '192.168.1.0/24',
      });
      expect((await settings.observe(api, undefined))?.fields).toEqual(desired.fields);
    });
  });

  describe('categories', () => {
    const tv = resource('category_tv');
    const movies = resource('category_movies');

    it("wants a category for each arr in the stack, under qBittorrent's save path", () => {
      expect(tv.desired(contextOf())).toEqual({
        name: 'tv',
        fields: { savePath: '/data/torrents/tv' },
        secrets: {},
      });
      expect(movies.desired(contextOf())).toBeUndefined();
      const both = stack('', '  sonarr: {}\n  radarr: {}\n');
      expect(movies.desired(contextOf(both))?.fields).toEqual({
        savePath: '/data/torrents/movies',
      });
    });

    it('finds a category by its name, makes it, and moves its save path', async () => {
      const { api, state } = await qbittorrent();
      expect(await tv.observe(api, undefined)).toBeUndefined();
      const desired = tv.desired(contextOf());
      if (desired === undefined) throw new Error('the tv category is wanted');
      expect(await tv.create(api, desired)).toEqual({ id: 'tv' });
      expect(state.categories).toEqual({ tv: '/data/torrents/tv' });
      state.categories.tv = '/data/elsewhere/';
      const observed = await tv.observe(api, undefined);
      expect(observed).toEqual({
        id: 'tv',
        name: 'tv',
        fields: { savePath: '/data/elsewhere' },
      });
      if (observed === undefined) throw new Error('no category observed');
      await tv.update(api, desired, observed);
      expect(state.categories).toEqual({ tv: '/data/torrents/tv' });
    });

    it("wants the category Sonarr's download client is kept with, so that apply makes it, never the arr's test", async () => {
      const kept = stack('overrides:\n  sonarr.download_client.category: television\n');
      const desired = tv.desired(contextOf(kept));
      expect(desired).toEqual({
        name: 'television',
        fields: { savePath: '/data/torrents/television' },
        secrets: {},
      });
      if (desired === undefined) throw new Error('the tv category is wanted');
      // Found by that name, and made under it; the category tv stays as it is, yours.
      const { api, state } = await qbittorrent({
        categories: { tv: '/data/torrents/tv' },
      });
      expect(await tv.observe(api, undefined, desired)).toBeUndefined();
      expect(await tv.create(api, desired)).toEqual({ id: 'television' });
      expect(state.categories).toEqual({
        tv: '/data/torrents/tv',
        television: '/data/torrents/television',
      });
      expect(await tv.observe(api, undefined, desired)).toEqual({
        id: 'television',
        name: 'television',
        fields: { savePath: '/data/torrents/television' },
      });
      // Once the client is no longer Mediaplane's, the category is tv again.
      const unmanaged = stack(
        'overrides:\n  sonarr.download_client: unmanaged\n  sonarr.download_client.category: television\n',
      );
      expect(tv.desired(contextOf(unmanaged))?.name).toBe('tv');
    });

    it("says qBittorrent's own words when it refuses", async () => {
      const { api } = await qbittorrent({ categories: { tv: '/data/torrents/tv' } });
      const desired = tv.desired(contextOf());
      if (desired === undefined) throw new Error('the tv category is wanted');
      const failure = await tv.create(api, desired).catch((thrown: unknown) => thrown);
      expect((failure as AppApiError).message).toContain(
        'refused the request (HTTP 409): Unable to create category',
      );
    });
  });
});
