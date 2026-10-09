import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCK_PATH } from '../paths';
import { acquireLock, LockedError } from './lock';

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
