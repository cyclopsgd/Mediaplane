import { writeFileSync } from 'node:fs';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrestartFile } from '../render/prestart';
import { tempDir } from '../testing/temp';
import { writePrestartFiles } from './prestart';

/** A file for the app whose folder `path` is in: appdata/<app>/... */
const file = (path: string, content: string): PrestartFile => ({
  app: path.split('/')[1] ?? 'qbittorrent',
  appName: 'qBittorrent',
  path,
  content,
  seeded: /^key=/m,
});

describe('writePrestartFiles', () => {
  it('creates each file, and its folders, private to its owner', async () => {
    const home = await tempDir('mediaplane-prestart-');
    const path = 'appdata/qbittorrent/qBittorrent/qBittorrent.conf';
    expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([path]);
    expect(await readFile(join(home, path), 'utf8')).toBe('key=fake\n');
    expect((await stat(join(home, path))).mode & 0o777).toBe(0o600);
    // No temporary copy of the content is left next to it.
    expect(await readdir(join(home, 'appdata', 'qbittorrent', 'qBittorrent'))).toEqual([
      'qBittorrent.conf',
    ]);
  });

  it('is private to its owner whatever the umask, and writes every file given', async () => {
    const home = await tempDir('mediaplane-prestart-');
    const paths = ['appdata/qbittorrent/a.conf', 'appdata/sonarr/config/b.ini'];
    const previous = process.umask(0);
    try {
      expect(
        await writePrestartFiles(
          home,
          paths.map((path) => file(path, 'key=fake\n')),
        ),
      ).toEqual(paths);
    } finally {
      process.umask(previous);
    }
    for (const path of paths) {
      expect((await stat(join(home, path))).mode & 0o777).toBe(0o600);
    }
  });

  it('never writes over a file that exists, and creates nothing then', async () => {
    const home = await tempDir('mediaplane-prestart-');
    await mkdir(join(home, 'appdata', 'qbittorrent'), { recursive: true });
    const path = 'appdata/qbittorrent/app.conf';
    await writeFile(join(home, path), 'key=the-apps-own\n');
    expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([]);
    expect(await readFile(join(home, path), 'utf8')).toBe('key=the-apps-own\n');
    expect(await readdir(join(home, 'appdata', 'qbittorrent'))).toEqual(['app.conf']);
  });

  it('never writes over a file that appears after it looked, and reports nothing created', async () => {
    const home = await tempDir('mediaplane-prestart-');
    const path = 'appdata/qbittorrent/app.conf';
    // The content is read after the look and before the write: the app wins that race.
    const racing: PrestartFile = {
      ...file(path, ''),
      get content() {
        writeFileSync(join(home, path), 'key=the-apps-own\n');
        return 'key=fake\n';
      },
    };
    expect(await writePrestartFiles(home, [racing])).toEqual([]);
    expect(await readFile(join(home, path), 'utf8')).toBe('key=the-apps-own\n');
    expect(await readdir(join(home, 'appdata', 'qbittorrent'))).toEqual(['app.conf']);
  });

  it('leaves alone a link to nothing, and writes nothing through it', async () => {
    const home = await tempDir('mediaplane-prestart-');
    const folder = join(home, 'appdata', 'qbittorrent');
    await mkdir(folder, { recursive: true });
    const outside = await tempDir('mediaplane-prestart-outside-');
    await symlink(join(outside, 'target.conf'), join(folder, 'app.conf'));
    expect(
      await writePrestartFiles(home, [
        file('appdata/qbittorrent/app.conf', 'key=fake\n'),
      ]),
    ).toEqual([]);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(folder)).toEqual(['app.conf']);
  });

  it('writes the files that are missing and skips the ones that exist', async () => {
    const home = await tempDir('mediaplane-prestart-');
    await mkdir(join(home, 'appdata', 'qbittorrent'), { recursive: true });
    await writeFile(
      join(home, 'appdata', 'qbittorrent', 'old.conf'),
      'key=the-apps-own\n',
    );
    const created = await writePrestartFiles(home, [
      file('appdata/qbittorrent/old.conf', 'key=fake\n'),
      file('appdata/sonarr/new.ini', 'key=fake\n'),
    ]);
    expect(created).toEqual(['appdata/sonarr/new.ini']);
  });

  it('fails loudly, naming the path and not the content, when a file stands where a folder should be', async () => {
    const home = await tempDir('mediaplane-prestart-');
    await mkdir(join(home, 'appdata'));
    // The app's folder is a file: lstat of what is inside it says ENOTDIR, not ENOENT.
    await writeFile(join(home, 'appdata', 'qbittorrent'), 'not a folder');
    const secret = 'key=fake-secret-content\n';
    const failure = await writePrestartFiles(home, [
      file('appdata/qbittorrent/qBittorrent/qBittorrent.conf', secret),
    ]).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toContain(join(home, 'appdata', 'qbittorrent'));
    expect(message).not.toContain('fake-secret-content');
    // Nothing else was made: the file is still a file, and no temporary copy is anywhere.
    expect(await readdir(join(home, 'appdata'))).toEqual(['qbittorrent']);
    expect(await readFile(join(home, 'appdata', 'qbittorrent'), 'utf8')).toBe(
      'not a folder',
    );
  });

  // root can write anywhere, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    "leaves alone a file in a folder Mediaplane can't write to, which the app owns",
    async () => {
      const home = await tempDir('mediaplane-prestart-');
      const folder = join(home, 'appdata', 'qbittorrent');
      await mkdir(folder, { recursive: true });
      const path = 'appdata/qbittorrent/app.conf';
      await writeFile(join(home, path), 'key=the-apps-own\n');
      await chmod(folder, 0o555);
      try {
        expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([]);
        // Not even a temporary file was made next to it.
        expect(await readdir(folder)).toEqual(['app.conf']);
      } finally {
        // So that the temporary folder can be removed.
        await chmod(folder, 0o755);
      }
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    'leaves alone a file inside a folder Mediaplane may not look into',
    async () => {
      const home = await tempDir('mediaplane-prestart-');
      const folder = join(home, 'appdata', 'qbittorrent');
      await mkdir(join(folder, 'qBittorrent'), { recursive: true });
      await writeFile(join(folder, 'qBittorrent', 'app.conf'), 'key=the-apps-own\n');
      // No search permission: lstat of anything inside fails with EACCES.
      await chmod(folder, 0o000);
      try {
        expect(
          await writePrestartFiles(home, [
            file('appdata/qbittorrent/qBittorrent/app.conf', 'key=fake\n'),
          ]),
        ).toEqual([]);
      } finally {
        await chmod(folder, 0o755);
      }
      expect(await readdir(join(folder, 'qBittorrent'))).toEqual(['app.conf']);
    },
  );
});

