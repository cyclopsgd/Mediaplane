import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppApiError,
  BootstrapFailed,
  PlexTvError,
  type AppApi,
  type Bootstrap,
  type BootstrapContext,
} from '@mediaplane/engine';
import { z } from 'zod';
import { failedCall } from '../_shared/plextv';
import { prefs } from './integration';

/** Where Plex keeps its settings, its claim's token among them, in its appdata folder. */
export const PREFERENCES =
  'Library/Application Support/Plex Media Server/Preferences.xml';

/**
 * Plex's own token, which its claim gave it, in Preferences.xml. The one pattern is both
 * what says the setup is done and what reads the token.
 */
const SERVER_TOKEN = /\sPlexOnlineToken="([^"]+)"/;

const identity = z.looseObject({
  MediaContainer: z.looseObject({ claimed: z.boolean() }),
});

type Identity = z.infer<typeof identity>['MediaContainer'];

/**
 * What Plex says of itself to anyone (`/identity`): whether it is claimed. One GET, asked
 * without your token, which goes to Plex only once it is shown to be yours. Its time
 * limit is the client's: a GET that Plex doesn't answer is tried again until the app
 * deadline.
 */
async function identityOf(api: AppApi): Promise<Identity> {
  return (await api.get('/identity', identity, { anonymous: true })).MediaContainer;
}

/** The most of a text Plex holds that a message shows, in characters. */
const SHOWN_MAX = 120;

/**
 * A text Plex holds, as a message may show it: whoever reached Plex while it was unclaimed
 * chose it. Control characters (and line and paragraph separators) are dropped, it is cut
 * at SHOWN_MAX characters with an ellipsis, and quoted as JSON.
 */
function shown(text: string): string {
  const clean = Array.from(text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ''));
  return JSON.stringify(
    clean.length > SHOWN_MAX ? `${clean.slice(0, SHOWN_MAX).join('')}…` : clean.join(''),
  );
}

/**
 * A setting of Plex that, left as whoever reached it unclaimed set it, lets a client use
 * Plex without signing in (probed on the pinned image). Mediaplane never sets them.
 */
interface OpenSetting {
  /** Its id in `GET /:/prefs`. */
  id: string;
  /** Whether `value`, as Plex gives it, is safe. Anything not understood is not. */
  safe: (value: unknown) => boolean;
  /** What a message says of a value that is not safe. */
  says: (value: unknown) => string;
  /** Its default, as Preferences.xml writes it (an attribute; a boolean is "0" or "1"). */
  reset: string;
}

/** A value of a setting, as a message shows it: text quoted and capped, else as JSON. */
function valueShown(value: unknown): string {
  if (typeof value === 'string') return shown(value);
  if (typeof value === 'number' || typeof value === 'boolean')
    return JSON.stringify(value);
  return 'a value it does not give';
}

/**
 * The settings a Plex of yours must have as Plex defaults them, or stricter, before it is
 * published. Each is anything whoever reached Plex while it was unclaimed could have set
 * over `PUT /:/prefs` with no token (probed), and which survives the claim:
 * - `allowedNetworks`, the networks let in without a sign-in: none;
 * - `enableLocalSecurity`, hidden: -1 (Plex's default; a claimed Plex answered 401 to a
 *   client with no token, by IP, probed) or 1 (stricter). Anything else, 0 included, is
 *   not known to be safe;
 * - `DlnaEnabled`: off. DLNA streams with no Plex sign-in.
 * A setting that is missing, or not of the type Plex gives, is not safe either.
 */
const OPEN_SETTINGS: readonly OpenSetting[] = [
  {
    id: 'allowedNetworks',
    safe: (value) => value === '',
    says: (value) =>
      `lets ${typeof value === 'string' ? shown(value) : 'networks it does not name'} in without a sign-in (allowedNetworks)`,
    reset: 'allowedNetworks=""',
  },
  {
    id: 'enableLocalSecurity',
    safe: (value) => value === -1 || value === 1,
    says: (value) =>
      `has enableLocalSecurity at ${valueShown(value)}, not -1 or 1, so a client may be let in without a sign-in`,
    reset: 'enableLocalSecurity="-1"',
  },
  {
    id: 'DlnaEnabled',
    safe: (value) => value === false,
    says: (value) =>
      `has DlnaEnabled at ${valueShown(value)}, not false, and DLNA streams without a sign-in`,
    reset: 'DlnaEnabled="0"',
  },
];

