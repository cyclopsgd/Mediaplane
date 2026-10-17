import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  collectHostReport,
  COMPOSE_PATH,
  composeToYaml,
  ENV_PATH,
  invokingUser,
  nodeProbe,
  planStack,
  prestartFilesFor,
  readResources,
  readSecretStore,
  renderEnvFile,
  RESOURCES_PATH,
  secretValues,
  withGeneratedSecrets,
  writePrestartFiles,
  writeResources,
  writeSecretStore,
  type ContainerState,
  type HostRequest,
  type KnownResources,
  type Runtime,
  type SecretStore,
} from '@mediaplane/engine';
import {
  FAKE_JELLYFIN_USER_ID,
  FIXTURE_HOST,
  fakeDocker,
  claimFakePlex,
  fakeJellyfinSetUp,
  FAKE_PLEX_ACCOUNT,
  FAKE_SERVER_TOKEN,
  fakePlexTv,
  fakeProbe,
  fakeRuntime,
  fakeStackApis,
  freshAppState,
  running,
  SET_UP_JELLYFIN,
  tempDir,
  thrown,
} from '@mediaplane/engine/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptCancelled } from './prompt';
import { EXIT_CODES, run, type CliDeps, type Io } from './run';
import { VERSION } from './version';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

const SERVICES = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'];
const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64)]));

/** Where the home's Jellyfin keeps system.xml, as the image does. */
const jellyfinConfig = (home: string) => join(home, 'appdata', 'jellyfin');

/** A home of the test stack, whose fake Jellyfin, as it first starts, keeps its files. */
async function makeHome(stack = STACK): Promise<string> {
  const home = await tempDir('mediaplane-cli-');
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  await writeFile(join(home, 'stack.yaml'), stack);
  apis.apps.set('jellyfin', { ...freshAppState(), configDir: jellyfinConfig(home) });
  return home;
}

const AT = '2026-10-10T12:00:00.000Z';

/** The key Jellyfin made for Mediaplane, in a home of the test stack set up already. */
const JELLYFIN_KEY = SET_UP_JELLYFIN.key;

/** Jellyfin's libraries, as resources.json records them and Jellyfin holds them. */
const LIBRARIES = [
  ['library_movies', 'Movies', 'movies', '/data/media/movies'],
  ['library_shows', 'Shows', 'tvshows', '/data/media/tv'],
] as const;

/** What resources.json records once the test stack is wired, as the fake apps hold it. */
const WIRED: KnownResources = {
  'jellyfin.admin': {
    id: FAKE_JELLYFIN_USER_ID,
    name: 'admin',
    fields: { username: 'admin' },
    secrets: ['password'],
    appliedAt: AT,
  },
  ...Object.fromEntries(
    LIBRARIES.map(([resource, name, collectionType, paths]) => [
      `jellyfin.${resource}`,
      {
        id: name,
        name,
        fields: { name, collectionType, paths },
        secrets: [],
        appliedAt: AT,
      },
    ]),
  ),
  'qbittorrent.admin': {
    id: null,
    name: 'admin',
    fields: { username: 'admin' },
    secrets: ['password'],
    appliedAt: AT,
  },
  'qbittorrent.category_tv': {
    id: 'tv',
    name: 'tv',
    fields: { savePath: '/data/torrents/tv' },
    secrets: [],
    appliedAt: AT,
  },
  'qbittorrent.preferences': {
    id: null,
    name: 'preferences',
    fields: {
      savePath: '/data/torrents',
      autoTmm: true,
      authSubnetWhitelistEnabled: false,
      authSubnetWhitelist: '',
    },
    secrets: [],
    appliedAt: AT,
  },
  'sonarr.admin': {
    id: null,
    name: 'admin',
    fields: { username: 'admin' },
    secrets: ['password'],
    appliedAt: AT,
  },
  'sonarr.download_client': {
    id: 1,
    name: 'qBittorrent (Mediaplane)',
    fields: { host: 'gluetun', port: 8080, useSsl: false, category: 'tv', enable: true },
    secrets: ['apiKey'],
    appliedAt: AT,
  },
  'sonarr.root_folder': {
    id: 1,
    name: '/data/media/tv',
    fields: { path: '/data/media/tv' },
    secrets: [],
    appliedAt: AT,
  },
  'sonarr.connection_jellyfin': {
    id: 1,
    name: 'Jellyfin (Mediaplane)',
    fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
    secrets: ['apiKey'],
    appliedAt: AT,
  },
};

/** All zeros: the keys currentHome stores are never printed, so their value is moot. */
const zeros = (size: number) => Buffer.alloc(size, 0);

/** A home whose generated files and stored keys are what plan expects, as of `runtime`. */
async function currentHome(
  runtime: Runtime,
  { prestart = true }: { prestart?: boolean } = {},
): Promise<string> {
  const home = await makeHome();
  const { context } = await planStack({
    home,
    catalog,
    host: FIXTURE_HOST,
    env: {},
    runtime: reachingFakeApis(runtime),
    probe: fakeProbe(),
    wiring: apis.seams,
  });
  if (context === undefined) throw new Error('the test stack must plan');
  const generated = withGeneratedSecrets(context.stack, context.store, zeros).store;
  // Jellyfin's key, which it made in its first-run setup.
  const store: SecretStore = {
    ...generated,
    apps: { ...generated.apps, jellyfin: { apiKey: JELLYFIN_KEY } },
  };
  await writeSecretStore(home, store);
  await mkdir(join(home, 'generated'));
  await writeFile(join(home, COMPOSE_PATH), composeToYaml(context.compose, home));
  await writeFile(
    join(home, ENV_PATH),
    renderEnvFile(await secretValues(context.stack, store, {})),
  );
  if (prestart) {
    const files = await prestartFilesFor(context.stack, store, {}, zeros);
    await writePrestartFiles(home, files);
    // Jellyfin finished its startup wizard, and says so in its system.xml.
    await mkdir(jellyfinConfig(home), { recursive: true });
    await writeFile(
      join(jellyfinConfig(home), 'system.xml'),
      '<ServerConfiguration>\n  <IsStartupWizardCompleted>true</IsStartupWizardCompleted>\n</ServerConfiguration>\n',
    );
  }
  // The apps hold what the stack wants, as resources.json records: Jellyfin set up as
  // Mediaplane sets it up, with the stack's admin password.
  const password = store.shared?.adminPassword ?? '';
  apis.apps.set(
    'jellyfin',
    fakeJellyfinSetUp({
      password,
      libraries: LIBRARIES.map(([, name, collectionType, path]) => ({
        Name: name,
        CollectionType: collectionType,
        Locations: [path],
        LibraryOptions: {},
      })),
      folders: LIBRARIES.map(([, , , path]) => path),
      ...(prestart ? { configDir: jellyfinConfig(home) } : {}),
    }),
  );
  // qBittorrent takes only the stack's key, and gives it back among its preferences.
  const key = store.apps.qbittorrent?.apiKey;
  if (key === undefined) throw new Error('the test stack must store a qBittorrent key');
  apis.apps.set('sonarr', {
    ...freshAppState(),
    user: 'admin',
    password,
    downloadClients: [
      {
        id: 1,
        name: 'qBittorrent (Mediaplane)',
        enable: true,
        implementation: 'QBittorrent',
        priority: 1,
        fields: [
          { name: 'host', value: 'gluetun' },
          { name: 'port', value: 8080 },
          { name: 'useSsl', value: false },
          { name: 'apiKey', value: key },
          { name: 'tvCategory', value: 'tv' },
        ],
      },
    ],
    rootFolders: [{ id: 1, path: '/data/media/tv' }],
    connections: [
      {
        id: 1,
        name: 'Jellyfin (Mediaplane)',
        implementation: 'MediaBrowser',
        onDownload: true,
        fields: [
          { name: 'host', value: 'jellyfin' },
          { name: 'port', value: 8096 },
          { name: 'useSsl', value: false },
          { name: 'apiKey', value: JELLYFIN_KEY },
          { name: 'updateLibrary', value: true },
        ],
      },
    ],
  });
  apis.apps.set('qbittorrent', {
    ...freshAppState(),
    user: 'admin',
    password,
    key,
    categories: { tv: '/data/torrents/tv' },
  });
  await writeResources(home, WIRED);
  return home;
}

/** The fake WireGuard key and every secret apply stored in the home: none may be printed. */
async function secretsIn(home: string): Promise<string[]> {
  const store = await readSecretStore(home);
  const adminPassword = store.shared?.adminPassword;
  expect(adminPassword).toBeDefined();
  const generated = [
    ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
    ...(adminPassword === undefined ? [] : [adminPassword]),
  ];
  return ['fake-wireguard-key-for-tests', ...generated];
}

function expectNoSecrets(output: string, secrets: readonly string[]): void {
  for (const secret of secrets) expect(output).not.toContain(secret);
}

/**
 * The apps' APIs, faked anew for each test: the test stack's Sonarr and qBittorrent; and
 * the plex.tv they and Mediaplane ask, so that no test reaches the real one.
 */
