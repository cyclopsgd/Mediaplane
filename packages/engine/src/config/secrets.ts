import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Catalog } from '../catalog/types';
import { error, warning, type Diagnostic } from '../diagnostics';
import { compare } from '../util/sort';
import type { SecretRef, StackConfig } from './schema';

/**
 * The length Mediaplane advises for your own admin password (spec §6.1). A shorter one
 * only warns: the shortest it refuses is what an app in the stack needs.
 */
export const ADMIN_PASSWORD_ADVISED_LENGTH = 12;

/** How stack.yaml, plan, apply and the change records name the shared admin password. */
export const ADMIN_PASSWORD_PATH = 'admin.password';

/** The apps in the stack: the media server, and each app that is not disabled. */
function appsInStack(config: StackConfig): string[] {
  return [
    config.media_server,
    ...Object.entries(config.apps)
      .filter(([, settings]) => settings.enabled)
      .map(([id]) => id),
  ];
}

/**
 * The app among `appIds` that needs the longest admin password, when any needs more than
 * one character: its name and the fewest characters it takes (the catalog's
 * `adminPasswordMinLength`). Only the apps given count.
 */
export function adminPasswordFloor(
  appIds: readonly string[],
  catalog: Catalog,
): { name: string; min: number } | undefined {
  let floor: { name: string; min: number } | undefined;
  for (const app of catalog) {
    const min = app.adminPasswordMinLength;
    if (min === undefined || !appIds.includes(app.id)) continue;
    if (floor === undefined || min > floor.min) floor = { name: app.name, min };
  }
  return floor;
}

/** Every secret reference in stack.yaml, with its dotted path. */
export function secretRefs(config: StackConfig): { path: string; ref: SecretRef }[] {
  const refs: { path: string; ref: SecretRef }[] = [];
  if (config.admin.password)
    refs.push({ path: ADMIN_PASSWORD_PATH, ref: config.admin.password });
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
  catalog: Catalog,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { path, ref } of secretRefs(config)) {
    const value = await readSecret(ref, home, env);
    if (value === undefined) {
      const where = 'env' in ref ? `environment variable ${ref.env}` : `file ${ref.file}`;
      diagnostics.push(
        error('secret.missing', `${path}: ${where} is missing, empty or unreadable`, {
          path,
          ...(path === 'plex.token'
            ? {
                hint: 'run "mediaplane plex-login": it signs you in to Plex, and saves your token where plex.token says',
              }
            : {}),
        }),
      );
    } else if (path === ADMIN_PASSWORD_PATH) {
      const floor = adminPasswordFloor(appsInStack(config), catalog);
      if (floor !== undefined && value.length < floor.min) {
        diagnostics.push(
          error(
            'admin.password-too-short',
            `${floor.name} takes a password of at least ${String(floor.min)} characters`,
            {
              path,
              hint: 'use a longer password, or leave admin.password out and Mediaplane generates one',
            },
          ),
        );
      } else if (value.length < ADMIN_PASSWORD_ADVISED_LENGTH) {
        // Never the password, nor how long it is: the length advised only.
        diagnostics.push(
          warning(
            'admin.password-short',
            `admin.password is shorter than the ${String(ADMIN_PASSWORD_ADVISED_LENGTH)} characters advised`,
            {
              path,
              hint: 'a short password suits a stack reached only from your own network; use a longer one if any app is reachable from the internet, or leave admin.password out and Mediaplane generates one',
            },
          ),
        );
      }
    }
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
