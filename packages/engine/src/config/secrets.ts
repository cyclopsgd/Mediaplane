import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import { compare } from '../util/sort';
import type { SecretRef, StackConfig } from './schema';

/** Every secret reference in stack.yaml, with its dotted path. */
export function secretRefs(config: StackConfig): { path: string; ref: SecretRef }[] {
  const refs: { path: string; ref: SecretRef }[] = [];
  if (config.admin.password)
    refs.push({ path: 'admin.password', ref: config.admin.password });
  // A plex block is dormant unless Plex is the media server.
  if (config.media_server === 'plex' && config.plex)
    refs.push({ path: 'plex.token', ref: config.plex.token });
  if (config.vpn) refs.push({ path: 'vpn.private_key', ref: config.vpn.private_key });
  const apps = Object.entries(config.apps).sort(([a], [b]) => compare(a, b));
  for (const [id, settings] of apps) {
    if (!settings.enabled) continue;
    const env = Object.entries(settings.env).sort(([a], [b]) => compare(a, b));
    for (const [name, value] of env) {
      if (typeof value !== 'string')
        refs.push({ path: `apps.${id}.env.${name}`, ref: value });
    }
  }
  return refs;
}

/** The secret's trimmed value, or undefined if it is missing, empty or unreadable. */
export async function readSecret(
  ref: SecretRef,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const raw =
    'env' in ref
      ? Object.hasOwn(env, ref.env)
        ? env[ref.env]
        : undefined
      : await readQuietly(isAbsolute(ref.file) ? ref.file : join(home, ref.file));
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}

export async function checkSecretRefs(
  config: StackConfig,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { path, ref } of secretRefs(config)) {
    if ((await readSecret(ref, home, env)) !== undefined) continue;
    const where = 'env' in ref ? `environment variable ${ref.env}` : `file ${ref.file}`;
    diagnostics.push(
      error('secret.missing', `${path}: ${where} is missing, empty or unreadable`, {
        path,
      }),
    );
  }
  return diagnostics;
}

async function readQuietly(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}
