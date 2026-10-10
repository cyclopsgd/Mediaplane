import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  COMPOSE_PATH,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  renderEnvFile,
  type ApplyOptions,
} from '@mediaplane/engine';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, ejectArguments, makeHome } from './helpers';

const PROJECT = `mediaplane-e2e-${process.pid}-apply`;

describe('apply against real Docker', () => {
  it('starts the video stack healthy, then has nothing left to do', async () => {
    const home = await makeHome();
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

      // Ejectable: the command printed in compose.yaml's header recreates nothing. An
      // empty compose.override.yaml makes the command's second -f real, and changes
      // nothing in any container's configuration.
      await writeFile(join(home, 'compose.override.yaml'), 'services: {}\n');
      const ids = containers.map((c) => c.id).sort();
      const header = await readFile(join(home, COMPOSE_PATH), 'utf8');
      const eject = await nodeExec('docker', ejectArguments(header, PROJECT), {
        cwd: '/',
      });
      expect(eject.code, eject.stderr).toBe(0);
      expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(ids);
    } finally {
      const down = await composeDown(PROJECT);
      expect(down.code, down.stderr).toBe(0);
    }
  }, 1_200_000);

  it('writes .env values that Compose reads back exactly', async () => {
    const dir = await tempDir('mediaplane-e2e-');
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
