import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  plan,
  renderEnvFile,
  type ContainerState,
  type Runtime,
} from '@mediaplane/engine';
import {
  FIXTURE_HOST,
  fakeDocker,
  fakeProbe,
  fakeRuntime,
  running,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type CliDeps, type Io } from './run';
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
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
}

/** A home whose generated files and stored keys are what plan expects, as of `runtime`. */
async function currentHome(runtime: Runtime): Promise<string> {
  const home = await makeHome();
  await mkdir(join(home, 'state'));
  await writeFile(
    join(home, 'state', 'secrets.json'),
    JSON.stringify({
      version: 1,
      apps: {
        sonarr: { apiKey: '0'.repeat(32) },
        qbittorrent: { apiKey: `qbt_${'0'.repeat(28)}` },
      },
    }),
  );
  const current = await plan({
    home,
    catalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    probe: fakeProbe(),
  });
  await mkdir(join(home, 'generated'));
  await writeFile(
    join(home, 'generated', 'compose.yaml'),
    current.files[0]?.content ?? '',
  );
  await writeFile(
    join(home, 'generated', '.env'),
    renderEnvFile({
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key-for-tests',
      MP_SONARR_API_KEY: '0'.repeat(32),
    }),
  );
  return home;
}

/** The fake WireGuard key and every key apply stored in the home: none may be printed. */
async function secretsIn(home: string): Promise<string[]> {
  const store = JSON.parse(
    await readFile(join(home, 'state', 'secrets.json'), 'utf8'),
  ) as {
    apps: Record<string, Record<string, string>>;
  };
  const generated = Object.values(store.apps).flatMap((keys) => Object.values(keys));
  expect(generated).toHaveLength(2);
  return ['fake-wireguard-key-for-tests', ...generated];
}

function expectNoSecrets(output: string, secrets: readonly string[]): void {
  for (const secret of secrets) expect(output).not.toContain(secret);
}

function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
  return { host: () => FIXTURE_HOST, runtime: () => runtime, probe: fakeProbe() };
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

describe('mediaplane plan', () => {
  it('exits 2 and shows files, containers and secrets for a fresh home', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome()], term.io, deps())).toBe(2);
    expect(term.stdout()).toContain('+ generated/compose.yaml');
    expect(term.stdout()).toContain('Containers:\n');
    expect(term.stdout()).toContain('  + create    sonarr\n');
    expect(term.stdout()).toContain(
      'Secrets to generate: qbittorrent.apiKey, sonarr.apiKey\n',
    );
    expect(term.stdout()).toContain(
      'Plan: 2 files to write, 4 containers to change, 2 secrets to generate.',
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
    expect(json.secrets.generate).toEqual(['qbittorrent.apiKey', 'sonarr.apiKey']);
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
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
    await mkdir(join(home, 'stack.yaml'));
    const term = capture();
    expect(await run(['plan', '--home', home], term.io, deps())).toBe(1);
    expect(term.stderr()).toBe(
      `error: cannot read ${join(home, 'stack.yaml')} (EISDIR)\n`,
    );
    expect(term.stdout()).toBe('');
  });

  it('reports unexpected errors as a JSON envelope with --json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
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
      'Plan: 2 files to write, 4 containers to change, 2 secrets to generate.',
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
      probe: fakeProbe({ freeBytes: 5 * 1024 ** 3 }),
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
        host: () => FIXTURE_HOST,
        probe: fakeProbe(),
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
      `${id}  success  2 files written, 4 containers changed, 2 secrets generated\n`,
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
      records: [{ outcome: 'success', changes: { files: 2, containers: 4, secrets: 2 } }],
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
