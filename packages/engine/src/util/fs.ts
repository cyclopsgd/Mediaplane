import { constants } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { codeOf } from './error-code';

/**
 * The file's contents, or undefined if it does not exist. Any other failure is thrown
 * as an error that names the file, and for permission errors, what to check. With
 * `noWait`, it is opened without waiting, so a named pipe swapped in at `path` never
 * hangs the read: it reads as empty, or, when a writer holds it open with nothing
 * written, fails at once (EAGAIN), as an error that names the file.
 */
export async function readIfExists(
  path: string,
  { noWait = false }: { noWait?: boolean } = {},
): Promise<string | undefined> {
  try {
    return noWait ? await readFileNoWait(path) : await readFile(path, 'utf8');
  } catch (cause) {
    const code = codeOf(cause);
    if (code === 'ENOENT') return undefined;
    const reason = code === undefined ? '' : ` (${code})`;
    const next =
      code === 'EACCES' || code === 'EPERM'
        ? ': check that the user running Mediaplane can read it'
        : '';
    throw new Error(`cannot read ${path}${reason}${next}`, { cause });
  }
}

/**
 * What is at `path`, without opening it (a named pipe would block an open): nothing, a
 * regular file (or a link to one), or something else, such as a directory or a pipe.
 */
export async function fileKind(path: string): Promise<'missing' | 'file' | 'other'> {
  try {
    return (await stat(path)).isFile() ? 'file' : 'other';
  } catch (cause) {
    if (codeOf(cause) === 'ENOENT') return 'missing';
    throw cause;
  }
}

/** The file's contents as `readIfExists` reads them, but never waiting on a pipe. */
export async function readFileNoWait(path: string): Promise<string> {
  return readFile(path, {
    encoding: 'utf8',
    flag: constants.O_RDONLY | constants.O_NONBLOCK,
  });
}
