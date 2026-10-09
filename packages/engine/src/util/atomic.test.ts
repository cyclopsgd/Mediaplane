import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureDir, writeFileAtomic } from './atomic';

const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe('writeFileAtomic', () => {
  it('writes the content with the exact mode, creating parent folders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const path = join(dir, 'generated', '.env');
    await writeFileAtomic(path, "MP_X='fake'\n", 0o600);
    expect(await readFile(path, 'utf8')).toBe("MP_X='fake'\n");
    expect(await modeOf(path)).toBe(0o600);
  });

  it('replaces an existing file and leaves no temporary file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const path = join(dir, 'compose.yaml');
    await writeFile(path, 'old\n');
    await writeFileAtomic(path, 'new\n');
    expect(await readFile(path, 'utf8')).toBe('new\n');
    expect(await modeOf(path)).toBe(0o644);
    expect(await readdir(dir)).toEqual(['compose.yaml']);
  });

  it('names the file when it cannot be written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    await writeFile(join(dir, 'not-a-folder'), '');
    const path = join(dir, 'not-a-folder', 'compose.yaml');
    await expect(writeFileAtomic(path, 'x')).rejects.toThrow(`cannot write ${path}`);
  });

  it('removes its temporary file when the final rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    await mkdir(join(dir, 'compose.yaml'));
    await expect(writeFileAtomic(join(dir, 'compose.yaml'), 'x')).rejects.toThrow(
      `cannot write ${join(dir, 'compose.yaml')} (EISDIR)`,
    );
    expect(await readdir(dir)).toEqual(['compose.yaml']);
  });
});

/** Run `action` under a strict umask, which filters the mode that open() and mkdir() ask for. */
async function underUmask(mask: number, action: () => Promise<void>): Promise<void> {
  const previous = process.umask(mask);
  try {
    await action();
  } finally {
    process.umask(previous);
  }
}

describe('exact modes, whatever the umask', () => {
  it('writeFileAtomic gives the file the mode asked for, not the umask-filtered one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const path = join(dir, 'compose.yaml');
    await underUmask(0o077, () => writeFileAtomic(path, 'x', 0o644));
    expect(await modeOf(path)).toBe(0o644);
  });

  it('ensureDir gives a new folder the mode asked for, not the umask-filtered one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const shared = join(dir, 'shared');
    await underUmask(0o077, () => ensureDir(shared, 0o755));
    expect(await modeOf(shared)).toBe(0o755);
  });
});

describe('ensureDir', () => {
  it('creates the folder with the exact mode, and tightens an existing one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const state = join(dir, 'state');
    await ensureDir(state, 0o700);
    expect(await modeOf(state)).toBe(0o700);
    const loose = join(dir, 'loose');
    await ensureDir(loose, 0o755);
    await ensureDir(loose, 0o700);
    expect(await modeOf(loose)).toBe(0o700);
  });
});
