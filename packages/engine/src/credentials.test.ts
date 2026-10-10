import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppDefinition, Catalog } from './catalog/types';
import { credentials } from './credentials';
import type { HostFacts } from './host/facts';
import { SECRETS_PATH } from './paths';
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
const CATALOG: Catalog = fixtureCatalog.map((app) => ({ ...app, login: LOGINS[app.id] }));

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
  { host = FIXTURE_HOST, env = {} }: { host?: HostFacts; env?: NodeJS.ProcessEnv } = {},
) => credentials({ home, catalog: CATALOG, host, env });

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
    await credentials({
      home: await homeWith({ stored: false }),
      catalog: CATALOG,
      host,
      env: {},
    });
    expect(host).not.toHaveBeenCalled();
    await credentials({ home: await homeWith(), catalog: CATALOG, host, env: {} });
    expect(host).toHaveBeenCalledTimes(1);
  });
});
