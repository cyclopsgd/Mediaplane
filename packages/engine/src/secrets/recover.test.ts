import { execFileSync } from 'node:child_process';
import { linkSync, renameSync, unlinkSync } from 'node:fs';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type * as Sqlite from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, KeyFile } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FAKE_SETUP } from '../testing/bootstrap';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { KEY_FILE_LIMIT, readKeyFile, recoverKeys, withRecoveredKeys } from './recover';
import { emptySecretStore, type SecretStore } from './store';

/**
 * What runs as SQLite opens a database, once: `before`, between Mediaplane's own open and
 * SQLite's, as another process swapping the file would; `after`, once SQLite has it.
 */
const sqliteOpen: { before?: () => void; after?: () => void } = vi.hoisted(() => ({}));

vi.mock('node:sqlite', async (importOriginal) => {
  const actual = await importOriginal<typeof Sqlite>();
  class Hooked extends actual.DatabaseSync {
    constructor(...args: ConstructorParameters<typeof actual.DatabaseSync>) {
      const { before, after } = sqliteOpen;
      delete sqliteOpen.before;
      before?.();
      super(...args);
      delete sqliteOpen.after;
      after?.();
    }
  }
  return { ...actual, DatabaseSync: Hooked };
});

afterEach(() => {
  delete sqliteOpen.before;
  delete sqliteOpen.after;
});

const KEY = 'a'.repeat(32);

/** A key file as Sonarr's config.xml holds one. */
const CONFIG: KeyFile = {
  path: 'config.xml',
  read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
};

/** A key file as Jellyfin's database holds one: the newest named Mediaplane. */
const DATABASE: KeyFile = {
  path: 'data/app.db',
  sqlite: {
    query: `SELECT AccessToken FROM ApiKeys WHERE Name = 'Mediaplane' ORDER BY DateCreated DESC, Id ASC LIMIT 1`,
    column: 'AccessToken',
  },
};

/** The fixture catalog, with Sonarr's key in its config.xml and Jellyfin's in its database. */
const CATALOG: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr'
    ? { ...app, keyFiles: { apiKey: CONFIG } }
    : app.id === 'jellyfin'
      ? {
          ...app,
          secrets: { apiKey: { createdBy: 'app' } },
          keyFiles: { apiKey: DATABASE },
        }
      : app,
);

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

