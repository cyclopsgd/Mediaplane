import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { invokingUser, parseConfig } from '@mediaplane/engine';
import {
  FIXTURE_HOST,
  fakeProbe,
  fakeRuntime,
  tempDir,
} from '@mediaplane/engine/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run, type CliDeps, type Io } from './run';

// writeFile() and open() pass straight through, except where a test fills the disk
// halfway through writing stack.yaml (which can't be provoked reliably otherwise).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), open: vi.fn(actual.open) };
});
const real = await vi.importActual<typeof FsPromises>('node:fs/promises');

beforeEach(() => {
  vi.mocked(writeFile).mockReset();
  vi.mocked(open).mockReset();
});

/**
 * The next file write stops halfway on a full disk, whether it goes through writeFile()
 * or through a handle from open().
 */
function fillDiskOnNextWrite(): void {
  const full = () =>
    Object.assign(new Error('fake: no space left on device'), { code: 'ENOSPC' });
  // init writes text; the first 20 characters make it to the disk.
  const half = (data: unknown) => (typeof data === 'string' ? data.slice(0, 20) : '');
  vi.mocked(writeFile).mockImplementationOnce(async (path, data, options) => {
    await real.writeFile(path, half(data), options);
    throw full();
  });
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await real.open(...args);
    vi.spyOn(handle, 'writeFile').mockImplementationOnce(async (data) => {
      await handle.write(half(data));
      throw full();
    });
    return handle;
  });
}

