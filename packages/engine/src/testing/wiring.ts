import { z } from 'zod';
import type { Catalog } from '../catalog/types';
import { networkOf } from '../host/facts';
import type { WiringSeams } from '../integrations/wiring';
import type { ResourceSpec } from '../integrations/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeContainer } from './fakes';
import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixtures';
import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';

/** The stack of the wiring tests: Sonarr, and qBittorrent behind Gluetun. */
export const WIRING_STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

/** `source` resolved against `catalog`, WIRED_CATALOG by default. */
export function wiringStack(
  catalog: Catalog = WIRED_CATALOG,
  source = WIRING_STACK,
): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(source),
    catalog,
    FIXTURE_HOST,
    '/opt/mediaplane',
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** WIRING_STACK's containers, running and healthy, with the fakes' IDs (fake-<service>). */
export const WIRING_RUNNING = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'].map(
  (service) => fakeContainer(service, `fake-${service}`),
);

/**
 * Where the fake apps' containers are on the wiring network, by the fakes' container IDs
 * (fake-<service>): pass it as fakeRuntime's or fakeDocker's `addresses`. The seams send
 * the calls to the fake app whatever the address.
 */
function onWiring(services: readonly string[]): Record<string, string> {
  return Object.fromEntries(services.map((service) => [`fake-${service}`, '127.0.0.1']));
}

/**
 * A resource for engine tests, shaped like the Servarr admin: "sonarr.login", whose `user`
 * is a managed field and whose `password` is a secret, checked by signing in.
 */
export const FAKE_LOGIN: ResourceSpec = {
  name: 'login',
  fields: ['user'],
  secrets: ['password'],
  desired: ({ admin }) => ({
    name: 'login',
    fields: { user: admin.username },
    secrets: { password: admin.password },
  }),
  async observe(api) {
    const { user } = await api.get('/api/v3/login', z.looseObject({ user: z.string() }));
    return user === '' ? undefined : { id: null, name: 'login', fields: { user } };
  },
  async verify(api, desired) {
    const answer = await api.login('/login', {
      password: desired.secrets.password ?? '',
    });
    return answer.location === '/';
  },
  async create(api, desired) {
    await api.put('/api/v3/login', { user: desired.fields.user, ...desired.secrets });
    return { id: null };
  },
  async update(api, desired) {
    await api.put('/api/v3/login', { user: desired.fields.user, ...desired.secrets });
  },
};

/** The fixture catalog, with an API and FAKE_LOGIN for Sonarr. */
export const WIRED_CATALOG: Catalog = fixtureCatalog.map((def) =>
  def.id === 'sonarr'
    ? { ...def, api: FIXTURE_API, integration: { after: [], resources: [FAKE_LOGIN] } }
    : def,
);

/** What one fake app of the real catalog holds; a test may change it between calls. */
export interface FakeAppState {
  /** Its admin user name and password; empty before there is one. */
  user: string;
  password: string;
  /** false: its readiness path answers 503, as while it starts. */
  up: boolean;
  /** qBittorrent's preferences, as its API names them, but for the login above. */
  preferences: Record<string, string | boolean>;
  /** qBittorrent's categories: each one's save path, by name. */
  categories: Record<string, string>;
  /** qBittorrent's API key: the only Bearer token it takes, or any when empty. */
  key: string;
  /**
   * qBittorrent's failed sign-ins in a row. From five on it refuses every sign-in (403,
   * a ban), until a test sets it back to 0, as a restart would; a success resets it.
   */
  signInFailures: number;
  /** Sonarr's or Radarr's download clients, their keys in clear. */
  downloadClients: FakeDownloadClient[];
  /** Sonarr's or Radarr's root folders. */
  rootFolders: { id: number; path: string }[];
  /**
   * Sonarr's or Radarr's own test of a download client fails with this reason (`Host:
   * <reason>`), whatever the client holds; a test may make it repeat a key, as an app
   * may. Empty: it tests the client.
   */
  testFailure: string;
}

/** A download client, as Sonarr and Radarr keep one. */
export interface FakeDownloadClient {
  id: number;
  name: string;
  enable: boolean;
  implementation: string;
  priority: number;
  fields: { name: string; value?: unknown }[];
}

/** A fake app as it first starts: qBittorrent's settings as its pre-start file sets them. */
export function freshAppState(): FakeAppState {
  return {
    user: '',
    password: '',
    up: true,
    preferences: {
      save_path: '/data/torrents',
      auto_tmm_enabled: true,
      bypass_auth_subnet_whitelist_enabled: false,
      bypass_auth_subnet_whitelist: '',
    },
    categories: {},
    key: '',
    signInFailures: 0,
    downloadClients: [],
    rootFolders: [],
    testFailure: '',
  };
}

