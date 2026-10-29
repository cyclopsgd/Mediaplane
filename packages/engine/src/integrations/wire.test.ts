import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ActionResult } from '../history/records';
import { AppApiError } from '../http/client';
import { RESOURCES_PATH, STATE_DIR } from '../paths';
import { JoinFailed, OwnContainerUnknown, WiringRefused } from '../runtime/docker';
import { RuntimeError, type OneOffCommand } from '../runtime/types';
import { fakeRuntime, type FakeRuntimeOptions } from '../testing/fakes';
import { FIXTURE_API } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import {
  FAKE_LOGIN,
  fakeSonarr,
  WIRED_CATALOG,
  WIRING_RUNNING as RUNNING,
  wiringStack as stackOf,
} from '../testing/wiring';
import {
  readResources,
  readState,
  writeResources,
  type KeyChecks,
  type KnownResource,
  type KnownResources,
} from './resources';
import type { ResourceSpec } from './types';
import { wire, WiringFailed, type WireOptions } from './wire';
import type { WiringSeams } from './wiring';

const KEY = '0'.repeat(32);
const RUNBOOK =
  'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md';
const PASSWORD = 'fake-admin-password';
const AT = new Date('2026-10-10T12:00:00.000Z');

/** A fake app's seams, and where its container is on the wiring network. */
interface Fake {
  seams: WiringSeams;
  addresses: Record<string, string>;
}

/**
 * wire() for `fake`, in a new home. `known` is written to state/resources.json first,
 * which wire reads again, and `join` is what joining the wiring network does.
 */
async function wireWith(
  fake: Fake,
  extra: Partial<WireOptions> & {
    join?: FakeRuntimeOptions['join'];
    known?: KnownResources;
    keys?: KeyChecks;
  } = {},
) {
  const { seams, addresses } = fake;
  const home = await tempDir('mediaplane-wire-');
  const actions: ActionResult[] = [];
  const calls: string[] = [];
  const { join: joined = 'not-needed', known, keys, ...rest } = extra;
  if (known !== undefined) await writeResources(home, known, keys);
  const run = wire({
    home,
    stack: stackOf(),
    store: {
      version: 1,
      apps: { sonarr: { apiKey: KEY } },
      shared: { adminPassword: PASSWORD },
    },
    values: {},
    env: {},
    runtime: fakeRuntime({ containers: RUNNING, addresses, calls, join: joined }),
    now: () => AT,
    record: (action) => actions.push(action),
    seams,
    ...rest,
  });
  return { run, home, actions, calls };
}

const RECORDED: KnownResources = {
  'sonarr.login': {
    id: null,
    name: 'login',
    fields: { user: 'admin' },
    secrets: ['password'],
    appliedAt: AT.toISOString(),
  },
};

