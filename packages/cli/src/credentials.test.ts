import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FIXTURE_HOST,
  fakeProbe,
  fakeRuntime,
  tempDir,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { printCredentials } from './credentials';
import { run, type CliDeps, type Io } from './run';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;
const PASSWORD = 'fake-admin-password-0001';

async function makeHome({ stack = STACK, stored = true } = {}): Promise<string> {
  const home = await tempDir('mediaplane-cli-');
  await writeFile(join(home, 'stack.yaml'), stack);
  if (stored) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, 'state', 'secrets.json'),
      JSON.stringify({ version: 1, apps: {}, shared: { adminPassword: PASSWORD } }),
    );
  }
  return home;
}

const OWN = 'fake-own-password';

/** A home whose admin password is yours, from secrets/admin-password. */
async function ownHome(password = OWN): Promise<string> {
  const home = await makeHome({
    stack: STACK.replace(
      'apps:',
      'admin: { password: { file: secrets/admin-password } }\napps:',
    ),
    stored: false,
  });
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'admin-password'), `${password}\n`);
  return home;
}

function capture(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

const deps: Partial<CliDeps> = {
  host: () => Promise.resolve(FIXTURE_HOST),
  runtime: () => fakeRuntime(),
  probe: () => fakeProbe(),
};

describe('mediaplane credentials', () => {
  it('shows the shared login, and where each app is', async () => {
    const term = capture();
    expect(await run(['credentials', '--home', await makeHome()], term.io, deps)).toBe(0);
    expect(term.stdout()).toBe(
      [
        'Admin login for the apps:',
        '  user name  admin',
        `  password   ${PASSWORD}`,
        '',
        'Jellyfin     http://127.0.0.1:8096  (its login arrives in Slice 6)',
        'qBittorrent  http://127.0.0.1:8080',
        'Sonarr       http://127.0.0.1:8989  (its login arrives in Slice 3b)',
        '',
      ].join('\n'),
    );
  });

  it('leaves the password out of JSON unless --reveal is given', async () => {
    const home = await makeHome();
    const hidden = capture();
    expect(await run(['credentials', '--home', home, '--json'], hidden.io, deps)).toBe(0);
    expect(hidden.stdout()).not.toContain(PASSWORD);
    expect(JSON.parse(hidden.stdout())).toEqual({
      schema: 'mediaplane.credentials/v1',
      username: 'admin',
      password: null,
      passwordSource: 'generated',
      apps: [
        {
          app: 'jellyfin',
          name: 'Jellyfin',
          urls: ['http://127.0.0.1:8096'],
          login: 'not-yet',
          comingIn: 'Slice 6',
        },
        {
          app: 'qbittorrent',
          name: 'qBittorrent',
          urls: ['http://127.0.0.1:8080'],
          login: 'shared',
        },
        {
          app: 'sonarr',
          name: 'Sonarr',
          urls: ['http://127.0.0.1:8989'],
          login: 'not-yet',
          comingIn: 'Slice 3b',
        },
      ],
    });
    const shown = capture();
    expect(
      await run(['credentials', '--home', home, '--json', '--reveal'], shown.io, deps),
    ).toBe(0);
    expect(JSON.parse(shown.stdout())).toMatchObject({ password: PASSWORD });
  });

  it('shows one app, and fails for one without a web login', async () => {
    const home = await makeHome();
    const one = capture();
    expect(await run(['credentials', 'qbittorrent', '--home', home], one.io, deps)).toBe(
      0,
    );
    expect(one.stdout()).toContain('\nqBittorrent  http://127.0.0.1:8080\n');
    expect(one.stdout()).not.toContain('Sonarr');
    const none = capture();
    expect(await run(['credentials', 'gluetun', '--home', home], none.io, deps)).toBe(1);
    expect(none.stderr()).toBe(
      'error: no app "gluetun" with a web login in this stack\n',
    );
  });

  it('keeps your own password hidden unless --reveal is given', async () => {
    const home = await ownHome();
    const hidden = capture();
    expect(await run(['credentials', '--home', home], hidden.io, deps)).toBe(0);
    expect(hidden.stdout()).toContain(
      '  password   yours, from secrets/admin-password (--reveal shows it)\n',
    );
    expect(hidden.stdout()).not.toContain('fake-own-password');
    const shown = capture();
    expect(await run(['credentials', '--home', home, '--reveal'], shown.io, deps)).toBe(
      0,
    );
    expect(shown.stdout()).toContain('  password   fake-own-password\n');
  });

  // Spec §5.2, §6.1: a generated password is shown; yours, and any in JSON, need --reveal.
  it.each([
    // [whose password, output, --reveal, is the password in stdout]
    ['generated', 'human', false, true],
    ['generated', 'human', true, true],
    ['generated', 'json', false, false],
    ['generated', 'json', true, true],
    ['yours', 'human', false, false],
    ['yours', 'human', true, true],
    ['yours', 'json', false, false],
    ['yours', 'json', true, true],
  ] as const)(
    'with %s password, %s output and reveal=%s, the password is shown: %s',
    async (whose, output, reveal, shown) => {
      const home = whose === 'generated' ? await makeHome() : await ownHome();
      const password = whose === 'generated' ? PASSWORD : OWN;
      const term = capture();
      const argv = ['credentials', '--home', home];
      if (output === 'json') argv.push('--json');
      if (reveal) argv.push('--reveal');
      expect(await run(argv, term.io, deps)).toBe(0);
      expect(term.stdout().includes(password)).toBe(shown);
      expect(term.stderr()).toBe('');
      if (output === 'json') {
        expect(JSON.parse(term.stdout())).toMatchObject({
          password: shown ? password : null,
          passwordSource: whose,
        });
      }
    },
  );

  it('never puts a password in an error', async () => {
    const short = await ownHome('fake-short');
    const missing = await makeHome({ stored: false });
    const unknown = await makeHome();
    for (const home of [short, missing]) {
      for (const flags of [[], ['--json'], ['--reveal'], ['--json', '--reveal']]) {
        const term = capture();
        expect(await run(['credentials', '--home', home, ...flags], term.io, deps)).toBe(
          1,
        );
        expect(term.stdout() + term.stderr()).not.toMatch(/fake-short|fake-own/);
      }
    }
    for (const flags of [[], ['--json', '--reveal']]) {
      const term = capture();
      const argv = ['credentials', 'nothing', '--home', unknown, ...flags];
      expect(await run(argv, term.io, deps)).toBe(1);
      expect(term.stdout() + term.stderr()).not.toContain(PASSWORD);
    }
  });

  it('explains host facts the host helper could not give, with its hint, as plan does', async () => {
    const env = { MEDIAPLANE_IMAGE: 'mediaplane:test' };
    // This fake Docker has no host helper, so every run of it fails.
    const overrides = { runtime: () => fakeRuntime() };
    const home = await makeHome();
    const term = capture(env);
    expect(await run(['credentials', '--home', home], term.io, overrides)).toBe(1);
    expect(term.stdout()).toBe('');
    expect(term.stderr()).toContain(
      'error: the host helper failed: this fake Docker has no host helper\n  hint: the host helper runs the image named by MEDIAPLANE_IMAGE',
    );
    expect(term.stderr()).not.toContain(PASSWORD);
    const json = capture(env);
    expect(await run(['credentials', '--home', home, '--json'], json.io, overrides)).toBe(
      1,
    );
    expect(JSON.parse(json.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: 'the host helper failed: this fake Docker has no host helper' },
    });
    expect(json.stdout()).not.toContain(PASSWORD);
  });

  it('says to run apply first, as an error, before the password exists', async () => {
    const home = await makeHome({ stored: false });
    const term = capture();
    expect(await run(['credentials', '--home', home], term.io, deps)).toBe(1);
    expect(term.stderr()).toBe(
      'error: the admin password has not been generated yet\n  hint: run "mediaplane apply": it generates the password before it starts any app\n',
    );
    const json = capture();
    expect(await run(['credentials', '--home', home, '--json'], json.io, deps)).toBe(1);
    expect(JSON.parse(json.stdout())).toEqual({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: 'the admin password has not been generated yet' },
    });
  });
});

describe('printCredentials', () => {
  it('says so when an app has no address to show', () => {
    const term = capture();
    const code = printCredentials(
      {
        ok: true,
        username: 'admin',
        password: PASSWORD,
        source: { kind: 'generated' },
        apps: [{ app: 'app', name: 'App', urls: [], login: 'shared' }],
      },
      undefined,
      { json: false, reveal: false },
      term.io,
    );
    expect(code).toBe(0);
    expect(term.stdout()).toContain('\nApp  not published\n');
  });
});
