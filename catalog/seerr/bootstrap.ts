import {
  AppApiError,
  PlexTvError,
  SetupWaiting,
  stackAddress,
  type AppApi,
  type AppApiErrorKind,
  type Bootstrap,
  type BootstrapContext,
  type ResolvedStack,
} from '@mediaplane/engine';
import { z } from 'zod';
import { failedCall } from '../_shared/plextv';
import { atStackJellyfin, jellyfinSettings } from './jellyfin';
import { atStackPlex, plexSettings } from './plex';

/** Seerr's media-server types (`MediaServerType`): Jellyfin's, and none yet. */
const JELLYFIN = 2;
const NOT_CONFIGURED = 4;

/** The sign-in through Jellyfin: Seerr's first one sets it up. */
const SIGN_IN = '/api/v1/auth/jellyfin';

/** The sign-in with a plex.tv account: on a Plex stack, Seerr's first one sets it up. */
const PLEX_SIGN_IN = '/api/v1/auth/plex';

const publicSettings = z.looseObject({ mediaServerType: z.number() });
const me = z.looseObject({
  id: z.number().optional(),
  jellyfinUsername: z.string().nullable().optional(),
  plexId: z.number().nullable().optional(),
  plexToken: z.string().nullable().optional(),
});

/** The id of Seerr's first user, which is its admin. */
const ADMIN_ID = 1;

/** Failures of a question Seerr didn't answer: Mediaplane couldn't tell. */
const UNANSWERED: ReadonlySet<AppApiErrorKind> = new Set([
  'timeout',
  'server',
  'unreachable',
]);

/**
 * Whether Seerr's setup is open: until its first sign-in sets its media server, anyone
 * who reaches it can sign in through a Jellyfin of their own and be its admin (probed).
 */
async function open(api: AppApi): Promise<boolean> {
  return (
    (await api.get('/api/v1/settings/public', publicSettings)).mediaServerType ===
    NOT_CONFIGURED
  );
}

/**
 * Sign out of `session`, the one Mediaplane's first sign-in gave. It is never kept, and
 * runs out by itself (30 days), so a logout that fails fails nothing.
 */
async function signOut(session: AppApi): Promise<void> {
  try {
    await session.submit('POST', '/api/v1/auth/logout');
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
  }
}

/**
 * Refuse (`auth`), signing out, a first sign-in whose user isn't Seerr's admin (its first
 * user, id 1), as `session` itself says. Someone may have signed in between the look at
 * Seerr and the sign-in, and a sign-in that Seerr takes of a later user, with access to
 * what the first set, makes that user a user of Seerr's, not its admin: signing out and
 * recording the setup would publish a Seerr someone else is admin of. A session that
 * can't say whose it is is refused too, as `unsure` when Seerr gave no answer; the next
 * apply finds Seerr set up, and asks whether it is Mediaplane's (`ownSetup`,
 * `ownPlexSetup`).
 */
async function requireAdmin(api: AppApi, session: AppApi): Promise<void> {
  let id: number | undefined;
  try {
    id = (await session.get('/api/v1/auth/me', me)).id;
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    await signOut(session);
    throw new AppApiError(
      `${api.name} at ${api.where} signed Mediaplane in, and Mediaplane couldn't tell whether as its admin: ${cause.message}`,
      UNANSWERED.has(cause.kind) ? { kind: 'auth', unsure: true } : { kind: 'auth' },
    );
  }
  if (id === ADMIN_ID) return;
  await signOut(session);
  throw new AppApiError(
    `${api.name} at ${api.where} signed Mediaplane in as a user that isn't its admin, so someone set it up before Mediaplane did (GET /api/v1/auth/me)`,
    { kind: 'auth' },
  );
}

