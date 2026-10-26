import { z } from 'zod';
import type { Catalog } from '../catalog/types';
import { networkOf } from '../host/facts';
import type { WiringSeams } from '../integrations/wiring';
import type { ResourceSpec } from '../integrations/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import type { OneOffCommand } from '../runtime/types';
import { fakeContainer } from './fakes';
import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixtures';
import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';
import {
  fakeJellyfin,
  fakeServarrConnections,
  type FakeApiKey,
  type FakeConnection,
  type FakeLibrary,
} from './jellyfin';
import { fakePlex, freshPlex, type FakePlex } from './plex';
import { freshPlexTv, type FakePlexTvState } from './plextv';
import { fakeProwlarr, type FakeProvider } from './prowlarr';
import { fakeSeerr, freshSeerr, type FakeSeerr } from './seerr';
import {
  fakeProviders,
  fieldValue,
  refusal,
  unreachable,
  withoutSlash,
  type FakeProviderBase,
  type FakeRefusal,
} from './providers';

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
  ownAdmin: true,
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
  /**
   * Its API key, or any when empty: qBittorrent takes only this one, as a Bearer token,
   * and Seerr only this one, once it has a user; Prowlarr's test of its link to Sonarr or
   * Radarr, and Seerr's test of a server, pass only with the arr's.
   */
  key: string;
  /** qBittorrent's web UI port: an arr's test of a client aimed at another fails. */
  port: number;
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
   * The folders in the container of Sonarr, Radarr or Jellyfin, as `mkdir` made them
   * (fakeStackApis' `mkdir`): the arrs refuse a root folder anywhere else, as they refuse
   * one whose folder doesn't exist, and Jellyfin refuses a library at one.
   */
  folders: string[];
  /**
   * Sonarr's or Radarr's own test of a download client or of a connection fails with this
   * reason (`Host: <reason>`), whatever it holds; a test may make it repeat a key, as an
   * app may. Empty: it tests them.
   */
  testFailure: string;
  /** Prowlarr's links to Sonarr and Radarr (its applications), their keys in clear. */
  applications: FakeProvider[];
  /** Prowlarr's indexer proxies. */
  proxies: FakeProvider[];
  /** Prowlarr's tags. */
  tags: { id: number; label: string }[];
  /** What Prowlarr's own health check found when it last ran: `GET /api/v1/health`. */
  health: { source: string; type: string; message: string }[];
  /**
   * Jellyfin's startup wizard: `new` until its first user is made (asking for it makes
   * it), `open` with that user, `done` once completed. Its admin is `user` and `password`.
   */
  wizard: 'new' | 'open' | 'done';
  /** Jellyfin's API keys, in full, oldest first. */
  apiKeys: FakeApiKey[];
  /** Jellyfin's sessions from signing in: each device's token. */
  sessions: Record<string, string>;
  /** Jellyfin's libraries. */
  libraries: FakeLibrary[];
  /**
   * Where Jellyfin keeps system.xml (its appdata folder): the fake writes it there as
   * Jellyfin does, saying whether its wizard is done. It does so on the first request the
   * fake Jellyfin answers, not when the app is added: a test that reads the file before
   * any call finds none. Unset: nowhere.
   */
  configDir?: string;
  /** Sonarr's or Radarr's connections, such as to Jellyfin, their keys in clear. */
  connections: FakeConnection[];
  /** Sonarr's or Radarr's quality profiles: the six each makes at its first start. */
  profiles: { id: number; name: string }[];
  /** What Seerr holds (fakeSeerr). */
  seerr: FakeSeerr;
  /** What Plex holds (fakePlex). */
  plex: FakePlex;
}

/** The quality profiles Sonarr 4 and Radarr 6 make at their first start, in order. */
export const SERVARR_PROFILES = [
  'Any',
  'SD',
  'HD-720p',
  'HD-1080p',
  'Ultra-HD',
  'HD - 720p/1080p',
].map((name, i) => ({ id: i + 1, name }));

