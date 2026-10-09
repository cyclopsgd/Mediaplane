import { readFile } from 'node:fs/promises';

/**
 * The file's contents, or undefined if it does not exist. Any other failure is thrown
 * as an error that names the file, and for permission errors, what to check.
 */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    const code =
      cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
    if (code === 'ENOENT') return undefined;
    const reason = code === undefined ? '' : ` (${code})`;
    const next =
      code === 'EACCES' || code === 'EPERM'
        ? ': check that the user running Mediaplane can read it'
        : '';
    throw new Error(`cannot read ${path}${reason}${next}`, { cause });
  }
}