let apis: Awaited<ReturnType<typeof fakeStackApis>>;
let plexTv: Awaited<ReturnType<typeof fakePlexTv>>;
beforeEach(async () => {
  plexTv = await fakePlexTv();
  apis = await fakeStackApis(plexTv.state);
});

/**
 * `runtime`, with the stack's containers on the wiring network, where `apis` are, and its
 * one-off commands making their folders there: an arr's root folder needs its folder.
 */
function reachingFakeApis(runtime: Runtime): Runtime {
  return {
    ...runtime,
    run: async (service, command) => {
      const result = await runtime.run(service, command);
      // As in a container: a folder is there only if the command succeeded.
      if (result.code === 0) apis.mkdir(service, command);
      return result;
    },
    wiringAddresses: (ids) =>
      Promise.resolve(
        Object.fromEntries(
          ids.flatMap((id) => {
            const address = apis.addresses[id];
            return address === undefined ? [] : [[id, address]];
          }),
        ),
      ),
  };
}

function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
  return {
    host: () => Promise.resolve(FIXTURE_HOST),
    runtime: () => reachingFakeApis(runtime),
    probe: () => fakeProbe(),
    wiring: apis.seams,
    plexTv: () => plexTv.client,
  };
}

function capture(env: NodeJS.ProcessEnv = {}, answers?: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env,
    ...(answers === undefined
      ? {}
      : {
          ask: (question: string) => {
            questions.push(question);
            return Promise.resolve(answers.shift() ?? '');
          },
        }),
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join(''), questions };
}

/**
 * A Docker whose host helper answers as the real one would on a healthy host: it sees this
 * machine's stack.yaml (so the home is "the same folder"), and a fake probe otherwise.
 */
function dockerWithHelper(seen: string[][] = []): Runtime {
  const host = fakeProbe();
  return fakeRuntime({
    hostHelper: async (request, mounts) => {
      seen.push(mounts.map((m) => m.source));
      const direct = (lookups: HostRequest['stat']) =>
        lookups.map(({ key }) => ({ key, at: key }));
      const report = await collectHostReport(
        { ...request, stat: direct(request.stat), free: direct(request.free) },
        {
          ...host,
          stat: (path) =>
            path.endsWith('/stack.yaml') ? nodeProbe.stat(path) : host.stat(path),
        },
        () => FIXTURE_HOST,
      );
      return { ok: true, stdout: JSON.stringify(report) };
    },
  });
}

describe('mediaplane plan', () => {
  it('exits 2 and shows files, containers and secrets for a fresh home', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome()], term.io, deps())).toBe(2);
    expect(term.stdout()).toContain('+ generated/compose.yaml');
    expect(term.stdout()).toContain('Containers:\n');
    expect(term.stdout()).toContain('  + create    sonarr\n');
    expect(term.stdout()).toContain(
      '+ appdata/gluetun/auth/config.toml (before first start; secret values, not shown)\n',
    );
    expect(term.stdout()).toContain(
      '+ appdata/qbittorrent/qBittorrent/qBittorrent.conf (before first start; secret values, not shown)\n',
    );
    expect(term.stdout()).toContain(
      '+ appdata/sonarr/config.xml (before first start; secret values, not shown)\n',
    );
    expect(term.stdout()).toContain(
      'Secrets to generate: admin.password, gluetun.controlApiKey, qbittorrent.apiKey, sonarr.apiKey\n',
    );
    expect(term.stdout()).toContain(
      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 10 wiring checks after the start.',
    );
    expect(term.stdout()).toContain('+ generated/.env (secret values, not shown)\n');
  });

  it('prints versioned JSON without file contents', async () => {
    const term = capture();
    expect(
      await run(['plan', '--home', await makeHome(), '--json'], term.io, deps()),
    ).toBe(2);
    const json = JSON.parse(term.stdout()) as {
      schema: string;
      ok: boolean;
      changed: boolean;
      files: Record<string, unknown>[];
      containers: { service: string; action: string }[];
      secrets: { generate: string[] };
    };
    expect(json).toMatchObject({ schema: 'mediaplane.plan/v1', ok: true, changed: true });
    expect(json.files[0]).toMatchObject({
      path: 'generated/compose.yaml',
      status: 'create',
    });
    expect(json.files[0]).not.toHaveProperty('content');
    expect(json.files[1]).toEqual({
      path: 'generated/.env',
      status: 'create',
      diff: '',
      sensitive: true,
    });
    expect(json.containers).toContainEqual({ service: 'sonarr', action: 'create' });
    expect(json.secrets.generate).toEqual([
      'admin.password',
      'gluetun.controlApiKey',
      'qbittorrent.apiKey',
      'sonarr.apiKey',
    ]);
  });

  it('exits 0 when nothing would change', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const home = await currentHome(runtime);
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps(runtime))).toBe(0);
    expect(term.stdout()).toBe('No changes.\n');
  });

  it("asks no arr to test its download client while qBittorrent's category is to be made", async () => {
    // Sonarr's own test would make the missing category, with no save path, and plan
    // changes nothing: the client's key is checked once the category is there.
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const home = await currentHome(runtime);
    const qbittorrent = apis.apps.get('qbittorrent');
    if (qbittorrent === undefined) throw new Error('no qBittorrent faked');
    const tested = () =>
      apis.app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
    qbittorrent.categories = {};
    const missing = capture();
    expect(await run(['plan', '--home', home], missing.io, deps(runtime))).toBe(2);
    expect(missing.stdout()).toMatch(/\+ create +qbittorrent\.category_tv\n/);
    expect(tested()).toBe(0);
    // With the category in place, the test runs.
    qbittorrent.categories = { tv: '/data/torrents/tv' };
    expect(await run(['plan', '--home', home], capture().io, deps(runtime))).toBe(0);
    expect(tested()).toBe(1);
  });

  it("keeps qBittorrent's key out of what an arr's own test of its download client says", async () => {
    // An app may repeat in its answer what it was sent: the plan's client, like the wire
    // step's, redacts every key the stack stores, not only the app's own.
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const home = await currentHome(runtime);
    const sonarr = apis.apps.get('sonarr');
    if (sonarr === undefined) throw new Error('no Sonarr faked');
    const key = (await readSecretStore(home)).apps.qbittorrent?.apiKey ?? '';
    expect(key).not.toBe('');
    sonarr.testFailure = `Unable to connect to qBittorrent with ${key}`;
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps(runtime))).toBe(2);
    expect(term.stdout()).toContain('  ? unknown     sonarr.download_client\n');
    expect(term.stderr()).toContain(
      'tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent with *** (POST /api/v3/downloadclient/test)',
    );
    expectNoSecrets(term.stdout() + term.stderr(), await secretsIn(home));
  });

  it('exits 2 and names the apps it would wait for when only their health is left', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES).map((c) =>
        c.service === 'sonarr' ? { ...c, health: 'unhealthy' } : c,
      ),
    });
    const home = await currentHome(runtime);
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps(runtime))).toBe(2);
    expect(term.stdout()).toBe(
      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr.admin\n  > after start sonarr.download_client\n  > after start sonarr.root_folder\n  > after start sonarr.connection_jellyfin\nPlan: 1 app to wait for, 4 wiring checks after the start.\n',
    );
    const json = capture();
    expect(await run(['plan', '--home', home, '--json'], json.io, deps(runtime))).toBe(2);
    expect(JSON.parse(json.stdout())).toMatchObject({
      changed: true,
      unhealthy: ['sonarr (unhealthy)'],
    });
  });

  it('exits 1 with actionable errors on stderr', async () => {
    const term = capture();
    const home = await makeHome(STACK.replace('sonarr: {}', 'sonar: {}'));
    expect(await run(['plan', '--home', home], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('error: unknown app "sonar"');
    expect(term.stderr()).toContain('hint: did you mean "sonarr"?');
  });

  it('explains a Docker it cannot reach', async () => {
    const term = capture();
    const runtime = fakeRuntime({
      unavailable: 'cannot talk to Docker: connection refused',
    });
    expect(await run(['plan', '--home', await makeHome()], term.io, deps(runtime))).toBe(
      1,
    );
    expect(term.stderr()).toContain('error: cannot talk to Docker: connection refused');
    expect(term.stderr()).toContain('hint: start Docker');
  });

  it('reads the home directory from MEDIAPLANE_HOME', async () => {
    const term = capture({ MEDIAPLANE_HOME: await makeHome() });
    expect(await run(['plan'], term.io, deps())).toBe(2);
  });

  it('treats an empty MEDIAPLANE_HOME as unset', async () => {
    const homes: string[] = [];
    const term = capture({ MEDIAPLANE_HOME: '' });
    await run(['plan'], term.io, {
      ...deps(),
      runtime: (home) => {
        homes.push(home);
        return fakeRuntime();
      },
    });
    expect(homes).toEqual(['/opt/mediaplane']);
  });

  it('passes MEDIAPLANE_COMPOSE_PROJECT to the runtime', async () => {
    const projects: string[] = [];
    const term = capture({ MEDIAPLANE_COMPOSE_PROJECT: 'mediaplane-test' });
    await run(['plan', '--home', await makeHome()], term.io, {
      ...deps(),
      runtime: (_home, project) => {
        projects.push(project);
        return fakeRuntime();
      },
    });
    expect(projects).toEqual(['mediaplane-test']);
  });

  it('prints its version', async () => {
    const term = capture();
    expect(await run(['--version'], term.io, deps())).toBe(0);
    expect(term.stdout().trim()).toBe(VERSION);
  });

  it('reports unexpected I/O errors as a one-line error naming the file', async () => {
    const home = await tempDir('mediaplane-cli-');
    await mkdir(join(home, 'stack.yaml'));
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps())).toBe(1);
    expect(term.stderr()).toBe(
      `error: cannot read ${join(home, 'stack.yaml')} (EISDIR)\n`,
    );
    expect(term.stdout()).toBe('');
  });

  it('looks at the host through the host helper when it runs from its image', async () => {
    const home = await makeHome();
    const seen: string[][] = [];
    const term = capture({
      MEDIAPLANE_IMAGE: 'mediaplane:test',
      DOCKER_HOST: 'tcp://socket-proxy:2375',
    });
    const runtime = dockerWithHelper(seen);
    expect(await run(['plan', '--home', home], term.io, { runtime: () => runtime })).toBe(
      2,
    );
    // First the host facts, with nothing mounted; then preflight's look at the host.
    expect(seen[0]).toEqual([]);
    expect([...(seen[1] ?? [])].sort()).toEqual(
      ['/dev', '/srv/data', join(home, 'stack.yaml')].sort(),
    );
    expect(term.stderr()).not.toContain('without the socket proxy');
  });

  it('warns when it runs from its image without the socket proxy', async () => {
    const term = capture({ MEDIAPLANE_IMAGE: 'mediaplane:test' });
    const runtime = dockerWithHelper();
    await run(['plan', '--home', await makeHome()], term.io, { runtime: () => runtime });
    expect(term.stderr()).toContain(
      'warning: Mediaplane is using the Docker socket directly, without the socket proxy',
    );
  });

  it('runs the host helper from its own image, as its own user and never as root', async () => {
    const calls: { image: string; user: { uid: number; gid: number } }[] = [];
    const helper = dockerWithHelper();
    const runtime: Runtime = {
      ...helper,
      hostHelper: (image, request, mounts, user) => {
        calls.push({ image, user });
        return helper.hostHelper(image, request, mounts, user);
      },
    };
    const term = capture({ MEDIAPLANE_IMAGE: 'mediaplane:test' });
    await run(['plan', '--home', await makeHome()], term.io, { runtime: () => runtime });
    const own = { image: 'mediaplane:test', user: invokingUser() };
    expect(calls).toEqual([own, own]);

    // A Mediaplane container started as root still runs its helper as 1000:1000.
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    vi.spyOn(process, 'getgid').mockReturnValue(0);
    try {
      calls.length = 0;
      await run(['plan', '--home', await makeHome()], capture(term.io.env).io, {
        runtime: () => runtime,
      });
    } finally {
      vi.restoreAllMocks();
    }
    expect(calls.map((c) => c.user)).toEqual([
      { uid: 1000, gid: 1000 },
      { uid: 1000, gid: 1000 },
    ]);
  });

  it('never runs the host helper, or warns about the proxy, when run from source', async () => {
    const calls: string[] = [];
    const term = capture();
    // This machine's own facts and probe: what preflight then finds does not matter here.
    await run(['plan', '--home', await makeHome()], term.io, {
      runtime: () => fakeRuntime({ calls }),
    });
    expect(calls).toContain('versions');
    expect(calls.filter((call) => call.startsWith('host-helper'))).toEqual([]);
    expect(term.stderr()).not.toContain('socket proxy');
  });

  it('explains host facts the host helper could not give, as a plan error', async () => {
    const env = { MEDIAPLANE_IMAGE: 'mediaplane:test' };
    // This fake Docker has no host helper, so every run of it fails.
    const overrides = { runtime: () => fakeRuntime() };
    const planned = capture(env);
    expect(await run(['plan', '--home', await makeHome()], planned.io, overrides)).toBe(
      1,
    );
    expect(planned.stderr()).toContain(
      'error: the host helper failed: this fake Docker has no host helper\n  hint: the host helper runs the image named by MEDIAPLANE_IMAGE',
    );
    expect(planned.stderr()).toContain('Plan failed.');
    const json = capture(env);
    await run(['plan', '--home', await makeHome(), '--json'], json.io, overrides);
    expect(JSON.parse(json.stdout())).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'docker.no-proxy' }, { code: 'host.helper-failed' }],
    });
    const applied = capture(env);
    expect(
      await run(['apply', '--home', await makeHome(), '--yes'], applied.io, overrides),
    ).toBe(1);
    expect(applied.stderr()).toContain('error: the host helper failed:');
    expect(applied.stderr()).toContain('Apply stopped before changing anything.');
  });

  it('reports unexpected errors as a JSON envelope with --json', async () => {
    const home = await tempDir('mediaplane-cli-');
    await mkdir(join(home, 'stack.yaml'));
    const term = capture();
    expect(await run(['plan', '--home', home, '--json'], term.io, deps())).toBe(1);
    expect(JSON.parse(term.stdout())).toEqual({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: `cannot read ${join(home, 'stack.yaml')} (EISDIR)` },
    });
    expect(term.stderr()).toBe('');
  });
});

