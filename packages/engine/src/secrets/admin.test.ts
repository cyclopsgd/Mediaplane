import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { adminLogin, adminPasswordToGenerate } from './admin';
import { emptySecretStore, type SecretStore } from './store';

const BASE = 'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\n';
const STORED: SecretStore = {
  version: 1,
  apps: {},
  shared: { adminPassword: 'fake-generated-password' },
};

describe('adminPasswordToGenerate', () => {
  it('is true until a password is stored, unless admin.password is set', () => {
    const generated = fixtureConfig(BASE);
    const yours = fixtureConfig(
      `${BASE}admin: { password: { file: secrets/admin-password } }\n`,
    );
    expect(adminPasswordToGenerate(generated, emptySecretStore())).toBe(true);
    expect(adminPasswordToGenerate(generated, STORED)).toBe(false);
    expect(adminPasswordToGenerate(yours, emptySecretStore())).toBe(false);
  });
});

describe('adminLogin', () => {
  it('uses the generated password', async () => {
    expect(await adminLogin(fixtureConfig(BASE), '/opt/mediaplane', STORED, {})).toEqual({
      username: 'admin',
      password: 'fake-generated-password',
    });
  });

  it('uses your own password from admin.password, over a stored one', async () => {
    const home = await tempDir('mediaplane-admin-');
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-own-password\n');
    const config = fixtureConfig(
      `${BASE}admin: { username: media-admin, password: { file: secrets/admin-password } }\n`,
    );
    expect(await adminLogin(config, home, STORED, {})).toEqual({
      username: 'media-admin',
      password: 'fake-own-password',
    });
  });

  it('throws while there is no password yet', async () => {
    await expect(
      adminLogin(fixtureConfig(BASE), '/opt/mediaplane', emptySecretStore(), {}),
    ).rejects.toThrow('the admin password is not available yet');
  });
});