function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
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
  return {
    io,
    questions,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

const deps = (cloud?: string): Partial<CliDeps> => ({
  host: () =>
    Promise.resolve(cloud === undefined ? FIXTURE_HOST : { ...FIXTURE_HOST, cloud }),
  runtime: () => fakeRuntime(),
  probe: () => fakeProbe(),
});

const newHome = () => tempDir('mediaplane-init-');

async function stackIn(home: string) {
  const result = parseConfig(await readFile(join(home, 'stack.yaml'), 'utf8'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('mediaplane init', () => {
  it('writes a starter stack and a private secrets folder from flags', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--vpn-provider',
      'mullvad',
      '--timezone',
      'Europe/London',
    ];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(await stackIn(home)).toMatchObject({
      media_server: 'jellyfin',
      paths: { data: '/srv/data' },
      network: { bind: 'lan' },
      vpn: { provider: 'mullvad' },
    });
    expect((await stat(join(home, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(term.stdout()).toContain(`Wrote ${join(home, 'stack.yaml')}.`);
    expect(term.stdout()).toContain(
      `Put your VPN's WireGuard private key in ${join(home, 'secrets', 'wg.key')}.`,
    );
    const { uid, gid } = invokingUser();
    expect((await stackIn(home)).user).toEqual({ uid, gid });
    expect(term.stdout()).toContain(
      `Create /srv/data and make sure uid ${String(uid)} (gid ${String(gid)}) can write to it.`,
    );
  });

  it('never overwrites an existing stack.yaml', async () => {
    const home = await newHome();
    await writeFile(join(home, 'stack.yaml'), 'version: 1\n');
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('already exists; init never overwrites it');
    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe('version: 1\n');
    expect(await readdir(home)).toEqual(['stack.yaml']);
  });

  it('never leaves a half-written stack.yaml behind', async () => {
    const home = await newHome();
    fillDiskOnNextWrite();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toBe('error: fake: no space left on device\n');
    expect(await readdir(home)).toEqual([]);
    // With room on the disk, a second try writes it.
    expect(await run(args, capture().io, deps())).toBe(0);
    expect((await readdir(home)).sort()).toEqual(['secrets', 'stack.yaml']);
  });

  it('needs flags when it cannot ask', async () => {
    const term = capture();
    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('init needs --media-server and --data');
  });

  it('asks on a terminal for what the flags leave out', async () => {
    const home = await newHome();
    const term = capture(['plex', '/srv/media', '', 'localhost', 'n', '', '']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.questions).toEqual([
      'Media server, jellyfin or plex [jellyfin]: ',
      'Data folder for downloads and media [/srv/data]: ',
      'VPN provider for qBittorrent, e.g. mullvad (empty for none): ',
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Ask for a login from your own network too? [Y/n] ',
      'Admin user name for the apps [admin]: ',
      'Generate the admin password? [Y/n] ',
    ]);
    const config = await stackIn(home);
    expect(config).toMatchObject({
      media_server: 'plex',
      paths: { data: '/srv/media' },
      network: { bind: 'localhost' },
      security: { login_on_lan: false },
      admin: { username: 'admin' },
    });
    expect(config.vpn).toBeUndefined();
    expect(config.admin.password).toBeUndefined();
    expect(term.stdout()).toContain(
      `Save your Plex token in ${join(home, 'secrets', 'plex-token')}.`,
    );
    expect(term.stdout()).toContain(
      'Then "mediaplane credentials" shows the admin login and where each app is.',
    );
  });

  it('asks for the VPN address, the LAN subnet and your own password file', async () => {
    const home = await newHome();
    const term = capture([
      'jellyfin',
      '/srv/data',
      'mullvad',
      '10.64.0.2/32',
      'lan',
      'y',
      '',
      'media-admin',
      'n',
      'secrets/my-admin-password',
    ]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.questions).toEqual([
      'Media server, jellyfin or plex [jellyfin]: ',
      'Data folder for downloads and media [/srv/data]: ',
      'VPN provider for qBittorrent, e.g. mullvad (empty for none): ',
      "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Your LAN looks like 192.168.1.0/24. Use it? [Y/n] ',
      'Ask for a login from your own network too? [Y/n] ',
      'Admin user name for the apps [admin]: ',
      'Generate the admin password? [Y/n] ',
      'File holding your password, inside the Mediaplane home [secrets/admin-password]: ',
    ]);
    expect(await stackIn(home)).toMatchObject({
      network: { bind: 'lan', lan_subnet: '192.168.1.0/24' },
      security: { login_on_lan: true },
      vpn: { provider: 'mullvad', addresses: '10.64.0.2/32' },
      admin: {
        username: 'media-admin',
        password: { file: 'secrets/my-admin-password' },
      },
    });
    expect(term.stdout()).toContain(
      `Put your admin password, at least 12 characters, in ${join(home, 'secrets', 'my-admin-password')}.`,
    );
  });

  it('lets you type the LAN subnet when the one it sees is not it', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', 'n', '10.10.0.0/16']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.questions).toContain('Your LAN subnet, e.g. 192.168.1.0/24: ');
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '10.10.0.0/16',
    });
  });

  it('asks you to type the LAN subnet when the host is on more than one', async () => {
    const home = await newHome();
    const twoLans = {
      host: () =>
        Promise.resolve({
          ...FIXTURE_HOST,
          privateAddresses: [
            ...FIXTURE_HOST.privateAddresses,
            { address: '172.16.5.4', cidr: '172.16.5.4/16' },
          ],
        }),
    };
    const term = capture(['jellyfin', '/srv/data', '', 'lan', '10.10.0.0/16']);
    expect(await run(['init', '--home', home], term.io, { ...deps(), ...twoLans })).toBe(
      0,
    );
    expect(term.questions.slice(3, 5)).toEqual([
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Your LAN subnet, e.g. 192.168.1.0/24: ',
    ]);
    expect((await stackIn(home)).network.lan_subnet).toBe('10.10.0.0/16');
  });

  it('leaves the subnet to plan when you type nothing for it', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', 'n', '']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect((await stackIn(home)).network).toEqual({ bind: 'lan' });
  });

  it("never offers a cloud VM's own subnet as your LAN: you type it", async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', '10.10.0.0/16']);
    expect(await run(['init', '--home', home], term.io, deps('Oracle Cloud'))).toBe(0);
    expect(term.questions.slice(3, 5)).toEqual([
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [localhost]: ',
      'Your LAN subnet, e.g. 192.168.1.0/24: ',
    ]);
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '10.10.0.0/16',
    });
  });

  it('takes every answer as a flag when it cannot ask', async () => {
    const home = await newHome();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--vpn-provider',
      'mullvad',
      '--vpn-addresses',
      '10.64.0.2/32',
      '--bind',
      'lan',
      '--lan-subnet',
      '192.168.1.0/24',
      '--admin-user',
      'media-admin',
      '--admin-password-file',
      'secrets/admin-password',
    ];
    expect(await run(args, capture().io, deps())).toBe(0);
    expect(await stackIn(home)).toMatchObject({
      network: { bind: 'lan', lan_subnet: '192.168.1.0/24' },
      vpn: { addresses: '10.64.0.2/32' },
      admin: { username: 'media-admin', password: { file: 'secrets/admin-password' } },
    });
  });

  it('writes no LAN subnet for --bind lan alone, so plan detects it', async () => {
    const home = await newHome();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run([...args, '--bind', 'lan'], capture().io, deps())).toBe(0);
    expect((await stackIn(home)).network).toEqual({ bind: 'lan' });
  });

  it('takes the flags it is given and asks only for the rest', async () => {
    const home = await newHome();
    const term = capture(['', 'y']);
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--vpn-provider',
      'mullvad',
      '--vpn-addresses',
      '10.64.0.2/32',
      '--bind',
      'localhost',
      '--no-login-on-lan',
      '--admin-user',
      'media-admin',
    ];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(term.questions).toEqual(['Generate the admin password? [Y/n] ']);
    expect(await stackIn(home)).toMatchObject({
      network: { bind: 'localhost' },
      vpn: { addresses: '10.64.0.2/32' },
      admin: { username: 'media-admin' },
    });
  });

  it.each([
    [['--bind', 'all'], '--bind must be lan or localhost, not "all"'],
    [
      ['--admin-password-file', '/etc/fake-password'],
      '--admin-password-file must be a path inside the Mediaplane home, such as secrets/admin-password',
    ],
    [
      ['--admin-password-file', '../fake-password'],
      '--admin-password-file must be a path inside the Mediaplane home, such as secrets/admin-password',
    ],
    [['--admin-user', 'ad'], 'admin.username: must be 3 to 32 letters, digits'],
    [['--bind', 'lan', '--lan-subnet', '203.0.113.0/24'], 'a private (RFC 1918) subnet'],
    [['--vpn-addresses', '10.64.0.2/32'], '--vpn-addresses needs --vpn-provider'],
  ])('refuses %j, and writes nothing', async (extra, message) => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run([...args, ...extra], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain(message);
    await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
  });

  it('refuses --bind lan on a cloud VM without --lan-subnet', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--bind',
      'lan',
    ];
    expect(await run(args, term.io, deps('Oracle Cloud'))).toBe(1);
    expect(term.stderr()).toContain(
      'this looks like a VM on Oracle Cloud, where bind: lan needs your LAN subnet: add --lan-subnet, or use --bind localhost',
    );
  });

  it('keeps the web UIs on localhost on a cloud VM', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    expect(await run(args, term.io, deps('Oracle Cloud'))).toBe(0);
    expect((await stackIn(home)).network.bind).toBe('localhost');
    expect(term.stdout()).toContain(
      'This looks like a VM on Oracle Cloud, so the web UIs stay on localhost (network.bind).\n',
    );
  });

  it('does not say the web UIs stay on localhost when you chose the LAN on a cloud VM', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--bind',
      'lan',
      '--lan-subnet',
      '192.168.1.0/24',
    ];
    expect(await run(args, term.io, deps('Oracle Cloud'))).toBe(0);
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '192.168.1.0/24',
    });
    expect(term.stdout()).not.toContain('stay on localhost');
  });

  it('explains host facts the host helper could not give, with its hint, as plan does', async () => {
    const env = { MEDIAPLANE_IMAGE: 'mediaplane:test' };
    // This fake Docker has no host helper, so every run of it fails.
    const overrides = { runtime: () => fakeRuntime() };
    const home = await newHome();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
    ];
    const term = capture([], env);
    expect(await run(args, term.io, overrides)).toBe(1);
    expect(term.questions).toEqual([]);
    expect(term.stdout()).toBe('');
    expect(term.stderr()).toContain(
      'error: the host helper failed: this fake Docker has no host helper\n  hint: the host helper runs the image named by MEDIAPLANE_IMAGE',
    );
    const json = capture(undefined, env);
    expect(await run([...args, '--json'], json.io, overrides)).toBe(1);
    expect(JSON.parse(json.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: 'the host helper failed: this fake Docker has no host helper' },
    });
    expect(await readdir(home)).toEqual([]);
  });

  it('reports an invalid answer and writes nothing', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      'relative/path',
    ];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('must be an absolute path');
    await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
  });

  it('prints versioned JSON', async () => {
    const home = await newHome();
    const term = capture();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'jellyfin',
      '--data',
      '/srv/data',
      '--json',
    ];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.init/v1',
      ok: true,
      stackPath: join(home, 'stack.yaml'),
    });
  });
});
