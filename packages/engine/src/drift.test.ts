import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drift } from './drift';
import { AppApiError } from './http/client';
import { readResources, writeResources } from './integrations/resources';
import type { ResourceSpec } from './integrations/types';
import { LOCK_PATH, RESOURCES_PATH } from './paths';
import type { HostProbe } from './preflight/probe';
import type { Runtime } from './runtime/types';
import { fakeProbe, fakeRuntime } from './testing/fakes';
import { FIXTURE_HOST } from './testing/fixtures';
import { wiredHome, wiredRuntime } from './testing/home';
import { tempDir } from './testing/temp';
import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from './testing/wiring';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
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

/** A home of the wired fixture stack, with Sonarr's key stored and its login recorded. */
function home(): Promise<string> {
  return wiredHome({
    prefix: 'mediaplane-drift-',
    stack: STACK,
    key: KEY,
    password: PASSWORD,
    known: { 'sonarr.login': RECORD },
  });
}

/** The stack's Sonarr, running and healthy, on the wiring network. */
const runtimeFor = wiredRuntime;

async function driftOf(
  dir: string,
  fake: Awaited<ReturnType<typeof fakeSonarr>>,
  probe: HostProbe = fakeProbe(),
) {
  return drift({
    home: dir,
    catalog: WIRED_CATALOG,
    host: FIXTURE_HOST,
    env: {},
    runtime: runtimeFor(fake.addresses),
    probe,
    wiring: fake.seams,
    now: () => AT,
  });
}

describe('drift', () => {
  it('finds nothing changed where the app holds what Mediaplane applied, and keeps each check', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    expect(await driftOf(dir, sonarr)).toEqual({
      ok: true,
      clear: true,
      drift: [],
      checks: [{ resource: 'sonarr.login', secret: 'password', verdict: 'passed' }],
      unchecked: [],
      diagnostics: [],
    });
    expect((await readResources(dir))['sonarr.login']?.checks).toEqual({
      password: { verdict: 'passed', at: AT.toISOString() },
    });
    // The lock is released.
    await expect(stat(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it('reports what changed, and a secret it finds refused it keeps, and checks no more', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({
      key: KEY,
      user: 'admin',
      password: 'fake-changed',
    });
    const first = await driftOf(dir, sonarr);
    expect(first).toMatchObject({
      ok: true,
      clear: false,
      drift: [{ resource: 'sonarr.login', kind: 'secret', secret: 'password' }],
    });
    const signIns = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
    const before = signIns();
    const second = await driftOf(dir, sonarr);
    expect(second.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'secret',
        secret: 'password',
        since: AT.toISOString(),
      },
    ]);
    expect(signIns()).toBe(before);
    expect(JSON.stringify([first, second])).not.toContain(PASSWORD);
  });

  it("says what it couldn't look at, and isn't clear then", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY });
    const result = await drift({
      home: dir,
      catalog: WIRED_CATALOG,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime({ hashes: { ok: true, hashes: {} } }),
      probe: fakeProbe(),
      wiring: sonarr.seams,
    });
    expect(result).toMatchObject({
      ok: true,
      clear: false,
      drift: [],
      unchecked: [
        {
          resource: 'sonarr.login',
          reason:
            "its app isn't running and healthy, or is to be set up first: run apply, then drift again",
        },
      ],
    });
  });

  it("isn't clear while a secret goes unchecked, though nothing is found", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const careful: ResourceSpec = {
      ...FAKE_LOGIN,
      verify: () => Promise.resolve({ unchecked: 'it would make a category' }),
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [careful] } }
        : def,
    );
    const result = await drift({
      home: dir,
      catalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: runtimeFor(sonarr.addresses),
      probe: fakeProbe(),
      wiring: sonarr.seams,
      now: () => AT,
    });
    expect(result).toMatchObject({ ok: true, clear: false, drift: [], unchecked: [] });
  });

  it("isn't clear while it can't tell whether an app still holds what Mediaplane made there", async () => {
    const dir = await home();
    await writeResources(dir, {
      'sonarr.login': RECORD,
      'sonarr.gone': { ...RECORD, name: 'gone' },
    });
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const gone: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'gone',
      desired: () => undefined,
      observe: () => Promise.reject(new AppApiError('no', { kind: 'rejected' })),
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [FAKE_LOGIN, gone] } }
        : def,
    );
    const result = await drift({
      home: dir,
      catalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: runtimeFor(sonarr.addresses),
      probe: fakeProbe(),
      wiring: sonarr.seams,
      now: () => AT,
    });
    expect(result).toMatchObject({
      ok: true,
      clear: false,
      drift: [],
      unchecked: [
        {
          resource: 'sonarr.gone',
          reason:
            "Mediaplane made sonarr.gone, which the stack no longer wants, and couldn't tell whether sonarr still holds it: no",
        },
      ],
    });
  });

  it("asks no more of the host than it needs: the host's ports and folders aren't drift", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const busy = fakeProbe({ freeBytes: 0 });
    expect((await driftOf(dir, sonarr, busy)).ok).toBe(true);
  });

  it('waits for no other command: one that holds the lock is named', async () => {
    const dir = await home();
    await writeFile(
      join(dir, LOCK_PATH),
      JSON.stringify({ pid: process.pid, host: 'here', startedAt: AT.toISOString() }),
    );
    const result = await driftOf(dir, await fakeSonarr({ key: KEY }));
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'drift.locked',
          message: expect.stringContaining('another apply is running') as string,
        }),
      ],
    });
  });

  it('makes no state/ where there is no stack.yaml, and says why', async () => {
    const dir = await tempDir('mediaplane-drift-');
    const result = await driftOf(dir, await fakeSonarr({ key: KEY }));
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'config.missing' })],
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it('fails as plan fails, and warns when it cannot keep its checks', async () => {
    const dir = await home();
    await writeFile(join(dir, 'stack.yaml'), `${STACK}  sonar: {}\n`);
    const failed = await driftOf(dir, await fakeSonarr({ key: KEY }));
    expect(failed.ok).toBe(false);
    const ok = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    // state/resources.json spoilt while drift looks: it can't be read to keep the checks.
    const runtime = runtimeFor(sonarr.addresses);
    const spoiling: Runtime = {
      ...runtime,
      wiringAddresses: async (ids) => {
        await writeFile(join(ok, RESOURCES_PATH), '{');
        return runtime.wiringAddresses(ids);
      },
    };
    const result = await drift({
      home: ok,
      catalog: WIRED_CATALOG,
      host: FIXTURE_HOST,
      env: {},
      runtime: spoiling,
      probe: fakeProbe(),
      wiring: sonarr.seams,
      now: () => AT,
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'drift.checks-not-kept' }),
    ]);
  });
});