/** A download client, as Sonarr and Radarr keep one. */
export interface FakeDownloadClient extends FakeProviderBase {
  enable: boolean;
  priority: number;
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
    port: 8080,
    signInFailures: 0,
    downloadClients: [],
    rootFolders: [],
    folders: [],
    testFailure: '',
    applications: [],
    proxies: [],
    tags: [],
    health: [],
    wizard: 'new',
    apiKeys: [],
    sessions: {},
    libraries: [],
    connections: [],
    profiles: SERVARR_PROFILES.map((profile) => ({ ...profile })),
    seerr: freshSeerr(),
    plex: freshPlex(),
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
      // Unset, the arrs leave it out (probed).
      { name: service === 'radarr' ? 'movieImportedCategory' : 'tvImportedCategory' },
    ],
  };
}

/** The settings of an arr's download client that name a qBittorrent category. */
const CLIENT_CATEGORIES = [
  'tvCategory',
  'movieCategory',
  'tvImportedCategory',
  'movieImportedCategory',
];

/**
 * Sonarr's or Radarr's test of the download client `sent`, holding `key` in clear: its
 * refusal, or undefined when it passes. It passes when the client reaches qBittorrent as
 * Sonarr's does: by its service (gluetun or qbittorrent), at its web UI port, without
 * TLS, which qBittorrent doesn't serve, with its key. A `testFailure` set on the app
 * overrides every check: the test then fails with it, whatever the client.
 */
function testClient(
  sent: Pick<FakeDownloadClient, 'fields'>,
  key: unknown,
  state: FakeAppState,
  qbittorrent: FakeAppState,
): FakeRefusal | undefined {
  const value = (name: string) => fieldValue(sent, name);
  if (state.testFailure !== '') return refusal('Host', state.testFailure);
  const host = value('host');
  const why = unreachable(
    `${String(host)}:${String(value('port'))}`,
    {
      resolves: host === 'gluetun' || host === 'qbittorrent',
      portOpen: value('port') === qbittorrent.port,
      tls: value('useSsl') === true,
    },
    'Name does not resolve',
  );
  if (why !== undefined) return refusal('Host', 'Unable to connect to qBittorrent', why);
  const right =
    typeof key === 'string' &&
    key !== '' &&
    (qbittorrent.key === '' || key === qbittorrent.key);
  if (!right) {
    return refusal('ApiKey', 'Authentication Failure', 'Please verify your credentials.');
  }
  // A test that reaches qBittorrent makes each category the client names that
  // qBittorrent lacks, its own and its post-import one, with no save path (probed on
  // Sonarr 4 and Radarr 6).
  for (const setting of CLIENT_CATEGORIES) {
    const category = value(setting);
    if (typeof category === 'string' && category !== '') {
      qbittorrent.categories[category] ??= '';
    }
  }
  return undefined;
}

/**
 * Sonarr's and Radarr's download clients and root folders, as fakeStackApis answers them,
 * as strictly as the arrs: the clients are served as Prowlarr's providers are
 * (`fakeProviders`), a new one tested as it is saved (`testClient`) unless it is off; and
 * a root folder needs its folder made.
 */
