import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import type { StackConfig } from './schema';
import type { Catalog } from '../catalog/types';
import type { Diagnostic } from '../diagnostics';
import { fixtureApp } from '../testing/fixtures';
import { adminPasswordFloor, checkSecretRefs, readSecret, secretRefs } from './secrets';
import { tempDir } from '../testing/temp';

async function homeWith(files: Record<string, string>): Promise<string> {
  const home = await tempDir('mediaplane-secrets-');
  await mkdir(join(home, 'secrets'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(home, 'secrets', name), content);
  }
  return home;
}

/** qBittorrent takes no password shorter than 6 characters; the other apps take any. */
const catalog: Catalog = [
  fixtureApp({ id: 'qbittorrent', name: 'qBittorrent', adminPasswordMinLength: 6 }),
  fixtureApp({ id: 'sonarr', name: 'Sonarr' }),
];

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
    expect(await checkSecretRefs(plexConfig, await homeWith({}), {}, catalog)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'secret.missing',
          path: 'plex.token',
          hint: 'run "mediaplane plex-login": it signs you in to Plex, and saves your token where plex.token says',
        }),
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
    const diagnostics = await checkSecretRefs(
      jellyfinConfig,
      await homeWith({}),
      {},
      catalog,
    );
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
    expect(await checkSecretRefs(envConfig, await homeWith({}), {}, catalog)).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'apps.sonarr.env.TOKEN' }),
    ]);
  });

  it('reports each missing secret with its stack.yaml path', async () => {
    expect(await checkSecretRefs(config, await homeWith({}), {}, catalog)).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'admin.password' }),
      expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
    ]);
  });

  it('is quiet when every secret resolves', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    expect(
      await checkSecretRefs(config, home, { ADMIN_PASSWORD: 'fake-password' }, catalog),
    ).toEqual([]);
  });
});

describe('the admin password', () => {
  const config = configWith('admin: { password: { env: FAKE_ADMIN_PASSWORD } }\n');
  const check = async (
    stack: StackConfig,
    password: string,
    catalogOf: Catalog = catalog,
  ): Promise<Diagnostic[]> =>
    checkSecretRefs(
      stack,
      await homeWith({}),
      { FAKE_ADMIN_PASSWORD: password },
      catalogOf,
    );

  it('is only advised to have 12 characters: shorter is a warning, and the warning never shows it', async () => {
    const diagnostics = await check(config, 'fake-short1');
    expect(diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'admin.password-short',
        message: 'admin.password is shorter than the 12 characters advised',
        path: 'admin.password',
        hint: 'a short password suits a stack reached only from your own network; use a longer one if any app is reachable from the internet, or leave admin.password out and Mediaplane generates one',
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('fake-short1');
    expect(JSON.stringify(diagnostics)).not.toContain('11');
  });

  it('may be one character, when no app in the stack needs more', async () => {
    expect((await check(config, 'x')).map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'admin.password-short'],
    ]);
  });

  it('may be exactly 12 characters, with no warning', async () => {
    expect(await check(config, 'fake-twelve1')).toEqual([]);
  });

  it('is still missing when empty', async () => {
    expect((await check(config, '  ')).map((d) => d.code)).toEqual(['secret.missing']);
  });

  describe('with an app that takes no fewer than its own minimum', () => {
    const withQbittorrent = configWith(
      'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:\n  qbittorrent: {}\n  sonarr: {}\n',
    );

    it('is an error below that minimum, naming the app, and not the password', async () => {
      const diagnostics = await check(withQbittorrent, 'fake1');
      expect(diagnostics).toEqual([
        {
          severity: 'error',
          code: 'admin.password-too-short',
          message: 'qBittorrent takes a password of at least 6 characters',
          path: 'admin.password',
          hint: 'use a longer password, or leave admin.password out and Mediaplane generates one',
        },
      ]);
      expect(JSON.stringify(diagnostics)).not.toContain('fake1');
    });

    it('is only the 12-character warning from that minimum up', async () => {
      expect((await check(withQbittorrent, 'fake12')).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
      expect(await check(withQbittorrent, 'fake-twelve1')).toEqual([]);
    });

    it('names the app with the higher minimum when two have one', async () => {
      const both: Catalog = [
        fixtureApp({ id: 'qbittorrent', name: 'qBittorrent', adminPasswordMinLength: 6 }),
        fixtureApp({ id: 'sonarr', name: 'Sonarr', adminPasswordMinLength: 8 }),
      ];
      expect((await check(withQbittorrent, 'fake1', both))[0]?.message).toBe(
        'Sonarr takes a password of at least 8 characters',
      );
      expect((await check(withQbittorrent, 'fake123', both))[0]?.message).toBe(
        'Sonarr takes a password of at least 8 characters',
      );
    });

    it('ignores an app that is not in the stack, or is disabled', async () => {
      const without = configWith(
        'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:\n  qbittorrent: { enabled: false }\n  sonarr: {}\n',
      );
      expect((await check(without, 'fake1')).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
      expect((await check(config, 'fake1')).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
    });
  });
});

describe('adminPasswordFloor', () => {
  it('is the strictest minimum among the apps given, with its app', () => {
    expect(adminPasswordFloor(['sonarr', 'qbittorrent'], catalog)).toEqual({
      name: 'qBittorrent',
      min: 6,
    });
    expect(adminPasswordFloor(['sonarr'], catalog)).toBeUndefined();
    expect(adminPasswordFloor([], catalog)).toBeUndefined();
  });
});
