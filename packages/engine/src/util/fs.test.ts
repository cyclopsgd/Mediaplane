import { chmod, writeFile } from 'node:fs/promises';
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
});
