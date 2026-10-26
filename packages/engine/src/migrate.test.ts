import { chmod, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { LOCK_PATH } from './paths';
import { acquireLock } from './state/lock';
import { RENAME_MEDIA } from './testing/migrations';
import { tempDir } from './testing/temp';

/** A version 0 stack.yaml, as someone wrote it by hand: comments lined up, a blank line. */
const OLD = `# My media stack.
version: 0          # the format
paths: { data: /srv/data }
media: jellyfin     # or plex

apps:
  sonarr: {}
`;
const MIGRATED = OLD.replace('version: 0', 'version: 1').replace(
  'media: jellyfin',
  'media_server: jellyfin',
);
const AT = new Date('2026-10-25T08:00:00.000Z');

async function home(stack: string, mode = 0o640): Promise<string> {
  const dir = await tempDir('mediaplane-migrate-');
  await writeFile(join(dir, 'stack.yaml'), stack);
  await chmod(join(dir, 'stack.yaml'), mode);
  return dir;
}
const run = (dir: string, migrations = [RENAME_MEDIA]) =>
  migrate({ home: dir, migrations, now: () => AT });

describe('migrate (spec §5.2)', () => {
  it('rewrites an older stack.yaml to the current version, keeping all else, mode too', async () => {
    const dir = await home(OLD);
    expect(await run(dir)).toEqual({
      ok: true,
      from: 0,
      to: 1,
      changed: true,
      applied: ['media is now media_server'],
      diagnostics: [],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(MIGRATED);
    expect((await stat(join(dir, 'stack.yaml'))).mode & 0o777).toBe(0o640);
  });

  it('has nothing to do for the current version, and writes nothing', async () => {
    const dir = await home(MIGRATED);
    const before = await stat(join(dir, 'stack.yaml'));
    expect(await run(dir)).toEqual({
      ok: true,
      from: 1,
      to: 1,
      changed: false,
      applied: [],
      diagnostics: [],
    });
    expect((await stat(join(dir, 'stack.yaml'))).mtimeMs).toBe(before.mtimeMs);
  });

  it('has nothing to do with the migrations Mediaplane has: none yet', async () => {
    const dir = await home(MIGRATED);
    expect(await migrate({ home: dir })).toMatchObject({ ok: true, changed: false });
  });

  it('writes nothing with managed_by: external, and gives the file as it should be', async () => {
    const external = `${OLD}managed_by: external\n`;
    const dir = await home(external);
    const result = await run(dir);
    expect(result).toMatchObject({
      ok: false,
      from: 0,
      to: 1,
      changed: false,
      text: `${MIGRATED}managed_by: external\n`,
      diagnostics: [{ code: 'migrate.external' }],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(external);
  });

  it('refuses a stack.yaml it would replace a link with, giving the file as it should be', async () => {
    const dir = await home(OLD);
    await writeFile(join(dir, 'real.yaml'), OLD);
    const linked = await tempDir('mediaplane-migrate-link-');
    await symlink(join(dir, 'real.yaml'), join(linked, 'stack.yaml'));
    const result = await run(linked);
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      text: MIGRATED,
      diagnostics: [{ code: 'migrate.stack-file' }],
    });
    expect(await readFile(join(dir, 'real.yaml'), 'utf8')).toBe(OLD);
  });

  it('refuses a stack.yaml newer than this Mediaplane', async () => {
    const dir = await home(MIGRATED.replace('version: 1', 'version: 2'));
    expect(await run(dir)).toMatchObject({
      ok: false,
      changed: false,
      diagnostics: [{ code: 'config.newer-version' }],
    });
  });

  it("refuses a rewrite that wouldn't be a valid stack.yaml, writing nothing", async () => {
    const dir = await home(OLD.replace('media: jellyfin', 'media: nonsense'));
    const result = await run(dir);
    expect(result).toMatchObject({ ok: false, changed: false });
    expect(result.diagnostics[0]?.code).toBe('config.invalid');
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toContain('version: 0');
  });

  it("refuses a file it can't rewrite line by line, such as one written as { … }", async () => {
    const dir = await home(
      '{ version: 0, paths: { data: /srv/data }, media: jellyfin }\n',
    );
    expect(await run(dir)).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'migrate.rewrite',
          message:
            "Mediaplane can't rewrite stack.yaml: its top level is not a YAML block of keys, one per line",
        },
      ],
    });
  });

  it.runIf(process.getuid?.() !== 0)(
    "says when it can't write the file, and gives the file as it should be",
    async () => {
      const dir = await home(OLD);
      await (await acquireLock(dir, () => AT, 'keep')).release();
      await chmod(dir, 0o555);
      try {
        expect(await run(dir)).toMatchObject({
          ok: false,
          text: MIGRATED,
          diagnostics: [{ code: 'migrate.stack-file' }],
        });
      } finally {
        await chmod(dir, 0o755);
      }
      expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(OLD);
    },
  );

  it('waits for nothing: another command holding the lock stops it', async () => {
    const dir = await home(OLD);
    const lock = await acquireLock(dir, () => AT, 'keep');
    try {
      expect(await run(dir)).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'migrate.locked' }],
      });
    } finally {
      await lock.release();
    }
    await expect(stat(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it("says there is no stack.yaml, and makes no state/ in a folder that isn't a home", async () => {
    const dir = await tempDir('mediaplane-migrate-none-');
    expect(await run(dir)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'config.missing' }],
    });
    await expect(stat(join(dir, 'state'))).rejects.toThrow();
  });
});