describe('mediaplane apply', () => {
  it('applies with --yes, showing the plan and progress, then reports no changes', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const first = capture();
    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
    expect(first.stdout()).toContain(
      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 10 wiring checks after the start.',
    );
    expect(first.stdout()).toContain('  done    images: images present\n');
    expect(first.stdout()).toMatch(
      /Apply complete\. Change record: \d{8}T\d{6}Z-[0-9a-f]{8}\n$/,
    );
    expectNoSecrets(first.stdout() + first.stderr(), await secretsIn(home));
    const second = capture();
    expect(await run(['apply', '--home', home, '--yes'], second.io, deps(docker))).toBe(
      0,
    );
    expect(second.stdout()).toBe('No changes.\n');
  });

  it("makes no folder in an arr's container when the one-off mkdir exits non-zero", async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const failing: Runtime = {
      ...docker,
      run: (service, command) =>
        command.entrypoint === 'mkdir'
          ? Promise.resolve({
              code: 1,
              stdout: '',
              stderr: 'mkdir: cannot create directory: Permission denied',
            })
          : docker.run(service, command),
    };
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(failing))).toBe(1);
    expect(term.stderr()).toContain(
      'could not make /data/media/tv for sonarr.root_folder',
    );
    // The fake arr holds no folder the command did not make, so it holds no root folder.
    expect(apis.apps.get('sonarr')?.folders).toEqual([]);
    expect(apis.apps.get('sonarr')?.rootFolders).toEqual([]);
  });

  it('gives Sonarr the qBittorrent key the stack stores, and sets it again when Sonarr holds another', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    const store = await readSecretStore(home);
    const stored = store.apps.qbittorrent?.apiKey ?? '';
    expect(stored).not.toBe('');
    expect(stored).not.toBe(store.apps.sonarr?.apiKey);
    const sonarr = apis.apps.get('sonarr');
    const qbittorrent = apis.apps.get('qbittorrent');
    if (sonarr === undefined || qbittorrent === undefined)
      throw new Error('no app faked');
    const held = () =>
      sonarr.downloadClients[0]?.fields.find((f) => f.name === 'apiKey')?.value;
    // The wire step made the client, from the store's keys.
    expect(held()).toBe(stored);
    // qBittorrent now takes only that key, and the client holds another.
    qbittorrent.key = stored;
    const [client] = sonarr.downloadClients;
    if (client === undefined) throw new Error('no download client made');
    client.fields = client.fields.map((f) =>
      f.name === 'apiKey' ? { ...f, value: `qbt_${'9'.repeat(28)}` } : f,
    );
    const again = capture();
    expect(await run(['apply', '--home', home, '--yes'], again.io, deps(docker))).toBe(0);
    expect(again.stdout()).toContain(
      '  done    wiring sonarr.download_client: updated apiKey\n',
    );
    expect(held()).toBe(stored);
    expectNoSecrets(again.stdout() + again.stderr(), await secretsIn(home));
  });

  it("keeps qBittorrent's key out of the failure of an arr's own test, in apply and in its record", async () => {
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const home = await currentHome(runtime);
    const sonarr = apis.apps.get('sonarr');
    if (sonarr === undefined) throw new Error('no Sonarr faked');
    const key = (await readSecretStore(home)).apps.qbittorrent?.apiKey ?? '';
    expect(key).not.toBe('');
    sonarr.testFailure = `Unable to connect to qBittorrent with ${key}`;
    const applied = capture();
    expect(await run(['apply', '--home', home, '--yes'], applied.io, deps(runtime))).toBe(
      1,
    );
    // Failed in the wire step, which says what the app said, the key redacted.
    expect(applied.stdout()).toContain(
      '  failed  wiring sonarr.download_client: Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent with *** (POST /api/v3/downloadclient/test)\n',
    );
    // The plan it began with said it too, as a warning (apply prints the same message once).
    const said =
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent with *** (POST /api/v3/downloadclient/test)\n';
    expect(applied.stderr()).toContain(`warning: ${said}`);
    const id = /Change record: (\S+)/.exec(applied.stderr())?.[1] ?? '';
    expect(id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    const record = capture();
    expect(await run(['history', id, '--home', home], record.io, deps(runtime))).toBe(0);
    expect(record.stdout()).toContain('Unable to connect to qBittorrent with ***');
    const secrets = await secretsIn(home);
    expectNoSecrets(applied.stdout() + applied.stderr(), secrets);
    expectNoSecrets(record.stdout() + record.stderr(), secrets);
  });

  it("is banned from qBittorrent's sign-in by four plans of a changed password, not three", async () => {
    // qBittorrent bans an address after five failed sign-ins in a row. Each plan of a
    // changed password makes one, and so does apply's own plan; its wire step makes none,
    // and the check after the update signs in with the new password.
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    const qbittorrent = apis.apps.get('qbittorrent');
    if (qbittorrent === undefined) throw new Error('no qBittorrent faked');
    const store = await readSecretStore(home);
    const password = store.shared?.adminPassword;
    // qBittorrent takes only the stack's key, and gives it back among its preferences.
    qbittorrent.key = store.apps.qbittorrent?.apiKey ?? '';
    expect(qbittorrent.key).not.toBe('');
    const changeThenApply = async (plans: number) => {
      qbittorrent.password = 'fake-changed-in-the-web-ui';
      for (let planned = 0; planned < plans; planned++) {
        expect(await run(['plan', '--home', home], capture().io, deps(docker))).toBe(2);
      }
      const applied = capture();
      const code = await run(
        ['apply', '--home', home, '--yes'],
        applied.io,
        deps(docker),
      );
      return { code, stdout: applied.stdout(), stderr: applied.stderr() };
    };
    expect((await changeThenApply(3)).code).toBe(0);
    expect(qbittorrent.password).toBe(password);
    const banned = await changeThenApply(4);
    expect(banned.code).toBe(1);
    expect(banned.stderr).toContain(
      'banned after too many failed authentication attempts',
    );
    // The update went through, with the key: only the check after it was refused.
    expect(qbittorrent.password).toBe(password);
    expectNoSecrets(banned.stdout + banned.stderr, await secretsIn(home));
  });

  it("settles qBittorrent's trusted LAN when lan_subnet is typed with host bits", async () => {
    // qBittorrent keeps a whitelisted subnet as its network address, so 192.168.1.10/24
    // comes back as 192.168.1.0/24: the stack has to want that form, or no plan is empty.
    const home = await makeHome(
      STACK.replace(
        'network: { bind: localhost }',
        'network: { bind: lan, lan_subnet: 192.168.1.10/24 }\nsecurity: { login_on_lan: false }',
      ),
    );
    const docker = fakeDocker(home);
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    expect(apis.apps.get('qbittorrent')?.preferences).toMatchObject({
      bypass_auth_subnet_whitelist_enabled: true,
      bypass_auth_subnet_whitelist: '192.168.1.0/24',
    });
    const again = capture();
    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
    expect(again.stdout()).toBe('No changes.\n');
  });

  it('asks on a terminal, and changes nothing unless the answer is yes', async () => {
    const home = await makeHome();
    const declined = capture({}, ['n']);
    expect(
      await run(['apply', '--home', home], declined.io, deps(fakeDocker(home))),
    ).toBe(1);
    expect(declined.questions).toEqual(['\nApply these changes? [y/N] ']);
    expect(declined.stderr()).toContain('Apply cancelled; nothing was changed.');
    const accepted = capture({}, ['YES']);
    expect(
      await run(['apply', '--home', home], accepted.io, deps(fakeDocker(home))),
    ).toBe(0);
  });

  it('takes Ctrl-D at the confirmation as no', async () => {
    const home = await makeHome();
    const term = capture();
    const io: Io = {
      ...term.io,
      ask: () => Promise.reject(new PromptCancelled()),
    };
    expect(await run(['apply', '--home', home], io, deps(fakeDocker(home)))).toBe(1);
    expect(term.stderr()).toBe('Apply cancelled; nothing was changed.\n');
    await expect(readFile(join(home, COMPOSE_PATH), 'utf8')).rejects.toThrow('ENOENT');
  });

  it('needs --yes when it cannot ask', async () => {
    const term = capture();
    expect(await run(['apply', '--home', await makeHome()], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain(
      'apply needs --yes when it cannot ask for confirmation',
    );
  });

  it('prints versioned JSON with --json --yes', async () => {
    const home = await makeHome();
    const term = capture();
    expect(
      await run(
        ['apply', '--home', home, '--yes', '--json'],
        term.io,
        deps(fakeDocker(home)),
      ),
    ).toBe(0);
    const json = JSON.parse(term.stdout()) as Record<string, unknown> & {
      plan: { files: Record<string, unknown>[] };
      actions: { step: string; resource?: string; result: string }[];
    };
    expect(json).toMatchObject({
      schema: 'mediaplane.apply/v1',
      ok: true,
      changed: true,
      outcome: 'success',
    });
    expect(json.recordId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(json.plan.files[1]).toEqual({
      path: 'generated/.env',
      status: 'create',
      diff: '',
      sensitive: true,
    });
    expect(json.actions.map((a) => [a.step, a.resource ?? '', a.result])).toEqual([
      ['keys', '', 'done'],
      ['files', '', 'done'],
      ['pull', '', 'done'],
      ['ownership', '', 'done'],
      ['start', '', 'done'],
      ['bootstrap', '', 'done'],
      ['wire', 'jellyfin.admin', 'done'],
      ['wire', 'jellyfin.library_movies', 'done'],
      ['wire', 'jellyfin.library_shows', 'done'],
      ['wire', 'qbittorrent.admin', 'done'],
      ['wire', 'qbittorrent.preferences', 'done'],
      ['wire', 'qbittorrent.category_tv', 'done'],
      ['wire', 'sonarr.admin', 'done'],
      ['wire', 'sonarr.download_client', 'done'],
      ['wire', 'sonarr.root_folder', 'done'],
      ['wire', 'sonarr.connection_jellyfin', 'done'],
      ['wire', '', 'done'],
      ['verify', '', 'done'],
    ]);
    expectNoSecrets(term.stdout() + term.stderr(), await secretsIn(home));
  });

  it('counts only the steps that changed something as "changed" in JSON', async () => {
    // Every key is stored already, so the keys step has nothing to do. No pre-start file
    // is written, so the appdata folder is free to be replaced by a file.
    const home = await currentHome(fakeRuntime(), { prestart: false });
    // A file where the appdata folder should be: the files step fails.
    await writeFile(join(home, 'appdata'), 'not a folder');
    const term = capture();
    expect(
      await run(
        ['apply', '--home', home, '--yes', '--json'],
        term.io,
        deps(fakeDocker(home)),
      ),
    ).toBe(1);
    const json = JSON.parse(term.stdout()) as {
      changed: boolean;
      actions: { step: string; result: string; detail?: string }[];
    };
    expect(json.actions.slice(0, 2)).toMatchObject([
      { step: 'keys', result: 'done', detail: 'none needed' },
      { step: 'files', result: 'failed' },
    ]);
    expect(json.changed).toBe(false);
  });

  it('answers --json without --yes with a JSON error', async () => {
    const term = capture();
    expect(
      await run(['apply', '--home', await makeHome(), '--json'], term.io, deps()),
    ).toBe(1);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
    });
  });

  it('exits 1 and explains a failed step', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home, {
      pull: { ok: false, error: 'fake registry unreachable' },
    });
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    expect(term.stderr()).toContain('error: fake registry unreachable');
    expect(term.stderr()).toContain('hint: check the network connection');
    expect(term.stderr()).toContain(
      'Apply failed: 2 done, 1 failed, 5 skipped. Run apply again to retry.',
    );
  });

  it('leaves out the change record id when the record could not be saved', async () => {
    const home = await makeHome();
    // A file where the history folder should be: the record write cannot succeed.
    await mkdir(join(home, 'state'));
    await writeFile(join(home, 'state', 'history'), 'not a folder');
    const term = capture();
    expect(
      await run(['apply', '--home', home, '--yes'], term.io, deps(fakeDocker(home))),
    ).toBe(1);
    expect(term.stderr()).toContain('error: the change record could not be saved:');
    // Every step worked, so it does not say "failed" or tell the user to run apply again.
    expect(term.stderr()).toMatch(
      /\nApply finished, but its change record could not be saved\.\n$/,
    );
    expect(term.stderr()).not.toContain('Apply failed');
    expect(term.stdout()).not.toContain('Change record');
    const json = capture();
    expect(
      await run(
        ['apply', '--home', home, '--yes', '--json'],
        json.io,
        deps(fakeDocker(home)),
      ),
    ).toBe(1);
    expect(JSON.parse(json.stdout())).toMatchObject({
      outcome: 'failed',
      recordId: null,
    });
  });

  it('still reports a failed step when the record could not be saved either', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(join(home, 'state', 'history'), 'not a folder');
    const docker = fakeDocker(home, {
      pull: { ok: false, error: 'fake registry unreachable' },
    });
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    expect(term.stderr()).toContain('error: fake registry unreachable');
    expect(term.stderr()).toContain('error: the change record could not be saved:');
    expect(term.stderr()).toMatch(
      /\nApply failed: 2 done, 1 failed, 5 skipped\. Run apply again to retry\.\n$/,
    );
  });

  it('prints the plan warnings once, whether the apply goes ahead or not', async () => {
    const home = await makeHome();
    const lowDisk = {
      ...deps(fakeDocker(home)),
      probe: () => fakeProbe({ freeBytes: 5 * 1024 ** 3 }),
    };
    const warnings = [
      `warning: only 5.0 GiB free at ${home}`,
      'warning: only 5.0 GiB free at /srv/data',
    ];
    const warningLines = (stderr: string) =>
      stderr.split('\n').filter((line) => line.startsWith('warning:'));

    const declined = capture({}, ['n']);
    expect(await run(['apply', '--home', home], declined.io, lowDisk)).toBe(1);
    expect(warningLines(declined.stderr())).toEqual(warnings);

    const applied = capture();
    expect(await run(['apply', '--home', home, '--yes'], applied.io, lowDisk)).toBe(0);
    expect(warningLines(applied.stderr())).toEqual(warnings);

    // Nothing to apply any more: the plan is not shown, so apply prints the warnings itself.
    const unchanged = capture();
    expect(await run(['apply', '--home', home, '--yes'], unchanged.io, lowDisk)).toBe(0);
    expect(unchanged.stdout()).toBe('No changes.\n');
    expect(warningLines(unchanged.stderr())).toEqual(warnings);
  });

  it('refuses a Compose project it must not manage', async () => {
    const term = capture({ MEDIAPLANE_COMPOSE_PROJECT: 'mediaplane-system' });
    expect(
      await run(['plan', '--home', await makeHome()], term.io, {
        host: () => Promise.resolve(FIXTURE_HOST),
        probe: () => fakeProbe(),
      }),
    ).toBe(1);
    expect(term.stderr()).toContain(
      'refusing to manage the Compose project "mediaplane-system"',
    );
  });
});

