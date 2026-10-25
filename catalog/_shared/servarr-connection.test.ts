import {
  createAppApi,
  planWiring,
  SENDS_A_KEY,
  wire,
  WiringFailed,
  type ActionResult,
  type ResolvedStack,
  type WiringContext,
} from '@mediaplane/engine';
import {
  claimFakePlex,
  FAKE_PLEX_ACCOUNT,
  fakeContainer,
  fakePlexTv,
  fakeRuntime,
  fakeStackApis,
  freshAppState,
  tempDir,
  wiringStack,
  type FakeAppState,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { LIBRARY_TRIGGERS as RADARR_TRIGGERS } from '../radarr/integration';
import { LIBRARY_TRIGGERS } from '../sonarr/integration';
import {
  JELLYFIN_CONNECTION_NAME,
  PLEX_CONNECTION_NAME,
  servarrJellyfin,
  servarrPlex,
} from './servarr-connection';

const SONARR_KEY = '0'.repeat(32);
const JELLYFIN_KEY = '7'.repeat(32);

/** A stack with Sonarr, qBittorrent, and the media server `server`. */
function stack(server = 'jellyfin', more = ''): ResolvedStack {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: ${server}
${server === 'plex' ? 'plex: { token: { file: secrets/plex-token } }\n' : ''}apps:
  sonarr: {}
  qbittorrent: { vpn: false }
${more}`,
  );
}

function contextOf(
  resolved: ResolvedStack = stack(),
  keys: WiringContext['keys'] = { jellyfin: { apiKey: JELLYFIN_KEY } },
): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'sonarr');
  if (app === undefined) throw new Error('no Sonarr in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys: { sonarr: { apiKey: SONARR_KEY }, ...keys },
  };
}

const connection = servarrJellyfin(LIBRARY_TRIGGERS);

function wanted(ctx: WiringContext = contextOf()) {
  const desired = connection.desired(ctx);
  if (desired === undefined) throw new Error('the connection is wanted');
  return desired;
}

/** A Jellyfin that takes `key`, JELLYFIN_KEY unless given. */
function jellyfin(more: Partial<FakeAppState> = {}, key = JELLYFIN_KEY): FakeAppState {
  return {
    ...freshAppState(),
    apiKeys: [
      { AccessToken: key, AppName: 'Mediaplane', DateCreated: '2026-10-15T12:00:00Z' },
    ],
    ...more,
  };
}

/** `arr`, faked as fakeStackApis fakes it, Jellyfin taking JELLYFIN_KEY, and a client. */
async function arrWith(arr: 'sonarr' | 'radarr') {
  const apis = await fakeStackApis();
  const state = freshAppState();
  apis.apps.set(arr, state);
  apis.apps.set('jellyfin', jellyfin());
  const api = createAppApi({
    name: arr === 'sonarr' ? 'Sonarr' : 'Radarr',
    service: arr,
    port: arr === 'sonarr' ? 8989 : 7878,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [SONARR_KEY, JELLYFIN_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, apis, state };
}

const sonarr = () => arrWith('sonarr');

/** A client of the fake Sonarr, as Mediaplane holds it. */
function clientOf(apis: Awaited<ReturnType<typeof sonarr>>['apis']) {
  return createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [],
    retry: { deadlineMs: 0 },
  });
}

/** plan's wiring check of the stack against `apis`, and the count of Sonarr's own tests. */
function planner(apis: Awaited<ReturnType<typeof sonarr>>['apis']) {
  return {
    tests: () =>
      apis.app.requests.filter((r) => r.path === '/api/v3/notification/test').length,
    plan: (changing: string[], keys: WiringContext['keys']) =>
      planWiring({
        stack: stack(),
        current: ['jellyfin', 'qbittorrent', 'sonarr'].map((s) =>
          fakeContainer(s, `fake-${s}`),
        ),
        changing: new Set(changing),
        onNetwork: true,
        runtime: fakeRuntime({ addresses: apis.addresses }),
        keys: { sonarr: { apiKey: SONARR_KEY }, ...keys },
        admin: { username: 'admin', password: 'fake-admin-password' },
        secrets: [SONARR_KEY, JELLYFIN_KEY],
        known: {},
        seams: apis.seams,
      }),
  };
}

/** The key the connection Sonarr holds has, in clear. */
const heldKey = (state: FakeAppState) =>
  state.connections[0]?.fields.find((f) => f.name === 'apiKey')?.value;

describe("an arr's connection to Jellyfin", () => {
  it("reaches Jellyfin by its service and container port, updates its library, and holds Jellyfin's key", () => {
    expect(connection).toMatchObject({
      name: 'connection_jellyfin',
      fields: ['host', 'port', 'updateLibrary'],
      secrets: ['apiKey'],
      requires: ['jellyfin.admin'],
    });
    expect(wanted(contextOf(stack('jellyfin', '  jellyfin: { port: 8097 }\n')))).toEqual({
      name: JELLYFIN_CONNECTION_NAME,
      fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
      secrets: { apiKey: JELLYFIN_KEY },
      sendsTo: { host: 'jellyfin', port: 8096, useSsl: false, urlBase: '' },
    });
    // Where the arr sends Jellyfin's key: no override changes it.
    expect(connection.locked).toEqual({ host: SENDS_A_KEY, port: SENDS_A_KEY });
  });

  it('is wanted before Jellyfin has made its key, and not at all with Plex', () => {
    // plan names it before Jellyfin's first-run setup; the wire step has the key.
    expect(wanted(contextOf(stack(), {})).secrets).toEqual({});
    expect(connection.desired(contextOf(stack('plex')))).toBeUndefined();
  });

  it("is made from the arr's template with its triggers on, tested as it is saved", async () => {
    const { api, apis, state } = await sonarr();
    expect(await connection.observe(api, undefined)).toBeUndefined();
    const desired = wanted();
    // Jellyfin takes another key: the arr refuses to save the connection.
    apis.apps.set('jellyfin', jellyfin({}, '9'.repeat(32)));
    await expect(connection.create(api, desired)).rejects.toThrow(
      'refused the request (HTTP 400): ApiKey: API Key is invalid',
    );
    apis.apps.set('jellyfin', jellyfin());
    expect(await connection.create(api, desired)).toEqual({ id: 1 });
    expect(state.connections[0]).toMatchObject({
      name: JELLYFIN_CONNECTION_NAME,
      onDownload: true,
      onUpgrade: true,
      onRename: true,
      onSeriesDelete: true,
      onEpisodeFileDelete: true,
      onEpisodeFileDeleteForUpgrade: true,
      onGrab: false,
    });
    expect(heldKey(state)).toBe(JELLYFIN_KEY);
    expect(await connection.observe(api, undefined)).toEqual({
      id: 1,
      name: JELLYFIN_CONNECTION_NAME,
      fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
    });
  });

  it("refuses a trigger the arr's template lacks, saying which, before it sends anything", async () => {
    const { api, state } = await sonarr();
    const odd = servarrJellyfin([...LIBRARY_TRIGGERS, 'onFictional']);
    const failure = await odd.create(api, wanted()).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(Error);
    const said = (failure as Error).message;
    expect(said).toBe(
      'Sonarr at http://sonarr:8989 (127.0.0.1) has no onFictional property for Jellyfin, which Mediaplane turns on (GET /api/v3/notification/schema)',
    );
    expect(said).not.toContain(JELLYFIN_KEY);
    expect(state.connections).toEqual([]);
  });

  it("checks its key with the arr's own test: a refused key is an update, which keeps the user's triggers", async () => {
    const { api, state } = await sonarr();
    const desired = wanted();
    await connection.create(api, desired);
    const held = await connection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    expect(await connection.verify?.(api, desired, held)).toBe(true);
    // A key changed by hand, and a trigger turned off by hand.
    const [made] = state.connections;
    if (made === undefined) throw new Error('no connection made');
    made.fields = made.fields.map((f) =>
      f.name === 'apiKey' ? { ...f, value: '9'.repeat(32) } : f,
    );
    made.onRename = false;
    expect(await connection.verify?.(api, desired, held)).toBe(false);
    await connection.update(api, desired, held);
    expect(heldKey(state)).toBe(JELLYFIN_KEY);
    expect(state.connections[0]?.onRename).toBe(false);
  });

  it("says the arr's own words when its test fails for another reason", async () => {
    const { api, apis } = await sonarr();
    const desired = wanted();
    await connection.create(api, desired);
    const held = await connection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    apis.apps.set('jellyfin', jellyfin({ up: false }));
    await expect(connection.verify?.(api, desired, held)).rejects.toThrow(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested Jellyfin (Mediaplane), and it failed: Host: Unable to send test message: Resource temporarily unavailable (jellyfin:8096) (POST /api/v3/notification/test)',
    );
  });

  it('is never tested by plan while Jellyfin is still to be set up, and once it is', async () => {
    const { apis, state } = await sonarr();
    state.user = 'admin';
    state.password = 'fake-admin-password';
    const { plan, tests } = planner(apis);
    await connection.create(clientOf(apis), wanted());
    const before = tests();
    const pending = await plan(['jellyfin'], {});
    expect(pending.changes).toContainEqual({
      resource: 'sonarr.connection_jellyfin',
      action: 'adopt',
    });
    expect(tests()).toBe(before);
    // Set up: Jellyfin takes its key, and its admin is in place.
    apis.apps.set(
      'jellyfin',
      jellyfin({ wizard: 'done', user: 'admin', password: 'fake-admin-password' }),
    );
    await plan([], { jellyfin: { apiKey: JELLYFIN_KEY } });
    expect(tests()).toBe(before + 1);
  });

  it('is never tested by plan while Jellyfin refuses its key, and its admin can not be asked', async () => {
    const { apis, state } = await sonarr();
    state.user = 'admin';
    state.password = 'fake-admin-password';
    const { plan, tests } = planner(apis);
    await connection.create(clientOf(apis), wanted());
    const before = tests();
    // Jellyfin is set up, and holds none of the keys that plan has.
    apis.apps.set('jellyfin', { ...freshAppState(), wizard: 'done' });
    const planned = await plan([], { jellyfin: { apiKey: JELLYFIN_KEY } });
    expect(planned.changes).toContainEqual(
      expect.objectContaining({ resource: 'jellyfin.admin', action: 'unknown' }),
    );
    expect(planned.changes).toContainEqual({
      resource: 'sonarr.connection_jellyfin',
      action: 'adopt',
    });
    expect(tests()).toBe(before);
  });

  it("is skipped by the wire step when Jellyfin's admin fails, with nothing sent to the arr", async () => {
    const apis = await fakeStackApis();
    apis.apps.set('sonarr', freshAppState());
    // Jellyfin is set up, and holds none of the keys that the store has.
    apis.apps.set('jellyfin', { ...freshAppState(), wizard: 'done' });
    const actions: ActionResult[] = [];
    const run = wire({
      home: await tempDir('mediaplane-connection-'),
      stack: stack(),
      store: {
        version: 1,
        apps: { sonarr: { apiKey: SONARR_KEY }, jellyfin: { apiKey: JELLYFIN_KEY } },
        shared: { adminPassword: 'fake-admin-password' },
      },
      values: {},
      env: {},
      runtime: fakeRuntime({
        containers: ['jellyfin', 'qbittorrent', 'sonarr'].map((s) =>
          fakeContainer(s, `fake-${s}`),
        ),
        addresses: apis.addresses,
        run: (service, command) => {
          apis.mkdir(service, command);
          return { code: 0, stdout: '', stderr: '' };
        },
      }),
      now: () => new Date('2026-10-15T12:00:00.000Z'),
      record: (action) => actions.push(action),
      seams: apis.seams,
    });
    await expect(run).rejects.toBeInstanceOf(WiringFailed);
    expect(actions).toContainEqual({
      step: 'wire',
      resource: 'jellyfin.admin',
      result: 'failed',
      error: expect.any(String) as string,
    });
    expect(actions).toContainEqual({
      step: 'wire',
      resource: 'sonarr.connection_jellyfin',
      result: 'skipped',
      detail: 'jellyfin.admin failed',
    });
    expect(apis.app.requests.filter((r) => r.path.includes('notification'))).toEqual([]);
  });
});

describe("an arr's connection to Jellyfin, at another address", () => {
  it("reads a URL base or TLS as another host, and the update puts the stack's address back", async () => {
    const { api, state } = await sonarr();
    const desired = wanted();
    await connection.create(api, desired);
    const [made] = state.connections;
    if (made === undefined) throw new Error('no connection made');
    // `@<host>` in the URL base takes the arr, and Jellyfin's key, to another host.
    made.fields = made.fields.map((f) =>
      f.name === 'urlBase' ? { ...f, value: '@198.51.100.7' } : f,
    );
    const held = await connection.observe(api, undefined);
    expect(held?.fields.host).toBe('http://jellyfin:8096@198.51.100.7');
    if (held === undefined) throw new Error('the connection is there');
    await connection.update(api, desired, held);
    expect(await connection.observe(api, undefined)).toMatchObject({
      fields: { host: 'jellyfin', port: 8096 },
    });
    expect(state.connections[0]?.fields).toContainEqual({ name: 'urlBase', value: '' });
    expect(state.connections[0]?.fields).toContainEqual({ name: 'useSsl', value: false });
  });

  it("sends Jellyfin's key only to the stack's address, whatever an override or the arr holds", async () => {
    const { api, apis, state } = await sonarr();
    // An override that got past the lock, or a resource that took one: it moves nothing.
    const elsewhere = {
      ...wanted(),
      fields: { ...wanted().fields, host: 'elsewhere', port: 1 },
    };
    await connection.create(api, elsewhere);
    const at = () =>
      state.connections[0]?.fields
        .filter((f) => ['host', 'port', 'useSsl', 'urlBase'].includes(f.name))
        .map((f) => `${f.name}=${String(f.value)}`);
    expect(at()).toEqual(['host=jellyfin', 'port=8096', 'useSsl=false', 'urlBase=']);
    // Changed in the arr by hand: its test is still aimed at the stack's address.
    const [made] = state.connections;
    if (made === undefined) throw new Error('no connection made');
    made.fields = made.fields.map((f) =>
      f.name === 'urlBase' ? { ...f, value: '@198.51.100.7' } : f,
    );
    const held = await connection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    expect(await connection.verify?.(api, elsewhere, held)).toBe(true);
    const test = apis.app.requests.find((r) => r.path === '/api/v3/notification/test');
    expect(test?.body).toContain('"urlBase","value":""');
    expect(test?.body).not.toContain('198.51.100.7');
    expect(test?.body).not.toContain('elsewhere');
    await connection.update(api, elsewhere, held);
    expect(at()).toEqual(['host=jellyfin', 'port=8096', 'useSsl=false', 'urlBase=']);
  });

  it("reads a host or a setting it can't as one it can't, never as empty", async () => {
    const { api, state } = await sonarr();
    await connection.create(api, wanted());
    const [made] = state.connections;
    if (made === undefined) throw new Error('no connection made');
    made.fields = made.fields.map((f) =>
      f.name === 'host'
        ? { ...f, value: 8096 }
        : f.name === 'updateLibrary'
          ? { name: 'updateLibrary' }
          : f,
    );
    expect(await connection.observe(api, undefined)).toMatchObject({
      fields: { port: 8096 },
      unreadable: {
        host: 'a number, not text',
        updateLibrary: 'nothing, not true or false',
      },
    });
    // A TLS or URL base setting of another type: where the key goes can't be told.
    for (const [name, value, why] of [
      ['useSsl', 'yes', 'useSsl is not true or false'],
      ['urlBase', 7, 'urlBase is not text'],
    ] as const) {
      made.fields = made.fields.map((f) =>
        f.name === 'host'
          ? { ...f, value: 'jellyfin' }
          : f.name === 'useSsl'
            ? { ...f, value: false }
            : f.name === 'urlBase'
              ? { ...f, value: '' }
              : f,
      );
      made.fields = made.fields.map((f) => (f.name === name ? { ...f, value } : f));
      expect((await connection.observe(api, undefined))?.unreadable?.host).toBe(
        `its ${why}, so where the arr sends the key can't be told`,
      );
    }
  });
});

