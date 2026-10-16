import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import { libraryId, makeApiKey } from './jellyfin';
import { PORTS } from './prowlarr';
import { freshAppState, type FakeAppState } from './wiring';

/** Seerr's media-server types (its `MediaServerType`): Jellyfin is 2, none yet 4. */
export const SEERR_JELLYFIN = 2;
export const SEERR_NOT_CONFIGURED = 4;

/** A Sonarr or Radarr server, as Seerr keeps one: its key in clear, as Seerr shows it. */
export interface FakeSeerrServer {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  is4k: boolean;
  isDefault: boolean;
  [setting: string]: unknown;
}

/** One of Jellyfin's libraries, as Seerr keeps it once it has synced them. */
export interface FakeSeerrLibrary {
  id: string;
  name: string;
  enabled: boolean;
  type: 'movie' | 'show';
}

/** What the fake Seerr holds; a test may change it between calls. */
export interface FakeSeerr {
  /** SEERR_NOT_CONFIGURED until its first sign-in sets it. */
  mediaServerType: number;
  /** Its users, by the Jellyfin user each signed in as: the first is its admin (id 1). */
  users: string[];
  /** Its Jellyfin: where it is, the key it uses, and its libraries; ip '' until set. */
  jellyfin: {
    ip: string;
    port: number;
    apiKey: string;
    libraries: FakeSeerrLibrary[];
    [setting: string]: unknown;
  };
  /** Its Sonarr and Radarr servers. */
  sonarr: FakeSeerrServer[];
  radarr: FakeSeerrServer[];
  /** Whether its setup wizard is finished (`POST /settings/initialize`). */
  initialized: boolean;
  /** The values of the session cookies its sign-ins gave, until signed out. */
  sessions: string[];
  /** How many sessions it has given: each one's id is new, whatever signed out. */
  signIns: number;
  /** What it logged as errors: a check that fails logs a line, as Seerr does. */
  errors: string[];
  /**
   * Have each refusal and failure it answers quote every key it holds, in clear: its
   * own key, its Jellyfin key and its servers', as an app may echo a secret back.
   */
  echoKey: boolean;
  /** Paths it refuses (400), whatever is sent: as a request Seerr won't take. */
  failing: string[];
  /**
   * Who signs in first, and through what Jellyfin (its host), just before the next
   * sign-in reaches a Seerr nobody has set up: someone inside the stack, between
   * Mediaplane's look at its setup and its own sign-in. Unset: nobody.
   */
  claimant?: { user: string; jellyfin: string };
  /**
   * Where Seerr keeps settings.json (its appdata folder): the fake writes it there as
   * Seerr does, naming its media-server type, on each request it answers. Unset: nowhere.
   */
  configDir?: string;
}

/**
 * settings.json, which Seerr writes into its config folder as it starts, and again as its
 * settings change: JSON with a one-space indent, its key (`main.apiKey`) and its
 * media-server type in `main`. The fake writes it on each request it answers, so it
 * appears on the first one, not before.
 */
function keepSettingsJson(seerr: FakeSeerr, key: string): void {
  if (seerr.configDir === undefined) return;
  const settings = { main: { apiKey: key, mediaServerType: seerr.mediaServerType } };
  mkdirSync(seerr.configDir, { recursive: true });
  writeFileSync(
    join(seerr.configDir, 'settings.json'),
    JSON.stringify(settings, undefined, ' '),
  );
}

/** A fake Seerr as it first starts: nobody signed in, nothing set. */
export function freshSeerr(): FakeSeerr {
  return {
    mediaServerType: SEERR_NOT_CONFIGURED,
    users: [],
    jellyfin: { ip: '', port: 8096, apiKey: '', libraries: [] },
    sonarr: [],
    radarr: [],
    initialized: false,
    sessions: [],
    signIns: 0,
    errors: [],
    echoKey: false,
    failing: [],
  };
}

/** How Seerr names each arr it can hold; it reaches one at its service, and PORTS' port. */
const ARRS = { sonarr: 'Sonarr', radarr: 'Radarr' } as const;

