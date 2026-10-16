import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import type { FakePlexTvState } from './plextv';

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
  sections: FakePlexSection[];
  /**
   * How many more times /identity says it is unclaimed though it is claimed: Plex stops a
   * server it started for its config, claims itself, then starts again (probed).
   */
  claimingFor: number;
  /**
   * Its appdata folder: the fake keeps Preferences.xml there as Plex does, with its
   * machine identifier, and its token once claimed. Unset: nowhere.
   */
  configDir?: string;
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
    sections: [],
    claimingFor: 0,
  };
}

/** The server token a fake Plex gets from the first claim a fake plex.tv takes. */
export const FAKE_SERVER_TOKEN = 'fake-server-token-01';

/** Plex's refusal of a call it won't take: an HTML page, 401 (probed). */
const UNAUTHORIZED: FakeReply = {
  status: 401,
  body: '<html><head><title>Unauthorized</title></head><body><h1>401 Unauthorized</h1></body></html>',
};

/**
 * Preferences.xml, as Plex writes it: one element of attributes, its token among them
 * once it is claimed. The fake writes it on each request it answers, and at a claim.
 */
function keepPreferences(plex: FakePlex): void {
  if (plex.configDir === undefined) return;
  const path = join(plex.configDir, PLEX_PREFERENCES);
  mkdirSync(dirname(path), { recursive: true });
  const token = plex.serverToken === '' ? '' : ` PlexOnlineToken="${plex.serverToken}"`;
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
  const known = plexTv.claims.find((c) => c.token === claim && !c.used);
  if (known === undefined || plex.owner !== null) return false;
  known.used = true;
  plex.owner = known.account;
  plex.serverToken = `fake-server-token-${String(plexTv.servers.length + 1).padStart(2, '0')}`;
  plexTv.servers.push({
    machineId: plex.machineId,
    owner: known.account,
    name: plex.friendlyName === '' ? FAKE_PLEX_HOSTNAME : plex.friendlyName,
    token: plex.serverToken,
  });
  keepPreferences(plex);
  return true;
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
 * - `/library/sections` lists its libraries.
 */
export function fakePlex(
  request: FakeRequest,
  plex: FakePlex,
  plexTv: FakePlexTvState,
): FakeReply {
  keepPreferences(plex);
  const url = new URL(request.path, 'http://plex');
  const { method } = request;
  if (url.pathname === '/identity' && method === 'GET') {
    const starting = plex.claimingFor > 0;
    if (starting) plex.claimingFor -= 1;
    return {
      status: 200,
      body: {
        MediaContainer: {
          size: 0,
          apiVersion: '1.2.3',
          claimed: plex.owner !== null && !starting,
          machineIdentifier: plex.machineId,
          version: '1.43.4.10903-e5521bd8c',
        },
      },
    };
  }
  const token = request.headers['x-plex-token'];
  const account = plexTv.accounts.find((a) => a.token === token);
  const takes =
    plex.owner !== null &&
    typeof token === 'string' &&
    (account?.id === plex.owner || token === plex.serverToken);
  if (!takes) return UNAUTHORIZED;
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
  return { status: 404 };
}
