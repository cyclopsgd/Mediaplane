import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from '@mediaplane/catalog';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const FILE = fileURLToPath(new URL('./mediaplane.compose.yaml', import.meta.url));
const SHIM = fileURLToPath(new URL('./mediaplane', import.meta.url));
const INSTALL = fileURLToPath(new URL('./install.sh', import.meta.url));

interface Service {
  image?: string;
  container_name?: string;
  hostname?: string;
  user?: string;
  init?: boolean;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  sysctls?: Record<string, string>;
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
/** socket-proxy matches the decoded path (Go's URL.Path), so %2e%2e arrives as "..". */
const allowed = (method: string, path: string): boolean =>
  (rules.get(method) ?? []).some((rule) => rule.test(decodeURIComponent(path)));

const ID = 'f'.repeat(64);
/** CI's Docker 28 speaks API 1.51; Docker 29.8 speaks 1.56. */
const V = '/v1.51';

/**
 * Every Docker API call the engine made through a logging proxy on 2026-10-09 (Compose
 * 5.5.1): plan; apply creating, recreating and removing containers and running the chown
 * helper; a pull; and the host helper, including the SIGTERM that its `docker run` client
 * passes on as a kill when the helper times out. socket-proxy matches the path, not the
 * query. vpn-check (Slice 3d) adds none: its probe is a `compose run` like the chown
 * helper, its `container inspect` is `GET containers/{id}/json`, and its host side is the
 * host helper. Slice 3b adds no permission either (ADR 0011): Compose attaches the apps to
 * the wiring network when it creates them, Mediaplane joins and leaves it with the network
 * connect and disconnect the list already allowed for an override's networks, and a
 * stranded qBittorrent is stopped, then started by `up`: `compose stop` lists and stops
 * containers, as `up` already does when it recreates one. test/e2e/deploy.e2e.test.ts
 * runs the join and the leave through the real proxy.
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
  // Mediaplane's own container on the stack's wiring network (Slice 3b): it reads the
  // network by name, then joins and leaves it by the ID it read, so it acts on the network
  // it checked.
  ['GET', `${V}/networks/mediaplane_wiring`],
  ['POST', `${V}/networks/${ID}/connect`],
  ['POST', `${V}/networks/${ID}/disconnect`],
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
  // Paths that climb out of images/: only the daemon's router would stop them.
  ['GET', `${V}/images/a/../../info/json`],
  ['GET', `${V}/images/a/%2e%2e/%2e%2e/info/json`],
  ['GET', `${V}/images/../containers/${ID}/json`],
  ['GET', `${V}/images/./busybox/json`],
  // Prunes, pause and unpause, and loading and saving images.
  ['POST', `${V}/containers/prune`],
  ['POST', `${V}/images/prune`],
  ['POST', `${V}/networks/prune`],
  ['POST', `${V}/volumes/prune`],
  ['POST', `${V}/build/prune`],
  ['POST', `${V}/containers/${ID}/pause`],
  ['POST', `${V}/containers/${ID}/unpause`],
  ['POST', `${V}/images/load`],
  ['GET', `${V}/images/get`],
  ['GET', `${V}/images/busybox/get`],
  // Boundaries: socket-proxy anchors each pattern, so a longer path is not a match.
  ['GET', `${V}/versionx`],
  ['POST', `${V}/containers/create/x`],
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
      // The host's zone, for init's default. Never empty: Node reads an empty TZ as
      // Etc/Unknown, which stack.yaml would accept.
      TZ: '${TZ:-UTC}',
    });
    expect(mediaplane.ports).toBeUndefined();
  });

  it('does not forward packets: on two networks, it must not route between them', () => {
    // Joined to the stack's wiring network as well as docker-api, Mediaplane would
    // otherwise be a router for a container on wiring that has NET_ADMIN. IPv4 only:
    // neither network has IPv6, and the IPv6 key fails on a host with IPv6 turned off.
    expect(mediaplane.sysctls).toEqual({ 'net.ipv4.ip_forward': '0' });
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

  // The Docker CLI and Compose escape none of / : @ in a path, so these arrive as written.
  it.each([
    ...catalog.map((def) => `${def.image.repo}:${def.image.tag}@${def.image.digest}`),
    'registry.example:5000/team/mediaplane:0.1.0',
    'mediaplane:local',
    `sha256:${ID}`,
  ])('allows inspecting the image %s', (reference) => {
    expect(allowed('GET', `${V}/images/${reference}/json`)).toBe(true);
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

describe('the installer', () => {
  /**
   * A checkout of its own, with stand-ins first on PATH: docker answers as `versions` say and
   * logs every call, sudo logs and runs, and id answers `uid`. The home and the command's
   * folder are under the same temporary folder, and the Docker socket is a real socket.
   */
  async function sandbox(
    options: {
      engine?: string;
      compose?: string;
      rootless?: boolean;
      uid?: string;
      env?: string;
      home?: 'missing' | 'locked';
    } = {},
  ) {
    const top = mkdtempSync(join(tmpdir(), 'mediaplane-install-'));
    const deploy = join(top, 'checkout', 'deploy');
    const bin = join(top, 'bin');
    const commands = join(top, 'usr-local-bin');
    for (const dir of [deploy, bin, commands]) mkdirSync(dir, { recursive: true });
    for (const name of ['install.sh', 'mediaplane', 'mediaplane.compose.yaml']) {
      copyFileSync(
        fileURLToPath(new URL(`./${name}`, import.meta.url)),
        join(deploy, name),
      );
    }
    chmodSync(join(deploy, 'install.sh'), 0o755);
    chmodSync(join(deploy, 'mediaplane'), 0o755);
    if (options.env !== undefined) writeFileSync(join(deploy, '.env'), options.env);
    const log = join(top, 'calls.log');
    const engine = options.engine ?? '29.8.0';
    const compose = options.compose ?? '2.38.2';
    const security =
      options.rootless === true ? '[name=seccomp name=rootless]' : '[name=seccomp]';
    writeFileSync(
      join(bin, 'docker'),
      `#!/bin/sh
printf 'docker %s\\n' "$*" >> '${log}'
case "$*" in
  'version --format {{.Server.Version}}') echo '${engine}' ;;
  'compose version --short') echo '${compose}' ;;
  'info --format {{.SecurityOptions}}') echo '${security}' ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'sudo'),
      `#!/bin/sh\nprintf 'sudo %s\\n' "$*" >> '${log}'\nexec "$@"\n`,
      { mode: 0o755 },
    );
    if (options.uid !== undefined) {
      writeFileSync(
        join(bin, 'id'),
        `#!/bin/sh\nif [ "$1" = -u ]; then echo ${options.uid}; else exec /usr/bin/id "$@"; fi\n`,
        { mode: 0o755 },
      );
    }
    const home = join(top, 'home');
    if (options.home === 'locked') {
      mkdirSync(home);
      chmodSync(home, 0o555);
    }
    const socketPath = join(top, 'docker.sock');
    const server = createServer();
    await new Promise<void>((done) => server.listen(socketPath, done));
    const runIt = () => {
      const result = spawnSync(join(deploy, 'install.sh'), [], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${commands}:${process.env.PATH ?? ''}`,
          MEDIAPLANE_HOME: home,
          MEDIAPLANE_BIN_DIR: commands,
          MEDIAPLANE_DOCKER_SOCKET: socketPath,
          MEDIAPLANE_IMAGE: '',
        },
      });
      return {
        code: result.status,
        out: result.stdout,
        err: result.stderr,
        calls: existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [],
      };
    };
    const cleanup = () => {
      server.close();
      if (options.home === 'locked') chmodSync(home, 0o755);
      rmSync(top, { recursive: true, force: true });
    };
    return { top, deploy, home, commands, run: runIt, cleanup };
  }

  it('is executable, and plain sh', () => {
    expect(statSync(INSTALL).mode & 0o111).not.toBe(0);
    expect(readFileSync(INSTALL, 'utf8').split('\n')[0]).toBe('#!/bin/sh');
    expect(spawnSync('sh', ['-n', INSTALL]).status).toBe(0);
  });

  it('builds, makes the home, writes deploy/.env, starts Mediaplane and installs the command', async () => {
    const box = await sandbox();
    try {
      const result = box.run();
      expect(result.code, result.err).toBe(0);
      expect(result.calls).toContain(
        `docker build --tag mediaplane:local ${join(box.top, 'checkout')}`,
      );
      expect(result.calls).toContain(
        `docker compose -f ${join(box.deploy, 'mediaplane.compose.yaml')} up -d`,
      );
      expect(statSync(box.home).isDirectory()).toBe(true);
      const env = readFileSync(join(box.deploy, '.env'), 'utf8');
      expect(env).toContain('MEDIAPLANE_IMAGE=mediaplane:local\n');
      expect(env).toMatch(/^MEDIAPLANE_UID=\d+$/m);
      expect(env).toMatch(/^DOCKER_GID=\d+$/m);
      expect(env).toContain(`MEDIAPLANE_HOME=${box.home}\n`);
      expect(readFileSync(join(box.commands, 'mediaplane'), 'utf8')).toBe(
        readFileSync(SHIM, 'utf8'),
      );
      // Not on a terminal: it says what's next rather than asking.
      expect(result.out).toContain(
        `Next: "mediaplane init --home ${box.home}" asks a few questions`,
      );
      // Everything went in without root here, so it never asked for sudo.
      expect(result.calls.filter((call) => call.startsWith('sudo'))).toEqual([]);
    } finally {
      box.cleanup();
    }
  });

  it('keeps a deploy/.env that is there, and says plan next once there is a stack', async () => {
    const box = await sandbox({ env: 'MEDIAPLANE_IMAGE=mediaplane:local\nTZ=Etc/UTC\n' });
    try {
      mkdirSync(box.home);
      writeFileSync(join(box.home, 'stack.yaml'), 'version: 1\n');
      const result = box.run();
      expect(result.code, result.err).toBe(0);
      expect(readFileSync(join(box.deploy, '.env'), 'utf8')).toBe(
        'MEDIAPLANE_IMAGE=mediaplane:local\nTZ=Etc/UTC\n',
      );
      expect(result.out).toContain('Keeping your deploy/.env as it is.');
      expect(result.out).toContain('Next: "mediaplane plan" checks your stack');
    } finally {
      box.cleanup();
    }
  });

  it.each([
    [{ uid: '0' }, 'run this as your normal user, not root'],
    [
      { engine: '23.0.6' },
      'Docker Engine 23.0.6 is too old: Mediaplane needs 24 or newer',
    ],
    [
      { compose: 'v2.20.3' },
      'Docker Compose v2.20.3 is too old: Mediaplane needs 2.24 or newer',
    ],
    [{ rootless: true }, 'this Docker is rootless'],
  ] as const)('refuses %o before it changes anything', async (options, said) => {
    const box = await sandbox(options);
    try {
      const result = box.run();
      expect(result.code).toBe(1);
      expect(result.err).toContain(said);
      expect(result.calls.some((call) => / build | up -d/.test(` ${call}`))).toBe(false);
      expect(existsSync(join(box.deploy, '.env'))).toBe(false);
      expect(existsSync(box.home)).toBe(false);
    } finally {
      box.cleanup();
    }
  });

  it('accepts Compose 5 and Engine 28', async () => {
    const box = await sandbox({ engine: '28.5.1', compose: '5.5.1' });
    try {
      expect(box.run().code).toBe(0);
    } finally {
      box.cleanup();
    }
  });

  it.runIf(process.getuid?.() !== 0)(
    'stops, with the command to run, at a home that is not yours to write',
    async () => {
      const box = await sandbox({ home: 'locked' });
      try {
        const result = box.run();
        expect(result.code).toBe(1);
        expect(result.err).toContain(`${box.home} isn't yours to write`);
        expect(result.calls.some((call) => call.includes('up -d'))).toBe(false);
      } finally {
        box.cleanup();
      }
    },
  );
});
