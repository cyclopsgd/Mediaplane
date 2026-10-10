import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir, tempDirSync } from './temp';

// The first test records the folders it made; the second checks they are gone.
const made: string[] = [];

describe('tempDir and tempDirSync', () => {
  it('make an empty folder in the temporary folder, named with the prefix', async () => {
    const dir = await tempDir('mediaplane-temp-');
    expect(dir.startsWith(join(tmpdir(), 'mediaplane-temp-'))).toBe(true);
    expect(existsSync(dir)).toBe(true);
    await writeFile(join(dir, 'file'), 'fake-content');
    const sync = tempDirSync('mediaplane-temp-');
    expect(existsSync(sync)).toBe(true);
    made.push(dir, sync);
  });

  it('removed both folders, and what was in them, when that test finished', () => {
    expect(made).toHaveLength(2);
    for (const dir of made) expect(existsSync(dir)).toBe(false);
  });
});
