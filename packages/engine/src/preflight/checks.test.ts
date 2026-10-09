import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import { helperProbe } from '../host/helper';
import { HOST_REPORT_SCHEMA } from '../host/report';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeProbe, fakeRuntime } from '../testing/fakes';
import {
  FIXTURE_HOST,
  fixtureApp,
  fixtureCatalog,
  fixtureConfig,
} from '../testing/fixtures';
import {
  ownPortKey,
  portKey,
  preflightRequest,
  runPreflight,
  versionAtLeast,
  writableBy,
  type PreflightInput,
} from './checks';
import type { HostProbe, PathStat, ProbeRequest } from './probe';

const GIB = 1024 ** 3;
const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

function stackOf(source = STACK, catalog: Catalog = fixtureCatalog): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(source),
    catalog,
    FIXTURE_HOST,
    '/opt/mediaplane',
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    stack: stackOf(),
    versions: { engine: '29.8.0', compose: '5.5.1' },
    ownPorts: new Set(),
    ...overrides,
  };
}

const dir = (extra: Partial<PathStat> = {}): PathStat => ({
  isDirectory: true,
  isCharacterDevice: false,
  uid: 1000,
  gid: 1000,
  mode: 0o40755,
  dev: 1,
  ino: 1,
  ...extra,
});

const codes = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code);

describe('runPreflight', () => {
  it('is quiet on a healthy host', async () => {
    expect(await runPreflight(input(), fakeProbe())).toEqual([]);
  });

  it('requires recent Docker and Compose', async () => {
    const old = input({ versions: { engine: '20.10.24', compose: '2.20.0' } });
    expect(codes(await runPreflight(old, fakeProbe()))).toEqual([
      'preflight.docker-version',
      'preflight.compose-version',
    ]);
  });

  it('fails below 2 GiB free and warns below 10 GiB', async () => {
    expect(codes(await runPreflight(input(), fakeProbe({ freeBytes: 1 * GIB })))).toEqual(
      ['preflight.disk-full', 'preflight.disk-full'],
    );
    const low = await runPreflight(input(), fakeProbe({ freeBytes: 5 * GIB }));
    expect(low).toEqual([
      expect.objectContaining({ code: 'preflight.disk-low', severity: 'warning' }),
      expect.objectContaining({ code: 'preflight.disk-low', severity: 'warning' }),
    ]);
  });

  it('explains a missing data folder with the commands that fix it', async () => {
    const result = await runPreflight(
      input(),
      fakeProbe({ stats: { '/srv/data': undefined } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        code: 'preflight.data-missing',
        path: 'paths.data',
        hint: 'sudo mkdir -p /srv/data && sudo chown 1000:1000 /srv/data',
      }),
    ]);
  });

  it('requires the data folder to be a writable directory', async () => {
    const file = fakeProbe({ stats: { '/srv/data': dir({ isDirectory: false }) } });
    expect(codes(await runPreflight(input(), file))).toEqual([
      'preflight.data-not-directory',
    ]);
    const rootOwned = fakeProbe({ stats: { '/srv/data': dir({ uid: 0, gid: 0 }) } });
    expect(codes(await runPreflight(input(), rootOwned))).toEqual([
      'preflight.data-not-writable',
    ]);
  });

  it('requires downloads and media on one filesystem', async () => {
    const probe = fakeProbe({ stats: { '/srv/data/media': dir({ dev: 2 }) } });
    expect(codes(await runPreflight(input(), probe))).toEqual([
      'preflight.cross-filesystem',
    ]);
  });

  it('checks the devices apps need', async () => {
    const catalog = fixtureCatalog.map((def) =>
      def.id === 'gluetun'
        ? fixtureApp({
            ...def,
            extras: () => ({ devices: ['/dev/net/tun:/dev/net/tun'] }),
          })
        : def,
    );
    const stack = stackOf(
      STACK.replace('  qbittorrent: { vpn: false }\n', '  qbittorrent: {}\n') +
        'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
      catalog,
    );
    const result = await runPreflight(
      input({ stack }),
      fakeProbe({ stats: { '/dev/net/tun': undefined } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        code: 'preflight.device-missing',
        path: 'apps.gluetun',
        hint: 'load the TUN module: sudo modprobe tun',
      }),
    ]);
  });

  it('reports a published port that something else is using', async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    expect(await runPreflight(input(), probe)).toEqual([
      expect.objectContaining({
        code: 'preflight.port-in-use',
        path: 'apps.sonarr.port',
      }),
    ]);
  });

  it("ignores ports this project's own containers publish, at any address", async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    expect(
      await runPreflight(input({ ownPorts: new Set([ownPortKey('tcp', 8989)]) }), probe),
    ).toEqual([]);
  });

  it("still checks ports the project's containers don't publish", async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    expect(
      codes(
        await runPreflight(
          input({ ownPorts: new Set([ownPortKey('tcp', 7878)]) }),
          probe,
        ),
      ),
    ).toEqual(['preflight.port-in-use']);
  });
});