/** What Seerr's request validator (its OpenAPI spec) requires of a server it saves. */
const REQUIRED = [
  'name',
  'hostname',
  'port',
  'apiKey',
  'useSsl',
  'activeProfileId',
  'activeProfileName',
  'activeDirectory',
  'is4k',
  'enableSeasonFolders',
  'isDefault',
];

/** Seerr's request validator refusing a request: 400, and where. */
function invalid(message: string): FakeReply {
  return { status: 400, body: { message: `request/${message}`, errors: [] } };
}

/** How Seerr refuses a call without a user it knows: no cookie at all, or no right. */
function refused(request: FakeRequest): FakeReply {
  return request.headers['x-api-key'] === undefined &&
    request.headers.cookie === undefined
    ? { status: 401, body: { message: "cookie 'connect.sid' required" } }
    : {
        status: 403,
        body: {
          status: 403,
          error: 'You do not have permission to access this endpoint',
        },
      };
}

/** A session cookie's life, as Seerr gives it: 30 days, in a date that holds a comma. */
const EXPIRES = 'Expires=Sat, 14 Nov 2026 12:00:00 GMT';

/** The value of the cookie `connect.sid` in a Cookie header, if any. */
function sessionCookie(header: string | undefined): string | undefined {
  const match = /(?:^|;\s*)connect\.sid=([^;]*)/.exec(header ?? '');
  return match?.[1];
}

/**
 * Seerr 3.5's API, as fakeStackApis answers it, from `seerr` (`state.seerr`), as Seerr
 * answers it, and `peek`, the other apps it calls:
 * - before its first sign-in, anyone may sign in through a Jellyfin of their choosing
 *   (`POST /auth/jellyfin` with a hostname), and its key (`state.key`, any when empty)
 *   does nothing; the first Jellyfin admin who signs in is its admin, and sets its
 *   Jellyfin, where Seerr makes itself a key named "Seerr". After that, sending a
 *   hostname again is a 500, and a wrong password is 401;
 * - a sign-in gives a session cookie, `connect.sid`, until it signs out;
 * - its Jellyfin settings, saved only once Seerr reaches Jellyfin at them with their key;
 *   its libraries, synced from Jellyfin and enabled one by one; and a list of Jellyfin's
 *   users, which fails (500) while Jellyfin refuses Seerr's key;
 * - its Sonarr and Radarr servers, kept with their keys in clear, saved only whole (its
 *   validator requires their fields, and refuses an `id`), and tested by reaching the arr
 *   by its service, at its port, without TLS, with its key (`state.key` of the arr, any
 *   when empty); a failing test is a 500, and logs a line;
 * - `initialize`, which can be sent again.
 * It keeps settings.json in `seerr.configDir`, when that is set, as Seerr does, and
 * quotes the keys it holds in each refusal while `seerr.echoKey` is set. A `claimant`
 * signs in first, and each path in `failing` is refused.
 */
export function fakeSeerr(
  request: FakeRequest,
  state: FakeAppState,
  peek: (service: string) => FakeAppState | undefined,
): FakeReply {
  const { seerr } = state;
  const reply = seerr.failing.includes(request.path.split('?')[0] ?? request.path)
    ? invalid('fake failure')
    : answer(request, state, peek);
  keepSettingsJson(seerr, state.key);
  if (!seerr.echoKey || reply.status < 400) return reply;
  const servers = [...seerr.sonarr, ...seerr.radarr];
  const held = [state.key, seerr.jellyfin.apiKey, ...servers.map((s) => s.apiKey)];
  return {
    ...reply,
    body: { message: `fake failure, holding ${held.filter((k) => k !== '').join(' ')}` },
  };
}

