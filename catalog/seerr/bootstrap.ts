import {
  AppApiError,
  serviceAddress,
  SetupWaiting,
  type AppApi,
  type Bootstrap,
} from '@mediaplane/engine';
import { z } from 'zod';

/** Seerr's media-server types (`MediaServerType`): Jellyfin's, and none yet. */
const JELLYFIN = 2;
const NOT_CONFIGURED = 4;

/** The sign-in through Jellyfin: Seerr's first one sets it up. */
const SIGN_IN = '/api/v1/auth/jellyfin';

const publicSettings = z.looseObject({ mediaServerType: z.number() });
const me = z.looseObject({ jellyfinUsername: z.string().nullable().optional() });
const jellyfinSettings = z.looseObject({
  ip: z.string(),
  port: z.number(),
  apiKey: z.string(),
});

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
 * admin, or its Jellyfin isn't the stack's. It is asked with the key, never by sending the
 * password, which would go to whatever Jellyfin Seerr was set up with. The Jellyfin key
 * Seerr holds, which it shows in clear, is kept out of what the run says.
 */
async function ownSetup(
  api: AppApi,
  admin: { username: string },
  jellyfin: { host: string; port: number },
): Promise<void> {
  const { jellyfinUsername } = await api.get('/api/v1/auth/me', me);
  const held = await api.get('/api/v1/settings/jellyfin', jellyfinSettings);
  api.addSecret(held.apiKey);
  if (
    jellyfinUsername !== admin.username ||
    held.ip !== jellyfin.host ||
    held.port !== jellyfin.port
  ) {
    throw new AppApiError(
      `${api.name} at ${api.where} was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin)`,
      { kind: 'auth', status: 403 },
    );
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
    const jellyfin = serviceAddress(
      stack.apps.find((app) => app.def.id === 'jellyfin'),
      'web',
    );
    if (jellyfin === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} can't be set up: the stack runs no Jellyfin for it to sign in through`,
        { kind: 'rejected' },
      );
    }
    if (!(await open(api))) {
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
      if (!(cause instanceof AppApiError) || (await open(api))) throw cause;
      await ownSetup(api, admin, jellyfin);
      return undefined;
    }
    if (session === undefined) {
      throw new SetupWaiting(
        `${api.name} at ${api.where} can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST ${SIGN_IN})`,
      );
    }
    await session.submit('POST', '/api/v1/auth/logout');
    return undefined;
  },
};
