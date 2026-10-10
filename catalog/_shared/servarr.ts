import {
  defineIntegration,
  type ApiSpec,
  type AppApi,
  type AppContext,
  type ConfigFile,
  type ConfigFileContext,
  type DesiredResource,
  type Integration,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';

/** When Sonarr, Radarr and Prowlarr ask for the login: everywhere, or not locally. */
function authenticationRequired(ctx: AppContext): string {
  return ctx.config.security.login_on_lan ? 'Enabled' : 'DisabledForLocalAddresses';
}

/**
 * Auth env vars shared by Sonarr, Radarr and Prowlarr (design §6.1).
 * Values are case-sensitive. AUTH__ENABLED is deliberately never set (legacy flag).
 */
export function servarrEnv(prefix: string, ctx: AppContext): Record<string, string> {
  const env: Record<string, string> = {
    [`${prefix}__AUTH__METHOD`]: 'Forms',
    [`${prefix}__AUTH__REQUIRED`]: authenticationRequired(ctx),
  };
  // Empty unless the web UI is on the LAN: only LAN clients need trusting.
  if (!ctx.config.security.login_on_lan && ctx.lanClientSubnets.length > 0) {
    env[`${prefix}__SERVER__TRUSTEDNETWORKS`] = ctx.lanClientSubnets.join(',');
  }
  // Without a login for local addresses, the app takes only the Host names it is told
  // of, and refuses to save its settings until it has some: its service name, which the
  // other apps and Mediaplane use, and the addresses its web UI is published on.
  // localhost and 127.0.0.1 always pass.
  if (!ctx.config.security.login_on_lan) {
    const hosts = [prefix.toLowerCase(), ...ctx.webAddresses];
    env[`${prefix}__SERVER__ALLOWEDHOSTS`] = hosts
      .filter((host) => host !== '127.0.0.1')
      .join(',');
  }
  return env;
}

/**
 * Sonarr's, Radarr's and Prowlarr's API: `/ping` without a key, then everything under
 * /api/<version> with it, in `X-Api-Key` (never ?apikey=, which ends up in logs).
 */
export function servarrApi(version: 'v1' | 'v3'): ApiSpec {
  return {
    port: 'web',
    ready: '/ping',
    key: { secret: 'apiKey', scheme: 'x-api-key' },
    check: `/api/${version}/system/status`,
  };
}

/** What Mediaplane reads of the app's host settings; the rest goes back as it came. */
const hostSettings = z.looseObject({ id: z.number(), username: z.string() });

/**
 * The shared admin login (spec §6.1) in Sonarr, Radarr or Prowlarr: the singleton
 * resource `<app>.admin`, whose user name is a managed field and whose password is a
 * secret, checked by signing in with it. The API is the only way in once the app has
 * started (spec §6.4), and it needs no restart.
 */
export function servarrAdmin(version: 'v1' | 'v3'): ResourceSpec {
  const path = `/api/${version}/config/host`;
  // The whole settings object goes back, as the app's own UI sends it, with the login in
  // it. It holds the app's key and the old password's hash: it is never shown.
  const save = async (api: AppApi, desired: DesiredResource) => {
    const current = await api.get(path, hostSettings);
    const password = desired.secrets.password ?? '';
    await api.put(`${path}/${String(current.id)}`, {
      ...current,
      username: desired.fields.username,
      password,
      passwordConfirmation: password,
    });
  };
  return {
    name: 'admin',
    fields: ['username'],
    secrets: ['password'],
    desired: ({ admin }) => ({
      name: 'admin',
      fields: { username: admin.username },
      secrets: { password: admin.password },
    }),
    async observe(api) {
      const { username } = await api.get(path, hostSettings);
      // No user yet: the app asks for a login that nobody can give.
      return username === ''
        ? undefined
        : { id: null, name: 'admin', fields: { username } };
    },
    async verify(api, desired) {
      const signedIn = await api.login('/login', {
        username: String(desired.fields.username),
        password: desired.secrets.password ?? '',
      });
      // It sends a login that works on to "/", and one that doesn't back to
      // /login?…loginFailed=true. The client redacts the redirect, so a password that is
      // part of "loginFailed" would turn a refusal into /login?…login***ed=true: a
      // redirect holding the client's *** can't be told from a success, and isn't one.
      return (
        signedIn.status === 302 &&
        signedIn.location !== undefined &&
        !signedIn.location.includes('loginFailed') &&
        !signedIn.location.includes('***')
      );
    },
    async create(api, desired) {
      await save(api, desired);
      return { id: null };
    },
    update: (api, desired) => save(api, desired),
  };
}

/** How Mediaplane wires Sonarr, Radarr or Prowlarr, after the apps `after`. */
export function servarrIntegration(
  version: 'v1' | 'v3',
  after: readonly string[] = [],
): Integration {
  return defineIntegration({ after, resources: [servarrAdmin(version)] });
}

/**
 * config.xml, written before the first start (design §6.1): the API key, so the app keeps
 * it even if its environment variable is ever lost, and the forms login. Sonarr, Radarr
 * and Prowlarr keep these and add the rest of their settings. The admin user itself goes
 * through their API.
 */
export function servarrConfigFiles(ctx: ConfigFileContext): ConfigFile[] {
  return [
    {
      path: 'config.xml',
      content: [
        '<Config>',
        `  <ApiKey>${ctx.secret('apiKey')}</ApiKey>`,
        '  <AuthenticationMethod>Forms</AuthenticationMethod>',
        `  <AuthenticationRequired>${authenticationRequired(ctx)}</AuthenticationRequired>`,
        '</Config>',
        '',
      ].join('\n'),
      seeded: /<ApiKey>[^<]+<\/ApiKey>/,
    },
  ];
}
