import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDefinition, Catalog } from '../catalog/types';
import type { HostFacts } from '../host/facts';
import { COMPOSE_PATH, ENV_PATH, SECRETS_PATH } from '../paths';
import { portKey } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import { renderEnvFile } from '../render/env';
import {
  HelperError,
  RuntimeError,
  type ContainerState,
  type Runtime,
} from '../runtime/types';
import { writeResources } from '../integrations/resources';
import type { WiringSeams } from '../integrations/wiring';
import { fakeHash, fakeProbe, fakeRuntime, running } from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { fakeHttpApp } from '../testing/http';
import { fakeSonarr, WIRED_CATALOG } from '../testing/wiring';
import { plan, planStack } from './plan';
import { tempDir } from '../testing/temp';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

const SERVICES = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'];
const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64)]));

/** Sonarr with one pre-start file, whose first line marks it as Mediaplane's. */
const configFiles: AppDefinition['configFiles'] = (ctx) => [
  { path: 'config.ini', content: `key=${ctx.secret('apiKey')}\n`, seeded: /^key=/m },
];
const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr' ? { ...app, configFiles } : app,
);

async function makeHome({
  stack = STACK,
  withSecret = true,
  withStore = false,
} = {}): Promise<string> {
  const home = await tempDir('mediaplane-plan-');
  await writeFile(join(home, 'stack.yaml'), stack);
  if (withSecret) {
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  }
  if (withStore) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, SECRETS_PATH),
      JSON.stringify({
        version: 1,
        apps: { sonarr: { apiKey: '0'.repeat(32) } },
        shared: { adminPassword: 'fake-admin-password' },
      }),
    );
  }
  return home;
}

/** The .env of a current home: the fixture's VPN key and the stored sonarr key. */
async function writeCurrentEnv(home: string): Promise<void> {
  await writeFile(
    join(home, ENV_PATH),
    renderEnvFile({
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key-for-tests',
      MP_SONARR_API_KEY: '0'.repeat(32),
    }),
  );
}

/** A home whose generated files are what plan writes, with Docker answering `runtime`. */
async function makeCurrentHome(runtime: Runtime): Promise<string> {
  const home = await makeHome({ withStore: true });
  const first = await planFor(home, { runtime });
  await mkdir(join(home, 'generated'));
  await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
  await writeCurrentEnv(home);
  return home;
}

function planFor(
  home: string,
  {
    runtime = fakeRuntime(),
    probe = fakeProbe(),
    env = {},
    catalog = fixtureCatalog,
    wiring,
  }: {
    runtime?: Runtime;
    probe?: HostProbe;
    env?: NodeJS.ProcessEnv;
    catalog?: Catalog;
    wiring?: WiringSeams;
  } = {},
) {
  return plan({
    home,
    catalog,
    host: FIXTURE_HOST,
    env,
    runtime,
    probe,
    ...(wiring === undefined ? {} : { wiring }),
  });
}

