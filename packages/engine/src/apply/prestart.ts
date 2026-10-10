import { lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { APPDATA_DIR } from '../paths';
import type { PrestartFile } from '../render/prestart';
import { writeFileExclusive } from '../util/atomic';
import { isInside } from '../util/path';

function codeOf(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
}

/**
 * Whether nothing is at `path` yet. Anything else, even a path Mediaplane may not look
 * at (EACCES, EPERM), is the app's own, as plan's check counts it. ENOTDIR (a file stands
 * where one of its folders should be) counts as nothing too, as it does for plan: the
 * write then fails loudly, naming the path, instead of skipping the file in silence.
 */
async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (cause) {
    const code = codeOf(cause);
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

/**
 * `path` with every link in it followed, as far as it exists: the real path of its
 * nearest existing ancestor, then the names below that, which mkdir would create as plain
 * folders. Undefined when a link on the way leads nowhere, because mkdir can't make what
 * it leads to.
 */
async function resolveExisting(path: string): Promise<string | undefined> {
  const below: string[] = [];
  let folder = path;
  for (;;) {
    try {
      return join(await realpath(folder), ...below);
    } catch (cause) {
      const code = codeOf(cause);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw cause;
    }
    // Missing, or a link to nothing, which lstat still finds.
    if (
      await lstat(folder).then(
        () => true,
        () => false,
      )
    )
      return undefined;
    below.unshift(basename(folder));
    folder = dirname(folder);
  }
}

/**
 * Fail unless the folder for `file`, with its links followed, is its app's appdata folder
 * or inside it. A link in the app's folder (the app owns it after its first start) must
 * not take apply's write elsewhere. Both sides are real paths, so a home or an appdata
 * folder that is itself a link, to another disk say, still works. Errors name the file's
 * path, never its content.
 */
async function requireInsideAppFolder(home: string, file: PrestartFile): Promise<void> {
  const app = await resolveExisting(join(home, APPDATA_DIR, file.app));
  const folder = await resolveExisting(dirname(join(home, file.path)));
  if (app === undefined || folder === undefined) {
    throw new Error(`${file.path}: a folder on its way is a link to nothing`);
  }
  if (!isInside(folder, app)) {
    throw new Error(
      `${file.path}: a folder on its way leads outside ${posix.join(APPDATA_DIR, file.app)}`,
    );
  }
}

/**
 * Write each pre-start file that does not exist yet (spec §6.4): all at once, 0600,
 * never over an existing file, with its folders created, and never through a link that
 * leaves the app's folder. Returns the paths it created, relative to the home. The content
 * is never in an error, and no temporary copy of it outlives the call.
 */
export async function writePrestartFiles(
  home: string,
  files: readonly PrestartFile[],
): Promise<string[]> {
  const created: string[] = [];
  for (const file of files) {
    const path = join(home, file.path);
    // Look first: writeFileExclusive makes a temporary file next to the target, and
    // after its first start the app's folder may be closed to Mediaplane.
    if (!(await absent(path))) continue;
    await requireInsideAppFolder(home, file);
    await mkdir(dirname(path), { recursive: true });
    if (await writeFileExclusive(path, file.content, 0o600)) created.push(file.path);
  }
  return created;
}
