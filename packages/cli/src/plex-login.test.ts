import {
  chmod,
  lstat,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { plexTvClient, type PlexTv } from '@mediaplane/engine';
import {
  closedPort,
  FAKE_PLEX_ACCOUNT,
  fakePlexTv,
  tempDir,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type Io } from './run';

const PLEX_STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const OLD = 'old-plex-token-00001';

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

async function makeHome(stack = PLEX_STACK): Promise<string> {
  const home = await tempDir('mediaplane-plex-login-');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
}

/** plex-login in `home`, against `plexTv`, with `args`. */
async function login(home: string, plexTv: PlexTv, args: string[] = [], env = {}) {
  const term = capture(env);
  const code = await run(['plex-login', '--home', home, ...args], term.io, {
    plexTv: () => plexTv,
  });
  const said = term.stdout() + term.stderr();
  return { code, said, stdout: term.stdout(), stderr: term.stderr() };
}

describe('mediaplane plex-login', () => {
  it('prints a link, waits for the sign-in, and saves the token 0600 where plex.token says', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 1 };
    const { code, stdout, said } = await login(home, plexTv.client);
    expect(code).toBe(0);
    const pin = plexTv.state.pins[0];
    expect(stdout).toContain(
      `Sign in to Plex in a browser, with this link:\n\n  https://app.plex.tv/auth#?clientID=${String(pin?.clientId)}&code=${String(pin?.code)}&context%5Bdevice%5D%5Bproduct%5D=Mediaplane\n\nWaiting for you to sign in (up to 30 minutes)...\n`,
    );
    expect(stdout).toContain(
      'Signed in. Saved your Plex token in secrets/plex-token. Next: run "mediaplane apply".\n',
    );
    expect(pin?.clientId).toMatch(/^mediaplane-[0-9a-f-]{36}$/);
    const path = join(home, 'secrets', 'plex-token');
    expect(await readFile(path, 'utf8')).toBe(`${TOKEN}\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(said).not.toContain(TOKEN);
  });

  it('prints JSON with --json, the link on stderr, and never the token', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    const { code, stdout, stderr } = await login(home, plexTv.client, ['--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      schema: 'mediaplane.plex-login/v1',
      ok: true,
      saved: 'secrets/plex-token',
      signedIn: true,
      replaced: false,
    });
    expect(stderr).toContain('https://app.plex.tv/auth#?clientID=');
    expect(stdout + stderr).not.toContain(TOKEN);
  });

  it('keeps a saved token that plex.tv takes, without a sign-in, unless --force', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
    const plexTv = await fakePlexTv();
    const kept = await login(home, plexTv.client);
    expect(kept.code).toBe(0);
    expect(kept.stdout).toBe(
      'The Plex token in secrets/plex-token works, so there is nothing to do. Run "mediaplane plex-login --force" to sign in again.\n',
    );
    expect(plexTv.state.calls).toEqual(['GET /api/v2/user']);

    plexTv.state.accounts.push({ id: 7_000_002, token: 'new-plex-token-00002' });
    plexTv.state.signIn = { token: 'new-plex-token-00002', afterReads: 0 };
    const forced = await login(home, plexTv.client, ['--force', '--json']);
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.stdout)).toMatchObject({ signedIn: true, replaced: true });
    expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
      'new-plex-token-00002\n',
    );
    expect(forced.said).not.toContain('new-plex-token');
  });

  it('signs in again when plex.tv refuses the saved token, and replaces it', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${OLD}\n`);
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    const { code, stderr, said } = await login(home, plexTv.client);
    expect(code).toBe(0);
    expect(stderr).toBe(
      'plex.tv refuses the Plex token in secrets/plex-token, so sign in again.\n',
    );
    expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
      `${TOKEN}\n`,
    );
    expect(said).not.toContain(OLD);
    expect(said).not.toContain(TOKEN);
  });

  it.each([
    [
      403,
      'error: plex.tv answered with HTTP 403, so Mediaplane can\'t tell whether the Plex token in secrets/plex-token still works. It is kept. Try again later, or run "mediaplane plex-login --force" to sign in anyway.\n',
    ],
    [
      503,
      'error: plex.tv answered with HTTP 503, so Mediaplane can\'t tell whether the Plex token in secrets/plex-token still works. It is kept. Try again later, or run "mediaplane plex-login --force" to sign in anyway.\n',
    ],
  ])(
    'keeps the saved token, and makes no PIN, when plex.tv answers %i to the check',
    async (status, message) => {
      const home = await makeHome();
      await mkdir(join(home, 'secrets'));
      await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
      const plexTv = await fakePlexTv();
      plexTv.state.failing.push({ path: '/api/v2/user', status });
      plexTv.state.signIn = { token: 'new-plex-token-00002', afterReads: 0 };
      const { code, stdout, stderr } = await login(home, plexTv.client);
      expect(code).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toBe(message);
      expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
        `${TOKEN}\n`,
      );
      expect(plexTv.state.pins).toEqual([]);
      expect(plexTv.state.calls.some((call) => call.startsWith('POST'))).toBe(false);
      expect(stderr).not.toContain('fake failure');
    },
  );

  it('says the saved token is kept when plex.tv cannot be reached for the check', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(await closedPort())}`,
      sleep: () => Promise.resolve(),
    });
    const { code, stderr } = await login(home, client);
    expect(code).toBe(1);
    expect(stderr).toBe(
      'error: couldn\'t reach plex.tv: plex.tv could not be reached (ECONNREFUSED) (GET /api/v2/user); the Plex token in secrets/plex-token is kept. Check this host\'s internet connection and try again later, or run "mediaplane plex-login --force" to sign in anyway.\n',
    );
    expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
      `${TOKEN}\n`,
    );
  });

  it("does not call an answer it can't understand a refusal", async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
    const plexTv = await fakePlexTv();
    plexTv.state.failing.push({ path: '/api/v2/user', status: 400 });
    const { code, stderr } = await login(home, plexTv.client);
    expect(code).toBe(1);
    expect(stderr).toBe(
      'error: plex.tv refused the request (HTTP 400) (GET /api/v2/user)\n',
    );
  });

  it.skipIf(process.getuid?.() === 0)(
    'fails before any PIN when the token file exists but cannot be read, even with --force',
    async () => {
      const home = await makeHome();
      await mkdir(join(home, 'secrets'));
      const path = join(home, 'secrets', 'plex-token');
      await writeFile(path, `${TOKEN}\n`);
      await chmod(path, 0o000);
      const plexTv = await fakePlexTv();
      plexTv.state.signIn = { token: 'new-plex-token-00002', afterReads: 0 };
      for (const args of [[], ['--force']]) {
        const { code, stderr } = await login(home, plexTv.client, args);
        expect(code).toBe(1);
        expect(stderr).toBe(
          "error: can't read the Plex token file secrets/plex-token (EACCES): fix the file's owner or mode, then run plex-login again\n",
        );
        expect(stderr).not.toContain(TOKEN);
      }
      expect(plexTv.state.calls).toEqual([]);
    },
  );

  it('counts an empty token file as absent, and says replaced when it writes over it', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), '  \n');
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    const { code, stdout } = await login(home, plexTv.client, ['--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ signedIn: true, replaced: true });
    expect(plexTv.state.calls).not.toContain('GET /api/v2/user');
    expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
      `${TOKEN}\n`,
    );
  });

  it.skipIf(process.getuid?.() === 0)(
    'makes the folder before the PIN, so a folder it cannot make loses no sign-in',
    async () => {
      const home = await makeHome(
        PLEX_STACK.replace('secrets/plex-token', 'secrets/more/plex-token'),
      );
      await mkdir(join(home, 'secrets'));
      await chmod(join(home, 'secrets'), 0o500);
      const plexTv = await fakePlexTv();
      plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
      const { code, stderr } = await login(home, plexTv.client);
      await chmod(join(home, 'secrets'), 0o700);
      expect(code).toBe(1);
      expect(stderr).toBe(
        "error: can't make the folder secrets/more for the Plex token (EACCES): fix the folder's owner or mode, then run plex-login again\n",
      );
      expect(plexTv.state.calls).toEqual([]);
    },
  );

  it('stops after --timeout when nobody signs in, and saves nothing', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    const { code, stdout, stderr } = await login(home, plexTv.client, ['--timeout', '1']);
    expect(code).toBe(1);
    expect(stdout).toContain('Waiting for you to sign in (up to 1 second)...');
    expect(stderr).toBe(
      'error: nobody signed in within 1 second; run plex-login again for a new link\n',
    );
    await expect(stat(join(home, 'secrets', 'plex-token'))).rejects.toThrow();
  });

  it('says the link ran out once plex.tv forgets the PIN', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    // A PIN plex.tv no longer knows, as one that has run out.
    const forgotten: PlexTv = {
      ...plexTv.client,
      createPin: async (clientId) => ({
        ...(await plexTv.client.createPin(clientId)),
        id: 999,
      }),
    };
    const { code, stderr } = await login(home, forgotten, ['--json']);
    expect(code).toBe(1);
    expect(stderr).toContain('https://app.plex.tv/auth#?clientID=');
    const { stdout } = await login(home, forgotten, ['--json']);
    expect(JSON.parse(stdout)).toEqual({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: {
        message:
          'the link ran out before you signed in; run plex-login again for a new one',
      },
    });
  });

  it("says when plex.tv can't be reached", async () => {
    const home = await makeHome();
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(await closedPort())}`,
      sleep: () => Promise.resolve(),
    });
    const { code, stderr } = await login(home, client);
    expect(code).toBe(1);
    expect(stderr).toBe(
      "error: couldn't reach plex.tv: plex.tv could not be reached (ECONNREFUSED) (POST /api/v2/pins); check this host's internet connection, then run plex-login again\n",
    );
  });

  it('refuses a --timeout that is not 1 to 1800 seconds, without asking plex.tv', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    for (const timeout of ['0', '1801', 'soon', '1.5', '-5']) {
      const { code, stderr } = await login(home, plexTv.client, [`--timeout=${timeout}`]);
      expect(code).toBe(1);
      expect(stderr).toBe(
        'error: --timeout must be a whole number of seconds from 1 to 1800\n',
      );
    }
    expect(plexTv.state.calls).toEqual([]);
  });

  it('refuses a stack.yaml without plex.token, or one that reads it from the environment', async () => {
    const plexTv = await fakePlexTv();
    const jellyfin = await makeHome(
      PLEX_STACK.replace(/media_server: plex\nplex: .*\n/, 'media_server: jellyfin\n'),
    );
    const none = await login(jellyfin, plexTv.client);
    expect(none.code).toBe(1);
    expect(none.stderr).toBe(
      'error: stack.yaml has no plex.token, which says where your Plex token goes: set media_server: plex and plex.token: { file: secrets/plex-token }, then run plex-login again\n',
    );
    const fromEnv = await makeHome(
      PLEX_STACK.replace('{ file: secrets/plex-token }', '{ env: PLEX_TOKEN }'),
    );
    const env = await login(fromEnv, plexTv.client, [], { PLEX_TOKEN: TOKEN });
    expect(env.code).toBe(1);
    expect(env.stderr).toBe(
      "error: plex.token is read from the environment variable PLEX_TOKEN, where plex-login can't save it: set plex.token: { file: secrets/plex-token } instead, then run plex-login again\n",
    );
    expect(plexTv.state.calls).toEqual([]);
  });

  it('says what is wrong with a missing stack.yaml', async () => {
    const home = await tempDir('mediaplane-plex-login-');
    const plexTv = await fakePlexTv();
    const { code, stderr } = await login(home, plexTv.client);
    expect(code).toBe(1);
    expect(stderr).toContain(`error: no stack.yaml at ${join(home, 'stack.yaml')}`);
  });

  it('replaces a link at the token file with the file itself, never writing through it', async () => {
    const home = await makeHome();
    const elsewhere = join(await tempDir('mediaplane-elsewhere-'), 'target');
    await writeFile(elsewhere, 'not yours\n');
    await mkdir(join(home, 'secrets'));
    await symlink(elsewhere, join(home, 'secrets', 'plex-token'));
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    // The link's target holds no token plex.tv takes, so plex-login signs in again.
    expect((await login(home, plexTv.client)).code).toBe(0);
    expect(await readFile(elsewhere, 'utf8')).toBe('not yours\n');
    const saved = join(home, 'secrets', 'plex-token');
    expect((await lstat(saved)).isSymbolicLink()).toBe(false);
    expect(await readFile(saved, 'utf8')).toBe(`${TOKEN}\n`);
  });

  it('lists its exit codes in --help', async () => {
    const term = capture();
    expect(await run(['plex-login', '--help'], term.io)).toBe(0);
    expect(term.stdout()).toContain(
      'Exit codes:\n  0: signed in and saved your Plex token, or the saved one works\n  1: nobody signed in in time, the link ran out, or an error\n',
    );
  });
});
