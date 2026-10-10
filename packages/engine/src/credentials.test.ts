import { mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppDefinition, Catalog } from './catalog/types';
import { credentials, type CredentialsOptions } from './credentials';
import type { HostFacts } from './host/facts';
import { SECRETS_PATH } from './paths';
import { HelperError, RuntimeError, type Runtime } from './runtime/types';
import { fakeRuntime } from './testing/fakes';
import { FIXTURE_HOST, fixtureCatalog } from './testing/fixtures';
import { tempDir } from './testing/temp';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

/** qBittorrent has the shared login, Sonarr's is to come, and Jellyfin says nothing. */
const LOGINS: Record<string, AppDefinition['login']> = {
  qbittorrent: 'shared',
  sonarr: { comingIn: 'Slice 3b' },
};
/** Sonarr also publishes a second port, which is not its web UI. */
const EXTRA_PORT = { name: 'rpc', container: 8990 };
const CATALOG: Catalog = fixtureCatalog.map((app) => ({
  ...app,
  login: LOGINS[app.id],
  ports: app.id === 'sonarr' ? [...app.ports, EXTRA_PORT] : app.ports,
}));

/** A home with `stack`, and, when `stored`, a generated admin password in the store. */
async function homeWith({ stack = STACK, stored = true } = {}): Promise<string> {
  const home = await tempDir('mediaplane-credentials-');
  await writeFile(join(home, 'stack.yaml'), stack);
  if (stored) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, SECRETS_PATH),
      JSON.stringify({
        version: 1,
        apps: {},
        shared: { adminPassword: 'fake-admin-password' },
      }),
    );
  }
  return home;
}

const loginFor = (
  home: string,
  {
    host = FIXTURE_HOST,
    env = {},
    runtime = fakeRuntime(),
  }: {
    host?: CredentialsOptions['host'];
    env?: NodeJS.ProcessEnv;
    runtime?: Runtime;
  } = {},
) => credentials({ home, catalog: CATALOG, host, env, runtime });

/** The host with two private addresses, given out of order. */
const TWO_LANS: HostFacts = {
  arch: 'amd64',
  privateAddresses: [
    { address: '192.168.1.20', cidr: '192.168.1.20/24' },
    { address: '10.0.0.5', cidr: '10.0.0.5/8' },
  ],
};

/** Every file and folder under `home`, with its size and modification time. */
async function snapshot(home: string): Promise<Record<string, string>> {
  const entries = await readdir(home, { recursive: true });
  return Object.fromEntries(
    await Promise.all(
      entries.map(async (entry): Promise<[string, string]> => {
        const info = await stat(join(home, entry));
        return [
          entry,
          `${info.isDirectory() ? 'dir' : String(info.size)} ${info.mtimeMs}`,
        ];
      }),
    ),
  );
}

/** Dates every file and folder long ago, so any write would show in a snapshot. */
async function ageEverything(home: string): Promise<void> {
  const longAgo = new Date('2020-01-01T00:00:00Z');
  for (const entry of await readdir(home, { recursive: true })) {
    await utimes(join(home, entry), longAgo, longAgo);
  }
}

const YOURS = STACK.replace(
  'apps:',
  'admin: { username: media-admin, password: { file: secrets/admin-password } }\napps:',
);

