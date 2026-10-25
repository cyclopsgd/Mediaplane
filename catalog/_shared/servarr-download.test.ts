import {
  AppApiError,
  createAppApi,
  SENDS_A_KEY,
  type ResolvedStack,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeHttpApp,
  fakeStackApis,
  freshAppState,
  wiringStack,
  type FakeReply,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import {
  DOWNLOAD_CLIENT_NAME,
  servarrDownloadClient,
  servarrRootFolder,
} from './servarr-download';

const SONARR_KEY = '0'.repeat(32);
const QBT_KEY = `qbt_${'1'.repeat(28)}`;

/** A stack with Sonarr and qBittorrent: behind the VPN unless `qbittorrent` says. */
function stack(qbittorrent = '{}', apps = '  sonarr: {}\n'): ResolvedStack {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
${apps}  qbittorrent: ${qbittorrent}
`,
  );
}

function contextOf(resolved: ResolvedStack = stack()): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'sonarr');
  if (app === undefined) throw new Error('no Sonarr in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys: { sonarr: { apiKey: SONARR_KEY }, qbittorrent: { apiKey: QBT_KEY } },
  };
}

const client = servarrDownloadClient({
  category: 'tv',
  setting: 'tvCategory',
  imported: 'tvImportedCategory',
});

/** Sonarr, faked as fakeStackApis fakes it, and a client for it; qBittorrent takes QBT_KEY. */
async function sonarr() {
  const apis = await fakeStackApis();
  const state = { ...freshAppState() };
  apis.apps.set('sonarr', state);
  apis.apps.set('qbittorrent', { ...freshAppState(), key: QBT_KEY });
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [SONARR_KEY, QBT_KEY],
    retry: { deadlineMs: 0 },
  });
  // qBittorrent, as plan reaches it: what a check may ask of another app.
  const qbittorrent = createAppApi({
    name: 'qBittorrent',
    service: 'qbittorrent',
    port: 8080,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'bearer', value: QBT_KEY },
    secrets: [SONARR_KEY, QBT_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, app: apis.app, state, qbittorrent, apis };
}

function wanted(ctx: WiringContext = contextOf()) {
  const desired = client.desired(ctx);
  if (desired === undefined) throw new Error('the download client is wanted');
  return desired;
}

/** Two of the settings Mediaplane sets in a client. */
const NEEDED = ['apiKey', 'tvCategory'];

/** Sonarr's qBittorrent template, as `…/schema` gives it. */
function template() {
  return {
    name: '',
    enable: false,
    implementation: 'QBittorrent',
    fields: [
      { name: 'host', value: 'localhost' },
      { name: 'port', value: 8080 },
      { name: 'useSsl', value: false },
      { name: 'urlBase' },
      { name: 'apiKey' },
      { name: 'tvCategory', value: 'tv-sonarr' },
    ],
  };
}

/** The client as observed: the app's id 1. */
const HELD = {
  id: 1,
  name: DOWNLOAD_CLIENT_NAME,
  fields: { host: 'gluetun', port: 8080, useSsl: false, category: 'tv', enable: true },
};

/** A Sonarr that gives only `answers`, by "<method> <path>", and a client for it. */
async function sonarrAnswering(answers: Record<string, FakeReply>) {
  const app = await fakeHttpApp(
    (request) => answers[`${request.method} ${request.path}`] ?? { status: 404 },
  );
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [SONARR_KEY, QBT_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, app };
}

describe('servarrDownloadClient', () => {
  it("links qBittorrent through Gluetun, at qBittorrent's own port, with its key, after its category", () => {
    expect(client).toMatchObject({
      name: 'download_client',
      fields: ['host', 'port', 'useSsl', 'category', 'enable'],
      secrets: ['apiKey'],
      requires: ['qbittorrent.category_tv'],
    });
    expect(wanted()).toEqual({
      name: DOWNLOAD_CLIENT_NAME,
      fields: {
        host: 'gluetun',
        port: 8080,
        useSsl: false,
        category: 'tv',
        enable: true,
      },
      secrets: { apiKey: QBT_KEY },
      sendsTo: { host: 'gluetun', port: 8080, useSsl: false, urlBase: '' },
    });
    // Where the arr sends qBittorrent's key: no override changes it.
    expect(client.locked).toMatchObject({
      host: SENDS_A_KEY,
      port: SENDS_A_KEY,
      useSsl: SENDS_A_KEY,
    });
    expect(wanted(contextOf(stack('{ port: 8090 }'))).fields.port).toBe(8090);
    expect(wanted(contextOf(stack('{ vpn: false }'))).fields.host).toBe('qbittorrent');
  });

  it('wants none while qBittorrent has no key to give it', () => {
    expect(client.desired({ ...contextOf(), keys: {} })).toBeUndefined();
  });

  it("makes it from the app's own template, saved with forceSave, and finds it by name", async () => {
    const { api, app, state } = await sonarr();
    expect(await client.observe(api, undefined)).toBeUndefined();
    expect(await client.create(api, wanted())).toEqual({ id: 1 });
    const post = app.requests.find((r) => r.method === 'POST');
    expect(post?.path).toBe('/api/v3/downloadclient?forceSave=true');
    const sent = JSON.parse(post?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toMatchObject({
      name: DOWNLOAD_CLIENT_NAME,
      enable: true,
      implementation: 'QBittorrent',
    });
    expect(sent).not.toHaveProperty('presets');
    expect(state.downloadClients[0]?.fields).toEqual(
      expect.arrayContaining([
        { name: 'host', value: 'gluetun' },
        { name: 'port', value: 8080 },
        { name: 'useSsl', value: false },
        { name: 'apiKey', value: QBT_KEY },
        { name: 'tvCategory', value: 'tv' },
        // A setting Mediaplane doesn't manage keeps the template's value.
        { name: 'username' },
      ]),
    );
    expect(await client.observe(api, undefined)).toEqual({
      id: 1,
      name: DOWNLOAD_CLIENT_NAME,
      fields: {
        host: 'gluetun',
        port: 8080,
        useSsl: false,
        category: 'tv',
        enable: true,
      },
    });
  });

  it("checks the key with the app's own test of the client it holds: a refusal means update", async () => {
    const { api, app, state } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    expect(await client.verify?.(api, desired, observed)).toBe(true);
    // Tested as the app holds it: by its id, its key masked.
    const test = app.requests.find((r) => r.path === '/api/v3/downloadclient/test');
    expect(JSON.parse(test?.body ?? '{}')).toMatchObject({ id: 1 });
    expect(test?.body).not.toContain(QBT_KEY);
    const key = state.downloadClients[0]?.fields.find((f) => f.name === 'apiKey');
    if (key !== undefined) key.value = `qbt_${'9'.repeat(28)}`;
    expect(await client.verify?.(api, desired, observed)).toBe(false);
    await client.update(api, desired, observed);
    expect(await client.verify?.(api, desired, observed)).toBe(true);
  });

  it("leaves the key unchecked in plan when the arr's test would make a missing post-import category", async () => {
    const { api, app, state, qbittorrent, apis } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const qbt = apis.apps.get('qbittorrent');
    if (qbt === undefined) throw new Error('no qBittorrent faked');
    qbt.categories = { tv: '/data/torrents/tv' };
    const [held] = state.downloadClients;
    if (held === undefined) throw new Error('no client made');
    held.fields = held.fields.map((f) =>
      f.name === 'tvImportedCategory' ? { ...f, value: 'tv-imported' } : f,
    );
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    const tests = () =>
      app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
    const before = tests();
    const plan = {
      readOnly: true,
      peer: (id: string) => (id === 'qbittorrent' ? qbittorrent : undefined),
    };
    expect(await client.verify?.(api, desired, observed, plan)).toEqual({
      unchecked:
        "qBittorrent has no category tv-imported (tvImportedCategory), which Sonarr's download client names, and Sonarr's own test of it would make it with no save path, so it isn't run: make it in qBittorrent, or name one in Sonarr that qBittorrent has, then run drift again",
    });
    expect(tests()).toBe(before);
    expect(Object.keys(qbt.categories)).toEqual(['tv']);
    // qBittorrent out of reach: unchecked too.
    expect(
      await client.verify?.(api, desired, observed, {
        readOnly: true,
        peer: () => undefined,
      }),
    ).toEqual({
      unchecked:
        "Sonarr's own test of its download client would make any of tv (tvCategory) and tv-imported (tvImportedCategory) that qBittorrent lacks, with no save path, so it isn't run while qBittorrent can't be asked which it has: run drift again once it answers",
    });
    // Apply's check runs the test, which makes the category, as the arr's own does.
    expect(await client.verify?.(api, desired, observed)).toBe(true);
    expect(qbt.categories['tv-imported']).toBe('');
    // Once qBittorrent has it, plan runs the test.
    expect(await client.verify?.(api, desired, observed, plan)).toBe(true);
    expect(tests()).toBe(before + 2);
  });

  it('leaves the key unchecked in plan while qBittorrent lacks the category the client files under', async () => {
    // No longer Mediaplane's in qBittorrent (unmanaged), and deleted there.
    const { api, app, state, qbittorrent, apis } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const qbt = apis.apps.get('qbittorrent');
    if (qbt === undefined) throw new Error('no qBittorrent faked');
    qbt.categories = {};
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    const tests = () =>
      app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
    const before = tests();
    const plan = { readOnly: true, peer: () => qbittorrent };
    expect(await client.verify?.(api, desired, observed, plan)).toEqual({
      unchecked:
        "qBittorrent has no category tv (tvCategory), which Sonarr's download client names, and Sonarr's own test of it would make it with no save path, so it isn't run: make it in qBittorrent, or name one in Sonarr that qBittorrent has, then run drift again",
    });
    expect(tests()).toBe(before);
    expect(qbt.categories).toEqual({});
    // Apply's check runs the test, which makes it, with no save path, as the arr's does.
    expect(state.downloadClients).toHaveLength(1);
    expect(await client.verify?.(api, desired, observed)).toBe(true);
    expect(qbt.categories).toEqual({ tv: '' });
  });

  it("leaves the key unchecked in plan while qBittorrent can't say which categories it has", async () => {
    const { api, app } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    const broken = await fakeHttpApp(() => ({ status: 500 }));
    const failing = createAppApi({
      name: 'qBittorrent',
      service: 'qbittorrent',
      port: 8080,
      endpoint: { host: '127.0.0.1', port: broken.port },
      key: { scheme: 'bearer', value: QBT_KEY },
      secrets: [QBT_KEY],
      retry: { deadlineMs: 0 },
    });
    const tests = () =>
      app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
    const before = tests();
    const verdict = await client.verify?.(api, desired, observed, {
      readOnly: true,
      peer: () => failing,
    });
    expect(verdict).toEqual({
      unchecked: expect.stringMatching(
        /^Sonarr's own test of its download client would make any of tv \(tvCategory\) that qBittorrent lacks, with no save path, so it isn't run while qBittorrent can't be asked which it has \(qBittorrent at .*\/api\/v2\/torrents\/categories\)\): run drift again once it answers$/,
      ) as string,
    });
    expect(tests()).toBe(before);
  });

  it("leaves the key unchecked in plan while the client's post-import category isn't text", async () => {
    const { api, app, state, qbittorrent } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const [held] = state.downloadClients;
    if (held === undefined) throw new Error('no client made');
    held.fields = held.fields.map((f) =>
      f.name === 'tvImportedCategory' ? { ...f, value: 7 } : f,
    );
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    const before = app.requests.length;
    expect(
      await client.verify?.(api, desired, observed, {
        readOnly: true,
        peer: () => qbittorrent,
      }),
    ).toEqual({
      unchecked:
        "Sonarr's download client holds a tvImportedCategory that isn't text, so its own test of it, which could make a category in qBittorrent, isn't run: set tvImportedCategory in Sonarr, then run drift again",
    });
    expect(app.requests.slice(before).some((r) => r.path.endsWith('/test'))).toBe(false);
  });

  it("reads a client setting it can't, of another type or missing, as one it can't, never as empty", async () => {
    const { api } = await sonarrAnswering({
      'GET /api/v3/downloadclient': {
        status: 200,
        body: [
          {
            id: 1,
            name: DOWNLOAD_CLIENT_NAME,
            implementation: 'QBittorrent',
            fields: [
              { name: 'host', value: 'gluetun' },
              { name: 'port', value: '8080' },
              { name: 'useSsl', value: false },
              { name: 'tvCategory' },
            ],
          },
        ],
      },
    });
    expect(await client.observe(api, undefined)).toEqual({
      id: 1,
      name: DOWNLOAD_CLIENT_NAME,
      fields: { host: 'gluetun', useSsl: false },
      unreadable: {
        category: 'nothing, not text',
        enable: 'nothing, not true or false',
        port: 'text, not a number',
      },
    });
  });

  it("says the app's own words when its test fails for another reason", async () => {
    const { api, state } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    state.testFailure = 'Unable to connect to qBittorrent';
    const failure = await client
      .verify?.(api, desired, observed)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect((failure as AppApiError).message).toBe(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent (POST /api/v3/downloadclient/test)',
    );
  });

  it("sends qBittorrent's key only to the stack's address, whatever an override or the arr holds", async () => {
    const { api, app, state } = await sonarr();
    // An override that got past the lock, or a resource that took one: it moves nothing.
    const elsewhere = {
      ...wanted(),
      fields: { ...wanted().fields, host: 'elsewhere', port: 1, useSsl: true },
    };
    await client.create(api, elsewhere);
    const at = () =>
      state.downloadClients[0]?.fields
        .filter((f) => ['host', 'port', 'useSsl', 'urlBase'].includes(f.name))
        .map((f) => `${f.name}=${String(f.value)}`);
    expect(at()).toEqual(['host=gluetun', 'port=8080', 'useSsl=false', 'urlBase=']);
    // Changed in the arr by hand: its test is still aimed at the stack's address.
    const [held] = state.downloadClients;
    if (held === undefined) throw new Error('no client made');
    held.fields = held.fields.map((f) =>
      f.name === 'host'
        ? { ...f, value: 'elsewhere' }
        : f.name === 'urlBase'
          ? { ...f, value: '@elsewhere' }
          : f,
    );
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    expect(await client.verify?.(api, elsewhere, observed)).toBe(true);
    const test = app.requests.find((r) => r.path === '/api/v3/downloadclient/test');
    const sent = JSON.parse(test?.body ?? '{}') as {
      fields: { name: string; value?: unknown }[];
    };
    expect(
      sent.fields
        .filter((f) => ['host', 'port', 'useSsl', 'urlBase'].includes(f.name))
        .map((f) => `${f.name}=${String(f.value)}`),
    ).toEqual(['host=gluetun', 'port=8080', 'useSsl=false', 'urlBase=']);
    expect(test?.body).not.toContain('elsewhere');
    // And an update puts the stack's address back.
    await client.update(api, elsewhere, observed);
    expect(at()).toEqual(['host=gluetun', 'port=8080', 'useSsl=false', 'urlBase=']);
  });

  it("reads a URL base as another host, so drift says so and the update puts the stack's back", async () => {
    // The arr sends qBittorrent's key to the URL it builds with its URL base: `@<host>`
    // in it is another host.
    const { api, state } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const [held] = state.downloadClients;
    if (held === undefined) throw new Error('no client made');
    held.fields = held.fields.map((f) =>
      f.name === 'urlBase' ? { ...f, value: '@198.51.100.7' } : f,
    );
    const observed = await client.observe(api, undefined);
    expect(observed?.fields.host).toBe('http://gluetun:8080@198.51.100.7');
    if (observed === undefined) throw new Error('no client observed');
    await client.update(api, desired, observed);
    expect(state.downloadClients[0]?.fields).toContainEqual({
      name: 'urlBase',
      value: '',
    });
    expect((await client.observe(api, undefined))?.fields.host).toBe('gluetun');
    // One of another type: where the key goes can't be told.
    held.fields = held.fields.map((f) => (f.name === 'urlBase' ? { ...f, value: 7 } : f));
    const odd = await client.observe(api, undefined);
    expect(odd?.fields.host).toBeUndefined();
    expect(odd?.unreadable?.host).toBe(
      "its urlBase is not text, so where the arr sends the key can't be told",
    );
  });

  it('refuses a template or a client without a setting it needs, naming it, and sends nothing', async () => {
    const { fields, ...rest } = template();
    const without = { ...rest, fields: fields.filter((f) => !NEEDED.includes(f.name)) };
    const { api, app } = await sonarrAnswering({
      'GET /api/v3/downloadclient/schema': { status: 200, body: [without] },
      'GET /api/v3/downloadclient/1': { status: 200, body: { ...without, id: 1 } },
    });
    // Each names what it read: the template, or the client the app holds.
    for (const [send, read] of [
      [() => client.create(api, wanted()), '/api/v3/downloadclient/schema'],
      [() => client.update(api, wanted(), HELD), '/api/v3/downloadclient/1'],
    ] as const) {
      const failure = await send().catch((thrown: unknown) => thrown);
      expect(failure).toBeInstanceOf(AppApiError);
      expect(failure).toMatchObject({
        kind: 'protocol',
        message: `Sonarr at http://sonarr:8989 (127.0.0.1) has no tvCategory, apiKey setting for qBittorrent, which Mediaplane needs (GET ${read})`,
      });
    }
    expect(app.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/v3/downloadclient/schema',
      'GET /api/v3/downloadclient/1',
    ]);
  });

  it('refuses an app that offers no qBittorrent download client', async () => {
    const { api, app } = await sonarrAnswering({
      'GET /api/v3/downloadclient/schema': {
        status: 200,
        body: [{ ...template(), implementation: 'Transmission' }],
      },
    });
    const failure = await client.create(api, wanted()).catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect(failure).toMatchObject({
      kind: 'protocol',
      message:
        'Sonarr at http://sonarr:8989 (127.0.0.1) offers no qBittorrent download client (GET /api/v3/downloadclient/schema)',
    });
    expect(app.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it.each(['ApiKey', 'Username', 'Password'])(
    'takes a test that names %s as a key qBittorrent refused: an update sets it',
    async (property) => {
      const { api } = await sonarrAnswering({
        'GET /api/v3/downloadclient/1': { status: 200, body: { ...template(), id: 1 } },
        'POST /api/v3/downloadclient/test': {
          status: 400,
          body: [{ propertyName: property, errorMessage: 'Authentication Failure' }],
        },
      });
      expect(await client.verify?.(api, wanted(), HELD)).toBe(false);
    },
  );

  it("gives the app's bare words for a failure that names no setting", async () => {
    const { api } = await sonarrAnswering({
      'GET /api/v3/downloadclient/1': { status: 200, body: { ...template(), id: 1 } },
      'POST /api/v3/downloadclient/test': {
        status: 400,
        body: [{ propertyName: '', errorMessage: 'Unknown exception: fake' }],
      },
    });
    const failure = await client
      .verify?.(api, wanted(), HELD)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect((failure as AppApiError).message).toBe(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Unknown exception: fake (POST /api/v3/downloadclient/test)',
    );
  });

  it('updates what differs, keeping the settings it does not manage', async () => {
    const { api, state } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const held = state.downloadClients[0];
    if (held === undefined) throw new Error('no client made');
    held.priority = 5;
    held.enable = false;
    held.fields = held.fields.map((f) =>
      f.name === 'host' ? { ...f, value: 'old' } : f,
    );
    const observed = await client.observe(api, {
      id: 1,
      name: 'renamed',
      fields: {},
      secrets: [],
      appliedAt: '2026-10-10T12:00:00.000Z',
    });
    expect(observed?.fields).toMatchObject({ host: 'old', enable: false });
    if (observed === undefined) throw new Error('no client observed');
    await client.update(api, desired, observed);
    expect(state.downloadClients[0]).toMatchObject({ priority: 5, enable: true });
    expect((await client.observe(api, undefined))?.fields).toEqual(desired.fields);
  });
});

describe('servarrRootFolder', () => {
  const folder = servarrRootFolder('/data/media/tv');

  it('needs its folder made first, and is known by its path', async () => {
    expect(folder.desired(contextOf())).toEqual({
      name: '/data/media/tv',
      fields: { path: '/data/media/tv', accessible: true },
      secrets: {},
      folders: ['/data/media/tv'],
    });
    const { api, state } = await sonarr();
    expect(await folder.observe(api, undefined)).toBeUndefined();
    const desired = folder.desired(contextOf());
    if (desired === undefined) throw new Error('the root folder is wanted');
    // The wire step makes the folder first: the app refuses a root folder without one.
    state.folders.push('/data/media/tv');
    expect(await folder.create(api, desired)).toEqual({ id: 1 });
    expect(state.rootFolders).toEqual([{ id: 1, path: '/data/media/tv' }]);
    // The app may give it back with a trailing "/".
    state.rootFolders = [{ id: 1, path: '/data/media/tv/' }];
    expect(await folder.observe(api, undefined)).toEqual({
      id: 1,
      name: '/data/media/tv',
      fields: { path: '/data/media/tv', accessible: true },
    });
  });

  it('says the arr can no longer reach its folder, deleted by hand, so apply makes it again', async () => {
    const { api, state } = await sonarr();
    state.rootFolders = [{ id: 1, path: '/data/media/tv' }];
    expect((await folder.observe(api, undefined))?.fields).toEqual({
      path: '/data/media/tv',
      accessible: false,
    });
  });

  it("says when the arr doesn't say whether it reaches the folder, rather than guess", async () => {
    const { api } = await sonarrAnswering({
      'GET /api/v3/rootfolder': {
        status: 200,
        body: [{ id: 1, path: '/data/media/tv' }],
      },
    });
    expect(await folder.observe(api, undefined)).toEqual({
      id: 1,
      name: '/data/media/tv',
      fields: { path: '/data/media/tv' },
      unreadable: { accessible: 'nothing, not true or false' },
    });
  });
});
