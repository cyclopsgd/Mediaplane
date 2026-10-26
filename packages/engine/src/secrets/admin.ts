import type { StackConfig } from '../config/schema';
import { readSecret } from '../config/secrets';
import { compare } from '../util/sort';
import type { SecretStore } from './store';

// Defined with the stack.yaml path it names; kept here too, beside the admin login.
export { ADMIN_PASSWORD_PATH } from '../config/secrets';

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

/**
 * The apps that have never had the admin password Mediaplane holds
 * (`shared.adminPasswordNotIn`): none when the password is yours, which isn't
 * Mediaplane's to track.
 */
export function passwordNotIn(config: StackConfig, store: SecretStore): string[] {
  return config.admin.password === undefined
    ? [...(store.shared?.adminPasswordNotIn ?? [])]
    : [];
}

/**
 * `store`, with `apps` the only ones that have never had its admin password: the field
 * dropped when there are none. Names only.
 */
export function withPasswordNotIn(
  store: SecretStore,
  apps: readonly string[],
): SecretStore {
  const { adminPasswordNotIn: _notIn, ...shared } = store.shared ?? {};
  const listed = [...new Set(apps)].sort(compare);
  const next = listed.length === 0 ? shared : { ...shared, adminPasswordNotIn: listed };
  const { shared: _shared, ...rest } = store;
  return Object.keys(next).length === 0 ? rest : { ...rest, shared: next };
}
