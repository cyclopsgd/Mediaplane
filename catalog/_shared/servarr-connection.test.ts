import {
  createAppApi,
  planWiring,
  type ResolvedStack,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeContainer,
  fakeRuntime,
  fakeStackApis,
  freshAppState,
  wiringStack,
  type FakeAppState,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { JELLYFIN_TRIGGERS } from '../sonarr/integration';
import { JELLYFIN_CONNECTION_NAME, servarrJellyfin } from './servarr-connection';

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

const connection = servarrJellyfin(JELLYFIN_TRIGGERS);

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

/** Sonarr, faked as fakeStackApis fakes it, Jellyfin taking JELLYFIN_KEY, and a client. */
async function sonarr() {
  const apis = await fakeStackApis();
  const state = freshAppState();
  apis.apps.set('sonarr', state);
  apis.apps.set('jellyfin', jellyfin());
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [SONARR_KEY, JELLYFIN_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, apis, state };
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
    });
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
    const tests = () =>
      apis.app.requests.filter((r) => r.path === '/api/v3/notification/test').length;
    const plan = (changing: string[], keys: WiringContext['keys']) =>
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
      });
    // A connection Sonarr holds, its key Jellyfin's.
    const sonarrApi = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port: apis.app.port },
      key: { scheme: 'x-api-key', value: SONARR_KEY },
      secrets: [],
      retry: { deadlineMs: 0 },
    });
    await connection.create(sonarrApi, wanted());
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
});
