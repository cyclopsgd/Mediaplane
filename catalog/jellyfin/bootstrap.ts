import { AppApiError, type AppApi, type Bootstrap } from '@mediaplane/engine';
import { z } from 'zod';

/** The name Mediaplane's API key goes by in Jellyfin (Dashboard → API Keys). */
export const KEY_NAME = 'Mediaplane';

const publicInfo = z.looseObject({ StartupWizardCompleted: z.boolean() });
const startupUser = z.looseObject({ Name: z.string() });
const session = z.looseObject({ AccessToken: z.string() });
const apiKeys = z.looseObject({
  Items: z.array(
    z.looseObject({
      AccessToken: z.string(),
      AppName: z.string(),
      DateCreated: z.string(),
    }),
  ),
});

/** Whether Jellyfin's startup wizard is still open: whoever reaches it can finish it. */
async function open(api: AppApi): Promise<boolean> {
  return !(await api.get('/System/Info/Public', publicInfo)).StartupWizardCompleted;
}

/**
 * Sign in to Jellyfin as `login`: a session's token, or undefined when Jellyfin refuses
 * the login. A session of Mediaplane's ends the last one, and should be signed out of.
 */
export async function signIn(
  api: AppApi,
  login: { username: string; password: string },
): Promise<string | undefined> {
  const answer = await api.signIn(
    '/Users/AuthenticateByName',
    { Username: login.username, Pw: login.password },
    session,
    [login.password],
  );
  return answer?.AccessToken;
}

/** The newest key named KEY_NAME that Jellyfin holds, listed in full, or undefined. */
async function heldKey(api: AppApi): Promise<string | undefined> {
  const { Items } = await api.get('/Auth/Keys', apiKeys);
  let newest: { AccessToken: string; DateCreated: string } | undefined;
  for (const key of Items) {
    if (key.AppName !== KEY_NAME) continue;
    if (newest === undefined || key.DateCreated > newest.DateCreated) newest = key;
  }
  return newest?.AccessToken;
}

/**
 * Jellyfin's first-run setup (spec §6.1, §6.4): its startup wizard, finished as the shared
 * admin, then an API key, which only Jellyfin can make.
 * - The wizard: asking for the first user makes it (Jellyfin 12 has none to name before),
 *   which is then named and given the password. A 403 says it has a password already,
 *   from a setup that stopped before it was done.
 * - The sign-in comes before the wizard is completed: Jellyfin takes it then, and a first
 *   user the shared admin can't sign in as isn't Mediaplane's. Completing the wizard with
 *   it would hand Jellyfin to whoever set it, so the wizard is left open.
 * - The key: the one named KEY_NAME that Jellyfin holds already, as after a run that made
 *   it and stopped before saving it, else a new one, read back from the list (making one
 *   answers nothing). Then the session is signed out of.
 * - It is done once system.xml says the wizard is: Jellyfin writes it when it completes.
 */
export const jellyfinBootstrap: Bootstrap = {
  secret: 'apiKey',
  done: {
    path: 'system.xml',
    pattern: /<IsStartupWizardCompleted>true<\/IsStartupWizardCompleted>/,
  },
  open,
  async run(api, admin) {
    const wizard = await open(api);
    if (wizard) {
      await api.get('/Startup/User', startupUser);
      try {
        await api.submit('POST', '/Startup/User', {
          Name: admin.username,
          Password: admin.password,
        });
      } catch (cause) {
        if (!(cause instanceof AppApiError) || cause.status !== 403) throw cause;
      }
    }
    const token = await signIn(api, admin);
    if (token === undefined) {
      const why = wizard
        ? 'its startup wizard has a first user that Mediaplane did not set, so Mediaplane left the wizard open'
        : 'its startup wizard was finished with another login';
      throw new AppApiError(
        `${api.name} at ${api.where} refused the shared admin's sign-in: ${why} (POST /Users/AuthenticateByName)`,
        { kind: 'auth', status: 401 },
      );
    }
    if (wizard) await api.submit('POST', '/Startup/Complete');
    const signedIn = api.withKey(token);
    let key = await heldKey(signedIn);
    if (key === undefined) {
      await signedIn.submit('POST', `/Auth/Keys?app=${KEY_NAME}`);
      key = await heldKey(signedIn);
    }
    await signedIn.submit('POST', '/Sessions/Logout');
    if (key === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} made no key named ${KEY_NAME} (GET /Auth/Keys)`,
        { kind: 'protocol' },
      );
    }
    return key;
  },
};
