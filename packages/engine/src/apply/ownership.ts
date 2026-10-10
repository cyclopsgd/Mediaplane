import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { APPDATA_DIR } from '../paths';
import type { HostProbe } from '../preflight/probe';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { ensureDir } from '../util/atomic';

export interface OwnershipFix {
  service: string;
  hostPath: string;
  /** Where the app mounts the folder; chown runs on this path inside its container. */
  containerPath: string;
  uid: number;
  gid: number;
}

/**
 * The owner an app's appdata folder must have, when the app needs a specific one.
 * linuxserver images (puid-env) chown their own /config, and image-default apps run as root.
 */
export function requiredOwner(
  app: ResolvedApp,
  stack: ResolvedStack,
): { uid: number; gid: number } | undefined {
  if (app.def.runAs === 'user-directive') return stack.config.user;
  const fixed = /^fixed:(\d+)$/.exec(app.def.runAs)?.[1];
  return fixed === undefined ? undefined : { uid: Number(fixed), gid: Number(fixed) };
}

/** <home>/appdata/<id>, the folder the renderer mounts as the app's appdata volume. */
export function appdataPath(stack: ResolvedStack, app: ResolvedApp): string {
  return join(stack.home, APPDATA_DIR, app.def.id);
}

/**
 * Create every app's appdata folder now, so Docker doesn't create it as root. appdata/
 * itself is kept private (0700), as state/ is: the apps rewrite their own files readable
 * by all, and those hold their keys. Docker resolves bind mounts as root, so no app needs
 * to pass through it. The app folders keep the modes their apps give them.
 */
export async function ensureAppdataDirs(stack: ResolvedStack): Promise<void> {
  await ensureDir(join(stack.home, APPDATA_DIR), 0o700);
  for (const app of stack.apps) {
    if (app.def.volumes.appdata !== undefined) {
      await mkdir(appdataPath(stack, app), { recursive: true });
    }
  }
}

/** Appdata folders whose owner differs from what their app runs as (missing ones too). */
export async function ownershipFixes(
  stack: ResolvedStack,
  probe: HostProbe,
): Promise<OwnershipFix[]> {
  const fixes: OwnershipFix[] = [];
  for (const app of stack.apps) {
    const containerPath = app.def.volumes.appdata;
    const owner = requiredOwner(app, stack);
    if (containerPath === undefined || owner === undefined) continue;
    const hostPath = appdataPath(stack, app);
    const stat = await probe.stat(hostPath);
    if (stat?.uid === owner.uid && stat.gid === owner.gid) continue;
    fixes.push({ service: app.def.id, hostPath, containerPath, ...owner });
  }
  return fixes;
}
