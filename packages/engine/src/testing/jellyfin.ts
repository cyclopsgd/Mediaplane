import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import { testPlexConnection } from './plex';
import type { FakePlexTvState } from './plextv';
import {
  fakeProviders,
  fieldValue,
  refusal,
  type FakeProviderBase,
  type FakeRefusal,
  unreachable,
  withoutSlash,
} from './providers';
import type { FakeAppState } from './wiring';

/** One of Jellyfin's API keys, as /Auth/Keys lists it: in full. */
export interface FakeApiKey {
  AccessToken: string;
  AppName: string;
  DateCreated: string;
}

/** One of Jellyfin's libraries, as it keeps one. */
export interface FakeLibrary {
  Name: string;
  /** "movies", "tvshows"…; undefined for mixed content. */
  CollectionType?: string;
  /** Its folders, as Jellyfin lists them: one per link it keeps, so a path can repeat. */
  Locations: string[];
  /** The options it was made with. */
  LibraryOptions: Record<string, unknown>;
}

/** A connection of Sonarr or Radarr (a "notification"), as the arr keeps it. */
export interface FakeConnection extends FakeProviderBase {
  /** Its triggers, beside its settings: "onDownload", "onRename"… */
  [trigger: `on${string}`]: boolean | undefined;
}

/** The id of the fake Jellyfin's one user, its admin. */
export const FAKE_JELLYFIN_USER_ID = '0123456789abcdef0123456789abcdef';

/** The first user Jellyfin makes when its startup wizard asks for one, in this image. */
const FIRST_USER = 'abc';

/** What Jellyfin answers a request it refuses without saying why. */
const UNEXPLAINED = 'Error processing request.';

/** How many tokens and keys each fake Jellyfin has made, so no test depends on another. */
const made = new WeakMap<FakeAppState, number>();

/**
 * The next token or key of the Jellyfin `state`, from its own counter: 32 hex characters,
 * as Jellyfin's, and the number it was made as.
 */
function token(state: FakeAppState): { value: string; count: number } {
  const count = (made.get(state) ?? 0) + 1;
  made.set(state, count);
  return { value: count.toString(16).padStart(32, 'e'), count };
}

/**
 * Make an API key named `app` in the Jellyfin `state`, as `POST /Auth/Keys?app=<app>`
 * does, and give it: Seerr makes one so as it first signs in.
 */
export function makeApiKey(state: FakeAppState, app: string): string {
  const key = token(state);
  state.apiKeys.push({
    AccessToken: key.value,
    AppName: app,
    DateCreated: new Date(Date.UTC(2026, 9, 15, 12, 0, key.count)).toISOString(),
  });
  return key.value;
}

/**
 * The fields of a `MediaBrowser` Authorization header (Client, Device, DeviceId, Version,
 * Token), or undefined for another header. Jellyfin 12 takes a token only there: its
 * legacy headers (X-Emby-Token, X-MediaBrowser-Token) and `?api_key=` are off.
 */
