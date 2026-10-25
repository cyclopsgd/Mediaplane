import { readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog/types';
import { readResources, writeResources } from './integrations/resources';
import type { ResourceSpec } from './integrations/types';
import { keep } from './keep';
import { LOCK_PATH, RESOURCES_PATH } from './paths';
import { plan } from './plan/plan';
import type { Runtime } from './runtime/types';
import { fakeProbe, fakeRuntime } from './testing/fakes';
import { FIXTURE_HOST } from './testing/fixtures';
import { wiredHome, wiredRuntime } from './testing/home';
import { tempDir } from './testing/temp';
import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from './testing/wiring';

/** A stack.yaml written by hand: comments, a blank line and spacing keep must keep. */
const STACK = `# My media stack.
version: 1
paths: { data: /srv/data }      # the disk
network: { bind: localhost }
media_server: jellyfin

apps:
  sonarr: {}                    # TV
  qbittorrent: { vpn: false }
`;
const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';
const AT = new Date('2026-10-20T08:00:00.000Z');
const RECORD = {
  id: null,
  name: 'login',
  fields: { user: 'admin' },
  secrets: ['password'],
  appliedAt: '2026-10-10T12:00:00.000Z',
};

function home(stack = STACK): Promise<string> {
  return wiredHome({
    prefix: 'mediaplane-keep-',
    stack,
    key: KEY,
    password: PASSWORD,
    known: { 'sonarr.login': RECORD },
  });
}

const runtimeFor = wiredRuntime;

type Fake = Awaited<ReturnType<typeof fakeSonarr>>;

function options(
  dir: string,
  fake: Fake,
  path: string,
  extra: { catalog?: Catalog; runtime?: Runtime } = {},
) {
  return {
    home: dir,
    catalog: extra.catalog ?? WIRED_CATALOG,
    host: FIXTURE_HOST,
    env: {},
    runtime: extra.runtime ?? runtimeFor(fake.addresses),
    probe: fakeProbe(),
    wiring: fake.seams,
    path,
    now: () => AT,
  };
}

const codes = (result: { diagnostics: { code: string }[] }) =>
  result.diagnostics.map((d) => d.code);

describe('keep', () => {
  it('writes what the app holds as an override, keeping the rest of stack.yaml, and records it as applied', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.login.user'));
    expect(kept).toEqual({
      ok: true,
      key: 'sonarr.login.user',
      value: 'someone',
      diagnostics: [],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}overrides:\n  sonarr.login.user: someone\n`,
    );
    expect((await readResources(dir))['sonarr.login']?.fields).toEqual({
      user: 'someone',
    });
    // It signed in to nothing: keep checks no secret.
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
    // Nothing for apply to do, and nothing changed outside Mediaplane.
    // As drift asks the apps (plan would check them after the start: their hashes differ).
    const after = await plan({ ...options(dir, sonarr, ''), drift: { now: () => AT } });
    expect(after.wiring).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
    expect(after.drift).toEqual([]);
    await expect(readFile(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it('asks the app nothing but to read the resource: what only the app can say is what was applied', async () => {
    const dir = await home();
    const asked: string[] = [];
    // A login whose profile only the app can say, through its own test (as Seerr's).
    const profiled: ResourceSpec = {
      ...FAKE_LOGIN,
      fields: ['user', 'profile'],
      resolve: (_api, desired) => {
        asked.push('resolve');
        return Promise.resolve({
          ...desired,
          fields: { ...desired.fields, profile: 'HD' },
        });
      },
      observe: () =>
        Promise.resolve({
          id: null,
          name: 'login',
          fields: { user: 'someone', profile: 'Any' },
        }),
    };
    await writeResources(dir, {
      'sonarr.login': { ...RECORD, fields: { user: 'admin', profile: 'HD' } },
    });
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [profiled] } }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.login.profile', { catalog }));
    expect([kept.ok, kept.value]).toEqual([true, 'Any']);
    expect(asked).toEqual([]);
  });

  it('stops managing a resource deleted outside Mediaplane, and forgets its record', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY });
    const kept = await keep(options(dir, sonarr, 'sonarr.login'));
    expect(kept).toMatchObject({ ok: true, value: 'unmanaged' });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}overrides:\n  sonarr.login: unmanaged\n`,
    );
    expect(await readResources(dir)).toEqual({});
    // As drift asks the apps (plan would check them after the start: their hashes differ).
    const after = await plan({ ...options(dir, sonarr, ''), drift: { now: () => AT } });
    expect(after.wiring).toEqual([{ resource: 'sonarr', action: 'unchanged' }]);
    // Kept already: refused, saying so.
    expect(codes(await keep(options(dir, sonarr, 'sonarr.login')))).toEqual([
      'keep.unmanaged',
    ]);
  });

  it('stops managing a resource left in the app that the stack no longer wants', async () => {
    const gone: ResourceSpec = { ...FAKE_LOGIN, name: 'gone', desired: () => undefined };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [FAKE_LOGIN, gone] } }
        : def,
    );
    const dir = await home();
    await writeResources(dir, {
      'sonarr.login': RECORD,
      'sonarr.gone': { ...RECORD, name: 'gone' },
    });
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.gone', { catalog }));
    expect(kept).toMatchObject({ ok: true, value: 'unmanaged', diagnostics: [] });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}overrides:\n  sonarr.gone: unmanaged\n`,
    );
    expect(Object.keys(await readResources(dir))).toEqual(['sonarr.login']);
    const after = await plan({
      ...options(dir, sonarr, '', { catalog }),
      drift: { now: () => AT },
    });
    expect([after.ok, after.drift, after.diagnostics]).toEqual([true, [], []]);
  });

  it("keeps nothing that hasn't drifted, or that it couldn't look at, and says so", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const same = await keep(options(dir, sonarr, 'sonarr.login.user'));
    expect(same).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'keep.no-drift',
          message:
            'sonarr.login.user has not changed outside Mediaplane: sonarr holds what Mediaplane applied, or the stack now wants what it holds',
        },
      ],
    });
    expect(codes(await keep(options(dir, sonarr, 'sonarr.login')))).toEqual([
      'keep.no-drift',
    ]);
    const stopped = await keep(
      options(dir, sonarr, 'sonarr.login.user', {
        runtime: fakeRuntime({ hashes: { ok: true, hashes: {} } }),
      }),
    );
    expect(stopped.diagnostics[0]?.message).toMatch(/Mediaplane couldn't look at it: /);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it('refuses a secret, a field it does not manage, and a value that holds a secret', async () => {
    const dir = await home();
    const holds = await fakeSonarr({
      key: KEY,
      user: `x${PASSWORD}`,
      password: PASSWORD,
    });
    expect(codes(await keep(options(dir, holds, 'sonarr.login.password')))).toEqual([
      'overrides.secret',
    ]);
    expect(codes(await keep(options(dir, holds, 'sonarr.login.usr')))).toEqual([
      'overrides.unmanaged-field',
    ]);
    const secret = await keep(options(dir, holds, 'sonarr.login.user'));
    expect(codes(secret)).toEqual(['keep.secret']);
    expect(JSON.stringify(secret)).not.toContain(PASSWORD);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it("refuses a value the field's own rule refuses, saying why, as plan would", async () => {
    const ruled: ResourceSpec = {
      ...FAKE_LOGIN,
      refuses: { user: (value) => (value === 'someone' ? 'it is no one' : undefined) },
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [ruled] } }
        : def,
    );
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const result = await keep(options(dir, sonarr, 'sonarr.login.user', { catalog }));
    expect(result).toMatchObject({ ok: false, value: undefined });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'keep.value',
        message: "sonarr.login.user can't be kept as sonarr holds it: it is no one",
      }),
    ]);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it("refuses a value it can't read", async () => {
    const odd: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.resolve({
          id: null,
          name: 'login',
          fields: {},
          unreadable: { user: 'a list, not text' },
        }),
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [odd] } }
        : def,
    );
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY });
    const result = await keep(options(dir, sonarr, 'sonarr.login.user', { catalog }));
    expect(result.diagnostics[0]).toMatchObject({
      code: 'keep.unreadable',
      message:
        "sonarr.login.user holds what Mediaplane can't read (a list, not text), so it can't keep it",
    });
  });

  it("gives the line to add instead when it won't write stack.yaml", async () => {
    const line =
      'add this line under overrides: in stack.yaml yourself: sonarr.login.user: someone';
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    // Owned by automation.
    const external = await home(`${STACK}managed_by: external\n`);
    const result = await keep(options(external, sonarr, 'sonarr.login.user'));
    expect(result.diagnostics[0]).toMatchObject({
      code: 'keep.external',
      hint: `${line}, where it is kept, such as your playbook`,
    });
    // A link to the file, which a rewrite would replace.
    const linked = await home();
    await rename(join(linked, 'stack.yaml'), join(linked, 'real.yaml'));
    await symlink(join(linked, 'real.yaml'), join(linked, 'stack.yaml'));
    expect(
      (await keep(options(linked, sonarr, 'sonarr.login.user'))).diagnostics[0],
    ).toMatchObject({
      code: 'keep.stack-file',
      message: expect.stringMatching(
        /^Mediaplane won't write stack.yaml: it is a link/,
      ) as string,
      hint: line,
    });
    // A file it can't add the line to without changing more of it.
    const flow = await home(
      '{ version: 1, paths: { data: /srv/data }, network: { bind: localhost }, media_server: jellyfin, apps: { sonarr: {}, qbittorrent: { vpn: false } } }\n',
    );
    expect(
      (await keep(options(flow, sonarr, 'sonarr.login.user'))).diagnostics[0],
    ).toMatchObject({
      code: 'keep.stack-file',
      message:
        "Mediaplane won't write stack.yaml: its top level is not a YAML block of keys, one per line",
      hint: line,
    });
  });

  it('waits for no other command, and makes no state/ where there is no stack.yaml', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const dir = await home();
    await writeFile(
      join(dir, LOCK_PATH),
      JSON.stringify({
        pid: process.pid,
        host: 'here',
        startedAt: AT.toISOString(),
        command: 'drift',
      }),
    );
    const locked = await keep(options(dir, sonarr, 'sonarr.login.user'));
    expect(locked.diagnostics[0]).toMatchObject({
      code: 'keep.locked',
      message: expect.stringContaining('mediaplane drift is running') as string,
    });
    const empty = await tempDir('mediaplane-keep-');
    expect(codes(await keep(options(empty, sonarr, 'sonarr.login.user')))).toEqual([
      'config.missing',
    ]);
    expect(await readdir(empty)).toEqual([]);
  });

  it('keeps stack.yaml as written when its record cannot be updated, and says the next apply records it', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const runtime = runtimeFor(sonarr.addresses);
    const spoiling: Runtime = {
      ...runtime,
      wiringAddresses: async (ids) => {
        await writeFile(join(dir, RESOURCES_PATH), '{');
        return runtime.wiringAddresses(ids);
      },
    };
    const result = await keep(
      options(dir, sonarr, 'sonarr.login.user', { runtime: spoiling }),
    );
    expect(result).toMatchObject({ ok: true, value: 'someone' });
    expect(codes(result)).toEqual(['keep.record']);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toContain(
      'sonarr.login.user: someone',
    );
  });
});