describe('plan', () => {
  it('plans pre-start files to create before first start, never showing them', async () => {
    const result = await planFor(await makeHome(), { catalog: WITH_FILES });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result.files.map((file) => file.path)).toEqual([
      COMPOSE_PATH,
      ENV_PATH,
      'appdata/sonarr/config.ini',
    ]);
    expect(result.files[2]).toEqual({
      path: 'appdata/sonarr/config.ini',
      status: 'create',
      diff: '',
      content: '',
      sensitive: true,
      prestart: true,
    });
  });

  it('leaves a pre-start file alone once it exists', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const home = await makeCurrentHome(runtime);
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), 'key=rewritten\n');
    const result = await planFor(home, { runtime, catalog: WITH_FILES });
    expect(result.changed).toBe(false);
    expect(result.files[2]).toMatchObject({
      path: 'appdata/sonarr/config.ini',
      status: 'unchanged',
    });
  });

  it('plans a missing pre-start file in an otherwise current home, as the one change', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const home = await makeCurrentHome(runtime);
    const result = await planFor(home, { runtime, catalog: WITH_FILES });
    expect(result).toMatchObject({ ok: true, changed: true, secrets: { generate: [] } });
    expect(result.files.map((file) => file.status)).toEqual([
      'unchanged',
      'unchanged',
      'create',
    ]);
    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('fails when a pre-start file is from before Mediaplane seeded the app', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), 'user=someone\n');
    const result = await planFor(home, { catalog: WITH_FILES });
    expect(result).toMatchObject({ ok: false, changed: false, files: [] });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'sonarr.not-seeded', severity: 'error' }),
    );
  });

  describe('with pre-start files that hold secrets', () => {
    /** Sonarr's file holds its key and the admin password; the test records what it held. */
    function recording() {
      const secrets: string[] = [];
      const recorded: AppDefinition['configFiles'] = (ctx) => {
        const key = ctx.secret('apiKey');
        const content = `key=${key}\npassword=${ctx.admin.password}\n`;
        secrets.push(key, ctx.admin.password, content);
        return [{ path: 'config.ini', content, seeded: /^key=/m }];
      };
      const catalog: Catalog = fixtureCatalog.map((app) =>
        app.id === 'sonarr' ? { ...app, configFiles: recorded } : app,
      );
      return { catalog, secrets };
    }

    it('shows neither the file nor the keys in it, from a preview of new keys', async () => {
      const { catalog, secrets } = recording();
      const result = await planFor(await makeHome(), { catalog });
      expect(result.ok).toBe(true);
      expect(secrets).toHaveLength(3);
      for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret);
    });

    it('shows neither in the error for a file from before it was seeded', async () => {
      const { catalog, secrets } = recording();
      const home = await makeHome();
      await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
      await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), 'user=someone\n');
      const result = await planFor(home, { catalog });
      expect(result.ok).toBe(false);
      expect(secrets).toHaveLength(3);
      for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret);
    });

    it('writes nothing, not even the appdata folder', async () => {
      const home = await makeHome();
      const before = (await readdir(home, { recursive: true })).sort();
      await planFor(home, { catalog: WITH_FILES });
      expect((await readdir(home, { recursive: true })).sort()).toEqual(before);
    });
  });

  it('plans files, containers and secrets for a fresh home', async () => {
    const result = await planFor(await makeHome());
    expect(result).toMatchObject({ ok: true, changed: true, diagnostics: [] });
    expect(result.files).toEqual([
      expect.objectContaining({ path: COMPOSE_PATH, status: 'create' }),
      { path: ENV_PATH, status: 'create', diff: '', content: '', sensitive: true },
    ]);
    expect(result.files[0]?.content).toContain('name: mediaplane');
    expect(result.containers).toEqual(
      SERVICES.map((service) => ({ service, action: 'create' })),
    );
    expect(result.secrets).toEqual({ generate: ['admin.password', 'sonarr.apiKey'] });
  });

  it('reports no changes when files, containers and secrets are current', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const result = await planFor(await makeCurrentHome(runtime), { runtime });
    expect(result).toMatchObject({
      ok: true,
      changed: false,
      secrets: { generate: [] },
      unhealthy: [],
    });
    expect(result.files).toEqual([
      expect.objectContaining({ path: COMPOSE_PATH, status: 'unchanged' }),
      expect.objectContaining({ path: ENV_PATH, status: 'unchanged', sensitive: true }),
    ]);
    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
  });

  describe('with an appdata/ folder apply would have to change', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** A current home (nothing else to change) with an appdata/ of mode `mode`. */
    async function currentHomeWithAppdata(mode: number) {
      const runtime = fakeRuntime({
        hashes: { ok: true, hashes: HASHES },
        containers: running(HASHES),
      });
      const home = await makeCurrentHome(runtime);
      await mkdir(join(home, 'appdata'));
      await chmod(join(home, 'appdata'), mode);
      return { home, runtime };
    }

    /** Mediaplane runs as `uid`, as process.geteuid() says. */
    function runningAs(uid: number): void {
      vi.spyOn(process, 'geteuid').mockReturnValue(uid);
    }

    const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

    it('notes that apply will make an open appdata/ private, and still finds no change', async () => {
      const { home, runtime } = await currentHomeWithAppdata(0o755);
      const result = await planFor(home, { runtime });
      expect(result).toMatchObject({ ok: true, changed: false });
      expect(result.diagnostics).toEqual([
        {
          severity: 'warning',
          code: 'appdata.not-private',
          message: `${join(home, 'appdata')} has mode 0755, not 0700; apply will make it private (0700)`,
          hint: 'nothing to do: apply makes appdata/ itself private on every run; the app folders in it keep the modes their apps give them',
        },
      ]);
    });

    it('writes nothing: plan only looks at appdata/', async () => {
      const { home, runtime } = await currentHomeWithAppdata(0o755);
      const before = (await readdir(home, { recursive: true })).sort();
      await planFor(home, { runtime });
      expect((await readdir(home, { recursive: true })).sort()).toEqual(before);
      expect(await modeOf(join(home, 'appdata'))).toBe(0o755);
    });

    it('says nothing about an appdata/ that is private already', async () => {
      const { home, runtime } = await currentHomeWithAppdata(0o700);
      const result = await planFor(home, { runtime });
      expect(result).toMatchObject({ ok: true, changed: false, diagnostics: [] });
    });

    it('says nothing about an appdata/ that does not exist, which apply creates', async () => {
      const runtime = fakeRuntime({
        hashes: { ok: true, hashes: HASHES },
        containers: running(HASHES),
      });
      const result = await planFor(await makeCurrentHome(runtime), { runtime });
      expect(result.diagnostics).toEqual([]);
    });

    it('leaves a file where appdata/ should be to apply, which stops with its own error', async () => {
      const runtime = fakeRuntime({
        hashes: { ok: true, hashes: HASHES },
        containers: running(HASHES),
      });
      const home = await makeCurrentHome(runtime);
      await writeFile(join(home, 'appdata'), 'not a folder');
      expect((await planFor(home, { runtime })).diagnostics).toEqual([]);
    });

    it('warns that apply will fail when appdata/ belongs to another user, and how to fix it', async () => {
      const { home, runtime } = await currentHomeWithAppdata(0o755);
      const owner = (await stat(join(home, 'appdata'))).uid;
      runningAs(owner + 1);
      const result = await planFor(home, { runtime });
      expect(result).toMatchObject({ ok: true, changed: false });
      // The wording of the apply error's hint (apply.test.ts), and no mode note: apply
      // stops before it would matter.
      expect(result.diagnostics).toEqual([
        {
          severity: 'warning',
          code: 'appdata.not-owned',
          message: `${join(home, 'appdata')} belongs to uid ${String(owner)}, not to the user Mediaplane runs as (uid ${String(owner + 1)}), so apply will fail to make it private (0700)`,
          hint: 'give appdata/ itself, not what is in it, to the user Mediaplane runs as (MEDIAPLANE_UID in its container), then run apply again',
        },
      ]);
    });

    it('does not warn about the owner when Mediaplane runs as root, which can change any mode', async () => {
      const { home, runtime } = await currentHomeWithAppdata(0o700);
      runningAs(0);
      expect((await planFor(home, { runtime })).diagnostics).toEqual([]);
    });
  });

  it('plans apps whose health check has not passed yet as something to wait for', async () => {
    const health: Record<string, string> = { sonarr: 'unhealthy', jellyfin: 'starting' };
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES).map((c) => ({ ...c, health: health[c.service] ?? '' })),
    });
    const result = await planFor(await makeCurrentHome(runtime), { runtime });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      unhealthy: ['jellyfin (starting)', 'sonarr (unhealthy)'],
    });
    expect(result.files.every((f) => f.status === 'unchanged')).toBe(true);
    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('does not wait for apps the plan already starts, recreates or removes', async () => {
    const sick = (
      service: string,
      extra: Partial<ContainerState> = {},
    ): ContainerState => ({
      service,
      id: `fake-${service}`,
      state: 'running',
      health: 'unhealthy',
      configHash: HASHES[service] ?? 'e'.repeat(64),
      published: [],
      ...extra,
    });
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: [
        sick('gluetun', { configHash: 'f'.repeat(64) }),
        sick('qbittorrent'),
        sick('jellyfin', { health: 'healthy' }),
        sick('sonarr'),
        sick('sonarr', { id: 'fake-sonarr-2', state: 'exited' }),
        sick('bazarr'),
      ],
    });
    const result = await planFor(await makeCurrentHome(runtime), { runtime });
    expect(result.containers).toEqual([
      { service: 'gluetun', action: 'recreate' },
      { service: 'jellyfin', action: 'unchanged' },
      { service: 'qbittorrent', action: 'recreate' },
      { service: 'sonarr', action: 'start' },
      { service: 'bazarr', action: 'remove' },
    ]);
    expect(result.unhealthy).toEqual([]);
  });

  it('lists an app once when several of its containers are not healthy', async () => {
    const sick = running(HASHES).map((c) => ({ ...c, health: 'unhealthy' }));
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: [...sick, ...sick.filter((c) => c.service === 'sonarr')],
    });
    const result = await planFor(await makeCurrentHome(runtime), { runtime });
    expect(result.unhealthy).toEqual([
      'gluetun (unhealthy)',
      'jellyfin (unhealthy)',
      'qbittorrent (unhealthy)',
      'sonarr (unhealthy)',
    ]);
  });

  it('keeps the VPN guest unchanged when it and its host are current', async () => {
    const home = await makeHome({ withStore: true });
    const asked: { compose: string; values: Record<string, string> }[] = [];
    const base = fakeRuntime();
    const runtime: Runtime = {
      ...base,
      configHashes: (compose, values) => {
        asked.push({ compose, values });
        return base.configHashes(compose, values);
      },
    };
    await planFor(home, { runtime });
    const { compose, values } = asked[0] ?? { compose: '', values: {} };
    // Compose records qbittorrent's hash with gluetun's container ID in its network_mode.
    const guest = compose.replace(
      'network_mode: service:gluetun',
      'network_mode: container:fake-gluetun',
    );
    const labels = {
      ...fakeHash(compose, values),
      qbittorrent: fakeHash(guest, values).qbittorrent ?? '',
    };
    const result = await planFor(home, {
      runtime: fakeRuntime({ containers: running(labels) }),
    });
    expect(result.containers).toEqual(
      SERVICES.map((service) => ({ service, action: 'unchanged' })),
    );
  });

  it("warns when the project's containers were created from another home", async () => {
    const home = await makeHome();
    const elsewhere: ContainerState = {
      service: 'sonarr',
      id: 'fake-sonarr',
      state: 'running',
      health: 'healthy',
      configHash: undefined,
      published: [],
      workingDir: '/srv/other-home',
    };
    const result = await planFor(home, {
      runtime: fakeRuntime({ containers: [elsewhere] }),
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'project.other-home', severity: 'warning' }),
    );
  });

  it('warns when it runs from its image without the socket proxy', async () => {
    const result = await planFor(await makeHome(), {
      env: { MEDIAPLANE_IMAGE: 'mediaplane:test' },
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual(['docker.no-proxy']);
  });

  it('never writes to the home directory', async () => {
    const home = await makeHome();
    const before = (await readdir(home, { recursive: true })).sort();
    await planFor(home);
    expect((await readdir(home, { recursive: true })).sort()).toEqual(before);
  });

  it('explains a Docker it cannot reach', async () => {
    const runtime = fakeRuntime({
      unavailable: 'cannot talk to Docker: connection refused',
    });
    const result = await planFor(await makeHome(), { runtime });
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      containers: [],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'cannot talk to Docker: connection refused',
      }),
    );
  });

  it('explains a Docker that stops answering while predicting containers', async () => {
    const runtime: Runtime = {
      ...fakeRuntime(),
      configHashes: () =>
        Promise.reject(
          new RuntimeError('docker compose config did not finish within 60s'),
        ),
    };
    const result = await planFor(await makeHome(), { runtime });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'docker compose config did not finish within 60s',
      }),
    );
  });

  it('explains a host helper that cannot run', async () => {
    const probe: HostProbe = {
      ...fakeProbe(),
      prepare: () =>
        Promise.reject(new HelperError('the host helper failed: no such image')),
    };
    const result = await planFor(await makeHome(), { probe });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'host.helper-failed',
        message: 'the host helper failed: no such image',
        hint: expect.stringContaining('MEDIAPLANE_IMAGE') as unknown,
      }),
    );
  });

  it('explains a host helper that does not finish with the hint it carries', async () => {
    const probe: HostProbe = {
      ...fakeProbe(),
      prepare: () =>
        Promise.reject(
          new HelperError('the host helper did not finish within 60 s', {
            hint: 'fake: check the network shares',
          }),
        ),
    };
    const result = await planFor(await makeHome(), { probe });
    expect(result.diagnostics).toContainEqual({
      severity: 'error',
      code: 'host.helper-failed',
      message: 'the host helper did not finish within 60 s',
      hint: 'fake: check the network shares',
    });
  });

  it('explains a docker that cannot be started while the host helper runs', async () => {
    const probe: HostProbe = {
      ...fakeProbe(),
      prepare: () => Promise.reject(new RuntimeError('docker was not found on PATH')),
    };
    const result = await planFor(await makeHome(), { probe });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'docker was not found on PATH',
      }),
    );
  });

  describe('when Docker cannot be reached', () => {
    const UNREACHABLE =
      'cannot talk to Docker: failed to connect to the docker API at tcp://socket-proxy:2375: lookup socket-proxy: no such host';
    const PROXY_ENV = {
      MEDIAPLANE_IMAGE: 'mediaplane:local',
      DOCKER_HOST: 'tcp://socket-proxy:2375',
    };
    const PROXY_HINT =
      'Mediaplane reaches Docker through the socket proxy: on the host, check that the socket-proxy container is running, with "docker compose -f deploy/mediaplane.compose.yaml ps", and read its log with "docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy"';
    const DOCKER_HINT =
      'start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)';

    it.each([
      ['from source', {}, DOCKER_HINT],
      ['in the image, through the proxy', PROXY_ENV, PROXY_HINT],
      [
        'in the image, on the socket itself',
        { ...PROXY_ENV, DOCKER_HOST: 'unix:///var/run/docker.sock' },
        DOCKER_HINT,
      ],
    ])('says what to check when Mediaplane runs %s', async (_where, env, hint) => {
      const runtime = fakeRuntime({ unavailable: UNREACHABLE });
      const result = await planFor(await makeHome(), { runtime, env });
      expect(result.diagnostics).toContainEqual({
        severity: 'error',
        code: 'docker.unavailable',
        message: UNREACHABLE,
        hint,
      });
    });

    it('blames the stopped proxy, not the host helper that could not reach it', async () => {
      const result = await plan({
        home: await makeHome(),
        catalog: fixtureCatalog,
        // In the image, the host helper is the first docker call plan makes.
        host: () =>
          Promise.reject(
            new HelperError(
              'the host helper failed: failed to connect to the docker API at tcp://socket-proxy:2375: lookup socket-proxy: no such host',
            ),
          ),
        env: PROXY_ENV,
        runtime: fakeRuntime({ unavailable: UNREACHABLE }),
        probe: fakeProbe(),
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([
        {
          severity: 'error',
          code: 'docker.unavailable',
          message: UNREACHABLE,
          hint: PROXY_HINT,
        },
      ]);
    });
  });

  it('asks for the host facts once the stack has loaded, and explains a failure', async () => {
    const planWith = (home: string, host: () => Promise<HostFacts>) =>
      plan({
        home,
        catalog: fixtureCatalog,
        host,
        env: {},
        runtime: fakeRuntime(),
        probe: fakeProbe(),
      });
    const home = await makeHome();
    const asked: string[] = [];
    const facts = () => {
      asked.push('facts');
      return Promise.resolve(FIXTURE_HOST);
    };
    expect(await planWith(home, facts)).toMatchObject({ ok: true, changed: true });
    expect(asked).toEqual(['facts']);
    // No stack to plan: the host helper is not run at all.
    const empty = await tempDir('mediaplane-plan-');
    expect(await planWith(empty, facts)).toMatchObject({ ok: false });
    expect(asked).toEqual(['facts']);

    const helper = await planWith(home, () =>
      Promise.reject(new HelperError('the host helper failed: no such image')),
    );
    expect(helper.ok).toBe(false);
    expect(helper.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'host.helper-failed',
        message: 'the host helper failed: no such image',
      }),
    );
    const docker = await planWith(home, () =>
      Promise.reject(new RuntimeError('cannot talk to Docker: connection refused')),
    );
    expect(docker.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'cannot talk to Docker: connection refused',
      }),
    );
    const bug = new TypeError('fake: a bug, not the helper');
    await expect(planWith(home, () => Promise.reject(bug))).rejects.toBe(bug);
  });

  it('lets an unexpected preflight error through rather than blaming Docker', async () => {
    const bug = new TypeError('fake: a bug, not the helper');
    const probe: HostProbe = { ...fakeProbe(), prepare: () => Promise.reject(bug) };
    await expect(planFor(await makeHome(), { probe })).rejects.toBe(bug);
  });

  it('lets an unexpected error through rather than blaming Docker', async () => {
    const home = await makeHome();
    const bug = new TypeError('fake: a bug, not Docker');
    const early: Runtime = { ...fakeRuntime(), versions: () => Promise.reject(bug) };
    await expect(planFor(home, { runtime: early })).rejects.toBe(bug);
    const late: Runtime = { ...fakeRuntime(), configHashes: () => Promise.reject(bug) };
    await expect(planFor(home, { runtime: late })).rejects.toBe(bug);
  });

  it('stops on a preflight error', async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    const result = await planFor(await makeHome(), { probe });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'preflight.port-in-use' })],
    });
  });

  it('reports a configuration Compose rejects', async () => {
    const runtime = fakeRuntime({
      hashes: { ok: false, error: 'services.sonarr.ports must be a list' },
    });
    const result = await planFor(await makeHome(), { runtime });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'compose.invalid',
        message:
          'docker compose rejected the configuration: services.sonarr.ports must be a list',
      }),
    );
  });

  it('rejects a home path containing ":"', async () => {
    const result = await plan({
      home: '/tmp/a:b',
      catalog: fixtureCatalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime(),
      probe: fakeProbe(),
    });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'home.invalid' }] });
  });

  it('fails with the config error when stack.yaml is missing', async () => {
    const home = await tempDir('mediaplane-plan-');
    expect(await planFor(home)).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      unhealthy: [],
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('fails when a referenced secret is missing', async () => {
    expect(await planFor(await makeHome({ withSecret: false }))).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
      ],
    });
  });

  it('fails when the stack does not resolve', async () => {
    const stack = STACK.replace('  qbittorrent: {}\n', '');
    expect(await planFor(await makeHome({ stack }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'app.missing-capability' })],
    });
  });

  it('notices a stale .env without showing what is in it', async () => {
    const home = await makeHome({ withStore: true });
    const runtime = fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
    });
    const first = await planFor(home, { runtime });
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
    await writeFile(join(home, ENV_PATH), "MP_SONARR_API_KEY='fake-edited-by-hand'\n");
    const result = await planFor(home, { runtime });
    expect(result.changed).toBe(true);
    expect(result.files[1]).toEqual({
      path: ENV_PATH,
      status: 'update',
      diff: '',
      content: '',
      sensitive: true,
    });
    expect(JSON.stringify(result)).not.toContain('fake-wireguard-key-for-tests');
  });

  it('gives apply the resolved stack, compose and store of a successful plan', async () => {
    const ok = await planStack({
      home: await makeHome(),
      catalog: fixtureCatalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime(),
      probe: fakeProbe(),
    });
    expect(ok.context?.stack.apps.map((a) => a.def.id)).toEqual([
      'gluetun',
      'jellyfin',
      'qbittorrent',
      'sonarr',
    ]);
    expect(Object.keys(ok.context?.compose.services ?? {})).toHaveLength(4);
    const failed = await planStack({
      home: await makeHome({ withSecret: false }),
      catalog: fixtureCatalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime(),
      probe: fakeProbe(),
    });
    expect(failed).toMatchObject({ result: { ok: false }, context: undefined });
  });
});

