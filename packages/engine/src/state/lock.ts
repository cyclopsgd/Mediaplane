import { open, readFile, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { LOCK_PATH, STATE_DIR } from '../paths';
import { ensureDir } from '../util/atomic';

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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(info)}\n`, 'utf8');
      } finally {
        await file.close();
      }
      return { release: () => rm(path, { force: true }) };
    } catch (cause) {
      if (!hasCode(cause, 'EEXIST')) throw cause;
      const holder = await readHolder(path);
      if (holder === undefined || !isDead(holder)) throw new LockedError(holder);
      await rm(path, { force: true });
    }
  }
  throw new LockedError(await readHolder(path));
}

async function readHolder(path: string): Promise<LockInfo | undefined> {
  try {
    const data = JSON.parse(await readFile(path, 'utf8')) as Partial<LockInfo>;
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
