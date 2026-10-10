import type { SecretSource } from '../catalog/types';
import type { SecretRef } from '../config/schema';
import { readSecret } from '../config/secrets';
import { appEnvSecretName, secretEnvName } from '../render/compose';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';
import { ADMIN_PASSWORD_PATH, adminPasswordToGenerate } from './admin';
import type { SecretStore } from './store';

/**
 * Every secret Mediaplane must generate on the next apply: the ones the catalog says to
 * generate that the store does not have yet. The one list that plan (which prints it) and
 * apply (which fills the store from it) both walk, in app order, then secret-name order.
 */
export function missingGeneratedSecrets(
  stack: ResolvedStack,
  store: SecretStore,
): { app: string; name: string; kind: 'hex32' | 'qbt' }[] {
  const missing: { app: string; name: string; kind: 'hex32' | 'qbt' }[] = [];
  for (const app of stack.apps) {
    const secrets = Object.entries(app.def.secrets).sort(([a], [b]) => compare(a, b));
    for (const [name, source] of secrets) {
      if ('generate' in source && store.apps[app.def.id]?.[name] === undefined) {
        missing.push({ app: app.def.id, name, kind: source.generate });
      }
    }
  }
  return missing;
}

/**
 * The name of every secret Mediaplane must generate on the next apply, in the order
 * withGeneratedSecrets generates them: admin.password first, then "<app>.<secret>".
 */
export function secretsToGenerate(stack: ResolvedStack, store: SecretStore): string[] {
  return [
    ...(adminPasswordToGenerate(stack.config, store) ? [ADMIN_PASSWORD_PATH] : []),
    ...missingGeneratedSecrets(stack, store).map(({ app, name }) => `${app}.${name}`),
  ];
}

/** The value of every ${MP_…} variable compose.yaml references. Unknown values are "". */
export async function secretValues(
  stack: ResolvedStack,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const app of stack.apps) {
    for (const step of app.def.credentials) {
      if (step.step !== 'env') continue;
      const source = app.def.secrets[step.secret];
      const value =
        source === undefined
          ? undefined
          : await sourceValue(app, step.secret, source, stack, store, env);
      values[secretEnvName(app.def.id, step.secret)] = value ?? '';
    }
    for (const [name, value] of Object.entries(app.settings.env)) {
      if (typeof value === 'string') continue;
      values[appEnvSecretName(app.def.id, name)] =
        (await readSecret(value, stack.home, env)) ?? '';
    }
  }
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => compare(a, b)));
}

async function sourceValue(
  app: ResolvedApp,
  name: string,
  source: SecretSource,
  stack: ResolvedStack,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if ('userProvided' in source) {
    const ref = userProvidedRef(stack, source.userProvided);
    return ref === undefined ? undefined : readSecret(ref, stack.home, env);
  }
  return store.apps[app.def.id]?.[name];
}

function userProvidedRef(
  stack: ResolvedStack,
  which: 'vpn.private_key' | 'plex.token',
): SecretRef | undefined {
  return which === 'vpn.private_key'
    ? stack.config.vpn?.private_key
    : stack.config.plex?.token;
}