/** Sonarr's or Radarr's template for a qBittorrent client, as `…/schema` gives it. */
function qbittorrentTemplate(service: string): Omit<FakeDownloadClient, 'id'> & {
  presets: unknown[];
} {
  const category = service === 'radarr' ? 'movieCategory' : 'tvCategory';
  return {
    name: '',
    enable: false,
    implementation: 'QBittorrent',
    priority: 1,
    presets: [],
    fields: [
      { name: 'host', value: 'localhost' },
      { name: 'port', value: 8080 },
      { name: 'useSsl', value: false },
      { name: 'urlBase' },
      { name: 'apiKey' },
      { name: 'username' },
      { name: 'password' },
      { name: category, value: service === 'radarr' ? 'radarr' : 'tv-sonarr' },
    ],
  };
}

/** A download client as the app shows it: its key masked. */
function masked(held: FakeDownloadClient): FakeDownloadClient {
  return {
    ...held,
    fields: held.fields.map((f) =>
      f.name === 'apiKey' && f.value !== undefined ? { ...f, value: '********' } : f,
    ),
  };
}

/**
 * Sonarr's and Radarr's download clients and root folders, as fakeStackApis answers them.
 * A client's test passes when it names qBittorrent's service (gluetun or qbittorrent)
 * and holds qBittorrent's key; otherwise it fails as Sonarr's does.
 */
function fakeServarrDownloads(
  request: FakeRequest,
  service: string,
  state: FakeAppState,
  qbittorrent: FakeAppState,
): FakeReply | undefined {
  const { method, path } = request;
  const clients = '/api/v3/downloadclient';
  if (path === `${clients}/schema`)
    return { status: 200, body: [qbittorrentTemplate(service)] };
  if (path === clients && method === 'GET') {
    return { status: 200, body: state.downloadClients.map(masked) };
  }
  const one = new RegExp(`^${clients}/(\\d+)(\\?forceSave=true)?$`).exec(path);
  const held = state.downloadClients.find((c) => c.id === Number(one?.[1]));
  if (one !== null && method === 'GET') {
    return held === undefined ? { status: 404 } : { status: 200, body: masked(held) };
  }
  if (path === `${clients}?forceSave=true` && method === 'POST') {
    const sent = JSON.parse(request.body) as Omit<FakeDownloadClient, 'id'>;
    if (state.downloadClients.some((c) => c.name === sent.name)) {
      return {
        status: 400,
        body: [{ propertyName: 'Name', errorMessage: 'Should be unique' }],
      };
    }
    const made = { ...sent, id: state.downloadClients.length + 1 };
    state.downloadClients.push(made);
    return { status: 201, body: masked(made) };
  }
  if (one?.[2] !== undefined && method === 'PUT' && held !== undefined) {
    const sent = JSON.parse(request.body) as FakeDownloadClient;
    // "********" keeps the key it holds.
    const key = held.fields.find((f) => f.name === 'apiKey')?.value;
    Object.assign(held, {
      ...sent,
      fields: sent.fields.map((f) =>
        f.name === 'apiKey' && f.value === '********' ? { ...f, value: key } : f,
      ),
    });
    return { status: 202, body: masked(held) };
  }
  if (path === `${clients}/test` && method === 'POST') {
    const sent = JSON.parse(request.body) as FakeDownloadClient;
    const value = (name: string) => sent.fields.find((f) => f.name === name)?.value;
    const stored = state.downloadClients
      .find((c) => c.id === sent.id)
      ?.fields.find((f) => f.name === 'apiKey')?.value;
    const key = value('apiKey') === '********' ? stored : value('apiKey');
    const host = value('host');
    if (state.testFailure !== '') {
      return {
        status: 400,
        body: [
          { propertyName: 'Host', errorMessage: state.testFailure, isWarning: false },
        ],
      };
    }
    if (host !== 'gluetun' && host !== 'qbittorrent') {
      return {
        status: 400,
        body: [
          {
            propertyName: 'Host',
            errorMessage: 'Unable to connect to qBittorrent',
            detailedDescription: `Name does not resolve (${String(host)}:${String(value('port'))})`,
            isWarning: false,
          },
        ],
      };
    }
    const right =
      typeof key === 'string' &&
      key !== '' &&
      (qbittorrent.key === '' || key === qbittorrent.key);
    return right
      ? { status: 200, body: {} }
      : {
          status: 400,
          body: [
            {
              propertyName: 'ApiKey',
              errorMessage: 'Authentication Failure',
              detailedDescription: 'Please verify your credentials.',
              isWarning: false,
            },
          ],
        };
  }
  const folders = '/api/v3/rootfolder';
  if (path === folders && method === 'GET') {
    return {
      status: 200,
      body: state.rootFolders.map((f) => ({ ...f, accessible: true, freeSpace: 1 })),
    };
  }
  if (path === folders && method === 'POST') {
    const { path: wanted } = JSON.parse(request.body) as { path: string };
    if (state.rootFolders.some((f) => f.path === wanted)) {
      return {
        status: 400,
        body: [{ propertyName: 'Path', errorMessage: 'already configured' }],
      };
    }
    const made = { id: state.rootFolders.length + 1, path: wanted };
    state.rootFolders.push(made);
    return { status: 201, body: { ...made, accessible: true } };
  }
  return undefined;
}

