import { access, constants, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { codeOf } from '@mediaplane/engine';

/** A failed filesystem call's code, in words. */
const REASONS: Readonly<Record<string, string>> = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EROFS: 'a read-only filesystem',
};

/** A failed filesystem call, in words. */
function reasonOf(cause: unknown): string {
  const code = codeOf(cause);
  return (code === undefined ? undefined : REASONS[code]) ?? code ?? 'an error';
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Missing, or under a file (ENOTDIR): either way, what is above it says more. */
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR']);

/**
 * Why init can't write the home, with what to do instead, or undefined. A home that
 * exists must be a folder this user can write into; a missing one, a folder whose
 * nearest existing parent lets this user create it, as `mkdir -p` would. A file there,
 * or above it, needs another home: no command makes it a folder.
 */
export async function homeProblem(home: string): Promise<string | undefined> {
  let nearest = home;
  for (;;) {
    try {
      if (!(await stat(nearest)).isDirectory()) {
        return `${nearest} is a file; pass a folder: --home <a folder of yours>`;
      }
      break;
    } catch (cause) {
      if (!NOT_THERE.has(codeOf(cause) ?? '') || dirname(nearest) === nearest) {
        return homeBlocked(home, false, cause);
      }
      nearest = dirname(nearest);
    }
  }
  try {
    await access(nearest, constants.W_OK | constants.X_OK);
    return undefined;
  } catch (cause) {
    return homeBlocked(home, nearest === home, cause);
  }
}

/** The message for a home this user can't create (`exists` false) or write into. */
function homeBlocked(home: string, exists: boolean, cause: unknown): string {
  const reason = reasonOf(cause);
  const quoted = shellQuote(home);
  return exists
    ? `can't write into ${home} (${reason}): pass --home <a folder of yours>, or make it yours with "sudo chown $USER: ${quoted}"`
    : `can't create ${home} (${reason}): pass --home <a folder of yours>, or create it first with "sudo mkdir -p ${quoted} && sudo chown $USER: ${quoted}"`;
}

/**
 * The data folder, made ready where init can: `created` (mkdir -p, as this user), `ready`
 * (it exists, and this user, whom the apps run as, can write to it), `check` (it exists,
 * but init can't tell whether the apps' user can write to it), `unseen` (in Mediaplane's
 * image, a folder outside the home is the host's, out of the container's sight), the
 * `file` in its way (the path itself, or one above it), or why it couldn't be created.
 */
export type DataFolder =
  'created' | 'ready' | 'check' | 'unseen' | { file: string } | { blocked: string };

/**
 * Make the data folder ready: create it, with its parents, when it is missing and this
 * user may. It never changes an owner or a mode. `inImage`: Mediaplane runs from its
 * image, which sees nothing of the host's folders but the home.
 */
export async function prepareDataFolder(
  path: string,
  home: string,
  inImage: boolean,
  user: { uid: number; gid: number },
): Promise<DataFolder> {
  if (inImage && path !== home && !path.startsWith(`${home}/`)) return 'unseen';
  let isFolder: boolean;
  try {
    isFolder = (await stat(path)).isDirectory();
  } catch (cause) {
    if (codeOf(cause) === 'ENOTDIR') return { file: await fileInTheWay(path) };
    if (codeOf(cause) !== 'ENOENT') return { blocked: reasonOf(cause) };
    try {
      await mkdir(path, { recursive: true });
      return 'created';
    } catch (failure) {
      return codeOf(failure) === 'ENOTDIR'
        ? { file: await fileInTheWay(path) }
        : { blocked: reasonOf(failure) };
    }
  }
  if (!isFolder) return { file: path };
  if (process.getuid?.() !== user.uid) return 'check';
  try {
    await access(path, constants.W_OK | constants.X_OK);
    return 'ready';
  } catch {
    return 'check';
  }
}

/**
 * The file in `path`'s way: the nearest of it and the folders above it that exists, when
 * that is not a folder. `path` itself if none is (it changed meanwhile).
 */
async function fileInTheWay(path: string): Promise<string> {
  for (let at = path; ; at = dirname(at)) {
    try {
      return (await stat(at)).isDirectory() ? path : at;
    } catch {
      if (dirname(at) === at) return path;
    }
  }
}

/** The next steps the data folder still needs, if any. */
export function dataSteps(
  path: string,
  folder: DataFolder,
  user: { uid: number; gid: number },
): string[] {
  const who = `uid ${String(user.uid)} (gid ${String(user.gid)})`;
  const owner = `${String(user.uid)}:${String(user.gid)}`;
  const quoted = shellQuote(path);
  if (folder === 'ready') return [];
  if (folder === 'created') {
    // Made as this user: only someone else, such as root, leaves it to give away.
    return process.getuid?.() === user.uid
      ? []
      : [`Give ${path} to ${who}, whom the apps run as: sudo chown ${owner} ${quoted}`];
  }
  if (folder === 'check') return [`Make sure ${who} can write to ${path}.`];
  if (folder === 'unseen') {
    return [`Create ${path} and make sure ${who} can write to it.`];
  }
  // No command makes a file a folder.
  if ('file' in folder) {
    return [`${folder.file} is a file; pass a folder as paths.data in stack.yaml.`];
  }
  return [
    `Create ${path} (${folder.blocked}), for ${who}: sudo mkdir -p ${quoted} && sudo chown ${owner} ${quoted}`,
  ];
}

/** `path` as a shell word: as it is when that is safe, else in single quotes. */
export function shellQuote(path: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