describe('mediaplane apply: Prowlarr in the stack', () => {
  const WITH_PROWLARR = STACK.replace(
    '  qbittorrent: {}',
    '  qbittorrent: {}\n  prowlarr: {}',
  );

  it('links Prowlarr to Sonarr and makes its indexer proxy, records them, then leaves them as they are', async () => {
    const home = await makeHome(WITH_PROWLARR);
    const docker = fakeDocker(home);
    const first = capture();
    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
    expect(first.stdout()).toContain(
      '  done    wiring prowlarr.application_sonarr: created\n',
    );
    expect(first.stdout()).toContain(
      '  done    wiring prowlarr.indexer_proxy: created\n',
    );
    const known = await readResources(home);
    expect(known['prowlarr.application_sonarr']).toMatchObject({
      name: 'Sonarr (Mediaplane)',
      fields: { baseUrl: 'http://sonarr:8989', prowlarrUrl: 'http://prowlarr:9696' },
      secrets: ['apiKey'],
    });
    expect(known['prowlarr.indexer_proxy']).toMatchObject({
      name: 'Cloudflare (Mediaplane)',
      fields: { host: 'http://byparr:8191/', requestTimeout: 60, tags: 'cloudflare' },
      secrets: [],
    });
    // Sonarr's key went to Prowlarr; neither the output nor resources.json shows it.
    const secrets = await secretsIn(home);
    expectNoSecrets(first.stdout() + first.stderr(), secrets);
    expectNoSecrets(JSON.stringify(known), secrets);
    const again = capture();
    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
    expect(again.stdout()).toBe('No changes.\n');
  });

  it("skips Prowlarr's link to Sonarr when Sonarr's admin fails, and still makes the proxy", async () => {
    const home = await makeHome(WITH_PROWLARR);
    // Sonarr never becomes ready, so nothing of it can be set: its admin fails.
    apis.apps.set('sonarr', { ...freshAppState(), up: false });
    const term = capture();
    expect(
      await run(['apply', '--home', home, '--yes'], term.io, deps(fakeDocker(home))),
    ).toBe(1);
    expect(term.stdout()).toContain(
      '  skipped wiring prowlarr.application_sonarr: sonarr.admin failed\n',
    );
    expect(term.stdout()).toContain('  done    wiring prowlarr.indexer_proxy: created\n');
    expect(apis.apps.get('prowlarr')?.applications).toEqual([]);
  });
});

