import { readFile } from 'node:fs/promises';

/** The file's contents, or undefined if it does not exist. Other errors are thrown. */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return undefined;
    }
    throw cause;
  }
}
