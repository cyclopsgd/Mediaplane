import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrestartFile } from '../render/prestart';
import { tempDir } from '../testing/temp';
import { planPrestartFiles } from './prestart';

const FILE: PrestartFile = {
  app: 'sonarr',
  appName: 'Sonarr',
  path: 'appdata/sonarr/config.xml',
  content: '<Config><ApiKey>fake-key</ApiKey></Config>\n',
  seeded: /<ApiKey>[^<]+<\/ApiKey>/,
};

const AS_PLANNED = { diff: '', content: '', sensitive: true, prestart: true };

/** A home, with Sonarr's config.xml holding `content` when it is given. */
async function homeWith(content?: string): Promise<string> {
  const home = await tempDir('mediaplane-prestart-');
  if (content !== undefined) {
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, FILE.path), content);
  }
  return home;
}

describe('planPrestartFiles', () => {
  it('creates a file that is absent, and never shows its content', async () => {
    expect(await planPrestartFiles(await homeWith(), [FILE])).toEqual({
      changes: [{ path: FILE.path, status: 'create', ...AS_PLANNED }],
      diagnostics: [],
    });
  });

  it('leaves alone a file Mediaplane seeded, even after the app rewrote it', async () => {
    const home = await homeWith(
      '<Config>\n  <Port>8989</Port>\n  <ApiKey>rewritten-by-the-app</ApiKey>\n</Config>\n',
    );
    expect(await planPrestartFiles(home, [FILE])).toEqual({
      changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
      diagnostics: [],
    });
  });

  it('reports a file from before Mediaplane seeded the app, and leaves it alone', async () => {
    const home = await homeWith('<Config>\n  <Port>8989</Port>\n</Config>\n');
    expect(await planPrestartFiles(home, [FILE])).toEqual({
      changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
      diagnostics: [
        {
          severity: 'error',
          code: 'sonarr.not-seeded',
          message:
            'appdata/sonarr/config.xml was not written by Mediaplane, so it lacks the key Mediaplane gave Sonarr',
          hint: 'stop Sonarr, delete appdata/sonarr/config.xml in the Mediaplane home, then run apply again: it writes a new one before Sonarr starts. The settings in that file are lost; Sonarr\'s other data is kept. See "Set up before Slice 3a" in catalog/sonarr/README.md',
        },
      ],
    });
  });

  it('treats a file under something that is not a folder as absent', async () => {
    const home = await homeWith();
    await writeFile(join(home, 'appdata'), 'not a folder');
    expect((await planPrestartFiles(home, [FILE])).changes[0]?.status).toBe('create');
  });

  // root can read anything, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    "leaves alone a file Mediaplane can't read, which the app owns",
    async () => {
      const home = await homeWith('<Config />\n');
      await chmod(join(home, FILE.path), 0o000);
      expect(await planPrestartFiles(home, [FILE])).toEqual({
        changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
        diagnostics: [],
      });
    },
  );

  it('names the file when it cannot be read for another reason', async () => {
    const home = await homeWith();
    await mkdir(join(home, FILE.path), { recursive: true });
    await expect(planPrestartFiles(home, [FILE])).rejects.toThrow(
      `cannot read ${join(home, FILE.path)} (EISDIR)`,
    );
  });
});
