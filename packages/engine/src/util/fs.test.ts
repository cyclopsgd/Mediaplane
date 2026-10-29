import { spawnSync } from 'node:child_process';
import { chmod, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readIfExists } from './fs';
import { tempDir } from '../testing/temp';

describe('readIfExists', () => {
  it('returns undefined for a file that does not exist', async () => {
    expect(await readIfExists('/nonexistent/mediaplane/file')).toBeUndefined();
  });

  it('names the file when a read fails for another reason', async () => {
    const dir = await tempDir('mediaplane-fs-');
    await expect(readIfExists(dir)).rejects.toThrow(`cannot read ${dir} (EISDIR)`);
  });

  // root can read anything, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    'says what to check when permission is denied',
    async () => {
      const file = join(await tempDir('mediaplane-fs-'), 'stack.yaml');
      await writeFile(file, 'version: 1\n');
      await chmod(file, 0o000);
      await expect(readIfExists(file)).rejects.toThrow(
        `cannot read ${file} (EACCES): check that the user running Mediaplane can read it`,
      );
    },
  );

  // The only guard of the check-then-read race: a named pipe swapped in for the file
  // between fileKind() and the read. Never waited on; a short timeout fails a hang fast.
  it(
    'never waits on a named pipe with noWait, with or without a writer',
    { timeout: 2_000 },
    async (ctx) => {
      const pipe = join(await tempDir('mediaplane-fs-'), 'stack.yaml');
      if (spawnSync('mkfifo', [pipe]).status !== 0) {
        ctx.skip();
        return;
      }
      expect(await readIfExists(pipe, { noWait: true })).toBe('');
      // Read-write, so the open never waits for a reader: a writer with nothing written.
      const writer = await open(pipe, 'r+');
      try {
        await expect(readIfExists(pipe, { noWait: true })).rejects.toThrow(
          `cannot read ${pipe} (EAGAIN)`,
        );
      } finally {
        await writer.close();
      }
    },
  );
});
