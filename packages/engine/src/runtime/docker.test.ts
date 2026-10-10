import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bindMount,
  createDockerRuntime,
  dockerAccessWarnings,
  isManagedProject,
  ownContainerId,
  parseContainers,
  parseHashes,
  usesSocketProxy,
} from './docker';
import type { Exec, ExecOptions, ExecResult } from './exec';
import { HelperError, RuntimeError } from './types';
import { tempDir } from '../testing/temp';

interface Call {
  args: readonly string[];
  options: ExecOptions | undefined;
}

function recorder(respond: (args: readonly string[]) => ExecResult) {
  const calls: Call[] = [];
  const exec: Exec = (_command, args, options) => {
    calls.push({ args, options });
    return Promise.resolve(respond(args));
  };
  return { exec, calls };
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });
const failure = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
const HASH = 'a'.repeat(64);
/** `ps --no-trunc` reports full 64-character container IDs. */
const SONARR_ID = 'd5a2f5c9b82d'.padEnd(64, '0');

const PS_SONARR = JSON.stringify({
  Service: 'sonarr',
  ID: SONARR_ID,
  State: 'running',
  Health: 'healthy',
  Labels: `com.docker.compose.project.config_files=/opt/mediaplane/generated/compose.yaml,/opt/mediaplane/compose.override.yaml,com.docker.compose.config-hash=${HASH},com.docker.compose.oneoff=False,com.docker.compose.service=sonarr`,
  Publishers: [
    { URL: '127.0.0.1', TargetPort: 8989, PublishedPort: 8989, Protocol: 'tcp' },
    { URL: '', TargetPort: 6881, PublishedPort: 0, Protocol: 'tcp' },
  ],
});
const PS_BYPARR = JSON.stringify({
  Service: 'byparr',
  ID: '0b1c2d3e4f5a'.padEnd(64, '0'),
  State: 'exited',
  Health: '',
  Labels: 'com.docker.compose.service=byparr',
  Publishers: [],
});

