import { randomBytes } from 'node:crypto';
import { link, readFile, rename, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { LOCK_PATH, STATE_DIR } from '../paths';
import { ensureDir, writeFileExclusive } from '../util/atomic';

export interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

export interface Lock {
  release(): Promise<void>;
}

/** Another apply holds the lock; `holder` says who, when the lock file can be read. */
export class LockedError extends Error {
  override readonly name = 'LockedError';
  readonly holder: LockInfo | undefined;

  constructor(holder: LockInfo | undefined) {
    super(
      holder === undefined
        ? `${LOCK_PATH} exists but cannot be read`
        : `another apply is running (pid ${String(holder.pid)} on ${holder.host}, started ${holder.startedAt})`,
    );
    this.holder = holder;
  }
}

/** Enough tries to clear one stale lock and create ours, with room to lose a race or two. */
const MAX_ATTEMPTS = 3;

/**
 * Take the single-writer lock (spec §5, stage 1): create state/lock exclusively, recording
 * the pid, host and start time. A lock left by a dead process on this host is cleared.
 */
export async function acquireLock(
  home: string,
  now: () => Date = () => new Date(),
): Promise<Lock> {
  await ensureDir(join(home, STATE_DIR), 0o700);
  const path = join(home, LOCK_PATH);
  const info: LockInfo = {
    pid: process.pid,
    host: hostname(),
    startedAt: now().toISOString(),
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Exclusive, and never empty or half written: a reader always finds who holds it.
    if (await writeFileExclusive(path, `${JSON.stringify(info)}\n`, 0o600)) {
      return { release: () => rm(path, { force: true }) };
    }
    const holder = await readHolder(path);
    if (holder === 'gone') continue; // released since we looked: try to create it again
    if (holder === undefined || !isDead(holder)) throw new LockedError(holder);
    await clearStale(path, holder);
  }
  const holder = await readHolder(path);
  throw new LockedError(holder === 'gone' ? undefined : holder);
}

/**
 * Remove a lock judged stale, without ever deleting a live lock that replaced it. Deleting
 * by name would: two runs can both judge the same lock stale, and the slower one would then
 * delete the lock the faster one had just taken. So the lock is first claimed by renaming
 * it to a name of our own, which only one run can do, and checked to be the lock we judged.
 * If it is not, it is put back and the run that holds it is reported.
 */
async function clearStale(path: string, stale: LockInfo): Promise<void> {
  const claimed = `${path}.stale-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  try {
    await rename(path, claimed);
  } catch (cause) {
    if (hasCode(cause, 'ENOENT')) return; // someone else cleared it first
    throw cause;
  }
  const found = await readHolder(claimed);
  if (found !== 'gone' && found !== undefined && sameHolder(found, stale)) {
    await rm(claimed, { force: true });
    return;
  }
  try {
    await link(claimed, path);
  } catch (cause) {
    // EEXIST: something newer already took the lock, and that one stays.
    if (!hasCode(cause, 'EEXIST')) throw cause;
  }
  await rm(claimed, { force: true });
  throw new LockedError(found === 'gone' ? undefined : found);
}

/** The holder written in `path`; undefined when it is not a readable lock, 'gone' when absent. */
async function readHolder(path: string): Promise<LockInfo | undefined | 'gone'> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return hasCode(cause, 'ENOENT') ? 'gone' : undefined;
  }
  try {
    const data = JSON.parse(text) as Partial<LockInfo>;
    if (
      typeof data.pid === 'number' &&
      typeof data.host === 'string' &&
      typeof data.startedAt === 'string'
    ) {
      return { pid: data.pid, host: data.host, startedAt: data.startedAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sameHolder(a: LockInfo, b: LockInfo): boolean {
  return a.pid === b.pid && a.host === b.host && a.startedAt === b.startedAt;
}

/** Only a process on this host can be checked; one on another host is assumed alive. */
function isDead(holder: LockInfo): boolean {
  if (holder.host !== hostname()) return false;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (cause) {
    return hasCode(cause, 'ESRCH');
  }
}

function hasCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === code;
}
