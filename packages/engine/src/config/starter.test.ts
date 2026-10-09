import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import { starterStack, type StarterAnswers } from './starter';

const ANSWERS: StarterAnswers = {
  mediaServer: 'jellyfin',
  dataPath: '/srv/data',
  vpnProvider: 'mullvad',
  loginOnLan: true,
  timezone: 'Europe/London',
  bind: 'lan',
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

  it('turns the VPN off for qBittorrent when there is no provider', () => {
    const config = configOf({ ...ANSWERS, vpnProvider: undefined });
    expect(config.vpn).toBeUndefined();
    expect(config.apps.qbittorrent).toMatchObject({ vpn: false });
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
});
