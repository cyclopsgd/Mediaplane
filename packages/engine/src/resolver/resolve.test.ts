import { describe, expect, it } from 'vitest';
import type { AppDefinition, PortSpec } from '../catalog/types';
import type { HostFacts } from '../host/facts';
import {
  FIXTURE_HOST,
  fixtureApp,
  fixtureCatalog,
  fixtureConfig,
} from '../testing/fixtures';
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

  it('protects env vars that keep the host and container ports equal', () => {
    const result = resolve('  qbittorrent: { env: { WEBUI_PORT: "9999" } }\n');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.env-reserved',
        path: 'apps.qbittorrent.env.WEBUI_PORT',
        hint: 'set apps.qbittorrent.port instead',
      }),
    );
    expect(result.stack).toBeUndefined();
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

  it('rejects two apps listening on one port inside a shared network namespace', () => {
    expect(resolve('  qbittorrent: { port: 8000 }\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'port.namespace-conflict',
        path: 'apps.qbittorrent.port',
        hint: 'set apps.qbittorrent.port to another port',
      }),
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

describe('resolveStack: namespace port conflicts', () => {
  // Gluetun's fixture reserves 8000 for its control server.
  const guest = (id: string, ports: PortSpec[]) =>
    fixtureApp({
      id,
      ports,
      networkVia: () => 'gluetun',
      implies: () => ['gluetun'],
    });
  const web = (container: number): PortSpec => ({
    name: 'web',
    container,
    hostEqualsContainer: { env: 'WEB_PORT' },
  });
  const resolveWith = (apps: AppDefinition[]) => {
    const config = fixtureConfig(
      `${BASE}apps:\n${apps.map((a) => `  ${a.id}: {}\n`).join('')}`,
    );
    return resolveStack(
      config,
      [...apps, ...fixtureCatalog],
      FIXTURE_HOST,
      '/opt/mediaplane',
    );
  };

  it('blames the guest even when its id sorts before the namespace host', () => {
    const result = resolveWith([guest('aaa-guest', [web(8000)])]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'port.namespace-conflict',
        message:
          "gluetun and aaa-guest both listen on port 8000/tcp inside gluetun's network",
        path: 'apps.aaa-guest.port',
        hint: 'set apps.aaa-guest.port to another port',
      }),
    );
    expect(result.diagnostics.map((d) => d.path)).not.toContain('apps.gluetun.port');
  });

  it('gives no hint when the clash is not on the port that apps.<id>.port moves', () => {
    const result = resolveWith([
      guest('zzz-guest', [web(9000), { name: 'rpc', container: 8000, publish: false }]),
    ]);
    const conflict = result.diagnostics.find((d) => d.code === 'port.namespace-conflict');
    expect(conflict?.path).toBe('apps.zzz-guest.port');
    expect(conflict?.hint).toBeUndefined();
  });

  it('blames the later app when both share the host namespace', () => {
    const result = resolveWith([
      guest('aaa-guest', [web(9000)]),
      guest('bbb-guest', [web(9000)]),
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'port.namespace-conflict',
        path: 'apps.bbb-guest.port',
        hint: 'set apps.bbb-guest.port to another port',
      }),
    );
  });

  it('ignores duplicate ports inside one app (a catalog test covers them)', () => {
    const twice: PortSpec[] = [
      { name: 'one', container: 7000, publish: false },
      { name: 'two', container: 7000, publish: false },
    ];
    const result = resolveWith([fixtureApp({ id: 'twice', ports: twice })]);
    expect(result.diagnostics).toEqual([]);
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

  it('derives no subnet wider than a private range from an odd interface prefix', () => {
    // 10.0.0.5/4 is the network 0.0.0.0/4: trusting it would trust public addresses.
    const host: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/4' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const stack = resolve('  qbittorrent: {}\n', { base: lan, host }).stack;
    expect(stack?.lanSubnets).toEqual(['192.168.1.0/24']);
    const odd: HostFacts = {
      ...host,
      privateAddresses: host.privateAddresses.slice(0, 1),
    };
    expect(
      resolve('  qbittorrent: {}\n', { base: lan, host: odd }).stack?.lanSubnets,
    ).toEqual([]);
  });

  it('prefers an explicit lan_subnet', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 192.168.0.0/16');
    expect(resolve('  qbittorrent: {}\n', { base }).stack?.lanSubnets).toEqual([
      '192.168.0.0/16',
    ]);
  });

  it('knows no LAN subnet on a cloud VM, unless lan_subnet names one', () => {
    const cloud: HostFacts = { ...FIXTURE_HOST, cloud: 'Oracle Cloud' };
    expect(resolve('  qbittorrent: {}\n', { host: cloud }).stack?.lanSubnets).toEqual([]);
    const base = BASE.replace(
      'bind: localhost',
      'bind: localhost, lan_subnet: 10.0.0.0/24',
    );
    expect(
      resolve('  qbittorrent: {}\n', { base, host: cloud }).stack?.lanSubnets,
    ).toEqual(['10.0.0.0/24']);
  });

  it('tells the apps whether their web UIs are on the LAN, and which clients to trust', () => {
    const contextFor = (base: string) =>
      app(resolve('  sonarr: {}\n  qbittorrent: {}\n', { base }), 'sonarr')?.context;
    expect(contextFor(BASE)).toMatchObject({
      lanSubnets: ['192.168.1.0/24'],
      publishesOnLan: false,
      lanClientSubnets: [],
    });
    for (const base of [lan, BASE.replace('bind: localhost', 'bind: all')]) {
      expect(contextFor(base)).toMatchObject({
        lanSubnets: ['192.168.1.0/24'],
        publishesOnLan: true,
        lanClientSubnets: ['192.168.1.0/24'],
      });
    }
  });

  it('tells the apps where a browser reaches their web UIs', () => {
    const webOf = (base: string) => {
      const result = resolve('  sonarr: {}\n  qbittorrent: {}\n', { base });
      return [result.stack?.webAddresses, app(result, 'sonarr')?.context.webAddresses];
    };
    expect(webOf(BASE)).toEqual([['127.0.0.1'], ['127.0.0.1']]);
    expect(webOf(lan)).toEqual([['192.168.1.10'], ['192.168.1.10']]);
    // bind: all publishes on every interface: a browser comes in on one of this host's own.
    const all = ['127.0.0.1', '192.168.1.10'];
    expect(webOf(BASE.replace('bind: localhost', 'bind: all'))).toEqual([all, all]);
  });

  it('refuses "lan" on a host with no private address', () => {
    const result = resolve('  qbittorrent: {}\n', {
      base: lan,
      host: { arch: 'amd64', privateAddresses: [] },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'network.no-lan-address',
        path: 'network.bind',
        hint: 'use bind: localhost and reach the stack through Tailscale or an SSH tunnel',
      }),
    );
  });

  it('only binds to addresses inside an explicit lan_subnet', () => {
    const host: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 192.168.1.0/24');
    expect(resolve('  qbittorrent: {}\n', { base, host }).stack?.bindAddresses).toEqual([
      '192.168.1.10',
    ]);
  });

  it('explains an explicit lan_subnet that matches no address', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 172.16.0.0/12');
    expect(resolve('  qbittorrent: {}\n', { base }).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'network.no-lan-address',
        path: 'network.lan_subnet',
        hint: "check network.lan_subnet against this host's addresses, or use bind: localhost",
      }),
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

describe('resolveStack: cloud hosts', () => {
  const lan = BASE.replace('bind: localhost', 'bind: lan');
  const cloudHost: HostFacts = {
    arch: 'amd64',
    privateAddresses: [{ address: '10.0.0.208', cidr: '10.0.0.208/24' }],
    cloud: 'Oracle Cloud',
  };

  it('refuses "lan" on a cloud VM without an explicit subnet', () => {
    const result = resolve('  qbittorrent: {}\n', { base: lan, host: cloudHost });
    expect(result.stack).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'network.cloud-lan',
        path: 'network.bind',
        message:
          'network.bind is "lan", but this host looks like it runs on Oracle Cloud, where private addresses are often reachable from the internet',
      }),
    );
  });

  it('allows "lan" on a cloud VM when the subnet is explicit', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 10.0.0.0/24');
    expect(
      resolve('  qbittorrent: {}\n', { base, host: cloudHost }).stack?.bindAddresses,
    ).toEqual(['10.0.0.208']);
  });

  it('still allows "localhost" on a cloud VM', () => {
    expect(
      resolve('  qbittorrent: {}\n', { host: cloudHost }).stack?.bindAddresses,
    ).toEqual(['127.0.0.1']);
  });
});