describe('wire', () => {
  it('joins the network, creates what is missing, and records it at once, privately', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, home, actions, calls } = await wireWith(sonarr);
    expect(await run).toEqual(['sonarr.login created']);
    expect(sonarr.state).toMatchObject({ user: 'admin', password: PASSWORD });
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'created' },
    ]);
    expect(await readResources(home)).toEqual(RECORDED);
    expect((await stat(join(home, RESOURCES_PATH))).mode & 0o777).toBe(0o600);
    expect(calls.indexOf('join-wiring')).toBeLessThan(
      calls.findIndex((call) => call.startsWith('wiring-addresses')),
    );
  });

  it('reaches an app with a key you give, as Plex takes your token, never keeping it, and keeps it out of what it says', async () => {
    const store = { version: 1 as const, apps: {}, shared: { adminPassword: PASSWORD } };
    const sonarr = await fakeSonarr({ key: KEY });
    const given = await wireWith(sonarr, { store, given: { sonarr: { apiKey: KEY } } });
    expect(await given.run).toEqual(['sonarr.login created']);
    const keyed = sonarr.app.requests.filter((r) => r.path !== '/ping');
    expect(keyed.every((r) => r.headers['x-api-key'] === KEY)).toBe(true);
    expect(JSON.stringify(await readResources(given.home))).not.toContain(KEY);
    // Refused, the app repeats the key it was sent: the step says so with ***.
    const refusing = await fakeSonarr({ key: '1'.repeat(32) });
    const refused = await wireWith(refusing, {
      store,
      given: { sonarr: { apiKey: KEY } },
    });
    expect(await refused.run.catch((cause: unknown) => cause)).toBeInstanceOf(
      WiringFailed,
    );
    expect(JSON.stringify(refused.actions)).toContain('Unauthorized: ***');
    expect(JSON.stringify(refused.actions)).not.toContain(KEY);
  });

  it('updates what differs, saying what, and adopts what is already right', async () => {
    const wrong = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    const updated = await wireWith(wrong, { known: RECORDED });
    // The user differs, so the update sets the password too, unchecked.
    expect(await updated.run).toEqual(['sonarr.login updated user']);
    expect(wrong.state).toMatchObject({ user: 'admin', password: PASSWORD });

    const right = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const adopted = await wireWith(right);
    expect(await adopted.run).toEqual(['sonarr.login adopted']);
    expect(right.app.requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(await readResources(adopted.home)).toEqual(RECORDED);
  });

  it('sets a secret its own plan found refused, without checking it again', async () => {
    // Each failed check of qBittorrent's password counts towards its ban: apply's plan
    // made one, so the wire step makes none.
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'other' });
    const { run } = await wireWith(sonarr, {
      known: RECORDED,
      planned: [{ resource: 'sonarr.login', action: 'update', changes: ['password'] }],
    });
    expect(await run).toEqual(['sonarr.login updated password']);
    expect(sonarr.state.password).toBe(PASSWORD);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
  });

  it('forgets a secret drift found refused once its own check passes, and leaves the rest', async () => {
    // Drift found it refused; apply's plan checked it after the start, and it now passes
    // (re-entered in the app, say): drift is clear after, and the next plan unchanged.
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const at = '2026-10-20T08:00:00.000Z';
    const found: KnownResources = {
      'sonarr.login': {
        ...(RECORDED['sonarr.login'] as KnownResource),
        secrets: ['password', 'token'],
        checks: {
          password: { verdict: 'refused', at },
          token: { verdict: 'passed', at },
        },
      },
    };
    const { run, home, actions } = await wireWith(sonarr, {
      known: found,
      planned: [{ resource: 'sonarr.login', action: 'after-start' }],
    });
    expect(await run).toEqual([]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
    ]);
    expect((await readResources(home))['sonarr.login']?.checks).toEqual({
      token: { verdict: 'passed', at },
    });
    // With none left, the record has none.
    const only: KnownResources = {
      'sonarr.login': {
        ...(RECORDED['sonarr.login'] as KnownResource),
        checks: { password: { verdict: 'refused', at } },
      },
    };
    const again = await wireWith(sonarr, { known: only });
    expect(await again.run).toEqual([]);
    expect(await readResources(again.home)).toEqual(RECORDED);
  });

  it('forgets that an app refused its own key once it takes it, and only then', async () => {
    const at = '2026-10-20T08:00:00.000Z';
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const taken = await wireWith(sonarr, {
      known: RECORDED,
      keys: {
        'sonarr.apiKey': { verdict: 'refused', at },
        'radarr.apiKey': { verdict: 'refused', at },
      },
    });
    expect(await taken.run).toEqual([]);
    expect((await readState(taken.home)).keys).toEqual({
      'radarr.apiKey': { verdict: 'refused', at },
    });
    const refusing = await fakeSonarr({ key: '1'.repeat(32) });
    const refused = await wireWith(refusing, {
      known: RECORDED,
      keys: { 'sonarr.apiKey': { verdict: 'refused', at } },
    });
    await expect(refused.run).rejects.toThrow(WiringFailed);
    expect((await readState(refused.home)).keys).toEqual({
      'sonarr.apiKey': { verdict: 'refused', at },
    });
  });

  it('checks again a field its plan found differing: only the secrets it found refused go unchecked', async () => {
    // The plan said the user differed, and it was put right meanwhile: nothing is set, and
    // nothing is said to be. The password is checked, since no secret was found refused.
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const { run, actions } = await wireWith(sonarr, {
      known: RECORDED,
      planned: [{ resource: 'sonarr.login', action: 'update', changes: ['user'] }],
    });
    expect(await run).toEqual([]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
    ]);
    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(true);
  });

  it("tells an update what differs, and a check that it is apply's, with the apps it may ask", async () => {
    const seen: unknown[] = [];
    const told: ResourceSpec = {
      ...FAKE_LOGIN,
      verify: (api, desired, observed, ctx) => {
        seen.push(ctx?.readOnly, ctx?.peer('sonarr')?.name, ctx?.peer('qbittorrent'));
        return FAKE_LOGIN.verify?.(api, desired, observed, ctx) ?? Promise.resolve(false);
      },
      update: (api, desired, observed, changes) => {
        seen.push(changes);
        return FAKE_LOGIN.update(api, desired, observed);
      },
    };
    const stack = stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr'
          ? { ...def, integration: { after: [], resources: [told] } }
          : def,
      ),
    );
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'fake-other' });
    const { run } = await wireWith(sonarr, { stack, known: RECORDED });
    expect(await run).toEqual(['sonarr.login updated password']);
    // The fixture's Sonarr is named by its id; qBittorrent isn't up in this stack.
    expect(seen).toEqual([false, 'sonarr', undefined, ['password']]);
  });

  it('changes nothing, and writes nothing, when all is as wanted', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const { run, home, actions } = await wireWith(sonarr, { known: RECORDED });
    const path = join(home, RESOURCES_PATH);
    const before = { text: await readFile(path, 'utf8'), ino: (await stat(path)).ino };
    expect(await run).toEqual([]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
    ]);
    // An atomic write would have put a new file in its place.
    expect({ text: await readFile(path, 'utf8'), ino: (await stat(path)).ino }).toEqual(
      before,
    );
  });

  it("fails each resource of an app that refuses the key, with the app's message and no secret", async () => {
    const sonarr = await fakeSonarr({ key: 'f'.repeat(32) });
    const { run, home, actions } = await wireWith(sonarr);
    const failure = await run.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(WiringFailed);
    expect((failure as WiringFailed).message).toBe('the wiring failed for sonarr.login');
    expect((failure as WiringFailed).hint).toBe(
      `the apps' own messages are above; fix what they say, then run apply again. See ${RUNBOOK}`,
    );
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'wire.auth',
        hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md',
      }),
    ]);
    // The app repeated the key it refused: the redaction took it out.
    expect(actions).toEqual([
      expect.objectContaining({
        resource: 'sonarr.login',
        result: 'failed',
        error: expect.stringContaining('Unauthorized: ***') as string,
      }),
    ]);
    expect(JSON.stringify([failure, actions])).not.toContain(KEY);
    await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
  });

  it('skips what needs a resource that failed, and still does what does not', async () => {
    // The fake Sonarr answers 404 to the first: a refusal, which needs no retry.
    const failing: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: (api) => api.get('/api/v3/missing', z.unknown()).then(() => undefined),
    };
    const needs = (name: string, requires: string[]): ResourceSpec => ({
      ...FAKE_LOGIN,
      name,
      requires,
    });
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [failing, needs('second', ['sonarr.first']), needs('third', [])],
            },
          }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, { stack: stackOf(wired) });
    const failure = await run.catch((thrown: unknown) => thrown);
    // What failed, and apart from it, what was skipped for it.
    expect((failure as WiringFailed).message).toBe(
      'the wiring failed for sonarr.first; skipped sonarr.second, which needs what failed',
    );
    expect(
      actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
    ).toEqual([
      'sonarr.first failed ',
      'sonarr.second skipped sonarr.first failed',
      'sonarr.third done created',
    ]);
  });

  it('skips what needs a resource that was skipped, and says which', async () => {
    const failing: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: (api) => api.get('/api/v3/missing', z.unknown()).then(() => undefined),
    };
    const needs = (name: string, requires: string[]): ResourceSpec => ({
      ...FAKE_LOGIN,
      name,
      requires,
    });
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [
                failing,
                needs('second', ['sonarr.first']),
                needs('third', ['sonarr.second']),
              ],
            },
          }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, { stack: stackOf(wired) });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).message).toBe(
      'the wiring failed for sonarr.first; skipped sonarr.second, sonarr.third, which need what failed',
    );
    expect(
      actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
    ).toEqual([
      'sonarr.first failed ',
      'sonarr.second skipped sonarr.first failed',
      'sonarr.third skipped sonarr.second was skipped',
    ]);
  });

  it('skips the resources of an app whose first-run setup waits, and what needs them, asking it nothing', async () => {
    // Jellyfin, after Sonarr, holds a resource that needs Sonarr's login.
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'jellyfin'
        ? {
            ...def,
            api: FIXTURE_API,
            integration: {
              after: ['sonarr'],
              resources: [
                { ...FAKE_LOGIN, name: 'needs', requires: ['sonarr.login'] },
                { ...FAKE_LOGIN, name: 'free' },
              ],
            },
          }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(
      {
        seams: sonarr.seams,
        addresses: { ...sonarr.addresses, 'fake-jellyfin': '127.0.0.1' },
      },
      {
        stack: stackOf(wired),
        store: {
          version: 1,
          apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
          shared: { adminPassword: PASSWORD },
        },
        waiting: ['sonarr'],
      },
    );
    expect(await run).toEqual(['jellyfin.free created']);
    expect(
      actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
    ).toEqual([
      "sonarr.login skipped sonarr's first-run setup waits",
      'jellyfin.needs skipped sonarr.login was skipped',
      'jellyfin.free done created',
    ]);
    // Only Jellyfin's calls: its key check, then its free resource.
    expect(sonarr.app.requests.every((r) => r.headers.host === 'jellyfin:8096')).toBe(
      true,
    );
  });

  it('says apart what waits for a first-run setup and what needs what failed, when another resource fails', async () => {
    const wired = WIRED_CATALOG.map((def) => {
      if (def.id === 'sonarr') {
        return {
          ...def,
          integration: {
            after: [],
            resources: [
              {
                ...FAKE_LOGIN,
                create: () =>
                  Promise.reject(new AppApiError('fake refusal', { kind: 'rejected' })),
              },
              { ...FAKE_LOGIN, name: 'second', requires: ['sonarr.login'] },
            ],
          },
        };
      }
      return def.id === 'jellyfin'
        ? {
            ...def,
            api: FIXTURE_API,
            integration: {
              after: ['sonarr'],
              resources: [
                { ...FAKE_LOGIN, name: 'needs', requires: ['sonarr.login'] },
                { ...FAKE_LOGIN, name: 'free' },
              ],
            },
          }
        : def;
    });
    const sonarr = await fakeSonarr({ key: KEY });
    const { run } = await wireWith(
      {
        seams: sonarr.seams,
        addresses: { ...sonarr.addresses, 'fake-jellyfin': '127.0.0.1' },
      },
      {
        stack: stackOf(wired),
        store: {
          version: 1,
          apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
          shared: { adminPassword: PASSWORD },
        },
        waiting: ['jellyfin'],
      },
    );
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).message).toBe(
      'the wiring failed for sonarr.login; skipped sonarr.second, which needs what failed; skipped jellyfin.needs, jellyfin.free, which wait for a first-run setup',
    );
    // A setup that failed, rather than one that waits, is said so.
    const sonarrAgain = await fakeSonarr({ key: KEY });
    const failed = await wireWith(
      {
        seams: sonarrAgain.seams,
        addresses: { ...sonarrAgain.addresses, 'fake-jellyfin': '127.0.0.1' },
      },
      {
        stack: stackOf(wired),
        store: {
          version: 1,
          apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
          shared: { adminPassword: PASSWORD },
        },
        failed: ['jellyfin'],
      },
    );
    expect(
      ((await failed.run.catch((thrown: unknown) => thrown)) as WiringFailed).message,
    ).toBe(
      "the wiring failed for sonarr.login; skipped sonarr.second, which needs what failed; skipped jellyfin.needs, jellyfin.free, whose app's first-run setup failed",
    );
    expect(failed.actions.find((a) => a.resource === 'jellyfin.free')?.detail).toBe(
      "jellyfin's first-run setup failed",
    );
  });

  it("names the app whose setup failed for a resource that needs one of that app's", async () => {
    // Sonarr's setup failed; Jellyfin's `needs` requires sonarr.login, and `breaks` fails.
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'jellyfin'
        ? {
            ...def,
            api: FIXTURE_API,
            integration: {
              after: ['sonarr'],
              resources: [
                { ...FAKE_LOGIN, name: 'needs', requires: ['sonarr.login'] },
                {
                  ...FAKE_LOGIN,
                  name: 'breaks',
                  create: () =>
                    Promise.reject(new AppApiError('fake refusal', { kind: 'rejected' })),
                },
              ],
            },
          }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(
      {
        seams: sonarr.seams,
        addresses: { ...sonarr.addresses, 'fake-jellyfin': '127.0.0.1' },
      },
      {
        stack: stackOf(wired),
        store: {
          version: 1,
          apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
          shared: { adminPassword: PASSWORD },
        },
        failed: ['sonarr'],
      },
    );
    const failure = (await run.catch((thrown: unknown) => thrown)) as WiringFailed;
    expect(failure.message).toBe(
      "the wiring failed for jellyfin.breaks; skipped sonarr.login, whose app's first-run setup failed; skipped jellyfin.needs, which needs sonarr, whose first-run setup failed",
    );
    expect(actions.find((a) => a.resource === 'jellyfin.needs')?.detail).toBe(
      'sonarr.login was skipped',
    );
  });

  it('says so when there is no wiring network after the start, and asks no app', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, { join: 'no-network' });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(WiringFailed);
    expect((failure as WiringFailed).message).toBe(
      'the stack has no wiring network, though apply has just started it',
    );
    expect((failure as WiringFailed).hint).toBe(
      `run "docker network ls" and look for mediaplane_wiring (<project>_wiring under another project name); a compose.override.yaml that sets the apps' networks can drop it. Then run apply again. See ${RUNBOOK}`,
    );
    expect((failure as WiringFailed).diagnostics).toEqual([]);
    expect(actions).toEqual([]);
    expect(sonarr.app.requests).toEqual([]);
  });

  it.each([
    [
      new WiringRefused('refusing to join fake_wiring: it is not internal'),
      'wire.network',
    ],
    [
      new OwnContainerUnknown("Mediaplane can't tell which container it runs in"),
      'wire.network',
    ],
    [
      new JoinFailed('could not join the wiring network fake_wiring: fake'),
      'wire.network',
    ],
    [new RuntimeError('docker network inspect failed: fake'), 'docker.unavailable'],
  ])('says what to do when the join fails (%s), and asks no app', async (cause, code) => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, {
      join: () => {
        throw cause;
      },
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(WiringFailed);
    expect((failure as WiringFailed).message).toBe(
      'Mediaplane could not reach the apps, so nothing was wired',
    );
    expect((failure as WiringFailed).hint).toBe(
      `the error above says why Mediaplane couldn't reach the apps; nothing was changed in them. Fix it, then run apply again. See ${RUNBOOK}`,
    );
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({ code, message: cause.message }),
    ]);
    expect(actions).toEqual([]);
    expect(sonarr.app.requests).toEqual([]);
  });

  it('says so when Docker cannot say where the apps are', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run } = await wireWith(sonarr, {
      runtime: {
        ...fakeRuntime({ containers: RUNNING }),
        wiringAddresses: () => Promise.reject(new RuntimeError('docker inspect failed')),
      },
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'docker inspect failed',
      }),
    ]);
  });

  it("fails each resource of an app that isn't on the wiring network", async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith({ ...sonarr, addresses: {} });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({ code: 'wire.not-on-network' }),
    ]);
    expect(actions).toEqual([
      {
        step: 'wire',
        resource: 'sonarr.login',
        result: 'failed',
        error:
          "sonarr's container is not on the stack's wiring network, so Mediaplane can't reach it",
      },
    ]);
    expect(sonarr.app.requests).toEqual([]);
  });

  it("reads resources.json again, and leaves one it can't read as it is", async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const home = await tempDir('mediaplane-wire-');
    await mkdir(join(home, STATE_DIR), { recursive: true });
    const unreadable = '{"schema": "mediaplane.resources/v1", "resources": {';
    await writeFile(join(home, RESOURCES_PATH), unreadable);
    const { run, actions, calls } = await wireWith(sonarr, { home });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).message).toBe(
      'state/resources.json could not be read, so nothing was wired',
    );
    expect((failure as WiringFailed).hint).toBe(
      `state/resources.json was left as it is; fix it or move it aside as the error above says, then run apply again. See ${RUNBOOK}`,
    );
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({
        code: 'resources.invalid',
        message: `${join(home, RESOURCES_PATH)} is not valid JSON`,
      }),
    ]);
    expect(await readFile(join(home, RESOURCES_PATH), 'utf8')).toBe(unreadable);
    expect(actions).toEqual([]);
    expect(calls).toEqual([]);
    expect(sonarr.app.requests).toEqual([]);
  });

  it.each([
    ['is', 'admin'],
    ['holds', 'dmi'],
  ])(
    "never keeps a managed field that %s one of the stack's secrets, and sends nothing for it",
    async (_how, secret) => {
      // The user name "admin" is, or holds, a value of .env.
      const sonarr = await fakeSonarr({ key: KEY });
      const { run, home, actions } = await wireWith(sonarr, {
        values: { MP_FAKE_TOKEN: secret },
      });
      const failure = await run.catch((thrown: unknown) => thrown);
      expect((failure as WiringFailed).diagnostics).toEqual([
        expect.objectContaining({ code: 'wire.secret-field' }),
      ]);
      expect(actions).toEqual([
        {
          step: 'wire',
          resource: 'sonarr.login',
          result: 'failed',
          error:
            "sonarr.login.user holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value",
        },
      ]);
      // Only the app's own check: the resource was neither looked at nor changed.
      expect(sonarr.app.requests.map((r) => r.path)).toEqual([
        '/ping',
        '/api/v3/system/status',
      ]);
      await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
    },
  );

  /** Sonarr with one resource that the app holds none of, and that needs `folders`. */
  function needingFolders(folders: readonly string[]) {
    const login: ResourceSpec = {
      ...FAKE_LOGIN,
      desired: (ctx) => {
        const desired = FAKE_LOGIN.desired(ctx);
        return desired && { ...desired, folders };
      },
    };
    return stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr'
          ? { ...def, integration: { after: [], resources: [login] } }
          : def,
      ),
    );
  }

  it("makes the folders a resource needs before it creates it, as the stack's user, in the app's own container", async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const calls: string[] = [];
    const commands: OneOffCommand[] = [];
    // One log, in order, of the app's requests and the runtime's mkdir.
    const log: string[] = [];
    const catchUp = () => {
      const seen = log.filter((entry) => entry !== 'mkdir').length;
      log.push(...sonarr.app.requests.slice(seen).map((r) => `${r.method} ${r.path}`));
    };
    const { run } = await wireWith(sonarr, {
      stack: needingFolders(['/data/media/tv']),
      values: { MP_FAKE: 'fake-env-secret' },
      runtime: fakeRuntime({
        containers: RUNNING,
        addresses: sonarr.addresses,
        calls,
        run: (_service, command) => {
          catchUp();
          log.push('mkdir');
          commands.push(command);
          return { code: 0, stdout: '', stderr: '' };
        },
      }),
    });
    expect(await run).toEqual(['sonarr.login created']);
    catchUp();
    // Made first, once the app was found to hold none, then created.
    expect(log).toEqual([
      'GET /ping',
      'GET /api/v3/system/status',
      'GET /api/v3/login',
      'mkdir',
      'PUT /api/v3/login',
    ]);
    // The fixture stack runs as the default user, 1000:1000.
    expect(calls).toContain('run sonarr mkdir as 1000:1000');
    expect(commands).toEqual([
      expect.objectContaining({
        user: { uid: 1000, gid: 1000 },
        entrypoint: 'mkdir',
        args: ['-p', '--', '/data/media/tv'],
      }),
    ]);
    // Every secret the stack knows is kept out of what it prints, not only .env's.
    expect(Object.values(commands[0]?.values ?? {})).toEqual(
      expect.arrayContaining(['fake-env-secret', KEY, PASSWORD]),
    );
    expect(sonarr.state.user).toBe('admin');
  });

  it('makes the folders a resource needs before it updates it, and none for one unchanged', async () => {
    const wrong = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    const commands: OneOffCommand[] = [];
    const runtime = () =>
      fakeRuntime({
        containers: RUNNING,
        addresses: wrong.addresses,
        run: (_service, command) => {
          commands.push(command);
          return { code: 0, stdout: '', stderr: '' };
        },
      });
    const stack = needingFolders(['/data/media/tv']);
    const updated = await wireWith(wrong, { stack, known: RECORDED, runtime: runtime() });
    expect(await updated.run).toEqual(['sonarr.login updated user']);
    expect(commands.map((c) => c.args)).toEqual([['-p', '--', '/data/media/tv']]);
    const right = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const same = await wireWith(right, { stack, known: RECORDED, runtime: runtime() });
    expect(await same.run).toEqual([]);
    expect(commands).toHaveLength(1);
  });

  it("fails a resource whose folders can't be made, saying why, and sends nothing for it", async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions, home } = await wireWith(sonarr, {
      stack: needingFolders(['/data/media/tv']),
      runtime: fakeRuntime({
        containers: RUNNING,
        addresses: sonarr.addresses,
        run: () => ({
          code: 1,
          stdout: '',
          stderr:
            " Container mediaplane-sonarr-run-0 Creating\nmkdir: can't create directory '/data/media/tv': Permission denied\n",
        }),
      }),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    const said =
      "could not make /data/media/tv for sonarr.login: mkdir in a throwaway sonarr container exited 1: mkdir: can't create directory '/data/media/tv': Permission denied";
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({ code: 'wire.folders', message: said }),
    ]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'failed', error: said },
    ]);
    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
    await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
  });

  it('fails only that resource when Docker fails to make its folders', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, {
      stack: needingFolders(['/data/media/tv']),
      runtime: fakeRuntime({
        containers: RUNNING,
        addresses: sonarr.addresses,
        run: () => {
          throw new RuntimeError(`docker compose run timed out after 300 s (${KEY})`);
        },
      }),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    const said =
      'could not make /data/media/tv for sonarr.login: docker compose run timed out after 300 s (***)';
    // The step goes on, and fails with the resource, as when the app refuses it.
    expect((failure as WiringFailed).message).toBe('the wiring failed for sonarr.login');
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({ code: 'wire.folders', message: said }),
    ]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'failed', error: said },
    ]);
    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('says only how mkdir exited when it fails with nothing on stderr', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, {
      stack: needingFolders(['/data/media/tv']),
      runtime: fakeRuntime({
        containers: RUNNING,
        addresses: sonarr.addresses,
        run: () => ({ code: 1, stdout: '', stderr: '\n' }),
      }),
    });
    await run.catch(() => undefined);
    expect(actions).toEqual([
      {
        step: 'wire',
        resource: 'sonarr.login',
        result: 'failed',
        error:
          'could not make /data/media/tv for sonarr.login: mkdir in a throwaway sonarr container exited 1',
      },
    ]);
  });

  it("stops the step at an error that isn't Docker's, as a bug, not a failure to make the folders", async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const bug = new TypeError('fake bug');
    const { run, actions } = await wireWith(sonarr, {
      stack: needingFolders(['/data/media/tv']),
      runtime: fakeRuntime({
        containers: RUNNING,
        addresses: sonarr.addresses,
        run: () => {
          throw bug;
        },
      }),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(WiringFailed);
    expect((failure as WiringFailed).message).toBe('fake bug');
    // Not said to be Docker's: no wire.folders, which says to look at the stack's mounts.
    expect((failure as WiringFailed).diagnostics).toEqual([]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'failed', error: 'fake bug' },
    ]);
    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it("keeps every secret out of a failure's message, whoever wrote it", async () => {
    // A resource's own AppApiError, and a mkdir whose stderr the runtime didn't redact:
    // the wire step redacts what it records, not only what the client and runtime say.
    const own: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: () =>
        Promise.reject(
          new AppApiError(`Sonarr would not take ${KEY}`, { kind: 'rejected' }),
        ),
    };
    const folders: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'second',
      desired: (ctx) => {
        const desired = FAKE_LOGIN.desired(ctx);
        return desired && { ...desired, folders: ['/data/media/tv'] };
      },
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, {
      stack: stackOf(
        WIRED_CATALOG.map((def) =>
          def.id === 'sonarr'
            ? { ...def, integration: { after: [], resources: [own, folders] } }
            : def,
        ),
      ),
      runtime: fakeRuntime({
        containers: RUNNING,
        addresses: sonarr.addresses,
        run: () => ({
          code: 1,
          stdout: '',
          stderr: `mkdir: ${PASSWORD}: Permission denied`,
        }),
      }),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).diagnostics.map((d) => d.message)).toEqual([
      'Sonarr would not take ***',
      'could not make /data/media/tv for sonarr.second: mkdir in a throwaway sonarr container exited 1: mkdir: ***: Permission denied',
    ]);
    expect(actions.map((a) => a.error)).toEqual([
      'Sonarr would not take ***',
      'could not make /data/media/tv for sonarr.second: mkdir in a throwaway sonarr container exited 1: mkdir: ***: Permission denied',
    ]);
    expect(JSON.stringify([failure, actions])).not.toMatch(
      new RegExp(`${KEY}|${PASSWORD}`),
    );
  });

  it('keeps a secret a resource read in an answer out of every failure after it, and out of the change record', async () => {
    const HELD = 'e'.repeat(32);
    const reads: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: (api) => {
        api.addSecret(HELD);
        return Promise.reject(
          new AppApiError(`Sonarr holds ${HELD}`, { kind: 'rejected' }),
        );
      },
    };
    // An error that isn't the app's stops the step: its message is redacted too.
    const bug: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () => Promise.reject(new Error(`a bug, near ${HELD}`)),
    };
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, {
      stack: stackOf(
        WIRED_CATALOG.map((def) =>
          def.id === 'sonarr'
            ? { ...def, integration: { after: [], resources: [reads, bug] } }
            : def,
        ),
      ),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).message).toBe('a bug, near ***');
    expect((failure as WiringFailed).diagnostics.map((d) => d.message)).toEqual([
      'Sonarr holds ***',
    ]);
    expect(actions.map((a) => a.error)).toEqual(['Sonarr holds ***', 'a bug, near ***']);
    expect(JSON.stringify([failure, actions])).not.toContain(HELD);
  });

  it('makes no folder for a resource the app already holds', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const calls: string[] = [];
    const { run } = await wireWith(sonarr, {
      stack: needingFolders(['/data/media/tv']),
      runtime: fakeRuntime({ containers: RUNNING, addresses: sonarr.addresses, calls }),
    });
    expect(await run).toEqual(['sonarr.login adopted']);
    expect(calls.some((call) => call.startsWith('run '))).toBe(false);
  });

  it('keeps only the managed fields in resources.json', async () => {
    // desired() gives a field the spec doesn't manage: it goes to the app, but isn't kept.
    const extra: ResourceSpec = {
      ...FAKE_LOGIN,
      desired: (ctx) => {
        const desired = FAKE_LOGIN.desired(ctx);
        return desired && { ...desired, fields: { ...desired.fields, theme: 'dark' } };
      },
    };
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [extra] } }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, home } = await wireWith(sonarr, { stack: stackOf(wired) });
    expect(await run).toEqual(['sonarr.login created']);
    expect((await readResources(home))['sonarr.login']?.fields).toEqual({
      user: 'admin',
    });
  });

  /**
   * Sonarr with three resources: one the app refuses, one it takes, and a third that is
   * always made anew, with `create`.
   */
  function threeResources(create: ResourceSpec['create']) {
    const refused: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: (api) => api.get('/api/v3/missing', z.unknown()).then(() => undefined),
    };
    const resources: ResourceSpec[] = [
      refused,
      { ...FAKE_LOGIN, name: 'second' },
      { ...FAKE_LOGIN, name: 'third', observe: () => Promise.resolve(undefined), create },
    ];
    return stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
      ),
    );
  }

  it("fails the resource an error that isn't the app's hit, and keeps what failed before", async () => {
    const bug = new Error(`a bug in a resource, near ${PASSWORD}`);
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, home, actions } = await wireWith(sonarr, {
      stack: threeResources(() => Promise.reject(bug)),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(WiringFailed);
    // Not even as its cause, which util.inspect would print.
    expect((failure as WiringFailed).cause).toBeUndefined();
    expect(inspect(failure)).not.toContain(PASSWORD);
    expect((failure as WiringFailed).message).toBe('a bug in a resource, near ***');
    // The step's own hint, for what Mediaplane can't explain.
    expect((failure as WiringFailed).hint).toBeUndefined();
    // The refused one's diagnostic is still there.
    expect((failure as WiringFailed).diagnostics.map((d) => d.code)).toEqual([
      'wire.rejected',
    ]);
    expect(actions.map((a) => `${a.resource ?? ''} ${a.result}`)).toEqual([
      'sonarr.first failed',
      'sonarr.second done',
      'sonarr.third failed',
    ]);
    expect(actions[2]?.error).toBe('a bug in a resource, near ***');
    // Written straight after it was made, before the third failed.
    expect(Object.keys(await readResources(home))).toEqual(['sonarr.second']);
  });

  it("fails the resource whose record can't be written, and keeps what failed before", async () => {
    const home = await tempDir('mediaplane-wire-');
    const path = join(home, RESOURCES_PATH);
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, {
      home,
      // Once the second is recorded, a folder takes the file's place: the third's write
      // fails, as a full disk or a folder this user can't write would make it.
      stack: threeResources(async (api, desired) => {
        await rm(path);
        await mkdir(join(path, 'in-the-way'), { recursive: true });
        return FAKE_LOGIN.create(api, desired);
      }),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    // Sonarr took the third: the record says so, as well as what couldn't be saved. (The
    // fixture names each app by its id.)
    const said = `sonarr has it, but state/resources.json could not be saved: cannot write ${path} (EISDIR)`;
    expect((failure as WiringFailed).message).toBe(said);
    expect((failure as WiringFailed).diagnostics.map((d) => d.code)).toEqual([
      'wire.rejected',
    ]);
    expect(actions.map((a) => `${a.resource ?? ''} ${a.result}`)).toEqual([
      'sonarr.first failed',
      'sonarr.second done',
      'sonarr.third failed',
    ]);
    expect(actions[2]?.error).toBe(said);
  });

  it("says the app took an update whose record can't be saved", async () => {
    const home = await tempDir('mediaplane-wire-');
    const path = join(home, RESOURCES_PATH);
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    const login: ResourceSpec = {
      ...FAKE_LOGIN,
      // Once wire has read resources.json, a folder takes its place.
      async update(api, desired, observed) {
        await mkdir(join(path, 'in-the-way'), { recursive: true });
        await FAKE_LOGIN.update(api, desired, observed);
      },
    };
    const { run, actions } = await wireWith(sonarr, {
      home,
      stack: stackOf(
        WIRED_CATALOG.map((def) =>
          def.id === 'sonarr'
            ? { ...def, integration: { after: [], resources: [login] } }
            : def,
        ),
      ),
    });
    const failure = await run.catch((thrown: unknown) => thrown);
    const said = `sonarr has it, but state/resources.json could not be saved: cannot write ${path} (EISDIR)`;
    expect((failure as WiringFailed).message).toBe(said);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'failed', error: said },
    ]);
    expect(sonarr.state).toMatchObject({ user: 'admin', password: PASSWORD });
  });

  it('gives the stack its own secret in place of one the app made itself, once, and records that it did', async () => {
    const own: ResourceSpec = { ...FAKE_LOGIN, adoptSets: ['password'] };
    const stack = stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr'
          ? { ...def, integration: { after: [], resources: [own] } }
          : def,
      ),
    );
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'its-own' });
    const first = await wireWith(sonarr, { stack, known: RECORDED });
    expect(await first.run).toEqual(['sonarr.login updated password']);
    expect(sonarr.state.password).toBe(PASSWORD);
    expect((await readResources(first.home))['sonarr.login']?.given).toEqual([
      'password',
    ]);
    const again = await wireWith(sonarr, {
      stack,
      known: await readResources(first.home),
    });
    expect(await again.run).toEqual([]);
  });

  it('removes what Mediaplane made that the stack no longer wants, while still as made, and forgets its record', async () => {
    const left = leftOver({ 7: 'gone', 8: 'mine' });
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const { run, home, actions } = await wireWith(sonarr, {
      stack: left.stack,
      known: {
        ...RECORDED,
        'sonarr.gone': made(7, 'gone'),
        // Renamed in the app since: maybe yours, so it stays.
        'sonarr.renamed': made(8, 'renamed'),
        // Gone from the app already: nothing to remove, and its record is forgotten, so
        // that a resource of yours given its id and name later is never taken for it.
        'sonarr.vanished': made(9, 'vanished'),
      },
    });
    expect(await run).toEqual(['sonarr.gone removed']);
    expect(left.removed).toEqual([7]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
      { step: 'wire', resource: 'sonarr.gone', result: 'done', detail: 'removed' },
    ]);
    expect(Object.keys(await readResources(home))).toEqual([
      'sonarr.login',
      'sonarr.renamed',
    ]);
  });

  it('keeps the record of what it could not tell the app no longer holds', async () => {
    const known = { ...RECORDED, 'sonarr.vanished': made(9, 'vanished') };
    const timedOut = new AppApiError('Sonarr at http://sonarr:8989 timed out', {
      kind: 'timeout',
    });
    const asked = leftOver({}, undefined, undefined, () => Promise.reject(timedOut));
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const unsure = await wireWith(sonarr, { stack: asked.stack, known });
    const failure = await unsure.run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).message).toBe(
      'the wiring failed for sonarr.vanished',
    );
    expect(Object.keys(await readResources(unsure.home))).toEqual([
      'sonarr.login',
      'sonarr.vanished',
    ]);
    // An error that isn't the app's stops the step, with the record kept as well.
    const bug = leftOver({}, undefined, undefined, () =>
      Promise.reject(new Error('a bug, near the vanished resource')),
    );
    const stopped = await wireWith(
      await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
      { stack: bug.stack, known },
    );
    const stop = await stopped.run.catch((thrown: unknown) => thrown);
    expect((stop as WiringFailed).message).toBe('a bug, near the vanished resource');
    expect(Object.keys(await readResources(stopped.home))).toEqual([
      'sonarr.login',
      'sonarr.vanished',
    ]);
  });

  it('says what the plan listed for removal that now stays, keeping it and its record, and says nothing of what it never listed', async () => {
    const holding = `it holds 2 torrents, ${PASSWORD}`;
    const left = leftOver({ 7: 'gone', 8: 'mine' }, undefined, (_api, observed) =>
      Promise.resolve(observed.id === 7 ? holding : undefined),
    );
    const known = {
      ...RECORDED,
      'sonarr.gone': made(7, 'gone'),
      'sonarr.renamed': made(8, 'renamed'),
    };
    const planned = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const listed = await wireWith(planned, {
      stack: left.stack,
      known,
      planned: [
        { resource: 'sonarr.gone', action: 'remove' },
        { resource: 'sonarr.renamed', action: 'remove' },
      ],
    });
    expect(await listed.run).toEqual([]);
    expect(left.removed).toEqual([]);
    expect(listed.actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
      {
        step: 'wire',
        resource: 'sonarr.gone',
        result: 'skipped',
        detail: 'it holds 2 torrents, ***',
      },
      {
        step: 'wire',
        resource: 'sonarr.renamed',
        result: 'skipped',
        detail:
          "it is no longer as Mediaplane made it (its name or its id in the app has changed), so it may be yours: Mediaplane doesn't remove it",
      },
    ]);
    expect(Object.keys(await readResources(listed.home))).toEqual([
      'sonarr.gone',
      'sonarr.login',
      'sonarr.renamed',
    ]);
    // Never listed by the plan: apply leaves it as plan and drift said, without a word.
    const unlisted = await wireWith(
      await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
      { stack: left.stack, known },
    );
    expect(await unlisted.run).toEqual([]);
    expect(unlisted.actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
    ]);
  });

  it('removes only what the plan listed for removal, when it is given, and what is as made otherwise', async () => {
    const known = {
      ...RECORDED,
      'sonarr.gone': made(7, 'gone'),
      'sonarr.renamed': made(8, 'renamed'),
    };
    // Both are as made now, but the plan showed `renamed` as staying, or couldn't say.
    for (const shown of [
      [],
      [{ resource: 'sonarr.renamed', action: 'unknown' as const, reason: 'no' }],
    ]) {
      const left = leftOver({ 7: 'gone', 8: 'renamed' });
      const listed = await wireWith(
        await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
        {
          stack: left.stack,
          known,
          planned: [{ resource: 'sonarr.gone', action: 'remove' }, ...shown],
        },
      );
      expect(await listed.run).toEqual(['sonarr.gone removed']);
      expect(left.removed).toEqual([7]);
      expect(Object.keys(await readResources(listed.home))).toEqual([
        'sonarr.login',
        'sonarr.renamed',
      ]);
    }
    // No plan given: everything as made goes.
    const all = leftOver({ 7: 'gone', 8: 'renamed' });
    const unplanned = await wireWith(
      await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
      { stack: all.stack, known },
    );
    expect(await unplanned.run).toEqual([
      'sonarr.gone removed',
      'sonarr.renamed removed',
    ]);
    expect(all.removed).toEqual([7, 8]);
  });

  it('removes what the plan listed to check after the start, and says when it now stays', async () => {
    const holding = 'it holds 2 torrents';
    const left = leftOver({ 7: 'gone', 8: 'renamed' }, undefined, (_api, observed) =>
      Promise.resolve(observed.id === 8 ? holding : undefined),
    );
    const listed = await wireWith(
      await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
      {
        stack: left.stack,
        known: {
          ...RECORDED,
          'sonarr.gone': made(7, 'gone'),
          'sonarr.renamed': made(8, 'renamed'),
        },
        planned: [
          { resource: 'sonarr.gone', action: 'after-start' },
          { resource: 'sonarr.renamed', action: 'after-start' },
        ],
      },
    );
    expect(await listed.run).toEqual(['sonarr.gone removed']);
    expect(listed.actions.slice(1)).toEqual([
      { step: 'wire', resource: 'sonarr.gone', result: 'done', detail: 'removed' },
      { step: 'wire', resource: 'sonarr.renamed', result: 'skipped', detail: holding },
    ]);
    expect(Object.keys(await readResources(listed.home))).toEqual([
      'sonarr.login',
      'sonarr.renamed',
    ]);
  });

  it.each([
    ['remove' as const, 'waiting' as const, "sonarr's first-run setup waits"],
    ['after-start' as const, 'waiting' as const, "sonarr's first-run setup waits"],
    [
      'remove' as const,
      'held' as const,
      "sonarr's first-run setup is held: the app it signs in to doesn't have the admin password Mediaplane holds",
    ],
    ['after-start' as const, 'failed' as const, "sonarr's first-run setup failed"],
  ])(
    'skips a removal the plan listed (%s) with an app whose setup is %s, without asking it',
    async (action, why, detail) => {
      const left = leftOver({ 7: 'gone' });
      const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
      const { run, actions, home } = await wireWith(sonarr, {
        stack: left.stack,
        known: { ...RECORDED, 'sonarr.gone': made(7, 'gone') },
        planned: [{ resource: 'sonarr.gone', action }],
        [why]: ['sonarr'],
      });
      // What waits or is held is skipped, not failed.
      expect(await run).toEqual([]);
      expect(
        actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
      ).toEqual([`sonarr.login skipped ${detail}`, `sonarr.gone skipped ${detail}`]);
      expect(left.removed).toEqual([]);
      expect(sonarr.app.requests).toEqual([]);
      expect(Object.keys(await readResources(home))).toEqual([
        'sonarr.gone',
        'sonarr.login',
      ]);
    },
  );

  it("stops, keeping the record, on an error that isn't the app's, and when the record can't be saved after a removal", async () => {
    const bug = new Error(`a bug in remove, near ${PASSWORD}`);
    const known = { ...RECORDED, 'sonarr.gone': made(7, 'gone') };
    const buggy = leftOver({ 7: 'gone' }, () => Promise.reject(bug));
    const stopped = await wireWith(
      await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
      { stack: buggy.stack, known },
    );
    const failure = await stopped.run.catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(WiringFailed);
    expect((failure as WiringFailed).message).toBe('a bug in remove, near ***');
    expect((failure as WiringFailed).cause).toBeUndefined();
    expect(stopped.actions.at(-1)).toEqual({
      step: 'wire',
      resource: 'sonarr.gone',
      result: 'failed',
      error: 'a bug in remove, near ***',
    });
    expect(Object.keys(await readResources(stopped.home))).toEqual([
      'sonarr.gone',
      'sonarr.login',
    ]);
    // The app removes it, then a folder takes resources.json's place.
    const home = await tempDir('mediaplane-wire-');
    const path = join(home, RESOURCES_PATH);
    await writeResources(home, known);
    const left = leftOver({ 7: 'gone' }, async () => {
      await rm(path);
      await mkdir(join(path, 'in-the-way'), { recursive: true });
    });
    const unsaved = await wireWith(
      await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD }),
      { home, stack: left.stack },
    );
    const lost = await unsaved.run.catch((thrown: unknown) => thrown);
    const said = `sonarr no longer holds it, but state/resources.json could not be saved: cannot write ${path} (EISDIR)`;
    expect((lost as WiringFailed).message).toBe(said);
    expect(unsaved.actions.at(-1)).toEqual({
      step: 'wire',
      resource: 'sonarr.gone',
      result: 'failed',
      error: said,
    });
  });

  it('fails a removal the app refuses, keeping its record, and each the plan named in an app it cannot reach', async () => {
    const refusal = new AppApiError('Sonarr at http://sonarr:8989 refused it', {
      kind: 'rejected',
      status: 400,
    });
    const left = leftOver({ 7: 'gone' }, () => Promise.reject(refusal));
    const known = { ...RECORDED, 'sonarr.gone': made(7, 'gone') };
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const refused = await wireWith(sonarr, { stack: left.stack, known });
    const failure = await refused.run.catch((thrown: unknown) => thrown);
    expect((failure as WiringFailed).message).toBe('the wiring failed for sonarr.gone');
    expect(refused.actions.at(-1)).toEqual({
      step: 'wire',
      resource: 'sonarr.gone',
      result: 'failed',
      error: 'Sonarr at http://sonarr:8989 refused it',
    });
    expect(Object.keys(await readResources(refused.home))).toEqual([
      'sonarr.gone',
      'sonarr.login',
    ]);
    // The app refuses Mediaplane's key: what the plan said it removes fails with it.
    const refusing = await fakeSonarr({ key: 'f'.repeat(32) });
    const unreached = await wireWith(refusing, {
      stack: left.stack,
      known,
      planned: [{ resource: 'sonarr.gone', action: 'remove' }],
    });
    const cause = await unreached.run.catch((thrown: unknown) => thrown);
    expect((cause as WiringFailed).message).toBe(
      'the wiring failed for sonarr.login, sonarr.gone',
    );
    expect(left.removed).toEqual([]);
  });
});

