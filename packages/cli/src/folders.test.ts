import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { dataSteps, prepareDataFolder } from './folders';

const ME = { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 };

describe('prepareDataFolder', () => {
  it('creates a missing folder, with its parents', async () => {
    const data = join(await tempDir('mediaplane-data-'), 'srv', 'data');
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toBe('created');
    expect((await stat(data)).isDirectory()).toBe(true);
  });

  it('finds a folder this user can write to ready, and changes nothing about it', async () => {
    const data = await tempDir('mediaplane-data-');
    await chmod(data, 0o750);
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toBe('ready');
    expect((await stat(data)).mode & 0o777).toBe(0o750);
  });

  it('leaves the check to you when the apps run as someone else', async () => {
    const data = await tempDir('mediaplane-data-');
    const other = { uid: ME.uid + 1, gid: ME.gid };
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, other)).toBe('check');
  });

  it('refuses a file where the folder should be', async () => {
    const data = join(await tempDir('mediaplane-data-'), 'data');
    await writeFile(data, '');
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toEqual({
      blocked: 'it is not a folder',
    });
  });

  // root can write anywhere, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    'says why it could not create the folder',
    async () => {
      const parent = await tempDir('mediaplane-data-');
      await chmod(parent, 0o555);
      try {
        const data = join(parent, 'data');
        expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toEqual({
          blocked: 'permission denied',
        });
        await expect(stat(data)).rejects.toThrow();
      } finally {
        // So that the temporary folder can be removed.
        await chmod(parent, 0o755);
      }
    },
  );

  it("in the image, leaves a folder outside the home alone: it is the host's", async () => {
    const outside = join(await tempDir('mediaplane-data-'), 'data');
    expect(await prepareDataFolder(outside, '/opt/mediaplane', true, ME)).toBe('unseen');
    await expect(stat(outside)).rejects.toThrow();
    // Inside the home, the container sees the host's folder, so it can make it.
    const home = await tempDir('mediaplane-home-');
    await mkdir(join(home, 'media'));
    const inside = join(home, 'media', 'data');
    expect(await prepareDataFolder(inside, home, true, ME)).toBe('created');
  });
});

describe('dataSteps', () => {
  const who = `uid ${String(ME.uid)} (gid ${String(ME.gid)})`;
  const owner = `${String(ME.uid)}:${String(ME.gid)}`;

  it('needs no step for a folder that is ready, or that this user created', () => {
    expect(dataSteps('/srv/data', 'ready', ME)).toEqual([]);
    expect(dataSteps('/srv/data', 'created', ME)).toEqual([]);
  });

  it('gives the commands, quoted for the shell, for a folder it could not create', () => {
    expect(dataSteps('/srv/data', { blocked: 'permission denied' }, ME)).toEqual([
      `Create /srv/data (permission denied), for ${who}: sudo mkdir -p /srv/data && sudo chown ${owner} /srv/data`,
    ]);
    expect(dataSteps("/srv/my data's", { blocked: 'permission denied' }, ME)).toEqual([
      `Create /srv/my data's (permission denied), for ${who}: sudo mkdir -p '/srv/my data'\\''s' && sudo chown ${owner} '/srv/my data'\\''s'`,
    ]);
  });

  it("keeps today's step for a folder it can't see, and asks you to check one it found", () => {
    expect(dataSteps('/srv/data', 'unseen', ME)).toEqual([
      `Create /srv/data and make sure ${who} can write to it.`,
    ]);
    expect(dataSteps('/srv/data', 'check', ME)).toEqual([
      `Make sure ${who} can write to /srv/data.`,
    ]);
  });

  it('says to give away a folder it created as someone else, such as root', () => {
    const apps = { uid: ME.uid + 1, gid: ME.gid + 1 };
    expect(dataSteps('/srv/data', 'created', apps)).toEqual([
      `Give /srv/data to uid ${String(apps.uid)} (gid ${String(apps.gid)}), whom the apps run as: sudo chown ${String(apps.uid)}:${String(apps.gid)} /srv/data`,
    ]);
  });
});
