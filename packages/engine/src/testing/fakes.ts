import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { COMPOSE_PATH, ENV_PATH } from '../paths';
import type { HostRequest } from '../host/report';
import type { HostProbe, PathStat } from '../preflight/probe';
import type { ExecResult } from '../runtime/exec';
import type { ProbeCheck } from '../vpn/probe';
import {
  RuntimeError,
  type CommandResult,
  type ContainerDetails,
  type ContainerState,
  type HashesResult,
  type HelperMount,
  type HelperResult,
  type OneOffCommand,
  type Runtime,
  type WiringJoin,
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

/** When a fake container started, unless the test says otherwise. */
export const FAKE_STARTED_AT = '2026-10-10T10:00:00.000000001Z';

export interface FakeRuntimeOptions {
  versions?: { engine: string; compose: string };
  containers?: ContainerState[];
  hashes?: HashesResult;
  /** When set, Docker is unreachable with this message. */
  unavailable?: string;
  /** What pull answers: the same for every call, or one per call, the last repeating. */
  pull?: CommandResult | readonly CommandResult[];
  up?: CommandResult;
  chown?: CommandResult;
  /** Answers a one-off command; without it, every one-off exits 0 and prints nothing. */
  run?: (service: string, command: OneOffCommand) => ExecResult | Promise<ExecResult>;
  /**
   * `inspect` details by container ID. Any other container is on "bridge" and started at
   * FAKE_STARTED_AT.
   */
  details?: Record<string, Partial<Omit<ContainerDetails, 'id'>>>;
  /**
   * Each container's address on the wiring network, by ID; one left out isn't on it.
   * None by default, so a test that forgets its fake apps gets wire.not-on-network, and
   * never a request to a real app on this host: fakeSonarr() and fakeStackApis() give
   * the addresses to pass.
   */
  addresses?: Record<string, string>;
  /** What joinWiring answers; 'not-needed', as from source, unless the test says. */
  join?: WiringJoin | (() => WiringJoin | Promise<WiringJoin>);
  /** What stop answers. */
  stop?: CommandResult;
  /** Answers the host helper, given the parsed request; without it, the helper fails. */
  hostHelper?: (
    request: HostRequest,
    mounts: readonly HelperMount[],
  ) => HelperResult | Promise<HelperResult>;
  /**
   * Each call is appended here, e.g. "pull", "chown seerr 1000:1000 /app/config" or
   * "run qbittorrent sh as 65534:65534".
   */
  calls?: string[];
}

/** A Docker that answers from memory. */
export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
  const record = (call: string) => options.calls?.push(call);
  let pulls = 0;
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
      const planned = options.pull ?? { ok: true };
      const results = 'ok' in planned ? [planned] : planned;
      return Promise.resolve(
        results[Math.min(pulls++, results.length - 1)] ?? { ok: true },
      );
    },
    up: () => {
      record('up');
      return Promise.resolve(options.up ?? { ok: true });
    },
    // async: a throwing callback rejects like a failed docker call.
    run: async (service, command) => {
      const { uid, gid } = command.user;
      record(`run ${service} ${command.entrypoint} as ${String(uid)}:${String(gid)}`);
      return (
        (await options.run?.(service, command)) ?? { code: 0, stdout: '', stderr: '' }
      );
    },
    inspect: (ids) => {
      record(`inspect ${ids.join(' ')}`);
      return Promise.resolve(
        ids.map((id) => ({
          id,
          networkMode: 'bridge',
          startedAt: FAKE_STARTED_AT,
          ...options.details?.[id],
        })),
      );
    },
    wiringAddresses: (ids) => {
      record(`wiring-addresses ${ids.join(' ')}`);
      return Promise.resolve(
        Object.fromEntries(
          ids.flatMap((id) => {
            const address = options.addresses?.[id];
            return address === undefined ? [] : [[id, address]];
          }),
        ),
      );
    },
    // async: a throwing callback rejects like a failed docker call.
    joinWiring: async () => {
      record('join-wiring');
      const join = options.join ?? 'not-needed';
      return typeof join === 'function' ? await join() : join;
    },
    leaveWiring: () => {
      record('leave-wiring');
      return Promise.resolve();
    },
    stop: (services) => {
      record(`stop ${services.join(' ')}`);
      return Promise.resolve(options.stop ?? { ok: true });
    },
    chown: (service, path, owner) => {
      record(`chown ${service} ${String(owner.uid)}:${String(owner.gid)} ${path}`);
      return Promise.resolve(options.chown ?? { ok: true });
    },
    // async: bad request JSON, or a throwing callback, rejects like a failed docker call.
    hostHelper: async (_image, request, mounts) => {
      record(`host-helper ${mounts.map((m) => m.target).join(' ')}`.trimEnd());
      if (options.hostHelper === undefined) {
        return { ok: false, error: 'this fake Docker has no host helper' };
      }
      return await options.hostHelper(JSON.parse(request) as HostRequest, mounts);
    },
  };
}