/** fakeSeerr's answer to `request`. */
function answer(
  request: FakeRequest,
  state: FakeAppState,
  peek: (service: string) => FakeAppState | undefined,
): FakeReply {
  const { seerr } = state;
  const { method } = request;
  const path = request.path.split('?')[0] ?? request.path;
  const body = () =>
    request.body === '' ? {} : (JSON.parse(request.body) as Record<string, unknown>);
  if (path === '/api/v1/status') return { status: 200, body: { version: '3.5.0' } };
  if (path === '/api/v1/settings/public' && method === 'GET') {
    return {
      status: 200,
      body: {
        initialized: seerr.initialized,
        mediaServerType: seerr.mediaServerType,
        applicationTitle: 'Seerr',
      },
    };
  }
  if (path === '/api/v1/auth/jellyfin' && method === 'POST') {
    if (seerr.claimant !== undefined && seerr.users.length === 0) {
      seerr.mediaServerType = SEERR_JELLYFIN;
      seerr.users = [seerr.claimant.user];
      seerr.jellyfin = {
        ...seerr.jellyfin,
        ip: seerr.claimant.jellyfin,
        apiKey: 'fake-claimants-key',
      };
    }
    return signIn(body(), seerr, peek('jellyfin'));
  }
  const cookie = sessionCookie(request.headers.cookie);
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    if (cookie === undefined) return refused(request);
    seerr.sessions = seerr.sessions.filter((s) => s !== cookie);
    return { status: 200, body: { status: 'ok' } };
  }
  // Its key acts as its admin, once there is one; a session, as whoever signed in.
  const keyed =
    typeof request.headers['x-api-key'] === 'string' &&
    (state.key === '' || request.headers['x-api-key'] === state.key) &&
    seerr.users.length > 0;
  if (!keyed && (cookie === undefined || !seerr.sessions.includes(cookie))) {
    return refused(request);
  }
  if (path === '/api/v1/auth/me' && method === 'GET') {
    return {
      status: 200,
      body: { id: 1, jellyfinUsername: seerr.users[0], permissions: 2 },
    };
  }
  if (path === '/api/v1/settings/initialize' && method === 'POST') {
    seerr.initialized = true;
    return { status: 200, body: { initialized: true } };
  }
  return (
    fakeSeerrJellyfin(request, path, body, seerr, peek('jellyfin')) ??
    fakeSeerrServers(request, path, body, seerr, peek) ?? { status: 404 }
  );
}

/** Whether Seerr reaches Jellyfin at `ip`:`port`: its service, while it runs, at 8096. */
function reachesJellyfin(
  ip: unknown,
  port: unknown,
  jellyfin: FakeAppState | undefined,
): jellyfin is FakeAppState {
  return jellyfin !== undefined && jellyfin.up && ip === 'jellyfin' && port === 8096;
}

/** Whether `key` is one of Jellyfin's keys. */
function jellyfinTakes(key: unknown, jellyfin: FakeAppState): boolean {
  return jellyfin.apiKeys.some((k) => k.AccessToken === key);
}

/** `POST /api/v1/auth/jellyfin`: a sign-in through Jellyfin, and the first one's setup. */
function signIn(
  sent: Record<string, unknown>,
  seerr: FakeSeerr,
  jellyfin: FakeAppState | undefined,
): FakeReply {
  if (
    seerr.mediaServerType !== SEERR_NOT_CONFIGURED &&
    seerr.mediaServerType !== SEERR_JELLYFIN
  ) {
    return { status: 500, body: { error: 'Jellyfin login is disabled' } };
  }
  if (typeof sent.username !== 'string' || sent.username === '') {
    return { status: 500, body: { error: 'You must provide an username' } };
  }
  const configured = seerr.jellyfin.ip !== '';
  if (configured && sent.hostname !== undefined) {
    return { status: 500, body: { error: 'Jellyfin hostname already configured' } };
  }
  if (!configured && sent.hostname === undefined) {
    return { status: 500, body: { error: 'No hostname provided.' } };
  }
  const at = configured
    ? { ip: seerr.jellyfin.ip, port: seerr.jellyfin.port }
    : { ip: sent.hostname, port: sent.port ?? 8096 };
  if (!reachesJellyfin(at.ip, at.port, jellyfin)) {
    return { status: 404, body: { message: 'INVALID_URL' } };
  }
  const right =
    jellyfin.user !== '' &&
    jellyfin.password !== '' &&
    sent.username === jellyfin.user &&
    sent.password === jellyfin.password;
  if (!right) return { status: 401, body: { message: 'INVALID_CREDENTIALS' } };
  if (seerr.users.length === 0) {
    if (sent.serverType !== SEERR_JELLYFIN) {
      return { status: 500, body: { message: 'NO_ADMIN_USER' } };
    }
    seerr.mediaServerType = SEERR_JELLYFIN;
    seerr.jellyfin.ip = String(at.ip);
    seerr.jellyfin.port = Number(at.port);
    seerr.jellyfin.apiKey = makeApiKey(jellyfin, 'Seerr');
  }
  if (!seerr.users.includes(sent.username)) seerr.users.push(sent.username);
  seerr.signIns += 1;
  const session = `s%3Afake-session-${String(seerr.signIns)}.signed`;
  seerr.sessions.push(session);
  return {
    status: 200,
    body: {
      id: seerr.users.indexOf(sent.username) + 1,
      jellyfinUsername: sent.username,
      permissions: seerr.users[0] === sent.username ? 2 : 32,
    },
    headers: {
      'Set-Cookie': `connect.sid=${session}; Path=/; ${EXPIRES}; HttpOnly; SameSite=Lax`,
    },
  };
}

