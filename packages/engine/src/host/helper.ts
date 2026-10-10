import { relative } from 'node:path';
import { portKey } from '../preflight/checks';
import { nodeProbe, type HostProbe, type ProbeRequest } from '../preflight/probe';
import {
  HelperError,
  type HelperMount,
  type HelperResult,
  type Runtime,
} from '../runtime/types';
import { isInside } from '../util/path';
import { compare, unique } from '../util/sort';
import type { EgressResult } from '../vpn/egress';
import type { HostFacts } from './facts';
import { parseHostReport, type HostReport, type HostRequest } from './report';

/** Where the host helper sees the folders the engine mounts into it. */
export const HELPER_ROOT = '/mediaplane-host';

export interface HelperOptions {
  runtime: Runtime;
  /** The Mediaplane image this container runs (MEDIAPLANE_IMAGE). */
  image: string;
  /** Who the helper runs as: Mediaplane's own user. */
  user: { uid: number; gid: number };
}

/**
 * The folders to mount into the helper so that it sees every path: the fewest, since a
 * folder's mount shows everything inside it. Devices are seen through /dev.
 */
export function helperMountSources(paths: readonly string[]): string[] {
  const roots = unique(
    paths.map((path) => (isInside(path, '/dev') ? '/dev' : path)),
  ).sort(compare);
  return roots.filter(
    (root, i) => !roots.slice(0, i).some((other) => isInside(root, other)),
  );
}

/**
 * Facts about the host, from the helper (spec §4.2): this container's own network
 * interfaces are not the host's.
 */
export async function helperHostFacts(options: HelperOptions): Promise<HostFacts> {
  const result = await runHelper(
    options,
    { facts: true, stat: [], free: [], ports: [] },
    [],
  );
  if (!result.ok) throw new HelperError(`the host helper failed: ${result.error}`);
  const facts = parseHostReport(result.stdout).facts;
  if (facts === undefined)
    throw new HelperError('the host helper reported no host facts');
  return facts;
}

/**
 * Which address the host comes from, as the IP-echo service at `url` sees it, asked by the
 * host helper on the host network: this container has no route out (spec §4.2). A helper
 * that fails is a failed answer, not an error, because vpn-check then only warns.
 */
export async function helperEgress(
  options: HelperOptions,
  url: string,
): Promise<EgressResult> {
  try {
    const result = await runHelper(
      options,
      { facts: false, stat: [], free: [], ports: [], egress: url },
      [],
    );
    if (!result.ok)
      return { ok: false, error: `the host helper failed: ${result.error}` };
    return (
      parseHostReport(result.stdout).egress ?? {
        ok: false,
        error: 'the host helper reported no address',
      }
    );
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * A HostProbe for Mediaplane in its container (spec §4.1, §4.2). Paths in the home are
 * looked at here, where the home is mounted at its own path. Everything else (the data
 * folder, devices, free space and ports) is the host's, so prepare() asks the host helper
 * for all of it at once, and the other methods answer from that report.
 */
export function helperProbe(
  options: HelperOptions & { home: string; local?: HostProbe },
): HostProbe {
  const local = options.local ?? nodeProbe;
  const { home } = options;
  let report: HostReport | undefined;

  const prepared = (): HostReport => {
    if (report === undefined) {
      throw new Error('helperProbe: call prepare() before asking about the host');
    }
    return report;
  };

  async function prepare(request: ProbeRequest): Promise<void> {
    const outside = (paths: readonly string[]) =>
      unique(paths.filter((path) => !isInside(path, home))).sort(compare);
    const stat = unique([...outside(request.stat), ...request.sameAsHost]).sort(compare);
    const free = outside(request.free);
    let sources = helperMountSources([...stat, ...free]);
    // Each pass mounts one folder fewer, so this ends.
    for (;;) {
      const mounts: HelperMount[] = sources.map((source, index) => ({
        source,
        target: `${HELPER_ROOT}/${String(index)}`,
      }));
      const lookups = (paths: readonly string[]) =>
        paths.flatMap((key) => {
          const mount = mounts.find((m) => isInside(key, m.source));
          if (mount === undefined) return [];
          // relative(), not slicing off the source: a folder may be spelled another way.
          const rel = relative(mount.source, key);
          return [{ key, at: rel === '' ? mount.target : `${mount.target}/${rel}` }];
        });
      const result = await runHelper(
        options,
        { facts: false, stat: lookups(stat), free: lookups(free), ports: request.ports },
        mounts,
      );
      if (result.ok) {
        report = parseHostReport(result.stdout);
        return;
      }
      // A folder the host doesn't have: nothing inside it exists. Look again without it.
      const missing = result.missingSource;
      if (missing === undefined || !sources.includes(missing)) {
        throw new HelperError(`the host helper failed: ${result.error}`);
      }
      sources = sources.filter((source) => source !== missing);
    }
  }

  return {
    prepare,
    stat(path) {
      if (isInside(path, home)) return local.stat(path);
      return Promise.resolve(prepared().stat[path] ?? undefined);
    },
    freeBytes(path) {
      if (isInside(path, home)) return local.freeBytes(path);
      return Promise.resolve(prepared().free[path] ?? undefined);
    },
    portFree(address, port, protocol) {
      return Promise.resolve(
        prepared().ports[portKey(protocol, address, port)] ?? undefined,
      );
    },
    async sameAsHost(path) {
      const here = await local.stat(path);
      if (here === undefined) return undefined;
      const there = prepared().stat[path];
      return (
        there !== undefined &&
        there !== null &&
        there.dev === here.dev &&
        there.ino === here.ino
      );
    },
  };
}

/**
 * One run of the host helper. The image is the last docker option before the command, so
 * a name starting with "-" would be read as another option: it is refused instead.
 */
async function runHelper(
  options: HelperOptions,
  request: HostRequest,
  mounts: readonly HelperMount[],
): Promise<HelperResult> {
  if (options.image.startsWith('-')) {
    throw new HelperError(
      `the host helper image ${JSON.stringify(options.image)} is not an image name: it must not start with "-"`,
    );
  }
  return await options.runtime.hostHelper(
    options.image,
    JSON.stringify(request),
    mounts,
    options.user,
  );
}
