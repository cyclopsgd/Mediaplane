import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { APPDATA_DIR } from '../paths';
import type { HostProbe } from '../preflight/probe';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { codeOf } from '../util/error-code';

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

/** What to do when appdata/ belongs to another user; plan and apply both say it. */
export const APPDATA_NOT_PRIVATE_HINT =
  'give appdata/ itself, not what is in it, to the user Mediaplane runs as (MEDIAPLANE_UID in its container), then run apply again';

/** The user id Mediaplane runs as; undefined where the platform has no user ids. */
export function runningUid(): number | undefined {
  return process.geteuid?.();
}

/**
 * Who owns appdata/, and who Mediaplane is, in words: "uid 4242, not to the user
 * Mediaplane runs as (uid 1000)". Only the uid it finds out, never a name.
 */
export function ownerClause(owner: number | undefined): string {
  if (owner === undefined) return 'another user';
  const me = runningUid();
  return `uid ${String(owner)}, not to the user Mediaplane runs as${me === undefined ? '' : ` (uid ${String(me)})`}`;
}

/** appdata/ can't be made private: it belongs to another user. */
export class AppdataNotPrivateError extends Error {
  override readonly name = 'AppdataNotPrivateError';
  readonly hint = APPDATA_NOT_PRIVATE_HINT;

  constructor(path: string, cause: unknown, owner?: number) {
    super(`cannot make ${path} private (EPERM): it belongs to ${ownerClause(owner)}`, {
      cause,
    });
  }
}

/**
 * Make an existing appdata/ private (0700), as state/ is: the apps rewrite their own
 * files readable by all, and those hold their keys. Docker resolves bind mounts as root,
 * so no app needs to pass through it. A missing appdata/ is left to the files step.
 */
export async function keepAppdataPrivate(home: string): Promise<void> {
  const path = join(home, APPDATA_DIR);
  try {
    await chmod(path, 0o700);
  } catch (cause) {
    const code = codeOf(cause);
    if (code === 'ENOENT') return;
    if (code === 'EPERM') {
      const owner = await stat(path).then(
        (found) => found.uid,
        () => undefined,
      );
      throw new AppdataNotPrivateError(path, cause, owner);
    }
    throw cause;
  }
}

/**
 * Create appdata/, private, and every app's folder in it now, so Docker doesn't create
 * them as root. The app folders keep the modes their apps give them.
 */
export async function ensureAppdataDirs(stack: ResolvedStack): Promise<void> {
  await mkdir(join(stack.home, APPDATA_DIR), { recursive: true, mode: 0o700 });
  await keepAppdataPrivate(stack.home);
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