describe("an arr's connection to Plex", () => {
  const plexConnection = servarrPlex(LIBRARY_TRIGGERS, 'plex.library_tv');
  const TOKEN = FAKE_PLEX_ACCOUNT.token;

  /** Sonarr and a Plex your account claimed, with a TV library, as fakeStackApis fakes them. */
  async function sonarrWithPlex() {
    const plexTv = await fakePlexTv();
    const apis = await fakeStackApis(plexTv.state);
    const state = freshAppState();
    apis.apps.set('sonarr', state);
    const plex = freshAppState();
    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    plex.plex.sections.push({
      key: '2',
      title: 'TV Shows',
      type: 'show',
      agent: 'tv.plex.agents.series',
      scanner: 'Plex TV Series',
      language: 'en-US',
      locations: ['/data/media/tv'],
    });
    apis.apps.set('plex', plex);
    return { api: clientOf(apis), apis, state, plex };
  }

  const plexWanted = (keys: WiringContext['keys'] = { plex: { token: TOKEN } }) => {
    const desired = plexConnection.desired(contextOf(stack('plex'), keys));
    if (desired === undefined) throw new Error('the connection is wanted');
    return desired;
  };

  it('reaches Plex by its service and container port, updates its library, and holds your token', () => {
    expect(plexConnection).toMatchObject({
      name: 'connection_plex',
      fields: ['host', 'port', 'updateLibrary'],
      secrets: ['authToken'],
      requires: ['plex.server', 'plex.library_tv'],
    });
    expect(plexWanted()).toEqual({
      name: PLEX_CONNECTION_NAME,
      fields: { host: 'plex', port: 32400, updateLibrary: true },
      secrets: { authToken: TOKEN },
      sendsTo: { host: 'plex', port: 32400, useSsl: false, urlBase: '' },
    });
    expect(plexConnection.desired(contextOf(stack('jellyfin')))).toBeUndefined();
    expect(connection.desired(contextOf(stack('plex')))).toBeUndefined();
  });

  it("is made from the arr's template with its triggers on, tested with your token as it is saved", async () => {
    const { api, state } = await sonarrWithPlex();
    await expect(
      plexConnection.create(api, plexWanted({ plex: { token: 'revoked-plex-token-0' } })),
    ).rejects.toThrow(
      'refused the request (HTTP 400): AuthToken: Authentication Token is invalid',
    );
    expect(await plexConnection.create(api, plexWanted())).toEqual({ id: 1 });
    expect(state.connections[0]).toMatchObject({
      name: PLEX_CONNECTION_NAME,
      implementation: 'PlexServer',
      onDownload: true,
      onRename: true,
      onSeriesDelete: true,
      onGrab: false,
    });
    expect(state.connections[0]?.fields).toContainEqual({
      name: 'authToken',
      value: TOKEN,
    });
    expect(await plexConnection.observe(api, undefined)).toEqual({
      id: 1,
      name: PLEX_CONNECTION_NAME,
      fields: { host: 'plex', port: 32400, updateLibrary: true },
    });
  });

  it("checks your token with the arr's own test, never compared: a refused one is an update", async () => {
    const { api, state } = await sonarrWithPlex();
    const desired = plexWanted();
    await plexConnection.create(api, desired);
    const held = await plexConnection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    expect(await plexConnection.verify?.(api, desired, held)).toBe(true);
    const [made] = state.connections;
    if (made === undefined) throw new Error('no connection made');
    made.fields = made.fields.map((f) =>
      f.name === 'authToken' ? { ...f, value: 'someone-elses-token' } : f,
    );
    expect(await plexConnection.verify?.(api, desired, held)).toBe(false);
    await plexConnection.update(api, desired, held);
    expect(state.connections[0]?.fields).toContainEqual({
      name: 'authToken',
      value: TOKEN,
    });
  });

  it('is refused by the arr while Plex has no library of what the arr files', async () => {
    const { api, plex } = await sonarrWithPlex();
    plex.plex.sections = [];
    await expect(plexConnection.create(api, plexWanted())).rejects.toThrow(
      'refused the request (HTTP 400): Host: At least one TV library is required',
    );
  });

  it("says the arr's own words when it can't reach Plex", async () => {
    const { api, plex } = await sonarrWithPlex();
    const desired = plexWanted();
    await plexConnection.create(api, desired);
    const held = await plexConnection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    plex.up = false;
    await expect(plexConnection.verify?.(api, desired, held)).rejects.toThrow(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested Plex (Mediaplane), and it failed: Host: Unable to connect to Plex Media Server (Resource temporarily unavailable (plex:32400)) (POST /api/v3/notification/test)',
    );
  });
});