/** A record of a resource Mediaplane made in Sonarr, as `id` named `name`. */
function made(id: number, name: string): KnownResource {
  return { ...(RECORDED['sonarr.login'] as KnownResource), id, name };
}

/**
 * The wiring stack, with Sonarr's FAKE_LOGIN and three resources it no longer wants,
 * `gone`, `renamed` and `vanished`, which Sonarr holds as `held` says, by id: each one
 * removed goes from `held` into `removed`, unless `remove` is given.
 */
function leftOver(
  held: Record<number, string>,
  remove?: ResourceSpec['remove'],
  cannotRemove?: ResourceSpec['cannotRemove'],
  observing?: ResourceSpec['observe'],
): { stack: ReturnType<typeof stackOf>; removed: number[] } {
  const removed: number[] = [];
  const holds = new Map(Object.entries(held).map(([id, name]) => [Number(id), name]));
  const spec = (name: string): ResourceSpec => ({
    ...FAKE_LOGIN,
    name,
    desired: () => undefined,
    observe:
      observing ??
      ((_api, known) => {
        const id = Number(known?.id);
        const holding = holds.get(id);
        return Promise.resolve(
          holding === undefined ? undefined : { id, name: holding, fields: {} },
        );
      }),
    ...(cannotRemove === undefined ? {} : { cannotRemove }),
    remove:
      remove ??
      ((_api, observed) => {
        removed.push(Number(observed.id));
        holds.delete(Number(observed.id));
        return Promise.resolve();
      }),
  });
  const resources = [FAKE_LOGIN, spec('gone'), spec('renamed'), spec('vanished')];
  return {
    stack: stackOf(
      WIRED_CATALOG.map((def) =>
        def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
      ),
    ),
    removed,
  };
}