describe('credentials', () => {
  it('gives the shared login, and where each app with a login is published', async () => {
    expect(await loginFor(await homeWith())).toEqual({
      ok: true,
      username: 'admin',
      password: 'fake-admin-password',
      source: { kind: 'generated' },
      apps: [
        {
          app: 'qbittorrent',
          name: 'qbittorrent',
          urls: ['http://127.0.0.1:8080'],
          login: 'shared',
        },
        {
          app: 'sonarr',
          name: 'sonarr',
          urls: ['http://127.0.0.1:8989'],
          login: 'not-yet',
          comingIn: 'Slice 3b',
        },
      ],
    });
  });

  it("names this host's addresses when the web UIs are on every interface", async () => {
    const home = await homeWith({ stack: STACK.replace('bind: localhost', 'bind: all') });
    const result = await loginFor(home);
    expect(result.ok && result.apps[0]?.urls).toEqual([
      'http://127.0.0.1:8080',
      'http://192.168.1.10:8080',
    ]);
  });

  it('uses your own password, and says which file it comes from', async () => {
    const home = await homeWith({ stack: YOURS, stored: false });
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-own-password\n');
    expect(await loginFor(home)).toMatchObject({
      ok: true,
      username: 'media-admin',
      password: 'fake-own-password',
      source: { kind: 'yours', ref: 'secrets/admin-password' },
    });
  });

  it('names the environment variable your password comes from', async () => {
    const stack = STACK.replace(
      'apps:',
      'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:',
    );
    const home = await homeWith({ stack, stored: false });
    expect(
      await loginFor(home, { env: { FAKE_ADMIN_PASSWORD: 'fake-own-password' } }),
    ).toMatchObject({
      ok: true,
      source: { kind: 'yours', ref: 'the environment variable FAKE_ADMIN_PASSWORD' },
    });
  });

  it('says to run apply first while no password has been generated', async () => {
    expect(await loginFor(await homeWith({ stored: false }))).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'credentials.not-yet',
          message: 'the admin password has not been generated yet',
          hint: 'run "mediaplane apply": it generates the password before it starts any app',
        },
      ],
    });
  });

  it('reports your password file when it is missing or too short', async () => {
    const home = await homeWith({ stack: YOURS, stored: false });
    expect(await loginFor(home)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'secret.missing', path: 'admin.password' }],
    });
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-short\n');
    expect(await loginFor(home)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'admin.password-too-short' }],
    });
  });

  it('shows the login even when another secret, such as the VPN key, is missing', async () => {
    const stack = STACK.replace(
      'apps:',
      'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\napps:',
    );
    expect((await loginFor(await homeWith({ stack }))).ok).toBe(true);
  });

  it('reports a missing stack.yaml, or one that does not resolve', async () => {
    expect(await loginFor(await tempDir('mediaplane-credentials-'))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'config.missing' }],
    });
    const home = await homeWith({ stack: STACK.replace('sonarr: {}', 'sonar: {}') });
    expect(await loginFor(home)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'app.unknown' }],
    });
  });

  it('asks for the host facts only once it needs them', async () => {
    const host = vi.fn(() => Promise.resolve(FIXTURE_HOST));
    await loginFor(await homeWith({ stored: false }), { host });
    expect(host).not.toHaveBeenCalled();
    await loginFor(await homeWith(), { host });
    expect(host).toHaveBeenCalledTimes(1);
  });

  it('lists the web port only, not the other ports an app publishes', async () => {
    const result = await loginFor(await homeWith());
    expect(result.ok && result.apps.map((a) => [a.app, a.urls])).toEqual([
      ['qbittorrent', ['http://127.0.0.1:8080']],
      ['sonarr', ['http://127.0.0.1:8989']],
    ]);
  });

  it('names only the addresses of the LAN, sorted, when the web UIs are on it', async () => {
    const home = await homeWith({ stack: STACK.replace('bind: localhost', 'bind: lan') });
    const result = await loginFor(home, { host: TWO_LANS });
    expect(result.ok && result.apps[0]?.urls).toEqual([
      'http://10.0.0.5:8080',
      'http://192.168.1.20:8080',
    ]);
    // With a LAN subnet, only the addresses inside it.
    const subnet = STACK.replace(
      'bind: localhost',
      'bind: lan, lan_subnet: 192.168.1.0/24',
    );
    const inSubnet = await loginFor(await homeWith({ stack: subnet }), {
      host: TWO_LANS,
    });
    expect(inSubnet.ok && inSubnet.apps[0]?.urls).toEqual(['http://192.168.1.20:8080']);
  });

  it('puts localhost first, then the sorted addresses, on every interface', async () => {
    const home = await homeWith({ stack: STACK.replace('bind: localhost', 'bind: all') });
    const result = await loginFor(home, { host: TWO_LANS });
    expect(result.ok && result.apps[0]?.urls).toEqual([
      'http://127.0.0.1:8080',
      'http://10.0.0.5:8080',
      'http://192.168.1.20:8080',
    ]);
  });

  describe('when the host facts cannot be had', () => {
    const failing = (cause: Error) => () => Promise.reject(cause);

    it('explains a host helper that cannot run, as plan does', async () => {
      const result = await loginFor(await homeWith(), {
        host: failing(new HelperError('the host helper failed: no such image')),
      });
      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'host.helper-failed',
            message: 'the host helper failed: no such image',
            hint: expect.stringContaining('MEDIAPLANE_IMAGE') as unknown,
          },
        ],
      });
    });

    it('passes on the hint a host helper error carries', async () => {
      const cause = new HelperError('the host helper did not finish within 60 s', {
        hint: 'fake: check the network shares',
      });
      expect(await loginFor(await homeWith(), { host: failing(cause) })).toMatchObject({
        ok: false,
        diagnostics: [
          { code: 'host.helper-failed', hint: 'fake: check the network shares' },
        ],
      });
    });

    it('explains a Docker that cannot be reached, whether it or the helper failed', async () => {
      const unreachable = fakeRuntime({ unavailable: 'cannot talk to Docker: refused' });
      const expected = {
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'docker.unavailable',
            message: 'cannot talk to Docker: refused',
            hint: expect.stringContaining('docker ps') as unknown,
          },
        ],
      };
      expect(
        await loginFor(await homeWith(), {
          host: failing(new RuntimeError('cannot talk to Docker: refused')),
          runtime: unreachable,
        }),
      ).toEqual(expected);
      // The helper is a docker run: when Docker is down, that is the error to explain.
      expect(
        await loginFor(await homeWith(), {
          host: failing(new HelperError('the host helper failed: docker is down')),
          runtime: unreachable,
        }),
      ).toEqual(expected);
    });

    it('points to the socket proxy when Mediaplane reaches Docker through it', async () => {
      const result = await loginFor(await homeWith(), {
        host: failing(new RuntimeError('cannot talk to Docker: refused')),
        env: {
          MEDIAPLANE_IMAGE: 'mediaplane:test',
          DOCKER_HOST: 'tcp://socket-proxy:2375',
        },
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: 'docker.unavailable',
            hint: expect.stringContaining('socket-proxy') as unknown,
          },
        ],
      });
    });

    it('lets a bug through rather than blaming Docker', async () => {
      const bug = new TypeError('fake: a bug, not the helper');
      await expect(loginFor(await homeWith(), { host: failing(bug) })).rejects.toBe(bug);
    });
  });

  it('writes nothing: no file, lock or secret appears or changes, found or not', async () => {
    const stored = await homeWith();
    const notYet = await homeWith({ stored: false });
    for (const home of [stored, notYet]) {
      await ageEverything(home);
      const before = await snapshot(home);
      await loginFor(home);
      const after = await snapshot(home);
      expect(after).toEqual(before);
      expect(Object.keys(after)).not.toContain('state/lock');
    }
    // No password yet: the state folder is not even created.
    expect(Object.keys(await snapshot(notYet))).toEqual(['stack.yaml']);
  });
});