/** The settings of OPEN_SETTINGS that Plex's answer to `GET /:/prefs` doesn't show safe. */
function opens(settings: readonly { id: string; value?: unknown }[]): OpenSetting[] {
  return OPEN_SETTINGS.filter(
    (open) => !open.safe(settings.find((s) => s.id === open.id)?.value),
  );
}

/** Your Plex token, which the setup claims Plex with, from the stack's keys. */
function tokenOf(ctx: BootstrapContext): string | undefined {
  return ctx.given.plex?.token;
}

/**
 * Plex's own token, from its Preferences.xml in `home`; undefined when it holds none.
 * Throws AppApiError when the file can't be read.
 */
async function serverTokenOf(api: AppApi, home: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(home, 'appdata', 'plex', PREFERENCES), 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? 'no reason given';
    throw new AppApiError(
      `${api.name} at ${api.where} is claimed, and Mediaplane can't read appdata/plex/${PREFERENCES} (${code}) to tell by whose plex.tv account`,
      { kind: 'rejected' },
    );
  }
  const found = SERVER_TOKEN.exec(text)?.[1];
  if (found !== undefined) api.addSecret(found);
  return found;
}

/**
 * The id of the plex.tv account `token` is a token of, as plex.tv says; undefined when
 * plex.tv refuses it. `whose` names the token in a failure.
 */
async function accountOf(
  api: AppApi,
  ctx: BootstrapContext,
  token: string,
  whose: 'yours' | "Plex's",
): Promise<number | undefined> {
  try {
    return await ctx.plexTv.accountId(token);
  } catch (cause) {
    // Not plex.tv's answer (a helper or Docker error): as if it hadn't answered.
    if (!(cause instanceof PlexTvError) || cause.unsure) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed, and Mediaplane couldn't tell whether by your plex.tv account: ${cause instanceof PlexTvError ? cause.message : failedCall(cause)}`,
        { kind: 'auth', unsure: true },
      );
    }
    if (cause.kind === 'refused' && whose === "Plex's") return undefined;
    throw new AppApiError(
      cause.kind === 'refused'
        ? `${api.name} at ${api.where} is claimed, and plex.tv refused your Plex token when asked whose it is: ${cause.message}. Run "mediaplane plex-login" to sign in again`
        : `${api.name} at ${api.where} is claimed, and plex.tv's answer doesn't say by whose account: ${cause.message}`,
      { kind: 'rejected' },
    );
  }
}

/** What to do when plex.tv gives no claim token, failing with `cause`. */
function claimHint(cause: unknown): string {
  if (cause instanceof PlexTvError && cause.kind === 'refused') {
    return 'plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again';
  }
  // A 403 that won't clear may be about the account, not the host.
  if (cause instanceof PlexTvError && cause.status === 403) {
    return 'check that this host reaches plex.tv, or that this plex.tv account may claim a server, then run apply again';
  }
  return 'check that this host reaches plex.tv, then run apply again';
}

/**
 * Plex's first-run setup: its claim (spec §6.1, §6.4). An unclaimed Plex lets anyone who
 * reaches it at an address claim it, with a claim token of their own plex.tv account and
 * no sign-in (probed: `POST /myplex/claim` answered 200), so it starts unpublished.
 * - Its first start gets PLEX_CLAIM, a claim token apply fetches from plex.tv with your
 *   token just before (`firstStart`): the image trades it at plex.tv for a token of your
 *   account, and saves it in Preferences.xml, as Plex's `PlexOnlineToken`, before Plex
 *   starts for good. A claim token lasts four minutes and is used once.
 * - The setup waits, as long as apply waits for an app, until Plex says it is claimed:
 *   the image starts Plex once for its config, unclaimed, and the container can be healthy
 *   then (probed). One that doesn't claim itself in that time stays unpublished: its claim
 *   token ran out, or it couldn't reach plex.tv.
 * - A claimed Plex is yours only when plex.tv says the token its claim gave it, in its
 *   Preferences.xml, is your account's: plex.tv answers that, not Plex. Plex's admin can
 *   change what Plex says of itself, its machine identifier too (probed), but can't make
 *   it hold a token of your account without one. Anything else is refused (`auth`), and
 *   Plex stays unpublished: another account's token, or one plex.tv refuses, as it does
 *   once the server is removed from its account (probed). plex.tv unanswered (a timeout, a
 *   5xx, no connection) is `unsure`, as is a claimed Plex whose file holds no token.
 * - Before it is done, a Plex of yours must let no client in without a sign-in:
 *   `allowedNetworks` empty, `enableLocalSecurity` -1 or 1, `DlnaEnabled` off
 *   (OPEN_SETTINGS). Anyone could set them while it was unclaimed. Plex's settings are
 *   asked for with your token, on that one call, once plex.tv has said this Plex is yours:
 *   the setup's client carries no token of yours.
 * - It is done once Preferences.xml holds a token (`PlexOnlineToken`), and Mediaplane's
 *   record names Plex: the token is yours, never one Mediaplane made.
 */
