import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callFake } from './http';
import {
  fakeJellyfinSetUp,
  SEERR_JELLYFIN,
  SEERR_NOT_CONFIGURED,
  SET_UP_JELLYFIN,
} from './seerr';
import { tempDir } from './temp';
import { fakeStackApis, freshAppState } from './wiring';

const SEERR_KEY = '5'.repeat(32);
const SONARR_KEY = '1'.repeat(32);
const JELLYFIN_KEY = SET_UP_JELLYFIN.key;
const PASSWORD = SET_UP_JELLYFIN.password;

/** One call to the fake Seerr, or to the fake app `init.host` names. */
const call = (port: number, path: string, init: Parameters<typeof callFake>[2] = {}) =>
  callFake(port, path, { host: 'seerr:5055', ...init });

/** A stack's fakes: a Jellyfin set up with the admin and a key, Seerr fresh, Sonarr keyed. */
async function stack() {
  const apis = await fakeStackApis();
  const jellyfin = fakeJellyfinSetUp({
    libraries: [
      { Name: 'Movies', CollectionType: 'movies', Locations: [], LibraryOptions: {} },
      { Name: 'Shows', CollectionType: 'tvshows', Locations: [], LibraryOptions: {} },
      { Name: 'Music', CollectionType: 'music', Locations: [], LibraryOptions: {} },
    ],
  });
  apis.apps.set('jellyfin', jellyfin);
  const seerr = { ...freshAppState(), key: SEERR_KEY };
  apis.apps.set('seerr', seerr);
  apis.apps.set('sonarr', {
    ...freshAppState(),
    key: SONARR_KEY,
    rootFolders: [{ id: 1, path: '/data/media/tv' }],
  });
  return { apis, jellyfin, seerr, port: apis.app.port };
}

/** The first sign-in, as Mediaplane's setup sends it. */
const FIRST = {
  username: 'admin',
  password: PASSWORD,
  hostname: 'jellyfin',
  port: 8096,
  useSsl: false,
  urlBase: '',
  serverType: SEERR_JELLYFIN,
};

const keyed = { 'x-api-key': SEERR_KEY };