function mediaBrowser(header: string | undefined): Record<string, string> | undefined {
  const match = /^MediaBrowser\s+(.*)$/i.exec(header ?? '');
  if (match === null) return undefined;
  return Object.fromEntries(
    [...(match[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  );
}

/**
 * system.xml, which Jellyfin writes into its config folder when it starts, and again when
 * its startup wizard completes: `IsStartupWizardCompleted` says which.
 */
function keepSystemXml(state: FakeAppState): void {
  if (state.configDir === undefined) return;
  const path = join(state.configDir, 'system.xml');
  const content = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ServerConfiguration>',
    `  <IsStartupWizardCompleted>${String(state.wizard === 'done')}</IsStartupWizardCompleted>`,
    '</ServerConfiguration>',
    '',
  ].join('\n');
  try {
    if (readFileSync(path, 'utf8') === content) return;
  } catch {
    // Not there yet: Jellyfin writes it.
  }
  mkdirSync(state.configDir, { recursive: true });
  writeFileSync(path, content);
}

/** Jellyfin's answer to a call made without a token it takes. */
const UNAUTHORIZED: FakeReply = { status: 401 };

/** Jellyfin's user, as /Users lists it, with the policy fields a save must send back. */
function userOf(state: FakeAppState) {
  return {
    Name: state.user,
    Id: FAKE_JELLYFIN_USER_ID,
    HasPassword: state.password !== '',
    Policy: {
      IsAdministrator: true,
      IsDisabled: false,
      AuthenticationProviderId:
        'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
      PasswordResetProviderId:
        'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
    },
  };
}

/** A user name Jellyfin takes: letters, digits and a few signs, never empty. */
function validName(name: unknown): name is string {
  return typeof name === 'string' && /^[\w\-'.@+]+$/.test(name);
}

/** What Jellyfin 12 offers a new library of `type`, as /Libraries/AvailableOptions does. */
function availableOptions(type: string) {
  const fetchers = (...offered: [string, boolean][]) =>
    offered.map(([Name, DefaultEnabled]) => ({ Name, DefaultEnabled }));
  const images = (...limits: [string, number][]) =>
    limits.map(([Type, Limit]) => ({
      Type,
      Limit,
      MinWidth: Type === 'Backdrop' ? 1280 : 0,
    }));
  const typeOptions =
    type === 'movies'
      ? [
          {
            Type: 'Movie',
            MetadataFetchers: fetchers(
              ['TheMovieDb', true],
              ['The Open Movie Database', false],
            ),
            ImageFetchers: fetchers(
              ['TheMovieDb', true],
              ['The Open Movie Database', false],
              ['Embedded Image Extractor', false],
              ['Screen Grabber', true],
            ),
            SupportedImageTypes: ['Primary', 'Backdrop', 'Logo', 'Thumb'],
            DefaultImageOptions: images(['Backdrop', 1], ['Primary', 1], ['Logo', 1]),
          },
        ]
      : [
          {
            Type: 'Series',
            MetadataFetchers: fetchers(
              ['TheMovieDb', true],
              ['The Open Movie Database', false],
            ),
            ImageFetchers: fetchers(['TheMovieDb', false]),
            SupportedImageTypes: ['Primary', 'Backdrop', 'Logo', 'Thumb'],
            DefaultImageOptions: images(['Backdrop', 1], ['Primary', 1], ['Banner', 1]),
          },
          {
            Type: 'Episode',
            MetadataFetchers: fetchers(
              ['TheMovieDb', false],
              ['The Open Movie Database', false],
            ),
            ImageFetchers: fetchers(['TheMovieDb', false], ['Screen Grabber', true]),
            SupportedImageTypes: ['Primary'],
            DefaultImageOptions: images(['Primary', 1]),
          },
        ];
  return {
    MetadataSavers: fetchers(['Nfo', false]),
    MetadataReaders: fetchers(['Nfo', true]),
    SubtitleFetchers: [],
    LyricFetchers: [],
    MediaSegmentProviders: [],
    TypeOptions: typeOptions,
  };
}

/**
 * A library's id in Jellyfin (its `ItemId`), which follows its name here: Jellyfin's
 * follows its folder, which a rename changes.
 */
export function libraryId(library: Pick<FakeLibrary, 'Name'>): string {
  return Buffer.from(library.Name).toString('hex').padEnd(32, '0').slice(0, 32);
}

/** A library as /Library/VirtualFolders lists it. */
function shown(library: FakeLibrary) {
  return {
    ...library,
    ItemId: libraryId(library),
    RefreshStatus: 'Idle',
    LibraryOptions: {
      ...library.LibraryOptions,
      PathInfos: library.Locations.map((Path) => ({ Path })),
    },
  };
}

/**
 * Jellyfin's API, as fakeStackApis answers it, as Jellyfin 12 does, from `state`:
 * - its startup wizard: the first user is made by asking for it (GET /Startup/User), then
 *   named and given a password once (a second time is 403), and the wizard completed,
 *   which it takes even with no user; once done, only a key reaches it;
 * - a sign-in needs its client fields (Client, Device, DeviceId, Version) and gives a
 *   session token, one per device, until it signs out;
 * - API keys, listed in full, made by name; a token is taken only in the MediaBrowser
 *   Authorization header;
 * - its user, renamed or given a password with a key; its libraries, each needing a
 *   folder it can see (`state.folders`, as `mkdir` made them), a second of one name made
 *   as "<name>2"; and what it offers a new library.
 * It keeps system.xml in `state.configDir`, when that is set, as Jellyfin does.
 */
export function fakeJellyfin(request: FakeRequest, state: FakeAppState): FakeReply {
  keepSystemXml(state);
  const url = new URL(request.path, 'http://jellyfin');
  const { method } = request;
  const path = url.pathname;
  const auth = mediaBrowser(request.headers.authorization);
  const sessionOf = Object.entries(state.sessions).find(
    ([, value]) => value === auth?.Token,
  );
  const keyed =
    auth?.Token !== undefined &&
    (state.apiKeys.some((k) => k.AccessToken === auth.Token) || sessionOf !== undefined);
  const body = () => (request.body === '' ? {} : (JSON.parse(request.body) as unknown));
  if (path === '/System/Info/Public') {
    if (!state.up) {
      return {
        status: 503,
        body: 'Jellyfin Server is loading. Please try again shortly.',
      };
    }
    return {
      status: 200,
      body: {
        ServerName: 'jellyfin',
        Version: '12.2.0',
        ProductName: 'Jellyfin Server',
        StartupWizardCompleted: state.wizard === 'done',
      },
    };
  }
  // While the wizard is open, its endpoints answer anyone; once done, only a key.
  const wizardOpen = state.wizard !== 'done' || keyed;
  if (path === '/Startup/User' && method === 'GET') {
    if (!wizardOpen) return UNAUTHORIZED;
    if (state.wizard === 'new') {
      state.wizard = 'open';
      state.user = FIRST_USER;
    }
    return { status: 200, body: { Name: state.user } };
  }
  if (path === '/Startup/User' && method === 'POST') {
    if (!wizardOpen) return UNAUTHORIZED;
    if (state.wizard === 'new') {
      return { status: 404, body: { title: 'Not Found', status: 404 } };
    }
    const sent = body() as { Name?: unknown; Password?: unknown };
    if (typeof sent.Password !== 'string' || sent.Password === '') {
      return { status: 400, body: 'Password must not be empty' };
    }
    if (!validName(sent.Name)) return { status: 400, body: UNEXPLAINED };
    if (state.password !== '') return { status: 403 };
    state.user = sent.Name;
    state.password = sent.Password;
    return { status: 204 };
  }
  if (path === '/Startup/Complete' && method === 'POST') {
    if (!wizardOpen) return UNAUTHORIZED;
    state.wizard = 'done';
    keepSystemXml(state);
    return { status: 204 };
  }
  if (path === '/Users/AuthenticateByName' && method === 'POST') {
    const device = auth?.DeviceId;
    if (
      auth?.Client === undefined ||
      auth.Device === undefined ||
      device === undefined ||
      auth.Version === undefined
    ) {
      return { status: 400, body: UNEXPLAINED };
    }
    const sent = body() as { Username?: unknown; Pw?: unknown };
    const right =
      state.user !== '' &&
      state.password !== '' &&
      sent.Username === state.user &&
      sent.Pw === state.password;
    if (!right) return { status: 401, body: UNEXPLAINED };
    // A sign-in from a device ends that device's last session.
    const session = token(state).value;
    state.sessions[device] = session;
    return {
      status: 200,
      body: { User: userOf(state), AccessToken: session, ServerId: 'fake' },
    };
  }
  if (!keyed) return UNAUTHORIZED;
  if (path === '/System/Info') return { status: 200, body: { Version: '12.2.0' } };
  if (path === '/Sessions/Logout' && method === 'POST') {
    state.sessions = Object.fromEntries(
      Object.entries(state.sessions).filter(([device]) => device !== sessionOf?.[0]),
    );
    return { status: 204 };
  }
  if (path === '/Auth/Keys' && method === 'GET') {
    return {
      status: 200,
      body: {
        Items: state.apiKeys.map((k) => ({ Id: 0, ...k, IsActive: false })),
        TotalRecordCount: state.apiKeys.length,
        StartIndex: 0,
      },
    };
  }
  if (path === '/Auth/Keys' && method === 'POST') {
    const app = url.searchParams.get('app');
    if (app === null || app === '') return { status: 400, body: UNEXPLAINED };
    makeApiKey(state, app);
    return { status: 204 };
  }
  // A key removed by its value, as Jellyfin's dashboard does: 204 (probed), and refused
  // at once from then on.
  const removing = /^\/Auth\/Keys\/([^/]+)$/.exec(path);
  if (removing !== null && method === 'DELETE') {
    const gone = decodeURIComponent(removing[1] ?? '');
    state.apiKeys = state.apiKeys.filter((k) => k.AccessToken !== gone);
    return { status: 204 };
  }
  return fakeJellyfinLibrary(request, url, state, body) ?? { status: 404 };
}

/** Jellyfin's user and libraries, with a key: the rest of fakeJellyfin. */
function fakeJellyfinLibrary(
  request: FakeRequest,
  url: URL,
  state: FakeAppState,
  body: () => unknown,
): FakeReply | undefined {
  const { method } = request;
  const path = url.pathname;
  const query = (name: string) => url.searchParams.get(name) ?? '';
  const userPath = `/Users/${FAKE_JELLYFIN_USER_ID}`;
  if (path === '/Users' && method === 'GET') {
    return { status: 200, body: state.user === '' ? [] : [userOf(state)] };
  }
  if (path === userPath && method === 'GET') {
    return state.user === '' ? { status: 404 } : { status: 200, body: userOf(state) };
  }
  if (path === userPath && method === 'POST') {
    const sent = body() as {
      Name?: unknown;
      Policy?: { AuthenticationProviderId?: unknown; PasswordResetProviderId?: unknown };
    };
    if (
      typeof sent.Policy?.AuthenticationProviderId !== 'string' ||
      typeof sent.Policy.PasswordResetProviderId !== 'string'
    ) {
      return {
        status: 400,
        body: { title: 'One or more validation errors occurred.', status: 400 },
      };
    }
    if (!validName(sent.Name)) return { status: 400, body: UNEXPLAINED };
    state.user = sent.Name;
    return { status: 204 };
  }
  if (path === `${userPath}/Password` && method === 'POST') {
    const sent = body() as { NewPw?: unknown };
    if (typeof sent.NewPw !== 'string') return { status: 400, body: UNEXPLAINED };
    state.password = sent.NewPw;
    return { status: 204 };
  }
  if (path === '/Libraries/AvailableOptions' && method === 'GET') {
    return { status: 200, body: availableOptions(query('libraryContentType')) };
  }
  const named = (name: string) => state.libraries.find((l) => l.Name === name);
  const seen = (folder: string) => state.folders.includes(withoutSlash(folder));
  if (path === '/Library/VirtualFolders' && method === 'GET') {
    return { status: 200, body: state.libraries.map(shown) };
  }
  if (path === '/Library/VirtualFolders' && method === 'POST') {
    const paths = url.searchParams.getAll('paths');
    if (!paths.every(seen)) return { status: 400, body: UNEXPLAINED };
    // A second library of one name isn't refused: Jellyfin names it "<name>2".
    let name = query('name');
    while (named(name) !== undefined) name = `${name}2`;
    const type = query('collectionType');
    const sent = body() as { LibraryOptions?: Record<string, unknown> };
    state.libraries.push({
      Name: name,
      ...(type === '' ? {} : { CollectionType: type }),
      Locations: paths.map(withoutSlash),
      LibraryOptions: sent.LibraryOptions ?? {},
    });
    return { status: 204 };
  }
  if (path === '/Library/VirtualFolders' && method === 'DELETE') {
    const library = named(query('name'));
    if (library === undefined) return { status: 404, body: UNEXPLAINED };
    state.libraries.splice(state.libraries.indexOf(library), 1);
    return { status: 204 };
  }
  if (path === '/Library/VirtualFolders/Paths' && method === 'POST') {
    const sent = body() as { Name?: unknown; Path?: unknown };
    const library = named(String(sent.Name));
    if (library === undefined || typeof sent.Path !== 'string' || !seen(sent.Path)) {
      return { status: 404, body: UNEXPLAINED };
    }
    library.Locations.push(withoutSlash(sent.Path));
    return { status: 204 };
  }
  if (path === '/Library/VirtualFolders/Paths' && method === 'DELETE') {
    const library = named(query('name'));
    const at = library?.Locations.indexOf(withoutSlash(query('path'))) ?? -1;
    // A path the library doesn't hold is 404 (probed), as a path added is.
    if (library === undefined || at < 0) return { status: 404, body: UNEXPLAINED };
    library.Locations.splice(at, 1);
    return { status: 204 };
  }
  return undefined;
}

/** Each arr's triggers for a connection, as its template lists them, all off. */
const TRIGGERS: Readonly<Record<string, readonly string[]>> = {
  sonarr: [
    'onGrab',
    'onDownload',
    'onUpgrade',
    'onImportComplete',
    'onRename',
    'onSeriesAdd',
    'onSeriesDelete',
    'onEpisodeFileDelete',
    'onEpisodeFileDeleteForUpgrade',
    'onHealthIssue',
    'onHealthRestored',
    'onApplicationUpdate',
    'onManualInteractionRequired',
  ],
  radarr: [
    'onGrab',
    'onDownload',
    'onUpgrade',
    'onRename',
    'onMovieAdded',
    'onMovieDelete',
    'onMovieFileDelete',
    'onMovieFileDeleteForUpgrade',
    'onHealthIssue',
    'onHealthRestored',
    'onApplicationUpdate',
    'onManualInteractionRequired',
  ],
};

/** Sonarr's or Radarr's template for a "Plex Media Server" connection (probed). */
function plexServerTemplate(service: string) {
  return {
    name: '',
    implementation: 'PlexServer',
    tags: [],
    presets: [],
    ...Object.fromEntries((TRIGGERS[service] ?? []).map((t) => [t, false])),
    fields: [
      { name: 'server' },
      { name: 'host', value: '' },
      { name: 'port', value: 32400 },
      { name: 'useSsl', value: false },
      { name: 'urlBase' },
      { name: 'authToken' },
      { name: 'signIn', value: 'startOAuth' },
      { name: 'updateLibrary', value: true },
      { name: 'mapFrom' },
      { name: 'mapTo' },
    ],
  };
}

/** Sonarr's or Radarr's template for an "Emby / Jellyfin" connection. */
function mediaBrowserTemplate(service: string) {
  return {
    name: '',
    implementation: 'MediaBrowser',
    tags: [],
    presets: [],
    ...Object.fromEntries((TRIGGERS[service] ?? []).map((t) => [t, false])),
    fields: [
      { name: 'host' },
      { name: 'port', value: 8096 },
      { name: 'useSsl', value: false },
      { name: 'urlBase' },
      { name: 'apiKey' },
      { name: 'notify', value: false },
      { name: 'updateLibrary', value: true },
      { name: 'mapFrom' },
      { name: 'mapTo' },
    ],
  };
}

/**
 * Sonarr's or Radarr's test of a connection to Jellyfin, `sent` holding `key` in clear: its
 * refusal, or undefined when it passes. As theirs does, it reaches Jellyfin by its service
 * (jellyfin), while it runs, at 8096, without TLS, with one of Jellyfin's keys: none, until
 * Jellyfin has made one. A `testFailure` set on the arr overrides every check, as it does
 * for a download client.
 */
function testConnection(
  sent: Pick<FakeConnection, 'fields'>,
  key: unknown,
  state: FakeAppState,
  jellyfin: FakeAppState,
): FakeRefusal | undefined {
  const value = (name: string) => fieldValue(sent, name);
  if (state.testFailure !== '') return refusal('Host', state.testFailure);
  const base = value('urlBase');
  const why = unreachable(
    `${String(value('host'))}:${String(value('port'))}`,
    {
      // A URL base is another URL than Jellyfin's: `@<host>` is another host.
      resolves:
        value('host') === 'jellyfin' &&
        jellyfin.up &&
        (base === undefined || base === ''),
      portOpen: value('port') === 8096,
      tls: value('useSsl') === true,
    },
    'Resource temporarily unavailable',
  );
  if (why !== undefined) return refusal('Host', `Unable to send test message: ${why}`);
  if (typeof key !== 'string' || key === '') {
    return refusal('ApiKey', "'Api Key' must not be empty.");
  }
  return jellyfin.apiKeys.some((k) => k.AccessToken === key)
    ? undefined
    : refusal('ApiKey', 'API Key is invalid');
}

/**
 * Sonarr's and Radarr's connections, as fakeStackApis answers them, as strictly as the
 * arrs: served as their other providers are, one with a trigger on tested as it is saved
 * (one with none is saved untested), and tested against `media.jellyfin`, or for a Plex
 * one, `media.plex` with the tokens `media.plexTv` knows.
 */
export function fakeServarrConnections(
  request: FakeRequest,
  service: string,
  state: FakeAppState,
  media: { jellyfin: FakeAppState; plex: FakeAppState; plexTv: FakePlexTvState },
): FakeReply | undefined {
  return fakeProviders<FakeConnection>(request, {
    path: '/api/v3/notification',
    held: state.connections,
    templates: () => [mediaBrowserTemplate(service), plexServerTemplate(service)],
    test: (sent, key) =>
      sent.implementation === 'PlexServer'
        ? testPlexConnection(sent, key, state, media.plex, media.plexTv, service)
        : testConnection(sent, key, state, media.jellyfin),
    testedOnCreate: (sent) =>
      Object.entries(sent).some(([name, on]) => name.startsWith('on') && on === true),
  });
}
