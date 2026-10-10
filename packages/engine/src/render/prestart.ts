import { randomBytes } from 'node:crypto';
import type { ConfigFileContext } from '../catalog/types';
import { APPDATA_DIR } from '../paths';
import type { ResolvedStack } from '../resolver/resolve';
import { adminLogin } from '../secrets/admin';
import type { RandomBytes } from '../secrets/generate';
import type { SecretStore } from '../secrets/store';

/** One app's pre-start file, rendered. `content` holds secrets: never print or log it. */
export interface PrestartFile {
  app: string;
  /** The app's display name, such as "qBittorrent". */
  appName: string;
  /** Relative to the home: appdata/<app>/<the catalog's path>. */
  path: string;
  content: string;
  seeded: RegExp;
}

/** Every enabled app's pre-start files (spec §6.4), from the catalog's pure renderers. */
export function renderPrestartFiles(
  stack: ResolvedStack,
  store: SecretStore,
  admin: { username: string; password: string },
  random: RandomBytes,
): PrestartFile[] {
  return stack.apps.flatMap((app) => {
    const { def } = app;
    if (def.configFiles === undefined) return [];
    const secrets = store.apps[def.id] ?? {};
    const ctx: ConfigFileContext = {
      ...app.context,
      admin,
      secret: (name) => {
        const value = secrets[name];
        if (value === undefined) {
          throw new Error(`${def.id}.${name} has not been generated yet`);
        }
        return value;
      },
      random,
    };
    return def.configFiles(ctx).map((file) => ({
      app: def.id,
      appName: def.name,
      path: `${APPDATA_DIR}/${def.id}/${file.path}`,
      content: file.content,
      seeded: file.seeded,
    }));
  });
}

/**
 * The pre-start files, rendered with the shared admin login from `store` or from your
 * admin.password. plan and apply both use it. Throws when there is no password yet.
 */
export async function prestartFilesFor(
  stack: ResolvedStack,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
  random: RandomBytes = randomBytes,
): Promise<PrestartFile[]> {
  const admin = await adminLogin(stack.config, stack.home, store, env);
  return renderPrestartFiles(stack, store, admin, random);
}
