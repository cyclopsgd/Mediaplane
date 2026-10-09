import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const FILE = fileURLToPath(new URL('./mediaplane.compose.yaml', import.meta.url));
const SHIM = fileURLToPath(new URL('./mediaplane', import.meta.url));

interface Service {
  image?: string;
  container_name?: string;
  hostname?: string;
  user?: string;
  init?: boolean;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  command?: string[];
  environment?: Record<string, string>;
  volumes?: unknown[];
  ports?: unknown;
  networks?: string[];
  depends_on?: Record<string, { condition?: string }>;
}

const deployment = parse(readFileSync(FILE, 'utf8')) as {
  name: string;
  services: Record<string, Service | undefined>;
  networks: Record<string, unknown>;
};
const mediaplane = deployment.services.mediaplane ?? {};
const proxy = deployment.services['socket-proxy'] ?? {};
const HOME = '${MEDIAPLANE_HOME:-/opt/mediaplane}';

/** socket-proxy's rules, method → patterns, anchored the way socket-proxy anchors them. */
function allowList(command: readonly string[]): Map<string, RegExp[]> {
  const rules = new Map<string, RegExp[]>();
  for (const arg of command) {
    const match =
      /^-allow(GET|HEAD|POST|PUT|PATCH|DELETE|CONNECT|TRACE|OPTIONS)=(.*)$/.exec(arg);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    rules.set(match[1], [...(rules.get(match[1]) ?? []), new RegExp(`^${match[2]}$`)]);
  }
  return rules;
}
const rules = allowList(proxy.command ?? []);
const allowed = (method: string, path: string): boolean =>
  (rules.get(method) ?? []).some((rule) => rule.test(path));

const ID = 'f'.repeat(64);
/** CI's Docker 28 speaks API 1.51; Docker 29.8 speaks 1.56. */
const V = '/v1.51';

/**
 * Every Docker API call the engine made through a logging proxy on 2026-10-09 (Compose
 * 5.5.1): plan; apply creating, recreating and removing containers and running the chown
 * helper; a pull; and the host helper, including the SIGTERM that its `docker run` client
 * passes on as a kill when the helper times out. socket-proxy matches the path, not the
 * query.
 */
const ENGINE_CALLS: [string, string][] = [
  ['HEAD', '/_ping'],
  ['GET', `${V}/version`],
  ['GET', `${V}/containers/json`],
  ['GET', `${V}/containers/${ID}/json`],
  ['GET', `${V}/images/lscr.io/linuxserver/sonarr:4.0.20.3014-ls326@sha256:${ID}/json`],
  ['GET', `${V}/networks`],
  ['GET', `${V}/networks/mediaplane_default`],
  ['GET', `${V}/volumes`],
  ['POST', `${V}/containers/create`],
  ['POST', `${V}/containers/${ID}/start`],
  ['POST', `${V}/containers/${ID}/stop`],
  ['POST', `${V}/containers/${ID}/rename`],
  ['POST', `${V}/containers/${ID}/attach`],
  ['POST', `${V}/containers/${ID}/wait`],
  ['POST', `${V}/containers/${ID}/kill`],
  ['POST', `${V}/images/create`],
  ['POST', `${V}/networks/create`],
  ['DELETE', `${V}/containers/${ID}`],
];

/** What Compose also calls when compose.override.yaml adds a network or a named volume. */
const OVERRIDE_CALLS: [string, string][] = [
  ['POST', `${V}/networks/proxy-net/connect`],
  ['POST', `${V}/networks/proxy-net/disconnect`],
  ['POST', `${V}/volumes/create`],
  ['GET', `${V}/volumes/media-cache`],
];

/** Calls the engine never makes. The proxy must refuse them (spec §7.2(2)). */
const REFUSED: [string, string][] = [
  ['POST', `${V}/containers/${ID}/exec`],
  ['POST', `${V}/exec/${ID}/start`],
  ['GET', `${V}/containers/${ID}/logs`],
  ['GET', `${V}/containers/${ID}/archive`],
  ['PUT', `${V}/containers/${ID}/archive`],
  ['GET', `${V}/containers/${ID}/export`],
  ['POST', `${V}/containers/${ID}/restart`],
  ['POST', `${V}/containers/${ID}/update`],
  ['POST', `${V}/commit`],
  ['POST', `${V}/build`],
  ['POST', `${V}/images/busybox/push`],
  ['POST', `${V}/images/busybox/tag`],
  ['GET', `${V}/images/busybox/history`],
  ['DELETE', `${V}/images/busybox`],
  ['DELETE', `${V}/networks/mediaplane_default`],
  ['DELETE', `${V}/volumes/media-cache`],
  ['GET', `${V}/info`],
  ['GET', `${V}/system/df`],
  ['GET', `${V}/events`],
  ['POST', `${V}/auth`],
  ['POST', `${V}/swarm/init`],
  ['GET', `${V}/services`],
  ['GET', `${V}/secrets`],
  ['GET', `${V}/configs`],
  ['GET', `${V}/plugins`],
  ['GET', `${V}/distribution/busybox/json`],
  ['POST', '/session'],
];

