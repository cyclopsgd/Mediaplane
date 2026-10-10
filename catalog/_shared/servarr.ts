import type {
  ApiSpec,
  AppContext,
  ConfigFile,
  ConfigFileContext,
} from '@mediaplane/engine';

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

/**
 * config.xml, written before the first start (design §6.1): the API key, so the app keeps
 * it even if its environment variable is ever lost, and the forms login. Sonarr, Radarr
 * and Prowlarr keep these and add the rest of their settings. The admin user itself goes
 * through their API, from Slice 3b.
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
