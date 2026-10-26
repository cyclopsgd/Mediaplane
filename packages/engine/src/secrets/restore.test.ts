import { chmod, link, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalog, KeyFile } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { planKeyRestores, restorableKeyFiles, restoreKeys } from './restore';
import type { SecretStore } from './store';

const KEY = 'a'.repeat(32);

/** A key file as qBittorrent's holds one: a line of its own, written back in place. */
const CONF: KeyFile = {
  path: 'app.conf',
  read: (text) => /^key=(.*)$/m.exec(text)?.[1],
  write: (text, key) =>
    /^key=/m.test(text)
      ? text.replace(/^key=.*$/m, () => `key=${key}`)
      : text.includes('[main]')
        ? text.replace('[main]', () => `[main]\nkey=${key}`)
        : undefined,
};

const CATALOG: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr'
    ? { ...app, keyFiles: { apiKey: CONF } }
    : app.id === 'jellyfin'
      ? // A key the app takes from its environment alone: nothing to write back.
        {
          ...app,
          secrets: { apiKey: { generate: 'hex32' } },
          keyFiles: { apiKey: { path: 'settings.json', read: () => 'other' } },
        }
      : app,
);

const STORE: SecretStore = {
  version: 1,
  apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
};

function stackIn(home: string): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(
      'version: 1\npaths: { data: /srv/data }\nnetwork: { bind: localhost }\nmedia_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n  sonarr: {}\n',
    ),
    CATALOG,
    FIXTURE_HOST,
    home,
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** A home whose Sonarr keeps `text` in appdata/sonarr/app.conf; the file's path. */
async function homeWith(text: string): Promise<{ home: string; path: string }> {
  const home = await tempDir('mediaplane-restore-');
  await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
  const path = join(home, 'appdata', 'sonarr', 'app.conf');
  await writeFile(path, text);
  return { home, path };
}

describe('planKeyRestores', () => {
  it('puts back a key the file holds another of, or none of, and leaves one it holds', async () => {
    for (const [text, restore] of [
      [`[main]\nkey=${'b'.repeat(32)}\n`, ['sonarr.apiKey']],
      ['[main]\nport=1\n', ['sonarr.apiKey']],
      [`[main]\nkey=${KEY}\n`, []],
    ] as const) {
      const { home } = await homeWith(text);
      expect(await planKeyRestores(stackIn(home), STORE), text).toEqual({
        restore,
        diagnostics: [],
      });
    }
  });

  it('says nothing of a file that is not there', async () => {
    const home = await tempDir('mediaplane-restore-');
    expect(await planKeyRestores(stackIn(home), STORE)).toEqual({
      restore: [],
      diagnostics: [],
    });
  });

  it("warns of a file it may not read, that it can't tell whether it holds the key", async () => {
    if (process.getuid?.() === 0) return;
    const { home, path } = await homeWith(`[main]\nkey=${KEY}\n`);
    await chmod(path, 0o000);
    const planned = await planKeyRestores(stackIn(home), STORE);
    expect(planned.restore).toEqual([]);
    expect(planned.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'keys.restore',
        message:
          "Mediaplane can't tell whether appdata/sonarr/app.conf holds Mediaplane's key for sonarr (sonarr.apiKey): it could not be read (EACCES)",
        hint: expect.stringContaining('run plan again') as string,
      },
    ]);
    expect(JSON.stringify(planned)).not.toContain(KEY);
  });

  it('puts back no key Mediaplane holds none of', async () => {
    const { home } = await homeWith('[main]\nport=1\n');
    expect(await planKeyRestores(stackIn(home), { version: 1, apps: {} })).toEqual({
      restore: [],
      diagnostics: [],
    });
  });

  it("warns of another key it can't put back, and fails on a missing one, saying why", async () => {
    const { home, path } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    await link(path, join(home, 'appdata', 'sonarr', 'other-name'));
    const other = await planKeyRestores(stackIn(home), STORE);
    expect(other.restore).toEqual([]);
    expect(other.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'keys.restore',
        message:
          "appdata/sonarr/app.conf holds another key than the one Mediaplane holds for sonarr (sonarr.apiKey), and Mediaplane can't put its key there: it has other names (hard links), which a rewrite would part from it",
        hint: expect.stringContaining(
          '"mediaplane keep sonarr.apiKey" keeps sonarr\'s own key instead',
        ) as string,
      },
    ]);
    const { home: unplaced } = await homeWith('port=1\n');
    expect((await planKeyRestores(stackIn(unplaced), STORE)).diagnostics).toEqual([
      {
        severity: 'error',
        code: 'keys.restore',
        message:
          "appdata/sonarr/app.conf lacks the key Mediaplane holds for sonarr (sonarr.apiKey), as a file from before Mediaplane seeded sonarr does, and Mediaplane can't put its key there: Mediaplane can't tell where in it the key goes",
        hint: expect.stringContaining('move appdata/sonarr/app.conf aside') as string,
      },
    ]);
    expect(JSON.stringify([other, unplaced])).not.toContain(KEY);
  });

  it("writes nothing for a key file that is a link, and warns it can't tell", async () => {
    const { home, path } = await homeWith('[main]\n');
    await writeFile(join(home, 'elsewhere.conf'), '[main]\n');
    await symlink(
      join(home, 'elsewhere.conf'),
      join(home, 'appdata', 'sonarr', 'linked'),
    );
    const linked = CATALOG.map((app) =>
      app.id === 'sonarr'
        ? { ...app, keyFiles: { apiKey: { ...CONF, path: 'linked' } } }
        : app,
    );
    const result = resolveStack(
      fixtureConfig(
        'version: 1\npaths: { data: /srv/data }\nnetwork: { bind: localhost }\nmedia_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n  sonarr: {}\n',
      ),
      linked,
      FIXTURE_HOST,
      home,
    );
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    // readKeyFile refuses a link at the file: plan can't tell, so puts nothing back and warns.
    expect(await planKeyRestores(result.stack, STORE)).toEqual({
      restore: [],
      diagnostics: [
        {
          severity: 'warning',
          code: 'keys.restore',
          message:
            "Mediaplane can't tell whether appdata/sonarr/linked holds Mediaplane's key for sonarr (sonarr.apiKey): it is a link, which is never followed",
          hint: expect.stringContaining('run plan again') as string,
        },
      ],
    });
    expect(await readFile(path, 'utf8')).toBe('[main]\n');
  });
});