describe('mediaplane apply: Seerr in the stack', () => {
  const WITH_SEERR = STACK.replace('  qbittorrent: {}', '  qbittorrent: {}\n  seerr: {}');

  /** The key Seerr made itself in the fake Jellyfin, which Seerr shows in clear. */
  function seerrsOwn(): string {
    const own = apis.apps
      .get('jellyfin')
      ?.apiKeys.find((k) => k.AppName === 'Seerr')?.AccessToken;
    if (own === undefined) throw new Error('Seerr made no key in Jellyfin');
    return own;
  }

  /** A home of the stack with Seerr, whose fake Seerr keeps its settings.json there. */
  async function seerrHome(): Promise<string> {
    const home = await makeHome(WITH_SEERR);
    const seerr = { ...freshAppState() };
    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
    apis.apps.set('seerr', seerr);
    return home;
  }

  it('sets Seerr up through Jellyfin before publishing it, links it, initializes it, then leaves it as it is', async () => {
    const home = await seerrHome();
    const docker = fakeDocker(home);
    const first = capture();
    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
    expect(first.stdout()).toContain(
      '+ seerr (with no port published until it is done)\n',
    );
    expect(first.stdout()).toContain(
      '  done    first-run setup: set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr\n',
    );
    for (const line of [
      'seerr.media_server: updated libraries',
      'seerr.server_sonarr: created',
      'seerr.setup: updated initialized',
    ]) {
      expect(first.stdout()).toContain(`  done    wiring ${line}\n`);
    }
    const seerr = apis.apps.get('seerr')?.seerr;
    expect(seerr).toMatchObject({
      users: ['admin'],
      initialized: true,
      sessions: [],
      jellyfin: { ip: 'jellyfin', port: 8096 },
    });
    expect(seerr?.sonarr).toMatchObject([
      { name: 'Sonarr (Mediaplane)', hostname: 'sonarr', activeProfileName: 'HD-1080p' },
    ]);
    const known = await readResources(home);
    expect(known['seerr.server_sonarr']).toMatchObject({
      id: 0,
      fields: {
        hostname: 'sonarr',
        port: 8989,
        activeProfile: 'HD-1080p',
        activeDirectory: '/data/media/tv',
        isDefault: true,
      },
      secrets: ['apiKey'],
    });
    // Sonarr's key went to Seerr, and the admin password to Jellyfin through it; Seerr
    // showed the key it made itself in Jellyfin.
    const secrets = [...(await secretsIn(home)), seerrsOwn()];
    expectNoSecrets(first.stdout() + first.stderr(), secrets);
    expectNoSecrets(JSON.stringify(known), secrets);
    const again = capture();
    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
    expect(again.stdout()).toBe('No changes.\n');
  });

  it("keeps unpublished and unrecorded, giving it no key of the stack's, a Seerr claimed through Jellyfin's address with a URL base to another host", async () => {
    const home = await seerrHome();
    const seerr = apis.apps.get('seerr')?.seerr;
    if (seerr === undefined) throw new Error('no Seerr faked');
    // Signed in first as a user named as the shared admin, on a Jellyfin of their own,
    // which Seerr reaches at http://jellyfin:8096@198.51.100.7.
    seerr.claimant = { user: 'admin', jellyfin: 'jellyfin', urlBase: '@198.51.100.7' };
    const docker = fakeDocker(home);
    const ups: string[][] = [];
    const runtime: Runtime = {
      ...docker,
      up: (seconds, values, unpublished = []) => {
        ups.push([...unpublished]);
        return docker.up(seconds, values, unpublished);
      },
    };
    for (const attempt of [1, 2]) {
      const applied = capture();
      expect(
        await run(['apply', '--home', home, '--yes'], applied.io, deps(runtime)),
        `apply ${String(attempt)}`,
      ).toBe(1);
      expect(applied.stdout() + applied.stderr()).toContain(
        'was set up with another login or another Jellyfin',
      );
    }
    // Every up kept it unpublished, and nothing recorded it as Mediaplane's.
    expect(ups.length).toBeGreaterThan(0);
    for (const unpublished of ups) expect(unpublished).toContain('seerr');
    const store = await readSecretStore(home);
    expect(store.setUp).toBeUndefined();
    // No key of the stack's reached it: no server, and no request to it carrying one.
    expect(seerr.sonarr).toEqual([]);
    const stackKeys = [store.apps.sonarr?.apiKey, store.apps.qbittorrent?.apiKey].filter(
      (k): k is string => k !== undefined,
    );
    expect(stackKeys.length).toBe(2);
    const toSeerr = apis.app.requests.filter((r) =>
      (r.headers.host ?? '').startsWith('seerr'),
    );
    expect(toSeerr.length).toBeGreaterThan(0);
    for (const request of toSeerr) {
      for (const key of stackKeys) expect(request.body).not.toContain(key);
    }
  });

  it('plan only reads Seerr: no sign-in, no settings write, no initialize, no sync, and no record', async () => {
    const home = await seerrHome();
    const docker = fakeDocker(home);
    const seerr = apis.apps.get('seerr')?.seerr;
    if (seerr === undefined) throw new Error('no Seerr faked');
    /** What was sent to Seerr from request `from` on that only reads. */
    const sentToSeerr = (from: number) =>
      apis.app.requests
        .slice(from)
        .filter((r) => (r.headers.host ?? '').startsWith('seerr'))
        .map((r) => `${r.method} ${r.path.split('?')[0] ?? r.path}`);
    const readsOnly = (calls: string[]) =>
      calls.filter(
        (c) => !c.startsWith('GET ') && !/^POST \S+\/(sonarr|radarr)\/test$/.test(c),
      );
    const secretsFile = () => readFile(join(home, 'state', 'secrets.json'), 'utf8');
    // Before its setup: plan doesn't ask Seerr to do anything.
    expect(await run(['plan', '--home', home], capture().io, deps(docker))).toBe(2);
    expect(readsOnly(sentToSeerr(0))).toEqual([]);
    expect(seerr).toMatchObject({ users: [], signIns: 0, initialized: false });
    expect(await thrown(secretsFile())).toMatchObject({ code: 'ENOENT' });
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    // Changed by hand, every link: plan checks them all, and changes none.
    const shows = seerr.jellyfin.libraries.find((l) => l.name === 'Shows');
    if (shows !== undefined) shows.enabled = false;
    seerr.jellyfin.urlBase = '/elsewhere';
    const server = seerr.sonarr[0];
    if (server !== undefined) server.apiKey = '0'.repeat(32);
    seerr.initialized = false;
    const held = structuredClone(seerr);
    const stored = await secretsFile();
    const from = apis.app.requests.length;
    const planned = capture();
    expect(await run(['plan', '--home', home], planned.io, deps(docker))).toBe(2);
    expect(planned.stdout()).toContain('seerr.media_server');
    const sent = sentToSeerr(from);
    expect(sent).toContain('POST /api/v1/settings/sonarr/test');
    expect(readsOnly(sent)).toEqual([]);
    expect(seerr).toEqual(held);
    expect(await secretsFile()).toBe(stored);
  });

  it("plans a server's URL base as a change, and never sends the stack's key through it", async () => {
    const home = await seerrHome();
    const docker = fakeDocker(home);
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    const seerr = apis.apps.get('seerr')?.seerr;
    const server = seerr?.sonarr[0];
    if (server === undefined) throw new Error('no Sonarr server in Seerr');
    // Seerr's admin points the server elsewhere, and leaves the stack's key in it.
    server.baseUrl = '@203.0.113.9';
    const key = (await readSecretStore(home)).apps.sonarr?.apiKey ?? '';
    expect(key).not.toBe('');
    const from = apis.app.requests.length;
    const planned = capture();
    expect(await run(['plan', '--home', home], planned.io, deps(docker))).toBe(2);
    expect(planned.stdout()).toContain('seerr.server_sonarr');
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    expect(seerr?.sonarr[0]).toMatchObject({ hostname: 'sonarr', baseUrl: '' });
    const carrying = apis.app.requests
      .slice(from)
      .filter((r) => (r.headers.host ?? '').startsWith('seerr') && r.body.includes(key))
      .map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(carrying.length).toBeGreaterThan(0);
    for (const body of carrying) {
      expect(body).toMatchObject({ hostname: 'sonarr', port: 8989, baseUrl: '' });
    }
  });

  it("keeps the keys Seerr shows in clear out of plan's warning, apply's failure and the change record", async () => {
    const home = await seerrHome();
    const docker = fakeDocker(home);
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(0);
    // Seerr refuses its servers' list now, quoting every key it holds.
    const seerr = apis.apps.get('seerr')?.seerr;
    if (seerr === undefined) throw new Error('no Seerr faked');
    Object.assign(seerr, { echoKey: true, failing: ['/api/v1/settings/sonarr'] });
    const said =
      'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 400): fake failure, holding *** *** (GET /api/v1/settings/sonarr)';
    const planned = capture();
    await run(['plan', '--home', home], planned.io, deps(docker));
    expect(planned.stderr()).toContain(`warning: ${said}\n`);
    const applied = capture();
    expect(await run(['apply', '--home', home, '--yes'], applied.io, deps(docker))).toBe(
      1,
    );
    expect(applied.stdout()).toContain(`  failed  wiring seerr.server_sonarr: ${said}\n`);
    const id = /Change record: (\S+)/.exec(applied.stderr())?.[1] ?? '';
    const record = capture();
    expect(await run(['history', id, '--home', home], record.io, deps(docker))).toBe(0);
    expect(record.stdout()).toContain(said);
    const secrets = [...(await secretsIn(home)), seerrsOwn()];
    for (const output of [planned, applied, record]) {
      expectNoSecrets(output.stdout() + output.stderr(), secrets);
    }
  });

  it("waits for Jellyfin's admin, wiring the rest, when Jellyfin refuses Seerr's sign-in, then sets Seerr up", async () => {
    // Jellyfin was set up before, its key kept, and its admin's password is another: the
    // shared admin is refused until the wire step sets it.
    const home = await seerrHome();
    const key = '6'.repeat(32);
    await mkdir(join(home, 'state'), { recursive: true });
    await writeFile(
      join(home, 'state', 'secrets.json'),
      JSON.stringify({ version: 1, apps: { jellyfin: { apiKey: key } } }),
    );
    apis.apps.set('jellyfin', {
      ...freshAppState(),
      configDir: jellyfinConfig(home),
      wizard: 'done',
      user: 'admin',
      password: 'fake-old-password',
      apiKeys: [{ AccessToken: key, AppName: 'Mediaplane', DateCreated: AT }],
    });
    await mkdir(jellyfinConfig(home), { recursive: true });
    await writeFile(
      join(jellyfinConfig(home), 'system.xml'),
      '<IsStartupWizardCompleted>true</IsStartupWizardCompleted>\n',
    );
    const docker = fakeDocker(home);
    const waited = capture();
    expect(await run(['apply', '--home', home, '--yes'], waited.io, deps(docker))).toBe(
      1,
    );
    expect(waited.stdout()).toContain(
      "  skipped wiring seerr.media_server: seerr's first-run setup waits\n",
    );
    expect(waited.stdout()).toContain(
      '  done    wiring jellyfin.admin: updated password\n',
    );
    expect(waited.stderr()).toContain(
      "warning: Seerr at http://seerr:5055 (127.0.0.1) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)\n",
    );
    expect(waited.stderr()).toContain('seerr (first-run setup)');
    expect(apis.apps.get('seerr')?.seerr.users).toEqual([]);
    // Jellyfin takes the shared admin now: the next apply sets Seerr up.
    const then = capture();
    expect(await run(['apply', '--home', home, '--yes'], then.io, deps(docker))).toBe(0);
    expect(apis.apps.get('seerr')?.seerr.users).toEqual(['admin']);
  });
});

