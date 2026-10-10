import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nodeProbe,
  type HostProbe,
  type PathStat,
  type ProbeRequest,
} from '../preflight/probe';
import type { HelperMount, HelperResult } from '../runtime/types';
import { fakeProbe, fakeRuntime } from '../testing/fakes';
import { FIXTURE_HOST } from '../testing/fixtures';
import { helperHostFacts, helperMountSources, helperProbe, isInside } from './helper';
import { collectHostReport, HOST_REPORT_SCHEMA, type HostRequest } from './report';
import { tempDir } from '../testing/temp';

const IMAGE = 'mediaplane:test';
const USER = { uid: 1000, gid: 1000 };
const HOME = '/opt/mediaplane';

const TUN: PathStat = {
  isDirectory: false,
  isCharacterDevice: true,
  uid: 0,
  gid: 0,
  mode: 0o20666,
  dev: 5,
  ino: 200,
};

const REQUEST: ProbeRequest = {
  stat: ['/srv/data', '/srv/data/media', '/dev/net/tun', '/opt/mediaplane/appdata/seerr'],
  free: ['/opt/mediaplane', '/srv/data'],
  ports: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
  sameAsHost: ['/opt/mediaplane/stack.yaml'],
};

interface Seen {
  request: HostRequest;
  mounts: readonly HelperMount[];
}

/** A host helper that answers as the real one does, seeing the host through `host`. */
function answering(host: HostProbe = fakeProbe(), seen: Seen[] = []) {
  return async (
    request: HostRequest,
    mounts: readonly HelperMount[],
  ): Promise<HelperResult> => {
    seen.push({ request, mounts });
    const report = await collectHostReport(request, host, () => FIXTURE_HOST);
    return { ok: true, stdout: `${JSON.stringify(report)}\n` };
  };
}

/** A host helper whose host is this machine: it looks at each host path directly. */
function thisMachine() {
  return async (request: HostRequest): Promise<HelperResult> => {
    const direct = (lookups: HostRequest['stat']) =>
      lookups.map(({ key }) => ({ key, at: key }));
    const report = await collectHostReport(
      { ...request, stat: direct(request.stat), free: direct(request.free) },
      nodeProbe,
      () => FIXTURE_HOST,
    );
    return { ok: true, stdout: JSON.stringify(report) };
  };
}

async function homeWithStack(): Promise<string> {
  const home = await tempDir('mediaplane-helper-');
  await writeFile(join(home, 'stack.yaml'), 'version: 1\n');
  return home;
}

const NOTHING: ProbeRequest = { stat: [], free: [], ports: [], sameAsHost: [] };

describe('isInside', () => {
  it.each([
    ['/srv/data', '/srv/data', true],
    ['/srv/data/media', '/srv/data', true],
    ['/srv/data/..x', '/srv/data', true],
    ['/srv/data-2', '/srv/data', false],
    ['/srv', '/srv/data', false],
  ])('%s in %s is %s', (path, folder, expected) => {
    expect(isInside(path, folder)).toBe(expected);
  });
});

describe('helperMountSources', () => {
  it('mounts the fewest folders that show every path, and devices through /dev', () => {
    expect(
      helperMountSources([
        '/srv/data/media',
        '/dev/net/tun',
        '/srv/data',
        '/srv/data-2',
        '/opt/mediaplane/stack.yaml',
      ]),
    ).toEqual(['/dev', '/opt/mediaplane/stack.yaml', '/srv/data', '/srv/data-2']);
  });
});