/**
 * Refuse (`auth`) a Seerr that is set up but not Mediaplane's: its admin isn't the shared
 * admin, or its Jellyfin isn't the stack's, with no URL base and no TLS (a user named as
 * the shared admin is easily made on a Jellyfin of one's own, which `@<host>` in the URL
 * base reaches). It is asked with the key, never by sending the password, which would
 * go to whatever Jellyfin Seerr was set up with. The Jellyfin key Seerr holds, which it
 * shows in clear, is kept out of what the run says. A question that goes unanswered (a
 * timeout, a 5xx, no connection) is refused as `unsure`: Mediaplane couldn't tell. An
 * answer that doesn't show the setup is Mediaplane's (another shape, a 4xx) is refused
 * as not its own: a claimant can shape one, as with a `port` of `8096@<host>`.
 */
async function ownSetup(
  api: AppApi,
  admin: { username: string },
  jellyfin: { host: string; port: number },
): Promise<void> {
  let jellyfinUsername: string | null | undefined;
  let held: z.infer<typeof jellyfinSettings>;
  try {
    jellyfinUsername = (await api.get('/api/v1/auth/me', me)).jellyfinUsername;
    held = await api.get('/api/v1/settings/jellyfin', jellyfinSettings);
  } catch (cause) {
    // Not shown to be Mediaplane's is not Mediaplane's: whatever the failure, Seerr
    // stays unpublished (the engine publishes an app that is set up, but for an `auth`).
    if (!(cause instanceof AppApiError) || cause.kind === 'auth') throw cause;
    if (UNANSWERED.has(cause.kind)) {
      throw new AppApiError(
        `${api.name} at ${api.where} is set up, and Mediaplane couldn't tell whether it is its own: ${cause.message}`,
        { kind: 'auth', unsure: true },
      );
    }
    throw new AppApiError(
      `${api.name} at ${api.where} is set up, and its answers don't show that it is Mediaplane's: ${cause.message}`,
      { kind: 'auth' },
    );
  }
  api.addSecret(held.apiKey);
  if (jellyfinUsername !== admin.username || !atStackJellyfin(held, jellyfin)) {
    throw new AppApiError(
      `${api.name} at ${api.where} was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin)`,
      { kind: 'auth' },
    );
  }
}

/**
 * Refuse a Seerr on a Plex stack that is set up but not Mediaplane's: its admin (its
 * first user) isn't your plex.tv account, or its Plex is set and isn't the stack's,
 * without TLS. Your account is plex.tv's answer to your token, and Seerr's admin is the
 * plex.tv account it signed in with, which only that account's token can make it: neither
 * is an answer Seerr's admin can shape. It is asked with Seerr's key, never by signing
 * in, which would hand your token to that Seerr. Every refusal leaves Seerr unpublished.
 * - A question that goes unanswered is `auth` and `unsure`: Seerr's (a timeout, a 5xx,
 *   no connection), plex.tv's (the same, or a 403 or 429), or a failure to call plex.tv
 *   at all (a helper or Docker error).
 * - An answer that shows Seerr isn't Mediaplane's is `auth`: Seerr's (a 4xx, another
 *   shape), or an admin or Plex that isn't yours.
 * - An answer of plex.tv's that doesn't say whose your token is, is `rejected`: its
 *   refusal of your token (401), which says to sign in again, or one it can't read.
 */