describe('mediaplane apply: Plex as the media server', () => {
  const PLEX_STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

  /**
   * A home of the Plex stack, with `token` saved as yours, and a Docker that starts Plex
   * as its image does: trading its PLEX_CLAIM at plex.tv as it first starts, unless
   * `claims` is false.
   */
  async function plexHome(token = FAKE_PLEX_ACCOUNT.token, claims = true) {
    const home = await makeHome(PLEX_STACK);
    await writeFile(join(home, 'secrets', 'plex-token'), `${token}\n`);
    const plex = freshAppState();
    plex.plex.configDir = join(home, 'appdata', 'plex');
    apis.apps.set('plex', plex);
    const docker = fakeDocker(home, {
      onUp: (_unpublished, startEnv) => {
        if (claims) claimFakePlex(plex.plex, startEnv.plex?.PLEX_CLAIM, plexTv.state);
      },
    });
    return { home, plex: plex.plex, docker };
  }

  /** Every secret of the run: your token, the claim tokens, Plex's own token. */
  function plexSecrets(): string[] {
    return [
      FAKE_PLEX_ACCOUNT.token,
      FAKE_SERVER_TOKEN,
      ...plexTv.state.claims.map((claim) => claim.token),
    ];
  }

  it('claims Plex for your account before publishing it, then leaves it as it is', async () => {
    const { home, plex, docker } = await plexHome();
    const planned = capture();
    expect(await run(['plan', '--home', home], planned.io, deps(docker))).toBe(2);
    expect(planned.stdout()).toContain(
      '+ plex (with no port published until it is done)\n',
    );
    // plan never asks plex.tv: the claim token is fetched only as apply starts Plex.
    expect(plexTv.state.calls).toEqual([]);
    const first = capture();
    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
      'up unpublished plex with plex.PLEX_CLAIM',
      'up',
    ]);
    expect(first.stdout()).toContain(
      '  done    first-run setup: set up plex; published plex\n',
    );
    expect(plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
    expect((await readSecretStore(home)).setUp).toEqual(['plex']);
    // Then wired: its name, its libraries, and Sonarr's connection to it with your token.
    for (const line of [
      'plex.server: updated name',
      'plex.library_movies: created',
      'plex.library_tv: created',
      'sonarr.connection_plex: created',
    ]) {
      expect(first.stdout()).toContain(`  done    wiring ${line}\n`);
    }
    expect(plex.friendlyName).toBe('Mediaplane');
    expect(plex.sections.map((s) => [s.title, s.locations])).toEqual([
      ['Movies', ['/data/media/movies']],
      ['TV Shows', ['/data/media/tv']],
    ]);
    const connection = apis.apps.get('sonarr')?.connections[0];
    expect(connection).toMatchObject({
      name: 'Plex (Mediaplane)',
      implementation: 'PlexServer',
    });
    expect(connection?.fields).toContainEqual({
      name: 'authToken',
      value: FAKE_PLEX_ACCOUNT.token,
    });
    expectNoSecrets(await readFile(join(home, RESOURCES_PATH), 'utf8'), plexSecrets());
    // One claim token, fetched with your token, and used.
    expect(plexTv.state.claims).toEqual([
      { token: plexTv.state.claims[0]?.token, account: FAKE_PLEX_ACCOUNT.id, used: true },
    ]);
    const records = await readdir(join(home, 'state', 'history'));
    const recorded = await Promise.all(
      records.map((name) => readFile(join(home, 'state', 'history', name), 'utf8')),
    );
    const secrets = [...(await secretsIn(home)), ...plexSecrets()];
    expectNoSecrets(first.stdout() + first.stderr() + recorded.join(''), secrets);
    expectNoSecrets(await readFile(join(home, 'state', 'secrets.json'), 'utf8'), [
      FAKE_PLEX_ACCOUNT.token,
      ...plexTv.state.claims.map((claim) => claim.token),
    ]);
    const again = capture();
    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
    expect(again.stdout()).toBe('No changes.\n');
  });

  it('signs Seerr in with your Plex account once Plex is claimed, links it to Plex, then leaves it as it is', async () => {
    const { home, plex, docker } = await plexHome();
    await writeFile(join(home, 'stack.yaml'), `${PLEX_STACK}  seerr: {}\n`);
    const seerr = freshAppState();
    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
    apis.apps.set('seerr', seerr);
    const first = capture();
    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
    expect(first.stdout()).toContain(
      '  done    first-run setup: set up plex, seerr; published plex, seerr\n',
    );
    // Seerr's setup ran after Plex's, unpublished until both were done.
    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
      'up unpublished plex seerr with plex.PLEX_CLAIM',
      'up',
    ]);
    for (const line of [
      'seerr.media_server_plex: created',
      'seerr.server_sonarr: created',
      'seerr.setup: updated initialized',
    ]) {
      expect(first.stdout()).toContain(`  done    wiring ${line}\n`);
    }
    expect(seerr.seerr).toMatchObject({
      mediaServerType: 1,
      plexUsers: [FAKE_PLEX_ACCOUNT.id],
      sessions: [],
      initialized: true,
      plex: { ip: 'plex', port: 32400, useSsl: false },
    });
    expect(seerr.seerr.plex.libraries.map((l) => [l.name, l.enabled])).toEqual([
      ['Movies', true],
      ['TV Shows', true],
    ]);
    expect(plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
    expect((await readSecretStore(home)).setUp).toEqual(['plex', 'seerr']);
    const secrets = [...(await secretsIn(home)), ...plexSecrets()];
    expectNoSecrets(first.stdout() + first.stderr(), secrets);
    expectNoSecrets(await readFile(join(home, RESOURCES_PATH), 'utf8'), secrets);
    const again = capture();
    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
    expect(again.stdout()).toBe('No changes.\n');
  });

  it('starts nothing when plex.tv refuses your token, and says to sign in again', async () => {
    const { home, docker } = await plexHome('revoked-plex-token-0');
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    expect(term.stderr()).toContain(
      'error: Plex\'s first start needs a claim token from plex.tv, which Mediaplane couldn\'t get, so nothing was started: plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json)\n  hint: plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again\n',
    );
    expect(docker.calls.some((call) => call.startsWith('up'))).toBe(false);
    expectNoSecrets(term.stdout() + term.stderr(), ['revoked-plex-token-0']);
  });

  it('stops a Plex that runs published, unclaimed, when plex.tv refuses your token, changing nothing else', async () => {
    const { home, docker } = await plexHome('revoked-plex-token-0');
    expect(
      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
    ).toBe(1);
    // As an apply from before this slice left it, or a "docker compose up": Plex
    // published, and unclaimed.
    expect((await docker.up(60, {}, [])).ok).toBe(true);
    docker.calls.length = 0;
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    expect(term.stderr()).toContain(
      "plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json); Mediaplane stopped plex, which ran, but isn't shown to be yours, so that it isn't left published\n",
    );
    // Stopped, and nothing else: Mediaplane didn't leave the wiring network, nor stop or
    // start anything more.
    expect(docker.calls.filter((call) => /^(up|stop|leave-wiring)\b/.test(call))).toEqual(
      ['stop plex'],
    );
    expectNoSecrets(term.stdout() + term.stderr(), ['revoked-plex-token-0']);
  });

  it("keeps Seerr waiting, with nothing sent to it, while Plex's setup isn't done", async () => {
    const { home, docker } = await plexHome(FAKE_PLEX_ACCOUNT.token, false);
    await writeFile(join(home, 'stack.yaml'), `${PLEX_STACK}  seerr: {}\n`);
    const seerr = freshAppState();
    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
    apis.apps.set('seerr', seerr);
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    expect(term.stderr()).toContain(
      "Seerr waits for Plex's first-run setup, which isn't done",
    );
    // Seerr is neither signed in to nor linked, and is not recorded as set up.
    expect(seerr.seerr).toMatchObject({ plexUsers: [], sessions: [], signIns: 0 });
    expect(seerr.seerr.plex.ip).toBe('');
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    expectNoSecrets(term.stdout() + term.stderr(), plexSecrets());
  });

  it("keeps a Plex that didn't claim itself unpublished, and fails", async () => {
    const { home, plex, docker } = await plexHome(FAKE_PLEX_ACCOUNT.token, false);
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    // Still unpublished, still with its claim token: up recreates nothing.
    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
      'up unpublished plex with plex.PLEX_CLAIM',
      'up unpublished plex with plex.PLEX_CLAIM',
    ]);
    expect(term.stderr()).toContain(
      "didn't claim itself as it started, so it stays unpublished: its claim token may have run out, or it couldn't reach plex.tv",
    );
    expect(plex.owner).toBeNull();
    expect((await readSecretStore(home)).setUp).toBeUndefined();
    expectNoSecrets(term.stdout() + term.stderr(), plexSecrets());
  });
});