describe('restorableKeyFiles', () => {
  it('lists each key file that says how to write its key back, by its path in the home', async () => {
    expect(restorableKeyFiles(stackIn(await tempDir('mediaplane-restore-')))).toEqual(
      new Set(['appdata/sonarr/app.conf']),
    );
  });
});

describe('restoreKeys', () => {
  it("puts the store's key back in the file, keeping the rest of it and its mode", async () => {
    const { home, path } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\nport=1\n`);
    await chmod(path, 0o640);
    expect(await restoreKeys(stackIn(home), STORE, ['sonarr.apiKey'])).toEqual([
      'sonarr.apiKey',
    ]);
    expect(await readFile(path, 'utf8')).toBe(`[main]\nkey=${KEY}\nport=1\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it('fails, naming the file and never the key, where it may not write it', async () => {
    const { home, path } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    await link(path, join(home, 'appdata', 'sonarr', 'other-name'));
    const failure = restoreKeys(stackIn(home), STORE, ['sonarr.apiKey']);
    await expect(failure).rejects.toThrow(
      'cannot put sonarr.apiKey back in appdata/sonarr/app.conf: it has other names (hard links), which a rewrite would part from it',
    );
    await expect(
      restoreKeys(stackIn(home), STORE, ['sonarr.apiKey']).catch((e: unknown) =>
        String(e),
      ),
    ).resolves.not.toContain(KEY);
    const { home: unplaced } = await homeWith('port=1\n');
    await expect(
      restoreKeys(stackIn(unplaced), STORE, ['sonarr.apiKey']),
    ).rejects.toThrow(
      "cannot put sonarr.apiKey back in appdata/sonarr/app.conf: Mediaplane can't tell where it goes",
    );
  });

  it('never writes through a link, nor in a folder that leads out of the app folder', async () => {
    const { home } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    const linked = (path: string): ResolvedStack => {
      const result = resolveStack(
        fixtureConfig(
          'version: 1\npaths: { data: /srv/data }\nnetwork: { bind: localhost }\nmedia_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n  sonarr: {}\n',
        ),
        CATALOG.map((app) =>
          app.id === 'sonarr' ? { ...app, keyFiles: { apiKey: { ...CONF, path } } } : app,
        ),
        FIXTURE_HOST,
        home,
      );
      if (result.stack === undefined) throw new Error('the stack did not resolve');
      return result.stack;
    };
    await symlink('app.conf', join(home, 'appdata', 'sonarr', 'linked.conf'));
    await expect(
      restoreKeys(linked('linked.conf'), STORE, ['sonarr.apiKey']),
    ).rejects.toThrow(
      'cannot put sonarr.apiKey back in appdata/sonarr/linked.conf: it is a link',
    );
    await mkdir(join(home, 'outside'));
    await writeFile(join(home, 'outside', 'app.conf'), '[main]\n');
    await symlink(join(home, 'outside'), join(home, 'appdata', 'sonarr', 'away'));
    await expect(
      restoreKeys(linked('away/app.conf'), STORE, ['sonarr.apiKey']),
    ).rejects.toThrow(
      'cannot put sonarr.apiKey back in appdata/sonarr/away/app.conf: a folder on its way leads outside appdata/sonarr',
    );
    expect(await readFile(join(home, 'outside', 'app.conf'), 'utf8')).toBe('[main]\n');
  });

  it('refuses a key it has no file or value for, which plan never names', async () => {
    const { home } = await homeWith('[main]\n');
    await expect(restoreKeys(stackIn(home), STORE, ['jellyfin.apiKey'])).rejects.toThrow(
      "jellyfin.apiKey can't be put back: Mediaplane has no file or key for it",
    );
    await expect(
      restoreKeys(stackIn(home), { version: 1, apps: {} }, ['sonarr.apiKey']),
    ).rejects.toThrow("sonarr.apiKey can't be put back");
  });

  it('says why a write that fails failed, by the path and its code', async () => {
    if (process.getuid?.() === 0) return;
    const { home } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    // The folder can be read, but not written: the temporary file can't be made.
    await chmod(join(home, 'appdata', 'sonarr'), 0o500);
    try {
      await expect(restoreKeys(stackIn(home), STORE, ['sonarr.apiKey'])).rejects.toThrow(
        `cannot put sonarr.apiKey back: cannot write ${join(home, 'appdata', 'sonarr', 'app.conf')} (EACCES)`,
      );
    } finally {
      await chmod(join(home, 'appdata', 'sonarr'), 0o700);
    }
  });
});