async function ownPlexSetup(
  api: AppApi,
  ctx: BootstrapContext,
  token: string,
  plex: { host: string; port: number },
): Promise<void> {
  let held: z.infer<typeof me>;
  let settings: z.infer<typeof plexSettings>;
  try {
    held = await api.get('/api/v1/auth/me', me);
    settings = await api.get('/api/v1/settings/plex', plexSettings);
    if (typeof held.plexToken === 'string') api.addSecret(held.plexToken);
  } catch (cause) {
    // Not shown to be Mediaplane's is not Mediaplane's: whatever the failure, Seerr
    // stays unpublished.
    if (!(cause instanceof AppApiError) || cause.kind === 'auth') throw cause;
    if (UNANSWERED.has(cause.kind)) {
      throw new AppApiError(
        `${api.name} at ${api.where} is set up, and Mediaplane couldn't tell whether it is its own: ${cause.message}`,
        { kind: 'auth', unsure: true },
      );
    }
    throw new AppApiError(
      `${api.name} at ${api.where} is set up, and its answers don't show that it is Mediaplane's: ${cause.message}`,
      { kind: 'auth' },
    );
  }
  let account: number;
  try {
    account = await ctx.plexTv.accountId(token);
  } catch (cause) {
    // An answer from plex.tv that isn't unsure (a 401, one not understood) is refused as
    // not Mediaplane's; anything else, a helper or Docker error included, is as if
    // plex.tv hadn't answered.
    if (cause instanceof PlexTvError && !cause.unsure) {
      throw new AppApiError(
        cause.kind === 'refused'
          ? `${api.name} at ${api.where} is set up, and plex.tv refused your Plex token when asked whose it is: ${cause.message}. Run "mediaplane plex-login" to sign in again`
          : `${api.name} at ${api.where} is set up, and plex.tv's answer doesn't say whose your Plex token is: ${cause.message}`,
        { kind: 'rejected' },
      );
    }
    throw new AppApiError(
      `${api.name} at ${api.where} is set up, and Mediaplane couldn't tell whether it is its own: ${cause instanceof PlexTvError ? cause.message : failedCall(cause)}`,
      { kind: 'auth', unsure: true },
    );
  }
  // Mediaplane's own sign-in leaves Seerr's Plex unset: its wire step sets it.
  const atPlex = settings.ip === '' || atStackPlex(settings, plex);
  if (held.plexId !== account || !atPlex) {
    throw new AppApiError(
      `${api.name} at ${api.where} was set up with another plex.tv account or another Plex (GET /api/v1/auth/me, GET /api/v1/settings/plex)`,
      { kind: 'auth' },
    );
  }
}

/**
 * Seerr's first-run setup on a Plex stack (spec §6.1): its first sign-in, with your
 * plex.tv token (`POST /api/v1/auth/plex`), which makes your account Seerr's admin and
 * Plex its media server type; then signs out. Seerr asks plex.tv whose token it is: one
 * it can't check (a 500) fails the setup. A Seerr set up already, or found set up once
 * the sign-in fails, must be Mediaplane's (`ownPlexSetup`).
 */
async function runPlex(
  api: AppApi,
  stack: ResolvedStack,
  ctx: BootstrapContext,
): Promise<void> {
  const plex = stackAddress(stack, 'plex');
  const token = ctx.keys.plex?.token;
  if (plex === undefined || token === undefined) {
    throw new AppApiError(
      `${api.name} at ${api.where} can't be set up: the stack runs no Plex, or Mediaplane has no Plex token, for it to sign in with`,
      { kind: 'rejected' },
    );
  }
  if (!(await openOrSetUp(api))) {
    await ownPlexSetup(api, ctx, token, plex);
    return;
  }
  let session: AppApi | undefined;
  try {
    session = await api.session(PLEX_SIGN_IN, { authToken: token }, 'connect.sid', [
      token,
    ]);
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    if (!(await openOrSetUp(api))) {
      await ownPlexSetup(api, ctx, token, plex);
      return;
    }
    if (cause.status === 500) {
      throw new AppApiError(
        `${api.name} at ${api.where} couldn't sign in with your Plex token, which it checks at plex.tv: ${cause.message}. Check that Seerr reaches plex.tv, then run apply again`,
        { kind: 'rejected' },
      );
    }
    throw cause;
  }
  if (session === undefined) {
    throw new AppApiError(
      `${api.name} at ${api.where} refused the sign-in with your Plex token (POST ${PLEX_SIGN_IN})`,
      { kind: 'rejected' },
    );
  }
  await requireAdmin(api, session);
  await signOut(session);
}

/**
 * What to do about a Seerr set up with a login Mediaplane can't show is its own: on a
 * Jellyfin stack, make that login the shared admin's, or the shared admin Seerr's admin,
 * at the stack's Jellyfin; on a Plex stack, sign in to Plex as the account it was set up
 * with. Only last, start Seerr afresh.
 */
