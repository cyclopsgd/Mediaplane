import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import type { FakePlexTvState } from './plextv';
import {
  fieldValue,
  refusal,
  unreachable,
  type FakeProviderBase,
  type FakeRefusal,
} from './providers';
import type { FakeAppState } from './wiring';

/** One of Plex's libraries (its "sections"), as Plex keeps it. */
export interface FakePlexSection {
  key: string;
  title: string;
  type: 'movie' | 'show';
  agent: string;
  scanner: string;
  language: string;
  locations: string[];
}

/** What the fake Plex holds; a test may change it between calls. */
export interface FakePlex {
  /** Its machine identifier, which plex.tv lists it by once it is claimed. */
  machineId: string;
  /** The plex.tv account that claimed it; null while it is unclaimed. */
  owner: number | null;
  /** Its own token, from its claim (`PlexOnlineToken`); '' while unclaimed. */
  serverToken: string;
  /** Its name; '' leaves it the container's hostname, as Plex does. */
  friendlyName: string;
  /** Whether its remote access is on (`PublishServerOnPlexOnlineKey`): off, at first. */
  remoteAccess: boolean;
  /** The networks allowed in without signing in (`allowedNetworks`): none, at first. */
  allowedNetworks: string;
  /**
   * Whether local clients must sign in (`enableLocalSecurity`, hidden): -1 at first, Plex's
   * default; 1 is stricter. A claimed Plex answered 401 to a client with no token, by IP,
   * at -1 and at 0 alike (probed), but only -1 and 1 are known to be what Plex means.
   */
  enableLocalSecurity: number;
  /** Whether its DLNA server is on (`DlnaEnabled`, off at first): DLNA has no sign-in. */
  dlnaEnabled: boolean;
  sections: FakePlexSection[];
  /**
   * A fault: what GET /:/prefs answers (to a token Plex takes) instead of its settings,
   * such as a 500 or an answer that isn't the settings'.
   */
  prefsAnswer?: FakeReply;
  /**
   * What a POST that makes a library lists in its answer: just the new one (the default),
   * every library Plex has, the new one last, or only a library that isn't the one asked
   * for.
   */
  createListing?: 'new' | 'every' | 'other';
  /**
   * How many more times /identity says it is unclaimed though it is claimed: Plex stops a
   * server it started for its config, claims itself, then starts again (probed).
   */
  claimingFor: number;
  /**
   * How many more times /identity says it is still starting (`startState`), and a new
   * library is refused, as Plex does for a few seconds after every start (probed).
   */
  startingFor: number;
  /**
   * Its appdata folder: the fake keeps Preferences.xml there as Plex does, with its
   * machine identifier, and its token once claimed. Unset: nowhere.
   */
  configDir?: string;
  /**
   * Signed out of its plex.tv account while it ran (`DELETE /myplex/account`, as its web
   * UI's sign-out does): unclaimed, with `PlexOnlineToken=""` in its Preferences.xml, which
   * the image's own claim step takes for a claim, so a PLEX_CLAIM is never used (probed).
   */
  signedOut?: boolean;
}

/** Where Plex keeps Preferences.xml in its appdata folder. */
export const PLEX_PREFERENCES =
  'Library/Application Support/Plex Media Server/Preferences.xml';

/** The hostname a container of the fake Plex has: Plex's name for itself by default. */
export const FAKE_PLEX_HOSTNAME = 'f00dfeed1234';

/** A fake Plex as it first starts: unclaimed, with no library. */
export function freshPlex(): FakePlex {
  return {
    machineId: 'fake-machine-identifier-0001',
    owner: null,
    serverToken: '',
    friendlyName: '',
    remoteAccess: false,
    allowedNetworks: '',
    enableLocalSecurity: -1,
    dlnaEnabled: false,
    sections: [],
    claimingFor: 0,
    startingFor: 0,
  };
}

/** The server token a fake Plex gets from the first claim a fake plex.tv takes. */
export const FAKE_SERVER_TOKEN = 'fake-server-token-01';

/** Plex's refusal of a call it won't take: an HTML page, 401 (probed). */
const UNAUTHORIZED: FakeReply = {
  status: 401,
  body: '<html><head><title>Unauthorized</title></head><body><h1>401 Unauthorized</h1></body></html>',
};

