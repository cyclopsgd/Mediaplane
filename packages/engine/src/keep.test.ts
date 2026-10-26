import { execFileSync } from 'node:child_process';
import {
  chmod,
  chown,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog/types';
import { readResources, readState, writeResources } from './integrations/resources';
import type { ResourceSpec } from './integrations/types';
import { keep } from './keep';
import { LOCK_PATH, RESOURCES_PATH } from './paths';
import { plan } from './plan/plan';
import { readSecretStore } from './secrets/store';
import type { Runtime } from './runtime/types';
import { fakeProbe, fakeRuntime } from './testing/fakes';
import { fakeHttpApp, type FakeReply } from './testing/http';
import { FIXTURE_API, FIXTURE_HOST } from './testing/fixtures';
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

/** One of this user's groups other than its own, if it has one. */
function otherGroup(): number | undefined {
  const own = process.getgid?.();
  return (process.getgroups?.() ?? []).find((group) => group !== own);
}

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

  it('gives the line to add when stack.yaml has other names, or the write itself fails', async () => {
    const line =
      'add this line under overrides: in stack.yaml yourself: sonarr.login.user: someone';
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const linked = await home();
    await link(join(linked, 'stack.yaml'), join(linked, 'other.yaml'));
    expect(
      (await keep(options(linked, sonarr, 'sonarr.login.user'))).diagnostics[0],
    ).toMatchObject({
      code: 'keep.stack-file',
      message:
        "Mediaplane won't write stack.yaml: it has other names (hard links), which a rewrite would part from it",
      hint: line,
    });
    // A home it can't write in: the new stack.yaml can't be put in place.
    if (process.getuid?.() === 0) return;
    const shut = await home();
    await chmod(shut, 0o555);
    try {
      const result = await keep(options(shut, sonarr, 'sonarr.login.user'));
      expect(result).toMatchObject({ ok: false, value: undefined });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'keep.stack-file',
        message: `Mediaplane couldn't write stack.yaml: cannot write ${join(shut, 'stack.yaml')} (EACCES)`,
        hint: line,
      });
    } finally {
      await chmod(shut, 0o755);
    }
    expect(await readFile(join(shut, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it.skipIf(otherGroup() === undefined)(
    "keeps stack.yaml's group, one of its user's others (skipped where the user has one group)",
    async () => {
      const group = otherGroup() ?? 0;
      const dir = await home();
      await chown(join(dir, 'stack.yaml'), -1, group);
      const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
      expect((await keep(options(dir, sonarr, 'sonarr.login.user'))).ok).toBe(true);
      expect((await stat(join(dir, 'stack.yaml'))).gid).toBe(group);
    },
  );

  it('checks again what stack.yaml says, in the file it writes', async () => {
    // Handed to automation while keep looked at the app: it writes nothing then.
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const runtime = runtimeFor(sonarr.addresses);
    const handing: Runtime = {
      ...runtime,
      wiringAddresses: async (ids) => {
        await writeFile(join(dir, 'stack.yaml'), `${STACK}managed_by: external\n`);
        return runtime.wiringAddresses(ids);
      },
    };
    const result = await keep(
      options(dir, sonarr, 'sonarr.login.user', { runtime: handing }),
    );
    expect(codes(result)).toEqual(['keep.external']);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}managed_by: external\n`,
    );
  });

  it('refuses a value that could make stack.yaml show what it does not hold', async () => {
    const dir = await home();
    for (const odd of ['some\u2028one', 'some\u202eone', 'some\tone', 'some\u0085one']) {
      const sonarr = await fakeSonarr({ key: KEY, user: odd, password: PASSWORD });
      const result = await keep(options(dir, sonarr, 'sonarr.login.user'));
      expect(result.diagnostics, JSON.stringify(odd)).toEqual([
        expect.objectContaining({
          code: 'keep.value',
          message: expect.stringContaining(
            'a control character, a line or paragraph separator, or one that turns the direction of text',
          ) as string,
        }),
      ]);
    }
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it('asks no app but the one that holds what it keeps', async () => {
    const catalog: Catalog = WIRED_CATALOG.map((def) =>
      def.id === 'qbittorrent'
        ? {
            ...def,
            api: FIXTURE_API,
            integration: { after: [], resources: [FAKE_LOGIN] },
          }
        : def,
    );
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const both = { ...sonarr.addresses, 'fake-qbittorrent': '127.0.0.1' };
    const kept = await keep(
      options(dir, sonarr, 'sonarr.login.user', {
        catalog,
        runtime: runtimeFor(both),
      }),
    );
    expect(kept.ok).toBe(true);
    expect(
      sonarr.app.requests.filter((r) => (r.headers.host ?? '').startsWith('qbittorrent')),
    ).toEqual([]);
  });

  it("says it couldn't look at a resource left in an app that isn't running", async () => {
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
    const result = await keep(
      options(dir, sonarr, 'sonarr.gone', {
        catalog,
        runtime: fakeRuntime({ hashes: { ok: true, hashes: {} } }),
      }),
    );
    expect(result.diagnostics[0]).toMatchObject({
      code: 'keep.no-drift',
      message:
        "sonarr.gone has not changed outside Mediaplane: Mediaplane couldn't look at it: its app isn't running and healthy",
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

  it.each([
    ['a directory', (path: string) => mkdir(path)],
    [
      'a named pipe',
      (path: string) => Promise.resolve(void execFileSync('mkfifo', [path])),
    ],
  ])(
    'refuses %s in place of stack.yaml, without waiting or an uncaught error',
    async (_what, make) => {
      const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
      const dir = await tempDir('mediaplane-keep-');
      await make(join(dir, 'stack.yaml'));
      expect(codes(await keep(options(dir, sonarr, 'sonarr.login.user')))).toEqual([
        'keep.stack-file',
      ]);
      expect(await readdir(dir)).toEqual(['stack.yaml']);
    },
  );

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

describe("keep: an app's own key, changed at its source", () => {
  /** Sonarr's key in its config.xml; qBittorrent with a link that holds Sonarr's key. */
  const KEYED: Catalog = WIRED_CATALOG.map((def) =>
    def.id === 'sonarr'
      ? {
          ...def,
          keyFiles: {
            apiKey: {
              path: 'config.xml',
              read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
            },
          },
        }
      : def.id === 'qbittorrent'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [
                {
                  ...FAKE_LOGIN,
                  name: 'link',
                  secrets: ['sonarrKey'],
                  desired: ({ keys }) => ({
                    name: 'link',
                    fields: {},
                    secrets: { sonarrKey: keys.sonarr?.apiKey ?? '' },
                  }),
                },
              ],
            },
          }
        : def.id === 'gluetun'
          ? {
              ...def,
              keyFiles: { controlApiKey: { path: 'auth.toml', read: () => 'x' } },
            }
          : def,
  );
  const NEW = '5'.repeat(32);

  /** A home whose Sonarr's config.xml holds `held`. */
  async function keyedHome(held: string | undefined, stack = STACK): Promise<string> {
    const dir = await home(stack);
    await mkdir(join(dir, 'appdata'), { mode: 0o700 });
    await mkdir(join(dir, 'appdata', 'sonarr'));
    await writeFile(
      join(dir, 'appdata', 'sonarr', 'config.xml'),
      held === undefined ? '<Config />' : `<Config><ApiKey>${held}</ApiKey></Config>`,
    );
    return dir;
  }

  it("keeps the key the app's file holds, once the app takes it and refuses Mediaplane's, and names who holds the old", async () => {
    const dir = await keyedHome(NEW);
    // A drift found Sonarr refusing the key Mediaplane holds: it isn't sent again.
    await writeResources(
      dir,
      { 'sonarr.login': RECORD },
      {
        'sonarr.apiKey': { verdict: 'refused', at: AT.toISOString() },
      },
    );
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
    expect(kept).toEqual({
      ok: true,
      key: 'sonarr.apiKey',
      value: undefined,
      holders: ['qbittorrent.link'],
      diagnostics: [],
    });
    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: NEW });
    expect((await readState(dir)).keys).toEqual({});
    // Asked with the new key only: the old one was found refused before.
    expect(sonarr.app.requests.filter((r) => r.headers['x-api-key'] === KEY)).toEqual([]);
    expect(JSON.stringify(kept)).not.toContain(NEW);
    const after = await plan({
      ...options(dir, sonarr, '', { catalog: KEYED }),
      drift: { now: () => AT },
    });
    expect(after.drift.filter((d) => d.kind === 'key')).toEqual([]);
    await expect(readFile(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it('keeps no key the app takes already, nor one its file holds that the app refuses too', async () => {
    const takes = await keyedHome(NEW);
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    expect(
      codes(await keep(options(takes, sonarr, 'sonarr.apiKey', { catalog: KEYED }))),
    ).toEqual(['keep.no-drift']);
    const neither = await keyedHome('6'.repeat(32));
    const other = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const result = await keep(
      options(neither, other, 'sonarr.apiKey', { catalog: KEYED }),
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'keep.refused',
          message: expect.stringMatching(
            /^sonarr refuses the key its own file holds too: /,
          ) as string,
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('6'.repeat(32));
    expect((await readSecretStore(neither)).apps.sonarr).toEqual({ apiKey: KEY });
  });

  it("keeps no key an app doesn't answer about: an unsure answer is never a yes", async () => {
    const dir = await keyedHome(NEW);
    await writeResources(
      dir,
      { 'sonarr.login': RECORD },
      {
        'sonarr.apiKey': { verdict: 'refused', at: AT.toISOString() },
      },
    );
    const sonarr = await fakeSonarr({
      key: NEW,
      user: 'admin',
      password: PASSWORD,
      up: false,
    });
    const result = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'keep.refused',
        message: expect.stringMatching(
          /^Mediaplane couldn't tell whether sonarr takes the key its own file holds: /,
        ) as string,
      }),
    ]);
    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: KEY });
  });

  it("keeps no key from a file that holds none, or the one the app refuses, or of an app it can't ask", async () => {
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    for (const [held, why] of [
      [undefined, 'it holds none'],
      [KEY, 'it holds the one Mediaplane holds, which the app refuses'],
    ] as const) {
      const result = await keep(
        options(await keyedHome(held), sonarr, 'sonarr.apiKey', { catalog: KEYED }),
      );
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'keep.no-key',
          message: `Mediaplane can't keep sonarr's own key: appdata/sonarr/config.xml can't give it: ${why}`,
        }),
      ]);
    }
    const gluetun = await keep(
      options(await keyedHome(NEW), sonarr, 'gluetun.controlApiKey', { catalog: KEYED }),
    );
    expect(gluetun.diagnostics).toEqual([
      expect.objectContaining({
        code: 'keep.no-check',
        message:
          "Mediaplane can't ask gluetun whether it takes the key appdata/gluetun/auth.toml holds, so it doesn't keep it",
      }),
    ]);
  });

  /** KEYED, with a way to write Sonarr's key back that never finds the place for it. */
  const WRITABLE: Catalog = KEYED.map((def) =>
    def.id === 'sonarr'
      ? {
          ...def,
          keyFiles: {
            apiKey: {
              path: 'config.xml',
              read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
              write: () => undefined,
            },
          },
        }
      : def,
  );

  /** Mediaplane's refusal on record, so that plan doesn't send the old key again. */
  async function refusedHome(held: string | undefined, stack = STACK): Promise<string> {
    const dir = await keyedHome(held, stack);
    await writeResources(
      dir,
      { 'sonarr.login': RECORD },
      { 'sonarr.apiKey': { verdict: 'refused', at: AT.toISOString() } },
    );
    return dir;
  }

  /** `runtime`, but the apps' addresses are answered by `answer` from the second call on. */
  function afterPlan(
    runtime: Runtime,
    answer: () => Promise<Record<string, string>>,
  ): Runtime {
    let calls = 0;
    return {
      ...runtime,
      wiringAddresses: (ids) => (++calls === 1 ? runtime.wiringAddresses(ids) : answer()),
    };
  }

  /** An app that answers /ping, and everything else with `answer`, on Sonarr's seams. */
  async function brokenSonarr(answer: FakeReply | 'hang'): Promise<Fake> {
    const sonarr = await fakeSonarr();
    const app = await fakeHttpApp((request) =>
      request.path === '/ping' ? { status: 200 } : answer,
    );
    return {
      ...sonarr,
      app,
      seams: {
        ...sonarr.seams,
        endpoint: () => ({ host: '127.0.0.1', port: app.port }),
        timeoutMs: 100,
      },
    };
  }

  it('keeps no key from a link or a pipe at the key file, and sends the app nothing', async () => {
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const other = '7'.repeat(32);
    // A link to another app's file, which holds a valid key.
    const linked = await refusedHome(NEW);
    await mkdir(join(linked, 'appdata', 'radarr'));
    await writeFile(
      join(linked, 'appdata', 'radarr', 'config.xml'),
      `<Config><ApiKey>${other}</ApiKey></Config>`,
    );
    await rm(join(linked, 'appdata', 'sonarr', 'config.xml'));
    await symlink(
      '../radarr/config.xml',
      join(linked, 'appdata', 'sonarr', 'config.xml'),
    );
    // A pipe, which a read would wait on.
    const piped = await refusedHome(NEW);
    await rm(join(piped, 'appdata', 'sonarr', 'config.xml'));
    execFileSync('mkfifo', [join(piped, 'appdata', 'sonarr', 'config.xml')]);
    for (const dir of [linked, piped]) {
      const result = await keep(
        options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }),
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'keep.no-key',
          message: expect.stringMatching(
            /^Mediaplane can't keep sonarr's own key: appdata\/sonarr\/config\.xml can't give it: /,
          ) as string,
        }),
      ]);
      expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: KEY });
      expect(JSON.stringify(result)).not.toContain(other);
    }
    // The old key was found refused before, and the file's was never read: nothing sent.
    expect(sonarr.app.requests).toEqual([]);
  });

  it("keeps no key in a form the store can't keep, and sends the app nothing", async () => {
    const sonarr = await fakeSonarr({
      key: 'bad-key!',
      user: 'admin',
      password: PASSWORD,
    });
    const dir = await refusedHome('bad-key!');
    const result = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'keep.no-key',
        message: `Mediaplane can't keep sonarr's own key: appdata/sonarr/config.xml can't give it: it holds the key in a form Mediaplane can't keep (only letters, digits and "_")`,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('bad-key!');
    expect(sonarr.app.requests).toEqual([]);
  });

  it('keeps no key the store holds for another app', async () => {
    const dir = await refusedHome(NEW);
    await writeFile(
      join(dir, 'state', 'secrets.json'),
      JSON.stringify({
        version: 1,
        apps: { sonarr: { apiKey: KEY }, qbittorrent: { apiKey: NEW } },
        shared: { adminPassword: PASSWORD },
      }),
    );
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const result = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'keep.no-key',
        message: `Mediaplane can't keep sonarr's own key: appdata/sonarr/config.xml can't give it: it holds the key Mediaplane holds for qbittorrent.apiKey`,
      }),
    ]);
    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: KEY });
    expect(JSON.stringify(result)).not.toContain(NEW);
    expect(sonarr.app.requests).toEqual([]);
  });

  it("keeps no key of an app that is not on the network when it is asked with the file's", async () => {
    const dir = await refusedHome(NEW);
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const runtime = afterPlan(runtimeFor(sonarr.addresses), () => Promise.resolve({}));
    const result = await keep(
      options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED, runtime }),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['keep.refused']);
    expect(sonarr.app.requests).toEqual([]);
    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: KEY });
  });

  it("keeps no key on an app's 5xx or a timeout: an unsure answer is never a yes", async () => {
    for (const answer of [{ status: 500, body: 'broken' }, 'hang'] as const) {
      const dir = await refusedHome(NEW);
      const sonarr = await brokenSonarr(answer);
      const result = await keep(
        options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }),
      );
      expect(result.ok).toBe(false);
      expect(codes(result)).toEqual(['keep.refused']);
      expect(result.diagnostics[0]?.message).toMatch(
        /^Mediaplane couldn't tell whether sonarr takes the key its own file holds/,
      );
      expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: KEY });
    }
  });

  it('keeps out of what it says every secret plan keeps out of what it says: an admin password of your own', async () => {
    const filePassword = 'fake-file-admin-password';
    const dir = await refusedHome(
      NEW,
      `${STACK}admin: { password: { file: admin-password } }\n`,
    );
    await writeFile(join(dir, 'admin-password'), `${filePassword}\n`, { mode: 0o600 });
    // An app that answers the ask with an error that repeats the admin password.
    const sonarr = await brokenSonarr({ status: 500, body: `broken: ${filePassword}` });
    const result = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
    expect(codes(result)).toEqual(['keep.refused']);
    expect(JSON.stringify(result)).not.toContain(filePassword);
    expect(JSON.stringify(result)).not.toContain(NEW);
    expect(result.diagnostics[0]?.message).toContain('***');
  });

  it("looks a key's name up among the app's own, never the prototype's", async () => {
    const dir = await keyedHome(NEW);
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const result = await keep(
      options(dir, sonarr, 'sonarr.constructor', { catalog: KEYED }),
    );
    expect(codes(result)).toEqual(['overrides.unknown']);
  });

  it("says that the app couldn't be asked, with plan's warnings, rather than that its key has not changed", async () => {
    const dir = await keyedHome(NEW);
    const down = await fakeSonarr({ key: NEW, up: false });
    const unasked = await keep(
      options(dir, down, 'sonarr.apiKey', { catalog: WRITABLE }),
    );
    expect(unasked.ok).toBe(false);
    expect(unasked.diagnostics[0]).toMatchObject({
      code: 'keep.no-drift',
      message: expect.stringMatching(
        /^Mediaplane couldn't ask sonarr whether it still takes the key it holds, so it can't tell whether sonarr\.apiKey changed/,
      ) as string,
    });
    // Plan's own warnings follow: why it couldn't be asked, and the file's other key.
    expect(codes(unasked)).toContain('keys.restore');
    expect(codes(unasked).some((code) => code.startsWith('wire.'))).toBe(true);
    const takes = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const taken = await keep(options(dir, takes, 'sonarr.apiKey', { catalog: KEYED }));
    expect(taken.diagnostics[0]).toMatchObject({
      code: 'keep.no-drift',
      message:
        'sonarr.apiKey has not changed outside Mediaplane: sonarr takes the key Mediaplane holds',
    });
  });

  it('drops the warning that the key could not be put back, once it keeps it', async () => {
    const dir = await refusedHome(NEW);
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const before = await plan(options(dir, sonarr, '', { catalog: WRITABLE }));
    expect(codes(before)).toContain('keys.restore');
    const kept = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: WRITABLE }));
    expect(kept.ok).toBe(true);
    expect(kept.diagnostics).toEqual([]);
  });

  it('saves only the key it keeps, not the keys plan recovered for other apps', async () => {
    const catalog: Catalog = KEYED.map((def) =>
      def.id === 'qbittorrent'
        ? {
            ...def,
            secrets: { apiKey: { generate: 'hex32' } },
            keyFiles: { apiKey: { path: 'q.conf', read: (text) => text.trim() } },
          }
        : def,
    );
    const dir = await refusedHome(NEW);
    await mkdir(join(dir, 'appdata', 'qbittorrent'));
    await writeFile(join(dir, 'appdata', 'qbittorrent', 'q.conf'), `${'8'.repeat(32)}\n`);
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog }));
    expect(kept.ok).toBe(true);
    expect(await readSecretStore(dir)).toEqual({
      version: 1,
      apps: { sonarr: { apiKey: NEW } },
      shared: { adminPassword: PASSWORD },
    });
  });

  it("keeps the key though state/resources.json can't be updated, and says so", async () => {
    const dir = await refusedHome(NEW);
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    // Plan has read it by the time the app is asked with the file's key.
    const runtime = afterPlan(runtimeFor(sonarr.addresses), async () => {
      await writeFile(join(dir, RESOURCES_PATH), '{ not json');
      return sonarr.addresses;
    });
    const kept = await keep(
      options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED, runtime }),
    );
    expect(kept.ok).toBe(true);
    expect(kept.diagnostics).toEqual([
      expect.objectContaining({
        code: 'keep.record',
        hint: 'the next apply records it, changing nothing in the app',
      }),
    ]);
    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: NEW });
  });

  it('reads the apps and writes to none, leaves stack.yaml as it was, and works for an external stack', async () => {
    const external = `${STACK}managed_by: external\n`;
    const dir = await refusedHome(NEW, external);
    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
    expect(kept.ok).toBe(true);
    expect(sonarr.app.requests.length).toBeGreaterThan(0);
    expect(sonarr.app.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(external);
  });
});