describe('helperHostFacts', () => {
  it('asks the helper for the host facts, with nothing mounted', async () => {
    const seen: Seen[] = [];
    const runtime = fakeRuntime({ hostHelper: answering(fakeProbe(), seen) });
    expect(await helperHostFacts({ runtime, image: IMAGE, user: USER })).toEqual(
      FIXTURE_HOST,
    );
    expect(seen).toEqual([
      { request: { facts: true, stat: [], free: [], ports: [] }, mounts: [] },
    ]);
  });

  it('explains a helper that cannot run', async () => {
    await expect(
      helperHostFacts({ runtime: fakeRuntime(), image: IMAGE, user: USER }),
    ).rejects.toThrow('the host helper failed: this fake Docker has no host helper');
  });

  it('explains a report without the facts', async () => {
    const runtime = fakeRuntime({
      hostHelper: () => ({
        ok: true,
        stdout: JSON.stringify({
          schema: HOST_REPORT_SCHEMA,
          stat: {},
          free: {},
          ports: {},
        }),
      }),
    });
    await expect(helperHostFacts({ runtime, image: IMAGE, user: USER })).rejects.toThrow(
      'the host helper reported no host facts',
    );
  });

  it('refuses an image name docker would read as an option', async () => {
    const calls: string[] = [];
    const runtime = fakeRuntime({ hostHelper: answering(), calls });
    await expect(
      helperHostFacts({ runtime, image: '--privileged', user: USER }),
    ).rejects.toThrow(
      'the host helper image "--privileged" is not an image name: it must not start with "-"',
    );
    expect(calls).toEqual([]);
  });
});

