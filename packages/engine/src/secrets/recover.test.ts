import { chmod, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Catalog, KeyFile } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { readKeyFile, recoverKeys, withRecoveredKeys } from './recover';
import { emptySecretStore, type SecretStore } from './store';

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

  it('never reads through a link that leads out of the app folder', async () => {
    const home = await homeWith('radarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await symlink(
      join(home, 'appdata', 'radarr', 'config.xml'),
      join(home, 'appdata', 'sonarr', 'config.xml'),
    );
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'unreadable',
      why: 'it leads outside appdata/sonarr',
    });
    // A link to nothing exists, and can't be read.
    await symlink(join(home, 'nowhere'), join(home, 'appdata', 'radarr', 'other.xml'));
    expect(
      await readKeyFile(home, 'radarr', { ...CONFIG, path: 'other.xml' }),
    ).toMatchObject({ found: 'unreadable' });
  });

  it('reads through a link that stays inside the app folder', async () => {
    const home = await homeWith('sonarr', 'old.xml', `<ApiKey>${KEY}</ApiKey>`);
    await symlink('old.xml', join(home, 'appdata', 'sonarr', 'config.xml'));
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'key',
      value: KEY,
    });
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

  it('fails on a key it would generate in a file it cannot read: a new one would lock it out', async () => {
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
        "state/secrets.json has no sonarr.apiKey, and appdata/sonarr/linked/config.xml, where sonarr keeps it, can't give it: it leads outside appdata/sonarr. A new key would lock Mediaplane out of sonarr, which still holds the old one",
      ],
    ]);
  });

  it("warns of a key the app made that it can't find only when the admin password is new too", async () => {
    const home = await homeWithDatabase([]);
    const stack = stackIn(home);
    // With the password the app has, its setup signs in to find the key: nothing to say.
    expect(await recoverKeys(stack, emptySecretStore(), false)).toEqual({
      recovered: [],
      diagnostics: [],
    });
    const lost = await recoverKeys(stack, emptySecretStore(), true);
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
    ).toEqual({ recovered: [], diagnostics: [] });
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
