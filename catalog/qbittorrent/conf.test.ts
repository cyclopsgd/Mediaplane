import {
  emptySecretStore,
  parseConfig,
  renderPrestartFiles,
  resolveStack,
  withGeneratedSecrets,
  type HostFacts,
  type PrestartFile,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { passwordHash } from './conf';

const HOST: HostFacts = {
  arch: 'arm64',
  privateAddresses: [{ address: '192.168.1.10', cidr: '192.168.1.10/24' }],
};

const ones = (size: number) => Buffer.alloc(size, 1);

/**
 * PBKDF2-HMAC-SHA512 of "fake-admin-password", 100 000 iterations, with ones(16) as the
 * salt, in qBittorrent's form. Python's hashlib.pbkdf2_hmac gives the same.
 */
const HASH =
  '@ByteArray(AQEBAQEBAQEBAQEBAQEBAQ==:r0Q4oywi3mIwU2ggkQH4pgel9HhG105YrlE2A7+LiLKEIkcSWnFrKqJON3yIWcdKS5arqTmYfUve8Xbfk0Aa/A==)';

/** A stack with qBittorrent (no VPN), and `lines` for its network and security. */
function resolveWith(lines: string, host: HostFacts = HOST) {
  const parsed = parseConfig(
    `version: 1\npaths: { data: /srv/data }\n${lines}media_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n`,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return resolveStack(parsed.config, catalog, host, '/opt/mediaplane');
}

/** qBittorrent's pre-start file for that stack: every key all zeros, the salt ones(16). */
function confFile(lines: string, host?: HostFacts): PrestartFile {
  const { stack, diagnostics } = resolveWith(lines, host);
  if (stack === undefined) throw new Error(JSON.stringify(diagnostics));
  const { store } = withGeneratedSecrets(stack, emptySecretStore(), (size) =>
    Buffer.alloc(size, 0),
  );
  const admin = { username: 'media-admin', password: 'fake-admin-password' };
  const file = renderPrestartFiles(stack, store, admin, ones).find(
    (rendered) => rendered.app === 'qbittorrent',
  );
  if (file === undefined) throw new Error('qBittorrent has no pre-start file');
  return file;
}

describe('passwordHash', () => {
  it("is PBKDF2-HMAC-SHA512 with 100 000 rounds, in qBittorrent's form", () => {
    expect(passwordHash('fake-admin-password', ones(16))).toBe(HASH);
  });
});

describe('qBittorrent.conf', () => {
  it('sets the shared login, the API key, the save path and automatic management', () => {
    const file = confFile('network: { bind: localhost }\n');
    expect(file.path).toBe('appdata/qbittorrent/qBittorrent/qBittorrent.conf');
    expect(file.content).toBe(
      [
        '[BitTorrent]',
        'Session\\DefaultSavePath=/data/torrents/',
        'Session\\DisableAutoTMMByDefault=false',
        '',
        '[LegalNotice]',
        'Accepted=true',
        '',
        '[Preferences]',
        'Connection\\UPnP=false',
        `WebUI\\APIKey=qbt_${'0'.repeat(28)}`,
        'WebUI\\Address=*',
        'WebUI\\AuthSubnetWhitelistEnabled=false',
        'WebUI\\LocalHostAuth=true',
        `WebUI\\Password_PBKDF2="${HASH}"`,
        'WebUI\\ServerDomains=*',
        'WebUI\\Username=media-admin',
        '',
      ].join('\n'),
    );
  });

  it('lets the LAN skip the login with login_on_lan: false and the web UI on the LAN', () => {
    const file = confFile('network: { bind: lan }\nsecurity: { login_on_lan: false }\n');
    expect(file.content).toContain(
      'WebUI\\AuthSubnetWhitelist=192.168.1.0/24\nWebUI\\AuthSubnetWhitelistEnabled=true\n',
    );
  });

  it.each([
    ['the default login_on_lan', ''],
    ['login_on_lan: true', 'security: { login_on_lan: true }\n'],
  ])(
    'asks the LAN to sign in with %s, even with the web UI on the LAN',
    (_name, security) => {
      const file = confFile(`network: { bind: lan }\n${security}`);
      expect(file.content).toContain('WebUI\\AuthSubnetWhitelistEnabled=false\n');
      expect(file.content).not.toContain('WebUI\\AuthSubnetWhitelist=');
    },
  );

  it('joins several subnets with a comma and no space', () => {
    const twoLans: HostFacts = {
      arch: 'arm64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const file = confFile(
      'network: { bind: lan }\nsecurity: { login_on_lan: false }\n',
      twoLans,
    );
    expect(file.content).toContain(
      'WebUI\\AuthSubnetWhitelist=10.0.0.0/24,192.168.1.0/24\n',
    );
  });

  it('asks everyone to sign in while the web UI is only on this machine', () => {
    const file = confFile(
      'network: { bind: localhost }\nsecurity: { login_on_lan: false }\n',
    );
    expect(file.content).toContain('WebUI\\AuthSubnetWhitelistEnabled=false\n');
    expect(file.content).not.toContain('WebUI\\AuthSubnetWhitelist=');
  });

  it("knows it after qBittorrent rewrites it, but not the image's own default", () => {
    const { seeded } = confFile('network: { bind: localhost }\n');
    expect(
      seeded.test('[Preferences]\nWebUI\\APIKey=qbt_rewritten\nWebUI\\Port=8080\n'),
    ).toBe(true);
    expect(
      seeded.test(
        '[LegalNotice]\nAccepted=true\n\n[Preferences]\nWebUI\\Address=*\nWebUI\\ServerDomains=*\n',
      ),
    ).toBe(false);
  });

  it('names the missing key, never the password, when the key was not generated', () => {
    const { stack } = resolveWith('network: { bind: localhost }\n');
    if (stack === undefined) throw new Error('the stack did not resolve');
    const admin = { username: 'media-admin', password: 'fake-admin-password' };
    expect(() => renderPrestartFiles(stack, emptySecretStore(), admin, ones)).toThrow(
      /^qbittorrent\.apiKey has not been generated yet$/,
    );
  });

  it('warns that the LAN must sign in when Mediaplane knows no LAN subnet', () => {
    const { diagnostics } = resolveWith(
      'network: { bind: all }\nsecurity: { login_on_lan: false }\n',
      { ...HOST, cloud: 'Oracle Cloud' },
    );
    expect(diagnostics).toContainEqual({
      severity: 'warning',
      code: 'network.no-lan-subnet',
      message:
        'security.login_on_lan is false, but Mediaplane knows no LAN subnet, so qBittorrent asks your LAN for a login too',
      path: 'network.lan_subnet',
      hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
    });
  });

  it.each([
    [
      'the login stays on for the LAN (the default)',
      'network: { bind: all }\n',
      { ...HOST, cloud: 'Oracle Cloud' },
    ],
    [
      'the web UI is only on this machine',
      'network: { bind: localhost }\nsecurity: { login_on_lan: false }\n',
      { ...HOST, cloud: 'Oracle Cloud' },
    ],
    [
      'Mediaplane knows the LAN subnet',
      'network: { bind: lan }\nsecurity: { login_on_lan: false }\n',
      HOST,
    ],
  ])('does not warn about the LAN subnet when %s', (_name, lines, host) => {
    const { diagnostics } = resolveWith(lines, host);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'network.no-lan-subnet',
    );
  });
});
