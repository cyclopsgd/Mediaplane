import { randomBytes } from 'node:crypto';
import { chmod, link, mkdir, open, rename, rm } from 'node:fs/promises';
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

/**
 * Create `path` with `content` already in it, or return false if it exists. The content
 * goes to a private temporary file first, is flushed to disk, and is then hard-linked
 * into place: link() fails if `path` exists, which makes the creation exclusive, and
 * `path` never exists empty or half written, even if the write fails, the process dies
 * or the power goes. Needs a filesystem with hard links. `mode` is filtered by the umask.
 */
export async function writeFileExclusive(
  path: string,
  content: string,
  mode: number,
): Promise<boolean> {
  const temp = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  try {
    const file = await open(temp, 'wx', mode);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temp, path);
      return true;
    } catch (cause) {
      const exists = cause instanceof Error && 'code' in cause && cause.code === 'EEXIST';
      if (exists) return false;
      throw cause;
    }
  } finally {
    // Best effort: a cleanup failure must not hide the error that matters.
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

/** Create a folder and its parents, and give the folder exactly `mode`. */
export async function ensureDir(path: string, mode: number): Promise<void> {
  await mkdir(path, { recursive: true, mode });
  await chmod(path, mode);
}