describe('helperProbe', () => {
  it('asks the helper about the host through read-only mounts, and looks at the home here', async () => {
    const seen: Seen[] = [];
    const host = fakeProbe({
      stats: { '/mediaplane-host/2/media': undefined, '/mediaplane-host/0/net/tun': TUN },
      busyPorts: ['tcp/127.0.0.1:8989'],
    });
    const local = fakeProbe({
      stats: { '/opt/mediaplane/appdata/seerr': undefined },
      freeBytes: 42,
    });
    const probe = helperProbe({
      runtime: fakeRuntime({ hostHelper: answering(host, seen) }),
      image: IMAGE,
      user: USER,
      home: HOME,
      local,
    });
    await probe.prepare?.(REQUEST);
    expect(seen[0]?.mounts).toEqual([
      { source: '/dev', target: '/mediaplane-host/0' },
      { source: '/opt/mediaplane/stack.yaml', target: '/mediaplane-host/1' },
      { source: '/srv/data', target: '/mediaplane-host/2' },
    ]);
    expect(seen[0]?.request).toEqual({
      facts: false,
      stat: [
        { key: '/dev/net/tun', at: '/mediaplane-host/0/net/tun' },
        { key: '/opt/mediaplane/stack.yaml', at: '/mediaplane-host/1' },
        { key: '/srv/data', at: '/mediaplane-host/2' },
        { key: '/srv/data/media', at: '/mediaplane-host/2/media' },
      ],
      free: [{ key: '/srv/data', at: '/mediaplane-host/2' }],
      ports: REQUEST.ports,
    });
    expect(await probe.stat('/dev/net/tun')).toEqual(TUN);
    expect(await probe.stat('/srv/data/media')).toBeUndefined();
    expect(await probe.stat('/opt/mediaplane/appdata/seerr')).toBeUndefined();
    expect(await probe.freeBytes('/opt/mediaplane')).toBe(42);
    expect(await probe.freeBytes('/srv/data')).toBe(100 * 1024 ** 3);
    expect(await probe.portFree('127.0.0.1', 8989, 'tcp')).toBe(false);
  });

  it('looks again without a folder the host does not have; nothing inside it exists', async () => {
    const tried: string[][] = [];
    const runtime = fakeRuntime({
      hostHelper: (request, mounts) => {
        tried.push(mounts.map((m) => m.source));
        if (mounts.some((m) => m.source === '/srv/data')) {
          return {
            ok: false,
            error: 'bind source path does not exist: /srv/data',
            missingSource: '/srv/data',
          };
        }
        return answering()(request, mounts);
      },
    });
    const probe = helperProbe({ runtime, image: IMAGE, user: USER, home: HOME });
    await probe.prepare?.(REQUEST);
    expect(tried).toEqual([
      ['/dev', '/opt/mediaplane/stack.yaml', '/srv/data'],
      ['/dev', '/opt/mediaplane/stack.yaml'],
    ]);
    expect(await probe.stat('/srv/data')).toBeUndefined();
    expect(await probe.freeBytes('/srv/data')).toBeUndefined();
  });

  it('reports any other helper failure', async () => {
    const probe = helperProbe({
      runtime: fakeRuntime(),
      image: IMAGE,
      user: USER,
      home: HOME,
    });
    await expect(probe.prepare?.(REQUEST)).rejects.toThrow(
      'the host helper failed: this fake Docker has no host helper',
    );
  });

  it('knows a home mounted at its own path is the same folder on the host', async () => {
    const home = await homeWithStack();
    const file = join(home, 'stack.yaml');
    const probe = helperProbe({
      runtime: fakeRuntime({ hostHelper: thisMachine() }),
      image: IMAGE,
      user: USER,
      home,
    });
    await probe.prepare?.({ ...NOTHING, sameAsHost: [file] });
    expect(await probe.sameAsHost?.(file)).toBe(true);
  });

  it('notices a home that is a different folder on the host, or not there at all', async () => {
    const home = await homeWithStack();
    const file = join(home, 'stack.yaml');
    const other = await nodeProbe.stat(file);
    const different = fakeRuntime({
      hostHelper: () => ({
        ok: true,
        stdout: JSON.stringify({
          schema: HOST_REPORT_SCHEMA,
          stat: { [file]: { ...other, ino: -1 } },
          free: {},
          ports: {},
        }),
      }),
    });
    const elsewhere = helperProbe({ runtime: different, image: IMAGE, user: USER, home });
    await elsewhere.prepare?.({ ...NOTHING, sameAsHost: [file] });
    expect(await elsewhere.sameAsHost?.(file)).toBe(false);

    const missing = fakeRuntime({
      hostHelper: (request, mounts) =>
        mounts.length > 0
          ? { ok: false, error: 'no such folder', missingSource: file }
          : thisMachine()(request),
    });
    const absent = helperProbe({ runtime: missing, image: IMAGE, user: USER, home });
    await absent.prepare?.({ ...NOTHING, sameAsHost: [file] });
    expect(await absent.sameAsHost?.(file)).toBe(false);
  });

  it('must be prepared before it is asked about the host', () => {
    const probe = helperProbe({
      runtime: fakeRuntime(),
      image: IMAGE,
      user: USER,
      home: HOME,
    });
    expect(() => probe.stat('/srv/data')).toThrow(
      'call prepare() before asking about the host',
    );
  });

  it('finds a path inside a folder that is spelled another way', async () => {
    const seen: Seen[] = [];
    const probe = helperProbe({
      runtime: fakeRuntime({ hostHelper: answering(fakeProbe(), seen) }),
      image: IMAGE,
      user: USER,
      home: '/srv/data/home',
      local: fakeProbe(),
    });
    await probe.prepare?.({
      ...NOTHING,
      stat: ['/srv//data'],
      sameAsHost: ['/srv/data/home/stack.yaml'],
    });
    expect(seen[0]?.mounts).toEqual([
      { source: '/srv//data', target: '/mediaplane-host/0' },
    ]);
    expect(seen[0]?.request.stat).toEqual([
      { key: '/srv//data', at: '/mediaplane-host/0' },
      { key: '/srv/data/home/stack.yaml', at: '/mediaplane-host/0/home/stack.yaml' },
    ]);
  });

  it('refuses an image name docker would read as an option', async () => {
    const calls: string[] = [];
    const probe = helperProbe({
      runtime: fakeRuntime({ hostHelper: answering(), calls }),
      image: '-v',
      user: USER,
      home: HOME,
    });
    await expect(probe.prepare?.(REQUEST)).rejects.toThrow(
      'the host helper image "-v" is not an image name: it must not start with "-"',
    );
    expect(calls).toEqual([]);
  });
});
