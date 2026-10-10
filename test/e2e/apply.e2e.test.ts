import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
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
import {
  BUSYBOX,
  composeDown,
  ejectArguments,
  makeHome,
  parseRevealed,
  REPO,
  wiringMembers,
} from './helpers';

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

/** What the video stack wires, in the order apply wires it (Prowlarr after the arrs). */
const WIRED = ['radarr.admin', 'sonarr.admin', 'prowlarr.admin', 'qbittorrent'];

/** Two documentation subnets (RFC 5737), to check Sonarr takes a comma-separated list. */
const TRUSTED = ['192.0.2.0/24', '198.51.100.0/24'];

/** The Servarr apps, and where their web UI is published. */
const SERVARR = [
  ['Sonarr', 8989],
  ['Radarr', 7878],
  ['Prowlarr', 9696],
] as const;

interface Resources {
  resources: Record<string, unknown>;
}

/**
 * The stack's wiring network is internal, and holds exactly the apps Mediaplane calls.
 * Run from source, Mediaplane itself is not on it: the host reaches it.
 */
async function expectWiringNetwork(containers: readonly { service: string }[]) {
  const wired = ['prowlarr', 'qbittorrent', 'radarr', 'sonarr'];
  expect(await wiringMembers(PROJECT)).toEqual({
    internal: true,
    members: wired.map((service) => `${PROJECT}-${service}-1`),
  });
  expect(containers.map((c) => c.service)).toEqual(expect.arrayContaining(wired));
}

/** The shared login opens Sonarr, Radarr and Prowlarr, and a wrong password doesn't. */
async function expectSharedLogin(login: { username: string; password: string }) {
  for (const [name, port] of SERVARR) {
    const signIn = (password: string) =>
      fetch(`http://127.0.0.1:${String(port)}/login`, {
        method: 'POST',
        body: new URLSearchParams({ username: login.username, password }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    const right = await signIn(login.password);
    expect([right.status, right.headers.get('location')], `${name} login`).toEqual([
      302,
      '/',
    ]);
    const wrong = await signIn('not-the-password');
    expect(wrong.headers.get('location') ?? '', `${name} wrong login`).toContain(
      'loginFailed',
    );
  }
}

/**
 * The status an app answers with the Host header `host`, which fetch can't set. An app
 * that sends nothing for 10 seconds fails the request: Node's `timeout` only reports it.
 */
function statusWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/ping',
        headers: { Host: host },
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`127.0.0.1:${String(port)} sent nothing for 10 seconds`));
    });
    req.on('error', reject);
    req.end();
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
    const stack = (await readFile(join(home, 'stack.yaml'), 'utf8')).replace(
      '  sonarr: {}',
      `  sonarr: { env: { SONARR__SERVER__TRUSTEDNETWORKS: "${TRUSTED.join(',')}" } }`,
    );
    await writeFile(join(home, 'stack.yaml'), stack);
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
      const login = parseRevealed(shown.stdout);
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

      // Slice 3b: the wiring network, and the shared login through each app's API.
      await expectWiringNetwork(containers);
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      expect(
        first.actions
          .filter((a) => a.resource !== undefined)
          .map((a) => [a.resource, a.detail]),
      ).toEqual([
        ['radarr.admin', 'created'],
        ['sonarr.admin', 'created'],
        ['prowlarr.admin', 'created'],
      ]);
      expect(second.plan.wiring.map((w) => w.action)).toEqual(
        WIRED.map(() => 'unchanged'),
      );
      await expectSharedLogin(login);
      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      expect(Object.keys((JSON.parse(resources) as Resources).resources)).toEqual([
        'prowlarr.admin',
        'radarr.admin',
        'sonarr.admin',
      ]);
      expect(
        resources.includes(login.password),
        'resources.json holds the password',
      ).toBe(false);
      // Lost state: apply adopts what the apps hold, by name, and changes none of it.
      await rm(join(home, 'state', 'resources.json'));
      const adopted = await apply(options);
      expect(adopted.outcome).toBe('success');
      expect(adopted.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'radarr.admin', action: 'adopt' },
        { resource: 'sonarr.admin', action: 'adopt' },
        { resource: 'prowlarr.admin', action: 'adopt' },
      ]);
      expect(adopted.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
      expect((await apply(options)).outcome).toBe('no-changes');
      await expectSharedLogin(login);
      // Things S1 encodes: Sonarr reads the list as given. Its settings hold
      // apps.sonarr.env's TRUSTEDNETWORKS as the same comma list; this doesn't show that
      // Sonarr splits it into two subnets.
      const sonarrKey = store.apps.sonarr?.apiKey ?? '';
      const host = await fetch('http://127.0.0.1:8989/api/v3/config/host', {
        headers: { 'X-Api-Key': sonarrKey },
        signal: AbortSignal.timeout(10_000),
      });
      const { trustedNetworks } = (await host.json()) as { trustedNetworks: string };
      expect(trustedNetworks).toBe(TRUSTED.join(','));

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

      // Without a login for local addresses, the Servarr apps take only the Host names
      // Mediaplane lists (their service name; 127.0.0.1 and localhost always pass), and
      // still take the shared login through their API, Host and all. Radarr gets a name
      // of the owner's own too, as its README says: the list in apps.radarr.env, keeping
      // radarr in it, which shows the apps split the list on commas.
      await writeFile(
        join(home, 'stack.yaml'),
        stack
          .replace(
            'network: { bind: localhost }',
            'network: { bind: localhost }\nsecurity: { login_on_lan: false }',
          )
          .replace(
            '  radarr: {}',
            '  radarr: { env: { RADARR__SERVER__ALLOWEDHOSTS: "radarr,other.example" } }',
          ),
      );
      const lanless = await apply(options);
      expect(lanless.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(lanless.outcome).toBe('success');
      expect(
        lanless.plan.containers
          .filter((c) => c.action === 'recreate')
          .map((c) => c.service),
      ).toEqual(['prowlarr', 'radarr', 'sonarr']);
      await expectSharedLogin(login);
      expect(await statusWithHost(8989, 'sonarr:8989')).toBe(200);
      expect(await statusWithHost(8989, '127.0.0.1:8989')).toBe(200);
      expect(await statusWithHost(8989, 'localhost:8989')).toBe(200);
      expect(await statusWithHost(8989, 'rebinding.example:8989')).toBe(400);
      expect(await statusWithHost(7878, 'radarr:7878')).toBe(200);
      expect(await statusWithHost(7878, 'other.example:7878')).toBe(200);
      expect(await statusWithHost(7878, 'third.example:7878')).toBe(400);
      expect((await apply(options)).outcome).toBe('no-changes');
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
