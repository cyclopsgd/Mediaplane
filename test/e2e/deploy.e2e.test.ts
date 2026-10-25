import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  COMPOSE_PATH,
  createDockerRuntime,
  LOCK_PATH,
  nodeExec,
  readSecretStore,
  writeSecretStore,
  type ExecResult,
} from '@mediaplane/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildImage,
  composeDown,
  docker,
  ejectArguments,
  expectWiringRemoved,
  parseRevealed,
  qbittorrentForm,
  removeAsRoot,
  removeHome,
  REPO,
  setServarrSetting,
  TEARDOWN_MS,
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
function system(args: readonly string[], timeoutMs = 300_000): Promise<ExecResult> {
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
    { env, cwd: '/', timeoutMs },
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

/** `docker compose version --short` on the host, or in the image, through its container. */
async function composeVersion(where: 'host' | 'image'): Promise<string> {
  const args = ['compose', 'version', '--short'];
  const result =
    where === 'host'
      ? await nodeExec('docker', args, { cwd: '/' })
      : await dockerInside(...args);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim().replace(/^v/, '');
}

/** The networks a container is on, as "<name> internal=<true|false>", sorted. */
async function networksOf(container: string): Promise<string[]> {
  const result = await nodeExec(
    'docker',
    [
      'inspect',
      '--format',
      '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}\n{{end}}',
      container,
    ],
    { cwd: '/' },
  );
  expect(result.code, result.stderr).toBe(0);
  const names = result.stdout.split('\n').filter((name) => name !== '');
  const described: string[] = [];
  for (const name of names) {
    const network = await nodeExec(
      'docker',
      ['network', 'inspect', '--format', '{{.Internal}}', name],
      { cwd: '/' },
    );
    described.push(`${name} internal=${network.stdout.trim()}`);
  }
  return described.sort();
}

/**
 * What happened to `container` on the stack's wiring network since `since` (a Unix time,
 * in seconds), as Docker's events say: "connect" and "disconnect", in order.
 */
async function wiringEvents(container: string, since: string): Promise<string[]> {
  const id = await nodeExec('docker', ['inspect', '--format', '{{.Id}}', container], {
    cwd: '/',
  });
  expect(id.code, id.stderr).toBe(0);
  const events = await nodeExec(
    'docker',
    [
      'events',
      '--since',
      since,
      '--until',
      (Date.now() / 1000 + 1).toFixed(3),
      '--filter',
      'type=network',
      '--filter',
      `network=${STACK}_wiring`,
      '--format',
      '{{.Action}} {{index .Actor.Attributes "container"}}',
    ],
    { cwd: '/' },
  );
  expect(events.code, events.stderr).toBe(0);
  return events.stdout
    .split('\n')
    .filter((line) => line.endsWith(` ${id.stdout.trim()}`))
    .map((line) => line.split(' ')[0] ?? '');
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
    const up = await system(['up', '--detach', '--wait']);
    if (up.code !== 0) throw new Error(`mediaplane-system did not start:\n${up.stderr}`);
  }, 1_200_000);

  afterAll(async () => {
    // Each removal runs whether or not the one before it worked (a command that times
    // out rejects, as well as one that fails); then the test fails with what failed.
    // Each command is bounded by TEARDOWN_MS, and this hook's timeout is above their sum.
    const failures: unknown[] = [];
    const attempt = async (removal: () => Promise<unknown>) => {
      try {
        await removal();
      } catch (failure) {
        failures.push(failure);
      }
    };
    const succeeds = async (command: Promise<ExecResult>) => {
      const result = await command;
      expect(result.code, result.stderr).toBe(0);
    };
    // The deployment first: while Mediaplane's container is on the stack's wiring
    // network, the stack's down can't remove that network, and leaves it behind.
    if (override !== '') {
      await attempt(() => succeeds(system(['down', '--remove-orphans'], TEARDOWN_MS)));
    }
    await attempt(() => succeeds(composeDown(STACK)));
    await attempt(() => expectWiringRemoved(STACK));
    if (override !== '') {
      await attempt(() => rm(dirname(override), { recursive: true, force: true }));
    }
    if (home !== '') await attempt(() => removeHome(home));
    if (data !== '') await attempt(() => removeAsRoot(data));
    // Last, once no container uses the image.
    await attempt(() =>
      succeeds(
        nodeExec('docker', ['image', 'rm', TAG], { cwd: '/', timeoutMs: TEARDOWN_MS }),
      ),
    );
    if (failures.length > 0) throw new AggregateError(failures, 'teardown failed');
    // Above the sum of the six bounded commands (6 × TEARDOWN_MS, 720 s).
  }, 900_000);

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
    // It forwards no packets between its networks (the sysctl in
    // mediaplane.compose.yaml): an app on the wiring network could otherwise reach the
    // socket proxy through it.
    const forwarding = await nodeExec(
      'docker',
      ['exec', CONTAINER, 'cat', '/proc/sys/net/ipv4/ip_forward'],
      { cwd: '/' },
    );
    expect(forwarding.code, forwarding.stderr).toBe(0);
    expect(forwarding.stdout.trim()).toBe('0');
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
    // Jellyfin ended published, as Docker itself says, not only the engine's message.
    expect(await docker('port', `${STACK}-jellyfin-1`, '8096/tcp')).toBe(
      '127.0.0.1:8096',
    );

    const second = await mediaplane('apply', '--yes', '--json');
    expect(second.code, second.stdout + second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ outcome: 'no-changes' });
    const again = await mediaplane('plan', '--json');
    expect(again.code, again.stderr).toBe(0);
    expect(codesIn(again.stdout)).not.toContain('project.other-home');
    expect(codesIn(again.stdout)).not.toContain('docker.no-proxy');
    expect(codesIn(again.stdout)).not.toContain('preflight.home-path');
    // Mediaplane in the image reads Jellyfin's system.xml: with Jellyfin's key out of the
    // store, plan lists its setup published, since the wizard is done (apply would only
    // sign in and make a new key). One it couldn't read would say nothing, and plan would
    // start it unpublished. It reads Seerr's settings.json, which uid 1000 owns, too:
    // Seerr's setup is done, so it isn't listed.
    const store = await readSecretStore(home);
    const { jellyfin: _kept, ...others } = store.apps;
    await writeSecretStore(home, { ...store, apps: others });
    const keyless = await mediaplane('plan', '--json');
    await writeSecretStore(home, store);
    expect(keyless.code, keyless.stderr).toBe(2);
    expect((JSON.parse(keyless.stdout) as { bootstrap: unknown }).bootstrap).toEqual([
      { app: 'jellyfin', unpublished: false },
    ]);

    // Slice 8, from the image: drift finds nothing changed; a category changed in Sonarr
    // by hand, it reports it; keep writes it in stack.yaml there, as Mediaplane's user,
    // keeping the file's mode; and drift is clear again.
    const clear = await mediaplane('drift', '--json');
    expect(clear.code, clear.stdout + clear.stderr).toBe(0);
    // Sonarr's download client changed by hand: it files under "television", a category
    // made in qBittorrent first, with the save path Mediaplane gives one of that name.
    await qbittorrentForm(
      8080,
      '/api/v2/torrents/createCategory',
      store.apps.qbittorrent?.apiKey ?? '',
      {
        category: 'television',
        savePath: '/data/torrents/television',
      },
    );
    await setServarrSetting(
      8989,
      '/api/v3/downloadclient',
      store.apps.sonarr?.apiKey ?? '',
      { name: 'tvCategory', value: 'television' },
      [
        ...Object.values(store.apps).flatMap((held) => Object.values(held)),
        store.shared?.adminPassword ?? '',
      ],
    );
    const drifted = await mediaplane('drift', '--json');
    expect(drifted.code, drifted.stderr).toBe(2);
    expect((JSON.parse(drifted.stdout) as { drift: unknown }).drift).toEqual([
      {
        resource: 'sonarr.download_client',
        kind: 'field',
        field: 'category',
        expected: 'tv',
        actual: 'television',
      },
    ]);
    const mode = (await stat(join(home, 'stack.yaml'))).mode & 0o777;
    const kept = await mediaplane('keep', 'sonarr.download_client.category', '--json');
    expect(kept.code, kept.stdout + kept.stderr).toBe(0);
    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(
      `${smallStack(data)}overrides:\n  sonarr.download_client.category: television\n`,
    );
    expect((await stat(join(home, 'stack.yaml'))).mode & 0o777).toBe(mode);
    const cleared = await mediaplane('drift', '--json');
    expect(cleared.code, cleared.stdout + cleared.stderr).toBe(0);

    // Slice 3b, through the proxy: Mediaplane joined the stack's wiring network to set
    // the shared login in Sonarr, and checked qBittorrent's key there. Its container is
    // on two networks, both internal, so it still has no route out. Slice 3c: it linked
    // Sonarr to qBittorrent, and made Sonarr's root folder in a throwaway Sonarr
    // container, through the proxy. Slice 5: it started Jellyfin without its port, set it
    // up, then published it, all through the proxy, and Sonarr tells it of imports.
    // Slice 6: Seerr too, signed in through Jellyfin, then linked to it and to Sonarr.
    const applied = JSON.parse(first.stdout) as {
      plan: { bootstrap: { app: string; unpublished: boolean }[] };
      actions: { step: string; resource?: string; detail?: string }[];
    };
    expect(applied.plan.bootstrap).toEqual([
      { app: 'jellyfin', unpublished: true },
      { app: 'seerr', unpublished: true },
    ]);
    expect(applied.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
      'set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr',
    );
    expect(
      applied.actions
        .filter((a) => a.resource !== undefined)
        .map((a) => [a.resource, a.detail]),
    ).toEqual([
      ['jellyfin.admin', 'adopted'],
      ['jellyfin.library_movies', 'created'],
      ['jellyfin.library_shows', 'created'],
      ['qbittorrent.admin', 'adopted'],
      ['qbittorrent.preferences', 'adopted'],
      ['qbittorrent.category_tv', 'created'],
      ['sonarr.admin', 'created'],
      ['sonarr.download_client', 'created'],
      ['sonarr.root_folder', 'created'],
      ['sonarr.connection_jellyfin', 'created'],
      ['seerr.media_server', 'updated libraries'],
      ['seerr.server_sonarr', 'created'],
      ['seerr.setup', 'updated initialized'],
    ]);
    // Seerr ended published too, as Docker says.
    expect(await docker('port', `${STACK}-seerr-1`, '5055/tcp')).toBe('127.0.0.1:5055');
    expect((await stat(join(data, 'media', 'tv'))).isDirectory()).toBe(true);
    const shown = await mediaplane('credentials', '--json', '--reveal');
    expect(shown.code, shown.stderr).toBe(0);
    const login = parseRevealed(shown.stdout);
    const signIn = await fetch('http://127.0.0.1:8989/login', {
      method: 'POST',
      body: new URLSearchParams({ username: login.username, password: login.password }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    expect([signIn.status, signIn.headers.get('location')]).toEqual([302, '/']);
    expect(await networksOf(CONTAINER)).toEqual([
      `${STACK}_wiring internal=true`,
      `${SYSTEM}_docker-api internal=true`,
    ]);
    const routes = await nodeExec('docker', ['exec', CONTAINER, 'ip', 'route'], {
      cwd: '/',
    });
    expect(routes.code, routes.stderr).toBe(0);
    expect(routes.stdout).not.toMatch(/^default /m);
    // An apply that recreates an app steps off the network for up, and back on after:
    // network disconnect and connect, through the proxy.
    const since = (Date.now() / 1000).toFixed(3);
    await writeFile(
      join(home, 'stack.yaml'),
      smallStack(data).replace(
        '  sonarr: {}',
        '  sonarr: { env: { FAKE_SETTING: "1" } }',
      ),
    );
    const changed = await mediaplane('apply', '--yes', '--json');
    expect(changed.code, changed.stdout + changed.stderr).toBe(0);
    const recreated = JSON.parse(changed.stdout) as {
      outcome: string;
      plan: { containers: { service: string; action: string }[] };
    };
    expect(recreated.outcome).toBe('success');
    expect(recreated.plan.containers).toContainEqual({
      service: 'sonarr',
      action: 'recreate',
    });
    expect(await networksOf(CONTAINER)).toContain(`${STACK}_wiring internal=true`);
    expect(await wiringEvents(CONTAINER, since)).toEqual(['disconnect', 'connect']);
    const settled = await mediaplane('plan', '--json');
    expect(settled.code, settled.stdout).toBe(0);

    // Ejectable (success criterion 6): the header's command, run on the host, runs the
    // stack without Mediaplane. An empty override makes its second -f real.
    await writeFile(join(home, 'compose.override.yaml'), 'services: {}\n');
    const sameCompose =
      (await composeVersion('host')) === (await composeVersion('image'));
    const header = await readFile(join(home, COMPOSE_PATH), 'utf8');
    const before = await runtime.containers();
    const eject = await nodeExec('docker', ejectArguments(header, STACK), { cwd: '/' });
    expect(eject.code, eject.stderr).toBe(0);
    const ejected = await runtime.containers();
    if (sameCompose) {
      // The image's own Compose made the containers, so the hashes match: nothing is
      // recreated.
      expect(ejected.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
    } else {
      // Another Compose version can hash the same bind volumes differently, and then
      // recreates each container that has one, once (ADR 0010: Compose 2.38 adds
      // create_host_path). The same services must still end up running.
      const services = (list: typeof containers) =>
        list.map((c) => `${c.service} ${c.state}`).sort();
      expect(services(ejected)).toEqual(services(containers));
    }
  }, 1_200_000);

  it("reaches plex.tv for plex-login through its helper, on Docker's default bridge, through the proxy", async () => {
    // A home of its own, inside Mediaplane's, with a Plex stack: plex-login reads plex.token.
    const plexHome = join(home, 'plex-login');
    await mkdir(plexHome);
    await writeFile(
      join(plexHome, 'stack.yaml'),
      'version: 1\npaths: { data: /srv/data }\nmedia_server: plex\nplex: { token: { file: secrets/plex-token } }\n',
    );
    const result = await mediaplane(
      'plex-login',
      '--home',
      plexHome,
      '--timeout',
      '4',
      '--json',
    );
    // A real PIN from plex.tv, asked for and waited on by the helper: nobody signs in. A
    // plex.tv that is down (no answer, or a 5xx from behind its CDN), or too busy (a 429),
    // is said so, from inside the helper too: either way the path through the proxy and
    // the default bridge was taken, and neither fails a pull request. Only a link is
    // checked, when there was one.
    expect(result.code, result.stderr).toBe(1);
    const said = (JSON.parse(result.stdout) as { error: { message: string } }).error
      .message;
    const waited =
      'nobody signed in within 4 seconds; run plex-login again for a new link';
    expect(
      said === waited ||
        said.startsWith("couldn't reach plex.tv: ") ||
        /^plex\.tv answered( with HTTP \d+)?; /.test(said),
      `plex-login said: ${said}`,
    ).toBe(true);
    if (said === waited) {
      expect(result.stderr).toMatch(
        /https:\/\/app\.plex\.tv\/auth#\?clientID=mediaplane-[0-9a-f-]{36}&code=\w{25}&/,
      );
    }
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
    });
    // Each helper ran, and is gone: none is left, by its label.
    const left = await nodeExec(
      'docker',
      ['ps', '--all', '--quiet', '--filter', 'label=io.mediaplane.helper=plex-tv'],
      { cwd: '/' },
    );
    expect(left.stdout.trim()).toBe('');
    await rm(plexHome, { recursive: true });
  });

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
