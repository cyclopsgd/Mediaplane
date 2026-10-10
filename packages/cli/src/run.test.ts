import { mkdir, writeFile } from 'node:fs/promises';
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
  readSecretStore,
  renderEnvFile,
  secretValues,
  withGeneratedSecrets,
  writeSecretStore,
  type ContainerState,
  type HostRequest,
  type Runtime,
} from '@mediaplane/engine';
import {
  FIXTURE_HOST,
  fakeDocker,
  fakeProbe,
  fakeRuntime,
  running,
  tempDir,
} from '@mediaplane/engine/testing';
import { describe, expect, it, vi } from 'vitest';
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

async function makeHome(stack = STACK): Promise<string> {
  const home = await tempDir('mediaplane-cli-');
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
}

/** All zeros: the keys currentHome stores are never printed, so their value is moot. */
const zeros = (size: number) => Buffer.alloc(size, 0);

/** A home whose generated files and stored keys are what plan expects, as of `runtime`. */
async function currentHome(runtime: Runtime): Promise<string> {
  const home = await makeHome();
  const { context } = await planStack({
    home,
    catalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    probe: fakeProbe(),
  });
  if (context === undefined) throw new Error('the test stack must plan');
  const { store } = withGeneratedSecrets(context.stack, context.store, zeros);
  await writeSecretStore(home, store);
  await mkdir(join(home, 'generated'));
  await writeFile(join(home, COMPOSE_PATH), composeToYaml(context.compose, home));
  await writeFile(
    join(home, ENV_PATH),
    renderEnvFile(await secretValues(context.stack, store, {})),
  );
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

function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
  return {
    host: () => Promise.resolve(FIXTURE_HOST),
    runtime: () => runtime,
    probe: () => fakeProbe(),
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
      'Secrets to generate: admin.password, qbittorrent.apiKey, sonarr.apiKey\n',
    );
    expect(term.stdout()).toContain(
      'Plan: 2 files to write, 4 containers to change, 3 secrets to generate.',
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
      'Not healthy yet: sonarr (unhealthy)\nPlan: 1 app to wait for.\n',
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
      'Plan: 2 files to write, 4 containers to change, 3 secrets to generate.',
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
      actions: { step: string; result: string }[];
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
    expect(json.actions.map((a) => a.result)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expectNoSecrets(term.stdout() + term.stderr(), await secretsIn(home));
  });

  it('counts only the steps that changed something as "changed" in JSON', async () => {
    // Every key is stored already, so the keys step has nothing to do.
    const home = await currentHome(fakeRuntime());
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
      'Apply failed: 2 done, 1 failed, 3 skipped. Run apply again to retry.',
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
      /\nApply failed: 2 done, 1 failed, 3 skipped\. Run apply again to retry\.\n$/,
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
      `${id}  success  2 files written, 4 containers changed, 3 secrets generated\n`,
    );
    const one = capture();
    expect(await run(['history', id, '--home', home], one.io, deps(docker))).toBe(0);
    expect(one.stdout()).toContain(`Change ${id}\n`);
    expect(one.stdout()).toContain(
      '  done    containers: every app is running and healthy\n',
    );
  });

  it('prints versioned JSON', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    await run(['apply', '--home', home, '--yes'], capture().io, deps(docker));
    const term = capture();
    await run(['history', '--home', home, '--json'], term.io, deps(docker));
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.history/v1',
      records: [{ outcome: 'success', changes: { files: 2, containers: 4, secrets: 3 } }],
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

describe('--help', () => {
  it('keeps every exit-code line within 80 columns, as --help does not wrap them', () => {
    for (const lines of Object.values(EXIT_CODES)) {
      for (const line of lines) expect(`  ${line}`.length).toBeLessThanOrEqual(80);
    }
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
