import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRETS_PATH } from '../paths';
import { emptySecretStore, readSecretStore } from './store';

async function homeWithStore(content: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-store-'));
  await mkdir(join(home, 'state'));
  await writeFile(join(home, SECRETS_PATH), content);
  return home;
}

describe('readSecretStore', () => {
  it('is empty when the file does not exist', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-store-'));
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
});
