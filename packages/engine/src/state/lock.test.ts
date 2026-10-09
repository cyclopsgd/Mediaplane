import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_PATH } from '../paths';
import { acquireLock, LockedError } from './lock';

// open() and rename() pass straight through, except where a test makes one call misbehave
// at an exact moment (the failures and races below can't be provoked reliably otherwise).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});
const real = await vi.importActual<typeof FsPromises>('node:fs/promises');

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(rename).mockReset();
});

const NOW = () => new Date('2026-10-09T09:43:12.000Z');

async function homeWithLock(content: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
  await mkdir(join(home, 'state'));
  await writeFile(join(home, LOCK_PATH), content);
  return home;
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid;
}

describe('acquireLock', () => {
  it('records who holds the lock, with private modes, and releases it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
    const lock = await acquireLock(home, NOW);
    expect(JSON.parse(await readFile(join(home, LOCK_PATH), 'utf8'))).toEqual({
      pid: process.pid,
      host: hostname(),
      startedAt: '2026-10-09T09:43:12.000Z',
    });
    expect((await stat(join(home, 'state'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, LOCK_PATH))).mode & 0o777).toBe(0o600);
    await lock.release();
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();
    await (await acquireLock(home, NOW)).release();
  });

  it('refuses while another live process holds it, saying who and since when', async () => {
    const holder = {
      pid: process.pid,
      host: hostname(),
      startedAt: '2026-10-09T09:00:00.000Z',
    };
    const home = await homeWithLock(JSON.stringify(holder));
    const failure = acquireLock(home, NOW);
    await expect(failure).rejects.toBeInstanceOf(LockedError);
    await expect(failure).rejects.toThrow(
      `another apply is running (pid ${String(process.pid)} on ${hostname()}, started 2026-10-09T09:00:00.000Z)`,
    );
  });

  it('clears a lock left by a process that has died', async () => {
    const holder = {
      pid: deadPid(),
      host: hostname(),
      startedAt: '2026-10-09T09:00:00.000Z',
    };
    const home = await homeWithLock(JSON.stringify(holder));
    const lock = await acquireLock(home, NOW);
    expect(JSON.parse(await readFile(join(home, LOCK_PATH), 'utf8'))).toMatchObject({
      pid: process.pid,
    });
    await lock.release();
  });

  it("never clears another host's lock, which it can't check", async () => {
    const holder = {
      pid: deadPid(),
      host: 'fake-other-host',
      startedAt: '2026-10-09T09:00:00.000Z',
    };
    const home = await homeWithLock(JSON.stringify(holder));
    await expect(acquireLock(home, NOW)).rejects.toBeInstanceOf(LockedError);
  });

  it('refuses when the lock file cannot be read', async () => {
    const home = await homeWithLock('not json');
    await expect(acquireLock(home, NOW)).rejects.toThrow(
      'state/lock exists but cannot be read',
    );
  });
});

describe('acquireLock, when things go wrong', () => {
  it('refuses a second acquire in the same process until the first is released', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
    const first = await acquireLock(home, NOW);
    const second = acquireLock(home, NOW);
    await expect(second).rejects.toBeInstanceOf(LockedError);
    await expect(second).rejects.toMatchObject({ holder: { pid: process.pid } });
    await first.release();
    await (await acquireLock(home, NOW)).release();
  });

  it('never leaves a lock behind when writing it fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await real.open(...args);
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(
        Object.assign(new Error('fake: no space left on device'), { code: 'ENOSPC' }),
      );
      return handle;
    });
    await expect(acquireLock(home, NOW)).rejects.toThrow('no space left on device');
    expect(await readdir(join(home, 'state'))).toEqual([]);
    await (await acquireLock(home, NOW)).release();
  });

  it('does not delete a live lock that replaced the stale one before it was claimed', async () => {
    const stale = {
      pid: deadPid(),
      host: hostname(),
      startedAt: '2026-10-09T09:00:00.000Z',
    };
    const live = {
      pid: process.pid,
      host: hostname(),
      startedAt: '2026-10-09T09:30:00.000Z',
    };
    const home = await homeWithLock(JSON.stringify(stale));
    const path = join(home, LOCK_PATH);
    // A rival run clears the stale lock and takes its own, just before we claim it.
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await writeFile(path, JSON.stringify(live));
      await real.rename(from, to);
    });
    const failure = acquireLock(home, NOW);
    await expect(failure).rejects.toBeInstanceOf(LockedError);
    await expect(failure).rejects.toMatchObject({ holder: live });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(live);
    expect(await readdir(join(home, 'state'))).toEqual(['lock']);
  });

  it('leaves a newer lock alone when it puts back a live one it claimed by mistake', async () => {
    const stale = {
      pid: deadPid(),
      host: hostname(),
      startedAt: '2026-10-09T09:00:00.000Z',
    };
    const live = {
      pid: process.pid,
      host: hostname(),
      startedAt: '2026-10-09T09:30:00.000Z',
    };
    const newer = {
      pid: process.pid,
      host: hostname(),
      startedAt: '2026-10-09T09:40:00.000Z',
    };
    const home = await homeWithLock(JSON.stringify(stale));
    const path = join(home, LOCK_PATH);
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await writeFile(path, JSON.stringify(live));
      await real.rename(from, to);
      await writeFile(path, JSON.stringify(newer)); // someone else locks before we put it back
    });
    await expect(acquireLock(home, NOW)).rejects.toMatchObject({ holder: live });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(newer);
    expect(await readdir(join(home, 'state'))).toEqual(['lock']);
  });

  it('carries on when another run clears the stale lock first', async () => {
    const stale = {
      pid: deadPid(),
      host: hostname(),
      startedAt: '2026-10-09T09:00:00.000Z',
    };
    const home = await homeWithLock(JSON.stringify(stale));
    const path = join(home, LOCK_PATH);
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await rm(path);
      await real.rename(from, to); // the lock is already gone: ENOENT
    });
    const lock = await acquireLock(home, NOW);
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
    await lock.release();
  });
});
