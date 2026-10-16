import {
  AppApiError,
  SetupWaiting,
  stackAddress,
  type AppApi,
  type AppApiErrorKind,
  type Bootstrap,
} from '@mediaplane/engine';
import { z } from 'zod';
import { atStackJellyfin, jellyfinSettings } from './jellyfin';

/** Seerr's media-server types (`MediaServerType`): Jellyfin's, and none yet. */
const JELLYFIN = 2;
const NOT_CONFIGURED = 4;

/** The sign-in through Jellyfin: Seerr's first one sets it up. */
const SIGN_IN = '/api/v1/auth/jellyfin';

const publicSettings = z.looseObject({ mediaServerType: z.number() });
const me = z.looseObject({ jellyfinUsername: z.string().nullable().optional() });

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
  async run(api, admin, stack) {
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
    try {
      await session.submit('POST', '/api/v1/auth/logout');
    } catch (cause) {
      // Seerr is set up, as Mediaplane's: that is done. The session is never kept, and
      // runs out by itself (30 days), so a logout that fails fails nothing.
      if (!(cause instanceof AppApiError)) throw cause;
    }
    return undefined;
  },
};
