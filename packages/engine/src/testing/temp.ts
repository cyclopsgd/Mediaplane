import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * A new, empty folder in the system's temporary folder, named `prefix` and a random
 * suffix. It is deleted, with everything in it, when the test that asked for it finishes,
 * whether the test passed or not. Call it while a test runs, from the test or a helper it
 * calls, never from a hook or at the top of a file.
 */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** tempDir(), for synchronous code. */
export function tempDirSync(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