describe("fakeStackApis' Seerr", () => {
  it('lets whoever signs in first through Jellyfin set it up, and takes its key only after', async () => {
    const { port, jellyfin, seerr } = await stack();
    expect((await call(port, '/api/v1/settings/public')).body).toMatchObject({
      initialized: false,
      mediaServerType: SEERR_NOT_CONFIGURED,
    });
    // Its key does nothing yet; without it, the validator asks for a session.
    expect((await call(port, '/api/v1/auth/me', { headers: keyed })).status).toBe(403);
    expect(await call(port, '/api/v1/auth/me')).toMatchObject({
      status: 401,
      body: { message: "cookie 'connect.sid' required" },
    });
    const signIn = (body: unknown) => call(port, '/api/v1/auth/jellyfin', { body });
    expect(await signIn({ ...FIRST, password: 'fake-wrong' })).toMatchObject({
      status: 401,
      body: { message: 'INVALID_CREDENTIALS' },
      cookie: undefined,
    });
    expect(await signIn({ ...FIRST, hostname: 'elsewhere' })).toMatchObject({
      status: 404,
      body: { message: 'INVALID_URL' },
    });
    const first = await signIn(FIRST);
    expect(first).toMatchObject({ status: 200, body: { id: 1, permissions: 2 } });
    expect(first.cookie).toMatch(/^connect\.sid=s%3A[^;]+; Path=\/; HttpOnly/);
    // It made itself a key in Jellyfin, and uses it.
    const made = jellyfin.apiKeys.find((k) => k.AppName === 'Seerr');
    expect(made).toBeDefined();
    expect(seerr.seerr.jellyfin).toMatchObject({
      ip: 'jellyfin',
      port: 8096,
      apiKey: made?.AccessToken,
    });
    expect(seerr.seerr.mediaServerType).toBe(SEERR_JELLYFIN);
    expect((await call(port, '/api/v1/auth/me', { headers: keyed })).body).toEqual({
      id: 1,
      jellyfinUsername: 'admin',
      permissions: 2,
    });
    // Its hostname, once set, is never taken again; a sign-in without one still works.
    expect(await signIn(FIRST)).toMatchObject({
      status: 500,
      body: { error: 'Jellyfin hostname already configured' },
    });
    const { hostname: _h, port: _p, useSsl: _s, urlBase: _u, ...again } = FIRST;
    expect((await signIn(again)).status).toBe(200);
    expect((await signIn({ ...again, password: 'fake-wrong' })).status).toBe(401);
    expect(seerr.seerr.sessions).toHaveLength(2);
  });

  it('ends the session it gave when it signs out', async () => {
    const { port, seerr } = await stack();
    const { cookie } = await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const session = { cookie: (cookie ?? '').split(';')[0] ?? '' };
    expect((await call(port, '/api/v1/auth/me', { headers: session })).status).toBe(200);
    expect(await call(port, '/api/v1/auth/logout', { method: 'POST' })).toMatchObject({
      status: 401,
    });
    expect(
      await call(port, '/api/v1/auth/logout', { method: 'POST', headers: session }),
    ).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect(seerr.seerr.sessions).toEqual([]);
    expect((await call(port, '/api/v1/auth/me', { headers: session })).status).toBe(403);
  });

  it("saves its Jellyfin only where it reaches Jellyfin with the key, and lists Jellyfin's users only while Jellyfin takes its key", async () => {
    const { port, jellyfin, seerr } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const settings = '/api/v1/settings/jellyfin';
    const save = (body: unknown) => call(port, settings, { body, headers: keyed });
    const users = () => call(port, `${settings}/users`, { headers: keyed });
    expect(await save({ ip: 'elsewhere', port: 8096 })).toMatchObject({ status: 502 });
    expect(await save({ apiKey: '0'.repeat(32) })).toMatchObject({
      status: 401,
      body: { message: 'INVALID_URL' },
    });
    expect(seerr.seerr.jellyfin.ip).toBe('jellyfin');
    expect((await users()).status).toBe(200);
    // Its own key revoked in Jellyfin: the list fails, and Seerr logs it.
    jellyfin.apiKeys = jellyfin.apiKeys.filter((k) => k.AppName !== 'Seerr');
    const errors = seerr.seerr.errors.length;
    expect(await users()).toMatchObject({ status: 500, body: { message: '' } });
    expect(seerr.seerr.errors.length).toBe(errors + 1);
    expect(
      await save({ ip: 'jellyfin', port: 8096, useSsl: false, apiKey: JELLYFIN_KEY }),
    ).toMatchObject({ status: 200, body: { apiKey: JELLYFIN_KEY } });
    expect((await users()).status).toBe(200);
  });

  it("syncs Jellyfin's film and series libraries, keeping what is enabled, and enables them one at a time", async () => {
    const { port } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const sync = () =>
      call(port, '/api/v1/settings/jellyfin/library/sync', {
        method: 'POST',
        headers: keyed,
      });
    const synced = (await sync()).body as { id: string; name: string }[];
    expect(synced).toMatchObject([
      { name: 'Movies', enabled: false, type: 'movie' },
      { name: 'Shows', enabled: false, type: 'show' },
    ]);
    const enable = (id: string, body: unknown) =>
      call(port, `/api/v1/settings/jellyfin/library/${id}`, {
        method: 'PUT',
        body,
        headers: keyed,
      });
    expect((await enable(synced[0]?.id ?? '', { enabled: 'yes' })).status).toBe(400);
    expect((await enable('nosuch', { enabled: true })).status).toBe(404);
    expect(await enable(synced[0]?.id ?? '', { enabled: true })).toMatchObject({
      status: 200,
      body: { name: 'Movies', enabled: true },
    });
    expect((await sync()).body).toMatchObject([
      { name: 'Movies', enabled: true },
      { name: 'Shows', enabled: false },
    ]);
  });

  it('keeps an arr server whole, its key in clear, and tests one by reaching the arr with its key', async () => {
    const { port, seerr } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const servers = '/api/v1/settings/sonarr';
    const server = {
      name: 'Sonarr (Mediaplane)',
      hostname: 'sonarr',
      port: 8989,
      apiKey: SONARR_KEY,
      useSsl: false,
      activeProfileId: 4,
      activeProfileName: 'HD-1080p',
      activeDirectory: '/data/media/tv',
      is4k: false,
      enableSeasonFolders: false,
      isDefault: true,
    };
    const send = (path: string, method: string, body: unknown) =>
      call(port, path, { method, body, headers: keyed });
    const { name: _n, ...nameless } = server;
    expect((await send(servers, 'POST', nameless)).status).toBe(400);
    expect((await send(servers, 'POST', { ...server, id: 3 })).status).toBe(400);
    expect(await send(servers, 'POST', server)).toMatchObject({
      status: 201,
      body: { id: 0 },
    });
    expect(await send(servers, 'POST', { ...server, name: 'Other' })).toMatchObject({
      status: 201,
      body: { id: 1 },
    });
    // A new default clears the old one.
    expect(seerr.seerr.sonarr.map((s) => s.isDefault)).toEqual([false, true]);
    expect((await call(port, servers, { headers: keyed })).body).toMatchObject([
      { id: 0, apiKey: SONARR_KEY },
      { id: 1 },
    ]);
    expect((await send(`${servers}/0`, 'PUT', { ...server, id: 0 })).status).toBe(400);
    expect((await send(`${servers}/0`, 'PUT', server)).status).toBe(200);
    expect((await send(`${servers}/9`, 'PUT', server)).status).toBe(404);
    expect((await send('/api/v1/settings/radarr/9', 'PUT', server)).status).toBe(500);

    const test = (body: unknown) => send(`${servers}/test`, 'POST', body);
    expect(await test(server)).toMatchObject({
      status: 200,
      body: {
        profiles: [{ id: 1, name: 'Any' }, {}, {}, { id: 4, name: 'HD-1080p' }, {}, {}],
        rootFolders: [{ id: 1, path: '/data/media/tv' }],
      },
    });
    const errors = seerr.seerr.errors.length;
    for (const wrong of [
      { apiKey: '0'.repeat(32) },
      { hostname: 'elsewhere' },
      { port: 1 },
      { useSsl: true },
    ]) {
      expect(await test({ ...server, ...wrong })).toMatchObject({
        status: 500,
        body: { message: 'Failed to connect to Sonarr' },
      });
    }
    expect(seerr.seerr.errors.length).toBe(errors + 4);
    const { apiKey: _k, ...keyless } = server;
    expect((await test(keyless)).status).toBe(400);
  });

  it('keeps settings.json in its config folder, naming its media server once it has one', async () => {
    const { port, seerr } = await stack();
    const dir = await tempDir('mediaplane-seerr-');
    seerr.seerr.configDir = dir;
    const written = () => readFile(join(dir, 'settings.json'), 'utf8');
    await call(port, '/api/v1/settings/public');
    expect(await written()).toBe('{\n "main": {\n  "mediaServerType": 4\n }\n}');
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    expect(await written()).toContain('"mediaServerType": 2');
  });

  it('is set up by a claimant who signs in first, through the Jellyfin they name', async () => {
    const { port, seerr } = await stack();
    seerr.seerr.claimant = { user: 'someone', jellyfin: 'claimants-jellyfin' };
    expect((await call(port, '/api/v1/auth/jellyfin', { body: FIRST })).body).toEqual({
      error: 'Jellyfin hostname already configured',
    });
    expect(seerr.seerr).toMatchObject({
      mediaServerType: SEERR_JELLYFIN,
      users: ['someone'],
      jellyfin: { ip: 'claimants-jellyfin' },
    });
  });

  it('quotes every key it holds in its refusals while echoKey is set, as an app may', async () => {
    const { port, seerr } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    await call(port, '/api/v1/settings/sonarr', {
      body: {
        name: 'Sonarr (Mediaplane)',
        hostname: 'sonarr',
        port: 8989,
        apiKey: SONARR_KEY,
        useSsl: false,
        activeProfileId: 4,
        activeProfileName: 'HD-1080p',
        activeDirectory: '/data/media/tv',
        is4k: false,
        enableSeasonFolders: true,
        isDefault: true,
      },
      headers: keyed,
    });
    const own = seerr.seerr.jellyfin.apiKey;
    expect((await call(port, '/api/v1/nosuch', { headers: keyed })).body).toBe('');
    seerr.seerr.echoKey = true;
    expect(await call(port, '/api/v1/nosuch', { headers: keyed })).toEqual({
      status: 404,
      body: { message: `fake failure, holding ${own} ${SONARR_KEY}` },
      cookie: undefined,
    });
    // A passing answer is left as it is.
    expect((await call(port, '/api/v1/auth/me', { headers: keyed })).status).toBe(200);
    // A path it is told to fail is refused, whatever is sent.
    seerr.seerr.echoKey = false;
    seerr.seerr.failing = ['/api/v1/auth/me'];
    expect(await call(port, '/api/v1/auth/me?x=1', { headers: keyed })).toMatchObject({
      status: 400,
      body: { message: 'request/fake failure' },
    });
  });

  it('is initialized by initialize, which it takes again', async () => {
    const { port } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    for (let i = 0; i < 2; i++) {
      expect(
        await call(port, '/api/v1/settings/initialize', {
          method: 'POST',
          headers: keyed,
        }),
      ).toMatchObject({ status: 200, body: { initialized: true } });
    }
    expect((await call(port, '/api/v1/settings/public')).body).toMatchObject({
      initialized: true,
    });
  });
});
