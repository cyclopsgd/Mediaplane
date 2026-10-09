import { join } from 'node:path';
import { error, warning, withHint, type Diagnostic } from '../diagnostics';
import { STACK_PATH } from '../paths';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { unique } from '../util/sort';
import type { HostProbe, PathStat, ProbeRequest } from './probe';

export const MIN_DOCKER_ENGINE = '24.0.0';
export const MIN_DOCKER_COMPOSE = '2.24.0';

const GIB = 1024 ** 3;
const DISK_ERROR_BYTES = 2 * GIB;
const DISK_WARNING_BYTES = 10 * GIB;

/** Download and library folders that must share one filesystem, so moves are hardlinks. */
const DATA_SUBDIRS = ['torrents', 'usenet', 'media'] as const;

export interface PreflightInput {
  stack: ResolvedStack;
  versions: { engine: string; compose: string };
  /** ownPortKey()s this project's containers already publish (re-applies must not trip on them). */
  ownPorts: ReadonlySet<string>;
}

export function portKey(protocol: 'tcp' | 'udp', address: string, port: number): string {
  return `${protocol}/${address}:${port}`;
}

/**
 * A port the stack's own containers publish, whatever the address, so a re-apply that
 * changes network.bind is not blocked by the stack's own containers.
 */
export function ownPortKey(protocol: 'tcp' | 'udp', port: number): string {
  return `${protocol}/${String(port)}`;
}

/** Host checks that fail fast, before anything is touched (spec §5, stage 3). */
export async function runPreflight(
  input: PreflightInput,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  await probe.prepare?.(preflightRequest(input));
  return [
    ...checkVersions(input.versions),
    ...(await checkHome(input.stack, probe)),
    ...(await checkDisk(input.stack, probe)),
    ...(await checkDataRoot(input.stack, probe)),
    ...(await checkDevices(input.stack, probe)),
    ...(await checkPorts(input, probe)),
  ];
}

/** Everything runPreflight will ask the probe, so a probe can look it all up at once. */
export function preflightRequest(input: PreflightInput): ProbeRequest {
  const { stack } = input;
  const data = stack.config.paths.data;
  return {
    stat: unique([
      data,
      ...DATA_SUBDIRS.map((name) => `${data}/${name}`),
      ...devicesNeeded(stack).map((device) => device.hostPath),
    ]),
    free: unique([stack.home, data]),
    ports: portsToCheck(input).map(({ address, port, protocol }) => ({
      address,
      port,
      protocol,
    })),
    sameAsHost: [join(stack.home, STACK_PATH)],
  };
}

/** Each device an app maps in, by its host path. */
function devicesNeeded(stack: ResolvedStack): { app: ResolvedApp; hostPath: string }[] {
  return stack.apps.flatMap((app) =>
    (app.def.extras?.(app.context).devices ?? []).map((device) => ({
      app,
      hostPath: device.split(':')[0] ?? device,
    })),
  );
}

/**
 * Each published port, at each bind address, that must be free: the ones this project's
 * own containers don't already publish.
 */
function portsToCheck(input: PreflightInput): {
  app: ResolvedApp;
  address: string;
  port: number;
  protocol: 'tcp' | 'udp';
}[] {
  return input.stack.apps.flatMap((app) =>
    app.ports.flatMap((port) =>
      input.ownPorts.has(ownPortKey(port.protocol, port.host))
        ? []
        : input.stack.bindAddresses.map((address) => ({
            app,
            address,
            port: port.host,
            protocol: port.protocol,
          })),
    ),
  );
}

/**
 * The home must be the same folder on the Docker host, because the host's daemon resolves
 * every bind mount in compose.yaml (spec §4.1). Only a probe inside a container can tell.
 */
async function checkHome(stack: ResolvedStack, probe: HostProbe): Promise<Diagnostic[]> {
  if ((await probe.sameAsHost?.(join(stack.home, STACK_PATH))) !== false) return [];
  return [
    error(
      'preflight.home-path',
      `the Mediaplane home ${stack.home} is not the same folder on the Docker host, so Docker would mount the wrong files`,
      {
        hint: `mount the home at the same path inside the Mediaplane container as on the host, as mediaplane.compose.yaml does with MEDIAPLANE_HOME (${stack.home}:${stack.home})`,
      },
    ),
  ];
}