describe('plan: the wiring', () => {
  /** A current home for WIRED_CATALOG, its apps running as `runtime` says. */
  async function wiredHome(runtime: Runtime, seams: WiringSeams): Promise<string> {
    const home = await makeHome({ withStore: true });
    const first = await planFor(home, { runtime, catalog: WIRED_CATALOG, wiring: seams });
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
    await writeCurrentEnv(home);
    return home;
  }
  const current = (calls: string[], addresses: Record<string, string>) =>
    fakeRuntime({
      hashes: { ok: true, hashes: HASHES },
      containers: running(HASHES),
      addresses,
      calls,
    });

  it('joins the wiring network, then plans each resource of a running app', async () => {
    const sonarr = await fakeSonarr({ key: '0'.repeat(32) });
    const calls: string[] = [];
    const runtime = current(calls, sonarr.addresses);
    const home = await wiredHome(runtime, sonarr.seams);
    calls.length = 0;
    const result = await planFor(home, {
      runtime,
      catalog: WIRED_CATALOG,
      wiring: sonarr.seams,
    });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      wiring: [{ resource: 'sonarr.login', action: 'create' }],
    });
    expect(result.files.every((f) => f.status === 'unchanged')).toBe(true);
    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
    expect(calls.indexOf('join-wiring')).toBeLessThan(
      calls.findIndex((call) => call.startsWith('wiring-addresses')),
    );
  });

  it('has nothing to change once the app holds what resources.json records', async () => {
    const sonarr = await fakeSonarr({
      key: '0'.repeat(32),
      user: 'admin',
      password: 'fake-admin-password',
    });
    const runtime = current([], sonarr.addresses);
    const home = await wiredHome(runtime, sonarr.seams);
    await writeResources(home, {
      'sonarr.login': {
        id: null,
        name: 'login',
        fields: { user: 'admin' },
        secrets: ['password'],
        appliedAt: '2026-10-10T12:00:00.000Z',
      },
    });
    const result = await planFor(home, {
      runtime,
      catalog: WIRED_CATALOG,
      wiring: sonarr.seams,
    });
    expect(result).toMatchObject({
      ok: true,
      changed: false,
      wiring: [{ resource: 'sonarr.login', action: 'unchanged' }],
    });
  });

  it('checks the wiring after the start on a first plan, asking no app', async () => {
    const sonarr = await fakeSonarr();
    const result = await planFor(await makeHome(), {
      catalog: WIRED_CATALOG,
      wiring: sonarr.seams,
    });
    expect(result.wiring).toEqual([{ resource: 'sonarr.login', action: 'after-start' }]);
    expect(sonarr.app.requests).toEqual([]);
  });

  it('fails on a wiring network it must not join, or a resources.json it cannot read', async () => {
    const refused = fakeRuntime({
      join: () => {
        throw new RuntimeError(
          'refusing to join mediaplane_wiring: it is not internal, so Mediaplane would get a route out',
        );
      },
    });
    const network = await planFor(await makeHome(), {
      runtime: refused,
      catalog: WIRED_CATALOG,
    });
    expect(network.ok).toBe(false);
    expect(network.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'wire.network', severity: 'error' }),
    );
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, 'state', 'resources.json'),
      '{"schema": "something else"}',
    );
    const unreadable = await planFor(home, { catalog: WIRED_CATALOG });
    expect(unreadable.ok).toBe(false);
    expect(unreadable.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'resources.invalid', severity: 'error' }),
    );
  });

  it('joins nothing and asks no app for a stack with no API', async () => {
    const calls: string[] = [];
    const result = await planFor(await makeHome(), { runtime: fakeRuntime({ calls }) });
    expect(result.wiring).toEqual([]);
    expect(calls.some((call) => /wiring/.test(call))).toBe(false);
  });

  it('keeps every secret the stack knows out of what an app says', async () => {
    // Sonarr repeats the admin password and the VPN key, which no call of plan sends:
    // only the stack's secrets, handed to the client, take them out (preflight M5).
    const app = await fakeHttpApp((request) =>
      request.path === '/api/v3/login'
        ? {
            status: 500,
            body: { message: 'held: fake-admin-password, fake-wireguard-key-for-tests' },
          }
        : { status: 200, body: {} },
    );
    const seams: WiringSeams = {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    };
    const runtime = current([], { 'fake-sonarr': '127.0.0.1' });
    const home = await wiredHome(runtime, seams);
    const result = await planFor(home, {
      runtime,
      catalog: WIRED_CATALOG,
      wiring: seams,
    });
    expect(result.wiring).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason: expect.stringContaining('failed (HTTP 500): held: ***, ***') as string,
      },
    ]);
    const shown = JSON.stringify(result);
    expect(shown).not.toContain('fake-admin-password');
    expect(shown).not.toContain('fake-wireguard-key-for-tests');
  });

  it('writes no file: joining the wiring network is its one change to Docker', async () => {
    const sonarr = await fakeSonarr({
      key: '0'.repeat(32),
      user: 'admin',
      password: 'fake-admin-password',
    });
    const calls: string[] = [];
    const runtime = current(calls, sonarr.addresses);
    const home = await wiredHome(runtime, sonarr.seams);
    await writeResources(home, {});
    // Every file in the home, with its content and when it was last written.
    const files = async () => {
      const names = (await readdir(home, { recursive: true })).sort();
      return Promise.all(
        names.map(async (name) => {
          const path = join(home, name);
          const info = await stat(path);
          return [name, info.mtimeMs, info.isFile() ? await readFile(path, 'utf8') : ''];
        }),
      );
    };
    const before = await files();
    calls.length = 0;
    await planFor(home, { runtime, catalog: WIRED_CATALOG, wiring: sonarr.seams });
    expect(await files()).toEqual(before);
    const reads = /^(versions|containers|configHashes|inspect|wiring-addresses)\b/;
    expect(calls).toContain('wiring-addresses fake-sonarr');
    expect(calls.filter((call) => !reads.test(call))).toEqual(['join-wiring']);
  });
});
