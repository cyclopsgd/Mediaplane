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

/** Where Plex keeps its settings, its claim's token among them, in its appdata folder. */
export const PREFERENCES =
  'Library/Application Support/Plex Media Server/Preferences.xml';

/** Plex's own token, which its claim gave it, in Preferences.xml. */
const SERVER_TOKEN = /\sPlexOnlineToken="([^"]+)"/;

const identity = z.looseObject({
  MediaContainer: z.looseObject({ claimed: z.boolean() }),
});

type Identity = z.infer<typeof identity>['MediaContainer'];

/**
 * What Plex says of itself to anyone (`/identity`): whether it is claimed. Asked without
 * your token, which goes to Plex only once it is shown to be yours.
 */
async function identityOf(api: AppApi): Promise<Identity> {
  return (await api.until('/identity', identity, () => true, { anonymous: true }))
    .MediaContainer;
}

/** Your Plex token, which the setup claims Plex with, from the stack's keys. */
function tokenOf(ctx: BootstrapContext): string | undefined {
  return ctx.keys.plex?.token;
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
    if (!(cause instanceof PlexTvError)) throw cause;
    if (cause.unsure) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed, and Mediaplane couldn't tell whether by your plex.tv account: ${cause.message}`,
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
 * - It is done once Preferences.xml holds a token (`PlexOnlineToken`), and Mediaplane's
 *   record names Plex: the token is yours, never one Mediaplane made.
 */
export const plexBootstrap: Bootstrap = {
  done: { path: PREFERENCES, pattern: /\sPlexOnlineToken="[^"]+"/ },
  open: async (api) => !(await identityOf(api)).claimed,
  async firstStart(_stack, ctx) {
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
      if (!(cause instanceof PlexTvError)) throw cause;
      throw new BootstrapFailed(
        `Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: ${cause.message}`,
        cause.kind === 'refused'
          ? 'plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again'
          : 'check that this host reaches plex.tv, then run apply again',
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
    return undefined;
  },
  claimedHint: (_stack, container) =>
    `First: if that plex.tv account is yours too, run "mediaplane plex-login" and sign in as it, then run apply again. Or second, keeping what Plex holds: stop it ("docker stop ${container}"), remove every attribute whose name starts with PlexOnline from appdata/plex/${PREFERENCES}, then run apply again, which claims it as yours. Last, only if you don't need what it holds: start it afresh, as the runbook says`,
};