describe('mediaplane.compose.yaml', () => {
  it('is the mediaplane-system project, which apply never manages', () => {
    expect(deployment.name).toBe('mediaplane-system');
  });

  it('runs Mediaplane hardened, as the home owner, with only the home mounted', () => {
    expect(mediaplane).toMatchObject({
      container_name: 'mediaplane',
      hostname: 'mediaplane',
      user: '${MEDIAPLANE_UID:-1000}:${MEDIAPLANE_GID:-1000}',
      init: true,
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
    });
    expect(mediaplane.image).toMatch(/^\$\{MEDIAPLANE_IMAGE:\?/);
    expect(mediaplane.volumes).toEqual([
      { type: 'bind', source: HOME, target: HOME, bind: { create_host_path: false } },
    ]);
    expect(mediaplane.environment).toEqual({
      MEDIAPLANE_HOME: HOME,
      MEDIAPLANE_IMAGE: mediaplane.image,
      DOCKER_HOST: 'tcp://socket-proxy:2375',
    });
    expect(mediaplane.ports).toBeUndefined();
  });

  it('gives only the proxy the Docker socket, read-only, and publishes nothing', () => {
    expect(proxy.image).toMatch(
      /^wollomatic\/socket-proxy:1\.13\.1@sha256:[0-9a-f]{64}$/,
    );
    expect(proxy.volumes).toEqual(['/var/run/docker.sock:/var/run/docker.sock:ro']);
    expect(proxy).toMatchObject({
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
    });
    expect(proxy.user).toMatch(/^65534:\$\{DOCKER_GID:\?/);
    expect(proxy.command).toContain('-allowfrom=mediaplane');
    expect(proxy.ports).toBeUndefined();
    expect(mediaplane.depends_on).toEqual({
      'socket-proxy': { condition: 'service_healthy' },
    });
  });

  it('puts the two on an internal network of their own', () => {
    expect(deployment.networks).toEqual({ 'docker-api': { internal: true } });
    expect(mediaplane.networks).toEqual(['docker-api']);
    expect(proxy.networks).toEqual(['docker-api']);
  });
});

describe('the socket proxy allow-list', () => {
  it.each(ENGINE_CALLS)('allows %s %s, which the engine calls', (method, path) => {
    expect(allowed(method, path)).toBe(true);
  });

  it.each(OVERRIDE_CALLS)('allows %s %s, for what an override adds', (method, path) => {
    expect(allowed(method, path)).toBe(true);
  });

  it.each(REFUSED)('refuses %s %s', (method, path) => {
    expect(allowed(method, path)).toBe(false);
  });

  it('allows the API at any 1.x version, and without one', () => {
    expect(allowed('GET', '/v1.56/version')).toBe(true);
    expect(allowed('GET', '/version')).toBe(true);
    expect(allowed('GET', '/v2.0/version')).toBe(false);
  });
});

describe('the host shim', () => {
  // A stand-in for docker, first on PATH, that prints its arguments one per line.
  const bin = mkdtempSync(join(tmpdir(), 'mediaplane-shim-'));
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  afterAll(() => {
    rmSync(bin, { recursive: true, force: true });
  });
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    MEDIAPLANE_CONTAINER: '',
    ...extra,
  });
  const dockerArgs = (stdout: string): string[] =>
    stdout.replaceAll('\r', '').trimEnd().split('\n');

  it('is executable', () => {
    expect(statSync(SHIM).mode & 0o111).not.toBe(0);
  });

  it('runs the command in the mediaplane container, without -t off a terminal', () => {
    const result = spawnSync(SHIM, ['plan', '--json'], { env: env(), encoding: 'utf8' });
    expect(dockerArgs(result.stdout)).toEqual([
      'exec',
      '-i',
      'mediaplane',
      'mediaplane',
      'plan',
      '--json',
    ]);
  });

  it('runs it in the container MEDIAPLANE_CONTAINER names', () => {
    const result = spawnSync(SHIM, ['status'], {
      env: env({ MEDIAPLANE_CONTAINER: 'mediaplane-test' }),
      encoding: 'utf8',
    });
    expect(dockerArgs(result.stdout)).toEqual([
      'exec',
      '-i',
      'mediaplane-test',
      'mediaplane',
      'status',
    ]);
  });

  // util-linux's script runs the shim on a pseudo-terminal.
  it.runIf(process.platform === 'linux')(
    'adds -t on a terminal, so apply can ask',
    () => {
      const result = spawnSync(
        'script',
        ['-qec', '"$MEDIAPLANE_SHIM" apply', '/dev/null'],
        {
          env: env({ MEDIAPLANE_SHIM: SHIM }),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(dockerArgs(result.stdout)).toEqual([
        'exec',
        '-i',
        '-t',
        'mediaplane',
        'mediaplane',
        'apply',
      ]);
    },
  );
});
