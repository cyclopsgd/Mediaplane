import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  COMPOSE_PATH,
  createDockerRuntime,
  detectHostFacts,
  ENV_PATH,
  nodeExec,
  nodeProbe,
  renderEnvFile,
  type ApplyOptions,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, removeHome } from './helpers';

const PROJECT = `mediaplane-e2e-${process.pid}-apply`;

/** The M1 video stack without the VPN; the apps run as the user who owns the data folder. */
function stackFor(data: string): string {
  return `version: 1
user: { uid: ${process.getuid?.() ?? 1000}, gid: ${process.getgid?.() ?? 1000} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;
}

describe('apply against real Docker', () => {
  it('starts the video stack healthy, then has nothing left to do', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    await mkdir(join(home, 'data'));
    await writeFile(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
    const runtime = createDockerRuntime({ home, project: PROJECT });
    const options: ApplyOptions = {
      home,
      catalog,
      host: detectHostFacts(),
      env: process.env,
      runtime,
      probe: nodeProbe,
      confirm: () => Promise.resolve(true),
    };
    try {
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      const containers = await runtime.containers();
      expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual(
        [
          'byparr running healthy',
          'jellyfin running healthy',
          'prowlarr running healthy',
          'qbittorrent running healthy',
          'radarr running healthy',
          'seerr running healthy',
          'sonarr running healthy',
        ],
      );
      expect((await stat(join(home, 'appdata', 'seerr'))).uid).toBe(1000);

      const second = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(second.outcome).toBe('no-changes');

      // Ejectable: the command in compose.yaml's header recreates nothing.
      const ids = containers.map((c) => c.id).sort();
      const eject = await nodeExec(
        'docker',
        [
          'compose',
          '-p',
          PROJECT,
          '--project-directory',
          home,
          '-f',
          join(home, COMPOSE_PATH),
          '--env-file',
          join(home, ENV_PATH),
          'up',
          '-d',
        ],
        { cwd: '/' },
      );
      expect(eject.code, eject.stderr).toBe(0);
      expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(ids);
    } finally {
      const down = await composeDown(PROJECT);
      await removeHome(home);
      expect(down.code, down.stderr).toBe(0);
    }
  }, 1_200_000);

  it('writes .env values that Compose reads back exactly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    const values = {
      MP_A: 'it\'s "q" $X \\b',
      MP_B: 'line1\nline2\ttab',
      MP_C: '$HOME ${X} # not a comment',
      MP_D: '',
      // A trailing backslash, followed by another variable: single-quoted, Compose
      // would read the \' as an escaped quote and swallow the next line.
      MP_E: 'abc\\',
      MP_F: 'after',
    };
    await writeFile(join(dir, '.env'), renderEnvFile(values));
    await writeFile(
      join(dir, 'compose.yaml'),
      [
        'services:',
        '  probe:',
        `    image: ${BUSYBOX}`,
        '    environment:',
        ...Object.keys(values).map((name) => `      ${name}: "\${${name}}"`),
        '',
      ].join('\n'),
    );
    const result = await nodeExec(
      'docker',
      [
        'compose',
        '-p',
        `mediaplane-e2e-${process.pid}-env`,
        '--project-directory',
        dir,
        '-f',
        join(dir, 'compose.yaml'),
        '--env-file',
        join(dir, '.env'),
        'config',
        '--format',
        'json',
      ],
      { cwd: '/' },
    );
    expect(result.code, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout) as {
      services: { probe: { environment: Record<string, string> } };
    };
    // `config` prints a literal $ as $$.
    const environment = Object.fromEntries(
      Object.entries(config.services.probe.environment).map(([name, value]) => [
        name,
        value.replaceAll('$$', '$'),
      ]),
    );
    expect(environment).toEqual(values);
  });
});
