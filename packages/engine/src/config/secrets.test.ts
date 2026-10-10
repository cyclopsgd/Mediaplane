import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import type { StackConfig } from './schema';
import { checkSecretRefs, readSecret, secretRefs } from './secrets';
import { tempDir } from '../testing/temp';

async function homeWith(files: Record<string, string>): Promise<string> {
  const home = await tempDir('mediaplane-secrets-');
  await mkdir(join(home, 'secrets'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(home, 'secrets', name), content);
  }
  return home;
}

function configWith(extra: string, mediaServer = 'jellyfin'): StackConfig {
  const result = parseConfig(
    `version: 1\npaths: { data: /srv/data }\nmedia_server: ${mediaServer}\n${extra}`,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('readSecret', () => {
  it('reads and trims a file relative to the home directory', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key\n' });
    expect(await readSecret({ file: 'secrets/wg.key' }, home, {})).toBe('fake-key');
  });

  it('reads absolute paths as they are', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    const file = join(home, 'secrets', 'wg.key');
    expect(await readSecret({ file }, '/elsewhere', {})).toBe('fake-key');
  });

  it('treats missing and empty files as absent', async () => {
    const home = await homeWith({ empty: '  \n' });
    expect(await readSecret({ file: 'secrets/nope' }, home, {})).toBeUndefined();
    expect(await readSecret({ file: 'secrets/empty' }, home, {})).toBeUndefined();
  });

  it('reads environment variables', async () => {
    const env = { VPN_KEY: ' fake-env-key ' };
    expect(await readSecret({ env: 'VPN_KEY' }, '/', env)).toBe('fake-env-key');
    expect(await readSecret({ env: 'VPN_KEY' }, '/', {})).toBeUndefined();
  });

  it('treats env names that exist on Object.prototype as absent', async () => {
    expect(await readSecret({ env: 'constructor' }, '/', {})).toBeUndefined();
    expect(await readSecret({ env: 'toString' }, '/', {})).toBeUndefined();
  });
});

describe('secretRefs and checkSecretRefs', () => {
  const config = configWith(
    'admin: { password: { env: ADMIN_PASSWORD } }\n' +
      'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
  );

  it('finds every secret reference, in a fixed order', () => {
    expect(secretRefs(config).map((r) => r.path)).toEqual([
      'admin.password',
      'vpn.private_key',
    ]);
  });

  it('includes plex.token when Plex is the media server', async () => {
    const plexConfig = configWith(
      'admin: { password: { env: ADMIN_PASSWORD } }\n' +
        'plex: { token: { env: PLEX_TOKEN } }\n' +
        'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
      'plex',
    );
    expect(secretRefs(plexConfig).map((r) => r.path)).toEqual([
      'admin.password',
      'plex.token',
      'vpn.private_key',
    ]);
    expect(await checkSecretRefs(plexConfig, await homeWith({}), {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'secret.missing', path: 'plex.token' }),
      ]),
    );
  });

  it('ignores a dormant plex block when Jellyfin is the media server', async () => {
    const jellyfinConfig = configWith(
      'plex: { token: { env: PLEX_TOKEN } }\n' +
        'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
    );
    expect(secretRefs(jellyfinConfig).map((r) => r.path)).toEqual(['vpn.private_key']);
    // PLEX_TOKEN is unset, yet only the VPN key is reported.
    const diagnostics = await checkSecretRefs(jellyfinConfig, await homeWith({}), {});
    expect(diagnostics.map((d) => d.path)).toEqual(['vpn.private_key']);
  });

  it("includes references in enabled apps' env, ordered by app and name", () => {
    const envConfig = configWith(
      'apps:\n' +
        '  sonarr: { env: { B_TOKEN: { env: FAKE_B }, A_TOKEN: { file: secrets/a }, PLAIN: x } }\n' +
        '  radarr: { enabled: false, env: { C_TOKEN: { env: FAKE_C } } }\n',
    );
    expect(secretRefs(envConfig).map((r) => r.path)).toEqual([
      'apps.sonarr.env.A_TOKEN',
      'apps.sonarr.env.B_TOKEN',
    ]);
  });

  it('reports a missing env reference with its path', async () => {
    const envConfig = configWith(
      'apps:\n  sonarr: { env: { TOKEN: { env: FAKE_MISSING } } }\n',
    );
    expect(await checkSecretRefs(envConfig, await homeWith({}), {})).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'apps.sonarr.env.TOKEN' }),
    ]);
  });

  it('reports each missing secret with its stack.yaml path', async () => {
    expect(await checkSecretRefs(config, await homeWith({}), {})).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'admin.password' }),
      expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
    ]);
  });

  it('is quiet when every secret resolves', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    expect(
      await checkSecretRefs(config, home, { ADMIN_PASSWORD: 'fake-password' }),
    ).toEqual([]);
  });
});

describe('the admin password', () => {
  const config = configWith('admin: { password: { env: FAKE_ADMIN_PASSWORD } }\n');

  it('must be at least 12 characters, and the error never shows it', async () => {
    const diagnostics = await checkSecretRefs(config, await homeWith({}), {
      FAKE_ADMIN_PASSWORD: 'fake-short1',
    });
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        code: 'admin.password-too-short',
        message: 'admin.password is shorter than 12 characters',
        path: 'admin.password',
        hint: 'use a longer password, or leave admin.password out and Mediaplane generates one',
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('fake-short1');
  });

  it('may be exactly 12 characters', async () => {
    expect(
      await checkSecretRefs(config, await homeWith({}), {
        FAKE_ADMIN_PASSWORD: 'fake-twelve1',
      }),
    ).toEqual([]);
  });
});