/**
 * The APIs of the real catalog's apps, as far as Mediaplane uses them, all on one port
 * of 127.0.0.1: told apart by their Host header ("sonarr:8989", "gluetun:8080"). Sonarr,
 * Radarr and Prowlarr have /ping, system/status, config/host and /login, and the arrs
 * their download clients and root folders; qBittorrent has /, app/version, its sign-in
 * (with its ban), preferences and categories, answered as qBittorrent 5.2 answers them,
 * and is `apps`' "qbittorrent" also when reached through Gluetun. Any key is taken, but
 * qBittorrent takes only a Bearer token (X-Api-Key gets a 403): its `key` when that is
 * set. `seams` send every app's calls there.
 */
export async function fakeStackApis(): Promise<{
  app: FakeApp;
  apps: Map<string, FakeAppState>;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const apps = new Map<string, FakeAppState>();
  const stateOf = (service: string) => {
    const known = apps.get(service);
    if (known !== undefined) return known;
    const fresh = freshAppState();
    apps.set(service, fresh);
    return fresh;
  };
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    const host = (headers.host ?? '').split(':')[0] ?? '';
    const service = host === 'gluetun' ? 'qbittorrent' : host;
    const state = stateOf(service);
    if (service === 'qbittorrent') return fakeQbittorrent(request, state);
    const keyed =
      headers['x-api-key'] !== undefined || headers.authorization !== undefined;
    if (path === '/ping') return { status: state.up ? 200 : 503, body: { status: 'OK' } };
    if (path === '/login' && method === 'POST') {
      const form = new URLSearchParams(request.body);
      const ok =
        state.user !== '' &&
        form.get('username') === state.user &&
        form.get('password') === state.password;
      return {
        status: 302,
        headers: { Location: ok ? '/' : '/login?returnUrl=&loginFailed=true' },
      };
    }
    if (!keyed) return { status: 401 };
    if (/^\/api\/v[13]\/system\/status$/.test(path)) {
      return { status: 200, body: { version: '1.0.0' } };
    }
    if (/^\/api\/v[13]\/config\/host$/.test(path) && method === 'GET') {
      return { status: 200, body: { id: 1, username: state.user, password: '' } };
    }
    if (/^\/api\/v[13]\/config\/host\/1$/.test(path) && method === 'PUT') {
      const sent = JSON.parse(request.body) as { username: string; password: string };
      state.user = sent.username;
      state.password = sent.password;
      return { status: 202, body: {} };
    }
    return (
      fakeServarrDownloads(request, service, state, stateOf('qbittorrent')) ?? {
        status: 404,
      }
    );
  });
  return {
    app,
    apps,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring(['gluetun', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']),
  };
}

/** The subnets of qBittorrent's whitelist, which takes them separated by commas or lines. */
function subnetsOf(list: string): string[] {
  return list.split(/[\s,]+/).filter((subnet) => subnet !== '');
}

/** A path as qBittorrent gives it back: without a trailing "/". */
function kept(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * qBittorrent's API, as fakeStackApis answers it, from `state`, as qBittorrent 5.2 does:
 * paths without a trailing "/", the whitelist one subnet per line and each subnet as its
 * network address (192.168.1.10/24 is kept as 192.168.1.0/24), its key among the
 * preferences, and a ban on signing in after five failures in a row.
 */
function fakeQbittorrent(request: FakeRequest, state: FakeAppState): FakeReply {
  const { path, headers } = request;
  // Only a Bearer token (X-Api-Key is refused): `key`'s, or any when no key is set.
  const keyed =
    state.key === ''
      ? (headers.authorization ?? '').startsWith('Bearer ')
      : headers.authorization === `Bearer ${state.key}`;
  const form = new URLSearchParams(request.body);
  if (path === '/') return { status: state.up ? 200 : 503, body: 'login page' };
  if (path === '/api/v2/auth/login') {
    if (state.signInFailures >= 5) {
      return {
        status: 403,
        body: 'Your IP address has been banned after too many failed authentication attempts.',
      };
    }
    const ok =
      state.user !== '' &&
      form.get('username') === state.user &&
      form.get('password') === state.password;
    state.signInFailures = ok ? 0 : state.signInFailures + 1;
    return ok ? { status: 204 } : { status: 401, body: 'Unauthorized' };
  }
  if (!keyed) return { status: 403 };
  if (path === '/api/v2/app/version') return { status: 200, body: 'v5.2.4' };
  if (path === '/api/v2/app/preferences') {
    const { save_path: savePath, bypass_auth_subnet_whitelist: whitelist } =
      state.preferences;
    return {
      status: 200,
      body: {
        ...state.preferences,
        save_path: kept(String(savePath)),
        bypass_auth_subnet_whitelist: subnetsOf(String(whitelist)).join('\n'),
        web_ui_username: state.user,
        web_ui_api_key: state.key,
      },
    };
  }
  if (path === '/api/v2/app/setPreferences') {
    const sent = JSON.parse(form.get('json') ?? '{}') as Record<string, string | boolean>;
    const { web_ui_username: user, web_ui_password: password, ...rest } = sent;
    if (typeof user === 'string') state.user = user;
    if (typeof password === 'string') state.password = password;
    Object.assign(state.preferences, rest);
    const { bypass_auth_subnet_whitelist: whitelist } = rest;
    if (typeof whitelist === 'string') {
      state.preferences.bypass_auth_subnet_whitelist = subnetsOf(whitelist)
        .map(networkOf)
        .join(',');
    }
    return { status: 200 };
  }
  if (path === '/api/v2/torrents/categories') {
    return {
      status: 200,
      body: Object.fromEntries(
        Object.entries(state.categories).map(([name, savePath]) => [
          name,
          { name, savePath: kept(savePath) },
        ]),
      ),
    };
  }
  const name = form.get('category') ?? '';
  const known = Object.hasOwn(state.categories, name);
  if (path === '/api/v2/torrents/createCategory') {
    if (known) return { status: 409, body: 'Unable to create category' };
    state.categories[name] = form.get('savePath') ?? '';
    return { status: 200 };
  }
  if (path === '/api/v2/torrents/editCategory') {
    if (!known) return { status: 404, body: 'Category does not exist' };
    state.categories[name] = form.get('savePath') ?? '';
    return { status: 200 };
  }
  return { status: 404 };
}

/** What the fake Sonarr holds; a test may change it between calls. */
export interface FakeSonarrState {
  user: string;
  password: string;
  /** Its API key: anything else gets 401. Empty: any key will do. */
  key: string;
  /** false: /ping answers 503, as while it starts. */
  up: boolean;
}

/**
 * A fake Sonarr for WIRED_CATALOG: /ping, its key check, and the FAKE_LOGIN resource. The
 * seams send every app's calls to it, and never wait. It answers a key it refuses by
 * repeating it, so a test sees whether the key is kept out of what Mediaplane says.
 */
export async function fakeSonarr(state: Partial<FakeSonarrState> = {}): Promise<{
  app: FakeApp;
  state: FakeSonarrState;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const held: FakeSonarrState = { user: '', password: '', key: '', up: true, ...state };
  const keyed = (headers: Record<string, unknown>) =>
    held.key === ''
      ? headers['x-api-key'] !== undefined
      : headers['x-api-key'] === held.key;
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    if (path === '/ping') return { status: held.up ? 200 : 503 };
    if (path === '/login' && method === 'POST') {
      const password = new URLSearchParams(request.body).get('password');
      const ok = held.user !== '' && password === held.password;
      return { status: 302, headers: { Location: ok ? '/' : '/login?loginFailed=true' } };
    }
    if (!keyed(headers)) {
      return { status: 401, body: `Unauthorized: ${String(headers['x-api-key'])}` };
    }
    if (path === '/api/v3/system/status') return { status: 200, body: { version: '4' } };
    if (path === '/api/v3/login' && method === 'GET') {
      return { status: 200, body: { user: held.user } };
    }
    if (path === '/api/v3/login' && method === 'PUT') {
      const sent = JSON.parse(request.body) as { user: string; password: string };
      held.user = sent.user;
      held.password = sent.password;
      return { status: 202, body: {} };
    }
    return { status: 404 };
  });
  return {
    app,
    state: held,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring(['sonarr']),
  };
}
