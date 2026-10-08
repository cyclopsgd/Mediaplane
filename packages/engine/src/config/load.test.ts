import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../diagnostics';
import { loadConfigFile, parseConfig } from './load';

const MINIMAL = `version: 1
paths: { data: /srv/data }
media_server: jellyfin
`;

/** The example from docs/design/m1-engine-cli.md §4.2, without comments. */
const SPEC_EXAMPLE = `version: 1
timezone: Europe/London
user: { uid: 1000, gid: 1000 }
paths: { data: /srv/data }
network: { bind: lan, lan_subnet: 192.168.1.0/24 }
security: { login_on_lan: true }
admin: { username: admin }
media_server: jellyfin
plex: { token: { file: secrets/plex-token } }
vpn:
  provider: mullvad
  private_key: { file: secrets/wg.key }
  addresses: 10.64.0.2/32
apps:
  sonarr: {}
  radarr: { port: 7879 }
  prowlarr: {}
  qbittorrent: { vpn: true }
  seerr: {}
  byparr: {}
overrides:
  sonarr.download_client.category: television
`;

function diagnosticsOf(source: string): Diagnostic[] {
  const result = parseConfig(source);
  if (result.ok) throw new Error('expected parseConfig to fail');
  return result.diagnostics;
}

describe('parseConfig', () => {
  it('fills in defaults for a minimal file', () => {
    expect(parseConfig(MINIMAL)).toEqual({
      ok: true,
      config: {
        version: 1,
        timezone: 'Etc/UTC',
        user: { uid: 1000, gid: 1000 },
        paths: { data: '/srv/data' },
        network: { bind: 'lan' },
        security: { login_on_lan: true },
        admin: { username: 'admin' },
        media_server: 'jellyfin',
        apps: {},
        overrides: {},
        managed_by: 'mediaplane',
      },
    });
  });

  it('accepts the design-spec example', () => {
    expect(parseConfig(SPEC_EXAMPLE).ok).toBe(true);
  });

  it('keeps app-specific options for the resolver to validate', () => {
    const result = parseConfig(
      `${MINIMAL}apps:\n  qbittorrent: { vpn: false, port: 8200 }\n`,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.config.apps.qbittorrent).toEqual({
      enabled: true,
      env: {},
      port: 8200,
      vpn: false,
    });
  });

  it('rejects inline secrets with an explanation', () => {
    const [diagnostic] = diagnosticsOf(
      `${MINIMAL}vpn: { provider: mullvad, private_key: "fake-inline-key" }\n`,
    );
    expect(diagnostic).toMatchObject({
      severity: 'error',
      code: 'config.invalid',
      path: 'vpn.private_key',
    });
    expect(diagnostic?.message).toContain('inline secrets are not allowed');
  });

  it('suggests the closest key for an unknown top-level key', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}tmezone: Europe/London\n`);
    expect(diagnostic).toMatchObject({
      code: 'config.unknown-key',
      path: 'tmezone',
      hint: 'did you mean "timezone"?',
    });
  });

  it('reports unknown nested keys with their full path', () => {
    const [diagnostic] = diagnosticsOf(
      MINIMAL.replace(
        'paths: { data: /srv/data }',
        'paths: { data: /srv/data, media: /x }',
      ),
    );
    expect(diagnostic).toMatchObject({ code: 'config.unknown-key', path: 'paths.media' });
  });

  it('requires a Plex token when the media server is Plex', () => {
    const [diagnostic] = diagnosticsOf(MINIMAL.replace('jellyfin', 'plex'));
    expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'plex' });
  });

  it('rejects relative data paths and malformed subnets', () => {
    const paths = diagnosticsOf(
      `${MINIMAL.replace('/srv/data', 'srv/data')}network: { lan_subnet: 192.168.1.0 }\n`,
    ).map((d) => d.path);
    expect(paths).toEqual(['paths.data', 'network.lan_subnet']);
  });

  it('explains a malformed override key', () => {
    const [diagnostic] = diagnosticsOf(
      `${MINIMAL}overrides:\n  Sonarr.download_client.category: television\n`,
    );
    expect(diagnostic).toMatchObject({
      severity: 'error',
      code: 'config.invalid',
      path: 'overrides.Sonarr.download_client.category',
    });
    expect(diagnostic?.message).toContain('override keys look like');
    expect(diagnostic?.message).not.toContain('Invalid key in record');
  });

  it('rejects override keys with more than three segments', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}overrides:\n  sonarr.a.b.c: x\n`);
    expect(diagnostic).toMatchObject({
      code: 'config.invalid',
      path: 'overrides.sonarr.a.b.c',
    });
    expect(diagnostic?.message).toContain('override keys look like');
  });

  it('accepts camelCase field names and two-segment override keys', () => {
    const result = parseConfig(
      `${MINIMAL}overrides:\n  prowlarr.app_link.syncLevel: addOnly\n  sonarr.download_client: unmanaged\n`,
    );
    if (!result.ok) throw new Error('expected success');
    expect(result.config.overrides).toEqual({
      'prowlarr.app_link.syncLevel': 'addOnly',
      'sonarr.download_client': 'unmanaged',
    });
  });

  it('explains a non-scalar override value', () => {
    const [diagnostic] = diagnosticsOf(
      `${MINIMAL}overrides:\n  sonarr.download_client: { x: 1 }\n`,
    );
    expect(diagnostic).toMatchObject({
      code: 'config.invalid',
      path: 'overrides.sonarr.download_client',
    });
    expect(diagnostic?.message).toContain('override values must be');
  });

  it('explains a malformed environment variable name', () => {
    const [diagnostic] = diagnosticsOf(
      `${MINIMAL}apps:\n  sonarr:\n    env:\n      1BAD: x\n`,
    );
    expect(diagnostic).toMatchObject({
      code: 'config.invalid',
      path: 'apps.sonarr.env.1BAD',
    });
    expect(diagnostic?.message).toContain('environment variable names');
  });

  it('reports YAML syntax errors with their position', () => {
    const [diagnostic] = diagnosticsOf('version: 1\npaths: { data: /srv/data\n');
    expect(diagnostic?.code).toBe('config.yaml-syntax');
    expect(diagnostic?.message).toMatch(/line \d+/);
  });

  it('rejects duplicate keys', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}apps:\n  sonarr: {}\n  sonarr: {}\n`);
    expect(diagnostic?.code).toBe('config.yaml-syntax');
  });
});

describe('loadConfigFile', () => {
  it('explains a missing file', async () => {
    expect(await loadConfigFile('/nonexistent/mediaplane/stack.yaml')).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('reads and parses a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-config-'));
    await writeFile(join(dir, 'stack.yaml'), MINIMAL);
    expect((await loadConfigFile(join(dir, 'stack.yaml'))).ok).toBe(true);
  });
});