describe("Radarr's connection to Jellyfin", () => {
  it("is made with Radarr's triggers on, and none of Sonarr's", async () => {
    const { api, state } = await arrWith('radarr');
    const radarr = servarrJellyfin(RADARR_TRIGGERS);
    const resolved = stack('jellyfin', '  radarr: {}\n');
    const app = resolved.apps.find((a) => a.def.id === 'radarr');
    if (app === undefined) throw new Error('no Radarr in the stack');
    const desired = radarr.desired({ ...contextOf(resolved), app });
    if (desired === undefined) throw new Error('the connection is wanted');
    expect(await radarr.create(api, desired)).toEqual({ id: 1 });
    expect(state.connections[0]).toMatchObject({
      name: JELLYFIN_CONNECTION_NAME,
      onDownload: true,
      onUpgrade: true,
      onRename: true,
      onMovieDelete: true,
      onMovieFileDelete: true,
      onMovieFileDeleteForUpgrade: true,
      onGrab: false,
    });
    expect(state.connections[0]).not.toHaveProperty('onSeriesDelete');
    expect(await radarr.observe(api, undefined)).toEqual({
      id: 1,
      name: JELLYFIN_CONNECTION_NAME,
      fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
    });
  });
});

describe("Radarr's connection to Plex", () => {
  it('is refused while Plex has no Movie library, whatever TV libraries it has, and then made', async () => {
    const plexTv = await fakePlexTv();
    const apis = await fakeStackApis(plexTv.state);
    const state = freshAppState();
    apis.apps.set('radarr', state);
    const plex = freshAppState();
    claimFakePlex(
      plex.plex,
      await plexTv.client.claimToken(FAKE_PLEX_ACCOUNT.token),
      plexTv.state,
    );
    apis.apps.set('plex', plex);
    const section = (key: string, type: 'movie' | 'show') => ({
      key,
      title: type === 'movie' ? 'Movies' : 'TV Shows',
      type,
      agent: type === 'movie' ? 'tv.plex.agents.movie' : 'tv.plex.agents.series',
      scanner: type === 'movie' ? 'Plex Movie' : 'Plex TV Series',
      language: 'en-US',
      locations: [type === 'movie' ? '/data/media/movies' : '/data/media/tv'],
    });
    plex.plex.sections.push(section('1', 'show'));
    const api = createAppApi({
      name: 'Radarr',
      service: 'radarr',
      port: 7878,
      endpoint: { host: '127.0.0.1', port: apis.app.port },
      key: { scheme: 'x-api-key', value: SONARR_KEY },
      secrets: [SONARR_KEY, FAKE_PLEX_ACCOUNT.token],
      retry: { deadlineMs: 0 },
    });
    const radarr = servarrPlex(RADARR_TRIGGERS, 'plex.library_movies');
    const resolved = stack('plex', '  radarr: {}\n');
    const app = resolved.apps.find((a) => a.def.id === 'radarr');
    if (app === undefined) throw new Error('no Radarr in the stack');
    const desired = radarr.desired({
      ...contextOf(resolved, { plex: { token: FAKE_PLEX_ACCOUNT.token } }),
      app,
    });
    if (desired === undefined) throw new Error('the connection is wanted');
    await expect(radarr.create(api, desired)).rejects.toThrow(
      'refused the request (HTTP 400): Host: At least one Movie library is required',
    );
    plex.plex.sections.push(section('2', 'movie'));
    expect(await radarr.create(api, desired)).toEqual({ id: 1 });
    expect(state.connections[0]).toMatchObject({
      name: PLEX_CONNECTION_NAME,
      implementation: 'PlexServer',
      onMovieDelete: true,
    });
  });
});
