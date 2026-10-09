import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDockerRuntime, parseContainers, parseHashes } from './docker';
import type { Exec, ExecOptions, ExecResult } from './exec';
import { RuntimeError } from './types';

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
const HASH = 'a'.repeat(64);

const PS_SONARR = JSON.stringify({
  Service: 'sonarr',
  ID: 'd5a2f5c9b82d',
  State: 'running',
  Health: 'healthy',
  Labels: `com.docker.compose.project.config_files=/opt/mediaplane/generated/compose.yaml,/opt/mediaplane/compose.override.yaml,com.docker.compose.config-hash=${HASH},com.docker.compose.service=sonarr`,
  Publishers: [
    { URL: '127.0.0.1', TargetPort: 8989, PublishedPort: 8989, Protocol: 'tcp' },
    { URL: '', TargetPort: 6881, PublishedPort: 0, Protocol: 'tcp' },
  ],
});
const PS_BYPARR = JSON.stringify({
  Service: 'byparr',
  ID: '0b1c2d3e4f5a',
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

  it('explains a missing docker command', async () => {
    const exec: Exec = () =>
      Promise.reject(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }));
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow('docker was not found on PATH');
  });

  it('hashes an unwritten compose file from stdin, with secret values in the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
    await writeFile(join(dir, 'compose.override.yaml'), 'services: {}\n');
    const { exec, calls } = recorder(() => ok(''));
    await createDockerRuntime({ home: dir, project: 'p', exec }).configHashes('x', {});
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'p',
      '--project-directory',
      dir,
      '-f',
      '-',
      '-f',
      join(dir, 'compose.override.yaml'),
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
      await createDockerRuntime({ home, project: 'p', exec }).configHashes('x', {}),
    ).toEqual({ ok: false, error: 'yaml: line 3: bad' });
  });

  it("lists the project's containers by name only", async () => {
    const { exec, calls } = recorder(() => ok(`${PS_SONARR}\n${PS_BYPARR}\n`));
    const containers = await createDockerRuntime({
      home,
      project: 'p',
      exec,
    }).containers();
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'p',
      'ps',
      '--all',
      '--format',
      'json',
    ]);
    expect(containers.map((c) => c.service)).toEqual(['sonarr', 'byparr']);
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
        id: 'd5a2f5c9b82d',
        state: 'running',
        health: 'healthy',
        configHash: HASH,
        published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
      },
    ]);
  });

  it('has no config hash when the label is absent', () => {
    expect(parseContainers(PS_BYPARR)[0]?.configHash).toBeUndefined();
  });

  it('is empty for no output', () => {
    expect(parseContainers('')).toEqual([]);
  });
});