/** Compares the first three numeric parts; a leading "v" and suffixes are ignored. */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const parse = (version: string) =>
    version
      .replace(/^v/, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(actual);
  const m = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = m[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** POSIX write permission for uid/gid: owner bits if owner, else group bits, else other. */
export function writableBy(stat: PathStat, uid: number, gid: number): boolean {
  if (uid === 0) return true;
  if (stat.uid === uid) return (stat.mode & 0o200) !== 0;
  if (stat.gid === gid) return (stat.mode & 0o020) !== 0;
  return (stat.mode & 0o002) !== 0;
}

function checkVersions(versions: { engine: string; compose: string }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!versionAtLeast(versions.engine, MIN_DOCKER_ENGINE)) {
    diagnostics.push(
      error(
        'preflight.docker-version',
        `Docker Engine ${versions.engine} is too old; Mediaplane needs ${MIN_DOCKER_ENGINE} or newer`,
        { hint: 'upgrade Docker: https://docs.docker.com/engine/install/' },
      ),
    );
  }
  if (!versionAtLeast(versions.compose, MIN_DOCKER_COMPOSE)) {
    diagnostics.push(
      error(
        'preflight.compose-version',
        `Docker Compose ${versions.compose} is too old; Mediaplane needs ${MIN_DOCKER_COMPOSE} or newer`,
        { hint: "install Docker's docker-compose-plugin package" },
      ),
    );
  }
  return diagnostics;
}

async function checkDisk(stack: ResolvedStack, probe: HostProbe): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const path of unique([stack.home, stack.config.paths.data])) {
    const free = await probe.freeBytes(path);
    if (free === undefined) continue;
    const gib = (free / GIB).toFixed(1);
    if (free < DISK_ERROR_BYTES) {
      diagnostics.push(
        error(
          'preflight.disk-full',
          `only ${gib} GiB free at ${path}; Mediaplane needs at least 2 GiB`,
          {
            hint: 'free up space before applying',
          },
        ),
      );
    } else if (free < DISK_WARNING_BYTES) {
      diagnostics.push(
        warning('preflight.disk-low', `only ${gib} GiB free at ${path}`, {
          hint: 'images and downloads need room; consider freeing space',
        }),
      );
    }
  }
  return diagnostics;
}

async function checkDataRoot(
  stack: ResolvedStack,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  const data = stack.config.paths.data;
  const { uid, gid } = stack.config.user;
  const root = await probe.stat(data);
  if (root === undefined) {
    return [
      error('preflight.data-missing', `the data folder ${data} does not exist`, {
        path: 'paths.data',
        hint: `sudo mkdir -p ${data} && sudo chown ${uid}:${gid} ${data}`,
      }),
    ];
  }
  if (!root.isDirectory) {
    return [
      error(
        'preflight.data-not-directory',
        `the data folder ${data} is not a directory`,
        {
          path: 'paths.data',
        },
      ),
    ];
  }
  const diagnostics: Diagnostic[] = [];
  if (!writableBy(root, uid, gid)) {
    diagnostics.push(
      error(
        'preflight.data-not-writable',
        `the data folder ${data} is not writable by uid ${uid} / gid ${gid}, which the apps run as`,
        { path: 'paths.data', hint: `sudo chown ${uid}:${gid} ${data}` },
      ),
    );
  }
  for (const name of DATA_SUBDIRS) {
    const sub = await probe.stat(`${data}/${name}`);
    if (sub !== undefined && sub.dev !== root.dev) {
      diagnostics.push(
        error(
          'preflight.cross-filesystem',
          `${data}/${name} is on a different filesystem from ${data}, so moves can't be instant hardlinks`,
          {
            path: 'paths.data',
            hint: 'keep downloads and media on one filesystem (one mount) under the data folder',
          },
        ),
      );
    }
  }
  return diagnostics;
}

async function checkDevices(
  stack: ResolvedStack,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { app, hostPath } of devicesNeeded(stack)) {
    const stat = await probe.stat(hostPath);
    if (stat?.isCharacterDevice === true) continue;
    diagnostics.push(
      error(
        'preflight.device-missing',
        `${app.def.name} needs ${hostPath}, which does not exist on this host`,
        {
          path: `apps.${app.def.id}`,
          ...withHint(
            hostPath === '/dev/net/tun'
              ? 'load the TUN module: sudo modprobe tun'
              : undefined,
          ),
        },
      ),
    );
  }
  return diagnostics;
}

async function checkPorts(
  input: PreflightInput,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { app, address, port, protocol } of portsToCheck(input)) {
    if ((await probe.portFree(address, port, protocol)) !== false) continue;
    diagnostics.push(
      error(
        'preflight.port-in-use',
        `${address}:${port}/${protocol}, which ${app.def.name} needs, is already in use on this host`,
        {
          path: `apps.${app.def.id}.port`,
          hint: `stop whatever is using it, or set apps.${app.def.id}.port to a free port`,
        },
      ),
    );
  }
  return diagnostics;
}
