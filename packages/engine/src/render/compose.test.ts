import { describe, expect, it } from 'vitest';
import type { HostFacts } from '../host/facts';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { literal, renderCompose, secretEnvName } from './compose';
import { composeToYaml } from './yaml';

function stackOf(source: string, host: HostFacts = FIXTURE_HOST): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(source),
    fixtureCatalog,
    host,
    '/opt/mediaplane',
  );
  if (result.stack === undefined)
    throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.stack;
}

const JELLYFIN_VPN_LAN = `version: 1
timezone: Europe/London
paths: { data: /srv/data }
network: { bind: lan }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: { env: { EXTRA: x } }
  qbittorrent: {}
`;

const PLEX_NO_VPN_LOCALHOST = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { env: PLEX_TOKEN } }
apps:
  qbittorrent: { vpn: false, port: 8200 }
  sonarr: {}
  prowlarr: {}
`;

describe('golden files', () => {
  it('renders the Jellyfin + VPN + LAN stack', async () => {
    await expect(
      composeToYaml(renderCompose(stackOf(JELLYFIN_VPN_LAN))),
    ).toMatchFileSnapshot('./__golden__/jellyfin-vpn-lan.compose.yaml');
  });

  it('renders the Plex + no VPN + localhost stack', async () => {
    await expect(
      composeToYaml(renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST))),
    ).toMatchFileSnapshot('./__golden__/plex-no-vpn-localhost.compose.yaml');
  });

  it('renders identical output for identical input', () => {
    const render = () => composeToYaml(renderCompose(stackOf(JELLYFIN_VPN_LAN)));
    expect(render()).toBe(render());
  });
});

describe('renderCompose', () => {
  const compose = renderCompose(stackOf(JELLYFIN_VPN_LAN));

  it('escapes dollars in the image reference', () => {
    const stack = stackOf(JELLYFIN_VPN_LAN);
    const sonarr = stack.apps.find((a) => a.def.id === 'sonarr');
    if (sonarr === undefined) throw new Error('sonarr missing');
    sonarr.image = 'registry.test/sonarr:1$x';
    expect(renderCompose(stack).services.sonarr?.image).toBe('registry.test/sonarr:1$$x');
  });

  it('runs qBittorrent inside Gluetun and publishes its UI on Gluetun', () => {
    expect(compose.services.qbittorrent).toMatchObject({
      network_mode: 'service:gluetun',
      depends_on: { gluetun: { condition: 'service_healthy', restart: true } },
    });
    expect(compose.services.qbittorrent?.ports).toBeUndefined();
    expect(compose.services.gluetun?.ports).toEqual(['192.168.1.10:8080:8080']);
  });

  it('never publishes ports marked publish: false', () => {
    expect(JSON.stringify(compose)).not.toContain('6881');
  });

  it('references secrets instead of embedding them', () => {
    expect(compose.services.sonarr?.environment?.SONARR__AUTH__APIKEY).toBe(
      '${MP_SONARR_API_KEY}',
    );
  });

  it('escapes literal dollars and includes user env', () => {
    expect(compose.services.sonarr?.environment).toMatchObject({
      STATIC: 'a$$b',
      EXTRA: 'x',
    });
  });

  it('sets PUID/PGID only for images that use them', () => {
    expect(compose.services.sonarr?.environment).toMatchObject({
      PUID: '1000',
      PGID: '1000',
      TZ: 'Europe/London',
    });
    expect(compose.services.gluetun?.environment).toEqual({ TZ: 'Europe/London' });
  });

  it('sorts environment keys', () => {
    const keys = Object.keys(compose.services.sonarr?.environment ?? {});
    expect(keys).toEqual([...keys].sort());
  });

  it('mounts the app config dir and the shared data root', () => {
    expect(compose.services.sonarr?.volumes).toEqual([
      '/opt/mediaplane/appdata/sonarr:/config',
      '/srv/data:/data',
    ]);
  });

  it('renders health checks with defaults, and omits "image" and "none"', () => {
    expect(compose.services.sonarr?.healthcheck).toEqual({
      test: ['CMD', 'true'],
      interval: '30s',
      timeout: '10s',
      retries: 5,
      start_period: '60s',
    });
    expect(compose.services.gluetun?.healthcheck).toBeUndefined();
    expect(compose.services.jellyfin?.healthcheck).toBeUndefined();
  });

  it('labels every service as managed by Mediaplane', () => {
    expect(compose.services.jellyfin?.labels).toEqual({
      'io.mediaplane.app': 'jellyfin',
      'io.mediaplane.managed': 'true',
    });
  });

  it('publishes on every bind address', () => {
    const twoNics: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    expect(
      renderCompose(stackOf(JELLYFIN_VPN_LAN, twoNics)).services.jellyfin?.ports,
    ).toEqual(['10.0.0.5:8096:8096', '192.168.1.10:8096:8096']);
  });

  it('matches host and container port when the app requires it', () => {
    const plex = renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST));
    expect(plex.services.qbittorrent).toMatchObject({
      ports: ['127.0.0.1:8200:8200'],
      environment: { WEBUI_PORT: '8200' },
    });
    expect(plex.services.qbittorrent?.network_mode).toBeUndefined();
  });

  it('renders a user directive for user-directive apps', () => {
    expect(renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST)).services.byparr?.user).toBe(
      '1000:1000',
    );
  });

  it('renders extras such as capabilities', () => {
    expect(compose.services.gluetun?.cap_add).toEqual(['NET_ADMIN']);
  });
});

describe('secretEnvName', () => {
  it.each([
    ['sonarr', 'apiKey', 'MP_SONARR_API_KEY'],
    ['gluetun', 'wireguardKey', 'MP_GLUETUN_WIREGUARD_KEY'],
    ['my-app', 'token', 'MP_MY_APP_TOKEN'],
  ])('%s/%s → %s', (app, secret, expected) => {
    expect(secretEnvName(app, secret)).toBe(expected);
  });
});

describe('literal', () => {
  it('doubles every dollar sign', () => {
    expect(literal('a$b$$c')).toBe('a$$b$$$$c');
  });
});
