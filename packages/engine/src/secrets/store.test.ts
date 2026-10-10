import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRETS_PATH } from '../paths';
import {
  emptySecretStore,
  readSecretStore,
  writeSecretStore,
  type SecretStore,
} from './store';
import { tempDir } from '../testing/temp';

async function homeWithStore(content: string): Promise<string> {
  const home = await tempDir('mediaplane-store-');
  await mkdir(join(home, 'state'));
  await writeFile(join(home, SECRETS_PATH), content);
  return home;
}

/** What readSecretStore refuses with: the message, which must never hold a value. */
async function refusal(home: string): Promise<string> {
  try {
    await readSecretStore(home);
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('readSecretStore accepted the file');
}

describe('readSecretStore', () => {
  it('is empty when the file does not exist', async () => {
    const home = await tempDir('mediaplane-store-');
    expect(await readSecretStore(home)).toEqual(emptySecretStore());
  });

  it('reads a valid store', async () => {
    const store = { version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } };
    expect(await readSecretStore(await homeWithStore(JSON.stringify(store)))).toEqual(
      store,
    );
  });

  it('names the file, not its contents, when it is not JSON', async () => {
    const home = await homeWithStore('{"fake-secret-value"');
    const failure = readSecretStore(home);
    await expect(failure).rejects.toThrow(
      `${join(home, SECRETS_PATH)} is not valid JSON`,
    );
    await expect(failure).rejects.not.toThrow('fake-secret-value');
  });

  it('rejects a file with the wrong shape', async () => {
    const home = await homeWithStore('{"version": 2, "apps": {}}');
    await expect(readSecretStore(home)).rejects.toThrow(
      'is not a Mediaplane secrets file',
    );
  });

  it('refuses a key that would break the files it is written into, naming the entry, not the value', async () => {
    // A hand-edited key with a quote would land unescaped in config.xml or config.toml.
    const home = await homeWithStore(
      JSON.stringify({ version: 1, apps: { sonarr: { apiKey: 'fake"<key>' } } }),
    );
    const message = await refusal(home);
    expect(message).toContain(
      `${join(home, SECRETS_PATH)} is not a Mediaplane secrets file`,
    );
    expect(message).toContain('sonarr.apiKey');
    expect(message).not.toContain('fake"<key>');
    expect(message).not.toContain('fake');
  });

  it('refuses a key with a newline, and an empty one, naming the entry', async () => {
    for (const apiKey of ['fake\nkey', '']) {
      const home = await homeWithStore(
        JSON.stringify({ version: 1, apps: { radarr: { apiKey } } }),
      );
      const message = await refusal(home);
      expect(message).toContain('is not a Mediaplane secrets file');
      expect(message).toContain('radarr.apiKey');
      expect(message).not.toContain('fake');
    }
  });

  it('names every entry that is wrong, and none that is fine', async () => {
    const home = await homeWithStore(
      JSON.stringify({
        version: 1,
        apps: {
          gluetun: { controlApiKey: '0'.repeat(32) },
          qbittorrent: { apiKey: 'fake key with spaces' },
          sonarr: { apiKey: 'fake;key', other: 'fake-dash' },
        },
      }),
    );
    const message = await refusal(home);
    expect(message).toContain('qbittorrent.apiKey');
    expect(message).toContain('sonarr.apiKey');
    expect(message).toContain('sonarr.other');
    expect(message).not.toContain('gluetun');
    expect(message).not.toContain('fake');
  });

  it('names an entry that is not text, without showing it', async () => {
    const home = await homeWithStore(
      JSON.stringify({ version: 1, apps: { sonarr: { apiKey: 123456789 } } }),
    );
    const message = await refusal(home);
    expect(message).toContain('sonarr.apiKey');
    expect(message).not.toContain('123456789');
  });

  it('refuses an empty admin password, naming it', async () => {
    const home = await homeWithStore(
      JSON.stringify({ version: 1, apps: {}, shared: { adminPassword: '' } }),
    );
    const message = await refusal(home);
    expect(message).toContain('is not a Mediaplane secrets file');
    expect(message).toContain('shared.adminPassword');
  });

  it('keeps to the general message when no entry is at fault', async () => {
    const home = await homeWithStore('{"version": 2, "apps": {"sonarr": "fake-value"}}');
    const message = await refusal(home);
    expect(message).toBe(`${join(home, SECRETS_PATH)} is not a Mediaplane secrets file`);
  });

  it('reads every kind of key Mediaplane generates, and any admin password', async () => {
    const store: SecretStore = {
      version: 1,
      apps: {
        gluetun: { controlApiKey: '0'.repeat(32) },
        qbittorrent: { apiKey: `qbt_${'0'.repeat(28)}` },
        sonarr: { apiKey: 'aB'.repeat(16) },
      },
      // Hashed before any app sees it, so it needs no charset of its own.
      shared: { adminPassword: 'fake "admin" <password>' },
    };
    expect(await readSecretStore(await homeWithStore(JSON.stringify(store)))).toEqual(
      store,
    );
  });

  it('rejects an unknown shared secret', async () => {
    const home = await homeWithStore(
      '{"version": 1, "apps": {}, "shared": {"fake": "fake-value"}}',
    );
    await expect(readSecretStore(home)).rejects.toThrow(
      'is not a Mediaplane secrets file',
    );
  });
});