/** Seerr's Jellyfin settings, its libraries and its list of Jellyfin's users. */
function fakeSeerrJellyfin(
  request: FakeRequest,
  path: string,
  body: () => Record<string, unknown>,
  seerr: FakeSeerr,
  jellyfin: FakeAppState | undefined,
): FakeReply | undefined {
  const { method } = request;
  const settings = '/api/v1/settings/jellyfin';
  const shown = () => ({
    name: 'jellyfin',
    useSsl: false,
    urlBase: '',
    externalHostname: '',
    serverId: 'fake',
    ...seerr.jellyfin,
  });
  if (path === settings && method === 'GET') return { status: 200, body: shown() };
  if (path === settings && method === 'POST') {
    const sent = body();
    const merged = { ...seerr.jellyfin, ...sent };
    // It asks Jellyfin for its system info at the merged settings first.
    if (!reachesJellyfin(merged.ip, merged.port, jellyfin)) {
      seerr.errors.push('Something went wrong testing Jellyfin connection');
      return { status: 502, body: { message: 'INVALID_URL' } };
    }
    if (!jellyfinTakes(merged.apiKey, jellyfin)) {
      seerr.errors.push('Something went wrong testing Jellyfin connection');
      return { status: 401, body: { message: 'INVALID_URL' } };
    }
    Object.assign(seerr.jellyfin, sent);
    return { status: 200, body: shown() };
  }
  const works =
    reachesJellyfin(seerr.jellyfin.ip, seerr.jellyfin.port, jellyfin) &&
    jellyfinTakes(seerr.jellyfin.apiKey, jellyfin);
  if (path === `${settings}/users` && method === 'GET') {
    if (!works) {
      seerr.errors.push('Something went wrong while getting the account');
      return { status: 500, body: { message: '' } };
    }
    return { status: 200, body: [{ username: jellyfin.user, id: 'fake' }] };
  }
  if (path === `${settings}/library` && method === 'GET') {
    return { status: 200, body: seerr.jellyfin.libraries };
  }
  if (path === `${settings}/library/sync` && method === 'POST') {
    if (!works) {
      seerr.errors.push('Something went wrong while getting libraries');
      return { status: 401, body: { message: 'INVALID_AUTH_TOKEN' } };
    }
    const found = jellyfin.libraries.flatMap((library): FakeSeerrLibrary[] => {
      const type =
        library.CollectionType === 'movies'
          ? 'movie'
          : library.CollectionType === 'tvshows'
            ? 'show'
            : undefined;
      if (type === undefined) return [];
      const id = libraryId(library);
      const held = seerr.jellyfin.libraries.find((l) => l.id === id);
      return [{ id, name: library.Name, enabled: held?.enabled ?? false, type }];
    });
    if (found.length === 0) {
      return { status: 404, body: { message: 'SYNC_ERROR_NO_LIBRARIES' } };
    }
    seerr.jellyfin.libraries = found;
    return { status: 200, body: found };
  }
  const library = /^\/api\/v1\/settings\/jellyfin\/library\/([^/]+)$/.exec(path);
  if (library !== null && method === 'PUT') {
    const { enabled } = body();
    if (typeof enabled !== 'boolean') return invalid('body/enabled must be boolean');
    const held = seerr.jellyfin.libraries.find((l) => l.id === library[1]);
    if (held === undefined) {
      return { status: 404, body: { message: 'Library does not exist.' } };
    }
    held.enabled = enabled;
    return { status: 200, body: held };
  }
  return undefined;
}