function fakeServarrDownloads(
  request: FakeRequest,
  service: string,
  state: FakeAppState,
  qbittorrent: FakeAppState,
): FakeReply | undefined {
  const { method, path } = request;
  const clients = fakeProviders<FakeDownloadClient>(request, {
    path: '/api/v3/downloadclient',
    held: state.downloadClients,
    templates: () => [qbittorrentTemplate(service)],
    test: (sent, key) => testClient(sent, key, state, qbittorrent),
    // A client sent without `enable` is off, to the arr: it isn't tested.
    testedOnCreate: (sent: Partial<FakeDownloadClient>) => sent.enable === true,
  });
  if (clients !== undefined) return clients;
  const folders = '/api/v3/rootfolder';
  if (path === folders && method === 'GET') {
    return {
      status: 200,
      // The arrs read `accessible` from the disk each time they are asked (probed).
      body: state.rootFolders.map((f) => ({
        ...f,
        accessible: state.folders.includes(withoutSlash(f.path)),
        freeSpace: 1,
      })),
    };
  }
  if (path === folders && method === 'POST') {
    const { path: wanted } = JSON.parse(request.body) as { path: string };
    if (!state.folders.includes(withoutSlash(wanted))) {
      return {
        status: 400,
        body: [
          {
            propertyName: 'Path',
            errorMessage: `Path '${wanted}' does not exist`,
            attemptedValue: wanted,
          },
        ],
      };
    }
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
 * Radarr and Prowlarr have /ping, system/status, config/host and /login, the arrs their
 * download clients, root folders and connections (fakeServarrConnections), and Prowlarr
 * its links to them, its indexer proxies and its tags (fakeProwlarr); qBittorrent has /,
 * app/version, its sign-in (with its ban), preferences and categories, answered as
 * qBittorrent 5.2 answers them, and is `apps`' "qbittorrent" also when reached through
 * Gluetun; Jellyfin has its startup wizard, sign-in, keys, user and libraries
 * (fakeJellyfin); Seerr its sign-in through Jellyfin, its settings and its tests of the
 * arrs (fakeSeerr); Plex its identity and its libraries, once claimed (fakePlex). Any key
 * is taken, but qBittorrent takes only a Bearer token (X-Api-Key gets a 403): its `key`
 * when that is set; Jellyfin only one of its own, in its MediaBrowser header; Seerr its
 * `key`, once it has a user; and Plex only a token of the plex.tv account that claimed it,
 * as `plexTv` knows them. `seams` send every app's calls there. `mkdir` is what the wire
 * step's folder helper does to them: pass it what a fake runtime's `run` is given.
 */
export async function fakeStackApis(plexTv: FakePlexTvState = freshPlexTv()): Promise<{
  app: FakeApp;
  apps: Map<string, FakeAppState>;
  /** The plex.tv the fake apps ask: Plex's tokens, and its claims. */
  plexTv: FakePlexTvState;
  seams: WiringSeams;
  addresses: Record<string, string>;
  /**
   * A `mkdir -p -- <folders>` one-off command of `service` makes them in its container; any
   * other command is none of its business, and a `mkdir` without the `--` is refused. Call
   * it once the command has succeeded: a fake runtime's `run` that exits non-zero made
   * nothing.
   */
  mkdir: (service: string, command: OneOffCommand) => void;
}> {
  const apps = new Map<string, FakeAppState>();
  const stateOf = (service: string) => {
    const known = apps.get(service);
    if (known !== undefined) return known;
    const fresh = freshAppState();
    apps.set(service, fresh);
    return fresh;
  };
  // What an app's test reads of another app, without adding it to `apps`.
  const peek = (service: string) => apps.get(service) ?? freshAppState();
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    const host = (headers.host ?? '').split(':')[0] ?? '';
    const service = host === 'gluetun' ? 'qbittorrent' : host;
    const state = stateOf(service);
    if (service === 'qbittorrent') return fakeQbittorrent(request, state);
    if (service === 'jellyfin') return fakeJellyfin(request, state);
    if (service === 'seerr') {
      return fakeSeerr(request, state, (other) => apps.get(other), plexTv);
    }
    if (service === 'plex') return fakePlex(request, state.plex, plexTv);
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
    const answered =
      service === 'prowlarr'
        ? fakeProwlarr(request, state, peek)
        : (fakeServarrDownloads(request, service, state, peek('qbittorrent')) ??
          fakeServarrConnections(request, service, state, {
            jellyfin: peek('jellyfin'),
            plex: peek('plex'),
            plexTv,
          }));
    return answered ?? { status: 404 };
  });
  return {
    app,
    apps,
    plexTv,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring([
      'gluetun',
      'jellyfin',
      'plex',
      'prowlarr',
      'qbittorrent',
      'radarr',
      'seerr',
      'sonarr',
    ]),
    mkdir: (service, command) => {
      if (command.entrypoint !== 'mkdir') return;
      const divider = command.args.indexOf('--');
      if (divider < 0) {
        throw new Error(
          `the fake mkdir takes the wire step's "mkdir -p -- <folders>", not: ${command.args.join(' ')}`,
        );
      }
      const folders = command.args.slice(divider + 1);
      stateOf(service).folders.push(...folders.map(withoutSlash));
    },
  };
}

/** The subnets of qBittorrent's whitelist, which takes them separated by commas or lines. */
function subnetsOf(list: string): string[] {
  return list.split(/[\s,]+/).filter((subnet) => subnet !== '');
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
        save_path: withoutSlash(String(savePath)),
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
          { name, savePath: withoutSlash(savePath) },
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