/**
 * A Docker whose `up` starts what is written in `home`. Afterwards containers() reports a
 * running, healthy `fake-<service>` per service, labelled with the fakeHash of the written
 * compose.yaml and .env. Like Compose, it hashes a guest (`network_mode: service:<host>`)
 * as `container:<host's id>`, and inspect says it is in its host's network. A vpn-check
 * probe in qBittorrent's network finds a healthy tunnel, unless `run` says otherwise.
 */
export function fakeDocker(
  home: string,
  options: FakeRuntimeOptions & { upChangesNothing?: boolean } = {},
): Runtime & { calls: string[] } {
  const calls: string[] = [];
  const base = fakeRuntime({
    run: (service, command) =>
      service === 'qbittorrent' && command.entrypoint === 'sh'
        ? { code: 0, stdout: probeOutput(HEALTHY_PROBE), stderr: '' }
        : { code: 0, stdout: '', stderr: '' },
    ...options,
    calls,
  });
  let containers = options.containers ?? [];
  /** Guest container ID → its host's, from the compose.yaml up started. */
  const hosts = new Map<string, string>();
  return {
    ...base,
    calls,
    containers: () => {
      calls.push('containers');
      return Promise.resolve(containers);
    },
    inspect: async (ids) =>
      (await base.inspect(ids)).map((details) => {
        const host = hosts.get(details.id);
        return host === undefined ||
          options.details?.[details.id]?.networkMode !== undefined
          ? details
          : { ...details, networkMode: `container:${host}` };
      }),
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
      hosts.clear();
      for (const [service, config] of Object.entries(compose.services)) {
        const mode = config.network_mode;
        if (typeof mode === 'string')
          hosts.set(`fake-${service}`, mode.slice('container:'.length));
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

/** vpn-check's probe answers: each check's exit status, and what it printed. */
export type ProbeAnswers = Partial<Record<ProbeCheck, readonly [number, string]>>;

/**
 * A probe of a healthy tunnel, without the egress check: the route goes into tun0, and
 * Gluetun's control server says the VPN runs, with Mediaplane's key only.
 */
export const HEALTHY_PROBE: ProbeAnswers = {
  route: [0, '1.1.1.1 dev tun0  src 10.66.0.2 '],
  anonymous: [0, '401'],
  status: [0, '{"status":"running"}\n200'],
  publicip: [0, '{"public_ip":""}\n200'],
};

/** What the probe script prints for `answers`, after a line of Compose's own. */
export function probeOutput(answers: ProbeAnswers): string {
  const lines = Object.entries(answers).map(
    ([name, [exit, output]]) =>
      `${name} ${String(exit)} ${Buffer.from(output).toString('base64')}`,
  );
  return ['Container mediaplane-qbittorrent-run-0 Creating', ...lines, ''].join('\n');
}

/** The container IDs fakeProbeRuntime gives Gluetun and qBittorrent. */
export const FAKE_GLUETUN_ID = 'a'.repeat(64);
export const FAKE_QBITTORRENT_ID = 'b'.repeat(64);

/** A running, healthy container of the stack, unless `extra` says otherwise. */
export function fakeContainer(
  service: string,
  id: string,
  extra: Partial<ContainerState> = {},
): ContainerState {
  return {
    service,
    id,
    state: 'running',
    health: 'healthy',
    configHash: undefined,
    published: [],
    ...extra,
  };
}

/**
 * A Docker running qBittorrent in a healthy Gluetun's network, whose vpn-check probe
 * prints `answers`, as the script would: no egress line when it is asked no URL. Each
 * probe's command is pushed to `sent`. `options` replace these defaults, and anything
 * else a fakeRuntime takes.
 */
export function fakeProbeRuntime(
  answers: ProbeAnswers,
  sent: OneOffCommand[] = [],
  options: FakeRuntimeOptions = {},
): Runtime {
  return fakeRuntime({
    containers: [
      fakeContainer('gluetun', FAKE_GLUETUN_ID),
      fakeContainer('qbittorrent', FAKE_QBITTORRENT_ID),
    ],
    details: { [FAKE_QBITTORRENT_ID]: { networkMode: `container:${FAKE_GLUETUN_ID}` } },
    run: (_service, command) => {
      sent.push(command);
      const shown: ProbeAnswers = { ...answers };
      if (command.args.at(-1) === '') delete shown.egress;
      return { code: 0, stdout: probeOutput(shown), stderr: '' };
    },
    ...options,
  });
}
