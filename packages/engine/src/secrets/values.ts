import type { SecretSource } from '../catalog/types';
import type { SecretRef } from '../config/schema';
import { readSecret } from '../config/secrets';
import { appEnvSecretName, secretEnvName } from '../render/compose';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';
import type { SecretStore } from './store';

/** "<app>.<secret>" for every secret Mediaplane must generate on the next apply. */
export function secretsToGenerate(stack: ResolvedStack, store: SecretStore): string[] {
  const missing: string[] = [];
  for (const app of stack.apps) {
    const secrets = Object.entries(app.def.secrets).sort(([a], [b]) => compare(a, b));
    for (const [name, source] of secrets) {
      if ('generate' in source && store.apps[app.def.id]?.[name] === undefined) {
        missing.push(`${app.def.id}.${name}`);
      }
    }
  }
  return missing;
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
