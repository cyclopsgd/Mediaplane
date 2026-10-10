import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ActionResult } from '../history/records';
import { RESOURCES_PATH, STATE_DIR } from '../paths';
import { OwnContainerUnknown, WiringRefused } from '../runtime/docker';
import { RuntimeError } from '../runtime/types';
import { fakeRuntime, type FakeRuntimeOptions } from '../testing/fakes';
import { tempDir } from '../testing/temp';
import {
  FAKE_LOGIN,
  fakeSonarr,
  WIRED_CATALOG,
  WIRING_RUNNING as RUNNING,
  wiringStack as stackOf,
} from '../testing/wiring';
import { readResources, writeResources, type KnownResources } from './resources';
import type { ResourceSpec } from './types';
import { wire, WiringFailed, type WireOptions } from './wire';
import type { WiringSeams } from './wiring';

const KEY = '0'.repeat(32);
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
  } = {},
) {
  const { seams, addresses } = fake;
  const home = await tempDir('mediaplane-wire-');
  const actions: ActionResult[] = [];
  const calls: string[] = [];
  const { join: joined = 'not-needed', known, ...rest } = extra;
  if (known !== undefined) await writeResources(home, known);
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

  it('updates what differs, saying what, and adopts what is already right', async () => {
    const wrong = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    const updated = await wireWith(wrong, { known: RECORDED });
    expect(await updated.run).toEqual(['sonarr.login updated user, password']);
    expect(wrong.state).toMatchObject({ user: 'admin', password: PASSWORD });

    const right = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const adopted = await wireWith(right);
    expect(await adopted.run).toEqual(['sonarr.login adopted']);
    expect(right.app.requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(await readResources(adopted.home)).toEqual(RECORDED);
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
    await expect(run).rejects.toBeInstanceOf(WiringFailed);
    expect(
      actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
    ).toEqual([
      'sonarr.first failed ',
      'sonarr.second skipped sonarr.first failed',
      'sonarr.third done created',
    ]);
  });

  it('says so when there is no wiring network after the start', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run } = await wireWith(sonarr, { join: 'no-network' });
    await expect(run).rejects.toThrow(
      'the stack has no wiring network, though apply has just started it',
    );
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

  it("never keeps a managed field that is one of the stack's secrets", async () => {
    // The user name "admin" is also a value of .env.
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, home, actions } = await wireWith(sonarr, {
      values: { MP_FAKE_TOKEN: 'admin' },
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
          "sonarr.login.user is the same as one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value",
      },
    ]);
    // Nothing was changed in the app that resources.json couldn't record.
    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
    await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
  });

  it("throws what isn't the app's failure as it is", async () => {
    const bug = new Error('a bug in a resource');
    const broken: ResourceSpec = { ...FAKE_LOGIN, create: () => Promise.reject(bug) };
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [broken] } }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run } = await wireWith(sonarr, { stack: stackOf(wired) });
    await expect(run).rejects.toBe(bug);
  });
});
