import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { HostProbe, PathStat } from '../preflight/probe';
import {
  RuntimeError,
  type ContainerState,
  type HashesResult,
  type Runtime,
} from '../runtime/types';

/** A probe for a healthy host: every path is a writable directory, every port is free. */
export function fakeProbe(
  options: {
    /** Overrides by path; `undefined` means "does not exist". */
    stats?: Record<string, PathStat | undefined>;
    freeBytes?: number;
    /** portKey()s that are in use. */
    busyPorts?: readonly string[];
  } = {},
): HostProbe {
  const stats = options.stats ?? {};
  const healthyDir: PathStat = {
    isDirectory: true,
    isCharacterDevice: false,
    uid: 1000,
    gid: 1000,
    mode: 0o40755,
    dev: 1,
  };
  return {
    stat: (path) =>
      Promise.resolve(
        Object.hasOwn(stats, path)
          ? stats[path]
          : path.startsWith('/dev/')
            ? {
                ...healthyDir,
                isDirectory: false,
                isCharacterDevice: true,
                mode: 0o20666,
              }
            : healthyDir,
      ),
    freeBytes: () => Promise.resolve(options.freeBytes ?? 100 * 1024 ** 3),
    portFree: (address, port, protocol) =>
      Promise.resolve(
        !(options.busyPorts ?? []).includes(`${protocol}/${address}:${port}`),
      ),
  };
}

/** A stand-in for Compose's config hash: stable per service config and secret values. */
export function fakeHash(
  compose: string,
  values: Record<string, string>,
): Record<string, string> {
  const parsed = parse(compose) as { services?: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(parsed.services ?? {}).map(([service, config]) => [
      service,
      createHash('sha256')
        .update(JSON.stringify([config, values]))
        .digest('hex'),
    ]),
  );
}

/** A Docker that answers from memory. */
export function fakeRuntime(
  options: {
    versions?: { engine: string; compose: string };
    containers?: ContainerState[];
    hashes?: HashesResult;
    /** When set, Docker is unreachable with this message. */
    unavailable?: string;
  } = {},
): Runtime {
  return {
    versions: () =>
      options.unavailable === undefined
        ? Promise.resolve(options.versions ?? { engine: '29.8.0', compose: '5.5.1' })
        : Promise.reject(new RuntimeError(options.unavailable)),
    configHashes: (compose, values) =>
      Promise.resolve(options.hashes ?? { ok: true, hashes: fakeHash(compose, values) }),
    containers: () => Promise.resolve(options.containers ?? []),
  };
}

/** Running, healthy containers whose config hashes are `hashes`. */
export function running(hashes: Record<string, string>): ContainerState[] {
  return Object.entries(hashes).map(([service, configHash]) => ({
    service,
    id: `fake-${service}`,
    state: 'running',
    health: 'healthy',
    configHash,
    published: [],
  }));
}