/** Seerr's Sonarr and Radarr servers, and its test of one. */
function fakeSeerrServers(
  request: FakeRequest,
  path: string,
  body: () => Record<string, unknown>,
  seerr: FakeSeerr,
  peek: (service: string) => FakeAppState | undefined,
): FakeReply | undefined {
  const match = /^\/api\/v1\/settings\/(sonarr|radarr)(?:\/(test|\d+))?$/.exec(path);
  if (match === null) return undefined;
  const arr = match[1] as keyof typeof ARRS;
  const { method } = request;
  const servers = seerr[arr];
  if (match[2] === 'test' && method === 'POST') {
    const sent = body();
    const absent = ['hostname', 'port', 'apiKey', 'useSsl'].find((f) => !(f in sent));
    if (absent !== undefined) {
      return invalid(`body must have required property '${absent}'`);
    }
    if (typeof sent.apiKey !== 'string') return invalid('body/apiKey must be string');
    const held = peek(arr);
    const reached =
      held !== undefined &&
      held.up &&
      sent.hostname === arr &&
      sent.port === PORTS[arr] &&
      sent.useSsl !== true &&
      (sent.baseUrl ?? '') === '';
    const takes =
      held !== undefined &&
      (held.key === '' ? sent.apiKey !== '' : sent.apiKey === held.key);
    if (!reached || !takes) {
      seerr.errors.push(`[${ARRS[arr]}] Failed to retrieve system status`);
      return { status: 500, body: { message: `Failed to connect to ${ARRS[arr]}` } };
    }
    return {
      status: 200,
      body: {
        profiles: held.profiles,
        rootFolders: held.rootFolders.map(({ id, path: folder }) => ({
          id,
          path: folder,
        })),
        languageProfiles: null,
        tags: [],
        urlBase: '',
      },
    };
  }
  if (match[2] === undefined && method === 'GET') return { status: 200, body: servers };
  const sent = body();
  if (method === 'POST' || method === 'PUT') {
    if ('id' in sent) return invalid('body/id is read-only');
    const missing = REQUIRED.find((field) => !(field in sent));
    if (missing !== undefined) {
      return invalid(`body must have required property '${missing}'`);
    }
  }
  const clearDefaults = () => {
    if (sent.isDefault !== true) return;
    for (const server of servers) {
      if (server.is4k === sent.is4k) server.isDefault = false;
    }
  };
  if (match[2] === undefined && method === 'POST') {
    clearDefaults();
    const made = { ...sent, id: (servers.at(-1)?.id ?? -1) + 1 } as FakeSeerrServer;
    servers.push(made);
    return { status: 201, body: made };
  }
  const index = servers.findIndex((s) => s.id === Number(match[2]));
  if (method === 'PUT') {
    if (index < 0) {
      // Radarr's route has no answer of its own for an id it doesn't hold.
      return arr === 'sonarr'
        ? { status: 404, body: { status: '404', message: 'Settings instance not found' } }
        : { status: 500, body: '<pre>Internal Server Error</pre>' };
    }
    clearDefaults();
    servers[index] = { ...sent, id: Number(match[2]) } as FakeSeerrServer;
    return { status: 200, body: servers[index] };
  }
  return undefined;
}

/** The shared admin's password, and the key, of the Jellyfin fakeJellyfinSetUp gives. */
export const SET_UP_JELLYFIN = {
  password: 'fake-admin-password',
  key: '7'.repeat(32),
} as const;

/**
 * A fake Jellyfin as Mediaplane sets one up: its wizard done, the shared admin (`admin`,
 * SET_UP_JELLYFIN's password), and its key, named `Mediaplane`; `more` changes it.
 */
export function fakeJellyfinSetUp(more: Partial<FakeAppState> = {}): FakeAppState {
  return {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: SET_UP_JELLYFIN.password,
    apiKeys: [
      {
        AccessToken: SET_UP_JELLYFIN.key,
        AppName: 'Mediaplane',
        DateCreated: '2026-10-15T12:00:00.000Z',
      },
    ],
    ...more,
  };
}

/** What `call` threw, or undefined when it didn't throw. */
export async function thrown(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}
