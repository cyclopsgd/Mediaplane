import { chmod, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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
import type { DataFolder } from './folders';
import { NOTES } from './init';
import { PromptCancelled } from './prompt';
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

/**
 * A terminal that answers `answers` to its questions, in order, and `pasted` to its hidden
 * ones; without `answers`, no terminal. `shown` is everything on the screen, in order:
 * what init printed, and each question, with a hidden one's answer never in it.
 */
function capture(answers?: string[], env: NodeJS.ProcessEnv = {}, pasted: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const shown: string[] = [];
  const questions: string[] = [];
  const hidden: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
      shown.push(text);
    },
    stderr: (text) => {
      err.push(text);
      shown.push(text);
    },
    env,
    ...(answers === undefined
      ? {}
      : {
          ask: (question: string) => {
            questions.push(question);
            shown.push(question);
            return Promise.resolve(answers.shift() ?? '');
          },
          askSecret: (question: string) => {
            hidden.push(question);
            shown.push(question);
            return Promise.resolve(pasted.shift() ?? '');
          },
        }),
  };
  return {
    io,
    questions,
    hidden,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
    shown: () => shown.join(''),
  };
}

const deps = (
  cloud?: string,
  dataFolder: DataFolder = 'unseen',
  folders: string[] = [],
): Partial<CliDeps> => ({
  host: () =>
    Promise.resolve(cloud === undefined ? FIXTURE_HOST : { ...FIXTURE_HOST, cloud }),
  runtime: () => fakeRuntime(),
  probe: () => fakeProbe(),
  // Never the host's own folders: /srv/data is only a name here.
  dataFolder: (path) => {
    folders.push(path);
    return Promise.resolve(dataFolder);
  },
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
    const term = capture(['plex', '/srv/media', '', 'localhost', '', '']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    // Nothing is published beyond this machine, so there is no login on the LAN to ask about.
    expect(term.questions).toEqual([
      'Media server, jellyfin or plex [jellyfin]: ',
      'Data folder for downloads and media [/srv/data]: ',
      'VPN provider for qBittorrent, e.g. mullvad (empty for none): ',
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Admin user name for the apps [admin]: ',
      'Generate the admin password? [Y/n] ',
    ]);
    const config = await stackIn(home);
    expect(config).toMatchObject({
      media_server: 'plex',
      paths: { data: '/srv/media' },
      network: { bind: 'localhost' },
      security: { login_on_lan: true },
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

  it('asks again for a WireGuard address the schema rejects', async () => {
    const home = await newHome();
    const term = capture([
      'jellyfin',
      '/srv/data',
      'mullvad',
      '10.64.0.2',
      '10.64.0.2/32,fd00::2/128',
      'localhost',
      'admin',
      'y',
    ]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.stderr()).toBe(
      'That must be one or more addresses with their prefix length, separated by commas without spaces, such as 10.64.0.2/32 or 10.64.0.2/32,fd00::2/128.\n',
    );
    expect((await stackIn(home)).vpn).toMatchObject({
      addresses: '10.64.0.2/32,fd00::2/128',
    });
  });

  it('lets you type the LAN subnet when the one it sees is not it', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', 'n', '192.168.0.0/16']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.questions).toContain('Your LAN subnet, e.g. 192.168.1.0/24: ');
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '192.168.0.0/16',
    });
  });

  it('asks again for a typed subnet that plan would reject, then takes a good one', async () => {
    const home = await newHome();
    const term = capture([
      'jellyfin',
      '/srv/data',
      '',
      'lan',
      'n',
      'nonsense',
      '203.0.113.0/24',
      '10.10.0.0/16',
      '192.168.1.0/24',
    ]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.questions.filter((q) => q.startsWith('Your LAN subnet'))).toHaveLength(4);
    expect(term.stderr()).toBe(
      [
        'That must be an IPv4 CIDR such as 192.168.1.0/24.',
        'That must be a private (RFC 1918) subnet, inside 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16: addresses in it may skip logins and get through the VPN firewall.',
        "None of this host's private addresses (192.168.1.10) is inside 10.10.0.0/16. Type a subnet this host is on, or nothing to have plan detect it.",
        '',
      ].join('\n'),
    );
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '192.168.1.0/24',
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
    const term = capture(['jellyfin', '/srv/data', '', 'lan', '172.16.0.0/16']);
    expect(await run(['init', '--home', home], term.io, { ...deps(), ...twoLans })).toBe(
      0,
    );
    expect(term.questions.slice(3, 5)).toEqual([
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Your LAN subnet, e.g. 192.168.1.0/24: ',
    ]);
    expect((await stackIn(home)).network.lan_subnet).toBe('172.16.0.0/16');
  });

  it('never offers a network wider than a private range as your LAN', async () => {
    const home = await newHome();
    const odd = {
      host: () =>
        Promise.resolve({
          ...FIXTURE_HOST,
          privateAddresses: [{ address: '10.0.0.5', cidr: '10.0.0.5/4' }],
        }),
    };
    const term = capture(['jellyfin', '/srv/data', '', 'lan', '10.0.0.0/8']);
    expect(await run(['init', '--home', home], term.io, { ...deps(), ...odd })).toBe(0);
    expect(term.questions[4]).toBe('Your LAN subnet, e.g. 192.168.1.0/24: ');
    expect((await stackIn(home)).network.lan_subnet).toBe('10.0.0.0/8');
  });

  it('stops at Ctrl-D, writing nothing', async () => {
    const home = await newHome();
    const term = capture();
    const answers = ['jellyfin'];
    const io: Io = {
      ...term.io,
      ask: () => {
        const answer = answers.shift();
        return answer === undefined
          ? Promise.reject(new PromptCancelled())
          : Promise.resolve(answer);
      },
    };
    expect(await run(['init', '--home', home], io, deps())).toBe(1);
    expect(term.stderr()).toBe(
      'error: init stopped at a question; nothing was written\n',
    );
    expect(await readdir(home)).toEqual([]);
  });

  it('leaves the subnet to plan when you type nothing for it', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', 'n', '']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect((await stackIn(home)).network).toEqual({ bind: 'lan' });
  });

  it("never offers a cloud VM's own subnet as your LAN: you type it", async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', '192.168.0.0/16']);
    expect(await run(['init', '--home', home], term.io, deps('Oracle Cloud'))).toBe(0);
    // Worded as plan's hint is, so it doesn't invite the LAN at home.
    expect(term.questions.slice(3, 5)).toEqual([
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [localhost]: ',
      'The private network to publish on, e.g. 10.0.0.0/24: ',
    ]);
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '192.168.0.0/16',
    });
  });

  it('tells a cloud VM to type a subnet this host is on, and not to leave it to plan', async () => {
    const home = await newHome();
    const term = capture([
      'jellyfin',
      '/srv/data',
      '',
      'lan',
      '10.10.0.0/16',
      '192.168.1.0/24',
    ]);
    expect(await run(['init', '--home', home], term.io, deps('Oracle Cloud'))).toBe(0);
    expect(term.stderr()).toBe(
      "None of this host's private addresses (192.168.1.10) is inside 10.10.0.0/16. Type a subnet this host is on.\n",
    );
  });

  it('asks a cloud VM again at once for an empty subnet, saying why', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan', '', '192.168.1.0/24']);
    expect(await run(['init', '--home', home], term.io, deps('Oracle Cloud'))).toBe(0);
    expect(
      term.questions.filter((q) => q.startsWith('The private network to publish on')),
    ).toHaveLength(2);
    expect(term.stderr()).toBe(
      'This looks like a VM on Oracle Cloud, where lan needs the private network to publish on. Type a subnet this host is on.\n',
    );
    expect((await stackIn(home)).network).toEqual({
      bind: 'lan',
      lan_subnet: '192.168.1.0/24',
    });
  });

  it.each([
    ['a home server', undefined],
    ['a cloud VM', 'Oracle Cloud'],
  ])(
    'tells %s with no private address that lan cannot work, not to leave it to plan',
    async (_, cloud) => {
      const home = await newHome();
      const noAddress: Partial<CliDeps> = {
        host: () =>
          Promise.resolve({
            arch: 'amd64',
            privateAddresses: [],
            ...(cloud === undefined ? {} : { cloud }),
          }),
      };
      const answers = ['jellyfin', '/srv/data', '', 'lan', '192.168.1.0/24'];
      const term = capture();
      const io: Io = {
        ...term.io,
        ask: () => {
          const answer = answers.shift();
          return answer === undefined
            ? Promise.reject(new PromptCancelled())
            : Promise.resolve(answer);
        },
      };
      expect(await run(['init', '--home', home], io, { ...deps(), ...noAddress })).toBe(
        1,
      );
      expect(term.stderr()).toBe(
        [
          "This host has no private (RFC 1918) IPv4 address, so lan can't work here. Press Ctrl-C, then run init again and answer localhost.",
          'error: init stopped at a question; nothing was written',
          '',
        ].join('\n'),
      );
      expect(await readdir(home)).toEqual([]);
    },
  );

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

  it('takes the media server and the bind in any case', async () => {
    const home = await newHome();
    const args = [
      'init',
      '--home',
      home,
      '--media-server',
      'Plex',
      '--data',
      '/srv/data',
    ];
    expect(await run([...args, '--bind', 'LocalHost'], capture().io, deps())).toBe(0);
    expect(await stackIn(home)).toMatchObject({
      media_server: 'plex',
      network: { bind: 'localhost' },
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
    const term = capture(['']);
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
      security: { login_on_lan: false },
      vpn: { addresses: '10.64.0.2/32' },
      admin: { username: 'media-admin' },
    });
  });

  const OUTSIDE_THE_HOME =
    '--admin-password-file must be a path inside the Mediaplane home, such as secrets/admin-password';
  const REFUSALS: [string[], string][] = [
    [['--bind', 'all'], '--bind must be lan or localhost, not "all"'],
    [['--media-server', 'emby'], '--media-server must be jellyfin or plex, not "emby"'],
    [['--data', 'relative/path'], 'paths.data: must be an absolute path'],
    [['--admin-password-file', '/etc/fake-password'], OUTSIDE_THE_HOME],
    [['--admin-password-file', '../fake-password'], OUTSIDE_THE_HOME],
    [['--admin-password-file', 'secrets/../../fake-password'], OUTSIDE_THE_HOME],
    // The home itself, and a folder, are not a file.
    [['--admin-password-file', '.'], OUTSIDE_THE_HOME],
    [['--admin-password-file', 'secrets/..'], OUTSIDE_THE_HOME],
    [['--admin-password-file', 'secrets/'], OUTSIDE_THE_HOME],
    [['--admin-password-file', 'secrets/.'], OUTSIDE_THE_HOME],
    [['--admin-password-file', ''], OUTSIDE_THE_HOME],
    [
      ['--admin-password-file', 'stack.yaml'],
      '--admin-password-file must not be stack.yaml, which holds the stack itself',
    ],
    [
      ['--admin-password-file', './secrets/../stack.yaml'],
      '--admin-password-file must not be stack.yaml, which holds the stack itself',
    ],
    [['--admin-user', 'ad'], 'admin.username: must be 3 to 32 letters, digits'],
    [['--lan-subnet', 'nonsense'], 'network.lan_subnet: must be an IPv4 CIDR'],
    [['--bind', 'lan', '--lan-subnet', '203.0.113.0/24'], 'a private (RFC 1918) subnet'],
    [
      // Valid and private, but plan keeps only the host's addresses inside it: none here.
      ['--bind', 'lan', '--lan-subnet', '10.10.0.0/16'],
      'network.bind is "lan", but none of this host\'s private addresses (192.168.1.10) is inside 10.10.0.0/16; give --lan-subnet a subnet this host is on, or use --bind localhost',
    ],
    [['--vpn-addresses', '10.64.0.2/32'], '--vpn-addresses needs --vpn-provider'],
    [
      ['--vpn-provider', 'mullvad', '--vpn-addresses', '10.64.0.2'],
      'vpn.addresses: must be one or more addresses with their prefix length',
    ],
  ];

  it.each(REFUSALS)('refuses %j, and writes nothing', async (extra, message) => {
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

  it.each(REFUSALS.filter(([extra]) => extra[0] !== '--vpn-addresses'))(
    'refuses %j before it asks anything on a terminal',
    async (extra, message) => {
      const home = await newHome();
      const term = capture([]);
      const args = ['init', '--home', home, ...extra];
      expect(await run(args, term.io, deps())).toBe(1);
      expect(term.questions).toEqual([]);
      expect(term.stderr()).toContain(message);
      await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
    },
  );

  // root can write anywhere, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    "says how to get a home it can't create, before it asks anything",
    async () => {
      const parent = await newHome();
      await chmod(parent, 0o555);
      try {
        const home = join(parent, 'mediaplane');
        const term = capture([]);
        expect(await run(['init', '--home', home], term.io, deps())).toBe(1);
        expect(term.questions).toEqual([]);
        expect(term.stderr()).toBe(
          `error: can't create ${home} (permission denied): pass --home <a folder of yours>, or create it first with "sudo mkdir -p ${home} && sudo chown $USER: ${home}"\n`,
        );
        // The same with flags only, and as JSON.
        const json = capture();
        const flags = ['--media-server', 'jellyfin', '--data', '/srv/data', '--json'];
        expect(await run(['init', '--home', home, ...flags], json.io, deps())).toBe(1);
        expect(JSON.parse(json.stdout())).toMatchObject({
          ok: false,
          error: { message: expect.stringContaining(`can't create ${home}`) as string },
        });
      } finally {
        // So that the temporary folder can be removed.
        await chmod(parent, 0o755);
      }
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    "says how to get a home it can't write into, before it asks anything",
    async () => {
      const home = await newHome();
      await chmod(home, 0o555);
      try {
        const term = capture([]);
        expect(await run(['init', '--home', home], term.io, deps())).toBe(1);
        expect(term.questions).toEqual([]);
        expect(term.stderr()).toBe(
          `error: can't write into ${home} (permission denied): pass --home <a folder of yours>, or make it yours with "sudo chown $USER: ${home}"\n`,
        );
      } finally {
        await chmod(home, 0o755);
      }
    },
  );

  it('refuses a home that is a file, before it asks anything', async () => {
    const home = join(await newHome(), 'stack.yaml');
    await writeFile(home, 'version: 1\n');
    const term = capture([]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(1);
    expect(term.questions).toEqual([]);
    expect(term.stderr()).toBe(
      `error: ${home} is not a folder, so init can't put the Mediaplane home there: pass --home <a folder of yours>\n`,
    );
  });

  it('refuses --vpn-addresses without a provider as soon as the provider is answered', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '']);
    const args = ['init', '--home', home, '--vpn-addresses', '10.64.0.2/32'];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.questions).toHaveLength(3);
    expect(term.stderr()).toBe('error: --vpn-addresses needs --vpn-provider\n');
  });

  it('refuses a --lan-subnet that plan would reject when the LAN is chosen on the terminal', async () => {
    const home = await newHome();
    const term = capture(['jellyfin', '/srv/data', '', 'lan']);
    const args = ['init', '--home', home, '--lan-subnet', '10.10.0.0/16'];
    expect(await run(args, term.io, deps())).toBe(1);
    // A flag is not asked again, so init stops at the answer that makes it matter.
    expect(term.questions).toHaveLength(4);
    expect(term.stderr()).toContain(
      'network.bind is "lan", but none of this host\'s private addresses (192.168.1.10) is inside 10.10.0.0/16',
    );
    await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
  });

  it('takes a --lan-subnet that plan would reject when the web UIs stay on localhost', async () => {
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
    const flags = [...args, '--bind', 'localhost', '--lan-subnet', '10.10.0.0/16'];
    expect(await run(flags, capture().io, deps())).toBe(0);
    expect((await stackIn(home)).network).toEqual({
      bind: 'localhost',
      lan_subnet: '10.10.0.0/16',
    });
  });

  it('asks again for what you typed that is not right, naming the question and not a flag', async () => {
    const home = await newHome();
    const term = capture([
      'emby',
      'PLEX',
      'relative/path',
      '/srv/media',
      '',
      'everywhere',
      'LAN',
      'y',
      '',
      'ad',
      'media-admin',
      'n',
      '/etc/fake-password',
      'stack.yaml',
      'secrets/',
      'secrets/my-password',
    ]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.questions).toEqual([
      'Media server, jellyfin or plex [jellyfin]: ',
      'Media server, jellyfin or plex [jellyfin]: ',
      'Data folder for downloads and media [/srv/data]: ',
      'Data folder for downloads and media [/srv/data]: ',
      'VPN provider for qBittorrent, e.g. mullvad (empty for none): ',
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
      'Your LAN looks like 192.168.1.0/24. Use it? [Y/n] ',
      'Ask for a login from your own network too? [Y/n] ',
      'Admin user name for the apps [admin]: ',
      'Admin user name for the apps [admin]: ',
      'Generate the admin password? [Y/n] ',
      'File holding your password, inside the Mediaplane home [secrets/admin-password]: ',
      'File holding your password, inside the Mediaplane home [secrets/admin-password]: ',
      'File holding your password, inside the Mediaplane home [secrets/admin-password]: ',
      'File holding your password, inside the Mediaplane home [secrets/admin-password]: ',
    ]);
    expect(term.stderr()).toBe(
      [
        'Please answer jellyfin or plex.',
        'That must be an absolute path (start with /).',
        'Please answer lan or localhost.',
        'That must be 3 to 32 letters, digits, ".", "_" or "-".',
        'That must be a path inside the Mediaplane home, such as secrets/admin-password.',
        'That must not be stack.yaml, which holds the stack itself.',
        'That must be a path inside the Mediaplane home, such as secrets/admin-password.',
        '',
      ].join('\n'),
    );
    expect(term.stderr()).not.toContain('--');
    expect(await stackIn(home)).toMatchObject({
      media_server: 'plex',
      paths: { data: '/srv/media' },
      network: { bind: 'lan', lan_subnet: '192.168.1.0/24' },
      admin: { username: 'media-admin', password: { file: 'secrets/my-password' } },
    });
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

describe('mediaplane init: what each question is for', () => {
  /** Every answer for a VPN stack on the LAN, with your own password file. */
  const EVERY_QUESTION = [
    'plex',
    '/srv/data',
    'mullvad',
    '',
    'lan',
    'y',
    'y',
    'admin',
    'n',
    '',
  ];

  it('says what each question is for, just before it, in lines of 60 columns at most', async () => {
    const term = capture([...EVERY_QUESTION]);
    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(0);
    const shown = term.shown();
    const before = (note: readonly string[], question: string) => {
      expect(shown).toContain(`${note.join('\n')}\n${question}`);
    };
    before(NOTES.mediaServer, 'Media server, jellyfin or plex [jellyfin]: ');
    before(NOTES.dataPath, 'Data folder for downloads and media [/srv/data]: ');
    before(NOTES.vpnProvider, 'VPN provider for qBittorrent');
    before(NOTES.vpnAddresses, "Your provider's WireGuard address");
    before(NOTES.wireguardKey, 'Paste your WireGuard private key');
    before(NOTES.bind, 'Publish the web UIs on your LAN');
    before(NOTES.lanSubnet, 'Your LAN looks like 192.168.1.0/24. Use it? [Y/n] ');
    before(NOTES.loginOnLan, 'Ask for a login from your own network too? [Y/n] ');
    before(NOTES.adminUser, 'Admin user name for the apps [admin]: ');
    before(NOTES.adminPassword, 'Generate the admin password? [Y/n] ');
    before(NOTES.passwordFile, 'File holding your password, inside the Mediaplane home');
    for (const line of Object.values(NOTES).flat()) {
      expect(line.length, line).toBeLessThanOrEqual(60);
    }
  });

  it('says it once, not again after an answer that will not do', async () => {
    const term = capture(['emby', 'jellyfin', '/srv/data', '', 'localhost', '', '']);
    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(0);
    expect(term.shown().split(NOTES.mediaServer[0]).length - 1).toBe(1);
    expect(term.questions.slice(0, 2)).toEqual([
      'Media server, jellyfin or plex [jellyfin]: ',
      'Media server, jellyfin or plex [jellyfin]: ',
    ]);
  });

  it('says nothing about questions it does not ask: none without a terminal or with --json', async () => {
    const flags = ['--media-server', 'jellyfin', '--data', '/srv/data'];
    for (const extra of [[], ['--json']]) {
      const term = capture(extra.length === 0 ? undefined : []);
      const args = ['init', '--home', await newHome(), ...flags, ...extra];
      expect(await run(args, term.io, deps())).toBe(0);
      for (const line of Object.values(NOTES).flat()) {
        expect(term.shown()).not.toContain(line);
      }
    }
  });
});

describe('mediaplane init: the WireGuard key', () => {
  const FAKE_KEY = `${'A'.repeat(43)}=`;
  const PASTE =
    'Paste your WireGuard private key (nothing shows as you paste; Enter to do it later): ';
  /** Jellyfin, /srv/data, a provider, no address, localhost, the admin, generated. */
  const VPN_ANSWERS = ['jellyfin', '/srv/data', 'mullvad', '', 'localhost', '', ''];

  it('takes the key pasted on a hidden prompt, and keeps it in secrets/wg.key for you only', async () => {
    const home = await newHome();
    const term = capture([...VPN_ANSWERS], {}, [`  ${FAKE_KEY}  `]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.hidden).toEqual([PASTE]);
    const keyPath = join(home, 'secrets', 'wg.key');
    expect(await readFile(keyPath, 'utf8')).toBe(`${FAKE_KEY}\n`);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect((await stackIn(home)).vpn?.private_key).toEqual({ file: 'secrets/wg.key' });
    expect(term.stdout()).toContain(`Saved your WireGuard private key in ${keyPath}.`);
    expect(term.stdout()).not.toContain('Put your VPN');
    expect(term.shown()).not.toContain(FAKE_KEY);
  });

  it('asks again for what is not a key, without repeating it', async () => {
    const home = await newHome();
    const notKeys = ['not-a-fake-key', `${'A'.repeat(42)}==`, 'A'.repeat(44)];
    const term = capture([...VPN_ANSWERS], {}, [...notKeys, FAKE_KEY]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.hidden).toEqual([PASTE, PASTE, PASTE, PASTE]);
    expect(term.stderr()).toBe(
      'That is not a WireGuard private key, which is 44 characters of base64 ending in "=". Paste it again, or press Enter to do it later.\n'.repeat(
        3,
      ),
    );
    for (const typed of notKeys) expect(term.shown()).not.toContain(typed);
    expect(await readFile(join(home, 'secrets', 'wg.key'), 'utf8')).toBe(`${FAKE_KEY}\n`);
  });

  it('leaves it for later on Enter, as a next step', async () => {
    const home = await newHome();
    const term = capture([...VPN_ANSWERS], {}, ['']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.hidden).toEqual([PASTE]);
    await expect(stat(join(home, 'secrets', 'wg.key'))).rejects.toThrow();
    expect(term.stdout()).toContain(
      `Put your VPN's WireGuard private key in ${join(home, 'secrets', 'wg.key')}.`,
    );
  });

  it('never asks for one you already have, and never overwrites it', async () => {
    const home = await newHome();
    await real.mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-key-of-yours\n');
    const term = capture([...VPN_ANSWERS], {}, [FAKE_KEY]);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    expect(term.hidden).toEqual([]);
    expect(await readFile(join(home, 'secrets', 'wg.key'), 'utf8')).toBe(
      'fake-key-of-yours\n',
    );
  });

  it('never asks without a VPN, without a terminal, or with --json', async () => {
    const none = capture(['jellyfin', '/srv/data', '', 'localhost', '', ''], {}, [
      FAKE_KEY,
    ]);
    expect(await run(['init', '--home', await newHome()], none.io, deps())).toBe(0);
    expect(none.hidden).toEqual([]);
    const flags = ['--media-server', 'jellyfin', '--data', '/srv/data'];
    const vpn = ['--vpn-provider', 'mullvad'];
    const json = capture([], {}, [FAKE_KEY]);
    const args = ['init', '--home', await newHome(), ...flags, ...vpn, '--json'];
    expect(await run(args, json.io, deps())).toBe(0);
    expect(json.hidden).toEqual([]);
    const script = capture(undefined);
    expect(
      await run(['init', '--home', await newHome(), ...flags, ...vpn], script.io, deps()),
    ).toBe(0);
    expect(script.stdout()).toContain("Put your VPN's WireGuard private key in");
  });
});

describe('mediaplane init: the data folder', () => {
  const FLAGS = ['--media-server', 'jellyfin', '--data', '/srv/data'];
  const { uid, gid } = invokingUser();
  const who = `uid ${String(uid)} (gid ${String(gid)})`;

  it('creates it when it can, and needs no step for it then', async () => {
    const home = await newHome();
    const folders: string[] = [];
    const term = capture();
    const args = ['init', '--home', home, ...FLAGS];
    expect(await run(args, term.io, deps(undefined, 'created', folders))).toBe(0);
    expect(folders).toEqual(['/srv/data']);
    expect(term.stdout()).toContain('Created /srv/data for your downloads and media.');
    expect(term.stdout()).not.toContain('/srv/data and make sure');
  });

  it("gives the commands to create it when it can't", async () => {
    const term = capture();
    const args = ['init', '--home', await newHome(), ...FLAGS];
    const blocked = { blocked: 'permission denied' };
    expect(await run(args, term.io, deps(undefined, blocked))).toBe(0);
    expect(term.stdout()).toContain(
      `Create /srv/data (permission denied), for ${who}: sudo mkdir -p /srv/data && sudo chown ${String(uid)}:${String(gid)} /srv/data`,
    );
  });

  it('says to check a folder it found but can not vouch for, and nothing for a ready one', async () => {
    const args = async () => ['init', '--home', await newHome(), ...FLAGS];
    const check = capture();
    expect(await run(await args(), check.io, deps(undefined, 'check'))).toBe(0);
    expect(check.stdout()).toContain(`Make sure ${who} can write to /srv/data.`);
    const ready = capture();
    expect(await run(await args(), ready.io, deps(undefined, 'ready'))).toBe(0);
    expect(ready.stdout()).not.toContain('/srv/data');
  });
});
