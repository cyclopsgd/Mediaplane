import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  COMPOSE_PATH,
  createDockerRuntime,
  LOCK_PATH,
  nodeExec,
  type ExecResult,
} from '@mediaplane/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildImage,
  composeDown,
  ejectArguments,
  removeAsRoot,
  removeHome,
  REPO,
} from './helpers';

const ID = `mediaplane-e2e-${String(process.pid)}`;
const TAG = `mediaplane-e2e:${String(process.pid)}-deploy`;
/** Mediaplane's own project, deployed from mediaplane.compose.yaml. */
const SYSTEM = `${ID}-system`;
/** The stack Mediaplane manages from inside its container. */
const STACK = `${ID}-stack`;
const CONTAINER = `${ID}-mediaplane`;
const DEPLOY = join(REPO, 'deploy', 'mediaplane.compose.yaml');
const SHIM = join(REPO, 'deploy', 'mediaplane');
const UID = String(process.getuid?.() ?? 1000);
const GID = String(process.getgid?.() ?? 1000);

/**
 * Enough of the stack to create, chown and wait through the proxy. Seerr needs its appdata
 * chowned, and Sonarr, qBittorrent and Jellyfin are what Seerr needs. The data folder sits
 * outside the home, so only the host helper can see it.
 */
function smallStack(data: string): string {
  return `version: 1
user: { uid: ${UID}, gid: ${GID} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;
}

let home = '';
let data = '';
let override = '';
let env: NodeJS.ProcessEnv = {};

/** docker compose on Mediaplane's own project, as a user would run it. */
function system(...args: string[]): Promise<ExecResult> {
  return nodeExec(
    'docker',
    [
      'compose',
      '-p',
      SYSTEM,
      '--env-file',
      '/dev/null',
      '-f',
      DEPLOY,
      '-f',
      override,
      ...args,
    ],
    { env, cwd: '/', timeoutMs: 300_000 },
  );
}

/** A mediaplane command, run in its container through the host shim. */
function mediaplane(...args: string[]): Promise<ExecResult> {
  return nodeExec('sh', [SHIM, ...args], {
    env: { ...process.env, MEDIAPLANE_CONTAINER: CONTAINER },
    cwd: '/',
    timeoutMs: 1_200_000,
  });
}

/** A docker command run inside the Mediaplane container, so it goes through the proxy. */
function dockerInside(...args: string[]): Promise<ExecResult> {
  return nodeExec('docker', ['exec', CONTAINER, 'docker', ...args], { cwd: '/' });
}

function codesIn(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as { diagnostics: { code: string }[] };
  return parsed.diagnostics.map((d) => d.code);
}

function close(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => {
      done();
    });
  });
}

describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
  beforeAll(async () => {
    await buildImage(TAG);
    home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    data = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-data-'));
    await writeFile(join(home, 'stack.yaml'), smallStack(data));
    override = join(
      await mkdtemp(join(tmpdir(), 'mediaplane-e2e-system-')),
      'override.yaml',
    );
    await writeFile(
      override,
      [
        'services:',
        '  mediaplane:',
        `    container_name: ${CONTAINER}`,
        '    environment:',
        `      MEDIAPLANE_COMPOSE_PROJECT: ${STACK}`,
        '',
      ].join('\n'),
    );
    env = {
      ...process.env,
      MEDIAPLANE_IMAGE: TAG,
      MEDIAPLANE_HOME: home,
      MEDIAPLANE_UID: UID,
      MEDIAPLANE_GID: GID,
      DOCKER_GID: String((await stat('/var/run/docker.sock')).gid),
    };
    const up = await system('up', '--detach', '--wait');
    if (up.code !== 0) throw new Error(`mediaplane-system did not start:\n${up.stderr}`);
  }, 1_200_000);

  afterAll(async () => {
    const stackDown = await composeDown(STACK);
    const systemDown =
      override === '' ? undefined : await system('down', '--remove-orphans');
    if (override !== '') await rm(dirname(override), { recursive: true, force: true });
    if (home !== '') await removeHome(home);
    if (data !== '') await removeAsRoot(data);
    const image = await nodeExec('docker', ['image', 'rm', TAG], { cwd: '/' });
    expect(stackDown.code, stackDown.stderr).toBe(0);
    if (systemDown !== undefined) expect(systemDown.code, systemDown.stderr).toBe(0);
    expect(image.code, image.stderr).toBe(0);
  }, 300_000);

  it('runs hardened, as the home owner, without the Docker socket', async () => {
    const inspect = await nodeExec('docker', ['inspect', CONTAINER], { cwd: '/' });
    const [info] = JSON.parse(inspect.stdout) as {
      Config: { User: string; Hostname: string };
      HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[]; SecurityOpt: string[] };
      Mounts: { Source: string; Destination: string; RW: boolean }[];
    }[];
    expect(info?.Config).toMatchObject({ User: `${UID}:${GID}`, Hostname: 'mediaplane' });
    expect(info?.HostConfig).toMatchObject({
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
    });
    expect(info?.Mounts.map((m) => [m.Source, m.Destination, m.RW])).toEqual([
      [home, home, true],
    ]);
    const socket = await nodeExec(
      'docker',
      ['exec', CONTAINER, 'test', '-e', '/var/run/docker.sock'],
      { cwd: '/' },
    );
    expect(socket.code).toBe(1);
  });

  it("sees the host's own ports through the host helper", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(8989, '127.0.0.1', done));
    try {
      const result = await mediaplane('plan', '--json');
      expect(result.code, result.stderr).toBe(1);
      const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: unknown[] };
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'preflight.port-in-use',
          path: 'apps.sonarr.port',
        }),
      );
    } finally {
      await close(server);
    }
  });

  it('refuses a home that is not the same folder on the host', async () => {
    // A home only this container has, in its own /dev/shm. The host helper looks for its
    // stack.yaml on the host, through its read-only bind of the host's /dev, and finds none.
    const elsewhere = `/dev/shm/${ID}`;
    const copy = await nodeExec(
      'docker',
      [
        'exec',
        CONTAINER,
        'sh',
        '-c',
        'mkdir "$1" && cp "$2" "$1"/',
        'sh',
        elsewhere,
        join(home, 'stack.yaml'),
      ],
      { cwd: '/' },
    );
    expect(copy.code, copy.stderr).toBe(0);
    const result = await mediaplane('plan', '--home', elsewhere, '--json');
    expect(result.code, result.stderr).toBe(1);
    expect(codesIn(result.stdout)).toContain('preflight.home-path');
  });

  it('applies through the proxy, clearing a lock its previous container left, and can be ejected', async () => {
    // A lock from a container that no longer runs: the same fixed hostname, a dead pid.
    await mkdir(join(home, 'state'), { mode: 0o700 });
    await writeFile(
      join(home, LOCK_PATH),
      `${JSON.stringify({ pid: 999_999, host: 'mediaplane', startedAt: '2026-10-09T00:00:00.000Z' })}\n`,
      { mode: 0o600 },
    );
    const first = await mediaplane('apply', '--yes', '--json');
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ outcome: 'success' });

    const runtime = createDockerRuntime({ home, project: STACK });
    const containers = await runtime.containers();
    expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual([
      'jellyfin running healthy',
      'qbittorrent running healthy',
      'seerr running healthy',
      'sonarr running healthy',
    ]);
    // The chown helper ran through the proxy.
    expect((await stat(join(home, 'appdata', 'seerr'))).uid).toBe(1000);

    const second = await mediaplane('apply', '--yes', '--json');
    expect(JSON.parse(second.stdout)).toMatchObject({ outcome: 'no-changes' });
    const again = await mediaplane('plan', '--json');
    expect(again.code, again.stderr).toBe(0);
    expect(codesIn(again.stdout)).not.toContain('project.other-home');
    expect(codesIn(again.stdout)).not.toContain('docker.no-proxy');
    expect(codesIn(again.stdout)).not.toContain('preflight.home-path');

    // Ejectable (success criterion 6): the header's command, run on the host, recreates
    // nothing. An empty override makes its second -f real.
    await writeFile(join(home, 'compose.override.yaml'), 'services: {}\n');
    const ids = containers.map((c) => c.id).sort();
    const header = await readFile(join(home, COMPOSE_PATH), 'utf8');
    const eject = await nodeExec('docker', ejectArguments(header, STACK), { cwd: '/' });
    expect(eject.code, eject.stderr).toBe(0);
    expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(ids);
  }, 1_200_000);

  it('refuses the Docker calls the engine never makes', async () => {
    const containers = await createDockerRuntime({ home, project: STACK }).containers();
    const sonarr = containers.find((c) => c.service === 'sonarr');
    expect(sonarr).toBeDefined();
    const refused = [
      ['exec', sonarr?.id ?? 'missing', 'true'],
      ['info'],
      ['system', 'df'],
      ['volume', 'rm', `${ID}-none`],
      ['network', 'rm', `${ID}-none`],
    ];
    for (const args of refused) {
      const result = await dockerInside(...args);
      expect(result.code, args.join(' ')).not.toBe(0);
      expect(result.stdout + result.stderr, args.join(' ')).toContain('Forbidden');
    }
    // What the engine does call still works from the same place.
    const ps = await dockerInside('compose', '-p', STACK, 'ps', '--format', 'json');
    expect(ps.code, ps.stderr).toBe(0);
  });
});
