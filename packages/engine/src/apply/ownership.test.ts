import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
import { ensureAppdataDirs, ownershipFixes, requiredOwner } from './ownership';

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
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-ownership-'));
    await ensureAppdataDirs(stackIn(home));
    expect((await readdir(join(home, 'appdata'))).sort()).toEqual([
      'jellyfin',
      'requests',
      'solver',
    ]);
  });
});
