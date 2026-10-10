import { describe, expect, it } from 'vitest';
import type { AppDefinition, Catalog } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import type { SecretStore } from '../secrets/store';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { prestartFilesFor, renderPrestartFiles } from './prestart';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

const STORE: SecretStore = {
  version: 1,
  apps: { sonarr: { apiKey: 'fake-sonarr-key' } },
};
const ADMIN = { username: 'media-admin', password: 'fake-admin-password' };
const sevens = (size: number) => Buffer.alloc(size, 7);

/** Sonarr writes one file, from everything a renderer is given. */
const configFiles: AppDefinition['configFiles'] = (ctx) => [
  {
    path: 'config/app.ini',
    content: [
      `key=${ctx.secret('apiKey')}`,
      `user=${ctx.admin.username}:${ctx.admin.password}`,
      `salt=${ctx.random(2).toString('hex')}`,
      `lan=${String(ctx.publishesOnLan)}`,
      '',
    ].join('\n'),
    seeded: /^key=/m,
  },
];

const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr' ? { ...app, configFiles } : app,
);

/** Sonarr with one pre-start file at `path`, relative to its appdata folder. */
function filesAt(path: string): Catalog {
  return fixtureCatalog.map((app) =>
    app.id === 'sonarr'
      ? { ...app, configFiles: () => [{ path, content: 'x', seeded: /x/ }] }
      : app,
  );
}

function stackWith(catalog: Catalog): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(STACK),
    catalog,
    FIXTURE_HOST,
    '/opt/mediaplane',
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

describe('renderPrestartFiles', () => {
  it("puts each file in its app's appdata folder, from its keys and the admin login", () => {
    expect(renderPrestartFiles(stackWith(WITH_FILES), STORE, ADMIN, sevens)).toEqual([
      {
        app: 'sonarr',
        appName: 'sonarr',
        path: 'appdata/sonarr/config/app.ini',
        content:
          'key=fake-sonarr-key\nuser=media-admin:fake-admin-password\nsalt=0707\nlan=false\n',
        seeded: /^key=/m,
      },
    ]);
  });

  it('renders nothing for apps without pre-start files', () => {
    expect(renderPrestartFiles(stackWith(fixtureCatalog), STORE, ADMIN, sevens)).toEqual(
      [],
    );
  });

  it('normalises a path that stays inside the app folder', () => {
    const [file] = renderPrestartFiles(
      stackWith(filesAt('config/../app.ini')),
      STORE,
      ADMIN,
      sevens,
    );
    expect(file?.path).toBe('appdata/sonarr/app.ini');
  });

  it.each(['../escape.txt', 'config/../../escape.txt', '/etc/passwd', '..', '.', ''])(
    'refuses a file that would land outside the app folder: "%s"',
    (path) => {
      expect(() =>
        renderPrestartFiles(stackWith(filesAt(path)), STORE, ADMIN, sevens),
      ).toThrow(`sonarr: the pre-start file "${path}" is not inside its appdata folder`);
    },
  );

  it('refuses to render a file before its key exists', () => {
    expect(() =>
      renderPrestartFiles(stackWith(WITH_FILES), { version: 1, apps: {} }, ADMIN, sevens),
    ).toThrow('sonarr.apiKey has not been generated yet');
  });
});

describe('prestartFilesFor', () => {
  it('renders the files with the shared admin login from the store', async () => {
    const store: SecretStore = { ...STORE, shared: { adminPassword: 'fake-generated' } };
    const [file] = await prestartFilesFor(stackWith(WITH_FILES), store, {}, sevens);
    expect(file?.content).toBe(
      'key=fake-sonarr-key\nuser=admin:fake-generated\nsalt=0707\nlan=false\n',
    );
  });

  it('throws while there is no admin password yet', async () => {
    await expect(
      prestartFilesFor(stackWith(WITH_FILES), STORE, {}, sevens),
    ).rejects.toThrow('the admin password is not available yet');
  });
});
