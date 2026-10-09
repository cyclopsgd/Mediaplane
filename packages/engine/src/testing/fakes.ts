import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { COMPOSE_PATH, ENV_PATH } from '../paths';
import type { HostRequest } from '../host/report';
import type { HostProbe, PathStat } from '../preflight/probe';
import {
  RuntimeError,
  type CommandResult,
  type ContainerState,
  type HashesResult,
  type HelperMount,
  type HelperResult,
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
    ino: 1,
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

export interface FakeRuntimeOptions {
  versions?: { engine: string; compose: string };
  containers?: ContainerState[];
  hashes?: HashesResult;
  /** When set, Docker is unreachable with this message. */
  unavailable?: string;
  pull?: CommandResult;
  up?: CommandResult;
  chown?: CommandResult;
  /** Answers the host helper, given the parsed request; without it, the helper fails. */
  hostHelper?: (
    request: HostRequest,
    mounts: readonly HelperMount[],
  ) => HelperResult | Promise<HelperResult>;
  /** Each call is appended here, e.g. "pull" or "chown seerr 1000:1000 /app/config". */
  calls?: string[];
}

/** A Docker that answers from memory. */
export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
  const record = (call: string) => options.calls?.push(call);
  return {
    versions: () => {
      record('versions');
      return options.unavailable === undefined
        ? Promise.resolve(options.versions ?? { engine: '29.8.0', compose: '5.5.1' })
        : Promise.reject(new RuntimeError(options.unavailable));
    },
    configHashes: (compose, values) => {
      record('configHashes');
      return Promise.resolve(
        options.hashes ?? { ok: true, hashes: fakeHash(compose, values) },
      );
    },
    containers: () => {
      record('containers');
      return Promise.resolve(options.containers ?? []);
    },
    pull: () => {
      record('pull');
      return Promise.resolve(options.pull ?? { ok: true });
    },
    up: () => {
      record('up');
      return Promise.resolve(options.up ?? { ok: true });
    },
    chown: (service, path, owner) => {
      record(`chown ${service} ${String(owner.uid)}:${String(owner.gid)} ${path}`);
      return Promise.resolve(options.chown ?? { ok: true });
    },
    hostHelper: (_image, request, mounts) => {
      record(`host-helper ${mounts.map((m) => m.target).join(' ')}`.trimEnd());
      if (options.hostHelper === undefined) {
        return Promise.resolve({
          ok: false,
          error: 'this fake Docker has no host helper',
        });
      }
      return Promise.resolve(
        options.hostHelper(JSON.parse(request) as HostRequest, mounts),
      );
    },
  };
}

/**
 * A Docker whose `up` starts what is written in `home`. Afterwards containers() reports a
 * running, healthy `fake-<service>` per service, labelled with the fakeHash of the written
 * compose.yaml and .env. Like Compose, it hashes a guest (`network_mode: service:<host>`)
 * as `container:<host's id>`.
 */
export function fakeDocker(
  home: string,
  options: FakeRuntimeOptions & { upChangesNothing?: boolean } = {},
): Runtime & { calls: string[] } {
  const calls: string[] = [];
  const base = fakeRuntime({ ...options, calls });
  let containers = options.containers ?? [];
  return {
    ...base,
    calls,
    containers: () => {
      calls.push('containers');
      return Promise.resolve(containers);
    },
    up: async (waitSeconds, values) => {
      const result = await base.up(waitSeconds, values);
      if (!result.ok || options.upChangesNothing === true) return result;
      const compose = parse(await readFile(join(home, COMPOSE_PATH), 'utf8')) as {
        services: Record<string, Record<string, unknown>>;
      };
      for (const config of Object.values(compose.services)) {
        const mode = config.network_mode;
        const host =
          typeof mode === 'string' ? /^service:(.+)$/.exec(mode)?.[1] : undefined;
        if (host !== undefined) config.network_mode = `container:fake-${host}`;
      }
      const env = parseEnvFile(await readFile(join(home, ENV_PATH), 'utf8'));
      containers = running(fakeHash(stringify(compose), env));
      return result;
    },
  };
}

const UNESCAPE: Record<string, string> = { n: '\n', r: '\r', t: '\t' };

/**
 * The inverse of renderEnvFile, for tests and fakes. It refuses what Compose would
 * misread: a single-quoted value ending in \' (Compose takes that as an escaped quote).
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    const name = line.slice(0, equals);
    const raw = line.slice(equals + 1);
    if (raw.startsWith("'") && raw.endsWith("\\'")) {
      throw new Error(
        `Compose would misread ${name}: its closing quote follows a backslash`,
      );
    }
    values[name] = raw.startsWith('"')
      ? raw
          .slice(1, -1)
          .replace(/\\(.)/g, (_match, char: string) => UNESCAPE[char] ?? char)
      : raw.slice(1, -1);
  }
  return values;
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
