import { describe, expect, it } from 'vitest';
import type { HostFacts } from '../host/facts';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { resolveStack, type ResolveResult } from './resolve';

const BASE = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
`;

function resolve(
  apps: string,
  { base = BASE, host = FIXTURE_HOST }: { base?: string; host?: HostFacts } = {},
): ResolveResult {
  const config = fixtureConfig(`${base}apps:\n${apps}`);
  return resolveStack(config, fixtureCatalog, host, '/opt/mediaplane');
}
const ids = (result: ResolveResult) => result.stack?.apps.map((app) => app.def.id);
const codes = (result: ResolveResult) => result.diagnostics.map((d) => d.code);
const app = (result: ResolveResult, id: string) =>
  result.stack?.apps.find((a) => a.def.id === id);

describe('resolveStack: which apps run', () => {
  it('adds the media server and implied apps, sorted by id', () => {
    const result = resolve('  sonarr: {}\n  qbittorrent: {}\n  prowlarr: {}\n');
    expect(result.diagnostics).toEqual([]);
    expect(ids(result)).toEqual([
      'byparr',
      'gluetun',
      'jellyfin',
      'prowlarr',
      'qbittorrent',
      'sonarr',
    ]);
  });

  it('does not add an implied app the user disabled', () => {
    expect(ids(resolve('  prowlarr: {}\n  byparr: { enabled: false }\n'))).toEqual([
      'jellyfin',
      'prowlarr',
    ]);
  });

  it('does not add an implied app when another app already provides its exclusive capability', () => {
    expect(ids(resolve('  prowlarr: {}\n  flaresolverr: {}\n'))).toEqual([
      'flaresolverr',
      'jellyfin',
      'prowlarr',
    ]);
  });

  it('rejects unknown apps with a suggestion', () => {
    const result = resolve('  sonar: {}\n');
    expect(result.stack).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.unknown',
        path: 'apps.sonar',
        hint: 'did you mean "sonarr"?',
      }),
    );
  });

  it('rejects a second media server', () => {
    expect(codes(resolve('  plex: {}\n'))).toContain('app.media-server-conflict');
  });

  it('rejects disabling the chosen media server', () => {
    expect(codes(resolve('  jellyfin: { enabled: false }\n'))).toContain(
      'app.media-server-disabled',
    );
  });
});

describe('resolveStack: options and checks', () => {
  it('validates app-specific options', () => {
    expect(resolve('  qbittorrent: { vnp: true }\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.unknown-option',
        path: 'apps.qbittorrent.vnp',
      }),
    );
    expect(resolve('  qbittorrent: { vpn: "yes" }\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.invalid-option',
        path: 'apps.qbittorrent.vpn',
      }),
    );
  });

  it('runs app validation hooks', () => {
    const noVpn = BASE.replace(/^vpn:.*\n/m, '');
    expect(codes(resolve('  qbittorrent: {}\n', { base: noVpn }))).toContain(
      'vpn.missing',
    );
  });

  it('rejects apps without an image for the host architecture', () => {
    const result = resolve('  flaresolverr: {}\n', {
      host: { ...FIXTURE_HOST, arch: 'arm64' },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.unsupported-arch',
        path: 'apps.flaresolverr',
      }),
    );
  });

  it('requires capabilities and names the apps that provide them', () => {
    expect(resolve('  sonarr: {}\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.missing-capability',
        hint: 'enable one of: qbittorrent',
      }),
    );
  });

  it('rejects two providers of an exclusive capability', () => {
    expect(codes(resolve('  byparr: {}\n  flaresolverr: {}\n'))).toContain(
      'app.conflict',
    );
  });

  it('rejects a network-namespace host that is disabled', () => {
    expect(
      codes(resolve('  qbittorrent: {}\n  gluetun: { enabled: false }\n')),
    ).toContain('app.network-via-missing');
  });

  it('protects env vars that carry Mediaplane secrets', () => {
    const result = resolve(
      '  qbittorrent: {}\n  sonarr: { env: { SONARR__AUTH__APIKEY: x } }\n',
    );
    expect(codes(result)).toContain('app.env-reserved');
  });

  it('reports a listed and implied app with invalid options once, without cascading errors', () => {
    const result = resolve('  qbittorrent: {}\n  gluetun: { fo: 1 }\n');
    expect(codes(result)).toEqual(['app.unknown-option']);
    expect(result.diagnostics[0]?.path).toBe('apps.gluetun.fo');
    expect(result.stack).toBeUndefined();
  });

  it('still counts an app with invalid options as a provider of its capabilities', () => {
    const result = resolve('  sonarr: {}\n  qbittorrent: { vpn: "yes" }\n');
    expect(codes(result)).toEqual(['app.invalid-option']);
    expect(result.stack).toBeUndefined();
  });
});

describe('resolveStack: ports and images', () => {
  it('publishes the primary port on the requested host port', () => {
    const result = resolve('  qbittorrent: {}\n  sonarr: { port: 9000 }\n');
    expect(app(result, 'sonarr')?.ports).toEqual([
      { app: 'sonarr', name: 'web', host: 9000, container: 8989, protocol: 'tcp' },
    ]);
  });

  it('moves the container port too when host and container must match', () => {
    const qbittorrent = app(resolve('  qbittorrent: { port: 8200 }\n'), 'qbittorrent');
    expect(qbittorrent?.ports).toEqual([
      { app: 'qbittorrent', name: 'web', host: 8200, container: 8200, protocol: 'tcp' },
    ]);
    expect(qbittorrent?.containerPorts).toEqual({ web: 8200, peer: 6881 });
    expect(qbittorrent?.networkVia).toBe('gluetun');
  });

  it('rejects two apps on the same host port', () => {
    expect(
      resolve('  qbittorrent: {}\n  sonarr: { port: 8096 }\n').diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: 'port.conflict',
        hint: 'set apps.sonarr.port to a free port',
      }),
    );
  });

  it('rejects a port for an app with nothing to publish', () => {
    expect(codes(resolve('  byparr: { port: 9999 }\n'))).toContain(
      'app.port-not-published',
    );
  });

  it('pins images by digest unless the version is overridden', () => {
    const result = resolve('  qbittorrent: {}\n  sonarr: { version: 2.0.0 }\n');
    expect(app(result, 'jellyfin')?.image).toBe(
      `registry.test/jellyfin:1.0.0@sha256:${'0'.repeat(64)}`,
    );
    expect(app(result, 'sonarr')?.image).toBe('registry.test/sonarr:2.0.0');
    expect(codes(result)).toEqual(['app.untested-version']);
  });
});

describe('resolveStack: binding', () => {
  const lan = BASE.replace('bind: localhost', 'bind: lan');

  it('binds to localhost', () => {
    expect(resolve('  qbittorrent: {}\n').stack?.bindAddresses).toEqual(['127.0.0.1']);
  });

  it('binds to every private address on the LAN and derives the subnets', () => {
    const host: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const stack = resolve('  qbittorrent: {}\n', { base: lan, host }).stack;
    expect(stack?.bindAddresses).toEqual(['10.0.0.5', '192.168.1.10']);
    expect(stack?.lanSubnets).toEqual(['10.0.0.0/24', '192.168.1.0/24']);
  });

  it('prefers an explicit lan_subnet', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 192.168.0.0/16');
    expect(resolve('  qbittorrent: {}\n', { base }).stack?.lanSubnets).toEqual([
      '192.168.0.0/16',
    ]);
  });

  it('refuses "lan" on a host with no private address', () => {
    const result = resolve('  qbittorrent: {}\n', {
      base: lan,
      host: { arch: 'amd64', privateAddresses: [] },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'network.no-lan-address', path: 'network.bind' }),
    );
  });

  it('warns when binding to every interface', () => {
    const result = resolve('  qbittorrent: {}\n', {
      base: BASE.replace('bind: localhost', 'bind: all'),
    });
    expect(result.stack?.bindAddresses).toEqual(['0.0.0.0']);
    expect(codes(result)).toEqual(['network.bind-all']);
  });
});
