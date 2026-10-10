import type { StackConfig } from '../config/schema';
import { readSecret } from '../config/secrets';
import type { SecretStore } from './store';

/** How plan, apply and the change records name the shared admin password. */
export const ADMIN_PASSWORD_PATH = 'admin.password';

/** Whether apply must generate the admin password: none is stored, and none is yours. */
export function adminPasswordToGenerate(
  config: StackConfig,
  store: SecretStore,
): boolean {
  return config.admin.password === undefined && store.shared?.adminPassword === undefined;
}

/**
 * The shared admin login (spec §6.1): your password from admin.password, or the one
 * Mediaplane generated. plan checks that yours exists, and apply generates its own,
 * before either asks, so a missing one is a bug.
 */
export async function adminLogin(
  config: StackConfig,
  home: string,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
): Promise<{ username: string; password: string }> {
  const ref = config.admin.password;
  const password =
    ref === undefined ? store.shared?.adminPassword : await readSecret(ref, home, env);
  if (password === undefined) throw new Error('the admin password is not available yet');
  return { username: config.admin.username, password };
}
