import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  emptySecretStore,
  parseConfig,
  readKeyFile,
  renderPrestartFiles,
  resolveStack,
  withGeneratedSecrets,
  type AppDefinition,
  type KeyFile,
} from '@mediaplane/engine';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from './index';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
`;

function app(id: string): AppDefinition {
  const found = catalog.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id} in the catalog`);
  return found;
}

/** The key file of `id`'s secret `name`, as text. */
function textKeyFile(id: string, name: string): Extract<KeyFile, { read: unknown }> {
  const file = app(id).keyFiles?.[name];
  if (file === undefined || !('read' in file))
    throw new Error(`${id}.${name}: no text file`);
  return file;
}

describe("the apps' key files (spec §6.1, key recovery)", () => {
  it('read back every key a pre-start file writes, from the file as Mediaplane writes it', () => {
    const parsed = parseConfig(STACK);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const { stack } = resolveStack(
      parsed.config,
      catalog,
      { arch: 'arm64', privateAddresses: [] },
      '/opt/mediaplane',
    );
    if (stack === undefined) throw new Error('the stack did not resolve');
    const { store } = withGeneratedSecrets(stack, emptySecretStore());
    const files = renderPrestartFiles(
      stack,
      store,
      { username: 'admin', password: 'fake-admin-password' },
      (size) => Buffer.alloc(size, 1),
    );
    const read: string[] = [];
    for (const file of files) {
      for (const [name, keyFile] of Object.entries(app(file.app).keyFiles ?? {})) {
        if (`appdata/${file.app}/${keyFile.path}` !== file.path) continue;
        expect('read' in keyFile && keyFile.read(file.content), file.path).toBe(
          store.apps[file.app]?.[name],
        );
        read.push(`${file.app}.${name}`);
      }
    }
    expect(read.sort()).toEqual([
      'gluetun.controlApiKey',
      'prowlarr.apiKey',
      'qbittorrent.apiKey',
      'radarr.apiKey',
      'sonarr.apiKey',
    ]);
  });

  it("covers every key Mediaplane generates or an app makes, but for one that isn't kept in a file", () => {
    const kept = catalog.flatMap((entry) =>
      Object.keys(entry.keyFiles ?? {}).map((name) => `${entry.id}.${name}`),
    );
    const keys = catalog.flatMap((entry) =>
      Object.entries(entry.secrets)
        .filter(([, source]) => !('userProvided' in source))
        .map(([name]) => `${entry.id}.${name}`),
    );
    expect(kept.sort()).toEqual(keys.sort());
    for (const entry of catalog) {
      for (const name of Object.keys(entry.keyFiles ?? {})) {
        expect(Object.keys(entry.secrets), `${entry.id}.${name}`).toContain(name);
      }
    }
  });

  it("reads Sonarr's, Radarr's and Prowlarr's from config.xml, as the app rewrites it", () => {
    const xml = `<Config>\n  <LogLevel>debug</LogLevel>\n  <ApiKey>${'a'.repeat(32)}</ApiKey>\n</Config>`;
    for (const id of ['sonarr', 'radarr', 'prowlarr']) {
      expect(textKeyFile(id, 'apiKey').read(xml)).toBe('a'.repeat(32));
      expect(textKeyFile(id, 'apiKey').read('<Config></Config>')).toBeUndefined();
    }
  });

  it("reads qBittorrent's from its WebUI\\APIKey line, line ends of either kind", () => {
    const file = textKeyFile('qbittorrent', 'apiKey');
    expect(file.path).toBe('qBittorrent/qBittorrent.conf');
    const conf = '[Preferences]\r\nWebUI\\APIKey=qbt_fake\r\nWebUI\\Address=*\r\n';
    expect(file.read(conf)).toBe('qbt_fake');
    expect(file.read(conf.replaceAll('\r', ''))).toBe('qbt_fake');
    expect(file.read('[Preferences]\nWebUI\\Address=*\n')).toBeUndefined();
  });

  it("reads Gluetun's from Mediaplane's own role only, never from a role of yours", () => {
    const file = textKeyFile('gluetun', 'controlApiKey');
    const yours = '[[roles]]\nname = "mine"\nauth = "apikey"\napikey = "yours"\n';
    const ours = `[[roles]]\nname = "mediaplane"\nroutes = ["GET /v1/vpn/status"]\nauth = "apikey"\napikey = "${'b'.repeat(32)}"\n`;
    expect(file.read(`${yours}\n${ours}`)).toBe('b'.repeat(32));
    expect(file.read(yours)).toBeUndefined();
  });

  it("reads Seerr's from main.apiKey in its settings.json, and fails on one it can't understand", () => {
    const file = textKeyFile('seerr', 'apiKey');
    expect(
      file.read(JSON.stringify({ main: { apiKey: 'c'.repeat(32), other: 1 } })),
    ).toBe('c'.repeat(32));
    expect(file.read(JSON.stringify({ main: {} }))).toBeUndefined();
    expect(file.read(JSON.stringify({}))).toBeUndefined();
    // Not JSON, not an object, or a key that isn't text: the file can't be read, which
    // readKeyFile says (fail closed), rather than "it holds none".
    expect(() => file.read('{ half')).toThrow();
    expect(() => file.read('[]')).toThrow();
    expect(() => file.read(JSON.stringify({ main: { apiKey: 7 } }))).toThrow();
    expect(() => file.read(JSON.stringify({ main: 'x' }))).toThrow();
  });

  it("says Seerr's settings.json it can't understand is unreadable, never without a key", async () => {
    const home = await tempDir('mediaplane-keys-');
    await mkdir(join(home, 'appdata', 'seerr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'seerr', 'settings.json'), '{ half');
    expect(await readKeyFile(home, 'seerr', textKeyFile('seerr', 'apiKey'))).toEqual({
      found: 'unreadable',
      why: "its content isn't in a form Mediaplane understands",
    });
  });

  it("reads Jellyfin's from its database: the newest key named Mediaplane, as its setup does", async () => {
    const home = await tempDir('mediaplane-keys-');
    const folder = join(home, 'appdata', 'jellyfin', 'data', 'data');
    await mkdir(folder, { recursive: true });
    // Jellyfin 12's own table, with dates as .NET writes them: trailing zeros dropped.
    const db = new DatabaseSync(join(folder, 'jellyfin.db'));
    db.exec(
      'CREATE TABLE ApiKeys (Id INTEGER PRIMARY KEY, DateCreated TEXT, DateLastActivity TEXT, Name TEXT, AccessToken TEXT)',
    );
    const insert = db.prepare(
      "INSERT INTO ApiKeys (DateCreated, DateLastActivity, Name, AccessToken) VALUES (?, '0001-01-01 00:00:00', ?, ?)",
    );
    insert.run('2026-10-26 06:09:30.3940168', 'Mediaplane', 'd'.repeat(32));
    insert.run('2026-10-26 06:09:30.4', 'Mediaplane', 'e'.repeat(32));
    insert.run('2026-10-27 06:09:30', 'Seerr', 'f'.repeat(32));
    db.close();
    const file = app('jellyfin').keyFiles?.apiKey;
    if (file === undefined) throw new Error("Jellyfin's key has no file");
    expect(await readKeyFile(home, 'jellyfin', file)).toEqual({
      found: 'key',
      value: 'e'.repeat(32),
    });
  });

  it("puts the key back in Sonarr's, Radarr's and Prowlarr's config.xml, first in <Config> when it has none", () => {
    const file = textKeyFile('sonarr', 'apiKey');
    const held = `<Config>\n  <ApiKey>${'a'.repeat(32)}</ApiKey>\n  <Port>8989</Port>\n</Config>\n`;
    expect(file.write?.(held, 'b'.repeat(32))).toBe(
      held.replace('a'.repeat(32), 'b'.repeat(32)),
    );
    expect(
      file.write?.('<Config>\n  <Port>8989</Port>\n</Config>\n', 'b'.repeat(32)),
    ).toBe(
      `<Config>\n  <ApiKey>${'b'.repeat(32)}</ApiKey>\n  <Port>8989</Port>\n</Config>\n`,
    );
    expect(file.write?.('<Settings />', 'b'.repeat(32))).toBeUndefined();
    for (const id of ['radarr', 'prowlarr']) {
      expect(textKeyFile(id, 'apiKey').write?.(held, 'b'.repeat(32))).toBe(
        file.write?.(held, 'b'.repeat(32)),
      );
    }
  });

  it("puts the key back in qBittorrent's file, in place, under [Preferences], or in a new section", () => {
    const file = textKeyFile('qbittorrent', 'apiKey');
    expect(
      file.write?.('[Preferences]\r\nWebUI\\APIKey=qbt_old\r\nA=1\r\n', 'qbt_new'),
    ).toBe('[Preferences]\r\nWebUI\\APIKey=qbt_new\r\nA=1\r\n');
    expect(
      file.write?.('[LegalNotice]\nAccepted=true\n\n[Preferences]\nA=1\n', 'qbt_new'),
    ).toBe('[LegalNotice]\nAccepted=true\n\n[Preferences]\nWebUI\\APIKey=qbt_new\nA=1\n');
    expect(file.write?.('[LegalNotice]\nAccepted=true', 'qbt_new')).toBe(
      '[LegalNotice]\nAccepted=true\n\n[Preferences]\nWebUI\\APIKey=qbt_new\n',
    );
    expect(file.write?.('', 'qbt_new')).toBe('[Preferences]\nWebUI\\APIKey=qbt_new\n');
  });

  it("puts Mediaplane's role back whole in Gluetun's file, after yours, which stay as they are", () => {
    const file = textKeyFile('gluetun', 'controlApiKey');
    const yours =
      '# my roles\n[[roles]]\nname = "mine"\nauth = "apikey"\napikey = "yours"\n';
    const ours = (key: string) =>
      `[[roles]]\nname = "mediaplane"\nroutes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]\nauth = "apikey"\napikey = "${key}"\n`;
    expect(file.write?.(yours, 'c'.repeat(32))).toBe(`${yours}\n${ours('c'.repeat(32))}`);
    // In its place: a role of Mediaplane's with another key, or routes of another's.
    const changed = `${ours('d'.repeat(32)).replace('GET /v1/publicip/ip', 'PUT /v1/vpn/status')}\n${yours}`;
    expect(file.write?.(changed, 'c'.repeat(32))).toBe(
      `${ours('c'.repeat(32))}\n${yours}`,
    );
    expect(file.write?.('', 'c'.repeat(32))).toBe(ours('c'.repeat(32)));
    expect(file.read(file.write?.(yours, 'c'.repeat(32)) ?? '')).toBe('c'.repeat(32));
  });

  it('puts back none of the keys an app takes from its environment, or keeps in a database', () => {
    expect('write' in textKeyFile('seerr', 'apiKey')).toBe(false);
    expect(app('jellyfin').keyFiles?.apiKey).not.toHaveProperty('write');
  });

  it('reads nothing from a file that is not there', async () => {
    const home = await tempDir('mediaplane-keys-');
    await writeFile(join(home, 'stack.yaml'), STACK);
    for (const entry of catalog) {
      for (const file of Object.values(entry.keyFiles ?? {})) {
        expect(await readKeyFile(home, entry.id, file)).toEqual({ found: 'absent' });
      }
    }
  });
});