function stackIn(home: string): ResolvedStack {
  const result = resolveStack(fixtureConfig(STACK), CATALOG, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** `text` as appdata/<app>/<path> in a new home; the home. */
async function homeWith(app: string, path: string, text: string): Promise<string> {
  const home = await tempDir('mediaplane-recover-');
  await mkdir(join(home, 'appdata', app, path, '..'), { recursive: true });
  await writeFile(join(home, 'appdata', app, path), text);
  return home;
}

/** `path` removed, if anything stands there. */
const rmIfThere = (path: string) => rm(path, { force: true });

/** A database like Jellyfin's, with the keys `rows` gives, at appdata/jellyfin/data/app.db. */
async function homeWithDatabase(
  rows: { name: string; token: string; created: string }[],
): Promise<string> {
  const home = await tempDir('mediaplane-recover-');
  await mkdir(join(home, 'appdata', 'jellyfin', 'data'), { recursive: true });
  const db = new DatabaseSync(join(home, 'appdata', 'jellyfin', 'data', 'app.db'));
  db.exec(
    'CREATE TABLE ApiKeys (Id INTEGER PRIMARY KEY, DateCreated TEXT, Name TEXT, AccessToken TEXT)',
  );
  const insert = db.prepare(
    'INSERT INTO ApiKeys (DateCreated, Name, AccessToken) VALUES (?, ?, ?)',
  );
  for (const row of rows) insert.run(row.created, row.name, row.token);
  db.close();
  return home;
}

describe('readKeyFile', () => {
  it('gives the key a file holds, and says when it holds none or is absent', async () => {
    const home = await homeWith(
      'sonarr',
      'config.xml',
      `<Config><ApiKey>${KEY}</ApiKey>`,
    );
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'key',
      value: KEY,
    });
    const without = await homeWith('sonarr', 'config.xml', '<Config></Config>');
    expect(await readKeyFile(without, 'sonarr', CONFIG)).toEqual({ found: 'none' });
    const empty = await homeWith('sonarr', 'config.xml', '<ApiKey></ApiKey>');
    expect(await readKeyFile(empty, 'sonarr', CONFIG)).toEqual({ found: 'none' });
    expect(await readKeyFile(home, 'radarr', CONFIG)).toEqual({ found: 'absent' });
  });

  it('never reads a link at the key file itself, whether it leads out of the folder or stays in', async () => {
    const home = await homeWith('radarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await symlink(
      join(home, 'appdata', 'radarr', 'config.xml'),
      join(home, 'appdata', 'sonarr', 'config.xml'),
    );
    const refused = { found: 'unreadable', why: 'it is a link, which is never followed' };
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual(refused);
    // Nor one that stays inside the app's folder.
    await writeFile(
      join(home, 'appdata', 'radarr', 'old.xml'),
      `<ApiKey>${KEY}</ApiKey>`,
    );
    await symlink('old.xml', join(home, 'appdata', 'radarr', 'new.xml'));
    expect(await readKeyFile(home, 'radarr', { ...CONFIG, path: 'new.xml' })).toEqual(
      refused,
    );
    // A link to nothing exists, and can't be read.
    await symlink(join(home, 'nowhere'), join(home, 'appdata', 'radarr', 'other.xml'));
    expect(await readKeyFile(home, 'radarr', { ...CONFIG, path: 'other.xml' })).toEqual(
      refused,
    );
  });

  it('never reads a key file in a folder that is linked out of the app folder', async () => {
    const home = await homeWith('radarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await symlink(
      join(home, 'appdata', 'radarr'),
      join(home, 'appdata', 'sonarr', 'linked'),
    );
    const read = vi.fn(() => KEY);
    expect(
      await readKeyFile(home, 'sonarr', { path: 'linked/config.xml', read }),
    ).toEqual({ found: 'unreadable', why: 'it leads outside appdata/sonarr' });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a named pipe, or a folder, for a key file, never waiting on a pipe's writer", async () => {
    const home = await tempDir('mediaplane-recover-');
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    execFileSync('mkfifo', [join(home, 'appdata', 'sonarr', 'config.xml')]);
    const refused = { found: 'unreadable', why: 'it is not a regular file' };
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual(refused);
    // A database that is a pipe is not opened either.
    await mkdir(join(home, 'appdata', 'jellyfin', 'data'), { recursive: true });
    execFileSync('mkfifo', [join(home, 'appdata', 'jellyfin', 'data', 'app.db')]);
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual(refused);
    await mkdir(join(home, 'appdata', 'radarr', 'config.xml'), { recursive: true });
    expect(await readKeyFile(home, 'radarr', CONFIG)).toEqual(refused);
  });

  it('refuses a database that is a link, whatever it leads to', async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const folder = join(home, 'appdata', 'jellyfin', 'data');
    await symlink(join(folder, 'app.db'), join(folder, 'link.db'));
    expect(
      await readKeyFile(home, 'jellyfin', { ...DATABASE, path: 'data/link.db' }),
    ).toEqual({
      found: 'unreadable',
      why: 'it is a link, which is never followed',
    });
  });

  it('reads a key file of at most 1 MiB, and says a larger one is unreadable', async () => {
    const home = await homeWith('sonarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    const path = join(home, 'appdata', 'sonarr', 'config.xml');
    await truncate(path, KEY_FILE_LIMIT);
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'key',
      value: KEY,
    });
    await truncate(path, KEY_FILE_LIMIT + 1);
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'unreadable',
      why: 'it is larger than 1 MiB',
    });
  });

  it('says a file whose content its reader refuses is unreadable, never "holds none"', async () => {
    const home = await homeWith('sonarr', 'config.xml', 'secret-looking text');
    const found = await readKeyFile(home, 'sonarr', {
      path: 'config.xml',
      read: () => {
        throw new Error('bad: secret-looking text');
      },
    });
    expect(found).toEqual({
      found: 'unreadable',
      why: "its content isn't in a form Mediaplane understands",
    });
    expect(JSON.stringify(found)).not.toContain('secret-looking');
  });

  it.skipIf(process.getuid?.() === 0)(
    'says a file it may not read is unreadable, by its code alone',
    async () => {
      const home = await homeWith('sonarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
      await chmod(join(home, 'appdata', 'sonarr', 'config.xml'), 0o000);
      expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
        found: 'unreadable',
        why: 'it could not be read (EACCES)',
      });
      await chmod(join(home, 'appdata', 'sonarr'), 0o000);
      try {
        expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
          found: 'unreadable',
          why: 'it could not be read (EACCES)',
        });
      } finally {
        await chmod(join(home, 'appdata', 'sonarr'), 0o700);
      }
    },
  );

  it("reads a database's newest key of the name it asks for, read-only", async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: 'b'.repeat(32), created: '2026-10-26 06:09:30.39' },
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
      { name: 'Seerr', token: 'c'.repeat(32), created: '2026-10-27 00:00:00' },
    ]);
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
      found: 'key',
      value: KEY,
    });
    const none = await homeWithDatabase([
      { name: 'Seerr', token: 'c'.repeat(32), created: '2026-10-27 00:00:00' },
    ]);
    expect(await readKeyFile(none, 'jellyfin', DATABASE)).toEqual({ found: 'none' });
  });

  it('writes nothing beside a database closed cleanly, in WAL mode as Jellyfin keeps it', async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const folder = join(home, 'appdata', 'jellyfin', 'data');
    const wal = new DatabaseSync(join(folder, 'app.db'));
    wal.exec('PRAGMA journal_mode=WAL');
    wal.close();
    expect(await readdir(folder)).toEqual(['app.db']);
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
      found: 'key',
      value: KEY,
    });
    // A read-only open would have made app.db-shm and app.db-wal, as Mediaplane's user.
    expect(await readdir(folder)).toEqual(['app.db']);
  });

  it("reads a database in use, the app's write-ahead log too, making nothing", async () => {
    const home = await homeWithDatabase([]);
    const folder = join(home, 'appdata', 'jellyfin', 'data');
    const app = new DatabaseSync(join(folder, 'app.db'));
    try {
      // The app's key, only in its log yet: not checkpointed into the file.
      app.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
      app
        .prepare('INSERT INTO ApiKeys (DateCreated, Name, AccessToken) VALUES (?, ?, ?)')
        .run('2026-10-26 06:09:30.4', 'Mediaplane', KEY);
      const files = (await readdir(folder)).sort();
      expect(files).toEqual(['app.db', 'app.db-shm', 'app.db-wal']);
      expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
        found: 'key',
        value: KEY,
      });
      expect((await readdir(folder)).sort()).toEqual(files);
    } finally {
      app.close();
    }
  });

  it('reads the database it opened and checked, never one put in its place before SQLite opens it, a pipe included', async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const db = join(home, 'appdata', 'jellyfin', 'data', 'app.db');
    // A pipe in its place would hang SQLite's open, which doesn't wait without a writer.
    sqliteOpen.before = () => {
      renameSync(db, `${db}.aside`);
      execFileSync('mkfifo', [db]);
    };
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
      found: 'unreadable',
      why: 'it changed while it was being read',
    });
  });

  it('says a database that went, or left the folder, once open is unreadable, with no path', async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const db = join(home, 'appdata', 'jellyfin', 'data', 'app.db');
    sqliteOpen.after = () => {
      unlinkSync(db);
    };
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
      found: 'unreadable',
      why: 'it could not be read (ENOENT)',
    });
    // Moved out of the app's folder, and linked back in by another name of the same file.
    const moved = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const at = join(moved, 'appdata', 'jellyfin', 'data', 'app.db');
    sqliteOpen.after = () => {
      renameSync(at, join(moved, 'outside.db'));
      linkSync(join(moved, 'outside.db'), at);
    };
    expect(await readKeyFile(moved, 'jellyfin', DATABASE)).toEqual({
      found: 'unreadable',
      why: 'it leads outside appdata/jellyfin',
    });
  });

  it('never opens a database whose log or index is a link, and leaves what it leads to as it was', async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const folder = join(home, 'appdata', 'jellyfin', 'data');
    const wal = new DatabaseSync(join(folder, 'app.db'));
    wal.exec('PRAGMA journal_mode=WAL');
    wal.close();
    // Files of Mediaplane's own user, outside the app's folder.
    const outside = join(home, 'state-like.json');
    await writeFile(outside, '{"fake":"kept as it is"}\n');
    for (const [log, index] of [
      ['link', 'link'],
      ['link', 'file'],
      ['file', 'link'],
    ] as const) {
      for (const [suffix, kind] of [
        ['-wal', log],
        ['-shm', index],
      ] as const) {
        await rmIfThere(join(folder, `app.db${suffix}`));
        if (kind === 'link') await symlink(outside, join(folder, `app.db${suffix}`));
        else await writeFile(join(folder, `app.db${suffix}`), '');
      }
      expect(await readKeyFile(home, 'jellyfin', DATABASE)).toMatchObject({
        found: 'unreadable',
      });
      expect(await readFile(outside, 'utf8')).toBe('{"fake":"kept as it is"}\n');
    }
  });

  it('says a database without the ApiKeys table is unreadable, not "holds none"', async () => {
    const home = await tempDir('mediaplane-recover-');
    await mkdir(join(home, 'appdata', 'jellyfin', 'data'), { recursive: true });
    const db = new DatabaseSync(join(home, 'appdata', 'jellyfin', 'data', 'app.db'));
    db.exec('CREATE TABLE Other (Id INTEGER PRIMARY KEY)');
    db.close();
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toMatchObject({
      found: 'unreadable',
      why: expect.stringMatching(
        /^it could not be read as a database \(.*ApiKeys/,
      ) as string,
    });
  });

  it('says a database it can ask nothing of, or whose key is not text, is unreadable', async () => {
    const home = await homeWith('jellyfin', 'data/app.db', 'not a database');
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toMatchObject({
      found: 'unreadable',
      why: expect.stringMatching(/^it could not be read as a database \(/) as string,
    });
    const numbers = await homeWithDatabase([]);
    expect(
      await readKeyFile(numbers, 'jellyfin', {
        ...DATABASE,
        sqlite: { query: 'SELECT 7 AS AccessToken', column: 'AccessToken' },
      }),
    ).toEqual({ found: 'unreadable', why: "its AccessToken isn't text" });
  });
});

