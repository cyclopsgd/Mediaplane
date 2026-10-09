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

  it('compares a sensitive file without ever diffing or keeping its content', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-files-'));
    await mkdir(join(home, 'generated'));
    const file = {
      path: 'generated/.env',
      content: "MP_X='fake-new'\n",
      sensitive: true,
    };
    expect(await diffFiles(home, [file])).toEqual([
      {
        path: 'generated/.env',
        status: 'create',
        diff: '',
        content: '',
        sensitive: true,
      },
    ]);
    await writeFile(join(home, 'generated/.env'), "MP_X='fake-old'\n");
    expect((await diffFiles(home, [file]))[0]).toMatchObject({
      status: 'update',
      diff: '',
      content: '',
    });
    await writeFile(join(home, 'generated/.env'), file.content);
    expect((await diffFiles(home, [file]))[0]).toMatchObject({
      status: 'unchanged',
      content: '',
    });
  });
});
