import {
  AppApiError,
  createAppApi,
  type ResolvedStack,
  type WiringContext,
} from '@mediaplane/engine';
import { fakeStackApis, freshAppState, wiringStack } from '@mediaplane/engine/testing';
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

const client = servarrDownloadClient({ category: 'tv', setting: 'tvCategory' });

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
  return { api, app: apis.app, state };
}

function wanted(ctx: WiringContext = contextOf()) {
  const desired = client.desired(ctx);
  if (desired === undefined) throw new Error('the download client is wanted');
  return desired;
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
    });
    expect(wanted(contextOf(stack('{ port: 8090 }'))).fields.port).toBe(8090);
    expect(wanted(contextOf(stack('{ vpn: false }'))).fields.host).toBe('qbittorrent');
  });

  it('wants none while qBittorrent has no key to give it', () => {
    expect(client.desired({ ...contextOf(), keys: {} })).toBeUndefined();
  });

  it("makes it from the app's own template, saved even while qBittorrent is down, and finds it by name", async () => {
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

  it("says the app's own words when its test fails for another reason", async () => {
    const { api } = await sonarr();
    const desired = wanted();
    await client.create(api, {
      ...desired,
      fields: { ...desired.fields, host: 'nohost' },
    });
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    const failure = await client
      .verify?.(api, desired, observed)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect((failure as AppApiError).message).toBe(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent (Name does not resolve (nohost:8080)) (POST /api/v3/downloadclient/test)',
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
      fields: { path: '/data/media/tv' },
      secrets: {},
      folders: ['/data/media/tv'],
    });
    const { api, state } = await sonarr();
    expect(await folder.observe(api, undefined)).toBeUndefined();
    const desired = folder.desired(contextOf());
    if (desired === undefined) throw new Error('the root folder is wanted');
    expect(await folder.create(api, desired)).toEqual({ id: 1 });
    expect(state.rootFolders).toEqual([{ id: 1, path: '/data/media/tv' }]);
    // The app may give it back with a trailing "/".
    state.rootFolders = [{ id: 1, path: '/data/media/tv/' }];
    expect(await folder.observe(api, undefined)).toEqual({
      id: 1,
      name: '/data/media/tv',
      fields: { path: '/data/media/tv' },
    });
  });
});