describe('mediaplane status', () => {
  async function appliedHome() {
    const home = await makeHome();
    const docker = fakeDocker(home);
    await run(['apply', '--home', home, '--yes'], capture().io, deps(docker));
    return { home, docker };
  }

  it('shows each app and the last apply', async () => {
    const { home, docker } = await appliedHome();
    const term = capture();
    expect(await run(['status', '--home', home], term.io, deps(docker))).toBe(0);
    expect(term.stdout()).toContain('APP          STATE    HEALTH\n');
    expect(term.stdout()).toContain('sonarr       running  healthy\n');
    expect(term.stdout()).toMatch(
      /Last apply: \S+, success \(\d{8}T\d{6}Z-[0-9a-f]{8}\)\n/,
    );
  });

  it('keeps the columns apart for a long state and a long app name', async () => {
    const restarting: ContainerState = {
      service: 'flaresolverr',
      id: 'fake-flaresolverr',
      state: 'restarting',
      health: '',
      configHash: 'b',
      published: [],
    };
    const runtime = fakeRuntime({
      containers: [...running({ sonarr: 'a' }), restarting],
    });
    const term = capture();
    expect(
      await run(['status', '--home', await makeHome()], term.io, deps(runtime)),
    ).toBe(0);
    expect(term.stdout()).toBe(
      [
        'APP           STATE       HEALTH',
        'flaresolverr  restarting  -',
        'sonarr        running     healthy',
        'No apply has run yet.',
        '',
      ].join('\n'),
    );
  });

  it('shows one app, and fails for one that is not in the stack', async () => {
    const { home, docker } = await appliedHome();
    const one = capture();
    expect(await run(['status', 'sonarr', '--home', home], one.io, deps(docker))).toBe(0);
    expect(one.stdout()).not.toContain('jellyfin');
    const missing = capture();
    expect(
      await run(['status', 'radarr', '--home', home], missing.io, deps(docker)),
    ).toBe(1);
    expect(missing.stderr()).toContain('no container for "radarr" in this stack');
  });

  it('prints versioned JSON', async () => {
    const { home, docker } = await appliedHome();
    const term = capture();
    await run(['status', '--home', home, '--json'], term.io, deps(docker));
    const json = JSON.parse(term.stdout()) as {
      schema: string;
      healthy: boolean;
      containers: unknown[];
      lastApply: { outcome: string } | null;
    };
    expect(json).toMatchObject({ schema: 'mediaplane.status/v1', healthy: true });
    expect(json).not.toHaveProperty('historyError');
    expect(json.containers).toHaveLength(4);
    expect(json.lastApply?.outcome).toBe('success');
  });

  it('still shows the apps, with a warning, when the change history cannot be read', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(join(home, 'state', 'history'), 'not a folder');
    const runtime = fakeRuntime({ containers: running({ sonarr: 'a' }) });
    const term = capture();
    expect(await run(['status', '--home', home], term.io, deps(runtime))).toBe(0);
    expect(term.stdout()).toBe('APP     STATE    HEALTH\nsonarr  running  healthy\n');
    expect(term.stderr()).toMatch(
      /^warning: could not read the change history: ENOTDIR: not a directory.*\n$/,
    );
    const json = capture();
    expect(await run(['status', '--home', home, '--json'], json.io, deps(runtime))).toBe(
      0,
    );
    expect(JSON.parse(json.stdout())).toMatchObject({
      healthy: true,
      lastApply: null,
      historyError: expect.stringMatching(/^ENOTDIR/) as unknown,
    });
  });

  it('says when nothing is running yet', async () => {
    const home = await makeHome();
    const term = capture();
    expect(await run(['status', '--home', home], term.io, deps(fakeDocker(home)))).toBe(
      0,
    );
    expect(term.stdout()).toBe(
      'No containers are running for this stack. Run "mediaplane apply" to start it.\nNo apply has run yet.\n',
    );
  });
});

