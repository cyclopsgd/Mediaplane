import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import type { PrestartFile } from '../render/prestart';
import type { FileChange } from './files';

/** What is at a pre-start file's path: nothing, or a file, with its text when readable. */
type Found = { exists: false } | { exists: true; text: string | undefined };

async function find(path: string): Promise<Found> {
  try {
    return { exists: true, text: await readFile(path, 'utf8') };
  } catch (cause) {
    const code =
      cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
    // ENOTDIR: a file stands where one of its folders should be, so it can't exist.
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false };
    // After its first start the app owns its appdata, and may keep Mediaplane out.
    if (code === 'EACCES' || code === 'EPERM') return { exists: true, text: undefined };
    throw new Error(`cannot read ${path}${code === undefined ? '' : ` (${code})`}`, {
      cause,
    });
  }
}

/**
 * What apply would do with each pre-start file (spec §6.4): create it when it is absent,
 * and leave it alone when it exists. A file that exists without what Mediaplane seeds is
 * from an install made before Slice 3a, which apply would never fix: an error.
 */
export async function planPrestartFiles(
  home: string,
  files: readonly PrestartFile[],
): Promise<{ changes: FileChange[]; diagnostics: Diagnostic[] }> {
  const changes: FileChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const found = await find(join(home, file.path));
    changes.push({
      path: file.path,
      status: found.exists ? 'unchanged' : 'create',
      diff: '',
      content: '',
      sensitive: true,
      prestart: true,
    });
    // A file Mediaplane can't read counts as seeded: there is no way to tell.
    if (found.exists && found.text !== undefined && !file.seeded.test(found.text)) {
      diagnostics.push(notSeeded(file));
    }
  }
  return { changes, diagnostics };
}

function notSeeded(file: PrestartFile): Diagnostic {
  const name = file.appName;
  return error(
    `${file.app}.not-seeded`,
    `${file.path} was not written by Mediaplane, so it lacks the key Mediaplane gave ${name}`,
    {
      hint: `stop ${name}, delete ${file.path} in the Mediaplane home, then run apply again: it writes a new one before ${name} starts. The settings in that file are lost; ${name}'s other data is kept. See "Set up before Slice 3a" in catalog/${file.app}/README.md`,
    },
  );
}