export const plexBootstrap: Bootstrap = {
  done: { path: PREFERENCES, pattern: SERVER_TOKEN },
  open: async (api) => !(await identityOf(api)).claimed,
  async firstStart(ctx) {
    const token = tokenOf(ctx);
    if (token === undefined) {
      throw new BootstrapFailed(
        "Plex can't be claimed: Mediaplane has no Plex token, so nothing was started",
        'run "mediaplane plex-login", then run apply again',
      );
    }
    try {
      return { PLEX_CLAIM: await ctx.plexTv.claimToken(token) };
    } catch (cause) {
      // Any other failure to call plex.tv is as if it hadn't answered.
      throw new BootstrapFailed(
        `Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: ${cause instanceof PlexTvError ? cause.message : failedCall(cause)}`,
        claimHint(cause),
      );
    }
  },
  async run(api, _admin, stack, ctx) {
    const token = tokenOf(ctx);
    if (token === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} can't be claimed: Mediaplane has no Plex token (plex.token)`,
        { kind: 'rejected' },
      );
    }
    // As long as apply waits for an app, as Plex claims itself as it first starts.
    const held = (
      await api.until('/identity', identity, (i) => i.MediaContainer.claimed, {
        anonymous: true,
      })
    ).MediaContainer;
    if (!held.claimed) {
      throw new AppApiError(
        `${api.name} at ${api.where} didn't claim itself as it started, so it stays unpublished: its claim token may have run out, or it couldn't reach plex.tv; its log says which ("mediaplane status plex" names its container)`,
        { kind: 'rejected' },
      );
    }
    const serverToken = await serverTokenOf(api, stack.home);
    if (serverToken === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed, and its Preferences.xml holds no token of its claim, so Mediaplane couldn't tell whether by your plex.tv account`,
        { kind: 'auth', unsure: true },
      );
    }
    const yours = await accountOf(api, ctx, token, 'yours');
    const its = await accountOf(api, ctx, serverToken, "Plex's");
    if (its === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed by no plex.tv account of yours: plex.tv refuses the token its claim gave it, as it does once the server is removed from its account`,
        { kind: 'auth' },
      );
    }
    if (its !== yours) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed by another plex.tv account than yours: plex.tv says the token its claim gave it is another account's`,
        { kind: 'auth' },
      );
    }
    // Yours, so it may have your token now, on this one call (the setup's client carries
    // none). While it was unclaimed, anyone who reached it could change its settings, and
    // they survive the claim (probed): a network, a local client or DLNA let in without a
    // sign-in would be open once it is published. Asked here only, so one you set later,
    // on purpose, is left alone.
    const { Setting } = (await api.withKey(token).get('/:/prefs', prefs)).MediaContainer;
    const open = opens(Setting);
    if (open.length > 0) {
      const ids = open.map((o) => o.id).join(', ');
      const problems = open
        .map((o) => o.says(Setting.find((s) => s.id === o.id)?.value))
        .join('; ');
      const many = open.length > 1;
      throw new AppApiError(
        `${api.name} at ${api.where} is yours, but ${problems}. Mediaplane never sets ${ids}: ${many ? 'these' : 'this'} may have been set while Plex was unclaimed, so Plex stays unpublished. Stop it ("mediaplane status plex" names its container; then "docker stop <container>"), reset ${ids} in appdata/plex/${PREFERENCES} (delete ${many ? 'each attribute' : 'the attribute'}, or else set ${many ? 'each' : 'it'} to its default as the file writes it: ${open.map((o) => o.reset).join(', ')}), then run apply again`,
        { kind: 'rejected' },
      );
    }
    return undefined;
  },
  claimedHint: (_stack, container) =>
    `First: if that plex.tv account is yours too, run "mediaplane plex-login --force" and sign in as it (without --force, plex-login keeps a saved token that plex.tv still takes), then run apply again. Or second, keeping what Plex holds: stop it ("docker stop ${container}"), remove every attribute whose name starts with PlexOnline from appdata/plex/${PREFERENCES}, then run apply again, which claims it as yours. Last, only if you don't need what it holds: start it afresh, as the runbook says`,
};
