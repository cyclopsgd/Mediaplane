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

  it('refuses a key that would break the files it is written into, naming only the path', async () => {
    // A hand-edited key with a quote would land unescaped in config.xml or config.toml.
    const home = await homeWithStore(
      JSON.stringify({ version: 1, apps: { sonarr: { apiKey: 'fake"<key>' } } }),
    );
    const failure = readSecretStore(home);
    await expect(failure).rejects.toThrow(
      `${join(home, SECRETS_PATH)} is not a Mediaplane secrets file`,
    );
    await expect(failure).rejects.not.toThrow('fake"<key>');
  });

  it('refuses a key with a newline, and an empty one', async () => {
    for (const apiKey of ['fake\nkey', '']) {
      const home = await homeWithStore(
        JSON.stringify({ version: 1, apps: { sonarr: { apiKey } } }),
      );
      await expect(readSecretStore(home)).rejects.toThrow(
        'is not a Mediaplane secrets file',
      );
    }
  });

  it('refuses an empty admin password', async () => {
    const home = await homeWithStore(
      JSON.stringify({ version: 1, apps: {}, shared: { adminPassword: '' } }),
    );
    await expect(readSecretStore(home)).rejects.toThrow(
      'is not a Mediaplane secrets file',
    );
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
});