describe('writePrestartFiles and links', () => {
  /** A home with appdata/qbittorrent made, and an empty folder outside it. */
  async function homeAndOutside(): Promise<{ home: string; outside: string }> {
    const home = await tempDir('mediaplane-prestart-');
    await mkdir(join(home, 'appdata', 'qbittorrent'), { recursive: true });
    return { home, outside: await tempDir('mediaplane-prestart-outside-') };
  }

  const failureOf = async (action: Promise<unknown>): Promise<string> => {
    try {
      await action;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
    return 'it did not fail';
  };

  it('refuses a folder on its way that links outside the app folder, writing nothing there', async () => {
    const { home, outside } = await homeAndOutside();
    await symlink(outside, join(home, 'appdata', 'qbittorrent', 'sub'));
    for (const path of [
      'appdata/qbittorrent/sub/f.conf',
      'appdata/qbittorrent/sub/deep/er/f.conf',
    ]) {
      const message = await failureOf(
        writePrestartFiles(home, [file(path, 'key=fake-secret-content\n')]),
      );
      expect(message).toBe(
        `${path}: a folder on its way leads outside appdata/qbittorrent`,
      );
    }
    // Neither the file nor a folder for it appeared where the link leads.
    expect(await readdir(outside)).toEqual([]);
  });

  it("refuses a folder that links into another app's folder", async () => {
    const { home } = await homeAndOutside();
    await mkdir(join(home, 'appdata', 'sonarr'));
    await symlink('../sonarr', join(home, 'appdata', 'qbittorrent', 'sub'));
    await expect(
      writePrestartFiles(home, [file('appdata/qbittorrent/sub/f.conf', 'key=fake\n')]),
    ).rejects.toThrow('leads outside appdata/qbittorrent');
    expect(await readdir(join(home, 'appdata', 'sonarr'))).toEqual([]);
  });

  it('refuses a folder that is a link to nothing, writing nothing', async () => {
    const { home, outside } = await homeAndOutside();
    await symlink(join(outside, 'missing'), join(home, 'appdata', 'qbittorrent', 'sub'));
    await expect(
      writePrestartFiles(home, [file('appdata/qbittorrent/sub/f.conf', 'key=fake\n')]),
    ).rejects.toThrow(
      'appdata/qbittorrent/sub/f.conf: a folder on its way is a link to nothing',
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it('follows a link that stays inside the app folder', async () => {
    const { home } = await homeAndOutside();
    const folder = join(home, 'appdata', 'qbittorrent');
    await mkdir(join(folder, 'real'));
    await symlink('real', join(folder, 'sub'));
    const path = 'appdata/qbittorrent/sub/f.conf';
    expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([path]);
    expect(await readFile(join(folder, 'real', 'f.conf'), 'utf8')).toBe('key=fake\n');
  });

  it('writes where appdata, or an app folder, links to another disk', async () => {
    const home = await tempDir('mediaplane-prestart-');
    const disk = await tempDir('mediaplane-prestart-disk-');
    await mkdir(join(disk, 'qbittorrent'));
    await symlink(disk, join(home, 'appdata'));
    const first = 'appdata/qbittorrent/qBittorrent/qBittorrent.conf';
    expect(await writePrestartFiles(home, [file(first, 'key=fake\n')])).toEqual([first]);
    expect(
      await readFile(
        join(disk, 'qbittorrent', 'qBittorrent', 'qBittorrent.conf'),
        'utf8',
      ),
    ).toBe('key=fake\n');

    // Now only the app's own folder links elsewhere, and does not exist yet at the end.
    const other = await tempDir('mediaplane-prestart-disk-');
    const home2 = await tempDir('mediaplane-prestart-');
    await mkdir(join(home2, 'appdata'));
    await symlink(other, join(home2, 'appdata', 'sonarr'));
    const second = 'appdata/sonarr/config/app.ini';
    expect(await writePrestartFiles(home2, [file(second, 'key=fake\n')])).toEqual([
      second,
    ]);
    expect((await stat(join(other, 'config', 'app.ini'))).mode & 0o777).toBe(0o600);
  });

  it('works when the home itself is reached through a link', async () => {
    const real = await tempDir('mediaplane-prestart-');
    const parent = await tempDir('mediaplane-prestart-links-');
    const home = join(parent, 'home');
    await symlink(real, home);
    const path = 'appdata/qbittorrent/app.conf';
    expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([path]);
    expect(await readFile(join(real, path), 'utf8')).toBe('key=fake\n');
  });
});
