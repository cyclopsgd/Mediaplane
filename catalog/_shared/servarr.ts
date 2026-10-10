import type { AppContext } from '@mediaplane/engine';

/**
 * Auth env vars shared by Sonarr, Radarr and Prowlarr (design §6.1).
 * Values are case-sensitive. AUTH__ENABLED is deliberately never set (legacy flag).
 */
export function servarrEnv(prefix: string, ctx: AppContext): Record<string, string> {
  const loginOnLan = ctx.config.security.login_on_lan;
  const env: Record<string, string> = {
    [`${prefix}__AUTH__METHOD`]: 'Forms',
    [`${prefix}__AUTH__REQUIRED`]: loginOnLan ? 'Enabled' : 'DisabledForLocalAddresses',
  };
  // Empty unless the web UI is on the LAN: only LAN clients need trusting.
  if (!loginOnLan && ctx.lanClientSubnets.length > 0) {
    env[`${prefix}__SERVER__TRUSTEDNETWORKS`] = ctx.lanClientSubnets.join(',');
  }
  return env;
}
