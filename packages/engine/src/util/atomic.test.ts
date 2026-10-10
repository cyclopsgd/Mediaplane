import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureDir, writeFileAtomic, writeFileExclusive } from './atomic';
import { tempDir } from '../testing/temp';

const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe('writeFileAtomic', () => {
  it('writes the content with the exact mode, creating parent folders', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    const path = join(dir, 'generated', '.env');
    await writeFileAtomic(path, "MP_X='fake'\n", 0o600);
    expect(await readFile(path, 'utf8')).toBe("MP_X='fake'\n");
    expect(await modeOf(path)).toBe(0o600);
  });

  it('replaces an existing file and leaves no temporary file behind', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    const path = join(dir, 'compose.yaml');
    await writeFile(path, 'old\n');
    await writeFileAtomic(path, 'new\n');
    expect(await readFile(path, 'utf8')).toBe('new\n');
    expect(await modeOf(path)).toBe(0o644);
    expect(await readdir(dir)).toEqual(['compose.yaml']);
  });

  it('names the file when it cannot be written', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    await writeFile(join(dir, 'not-a-folder'), '');
    const path = join(dir, 'not-a-folder', 'compose.yaml');
    await expect(writeFileAtomic(path, 'x')).rejects.toThrow(`cannot write ${path}`);
  });

  it('removes its temporary file when the final rename fails', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    await mkdir(join(dir, 'compose.yaml'));
    await expect(writeFileAtomic(join(dir, 'compose.yaml'), 'x')).rejects.toThrow(
      `cannot write ${join(dir, 'compose.yaml')} (EISDIR)`,
    );
    expect(await readdir(dir)).toEqual(['compose.yaml']);
  });
});

describe('writeFileExclusive', () => {
  it('names the file, not its temporary file, when it cannot be created', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    await writeFile(join(dir, 'not-a-folder'), '');
    const path = join(dir, 'not-a-folder', 'app.conf');
    const failure = await writeFileExclusive(path, 'key=fake\n', 0o600).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) return;
    expect(failure.message).toBe(`cannot create ${path} (ENOTDIR)`);
    // The original error is kept for whoever needs it.
    expect(failure.cause).toBeInstanceOf(Error);
  });

  it('creates the file, and returns false and changes nothing when it exists', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    const path = join(dir, 'app.conf');
    expect(await writeFileExclusive(path, 'first\n', 0o600)).toBe(true);
    expect(await writeFileExclusive(path, 'second\n', 0o600)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('first\n');
    expect(await readdir(dir)).toEqual(['app.conf']);
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
    const dir = await tempDir('mediaplane-atomic-');
    const path = join(dir, 'compose.yaml');
    await underUmask(0o077, () => writeFileAtomic(path, 'x', 0o644));
    expect(await modeOf(path)).toBe(0o644);
  });

  it('ensureDir gives a new folder the mode asked for, not the umask-filtered one', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    const shared = join(dir, 'shared');
    await underUmask(0o077, () => ensureDir(shared, 0o755));
    expect(await modeOf(shared)).toBe(0o755);
  });
});

describe('ensureDir', () => {
  it('creates the folder with the exact mode, and tightens an existing one', async () => {
    const dir = await tempDir('mediaplane-atomic-');
    const state = join(dir, 'state');
    await ensureDir(state, 0o700);
    expect(await modeOf(state)).toBe(0o700);
    const loose = join(dir, 'loose');
    await ensureDir(loose, 0o755);
    await ensureDir(loose, 0o700);
    expect(await modeOf(loose)).toBe(0o700);
  });
});