describe('writeSecretStore', () => {
  it('writes a sorted, private store that reads back', async () => {
    const home = await tempDir('mediaplane-store-');
    const store = {
      version: 1 as const,
      apps: {
        sonarr: { apiKey: '0'.repeat(32) },
        qbittorrent: { apiKey: `qbt_${'0'.repeat(28)}` },
      },
    };
    await writeSecretStore(home, store);
    expect(await readSecretStore(home)).toEqual(store);
    const text = await readFile(join(home, SECRETS_PATH), 'utf8');
    expect(text.indexOf('qbittorrent')).toBeLessThan(text.indexOf('sonarr'));
    expect((await stat(join(home, SECRETS_PATH))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'state'))).mode & 0o777).toBe(0o700);
  });

  it('keeps the shared admin password', async () => {
    const home = await tempDir('mediaplane-store-');
    const store: SecretStore = {
      version: 1,
      apps: { sonarr: { apiKey: '0'.repeat(32) } },
      shared: { adminPassword: 'fake-admin-password' },
    };
    await writeSecretStore(home, store);
    expect(await readSecretStore(home)).toEqual(store);
  });

  it('writes no shared block when it holds nothing', async () => {
    const home = await tempDir('mediaplane-store-');
    await writeSecretStore(home, { version: 1, apps: {}, shared: {} });
    expect(JSON.parse(await readFile(join(home, SECRETS_PATH), 'utf8'))).toEqual({
      version: 1,
      apps: {},
    });
  });

  it('never saves a key it could not read back, and keeps the store it had', async () => {
    // A key an app makes itself (createdBy: 'app') is kept as the app gives it: one with a
    // quote or a dash would make the next plan unable to read the store at all.
    const home = await tempDir('mediaplane-store-');
    const before: SecretStore = {
      version: 1,
      apps: { sonarr: { apiKey: '0'.repeat(32) } },
    };
    await writeSecretStore(home, before);
    const bad: SecretStore = {
      version: 1,
      apps: { ...before.apps, jellyfin: { apiKey: 'fake"app-key' } },
    };
    const failure = writeSecretStore(home, bad);
    await expect(failure).rejects.toThrow(
      `cannot save ${join(home, SECRETS_PATH)}: jellyfin.apiKey must be text of letters, digits and "_" only`,
    );
    await expect(failure).rejects.not.toThrow('fake"app-key');
    expect(await readSecretStore(home)).toEqual(before);
  });
});
