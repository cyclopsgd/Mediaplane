import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import type { StackConfig } from './schema';
import type { Catalog } from '../catalog/types';
import type { Diagnostic } from '../diagnostics';
import { fixtureApp } from '../testing/fixtures';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  adminPasswordFloor,
  checkSecretRefs,
  readSecret,
  secretRefs,
} from './secrets';
import { tempDir } from '../testing/temp';

async function homeWith(files: Record<string, string>): Promise<string> {
  const home = await tempDir('mediaplane-secrets-');
  await mkdir(join(home, 'secrets'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(home, 'secrets', name), content);
  }
  return home;
}

/** qBittorrent takes no password shorter than 6 characters, the fewest Mediaplane takes. */
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

  it('is refused below 6 characters in any stack, never showing the password or its length', async () => {
    // A stack without qBittorrent: the 6 is Mediaplane's own, not an app's.
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(6);
    for (const password of ['x', 'fake1']) {
      const diagnostics = await check(config, password);
      expect(diagnostics).toEqual([
        {
          severity: 'error',
          code: 'admin.password-too-short',
          message:
            'admin.password is shorter than 6 characters, the fewest Mediaplane takes',
          path: 'admin.password',
          hint: 'use 6 characters or more, or leave admin.password out and Mediaplane generates one',
        },
      ]);
      expect(JSON.stringify(diagnostics)).not.toContain(password);
    }
  });

  it('may be exactly 6 characters, with the 12-character warning', async () => {
    expect((await check(config, 'fake12')).map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'admin.password-short'],
    ]);
  });

  it('may be exactly 12 characters, with no warning', async () => {
    expect(await check(config, 'fake-twelve1')).toEqual([]);
  });

  it('is still missing when empty', async () => {
    expect((await check(config, '  ')).map((d) => d.code)).toEqual(['secret.missing']);
  });

  describe('with qBittorrent in the stack', () => {
    const withQbittorrent = configWith(
      'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:\n  qbittorrent: {}\n  sonarr: {}\n',
    );

    it('is refused below 6 characters, as everywhere', async () => {
      const diagnostics = await check(withQbittorrent, 'fake1');
      expect(diagnostics.map((d) => d.code)).toEqual(['admin.password-too-short']);
      expect(diagnostics[0]?.message).toBe(
        'admin.password is shorter than 6 characters, the fewest Mediaplane takes',
      );
      expect(JSON.stringify(diagnostics)).not.toContain('fake1');
    });

    it('is only the 12-character warning from 6 characters up', async () => {
      expect((await check(withQbittorrent, 'fake12')).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
      expect(await check(withQbittorrent, 'fake-twelve1')).toEqual([]);
    });
  });

  describe('with an app that needs more than 6 characters', () => {
    const needs8: Catalog = [
      fixtureApp({ id: 'qbittorrent', name: 'qBittorrent', adminPasswordMinLength: 6 }),
      fixtureApp({ id: 'sonarr', name: 'Sonarr', adminPasswordMinLength: 8 }),
    ];
    const withSonarr = configWith(
      'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:\n  qbittorrent: {}\n  sonarr: {}\n',
    );

    it('names that app, below its minimum, and not the password', async () => {
      for (const password of ['fake1', 'fake123']) {
        const diagnostics = await check(withSonarr, password, needs8);
        expect(diagnostics).toEqual([
          {
            severity: 'error',
            code: 'admin.password-too-short',
            message: 'Sonarr takes a password of at least 8 characters',
            path: 'admin.password',
            hint: 'use 8 characters or more, or leave admin.password out and Mediaplane generates one',
          },
        ]);
        expect(JSON.stringify(diagnostics)).not.toContain(password);
      }
    });

    it('is only the 12-character warning from that minimum up', async () => {
      expect((await check(withSonarr, 'fake1234', needs8)).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
    });

    it('ignores an app that is not in the stack, or is disabled', async () => {
      const without = configWith(
        'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:\n  sonarr: { enabled: false }\n',
      );
      expect((await check(without, 'fake123', needs8)).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
      expect((await check(config, 'fake123', needs8)).map((d) => d.code)).toEqual([
        'admin.password-short',
      ]);
    });
  });
});

describe('adminPasswordFloor', () => {
  it('is 6 characters, with no app named, when no app needs more', () => {
    expect(adminPasswordFloor(['sonarr', 'qbittorrent'], catalog)).toEqual({ min: 6 });
    expect(adminPasswordFloor(['sonarr'], catalog)).toEqual({ min: 6 });
    expect(adminPasswordFloor([], catalog)).toEqual({ min: 6 });
  });

  it('is the strictest minimum above 6 among the apps given, with its app', () => {
    const catalogOf: Catalog = [
      fixtureApp({ id: 'qbittorrent', name: 'qBittorrent', adminPasswordMinLength: 6 }),
      fixtureApp({ id: 'sonarr', name: 'Sonarr', adminPasswordMinLength: 8 }),
      fixtureApp({ id: 'radarr', name: 'Radarr', adminPasswordMinLength: 10 }),
    ];
    expect(adminPasswordFloor(['sonarr', 'qbittorrent'], catalogOf)).toEqual({
      name: 'Sonarr',
      min: 8,
    });
    expect(adminPasswordFloor(['sonarr', 'radarr'], catalogOf)).toEqual({
      name: 'Radarr',
      min: 10,
    });
    expect(adminPasswordFloor(['qbittorrent'], catalogOf)).toEqual({ min: 6 });
  });
});
