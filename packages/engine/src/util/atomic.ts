import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Replace `path` with `content` all at once: write a temporary file next to it, flush it
 * to disk, then rename it over the original. Readers see the old file or the new one,
 * never half of either.
 */
export async function writeFileAtomic(
  path: string,
  content: string,
  mode = 0o644,
): Promise<void> {
  const temp = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    const file = await open(temp, 'wx', mode);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    // open()'s mode is filtered by the umask; set the one we mean.
    await chmod(temp, mode);
    await rename(temp, path);
  } catch (cause) {
    // Best effort: a cleanup failure (say ENOTDIR) must not hide the error that matters.
    await rm(temp, { force: true }).catch(() => undefined);
    const code =
      cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
    throw new Error(`cannot write ${path}${code === undefined ? '' : ` (${code})`}`, {
      cause,
    });
  }
}

/** Create a folder and its parents, and give the folder exactly `mode`. */
export async function ensureDir(path: string, mode: number): Promise<void> {
  await mkdir(path, { recursive: true, mode });
  await chmod(path, mode);
}
