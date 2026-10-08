import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffFiles } from './files';

describe('diffFiles', () => {
  it('marks files as new, changed or unchanged, with a unified diff', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-files-'));
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, 'generated', 'same.yaml'), 'a: 1\n');
    await writeFile(join(home, 'generated', 'old.yaml'), 'a: 1\n');

    const changes = await diffFiles(home, [
      { path: 'generated/new.yaml', content: 'a: 1\n' },
      { path: 'generated/old.yaml', content: 'a: 2\n' },
      { path: 'generated/same.yaml', content: 'a: 1\n' },
    ]);

    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['generated/new.yaml', 'create'],
      ['generated/old.yaml', 'update'],
      ['generated/same.yaml', 'unchanged'],
    ]);
    expect(changes[0]?.diff).toContain('+a: 1');
    expect(changes[1]?.diff).toContain('-a: 1');
    expect(changes[1]?.diff).toContain('+a: 2');
    expect(changes[2]?.diff).toBe('');
    expect(changes[1]?.content).toBe('a: 2\n');
  });
});
