import type { AppContext, ConfigFile, ConfigFileContext } from '@mediaplane/engine';

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
  return env;
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