function claimedHint(stack: ResolvedStack): string {
  if (stack.config.media_server === 'plex') {
    const plex = stackAddress(stack, 'plex');
    const at =
      plex === undefined ? "the stack's Plex" : `${plex.host}:${String(plex.port)}`;
    return `First: if the plex.tv account it was set up with is yours, run "mediaplane plex-login" and sign in as it, with its Plex unset or at ${at}, with no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says`;
  }
  const jellyfin = stackAddress(stack, 'jellyfin');
  const at =
    jellyfin === undefined
      ? "the stack's Jellyfin"
      : `${jellyfin.host}:${String(jellyfin.port)}`;
  return `First: if the Jellyfin login it was set up with is yours, set admin.username and admin.password to it. Or second: make its admin (its first user) the Jellyfin login that admin.username names. Either needs its Jellyfin already at ${at}, with no URL base and no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says`;
}

/**
 * Whether Seerr's setup is open, when it can be asked; a Seerr that can't be asked counts
 * as set up, and `ownSetup` then decides, with its key, whether it is Mediaplane's.
 */
async function openOrSetUp(api: AppApi): Promise<boolean> {
  try {
    return await open(api);
  } catch (cause) {
    if (cause instanceof AppApiError) return false;
    throw cause;
  }
}

/**
 * Seerr's first-run setup (spec §6.1, §6.4): its first sign-in, through Jellyfin, as the
 * shared admin that Jellyfin's setup made. That makes the shared admin Seerr's admin, and
 * sets Jellyfin, at its service and container port, as Seerr's media server. Mediaplane's
 * key, which Seerr takes from API_KEY, works from then on, so the session is signed out
 * of at once. The setup makes no key: Mediaplane chose Seerr's.
 * - Jellyfin refusing the shared admin's password (401) makes the setup wait
 *   (SetupWaiting): the wire step sets Jellyfin's admin, and the next apply signs in.
 * - Done already, as when Mediaplane couldn't read settings.json, it must be Mediaplane's
 *   (`ownSetup`); so must one found set up when the sign-in fails, since someone inside
 *   the stack may have signed in first, between the look and the sign-in (Seerr then
 *   refuses a second Jellyfin, 500). Anything else is refused (`auth`), and Seerr stays
 *   unpublished.
 * - It is done once settings.json names a media server, which Seerr writes as the sign-in
 *   sets it.
 */
export const seerrBootstrap: Bootstrap = {
  done: { path: 'settings.json', pattern: /"mediaServerType":\s*[123]\b/ },
  open,
  claimedHint,
  async run(api, admin, stack, ctx) {
    if (stack.config.media_server === 'plex') {
      await runPlex(api, stack, ctx);
      return undefined;
    }
    const jellyfin = stackAddress(stack, 'jellyfin');
    if (jellyfin === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} can't be set up: the stack runs no Jellyfin for it to sign in through`,
        { kind: 'rejected' },
      );
    }
    if (!(await openOrSetUp(api))) {
      await ownSetup(api, admin, jellyfin);
      return undefined;
    }
    let session: AppApi | undefined;
    try {
      session = await api.session(
        SIGN_IN,
        {
          username: admin.username,
          password: admin.password,
          hostname: jellyfin.host,
          port: jellyfin.port,
          useSsl: false,
          urlBase: '',
          serverType: JELLYFIN,
        },
        'connect.sid',
        [admin.password],
      );
    } catch (cause) {
      // Set up since the look: by someone else, unless it is Mediaplane's own sign-in
      // that reached Seerr before the answer was lost.
      if (!(cause instanceof AppApiError) || (await openOrSetUp(api))) throw cause;
      await ownSetup(api, admin, jellyfin);
      return undefined;
    }
    if (session === undefined) {
      throw new SetupWaiting(
        `${api.name} at ${api.where} can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST ${SIGN_IN})`,
      );
    }
    // Its admin signed in, so Seerr is set up as Mediaplane's: that is done.
    await requireAdmin(api, session);
    await signOut(session);
    return undefined;
  },
};
