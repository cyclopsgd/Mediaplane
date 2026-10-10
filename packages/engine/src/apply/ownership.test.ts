import { chmod, mkdir, readdir, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../catalog/types';
import type { PathStat } from '../preflight/probe';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeProbe } from '../testing/fakes';
import {
  FIXTURE_HOST,
  fixtureApp,
  fixtureCatalog,
  fixtureConfig,
} from '../testing/fixtures';
import {
  AppdataNotPrivateError,
  APPDATA_NOT_PRIVATE_HINT,
  ensureAppdataDirs,
  keepAppdataPrivate,
  ownershipFixes,
  requiredOwner,
} from './ownership';
import { tempDir } from '../testing/temp';

const CATALOG: Catalog = [
  ...fixtureCatalog,
  fixtureApp({
    id: 'requests',
    category: 'requests',
    runAs: 'fixed:2000',
    volumes: { appdata: '/app/config' },
  }),
  fixtureApp({
    id: 'solver',
    category: 'indexer',
    runAs: 'user-directive',
    volumes: { appdata: '/data' },
  }),
];

function stackIn(home: string): ResolvedStack {
  const source = `version: 1
user: { uid: 1500, gid: 1600 }
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  requests: {}
  solver: {}
`;
  const result = resolveStack(fixtureConfig(source), CATALOG, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const owned = (uid: number, gid: number): PathStat => ({
  isDirectory: true,
  isCharacterDevice: false,
  uid,
  gid,
  mode: 0o40755,
  dev: 1,
  ino: 1,
});

describe('requiredOwner', () => {
  it('is fixed:N, the stack user for user-directive, and nothing otherwise', () => {
    const stack = stackIn('/opt/mediaplane');
    const owner = (id: string) => {
      const app = stack.apps.find((a) => a.def.id === id);
      if (app === undefined) throw new Error(`no ${id}`);
      return requiredOwner(app, stack);
    };
    expect(owner('requests')).toEqual({ uid: 2000, gid: 2000 });
    expect(owner('solver')).toEqual({ uid: 1500, gid: 1600 });
    expect(owner('jellyfin')).toBeUndefined();
  });
});

describe('ownershipFixes', () => {
  it('lists folders that are missing or owned by someone else', async () => {
    const stack = stackIn('/opt/mediaplane');
    const probe = fakeProbe({
      stats: {
        '/opt/mediaplane/appdata/requests': undefined,
        '/opt/mediaplane/appdata/solver': owned(1002, 1002),
      },
    });
    expect(await ownershipFixes(stack, probe)).toEqual([
      {
        service: 'requests',
        hostPath: '/opt/mediaplane/appdata/requests',
        containerPath: '/app/config',
        uid: 2000,
        gid: 2000,
      },
      {
        service: 'solver',
        hostPath: '/opt/mediaplane/appdata/solver',
        containerPath: '/data',
        uid: 1500,
        gid: 1600,
      },
    ]);
  });

  it('is empty when every folder already has the right owner', async () => {
    const stack = stackIn('/opt/mediaplane');
    const probe = fakeProbe({
      stats: {
        '/opt/mediaplane/appdata/requests': owned(2000, 2000),
        '/opt/mediaplane/appdata/solver': owned(1500, 1600),
      },
    });
    expect(await ownershipFixes(stack, probe)).toEqual([]);
  });
});

describe('ensureAppdataDirs', () => {
  it("creates every app's appdata folder", async () => {
    const home = await tempDir('mediaplane-ownership-');
    await ensureAppdataDirs(stackIn(home));
    expect((await readdir(join(home, 'appdata'))).sort()).toEqual([
      'jellyfin',
      'requests',
      'solver',
    ]);
  });

  it('keeps appdata/ itself private, new or not, and leaves the app folders alone', async () => {
    const modeOf = async (path: string) => (await stat(path)).mode & 0o777;
    const fresh = await tempDir('mediaplane-ownership-');
    await ensureAppdataDirs(stackIn(fresh));
    expect(await modeOf(join(fresh, 'appdata'))).toBe(0o700);

    // An appdata/ from before, open to every local user, with an app folder in it.
    const home = await tempDir('mediaplane-ownership-');
    await mkdir(join(home, 'appdata', 'jellyfin'), { recursive: true });
    await chmod(join(home, 'appdata'), 0o755);
    await chmod(join(home, 'appdata', 'jellyfin'), 0o755);
    await ensureAppdataDirs(stackIn(home));
    expect(await modeOf(join(home, 'appdata'))).toBe(0o700);
    expect(await modeOf(join(home, 'appdata', 'jellyfin'))).toBe(0o755);
  });
});

describe('keepAppdataPrivate', () => {
  it('leaves a missing appdata/ missing', async () => {
    const home = await tempDir('mediaplane-ownership-');
    await keepAppdataPrivate(home);
    expect(await readdir(home)).toEqual([]);
  });

  it('passes on an error that is not about the owner', async () => {
    const home = await tempDir('mediaplane-ownership-');
    // A link to itself: chmod can't reach a folder at all.
    await symlink('appdata', join(home, 'appdata'));
    await expect(keepAppdataPrivate(home)).rejects.toThrow('ELOOP');
  });
});

describe('AppdataNotPrivateError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the uid that owns the folder and the uid Mediaplane runs as', () => {
    vi.spyOn(process, 'geteuid').mockReturnValue(1000);
    const failure = new AppdataNotPrivateError('/opt/mediaplane/appdata', 'EPERM', 4242);
    expect(failure.message).toBe(
      'cannot make /opt/mediaplane/appdata private (EPERM): it belongs to uid 4242, not to the user Mediaplane runs as (uid 1000)',
    );
    expect(failure.hint).toBe(APPDATA_NOT_PRIVATE_HINT);
    expect(failure.cause).toBe('EPERM');
  });

  it('leaves out its own uid where the platform has no user ids', () => {
    vi.spyOn(process, 'geteuid').mockReturnValue(undefined as unknown as number);
    expect(
      new AppdataNotPrivateError('/opt/mediaplane/appdata', 'EPERM', 4242).message,
    ).toBe(
      'cannot make /opt/mediaplane/appdata private (EPERM): it belongs to uid 4242, not to the user Mediaplane runs as',
    );
  });

  it('says another user when it could not find out who owns the folder', () => {
    expect(new AppdataNotPrivateError('/opt/mediaplane/appdata', 'EPERM').message).toBe(
      'cannot make /opt/mediaplane/appdata private (EPERM): it belongs to another user',
    );
  });
});
