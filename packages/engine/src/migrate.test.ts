import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { LOCK_PATH } from './paths';
import { acquireLock } from './state/lock';
import type { Migration } from './config/migrations';
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

  it.each([
    [
      'flow style',
      '{ version: 1, paths: { data: /srv/data }, media_server: jellyfin }\n',
    ],
    [
      'JSON',
      '{"version": 1, "paths": {"data": "/srv/data"}, "media_server": "jellyfin"}\n',
    ],
  ])('has nothing to do for a current version written as %s', async (_what, current) => {
    const dir = await home(current);
    expect(await run(dir)).toEqual({
      ok: true,
      from: 1,
      to: 1,
      changed: false,
      applied: [],
      diagnostics: [],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(current);
  });

  it('refuses a stack.yaml that is a directory, without a lock or an uncaught error', async () => {
    const dir = await tempDir('mediaplane-migrate-dir-');
    await mkdir(join(dir, 'stack.yaml'));
    expect(await run(dir)).toMatchObject({
      ok: false,
      changed: false,
      diagnostics: [{ code: 'migrate.stack-file' }],
    });
    await expect(stat(join(dir, 'state'))).rejects.toThrow();
  });

  it('refuses a stack.yaml that is a named pipe, without waiting for a writer', async () => {
    const dir = await tempDir('mediaplane-migrate-fifo-');
    execFileSync('mkfifo', [join(dir, 'stack.yaml')]);
    expect(await run(dir)).toMatchObject({
      ok: false,
      changed: false,
      diagnostics: [{ code: 'migrate.stack-file' }],
    });
    await expect(stat(join(dir, 'state'))).rejects.toThrow();
  });

  it("refuses a rewrite whose result isn't a valid stack.yaml, writing nothing", async () => {
    // A migration whose text and data agree with each other, but not with the schema,
    // the second time it is asked: only the check of the text to write catches it.
    let asked = 0;
    const drifting: Migration = {
      ...RENAME_MEDIA,
      data: (stack) => {
        asked += 1;
        const { media, ...rest } = stack;
        return asked === 1 ? { ...rest, media_server: media } : { ...rest, bogus: media };
      },
      text: (source, doc) =>
        RENAME_MEDIA.text(source, doc).map((edit) => ({ ...edit, text: 'bogus' })),
    };
    const dir = await home(OLD);
    const result = await run(dir, [drifting]);
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      diagnostics: [{ code: 'migrate.rewrite' }],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(OLD);
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
    // The old-version warning first, then the schema's error it explains.
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'config.old-version',
      'config.invalid',
    ]);
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