describe('versionAtLeast', () => {
  it.each([
    ['24.0.0', '24.0.0', true],
    ['29.8.0', '24.0.0', true],
    ['v2.30.1', '2.24.0', true],
    ['2.23.9', '2.24.0', false],
    ['5.5.1', '2.24.0', true],
    ['2.24.0-desktop.1', '2.24.0', true],
    ['20.10.24', '24.0.0', false],
  ])('%s ≥ %s is %s', (actual, minimum, expected) => {
    expect(versionAtLeast(actual, minimum)).toBe(expected);
  });
});

describe('writableBy', () => {
  it.each([
    [dir({ uid: 1000, mode: 0o40755 }), 1000, 1000, true],
    [dir({ uid: 1000, mode: 0o40555 }), 1000, 1000, false],
    [dir({ uid: 0, gid: 1000, mode: 0o40775 }), 1000, 1000, true],
    [dir({ uid: 0, gid: 0, mode: 0o40755 }), 1000, 1000, false],
    [dir({ uid: 0, gid: 0, mode: 0o40777 }), 1000, 1000, true],
    [dir({ uid: 0, gid: 0, mode: 0o40700 }), 0, 0, true],
  ])('%o for %i:%i is %s', (stat, uid, gid, expected) => {
    expect(writableBy(stat, uid, gid)).toBe(expected);
  });
});

/** The fixture stack behind a VPN, whose Gluetun needs /dev/net/tun, published on the LAN. */
function vpnStack(): ResolvedStack {
  const catalog = fixtureCatalog.map((def) =>
    def.id === 'gluetun'
      ? fixtureApp({ ...def, extras: () => ({ devices: ['/dev/net/tun:/dev/net/tun'] }) })
      : def,
  );
  return stackOf(
    STACK.replace('  qbittorrent: { vpn: false }\n', '  qbittorrent: {}\n')
      .replace('bind: localhost', 'bind: lan')
      .concat('vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n'),
    catalog,
  );
}

describe('preflightRequest', () => {
  it('lists every path, folder and port preflight looks at', () => {
    expect(preflightRequest(input())).toEqual({
      stat: ['/srv/data', '/srv/data/torrents', '/srv/data/usenet', '/srv/data/media'],
      free: ['/opt/mediaplane', '/srv/data'],
      ports: [
        { address: '127.0.0.1', port: 8096, protocol: 'tcp' },
        { address: '127.0.0.1', port: 8080, protocol: 'tcp' },
        { address: '127.0.0.1', port: 8989, protocol: 'tcp' },
      ],
      sameAsHost: ['/opt/mediaplane/stack.yaml'],
    });
  });

  it("leaves out ports the project's own containers already publish", () => {
    const request = preflightRequest(
      input({ ownPorts: new Set([ownPortKey('tcp', 8989)]) }),
    );
    expect(request.ports.map((p) => p.port)).toEqual([8096, 8080]);
  });

  it('is everything runPreflight then asks the probe', async () => {
    let prepared: ProbeRequest | undefined;
    const asked: string[] = [];
    const base = fakeProbe();
    const recording: HostProbe = {
      prepare: (request) => {
        prepared = request;
        return Promise.resolve();
      },
      stat: (path) => {
        asked.push(`stat ${path}`);
        return base.stat(path);
      },
      freeBytes: (path) => {
        asked.push(`free ${path}`);
        return base.freeBytes(path);
      },
      portFree: (address, port, protocol) => {
        asked.push(`port ${portKey(protocol, address, port)}`);
        return base.portFree(address, port, protocol);
      },
      sameAsHost: (path) => {
        asked.push(`same ${path}`);
        return Promise.resolve(true);
      },
    };
    await runPreflight(input({ stack: vpnStack() }), recording);
    const listed = [
      ...(prepared?.stat ?? []).map((path) => `stat ${path}`),
      ...(prepared?.free ?? []).map((path) => `free ${path}`),
      ...(prepared?.ports ?? []).map(
        (p) => `port ${portKey(p.protocol, p.address, p.port)}`,
      ),
      ...(prepared?.sameAsHost ?? []).map((path) => `same ${path}`),
    ];
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((call) => !listed.includes(call))).toEqual([]);
    expect(prepared?.stat).toContain('/dev/net/tun');
  });
});

describe('runPreflight through the host helper', () => {
  it('reports a data folder the host lacks, and a home that is another folder there', async () => {
    const runtime = fakeRuntime({
      hostHelper: (request, mounts) => {
        if (mounts.some((m) => m.source === '/srv/data')) {
          return {
            ok: false,
            error: 'bind source path does not exist: /srv/data',
            missingSource: '/srv/data',
          };
        }
        const ports = request.ports.map((p): [string, boolean] => [
          portKey(p.protocol, p.address, p.port),
          true,
        ]);
        return {
          ok: true,
          stdout: JSON.stringify({
            schema: HOST_REPORT_SCHEMA,
            stat: {},
            free: {},
            ports: Object.fromEntries(ports),
          }),
        };
      },
    });
    const probe = helperProbe({
      runtime,
      image: 'mediaplane:test',
      user: { uid: 1000, gid: 1000 },
      home: '/opt/mediaplane',
      local: fakeProbe(),
    });
    expect(codes(await runPreflight(input(), probe))).toEqual([
      'preflight.home-path',
      'preflight.data-missing',
    ]);
  });
});
