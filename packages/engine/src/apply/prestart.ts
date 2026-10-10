import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PrestartFile } from '../render/prestart';
import { writeFileExclusive } from '../util/atomic';

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
    return (
      cause instanceof Error &&
      'code' in cause &&
      (cause.code === 'ENOENT' || cause.code === 'ENOTDIR')
    );
  }
}

/**
 * Write each pre-start file that does not exist yet (spec §6.4): all at once, 0600,
 * never over an existing file, with its folders created. Returns the paths it created,
 * relative to the home. The content is never in an error, and no temporary copy of it
 * outlives the call.
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
    await mkdir(dirname(path), { recursive: true });
    if (await writeFileExclusive(path, file.content, 0o600)) created.push(file.path);
  }
  return created;
}
