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
  readSecretStore,
  renderEnvFile,
  type ApplyOptions,
  type ExecResult,
} from '@mediaplane/engine';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, ejectArguments, makeHome, REPO } from './helpers';

const PROJECT = `mediaplane-e2e-${process.pid}-apply`;

const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

/** `mediaplane <args>`, run from source as a user would, for the test's project. */
function mediaplane(...args: string[]): Promise<ExecResult> {
  return nodeExec(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    cwd: REPO,
    env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT },
    timeoutMs: 120_000,
  });
}

/** The pre-start files every apply of the video stack plans. */
const PRESTART = [
  'appdata/prowlarr/config.xml',
  'appdata/qbittorrent/qBittorrent/qBittorrent.conf',
  'appdata/radarr/config.xml',
  'appdata/sonarr/config.xml',
];

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
      // The apps rewrite their files readable by all, so appdata/ itself is private.
      // Every app above started healthy all the same: Docker mounts their folders as root.
      expect((await stat(join(home, 'appdata'))).mode & 0o777).toBe(0o700);

      // Slice 3a: the files Mediaplane wrote before the apps first started. Each
      // assertion that sees a key, the password or a log only says whether it passed,
      // so a failure prints none of them into the public CI log.
      expect(
        first.plan.files
          .filter((f) => f.prestart === true)
          .map((f) => [f.path, f.status]),
      ).toEqual(PRESTART.map((path) => [path, 'create']));
      const store = await readSecretStore(home);
      for (const app of ['prowlarr', 'radarr', 'sonarr']) {
        const xml = await readFile(join(home, 'appdata', app, 'config.xml'), 'utf8');
        const key = store.apps[app]?.apiKey;
        expect(key !== undefined, `no ${app} key stored`).toBe(true);
        expect(
          xml.includes(`<ApiKey>${key ?? ''}</ApiKey>`),
          `${app} config.xml lacks the stored key`,
        ).toBe(true);
      }

      // qBittorrent takes the shared login that credentials shows, and its own key.
      const shown = await mediaplane('credentials', '--home', home, '--json', '--reveal');
      expect(shown.code, shown.stderr).toBe(0);
      const login = JSON.parse(shown.stdout) as {
        username: string;
        password: string;
        apps: { app: string; urls: string[]; login: string }[];
      };
      expect(login.apps.find((a) => a.app === 'qbittorrent')).toMatchObject({
        login: 'shared',
        urls: ['http://127.0.0.1:8080'],
      });
      const signIn = await fetch('http://127.0.0.1:8080/api/v2/auth/login', {
        method: 'POST',
        body: new URLSearchParams({ username: login.username, password: login.password }),
        signal: AbortSignal.timeout(10_000),
      });
      expect(signIn.status).toBe(204);
      const version = await fetch('http://127.0.0.1:8080/api/v2/app/version', {
        headers: { authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` },
        signal: AbortSignal.timeout(10_000),
      });
      expect(version.status).toBe(200);
      // Without the key, the same request is refused: the 200 above is the key's doing.
      const anonymous = await fetch('http://127.0.0.1:8080/api/v2/app/version', {
        signal: AbortSignal.timeout(10_000),
      });
      expect(anonymous.status).toBe(403);
      const qbittorrent = containers.find((c) => c.service === 'qbittorrent');
      const log = await nodeExec('docker', ['logs', qbittorrent?.id ?? 'missing'], {
        cwd: '/',
      });
      expect(log.code, 'docker logs failed for qbittorrent').toBe(0);
      const text = log.stdout + log.stderr;
      // The log has qBittorrent's start-up lines, so the check below reads something.
      expect(
        text.includes('To control qBittorrent'),
        "qBittorrent's log lacks its start-up lines",
      ).toBe(true);
      expect(
        /temporary password/i.test(text),
        'qBittorrent logged a temporary password',
      ).toBe(false);

      const second = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(second.outcome).toBe('no-changes');
      // Nothing ran, so nothing was written: the files are the apps' own from now on.
      expect(second.actions).toEqual([]);
      expect(
        second.plan.files
          .filter((f) => f.prestart === true)
          .map((f) => [f.path, f.status]),
      ).toEqual(PRESTART.map((path) => [path, 'unchanged']));

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