describe('createDockerRuntime', () => {
  const home = '/opt/mediaplane';

  it('reads the Engine and Compose versions', async () => {
    const { exec } = recorder((args) =>
      args[0] === 'version' ? ok('29.8.0\n') : ok('v2.30.1\n'),
    );
    expect(
      await createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).toEqual({
      engine: '29.8.0',
      compose: '2.30.1',
    });
  });

  it('explains a Docker daemon it cannot reach', async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\n',
    }));
    const failure = createDockerRuntime({ home, project: 'mediaplane', exec }).versions();
    await expect(failure).rejects.toBeInstanceOf(RuntimeError);
    await expect(failure).rejects.toThrow(
      'cannot talk to Docker: Cannot connect to the Docker daemon',
    );
  });

  it('explains a Docker without the Compose plugin', async () => {
    const { exec } = recorder((args) =>
      args[0] === 'version'
        ? ok('29.8.0\n')
        : { code: 1, stdout: '', stderr: "docker: 'compose' is not a docker command.\n" },
    );
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow(
      "Docker Compose is not available: docker: 'compose' is not a docker command.",
    );
  });

  it('explains a docker command it cannot start', async () => {
    const exec: Exec = () => Promise.reject(failure('EACCES', 'spawn docker EACCES'));
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow('could not run docker: spawn docker EACCES');
  });

  it('explains a failed container listing', async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: 'permission denied while trying to connect to the Docker daemon socket\n',
    }));
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).containers(),
    ).rejects.toThrow(
      'docker compose ps failed: permission denied while trying to connect to the Docker daemon socket',
    );
  });

  it('explains a missing docker command', async () => {
    const exec: Exec = () =>
      Promise.reject(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }));
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow('docker was not found on PATH');
  });

  it('gives up on a docker call that hangs', async () => {
    const seen: (ExecOptions | undefined)[] = [];
    const exec: Exec = (_command, _args, options) => {
      seen.push(options);
      return Promise.reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    };
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow(
      'docker version did not finish within 60s; check that the Docker daemon is responding',
    );
    expect(seen[0]?.timeoutMs).toBe(60_000);
  });

  it('hashes an unwritten compose file from stdin, with secret values in the environment', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    const { exec, calls } = recorder(() =>
      ok(`sonarr ${HASH}\nradarr ${'b'.repeat(64)}\n`),
    );
    const runtime = createDockerRuntime({
      home: dir,
      project: 'mediaplane',
      exec,
      env: {},
    });
    const result = await runtime.configHashes('name: mediaplane\n', { MP_X: 'fake-x' });
    expect(result).toEqual({
      ok: true,
      hashes: { sonarr: HASH, radarr: 'b'.repeat(64) },
    });
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'mediaplane',
      '--project-directory',
      dir,
      '-f',
      '-',
      // Never <home>/.env: up reads only generated/.env, so the hash must not either.
      '--env-file',
      '/dev/null',
      'config',
      '--hash',
      '*',
    ]);
    expect(calls[0]?.options).toMatchObject({
      input: 'name: mediaplane\n',
      cwd: '/',
      env: { MP_X: 'fake-x' },
    });
  });

  it("adds the user's compose.override.yaml when it exists", async () => {
    const dir = await tempDir('mediaplane-runtime-');
    await writeFile(join(dir, 'compose.override.yaml'), 'services: {}\n');
    const { exec, calls } = recorder(() => ok(''));
    await createDockerRuntime({
      home: dir,
      project: 'mediaplane-test',
      exec,
    }).configHashes('x', {});
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'mediaplane-test',
      '--project-directory',
      dir,
      '-f',
      '-',
      '-f',
      join(dir, 'compose.override.yaml'),
      '--env-file',
      '/dev/null',
      'config',
      '--hash',
      '*',
    ]);
  });

  it("returns Compose's error when it rejects the configuration", async () => {
    const { exec } = recorder(() => ({
      code: 15,
      stdout: '',
      stderr: 'yaml: line 3: bad\n',
    }));
    expect(
      await createDockerRuntime({ home, project: 'mediaplane-test', exec }).configHashes(
        'x',
        {},
      ),
    ).toEqual({ ok: false, error: 'yaml: line 3: bad' });
  });

  it('replaces secret values in the error Compose returns with ***', async () => {
    const { exec } = recorder(() => ({
      code: 15,
      stdout: '',
      stderr:
        'invalid value "fake-secret-value" for MP_A; MP_B is fake.secret+x ' +
        '(not fakeXsecretx); again fake-secret-value; short fake-secret; empty: none\n',
    }));
    const result = await createDockerRuntime({
      home,
      project: 'mediaplane-test',
      exec,
    }).configHashes('x', {
      MP_SHORT: 'fake-secret',
      MP_A: 'fake-secret-value',
      MP_B: 'fake.secret+x',
      MP_EMPTY: '',
    });
    expect(result).toEqual({
      ok: false,
      error:
        'invalid value "***" for MP_A; MP_B is *** (not fakeXsecretx); again ***; short ***; empty: none',
    });
  });

  it("lists the project's containers by name only, with full container IDs", async () => {
    const { exec, calls } = recorder(() => ok(`${PS_SONARR}\n${PS_BYPARR}\n`));
    const containers = await createDockerRuntime({
      home,
      project: 'mediaplane-test',
      exec,
    }).containers();
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'mediaplane-test',
      'ps',
      '--all',
      '--no-trunc',
      '--format',
      'json',
    ]);
    expect(containers.map((c) => c.service)).toEqual(['sonarr', 'byparr']);
  });

  const projectArgs = (dir: string) => [
    'compose',
    '-p',
    'mediaplane-test',
    '--project-directory',
    dir,
    '-f',
    join(dir, 'generated/compose.yaml'),
    '--env-file',
    join(dir, 'generated/.env'),
  ];

  it('pulls missing images for the written project', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    expect(await runtime.pull({})).toEqual({ ok: true });
    expect(calls[0]?.args).toEqual([
      ...projectArgs(dir),
      'pull',
      '--policy',
      'missing',
      '--quiet',
    ]);
    expect(calls[0]?.options?.timeoutMs).toBe(1_800_000);
  });

  it('starts the project and waits for it to be healthy', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    await writeFile(join(dir, 'compose.override.yaml'), 'services: {}\n');
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    expect(await runtime.up(600, {})).toEqual({ ok: true });
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'mediaplane-test',
      '--project-directory',
      dir,
      '-f',
      join(dir, 'generated/compose.yaml'),
      '-f',
      join(dir, 'compose.override.yaml'),
      '--env-file',
      join(dir, 'generated/.env'),
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '600',
      '--remove-orphans',
      '--quiet-pull',
    ]);
    expect(calls[0]?.options?.timeoutMs).toBe(720_000);
  });

  it('runs chown as root in a throwaway container of the service', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    expect(
      await runtime.chown('seerr', '/app/config', { uid: 1000, gid: 1000 }, {}),
    ).toEqual({
      ok: true,
    });
    expect(calls[0]?.args).toEqual([
      ...projectArgs(dir),
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      '0:0',
      '--entrypoint',
      'chown',
      'seerr',
      '-R',
      '1000:1000',
      '/app/config',
    ]);
  });

  it("reports a failed chown with Compose's last lines, secrets replaced", async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: 'Container x Creating\nchown: fake-secret-value: Operation not permitted\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane-test', exec });
    expect(
      await runtime.chown(
        'seerr',
        '/app/config',
        { uid: 1000, gid: 1000 },
        { MP_X: 'fake-secret-value' },
      ),
    ).toEqual({
      ok: false,
      error: 'Container x Creating\nchown: ***: Operation not permitted',
    });
  });

  it('runs a one-off in a throwaway container of the service, with its input on stdin', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    const { exec, calls } = recorder(() => ({
      code: 3,
      stdout: 'route fake-key-0123 ok\n',
      stderr: 'Container x Creating\nfake-key-0123 refused\n',
    }));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    const result = await runtime.run('qbittorrent', {
      user: { uid: 65534, gid: 65534 },
      entrypoint: 'sh',
      args: ['-c', 'read -r key', 'probe', '8000'],
      input: 'fake-key-0123\n',
      values: { key: 'fake-key-0123' },
    });
    expect(result).toEqual({
      code: 3,
      stdout: 'route *** ok\n',
      stderr: 'Container x Creating\n*** refused\n',
    });
    expect(calls[0]?.args).toEqual([
      ...projectArgs(dir),
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      '65534:65534',
      '--entrypoint',
      'sh',
      'qbittorrent',
      '-c',
      'read -r key',
      'probe',
      '8000',
    ]);
    // The secret goes in on stdin: never in the arguments or the environment.
    expect(calls[0]?.options?.input).toBe('fake-key-0123\n');
    expect(calls[0]?.args.join(' ')).not.toContain('fake-key-0123');
    expect(Object.values(calls[0]?.options?.env ?? {})).not.toContain('fake-key-0123');
    expect(calls[0]?.options?.timeoutMs).toBe(300_000);
  });

  it('runs a one-off only in a service named like a Compose service', async () => {
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const command = {
      user: { uid: 65534, gid: 65534 },
      entrypoint: 'true',
      args: [],
      values: {},
    };
    // A leading dash would be read as a Compose option, ahead of the service.
    for (const service of ['--project-name=x', '-p', '', 'Qbit', 'a b', 'a/b', '_x']) {
      await expect(runtime.run(service, command)).rejects.toThrow(
        `not a service name: ${JSON.stringify(service)}`,
      );
    }
    await expect(
      runtime.chown('--project-name=x', '/data', { uid: 1000, gid: 1000 }, {}),
    ).rejects.toThrow('not a service name: "--project-name=x"');
    expect(calls).toEqual([]);
    await runtime.run('qbittorrent', command);
    await runtime.run('svc_1.a-b', command);
    expect(calls).toHaveLength(2);
  });

  it("reads containers' network mode and start time", async () => {
    const other = 'e'.repeat(64);
    const { exec, calls } = recorder(() =>
      ok(
        `${SONARR_ID} container:${other} 2026-10-10T10:00:01.5Z mediaplane\n${other} mediaplane_default 2026-10-10T10:00:00Z mediaplane\n`,
      ),
    );
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(await runtime.inspect([SONARR_ID, other])).toEqual([
      {
        id: SONARR_ID,
        networkMode: `container:${other}`,
        startedAt: '2026-10-10T10:00:01.5Z',
      },
      { id: other, networkMode: 'mediaplane_default', startedAt: '2026-10-10T10:00:00Z' },
    ]);
    expect(calls[0]?.args).toEqual([
      'container',
      'inspect',
      '--format',
      '{{.Id}} {{.HostConfig.NetworkMode}} {{.State.StartedAt}} {{index .Config.Labels "com.docker.compose.project"}}',
      SONARR_ID,
      other,
    ]);
  });

  it('refuses a container of another Compose project, or of none', async () => {
    for (const owner of ['mediaplane-system', '']) {
      const { exec } = recorder(() =>
        ok(`${SONARR_ID} bridge 2026-10-10T10:00:00Z ${owner}\n`),
      );
      const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
      await expect(runtime.inspect([SONARR_ID])).rejects.toThrow(
        'container d5a2f5c9b82d is not in the Compose project "mediaplane"',
      );
    }
  });

  it('refuses a container with no project label, which docker prints as "<no value>"', async () => {
    const { exec } = recorder(() =>
      ok(`${SONARR_ID} bridge 0001-01-01T00:00:00Z <no value>\n`),
    );
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    await expect(runtime.inspect([SONARR_ID])).rejects.toThrow(
      'container d5a2f5c9b82d is not in the Compose project "mediaplane"',
    );
  });

  it('inspects container IDs only, and asks nothing for none', async () => {
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    await expect(runtime.inspect([SONARR_ID, '--help'])).rejects.toThrow(
      'not a container ID: "--help"',
    );
    expect(await runtime.inspect([])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('inspects full container IDs only', async () => {
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    for (const short of [
      SONARR_ID.slice(0, 12),
      SONARR_ID.slice(0, 63),
      `${SONARR_ID}0`,
    ]) {
      await expect(runtime.inspect([short])).rejects.toThrow(
        `not a container ID: "${short}"`,
      );
    }
    await expect(runtime.inspect([SONARR_ID.toUpperCase()])).rejects.toThrow(
      'not a container ID',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a line that does not have exactly four fields, without printing it', async () => {
    const lines = [
      `${SONARR_ID} bridge 2026-10-10T10:00:00Z`,
      `${SONARR_ID} bridge`,
      `${SONARR_ID} bridge 2026-10-10T10:00:00Z mediaplane extra-field`,
      `${SONARR_ID} bridge 2026-10-10T10:00:00Z label with spaces`,
      `${SONARR_ID}  bridge 2026-10-10T10:00:00Z mediaplane`,
    ];
    for (const line of lines) {
      const { exec } = recorder(() => ok(`${line}\n`));
      const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
      const failure = await runtime.inspect([SONARR_ID]).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RuntimeError);
      expect((failure as Error).message).toBe(
        'docker container inspect printed a line that is not "<id> <network mode> <started at> <project>"',
      );
    }
  });

  it('refuses a line whose ID is not a full container ID, as {{.Id}} prints it', async () => {
    for (const id of [SONARR_ID.slice(0, 12), SONARR_ID.toUpperCase(), 'not-an-id']) {
      const { exec } = recorder(() =>
        ok(`${id} bridge 2026-10-10T10:00:00Z mediaplane\n`),
      );
      const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
      await expect(runtime.inspect([SONARR_ID])).rejects.toThrow(
        'docker container inspect printed a line that is not "<id> <network mode> <started at> <project>"',
      );
    }
  });

  it('refuses an answer that does not cover each requested container exactly once', async () => {
    const other = 'e'.repeat(64);
    const line = (id: string) => `${id} bridge 2026-10-10T10:00:00Z mediaplane\n`;
    const answers: [string, string[]][] = [
      ['', [SONARR_ID]],
      [line(SONARR_ID), [SONARR_ID, other]],
      [line(SONARR_ID) + line(SONARR_ID), [SONARR_ID]],
      [line(SONARR_ID) + line(other), [SONARR_ID]],
      [line(SONARR_ID) + line('f'.repeat(64)), [SONARR_ID, other]],
    ];
    for (const [stdout, ids] of answers) {
      const { exec } = recorder(() => ok(stdout));
      const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
      await expect(runtime.inspect(ids)).rejects.toThrow(
        /^docker container inspect did not answer once for each of the \d+ containers asked about$/,
      );
    }
  });

  it('asks about a container once, however often it is named', async () => {
    const { exec, calls } = recorder(() =>
      ok(`${SONARR_ID} bridge 2026-10-10T10:00:00Z mediaplane\n`),
    );
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(await runtime.inspect([SONARR_ID, SONARR_ID])).toEqual([
      { id: SONARR_ID, networkMode: 'bridge', startedAt: '2026-10-10T10:00:00Z' },
    ]);
    expect(calls[0]?.args.slice(-1)).toEqual([SONARR_ID]);
    expect(calls[0]?.args.filter((arg) => arg === SONARR_ID)).toHaveLength(1);
  });

  it('explains an inspect docker could not do', async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: `Error: No such container: ${SONARR_ID}\n`,
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    await expect(runtime.inspect([SONARR_ID])).rejects.toThrow(
      `docker container inspect failed: Error: No such container: ${SONARR_ID}`,
    );
  });

  it("reports a failed command with Compose's last lines, secrets replaced", async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr:
        'progress 1\nprogress 2\nContainer x Error\nfake-secret-value rejected\napplication not healthy after 10m0s\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane-test', exec });
    expect(await runtime.up(600, { MP_X: 'fake-secret-value' })).toEqual({
      ok: false,
      error: 'Container x Error\n*** rejected\napplication not healthy after 10m0s',
    });
  });

  it('runs the host helper on the host network, locked down, without pulling', async () => {
    const { exec, calls } = recorder(() =>
      ok('{"schema":"mediaplane.host-report/v1"}\n'),
    );
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const result = await runtime.hostHelper(
      'mediaplane:local',
      '{"facts":true}',
      [
        { source: '/dev', target: '/mediaplane-host/0' },
        { source: '/srv/my,data', target: '/mediaplane-host/1' },
      ],
      { uid: 1001, gid: 1002 },
    );
    expect(result).toEqual({
      ok: true,
      stdout: '{"schema":"mediaplane.host-report/v1"}\n',
    });
    expect(calls[0]?.args).toEqual([
      'run',
      '--rm',
      '--init',
      '--pull',
      'never',
      '--network',
      'host',
      '--user',
      '1001:1002',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--label',
      'io.mediaplane.helper=host-report',
      '--mount',
      'type=bind,"source=/dev",target=/mediaplane-host/0,readonly',
      '--mount',
      'type=bind,"source=/srv/my,data",target=/mediaplane-host/1,readonly',
      '--entrypoint',
      'mediaplane',
      'mediaplane:local',
      'host-report',
      '{"facts":true}',
    ]);
    expect(calls[0]?.options?.timeoutMs).toBe(60_000);
  });

  it('names a mount source the host does not have', async () => {
    const { exec } = recorder(() => ({
      code: 125,
      stdout: '',
      stderr:
        'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/data\n\nRun \'docker run --help\' for more information\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(
      await runtime.hostHelper(
        'mediaplane:local',
        '{}',
        [{ source: '/srv/data', target: '/mediaplane-host/0' }],
        { uid: 1000, gid: 1000 },
      ),
    ).toEqual({
      ok: false,
      error:
        'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/data\nRun \'docker run --help\' for more information',
      missingSource: '/srv/data',
    });
  });

  it('reports any other helper failure with its last lines', async () => {
    const { exec } = recorder(() => ({
      code: 125,
      stdout: '',
      stderr: 'docker: Error response from daemon: No such image: mediaplane:gone\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(
      await runtime.hostHelper('mediaplane:gone', '{}', [], { uid: 1000, gid: 1000 }),
    ).toEqual({
      ok: false,
      error: 'docker: Error response from daemon: No such image: mediaplane:gone',
    });
  });

  it('names the sent source when older Docker ends the sentence with a full stop', async () => {
    const { exec } = recorder(() => ({
      code: 125,
      stdout: '',
      stderr:
        'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/data.\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const result = await runtime.hostHelper(
      'mediaplane:local',
      '{}',
      [
        { source: '/dev', target: '/mediaplane-host/0' },
        { source: '/srv/data', target: '/mediaplane-host/1' },
      ],
      { uid: 1000, gid: 1000 },
    );
    expect(result).toMatchObject({ ok: false, missingSource: '/srv/data' });
  });

  it('names no source unless the one Docker reports is one that was sent', async () => {
    const { exec } = recorder(() => ({
      code: 125,
      stdout: '',
      stderr:
        'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/other\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const result = await runtime.hostHelper(
      'mediaplane:local',
      '{}',
      [{ source: '/srv/data', target: '/mediaplane-host/0' }],
      { uid: 1000, gid: 1000 },
    );
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('missingSource');
  });

  it('explains a helper that does not finish as a helper failure, with its own hint', async () => {
    const seen: (ExecOptions | undefined)[] = [];
    const exec: Exec = (_command, _args, options) => {
      seen.push(options);
      return Promise.reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    };
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const error = await runtime
      .hostHelper('mediaplane:local', '{}', [], { uid: 1000, gid: 1000 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HelperError);
    expect(error).toMatchObject({
      message: 'the host helper did not finish within 60 s',
      hint: 'check that the data folder and the Mediaplane home are reachable: a network share (NFS or SMB) that is not responding is the usual cause',
    });
    expect(seen[0]?.timeoutMs).toBe(60_000);
  });

  it('explains a helper that cannot start docker as a Docker problem', async () => {
    const exec: Exec = () =>
      Promise.reject(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const error = await runtime
      .hostHelper('mediaplane:local', '{}', [], { uid: 1000, gid: 1000 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuntimeError);
    expect(error).not.toBeInstanceOf(HelperError);
    expect((error as RuntimeError).message).toBe('docker was not found on PATH');
  });

  it('refuses a mount target that could change the mount options, without running docker', async () => {
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    await expect(
      runtime.hostHelper(
        'mediaplane:local',
        '{}',
        [{ source: '/srv/data', target: '/mediaplane-host/0,readonly=false' }],
        { uid: 1000, gid: 1000 },
      ),
    ).rejects.toThrow('/mediaplane-host/0,readonly=false');
    expect(calls).toEqual([]);
  });
});

describe('the wiring network', () => {
  const home = '/opt/mediaplane';
  const SELF = 'c'.repeat(64);
  const IN_IMAGE = { MEDIAPLANE_IMAGE: 'mediaplane:local' };
  const network = (internal: string, project: string, ...members: string[]) =>
    ok(`${[`${internal} ${project} wiring`, ...members].join(' ')}\n`);
  const runtimeWith = (
    respond: (args: readonly string[]) => ExecResult,
    env: NodeJS.ProcessEnv = IN_IMAGE,
  ) => {
    const { exec, calls } = recorder(respond);
    const runtime = createDockerRuntime({
      home,
      project: 'mediaplane',
      exec,
      env,
      ownId: () => Promise.resolve(SELF),
    });
    return { runtime, calls };
  };

  it("reads each container's address on <project>_wiring, and leaves out one not on it", async () => {
    const other = 'e'.repeat(64);
    const { runtime, calls } = runtimeWith(() =>
      ok(`${SONARR_ID} 172.20.0.3 mediaplane\n${other} - mediaplane\n`),
    );
    expect(await runtime.wiringAddresses([SONARR_ID, other])).toEqual({
      [SONARR_ID]: '172.20.0.3',
    });
    expect(calls[0]?.args).toEqual([
      'container',
      'inspect',
      '--format',
      '{{.Id}} {{with index .NetworkSettings.Networks "mediaplane_wiring"}}{{if .IPAddress}}{{.IPAddress}}{{else}}-{{end}}{{else}}-{{end}} {{index .Config.Labels "com.docker.compose.project"}}',
      SONARR_ID,
      other,
    ]);
  });

  it('refuses addresses of another project, an odd line, a name, or a missing answer', async () => {
    const answers: [string, string][] = [
      [`${SONARR_ID} 172.20.0.3 mediaplane-system\n`, 'is not in the Compose project'],
      [`${SONARR_ID} 172.20.0.3 <no value>\n`, 'is not in the Compose project'],
      [`${SONARR_ID} fe80::1 mediaplane\n`, 'a line that is not "<id> <wiring address>'],
      ['', 'did not answer once for each of the 1 containers'],
    ];
    for (const [stdout, message] of answers) {
      const { runtime } = runtimeWith(() => ok(stdout));
      await expect(runtime.wiringAddresses([SONARR_ID])).rejects.toThrow(message);
    }
    const { runtime, calls } = runtimeWith(() => ok(''));
    await expect(runtime.wiringAddresses(['sonarr'])).rejects.toThrow(
      'not a container ID: "sonarr"',
    );
    expect(await runtime.wiringAddresses([])).toEqual({});
    expect(calls).toEqual([]);
  });

  it('needs no join run from source, and asks Docker nothing', async () => {
    const { runtime, calls } = runtimeWith(() => ok(''), {});
    expect(await runtime.joinWiring()).toBe('not-needed');
    await runtime.leaveWiring();
    expect(calls).toEqual([]);
  });

  it('joins its own container to the internal wiring network of its project', async () => {
    const { runtime, calls } = runtimeWith((args) =>
      args[1] === 'inspect' ? network('true', 'mediaplane', SONARR_ID) : ok(''),
    );
    expect(await runtime.joinWiring()).toBe('joined');
    expect(calls.map((call) => call.args)).toEqual([
      [
        'network',
        'inspect',
        '--format',
        '{{.Internal}} {{index .Labels "com.docker.compose.project"}} {{index .Labels "com.docker.compose.network"}}{{range $id, $c := .Containers}} {{$id}}{{end}}',
        'mediaplane_wiring',
      ],
      ['network', 'connect', 'mediaplane_wiring', SELF],
    ]);
  });

  it('stays joined: a second join asks Docker to change nothing', async () => {
    const { runtime, calls } = runtimeWith(() => network('true', 'mediaplane', SELF));
    expect(await runtime.joinWiring()).toBe('already');
    expect(calls.map((call) => call.args[1])).toEqual(['inspect']);
  });

  it('finds no network on a stack that was never applied with one', async () => {
    const { runtime, calls } = runtimeWith(() => ({
      code: 1,
      stdout: '',
      stderr: 'Error response from daemon: network mediaplane_wiring not found\n',
    }));
    expect(await runtime.joinWiring()).toBe('no-network');
    await runtime.leaveWiring();
    expect(calls.map((call) => call.args[1])).toEqual(['inspect', 'inspect']);
  });

  it("never joins a network with a route out, or another project's", async () => {
    for (const [answer, message] of [
      [network('false', 'mediaplane'), 'it is not internal'],
      [network('true', 'mediaplane-other'), 'it is not the wiring network of'],
      [network('true', '<no value>'), 'it is not the wiring network of'],
    ] as const) {
      const { runtime, calls } = runtimeWith(() => answer);
      await expect(runtime.joinWiring()).rejects.toThrow(
        `refusing to join mediaplane_wiring: ${message}`,
      );
      expect(calls.map((call) => call.args[1])).toEqual(['inspect']);
    }
  });

  it("says so when it can't tell which container it runs in", async () => {
    const { exec } = recorder(() => network('true', 'mediaplane'));
    const runtime = createDockerRuntime({
      home,
      project: 'mediaplane',
      exec,
      env: IN_IMAGE,
      ownId: () => Promise.resolve(undefined),
    });
    await expect(runtime.joinWiring()).rejects.toThrow(
      "Mediaplane can't tell which container it runs in",
    );
  });

  it('explains a join or a leave Docker refused', async () => {
    const refused = (args: readonly string[]) =>
      args[1] === 'inspect'
        ? network('true', 'mediaplane')
        : { code: 1, stdout: '', stderr: 'Error response from daemon: denied\n' };
    const { runtime } = runtimeWith(refused);
    await expect(runtime.joinWiring()).rejects.toThrow(
      'could not join the wiring network mediaplane_wiring: Error response from daemon: denied',
    );
    const member = runtimeWith((args) =>
      args[1] === 'inspect'
        ? network('true', 'mediaplane', SELF)
        : { code: 1, stdout: '', stderr: 'Error response from daemon: denied\n' },
    );
    await expect(member.runtime.leaveWiring()).rejects.toThrow(
      'could not leave the wiring network mediaplane_wiring',
    );
  });

  it('leaves the network only when it is on it', async () => {
    const on = runtimeWith((args) =>
      args[1] === 'inspect' ? network('true', 'mediaplane', SONARR_ID, SELF) : ok(''),
    );
    await on.runtime.leaveWiring();
    expect(on.calls.at(-1)?.args).toEqual([
      'network',
      'disconnect',
      'mediaplane_wiring',
      SELF,
    ]);
    const off = runtimeWith(() => network('true', 'mediaplane', SONARR_ID));
    await off.runtime.leaveWiring();
    expect(off.calls.map((call) => call.args[1])).toEqual(['inspect']);
  });
});

describe('ownContainerId', () => {
  it("finds the ID in where the container's hostname file comes from", async () => {
    const id = 'c'.repeat(64);
    const mountinfo = [
      '1 0 0:1 / / ro,relatime - overlay overlay rw',
      `2 1 8:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/sda1 rw`,
    ].join('\n');
    expect(await ownContainerId(() => Promise.resolve(mountinfo))).toBe(id);
  });

  it('finds none outside a container, or when it cannot read the file', async () => {
    expect(
      await ownContainerId(() => Promise.resolve('1 0 0:1 / / rw - ext4 x rw')),
    ).toBe(undefined);
    expect(await ownContainerId(() => Promise.reject(new Error('ENOENT')))).toBe(
      undefined,
    );
  });
});

describe('stop', () => {
  it('stops the services on the written project, and reports a failure', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    const { exec, calls } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: 'fake-secret-value: no such service\n',
    }));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane', exec });
    expect(await runtime.stop(['qbittorrent'], { MP_X: 'fake-secret-value' })).toEqual({
      ok: false,
      error: '***: no such service',
    });
    expect(calls[0]?.args.slice(-2)).toEqual(['stop', 'qbittorrent']);
    expect(calls[0]?.args.slice(0, 3)).toEqual(['compose', '-p', 'mediaplane']);
  });

  it('stops nothing for no service, and refuses what is not a service name', async () => {
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({
      home: '/opt/mediaplane',
      project: 'mediaplane',
      exec,
    });
    expect(await runtime.stop([], {})).toEqual({ ok: true });
    await expect(runtime.stop(['--all'], {})).rejects.toThrow(
      'not a service name: "--all"',
    );
    expect(calls).toEqual([]);
  });
});

describe('isManagedProject', () => {
  it.each(['mediaplane', 'mediaplane-test', 'mediaplane-e2e-1234-hash'])(
    'manages %s',
    (project) => {
      expect(isManagedProject(project)).toBe(true);
    },
  );

  it.each([
    'mediaplane-system',
    'other',
    'mediaplane_x',
    'Mediaplane',
    'mediaplane-',
    '',
  ])('refuses %j', (project) => {
    expect(isManagedProject(project)).toBe(false);
  });

  it('is enforced when the runtime is created', () => {
    expect(() =>
      createDockerRuntime({ home: '/opt/mediaplane', project: 'mediaplane-system' }),
    ).toThrow('refusing to manage the Compose project "mediaplane-system"');
  });
});

describe('dockerAccessWarnings', () => {
  it('is quiet from source, and in the image when Docker is reached through the proxy', () => {
    expect(dockerAccessWarnings({})).toEqual([]);
    expect(dockerAccessWarnings({ DOCKER_HOST: '' })).toEqual([]);
    expect(
      dockerAccessWarnings({
        MEDIAPLANE_IMAGE: 'mediaplane:local',
        DOCKER_HOST: 'tcp://socket-proxy:2375',
      }),
    ).toEqual([]);
  });

  it.each([undefined, '', 'unix:///var/run/docker.sock', 'unix:///run/docker.sock'])(
    'warns in the image when DOCKER_HOST is %j',
    (dockerHost) => {
      expect(
        dockerAccessWarnings({
          MEDIAPLANE_IMAGE: 'mediaplane:local',
          DOCKER_HOST: dockerHost,
        }),
      ).toEqual([
        expect.objectContaining({ code: 'docker.no-proxy', severity: 'warning' }),
      ]);
    },
  );
});

describe('usesSocketProxy', () => {
  it('is true only in the image, with Docker reached through the proxy', () => {
    expect(
      usesSocketProxy({
        MEDIAPLANE_IMAGE: 'mediaplane:local',
        DOCKER_HOST: 'tcp://socket-proxy:2375',
      }),
    ).toBe(true);
    expect(usesSocketProxy({ DOCKER_HOST: 'tcp://socket-proxy:2375' })).toBe(false);
    expect(usesSocketProxy({ MEDIAPLANE_IMAGE: '', DOCKER_HOST: 'tcp://x:2375' })).toBe(
      false,
    );
    expect(
      usesSocketProxy({
        MEDIAPLANE_IMAGE: 'mediaplane:local',
        DOCKER_HOST: 'unix:///var/run/docker.sock',
      }),
    ).toBe(false);
  });
});

describe('parseHashes', () => {
  it('reads "service hash" lines and ignores blanks', () => {
    expect(parseHashes(`sonarr ${HASH}\n\n`)).toEqual({ sonarr: HASH });
  });
});

describe('parseContainers', () => {
  it('reads state, health, config hash and published ports', () => {
    expect(parseContainers(`${PS_SONARR}\n`)).toEqual([
      {
        service: 'sonarr',
        id: SONARR_ID,
        state: 'running',
        health: 'healthy',
        configHash: HASH,
        published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
      },
    ]);
  });

  it('reads UDP ports, and fields Compose leaves out as empty', () => {
    const line = JSON.stringify({
      Service: 'gluetun',
      ID: 'f0e1d2c3b4a5'.padEnd(64, '0'),
      State: 'running',
      Health: null,
      Publishers: [{ URL: '0.0.0.0', PublishedPort: 51820, Protocol: 'udp' }],
    });
    const bare = JSON.stringify({ Service: 'byparr', State: 'created' });
    expect(parseContainers(`${line}\n${bare}\n`)).toEqual([
      {
        service: 'gluetun',
        id: 'f0e1d2c3b4a5'.padEnd(64, '0'),
        state: 'running',
        health: '',
        configHash: undefined,
        published: [{ address: '0.0.0.0', port: 51820, protocol: 'udp' }],
      },
      {
        service: 'byparr',
        id: '',
        state: 'created',
        health: '',
        configHash: undefined,
        published: [],
      },
    ]);
  });

  it('has no config hash when the label is absent', () => {
    expect(parseContainers(PS_BYPARR)[0]?.configHash).toBeUndefined();
  });

  it('reads the folder Compose ran from, next to label values that contain commas', () => {
    const line = JSON.stringify({
      Service: 'sonarr',
      ID: SONARR_ID,
      State: 'running',
      Health: 'healthy',
      Labels:
        'com.docker.compose.project.config_files=/srv/a/generated/compose.yaml,/srv/a/compose.override.yaml,com.docker.compose.project.working_dir=/srv/a,com.docker.compose.service=sonarr',
      Publishers: [],
    });
    expect(parseContainers(line)[0]?.workingDir).toBe('/srv/a');
  });

  // Compose 5.5.1 prints labels in random order, and label keys can hold / : and @.
  it.each(['app.kubernetes.io/name=probe', 'org.example:owner@team=probe'])(
    'ends the folder at the next label, even when it is %s',
    (next) => {
      const line = JSON.stringify({
        Service: 'sonarr',
        Labels: `com.docker.compose.project.working_dir=/opt/mediaplane,${next},com.docker.compose.service=sonarr`,
      });
      expect(parseContainers(line)[0]?.workingDir).toBe('/opt/mediaplane');
    },
  );

  it('reads the folder when it is the last label', () => {
    const line = JSON.stringify({
      Service: 'sonarr',
      Labels: 'com.docker.compose.project.working_dir=/opt/mediaplane',
    });
    expect(parseContainers(line)[0]?.workingDir).toBe('/opt/mediaplane');
  });

  it('has no working folder when the label is absent', () => {
    expect(parseContainers(PS_SONARR)[0]).not.toHaveProperty('workingDir');
  });

  it('is empty for no output', () => {
    expect(parseContainers('')).toEqual([]);
  });

  it('reports output that is not JSON as a RuntimeError', () => {
    expect(() => parseContainers('Error: something unexpected\n')).toThrow(RuntimeError);
  });

  it('skips the one-off containers that `compose run` leaves behind', () => {
    const oneoff = (id: string, state: string) =>
      JSON.stringify({
        Service: 'sonarr',
        ID: id.padEnd(64, '0'),
        State: state,
        Health: '',
        Labels: `com.docker.compose.config-hash=${'c'.repeat(64)},com.docker.compose.oneoff=True,com.docker.compose.service=sonarr`,
        Publishers: [],
      });
    const ps = [oneoff('e1f2', 'exited'), PS_SONARR, oneoff('a3b4', 'running')].join(
      '\n',
    );
    expect(parseContainers(ps).map((c) => c.id)).toEqual([SONARR_ID]);
  });

  it('skips JSON lines that are not objects', () => {
    expect(
      parseContainers(`[]\nnull\n"text"\n${PS_SONARR}\n`).map((c) => c.service),
    ).toEqual(['sonarr']);
  });
});

describe('bindMount', () => {
  it('quotes the source, doubling any quote, because Docker reads --mount as CSV', () => {
    expect(bindMount({ source: '/srv/a "b"', target: '/mediaplane-host/0' })).toBe(
      'type=bind,"source=/srv/a ""b""",target=/mediaplane-host/0,readonly',
    );
  });

  it.each([
    ['a comma', '/mediaplane-host/0,readonly=false'],
    ['a newline', '/mediaplane-host/0\nreadonly=false'],
    ['a trailing newline', '/mediaplane-host/0\n'],
    ['no number', '/mediaplane-host/'],
    ['another folder', '/etc'],
  ])('refuses a target with %s, which could drop readonly', (_name, target) => {
    expect(() => bindMount({ source: '/srv/data', target })).toThrow(
      `bindMount: the target ${JSON.stringify(target)} is not /mediaplane-host/<number>`,
    );
  });
});