/** Plex's refusal of a request it can't take, such as a section without its agent. */
const BAD_REQUEST: FakeReply = {
  status: 400,
  body: '<html><head><title>Bad Request</title></head><body><h1>400 Bad Request</h1></body></html>',
};

/**
 * Preferences.xml, as Plex writes it: one element of attributes, its token among them
 * once it is claimed. The fake writes it on each request it answers, and at a claim.
 */
function keepPreferences(plex: FakePlex): void {
  if (plex.configDir === undefined) return;
  const path = join(plex.configDir, PLEX_PREFERENCES);
  mkdirSync(dirname(path), { recursive: true });
  const token =
    plex.serverToken !== ''
      ? ` PlexOnlineToken="${plex.serverToken}"`
      : plex.signedOut === true
        ? ' PlexOnlineToken=""'
        : '';
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="utf-8"?>\n<Preferences MachineIdentifier="${plex.machineId}" ProcessedMachineIdentifier="${plex.machineId}"${token}/>\n`,
  );
}

/**
 * What Plex's first start does with its PLEX_CLAIM (the image's own claim step): trade the
 * claim token at plex.tv for a token of its own, which plex.tv takes as the account's
 * that asked for the claim, and save it in Preferences.xml. A token plex.tv doesn't know,
 * or one used already, leaves Plex unclaimed, as the image's "Unable to claim" does. True
 * when it claimed itself.
 */
export function claimFakePlex(
  plex: FakePlex,
  claim: string | undefined,
  plexTv: FakePlexTvState,
): boolean {
  // The image's step looks for PlexOnlineToken's name: signed out, it skips the claim.
  if (plex.signedOut === true) return false;
  return claimWith(plex, claim, plexTv);
}

/**
 * The fake Plex signed out of its plex.tv account while it runs, as its web UI's sign-out
 * does (`DELETE /myplex/account`): unclaimed at once, and Preferences.xml rewritten with
 * `PlexOnlineToken=""` (probed).
 */
export function signOutFakePlex(plex: FakePlex): void {
  Object.assign(plex, { owner: null, serverToken: '', signedOut: true });
  keepPreferences(plex);
}

/**
 * A claim of the fake Plex for the account that asked plex.tv for `claim`, as Plex makes
 * it, from the image's step or from `POST /myplex/claim`: a token plex.tv doesn't know, or
 * one used already, or a Plex claimed already, claims nothing.
 */
function claimWith(
  plex: FakePlex,
  claim: string | undefined,
  plexTv: FakePlexTvState,
): boolean {
  const known = plexTv.claims.find((c) => c.token === claim && !c.used);
  if (known === undefined || plex.owner !== null) return false;
  known.used = true;
  plex.signedOut = false;
  plex.owner = known.account;
  plex.serverToken = `fake-server-token-${String(plexTv.servers.length + 1).padStart(2, '0')}`;
  // Claimed again, it is the same server to plex.tv, with a new token.
  plexTv.servers = plexTv.servers.filter((s) => s.machineId !== plex.machineId);
  plexTv.servers.push({
    machineId: plex.machineId,
    owner: known.account,
    name: plex.friendlyName === '' ? FAKE_PLEX_HOSTNAME : plex.friendlyName,
    token: plex.serverToken,
  });
  keepPreferences(plex);
  return true;
}

/** Whether the fake Plex takes `token`: its claim's account's, or its own. */
export function plexTakes(
  plex: FakePlex,
  token: unknown,
  plexTv: FakePlexTvState,
): boolean {
  const account = plexTv.accounts.find((a) => a.token === token);
  return (
    plex.owner !== null &&
    typeof token === 'string' &&
    token !== '' &&
    (account?.id === plex.owner || token === plex.serverToken)
  );
}

/**
 * Sonarr's or Radarr's test of a connection to Plex, `sent` holding `token` in clear: its
 * refusal, or undefined when it passes. As theirs does (probed), it reaches Plex by its
 * service (plex), while it runs, at 32400, without TLS or a URL base, and asks for its
 * libraries with the token: one Plex refuses is `AuthToken: Authentication Token is
 * invalid`. A `testFailure` set on the arr overrides every check. `service` is the arr's
 * (sonarr or radarr): the library it needs is a TV one, or a Movie one.
 */
export function testPlexConnection(
  sent: FakeProviderBase,
  token: unknown,
  state: FakeAppState,
  plex: FakeAppState,
  plexTv: FakePlexTvState,
  service: string,
): FakeRefusal | undefined {
  const value = (name: string) => fieldValue(sent, name);
  if (state.testFailure !== '') return refusal('Host', state.testFailure);
  const base = value('urlBase');
  const why = unreachable(
    `${String(value('host'))}:${String(value('port'))}`,
    {
      resolves:
        value('host') === 'plex' && plex.up && (base === undefined || base === ''),
      portOpen: value('port') === 32400,
      tls: value('useSsl') === true,
    },
    'Resource temporarily unavailable',
  );
  if (why !== undefined) {
    return refusal('Host', 'Unable to connect to Plex Media Server', why);
  }
  if (!plexTakes(plex.plex, token, plexTv)) {
    return refusal('AuthToken', 'Authentication Token is invalid');
  }
  // The arr needs a library of what it files (probed): Sonarr a TV one, Radarr a Movie one.
  const radarr = service === 'radarr';
  const holds = radarr ? 'movie' : 'show';
  return plex.plex.sections.some((s) => s.type === holds)
    ? undefined
    : refusal('Host', `At least one ${radarr ? 'Movie' : 'TV'} library is required`);
}

function sectionShown(section: FakePlexSection) {
  return {
    key: section.key,
    title: section.title,
    type: section.type,
    agent: section.agent,
    scanner: section.scanner,
    language: section.language,
    uuid: `fake-uuid-${section.key}`,
    Location: section.locations.map((path, i) => ({ id: i + 1, path })),
  };
}

/**
 * Plex Media Server 1.43's API, as fakeStackApis answers it for `Host: plex`, from `plex`,
 * as Plex answered it when probed (2026-10-16):
 * - `/identity` answers anyone, saying whether it is claimed;
 * - everything else takes only a token of the account that claimed it (from `plexTv`), or
 *   its own server token: no token, another account's, or any call while it is unclaimed
 *   (the `Host` is a name, so Plex's DNS-rebinding check refuses it) is a 401 page;
 * - `/:/prefs` lists its settings, and a PUT sets them (an unknown one is a 400);
 * - `/library/sections` lists its libraries; a POST makes one, which needs its type,
 *   agent, scanner and language (400 without), and takes a second of one name and a
 *   folder that doesn't exist; a PUT of one needs its agent, sets its name and folders,
 *   and can't change its type (400); a DELETE removes one.
 */
export function fakePlex(
  request: FakeRequest,
  plex: FakePlex,
  plexTv: FakePlexTvState,
): FakeReply {
  keepPreferences(plex);
  const url = new URL(request.path, 'http://plex');
  const { method } = request;
  const query = (name: string) => url.searchParams.get(name) ?? '';
  if (url.pathname === '/identity' && method === 'GET') {
    const claiming = plex.claimingFor > 0;
    if (claiming) plex.claimingFor -= 1;
    const starting = plex.startingFor > 0;
    if (starting) plex.startingFor -= 1;
    return {
      status: 200,
      body: {
        MediaContainer: {
          size: 0,
          apiVersion: '1.2.3',
          claimed: plex.owner !== null && !claiming,
          machineIdentifier: plex.machineId,
          ...(starting ? { startState: 'startingPlugins' } : {}),
          version: '1.43.4.10903-e5521bd8c',
        },
      },
    };
  }
  // Unclaimed, it is claimed by anyone who posts a claim token of their account to its
  // address (probed: 200; to a name, its DNS-rebinding check refuses it, 401). One that
  // claims nothing is refused (any refusal will do: not probed).
  if (url.pathname === '/myplex/claim' && method === 'POST' && plex.owner === null) {
    const host = (request.headers.host ?? '').split(':')[0] ?? '';
    if (!/^\d+(\.\d+){3}$/.test(host)) return UNAUTHORIZED;
    return claimWith(plex, query('token'), plexTv)
      ? { status: 200, body: { MyPlex: { signInState: 'ok' } } }
      : BAD_REQUEST;
  }
  if (!plexTakes(plex, request.headers['x-plex-token'], plexTv)) return UNAUTHORIZED;
  if (url.pathname === '/myplex/account' && method === 'DELETE') {
    signOutFakePlex(plex);
    return { status: 200, body: { MyPlex: { signInState: 'none' } } };
  }
  if (url.pathname === '/' && method === 'GET') {
    return {
      status: 200,
      body: {
        MediaContainer: {
          friendlyName: plex.friendlyName === '' ? FAKE_PLEX_HOSTNAME : plex.friendlyName,
          machineIdentifier: plex.machineId,
        },
      },
    };
  }
  if (url.pathname === '/:/prefs' && method === 'GET') {
    if (plex.prefsAnswer !== undefined) return plex.prefsAnswer;
    return {
      status: 200,
      body: {
        MediaContainer: {
          size: 5,
          Setting: [
            { id: 'FriendlyName', type: 'text', default: '', value: plex.friendlyName },
            {
              id: 'PublishServerOnPlexOnlineKey',
              type: 'bool',
              default: false,
              value: plex.remoteAccess,
            },
            {
              id: 'allowedNetworks',
              type: 'text',
              default: '',
              value: plex.allowedNetworks,
            },
            {
              id: 'enableLocalSecurity',
              type: 'int',
              default: -1,
              value: plex.enableLocalSecurity,
            },
            { id: 'DlnaEnabled', type: 'bool', default: false, value: plex.dlnaEnabled },
          ],
        },
      },
    };
  }
  if (url.pathname === '/:/prefs' && method === 'PUT') {
    for (const [name, value] of url.searchParams) {
      if (name === 'FriendlyName') plex.friendlyName = value;
      else if (name === 'PublishServerOnPlexOnlineKey') plex.remoteAccess = value === '1';
      else if (name === 'allowedNetworks') plex.allowedNetworks = value;
      else if (name === 'enableLocalSecurity') plex.enableLocalSecurity = Number(value);
      else if (name === 'DlnaEnabled') plex.dlnaEnabled = value === '1';
      else {
        return {
          status: 400,
          body: `cannot set preference value for unknown preference ${name}`,
        };
      }
    }
    return { status: 200 };
  }
  if (url.pathname === '/library/sections' && method === 'GET') {
    return {
      status: 200,
      body: {
        MediaContainer: {
          size: plex.sections.length,
          title1: 'Plex Library',
          ...(plex.sections.length === 0
            ? {}
            : { Directory: plex.sections.map(sectionShown) }),
        },
      },
    };
  }
  if (url.pathname === '/library/sections' && method === 'POST') {
    if (plex.startingFor > 0) {
      return {
        status: 400,
        body: 'the server is still starting up. Please retry later\n',
      };
    }
    const type = query('type');
    if (
      (type !== 'movie' && type !== 'show') ||
      query('agent') === '' ||
      query('scanner') === '' ||
      query('language') === '' ||
      query('name') === ''
    ) {
      return BAD_REQUEST;
    }
    const made: FakePlexSection = {
      key: String(Math.max(0, ...plex.sections.map((s) => Number(s.key))) + 1),
      title: query('name'),
      type,
      agent: query('agent'),
      scanner: query('scanner'),
      language: query('language'),
      locations: url.searchParams.getAll('location'),
    };
    const before = plex.sections.map(sectionShown);
    plex.sections.push(made);
    const listed =
      plex.createListing === 'every'
        ? [...before, sectionShown(made)]
        : plex.createListing === 'other'
          ? [sectionShown({ ...made, key: '99', title: 'Elsewhere' })]
          : [sectionShown(made)];
    return {
      status: 201,
      body: { MediaContainer: { size: listed.length, Directory: listed } },
    };
  }
  const one = /^\/library\/sections\/(\d+)$/.exec(url.pathname);
  const section = plex.sections.find((s) => s.key === one?.[1]);
  if (one !== null && method === 'PUT') {
    if (section === undefined) return { status: 404 };
    if (query('agent') === '') return BAD_REQUEST;
    if (url.searchParams.has('type') && query('type') !== section.type)
      return BAD_REQUEST;
    if (url.searchParams.has('name')) section.title = query('name');
    const locations = url.searchParams.getAll('location');
    if (locations.length > 0) section.locations = locations;
    return { status: 200 };
  }
  if (one !== null && method === 'DELETE') {
    if (section === undefined) return { status: 404 };
    plex.sections.splice(plex.sections.indexOf(section), 1);
    return { status: 200 };
  }
  return { status: 404 };
}
