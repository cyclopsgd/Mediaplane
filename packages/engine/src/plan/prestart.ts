import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import type { PrestartFile } from '../render/prestart';
import type { FileChange } from './files';

/** What is at a pre-start file's path: nothing, or a file, with its text when readable. */
type Found = { exists: false } | { exists: true; text: string | undefined };

function codeOf(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
}

function cannotRead(path: string, cause: unknown): Error {
  const code = codeOf(cause);
  return new Error(`cannot read ${path}${code === undefined ? '' : ` (${code})`}`, {
    cause,
  });
}

/**
 * Whether anything stands at `path`, a link included: a link to nothing reads as missing,
 * but apply never writes over it, so plan must not promise to.
 */
async function linkExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    const code = codeOf(cause);
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw cannotRead(path, cause);
  }
}

async function find(path: string): Promise<Found> {
  try {
    return { exists: true, text: await readFile(path, 'utf8') };
  } catch (cause) {
    const code = codeOf(cause);
    // ENOTDIR: a file stands where one of its folders should be, so it can't exist.
    if (code === 'ENOTDIR') return { exists: false };
    // ENOENT: absent, unless it is a link to nothing, which exists and which we can't read.
    if (code === 'ENOENT') {
      return (await linkExists(path))
        ? { exists: true, text: undefined }
        : { exists: false };
    }
    // After its first start the app owns its appdata, and may keep Mediaplane out.
    if (code === 'EACCES' || code === 'EPERM') return { exists: true, text: undefined };
    throw cannotRead(path, cause);
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
    // A file Mediaplane can't read counts as seeded: there is no way to tell. search(), not
    // test(): a pattern with the g or y flag keeps its place between calls.
    if (
      found.exists &&
      found.text !== undefined &&
      found.text.search(file.seeded) === -1
    ) {
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