describe('recoverKeys', () => {
  it("recovers each key the store lacks from the apps' appdata, by app then name", async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: 'd'.repeat(32), created: '2026-10-26 06:00:00' },
    ]);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await writeFile(
      join(home, 'appdata', 'sonarr', 'config.xml'),
      `<ApiKey>${KEY}</ApiKey>`,
    );
    const stack = stackIn(home);
    expect(await recoverKeys(stack, emptySecretStore(), true)).toEqual({
      recovered: [
        { app: 'jellyfin', name: 'apiKey', value: 'd'.repeat(32) },
        { app: 'sonarr', name: 'apiKey', value: KEY },
      ],
      unfound: [],
      diagnostics: [],
    });
    // One the store holds is the store's.
    const held: SecretStore = {
      version: 1,
      apps: { sonarr: { apiKey: 'e'.repeat(32) } },
    };
    expect((await recoverKeys(stack, held, true)).recovered).toEqual([
      { app: 'jellyfin', name: 'apiKey', value: 'd'.repeat(32) },
    ]);
  });

  it('leaves a key to generate when no file holds it, or the file holds none', async () => {
    const stack = stackIn(await homeWith('sonarr', 'config.xml', '<Config/>'));
    expect(await recoverKeys(stack, emptySecretStore(), true)).toEqual({
      recovered: [],
      unfound: [],
      diagnostics: [],
    });
  });

  it('fails, naming the file and never the key, on a key it would generate but cannot keep', async () => {
    const home = await homeWith('sonarr', 'config.xml', '<ApiKey>not "a" key</ApiKey>');
    const { recovered, diagnostics } = await recoverKeys(
      stackIn(home),
      emptySecretStore(),
      false,
    );
    expect(recovered).toEqual([]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'keys.unrecoverable',
        message: expect.stringContaining(
          'state/secrets.json has no sonarr.apiKey, and appdata/sonarr/config.xml, where sonarr keeps it',
        ) as string,
        hint: expect.stringContaining('rebuilding-a-host.md') as string,
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('not "a" key');
  });

  it('words the failure by where the app takes its key from, and never says the key', async () => {
    const home = await homeWith('sonarr', 'config.xml', '<ApiKey>not "a" key</ApiKey>');
    // An app that takes no key from its environment: a new key would lock Mediaplane out.
    const kept = fixtureCatalog.map((app) =>
      app.id === 'sonarr'
        ? { ...app, credentials: [], keyFiles: { apiKey: CONFIG } }
        : app,
    );
    const result = resolveStack(fixtureConfig(STACK), kept, FIXTURE_HOST, home);
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    const own = await recoverKeys(result.stack, emptySecretStore(), false);
    expect(own.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(
        /A new key would lock Mediaplane out of sonarr, which still holds the old one$/,
      ),
    ]);
    // One it takes from its environment (the arrs, Seerr): the old key is still held by
    // the resources that use it.
    const env = await recoverKeys(stackIn(home), emptySecretStore(), false);
    expect(env.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(
        /The old key is still held by the resources that use it; a new key would break them$/,
      ),
    ]);
    expect(JSON.stringify([own, env])).not.toContain('not \\"a\\" key');
  });

  it("stops on a key file whose content its reader can't understand, rather than generate a key", async () => {
    const home = await homeWith('sonarr', 'config.xml', 'half a file');
    const strict = fixtureCatalog.map((app) =>
      app.id === 'sonarr'
        ? {
            ...app,
            keyFiles: {
              apiKey: {
                path: 'config.xml',
                read: () => {
                  throw new Error('not understood');
                },
              },
            },
          }
        : app,
    );
    const result = resolveStack(fixtureConfig(STACK), strict, FIXTURE_HOST, home);
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    const { diagnostics } = await recoverKeys(result.stack, emptySecretStore(), false);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'keys.unrecoverable',
        message: expect.stringContaining(
          "can't give it: its content isn't in a form Mediaplane understands",
        ) as string,
      }),
    ]);
  });

  it('fails on a key it would generate in a file it cannot read: a new one would not match the old', async () => {
    const home = await homeWith('sonarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    await mkdir(join(home, 'appdata', 'radarr'));
    await symlink(
      join(home, 'appdata', 'radarr'),
      join(home, 'appdata', 'sonarr', 'linked'),
    );
    const linked = fixtureCatalog.map((app) =>
      app.id === 'sonarr'
        ? { ...app, keyFiles: { apiKey: { ...CONFIG, path: 'linked/config.xml' } } }
        : app,
    );
    await writeFile(
      join(home, 'appdata', 'radarr', 'config.xml'),
      `<ApiKey>${KEY}</ApiKey>`,
    );
    const result = resolveStack(fixtureConfig(STACK), linked, FIXTURE_HOST, home);
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    const { diagnostics } = await recoverKeys(result.stack, emptySecretStore(), false);
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      [
        'error',
        "state/secrets.json has no sonarr.apiKey, and appdata/sonarr/linked/config.xml, where sonarr keeps it, can't give it: it leads outside appdata/sonarr. The old key is still held by the resources that use it; a new key would break them",
      ],
    ]);
  });

  it("warns of a key the app made that it can't find only when the admin password is new too", async () => {
    const home = await homeWithDatabase([]);
    const stack = stackIn(home);
    // With the password the app has, its setup signs in to find the key: nothing to say.
    expect(await recoverKeys(stack, emptySecretStore(), false)).toEqual({
      recovered: [],
      unfound: [],
      diagnostics: [],
    });
    const lost = await recoverKeys(stack, emptySecretStore(), true);
    expect(lost.unfound).toEqual(['jellyfin']);
    expect(lost.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'keys.unrecoverable',
        message:
          "state/secrets.json has no jellyfin.apiKey, and appdata/jellyfin/data/app.db, where jellyfin keeps it, can't give it: it holds none. The admin password is to be generated too, so apply can't sign in to jellyfin to find its key, and leaves jellyfin unwired",
      }),
    ]);
    // An app that isn't set up yet has no file: its setup makes the key.
    expect(
      await recoverKeys(
        stackIn(await tempDir('mediaplane-recover-')),
        emptySecretStore(),
        true,
      ),
    ).toEqual({ recovered: [], unfound: [], diagnostics: [] });
  });

  it('says nothing of a key the app made while its appdata says its wizard is open: its setup makes the admin, and finds the key', async () => {
    const home = await homeWithDatabase([]);
    const setUp = CATALOG.map((app) =>
      app.id === 'jellyfin' ? { ...app, bootstrap: FAKE_SETUP } : app,
    );
    const result = resolveStack(fixtureConfig(STACK), setUp, FIXTURE_HOST, home);
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    await writeFile(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'open\n');
    expect(await recoverKeys(result.stack, emptySecretStore(), true)).toEqual({
      recovered: [],
      unfound: [],
      diagnostics: [],
    });
    // Done, or a file it can't read: its setup only signs in, which can't be done.
    await writeFile(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
    expect(
      (await recoverKeys(result.stack, emptySecretStore(), true)).diagnostics.map(
        (d) => d.code,
      ),
    ).toEqual(['keys.unrecoverable']);
  });

  it("refuses a key that is another app's, stored or recovered, as keep does", async () => {
    // An app can hold another's key (Prowlarr holds the arrs'), but never as its own.
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:00:00' },
    ]);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await writeFile(
      join(home, 'appdata', 'sonarr', 'config.xml'),
      `<ApiKey>${KEY}</ApiKey>`,
    );
    const both = await recoverKeys(stackIn(home), emptySecretStore(), false);
    expect(both.recovered).toEqual([]);
    expect(both.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([
      [
        'error',
        'keys.unrecoverable',
        "state/secrets.json has no jellyfin.apiKey, and appdata/jellyfin/data/app.db, where jellyfin keeps it, can't give it: it holds the key Mediaplane holds for sonarr.apiKey",
      ],
      [
        'error',
        'keys.unrecoverable',
        "state/secrets.json has no sonarr.apiKey, and appdata/sonarr/config.xml, where sonarr keeps it, can't give it: it holds the key Mediaplane holds for jellyfin.apiKey",
      ],
    ]);
    expect(JSON.stringify(both)).not.toContain(KEY);
    // One the store holds for another app.
    const stored: SecretStore = { version: 1, apps: { radarr: { apiKey: KEY } } };
    const once = await recoverKeys(stackIn(home), stored, false);
    expect(once.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(
        /jellyfin\.apiKey.*for radarr\.apiKey, sonarr\.apiKey$/,
      ) as string,
      expect.stringMatching(
        /sonarr\.apiKey.*for jellyfin\.apiKey, radarr\.apiKey$/,
      ) as string,
    ]);
  });
});

describe('withRecoveredKeys', () => {
  it("adds each recovered key to a copy of the store, keeping the store's own", () => {
    const store: SecretStore = {
      version: 1,
      apps: { qbittorrent: { apiKey: 'qbt_fake' } },
      shared: { adminPassword: 'fake-admin-password' },
    };
    const added = withRecoveredKeys(store, [
      { app: 'sonarr', name: 'apiKey', value: KEY },
    ]);
    expect(added).toEqual({ ...store, apps: { ...store.apps, sonarr: { apiKey: KEY } } });
    expect(store.apps).toEqual({ qbittorrent: { apiKey: 'qbt_fake' } });
    expect(withRecoveredKeys(store, [])).toBe(store);
  });
});
