import { describe, expect, it } from 'vitest';
import { STACK_SCHEMA_URL } from './json-schema';
import { parseConfig } from './load';
import { invokingUser, starterStack, type StarterAnswers } from './starter';

const ANSWERS: StarterAnswers = {
  mediaServer: 'jellyfin',
  dataPath: '/srv/data',
  vpnProvider: 'mullvad',
  vpnAddresses: undefined,
  loginOnLan: true,
  timezone: 'Europe/London',
  user: { uid: 1000, gid: 1000 },
  bind: 'lan',
  lanSubnet: undefined,
  adminUser: 'admin',
  adminPasswordFile: undefined,
};

function configOf(answers: StarterAnswers) {
  const result = parseConfig(starterStack(answers));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('starterStack', () => {
  it('writes a valid stack with the chosen media server, data folder and VPN', () => {
    const config = configOf(ANSWERS);
    expect(config).toMatchObject({
      timezone: 'Europe/London',
      paths: { data: '/srv/data' },
      network: { bind: 'lan' },
      security: { login_on_lan: true },
      media_server: 'jellyfin',
      vpn: { provider: 'mullvad', private_key: { file: 'secrets/wg.key' } },
    });
    expect(Object.keys(config.apps)).toEqual([
      'sonarr',
      'radarr',
      'prowlarr',
      'qbittorrent',
      'seerr',
    ]);
    expect(starterStack(ANSWERS)).toContain('# Mediaplane stack');
  });

  it('points editors at the published JSON Schema on its first line', () => {
    expect(starterStack(ANSWERS).split('\n')[0]).toBe(
      `# yaml-language-server: $schema=${STACK_SCHEMA_URL}`,
    );
  });

  it('points people at the generated stack.yaml reference', () => {
    expect(starterStack(ANSWERS).split('\n')).toContain(
      '# Reference: https://github.com/cyclopsgd/Mediaplane/blob/main/docs/reference/stack-yaml.md',
    );
  });

  it('turns the VPN off for qBittorrent when there is no provider', () => {
    const config = configOf({ ...ANSWERS, vpnProvider: undefined });
    expect(config.vpn).toBeUndefined();
    expect(config.apps.qbittorrent).toMatchObject({ vpn: false });
  });

  it('runs the apps as the given user', () => {
    expect(configOf({ ...ANSWERS, user: { uid: 1001, gid: 1002 } }).user).toEqual({
      uid: 1001,
      gid: 1002,
    });
  });

  it('points Plex at a token file', () => {
    expect(configOf({ ...ANSWERS, mediaServer: 'plex' }).plex).toEqual({
      token: { file: 'secrets/plex-token' },
    });
  });

  it('keeps unusual values intact', () => {
    const config = configOf({
      ...ANSWERS,
      dataPath: '/srv/my data #1',
      bind: 'localhost',
      loginOnLan: false,
    });
    expect(config.paths.data).toBe('/srv/my data #1');
    expect(config.network.bind).toBe('localhost');
    expect(config.security.login_on_lan).toBe(false);
  });

  it('writes the admin user, and leaves the password to Mediaplane', () => {
    const config = configOf(ANSWERS);
    expect(config.admin).toEqual({ username: 'admin' });
    expect(starterStack(ANSWERS)).toContain('# Mediaplane generates the password.');
  });

  it('points at your own password file when you have one', () => {
    const config = configOf({
      ...ANSWERS,
      adminUser: 'media-admin',
      adminPasswordFile: 'secrets/admin-password',
    });
    expect(config.admin).toEqual({
      username: 'media-admin',
      password: { file: 'secrets/admin-password' },
    });
  });

  it('writes the LAN subnet and the WireGuard address when given', () => {
    const config = configOf({
      ...ANSWERS,
      lanSubnet: '192.168.1.0/24',
      vpnAddresses: '10.64.0.2/32',
    });
    expect(config.network).toEqual({ bind: 'lan', lan_subnet: '192.168.1.0/24' });
    expect(config.vpn?.addresses).toBe('10.64.0.2/32');
  });
});

describe('invokingUser', () => {
  it('is whoever runs init', () => {
    expect(invokingUser({ uid: 1001, gid: 1002 })).toEqual({ uid: 1001, gid: 1002 });
  });

  it('is 1000 for root, or where there are no POSIX ids', () => {
    expect(invokingUser({ uid: 0, gid: 0 })).toEqual({ uid: 1000, gid: 1000 });
    expect(invokingUser({ uid: undefined, gid: undefined })).toEqual({
      uid: 1000,
      gid: 1000,
    });
  });
});