describe('mediaplane history', () => {
  it('lists change records and shows one in full', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const applied = capture();
    await run(['apply', '--home', home, '--yes', '--json'], applied.io, deps(docker));
    const id = (JSON.parse(applied.stdout()) as { recordId: string }).recordId;
    const list = capture();
    expect(await run(['history', '--home', home], list.io, deps(docker))).toBe(0);
    expect(list.stdout()).toBe(
      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 10 resources wired\n`,
    );
    const one = capture();
    expect(await run(['history', id, '--home', home], one.io, deps(docker))).toBe(0);
    expect(one.stdout()).toContain(`Change ${id}\n`);
    expect(one.stdout()).toContain(
      '  done    containers: every app is running and healthy; started jellyfin without its ports, to set it up first\n',
    );
    expect(one.stdout()).toContain('  done    wiring sonarr.admin: created\n');
    expect(one.stdout()).toContain('  done    wiring qbittorrent.category_tv: created\n');
    expect(one.stdout()).toContain('  done    wiring sonarr.download_client: created\n');
  });

  it('prints versioned JSON', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    await run(['apply', '--home', home, '--yes'], capture().io, deps(docker));
    const term = capture();
    await run(['history', '--home', home, '--json'], term.io, deps(docker));
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.history/v1',
      records: [{ outcome: 'success', changes: { files: 5, containers: 4, secrets: 4 } }],
      unreadable: [],
    });
  });

  it('fails for an unknown record, and says when there are none', async () => {
    const home = await makeHome();
    const unknown = capture();
    expect(await run(['history', 'nope', '--home', home], unknown.io, deps())).toBe(1);
    expect(unknown.stderr()).toContain('no change record "nope"');
    const empty = capture();
    expect(await run(['history', '--home', home], empty.io, deps())).toBe(0);
    expect(empty.stdout()).toBe('No changes have been applied yet.\n');
  });
});

describe('mediaplane host-report', () => {
  it('prints what it sees for a request, and is not listed in --help', async () => {
    const dir = await tempDir('mediaplane-report-');
    const term = capture();
    const request = JSON.stringify({
      facts: false,
      stat: [{ key: '/srv/data', at: dir }],
      free: [],
      ports: [],
    });
    expect(await run(['host-report', request], term.io)).toBe(0);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.host-report/v1',
      stat: { '/srv/data': { isDirectory: true } },
    });
    const help = capture();
    expect(await run(['--help'], help.io)).toBe(0);
    expect(help.stdout()).toContain('plan');
    expect(help.stdout()).not.toContain('host-report');
  });

  it('refuses a request it cannot read', async () => {
    const term = capture();
    expect(await run(['host-report', '{}'], term.io)).toBe(1);
    expect(term.stderr()).toContain('the host helper was given a request it cannot read');
  });

  it('explains a CPU it does not support in one line, without a stack trace', async () => {
    const real = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'arch', { value: 'ia32', configurable: true });
    try {
      const term = capture();
      const request = JSON.stringify({ facts: true, stat: [], free: [], ports: [] });
      expect(await run(['host-report', request], term.io)).toBe(1);
      expect(term.stderr()).toBe(
        'error: unsupported CPU architecture "ia32": Mediaplane supports amd64 and arm64\n',
      );
      expect(term.stdout()).toBe('');
    } finally {
      if (real !== undefined) Object.defineProperty(process, 'arch', real);
    }
  });
});

describe('mediaplane plex-tv', () => {
  it('makes the plex.tv call its standard input asks for, and is not listed in --help', async () => {
    const plexTv = await fakePlexTv();
    const term = capture();
    const io: Io = {
      ...term.io,
      stdin: () =>
        Promise.resolve(
          JSON.stringify({ op: 'account', token: FAKE_PLEX_ACCOUNT.token }),
        ),
    };
    expect(await run(['plex-tv'], io, { plexTvDirect: () => plexTv.client })).toBe(0);
    expect(JSON.parse(term.stdout())).toEqual({
      schema: 'mediaplane.plex-tv/v1',
      ok: true,
      value: FAKE_PLEX_ACCOUNT.id,
    });
    expect(plexTv.state.calls).toEqual(['GET /api/v2/user']);
    const help = capture();
    expect(await run(['--help'], help.io)).toBe(0);
    expect(help.stdout()).not.toContain('plex-tv');
  });

  it('refuses an empty standard input without a call', async () => {
    const plexTv = await fakePlexTv();
    const term = capture();
    expect(await run(['plex-tv'], term.io, { plexTvDirect: () => plexTv.client })).toBe(
      0,
    );
    expect(JSON.parse(term.stdout())).toMatchObject({ ok: false, kind: 'protocol' });
    expect(plexTv.state.calls).toEqual([]);
  });
});

describe('--help', () => {
  it('keeps every exit-code line within 80 columns, as --help does not wrap them', () => {
    for (const lines of Object.values(EXIT_CODES)) {
      for (const line of lines) expect(`  ${line}`.length).toBeLessThanOrEqual(80);
    }
  });

  it('says plan changes nothing in the stack, apart from the wiring network it joins from the image and the mark a key or password check can leave', async () => {
    const term = capture();
    expect(await run(['plan', '--help'], term.io)).toBe(0);
    // --help wraps long descriptions at 80 columns, so compare without the line breaks.
    const said = term.stdout().replaceAll(/\s+/g, ' ');
    expect(said).toContain(
      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see docs/security/threat-model.md)",
    );
    expect(said).not.toContain('without changing anything');
  });

  it("lists each command's exit codes", async () => {
    const term = capture();
    expect(await run(['plan', '--help'], term.io)).toBe(0);
    expect(term.stdout()).toContain('Exit codes:\n  0: nothing would change\n');
  });

  it("names the machine's timezone as init's default, not the zone itself", async () => {
    const term = capture();
    await run(['init', '--help'], term.io);
    // --help wraps long descriptions at 80 columns, so compare without the line breaks.
    expect(term.stdout().replaceAll(/\s+/g, ' ')).toContain(
      "(default: this machine's timezone)",
    );
  });
});
