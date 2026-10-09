import { arch } from 'node:os';
import { nodeExec, toArch, type ExecResult } from '@mediaplane/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../../packages/cli/src/version';
import { buildImage } from './helpers';

const TAG = `mediaplane-e2e:${String(process.pid)}`;

/** Run a command in a throwaway container of the image, locked down like the deployment. */
function inImage(...args: string[]): Promise<ExecResult> {
  return nodeExec(
    'docker',
    [
      'run',
      '--rm',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      TAG,
      ...args,
    ],
    { cwd: '/' },
  );
}

describe('the Mediaplane image', () => {
  beforeAll(() => buildImage(TAG), 900_000);
  afterAll(async () => {
    await nodeExec('docker', ['image', 'rm', TAG], { cwd: '/' });
  });

  it('runs the CLI as a non-root user, with the Docker CLI and Compose 5 inside', async () => {
    expect((await inImage('mediaplane', '--version')).stdout.trim()).toBe(VERSION);
    expect((await inImage('id', '-u')).stdout.trim()).toBe('1000');
    const compose = await inImage('docker', 'compose', 'version', '--short');
    expect(compose.stdout.trim()).toBe('5.5.1');
  });

  it('ships no package manager', async () => {
    const found = await inImage(
      'sh',
      '-c',
      'for c in npm npx yarn yarnpkg corepack pnpm; do command -v "$c" || true; done',
    );
    expect(found.code).toBe(0);
    expect(found.stdout.trim()).toBe('');
  });

  it('carries its licence and those of what it bundles', async () => {
    const licences = await inImage(
      'cat',
      '/usr/share/doc/mediaplane/THIRD-PARTY-LICENSES.txt',
    );
    expect(licences.stdout).toContain('== zod ==');
    expect((await inImage('test', '-s', '/usr/share/doc/mediaplane/LICENSE')).code).toBe(
      0,
    );
  });

  it('idles until it is stopped, with no entrypoint of its own', async () => {
    const inspect = await nodeExec(
      'docker',
      ['image', 'inspect', TAG, '--format', '{{json .Config}}'],
      { cwd: '/' },
    );
    const config = JSON.parse(inspect.stdout) as {
      Entrypoint: string[] | null;
      Cmd: string[] | null;
    };
    // `ENTRYPOINT []` is stored as null or [] depending on the builder.
    expect(config.Entrypoint ?? []).toEqual([]);
    expect(config.Cmd).toEqual(['sleep', 'infinity']);
  });

  it("reports the host's facts as the host helper", async () => {
    const result = await nodeExec(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'host',
        TAG,
        'mediaplane',
        'host-report',
        JSON.stringify({ facts: true, stat: [], free: [], ports: [] }),
      ],
      { cwd: '/' },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: 'mediaplane.host-report/v1',
      facts: { arch: toArch(arch()) },
    });
  });
});
