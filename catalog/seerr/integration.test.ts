import {
  AppApiError,
  createAppApi,
  type DesiredResource,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  claimFakePlex,
  FAKE_PLEX_ACCOUNT,
  fakeJellyfinSetUp,
  fakePlexTv,
  fakeStackApis,
  freshAppState,
  NO_SETUP_CONTEXT,
  SERVARR_PROFILES,
  SET_UP_JELLYFIN,
  thrown,
  wiringStack,
  type FakeAppState,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { seerrBootstrap } from './bootstrap';
import integration from './integration';

const PASSWORD = SET_UP_JELLYFIN.password;
const ADMIN = { username: 'admin', password: PASSWORD };
const JELLYFIN_KEY = SET_UP_JELLYFIN.key;
const SEERR_KEY = '5'.repeat(32);
const SONARR_KEY = '1'.repeat(32);
const RADARR_KEY = '2'.repeat(32);
const KEYS = {
  jellyfin: { apiKey: JELLYFIN_KEY },
  seerr: { apiKey: SEERR_KEY },
  sonarr: { apiKey: SONARR_KEY },
  radarr: { apiKey: RADARR_KEY },
};

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  radarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;

/** Seerr's resource `name`. */
function resource(name: string): ResourceSpec {
  const spec = integration.resources.find((r) => r.name === name);
  if (spec === undefined) throw new Error(`Seerr has no resource ${name}`);
  return spec;
}

/** What Seerr's resources see in the stack `source`. */
function contextOf(source = STACK): WiringContext {
  const stack = wiringStack(catalog, source);
  const app = stack.apps.find((a) => a.def.id === 'seerr');
  if (app === undefined) throw new Error('no Seerr in the stack');
  return { stack, app, admin: ADMIN, keys: KEYS };
}

/** What `spec` wants, which the test stack always wants. */
function wanted(spec: ResourceSpec, ctx = contextOf()): DesiredResource {
  const desired = spec.desired(ctx);
  if (desired === undefined) throw new Error(`${spec.name} is wanted`);
  return desired;
}

/**
 * The stack's fakes: Jellyfin set up, with Movies and Shows; Sonarr and Radarr with their
 * keys and root folders; and Seerr, set up by its first sign-in. A client of Seerr, with
 * its key.
 */
async function seerr() {
  const apis = await fakeStackApis();
  const jellyfin = fakeJellyfinSetUp({
    libraries: [
      { Name: 'Movies', CollectionType: 'movies', Locations: [], LibraryOptions: {} },
      { Name: 'Shows', CollectionType: 'tvshows', Locations: [], LibraryOptions: {} },
    ],
  });
  apis.apps.set('jellyfin', jellyfin);
  const arr = (key: string, path: string): FakeAppState => ({
    ...freshAppState(),
    key,
    rootFolders: [{ id: 1, path }],
  });
  const sonarr = arr(SONARR_KEY, '/data/media/tv');
  const radarr = arr(RADARR_KEY, '/data/media/movies');
  apis.apps.set('sonarr', sonarr);
  apis.apps.set('radarr', radarr);
  const state: FakeAppState = { ...freshAppState(), key: SEERR_KEY };
  apis.apps.set('seerr', state);
  const api = createAppApi({
    name: 'Seerr',
    service: 'seerr',
    port: 5055,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SEERR_KEY },
    secrets: [PASSWORD, JELLYFIN_KEY, SEERR_KEY, SONARR_KEY, RADARR_KEY],
    retry: { deadlineMs: 0 },
  });
  await seerrBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT);
  const calls = (from = 0) =>
    apis.app.requests.slice(from).map((r: FakeRequest) => `${r.method} ${r.path}`);
  return { api, apis, jellyfin, sonarr, radarr, state, calls };
}

describe("Seerr's media server, with Plex", () => {
  const spec = resource('media_server_plex');
  const TOKEN = FAKE_PLEX_ACCOUNT.token;
  const PLEX_STACK = STACK.replace(
    'media_server: jellyfin',
    'media_server: plex\nplex: { token: { file: secrets/plex-token } }',
  );

  /**
   * The stack's fakes: Plex your account claimed, with Movies and TV Shows; Seerr signed
   * in to by your account, its first sign-in; and a client of Seerr, with its key.
   */
  async function plexSeerr() {
    const plexTv = await fakePlexTv();
    const apis = await fakeStackApis(plexTv.state);
    const plex = freshAppState();
    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    for (const [key, title, type] of [
      ['1', 'Movies', 'movie'],
      ['2', 'TV Shows', 'show'],
    ] as const) {
      plex.plex.sections.push({
        key,
        title,
        type,
        agent: 'fake',
        scanner: 'fake',
        language: 'en-US',
        locations: [],
      });
    }
    apis.apps.set('plex', plex);
    const state: FakeAppState = { ...freshAppState(), key: SEERR_KEY };
    apis.apps.set('seerr', state);
    const api = createAppApi({
      name: 'Seerr',
      service: 'seerr',
      port: 5055,
      endpoint: { host: '127.0.0.1', port: apis.app.port },
      key: { scheme: 'x-api-key', value: SEERR_KEY },
      secrets: [SEERR_KEY, TOKEN],
      retry: { deadlineMs: 0 },
    });
    await seerrBootstrap.run(api, ADMIN, contextOf(PLEX_STACK).stack, {
      keys: { plex: { token: TOKEN } },
      plexTv: plexTv.client,
    });
    const calls = () =>
      apis.app.requests.map((r: FakeRequest) => `${r.method} ${r.path}`);
    return { api, state, calls, plex: plex.plex, plexApp: plex };
  }

  it("is wanted only with Plex, at Plex's service and port, with both libraries, and holds no secret", () => {
    expect(spec).toMatchObject({
      fields: ['hostname', 'port', 'libraries'],
      secrets: [],
      requires: ['plex.server', 'plex.library_movies', 'plex.library_tv'],
    });
    expect(wanted(spec, contextOf(PLEX_STACK))).toEqual({
      name: 'Plex',
      fields: { hostname: 'plex', port: 32400, libraries: 'Movies,TV Shows' },
      secrets: {},
    });
    expect(spec.desired(contextOf())).toBeUndefined();
    expect(resource('media_server').desired(contextOf(PLEX_STACK))).toBeUndefined();
  });

  it("points Seerr at the stack's Plex, then syncs and enables both libraries", async () => {
    const { api, state, calls } = await plexSeerr();
    const desired = wanted(spec, contextOf(PLEX_STACK));
    // Its first sign-in leaves its Plex unset.
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    const before = calls().length;
    expect(await spec.create(api, desired)).toEqual({ id: null });
    expect(calls().slice(before)).toEqual([
      'POST /api/v1/settings/plex',
      'POST /api/v1/settings/plex/library/sync',
      'GET /api/v1/settings/plex/library',
      'PUT /api/v1/settings/plex/library/1',
      'PUT /api/v1/settings/plex/library/2',
    ]);
    expect(state.seerr.plex).toMatchObject({ ip: 'plex', port: 32400, useSsl: false });
    expect(await spec.observe(api, undefined, desired)).toEqual({
      id: null,
      name: 'Plex',
      fields: { hostname: 'plex', port: 32400, libraries: 'Movies,TV Shows' },
    });
  });

  it("puts back the stack's Plex when Seerr's is held with TLS, and a library turned off", async () => {
    const { api, state } = await plexSeerr();
    const desired = wanted(spec, contextOf(PLEX_STACK));
    await spec.create(api, desired);
    state.seerr.plex.useSsl = true;
    const [movies] = state.seerr.plex.libraries;
    if (movies === undefined) throw new Error('no library synced');
    movies.enabled = false;
    const held = await spec.observe(api, undefined, desired);
    expect(held?.fields).toEqual({
      hostname: 'https://plex:32400',
      port: 32400,
      libraries: 'TV Shows',
    });
    if (held === undefined) throw new Error('Seerr holds a Plex');
    await spec.update(api, desired, held);
    expect(await spec.observe(api, undefined, desired)).toMatchObject({
      fields: { hostname: 'plex', libraries: 'Movies,TV Shows' },
    });
  });

  it("reads a link Seerr never saved as not linked, though it holds Plex's address, and links it once Plex answers", async () => {
    const { api, state, plexApp } = await plexSeerr();
    const desired = wanted(spec, contextOf(PLEX_STACK));
    // Plex doesn't answer Seerr: the save fails, but Seerr keeps what was sent.
    plexApp.up = false;
    expect(await thrown(spec.create(api, desired))).toMatchObject({ kind: 'server' });
    expect(state.seerr.plex).toMatchObject({ ip: 'plex', port: 32400 });
    expect(state.seerr.plex.machineId).toBeUndefined();
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    plexApp.up = true;
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    await spec.create(api, desired);
    expect(state.seerr.plex.machineId).toBe('fake-machine-identifier-0001');
    expect(await spec.observe(api, undefined, desired)).toMatchObject({
      fields: { hostname: 'plex', libraries: 'Movies,TV Shows' },
    });
    // A link held with an empty machine identifier is not linked either.
    state.seerr.plex.machineId = '';
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
  });

  it('refuses a library Seerr finds no Plex library of, by name', async () => {
    const { api, plex } = await plexSeerr();
    const desired = wanted(spec, contextOf(PLEX_STACK));
    await spec.create(api, desired);
    const held = await spec.observe(api, undefined, desired);
    if (held === undefined) throw new Error('Seerr holds a Plex');
    // Renamed in Plex: Seerr syncs it under its new name.
    const [movies] = plex.sections;
    if (movies === undefined) throw new Error('no Plex library');
    movies.title = 'Films';
    expect(
      await thrown(
        spec.update(api, desired, { ...held, fields: { ...held.fields, libraries: '' } }),
      ),
    ).toMatchObject({
      kind: 'rejected',
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) finds no Plex library named Movies (POST /api/v1/settings/plex/library/sync)',
    });
  });
});

describe("Seerr's media server", () => {
  const spec = resource('media_server');

  it('is Jellyfin at its service, with Movies and Shows enabled, keeping the key Seerr made itself while it works', async () => {
    const { api, state, jellyfin, calls } = await seerr();
    const desired = wanted(spec);
    expect(desired).toEqual({
      name: 'Jellyfin',
      fields: { hostname: 'jellyfin', port: 8096, libraries: 'Movies,Shows' },
      secrets: { apiKey: JELLYFIN_KEY },
    });
    // Its first sign-in set Jellyfin, with a key of Seerr's own, and no library yet.
    const seerrKey = jellyfin.apiKeys.find((k) => k.AppName === 'Seerr')?.AccessToken;
    const observed = await spec.observe(api, undefined, desired);
    expect(observed).toEqual({
      id: null,
      name: 'Jellyfin',
      fields: { hostname: 'jellyfin', port: 8096, libraries: '' },
    });
    if (observed === undefined) throw new Error('observed');
    const before = calls().length;
    await spec.update(api, desired, observed);
    expect(calls(before)).toEqual([
      'GET /api/v1/settings/jellyfin/users',
      'POST /api/v1/settings/jellyfin/library/sync',
      'GET /api/v1/settings/jellyfin/library',
      `PUT /api/v1/settings/jellyfin/library/${state.seerr.jellyfin.libraries[0]?.id ?? ''}`,
      `PUT /api/v1/settings/jellyfin/library/${state.seerr.jellyfin.libraries[1]?.id ?? ''}`,
    ]);
    expect((await spec.observe(api, undefined, desired))?.fields.libraries).toBe(
      'Movies,Shows',
    );
    // Seerr's own key works: it stays, and nothing is logged for checking it.
    expect(state.seerr.jellyfin.apiKey).toBe(seerrKey);
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    expect(state.seerr.errors).toEqual([]);
  });

  it('reads a link held without the Jellyfin server id Seerr sets when it saves one as not linked, and links it again', async () => {
    const { api, state } = await seerr();
    const desired = wanted(spec);
    expect(await spec.observe(api, undefined, desired)).toBeDefined();
    state.seerr.jellyfin.serverId = '';
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    await spec.create(api, desired);
    expect(state.seerr.jellyfin.serverId).not.toBe('');
    expect(await spec.observe(api, undefined, desired)).toMatchObject({
      fields: { hostname: 'jellyfin', libraries: 'Movies,Shows' },
    });
  });

  it("gives Seerr Mediaplane's key once Jellyfin refuses its own, or Jellyfin moved", async () => {
    const { api, state, jellyfin, calls } = await seerr();
    const desired = wanted(spec);
    jellyfin.apiKeys = jellyfin.apiKeys.filter((k) => k.AppName !== 'Seerr');
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    // The check fails, and Seerr logs that it did.
    expect(await spec.verify?.(api, desired, observed)).toBe(false);
    expect(state.seerr.errors).toHaveLength(1);
    await spec.update(api, desired, observed);
    expect(state.seerr.jellyfin).toMatchObject({ ip: 'jellyfin', apiKey: JELLYFIN_KEY });
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    // Seerr's field is `ip`: a `hostname` would be kept as a stray setting, and is the
    // sign-in's field, which Seerr refuses once set.
    expect(state.seerr.jellyfin).not.toHaveProperty('hostname');
    // Pointed elsewhere by hand: put back, with the key, and its libraries synced again.
    state.seerr.jellyfin.ip = 'elsewhere';
    const moved = await spec.observe(api, undefined, desired);
    expect(moved?.fields.hostname).toBe('elsewhere');
    if (moved === undefined) throw new Error('moved');
    const before = calls().length;
    await spec.update(api, desired, moved);
    expect(state.seerr.jellyfin.ip).toBe('jellyfin');
    expect(state.seerr.jellyfin).not.toHaveProperty('hostname');
    expect(calls(before)).toContain('POST /api/v1/settings/jellyfin/library/sync');
  });

  it("sends Mediaplane's Jellyfin key only to the stack's Jellyfin, whatever Seerr holds", async () => {
    const { api, apis, state } = await seerr();
    const desired = wanted(spec);
    state.seerr.jellyfin.ip = 'elsewhere';
    state.seerr.jellyfin.port = 4444;
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    const before = apis.app.requests.length;
    await spec.update(api, desired, observed);
    const carrying = apis.app.requests
      .slice(before)
      .filter((r) => r.body.includes(JELLYFIN_KEY));
    expect(carrying).toHaveLength(1);
    expect(JSON.parse(carrying[0]?.body ?? '{}')).toMatchObject({
      ip: 'jellyfin',
      port: 8096,
    });
  });

  it.each([
    [
      'a URL base to another host',
      { urlBase: '@198.51.100.7' },
      'http://jellyfin:8096@198.51.100.7',
    ],
    ['a URL base', { urlBase: '/jellyfin' }, 'http://jellyfin:8096/jellyfin'],
    ['TLS', { useSsl: true }, 'https://jellyfin:8096'],
  ])(
    'sees %s as Jellyfin moved, and puts it back through the settings, never sending hostname',
    async (_what, change, seen) => {
      const { api, apis, state } = await seerr();
      const desired = wanted(spec);
      Object.assign(state.seerr.jellyfin, change);
      const observed = await spec.observe(api, undefined, desired);
      expect(observed?.fields.hostname).toBe(seen);
      if (observed === undefined) throw new Error('observed');
      const before = apis.app.requests.length;
      await spec.update(api, desired, observed);
      expect(state.seerr.jellyfin).toMatchObject({
        ip: 'jellyfin',
        port: 8096,
        useSsl: false,
        urlBase: '',
      });
      const sent = apis.app.requests.slice(before);
      const saves = sent.filter(
        (r) => r.method === 'POST' && r.path === '/api/v1/settings/jellyfin',
      );
      expect(saves).toHaveLength(1);
      const body = JSON.parse(saves[0]?.body ?? '{}') as Record<string, unknown>;
      expect(body).toMatchObject({
        ip: 'jellyfin',
        port: 8096,
        useSsl: false,
        urlBase: '',
      });
      expect(body).not.toHaveProperty('hostname');
      expect(sent.some((r) => r.path === '/api/v1/auth/jellyfin')).toBe(false);
      expect((await spec.observe(api, undefined, desired))?.fields.hostname).toBe(
        'jellyfin',
      );
    },
  );

  it('makes it when Seerr has no Jellyfin, and refuses to enable a library Jellyfin lacks', async () => {
    const { api, state, jellyfin } = await seerr();
    const desired = wanted(spec);
    state.seerr.jellyfin.ip = '';
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    expect(await spec.create(api, desired)).toEqual({ id: null });
    expect((await spec.observe(api, undefined, desired))?.fields).toEqual(desired.fields);
    const shows = jellyfin.libraries.find((l) => l.Name === 'Shows');
    if (shows !== undefined) shows.Name = 'Series';
    state.seerr.jellyfin.libraries = [];
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    const refused = await thrown(spec.update(api, desired, observed));
    expect(refused).toBeInstanceOf(AppApiError);
    expect((refused as Error).message).toBe(
      'Seerr at http://seerr:5055 (127.0.0.1) finds no Jellyfin library named Shows (POST /api/v1/settings/jellyfin/library/sync)',
    );
  });

  it('is wanted only with Jellyfin in the stack, and before Jellyfin has made its key', () => {
    const keyless = { ...contextOf(), keys: {} };
    expect(wanted(spec, keyless).secrets).toEqual({});
    const ctx = contextOf();
    const noJellyfin = {
      ...ctx,
      stack: {
        ...ctx.stack,
        apps: ctx.stack.apps.filter((a) => a.def.id !== 'jellyfin'),
      },
    };
    expect(spec.desired(noJellyfin)).toBeUndefined();
  });
});

describe.each([
  ['sonarr', 'Sonarr', 8989, '/data/media/tv', SONARR_KEY],
  ['radarr', 'Radarr', 7878, '/data/media/movies', RADARR_KEY],
] as const)("Seerr's %s server", (arr, name, port, folder, key) => {
  const spec = resource(`server_${arr}`);

  it("wants the arr at its service, its root folder, by default, and the profile it prefers from the arr's own", async () => {
    const { api, sonarr, radarr } = await seerr();
    const desired = wanted(spec);
    expect(desired).toEqual({
      name: `${name} (Mediaplane)`,
      fields: { hostname: arr, port, activeDirectory: folder, isDefault: true },
      secrets: { apiKey: key },
    });
    const ctx = contextOf();
    const resolved = await spec.resolve?.(api, desired, ctx);
    expect(resolved?.fields.activeProfile).toBe('HD-1080p');
    const held = arr === 'sonarr' ? sonarr : radarr;
    // Without HD-1080p, Any; without either, the arr's first.
    held.profiles = SERVARR_PROFILES.filter((p) => p.name !== 'HD-1080p');
    expect((await spec.resolve?.(api, desired, ctx))?.fields.activeProfile).toBe('Any');
    held.profiles = [{ id: 9, name: 'Mine' }];
    expect((await spec.resolve?.(api, desired, ctx))?.fields.activeProfile).toBe('Mine');
    held.profiles = [];
    expect(
      await thrown(spec.resolve?.(api, desired, ctx) ?? Promise.resolve()),
    ).toMatchObject({ kind: 'rejected' });
  });

  it('takes the profile the stack names, and refuses one the arr lacks, saying which it has', async () => {
    const { api } = await seerr();
    const named = contextOf(
      STACK.replace('  seerr: {}', `  seerr: { ${arr}_profile: Ultra-HD }`),
    );
    const desired = wanted(spec, named);
    expect((await spec.resolve?.(api, desired, named))?.fields.activeProfile).toBe(
      'Ultra-HD',
    );
    const missing = contextOf(
      STACK.replace('  seerr: {}', `  seerr: { ${arr}_profile: 4K }`),
    );
    const refused = await thrown(
      spec.resolve?.(api, desired, missing) ?? Promise.resolve(),
    );
    expect((refused as Error).message).toBe(
      `${name} has no quality profile named 4K, which apps.seerr.${arr}_profile names; it has Any, SD, HD-720p, HD-1080p, Ultra-HD, HD - 720p/1080p (POST /api/v1/settings/${arr}/test)`,
    );
  });

  it("is made as Seerr's web UI makes one, but with season folders for shows, found by id, else by name, and its key checked with Seerr's own test", async () => {
    const { api, state, calls } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    const { id } = await spec.create(api, desired);
    expect(id).toBe(0);
    expect(state.seerr[arr]).toEqual([
      expect.objectContaining({
        id: 0,
        name: `${name} (Mediaplane)`,
        hostname: arr,
        port,
        apiKey: key,
        useSsl: false,
        activeProfileId: 4,
        activeProfileName: 'HD-1080p',
        activeDirectory: folder,
        is4k: false,
        isDefault: true,
        enableSeasonFolders: arr === 'sonarr',
      }),
    ]);
    const observed = await spec.observe(api, undefined, desired);
    expect(observed).toEqual({
      id: 0,
      name: `${name} (Mediaplane)`,
      fields: desired.fields,
    });
    // By its id, renamed by hand.
    const held = state.seerr[arr][0];
    if (held !== undefined) held.name = 'Renamed';
    const known = {
      id: 0,
      name: `${name} (Mediaplane)`,
      fields: desired.fields,
      secrets: ['apiKey'],
      appliedAt: '2026-10-16T12:00:00.000Z',
    };
    expect((await spec.observe(api, known, desired))?.id).toBe(0);
    if (observed === undefined) throw new Error('observed');
    const before = calls().length;
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    expect(calls(before)).toEqual([
      `GET /api/v1/settings/${arr}`,
      `POST /api/v1/settings/${arr}/test`,
    ]);
    expect(state.seerr.errors).toEqual([]);
  });

  it("finds a refused key by testing again with the stack's, sets it with the server sent back whole, and says when Seerr can't reach the arr", async () => {
    const { api, state, sonarr, radarr } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    await spec.create(api, desired);
    const held = state.seerr[arr][0];
    if (held === undefined) throw new Error('held');
    // A wrong key, and a tag of the user's own.
    Object.assign(held, { apiKey: '0'.repeat(32), tags: [3] });
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    expect(await spec.verify?.(api, desired, observed)).toBe(false);
    await spec.update(api, desired, observed);
    expect(state.seerr[arr][0]).toMatchObject({ id: 0, apiKey: key, tags: [3] });
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    // The arr down: Seerr's test fails either way, and that is what it says.
    (arr === 'sonarr' ? sonarr : radarr).up = false;
    const unreachable = await thrown(
      spec.verify?.(api, desired, observed) ?? Promise.resolve(),
    );
    expect((unreachable as Error).message).toBe(
      `Seerr at http://seerr:5055 (127.0.0.1) can't reach ${name} at http://${arr}:${String(port)} with the key it holds, or the stack's (POST /api/v1/settings/${arr}/test)`,
    );
    expect(await thrown(spec.create(api, desired))).toMatchObject({
      message: `Seerr at http://seerr:5055 (127.0.0.1) can't reach ${name} at http://${arr}:${String(port)} with the stack's key (POST /api/v1/settings/${arr}/test)`,
    });
  });

  it("never sends the stack's key to a host read from Seerr, which its admin can change", async () => {
    const { api, apis, state } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    await spec.create(api, desired);
    const held = state.seerr[arr][0];
    if (held === undefined) throw new Error('held');
    // Pointed at a host of someone else's, with a key Seerr's test refuses.
    Object.assign(held, { hostname: 'elsewhere', port: 4444, apiKey: '0'.repeat(32) });
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    const before = apis.app.requests.length;
    expect(await spec.verify?.(api, desired, observed)).toBe(false);
    await spec.update(api, desired, observed);
    expect(state.seerr[arr][0]).toMatchObject({ hostname: arr, port, apiKey: key });
    const carrying = apis.app.requests
      .slice(before)
      .filter((r) => r.body.includes(key))
      .map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(carrying.length).toBeGreaterThan(0);
    for (const body of carrying) expect(body).toMatchObject({ hostname: arr, port });
  });

  it("sends the stack's key with no URL base, whatever base Seerr holds for the server", async () => {
    const { api, apis, state } = await seerr();
    const before = apis.app.requests.length;
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    await spec.create(api, desired);
    const held = state.seerr[arr][0];
    if (held === undefined) throw new Error('held');
    // A URL base that takes Seerr's test to a host of someone else's, and a key the
    // test refuses: the retest and the update carry the stack's key.
    Object.assign(held, { baseUrl: '@203.0.113.9', apiKey: '0'.repeat(32) });
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    const verdict = await (
      spec.verify?.(api, desired, observed) ?? Promise.resolve()
    ).catch((cause: unknown) => cause);
    await spec.update(api, desired, observed);
    const carrying = apis.app.requests
      .slice(before)
      .filter((r) => r.body.includes(key))
      .map((r) => `${r.method} ${r.path} ${JSON.stringify(JSON.parse(r.body))}`);
    // The resolve's test, the create, the retest and the update.
    expect(carrying.length).toBeGreaterThanOrEqual(4);
    for (const request of carrying) expect(request).toContain('"baseUrl":""');
    for (const request of carrying) expect(request).not.toContain('203.0.113.9');
    expect(verdict).toBe(false);
    expect(state.seerr[arr][0]).toMatchObject({ baseUrl: '', apiKey: key });
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
  });

  it.each([
    [
      'a URL base to another host',
      { baseUrl: '@203.0.113.9' },
      `http://${arr}:${String(port)}@203.0.113.9`,
    ],
    ['TLS', { useSsl: true }, `https://${arr}:${String(port)}`],
  ])(
    "sees %s on the server as another address, and never sends the stack's key through it",
    async (_what, change, seen) => {
      const { api, apis, state } = await seerr();
      const desired =
        (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
      await spec.create(api, desired);
      const held = state.seerr[arr][0];
      if (held === undefined) throw new Error('held');
      // Changed by Seerr's admin, the stack's key left as it is.
      Object.assign(held, change);
      const before = apis.app.requests.length;
      const observed = await spec.observe(api, undefined, desired);
      expect(observed?.fields.hostname).toBe(seen);
      if (observed === undefined) throw new Error('observed');
      // Even asked to, the check sends the stack's key only to the stack's address.
      await (spec.verify?.(api, desired, observed) ?? Promise.resolve()).catch(
        () => undefined,
      );
      await spec.update(api, desired, observed);
      const carrying = apis.app.requests
        .slice(before)
        .filter((r) => r.body.includes(key))
        .map((r) => JSON.parse(r.body) as Record<string, unknown>);
      expect(carrying.length).toBeGreaterThan(0);
      for (const body of carrying) {
        expect(body).toMatchObject({ hostname: arr, port, useSsl: false, baseUrl: '' });
      }
      expect(state.seerr[arr][0]).toMatchObject({ baseUrl: '', useSsl: false });
      expect((await spec.observe(api, undefined, desired))?.fields.hostname).toBe(arr);
    },
  );

  it('puts back what was changed by hand: its profile, folder and default', async () => {
    const { api, state, sonarr, radarr } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    await spec.create(api, desired);
    const held = state.seerr[arr][0];
    if (held === undefined) throw new Error('held');
    Object.assign(held, {
      activeProfileId: 1,
      activeProfileName: 'Any',
      activeDirectory: '/elsewhere',
      isDefault: false,
    });
    const observed = await spec.observe(api, undefined, desired);
    expect(observed?.fields).toMatchObject({
      activeProfile: 'Any',
      activeDirectory: '/elsewhere',
      isDefault: false,
    });
    if (observed === undefined) throw new Error('observed');
    await spec.update(api, desired, observed);
    expect(state.seerr[arr][0]).toMatchObject({
      activeProfileId: 4,
      activeProfileName: 'HD-1080p',
      activeDirectory: folder,
      isDefault: true,
    });
    // A profile that has gone from the arr since is refused, rather than sent by an id.
    (arr === 'sonarr' ? sonarr : radarr).profiles = [{ id: 1, name: 'Any' }];
    expect(await thrown(spec.update(api, desired, observed))).toMatchObject({
      message: `${name} has no quality profile named HD-1080p any more (POST /api/v1/settings/${arr}/test)`,
    });
  });
});

describe('The keys Seerr shows in clear', () => {
  it("are kept out of what it says once read: its own Jellyfin key, and each server's, typed by hand too", async () => {
    const { api, state, jellyfin } = await seerr();
    const sonarr = resource('server_sonarr');
    const desired =
      (await sonarr.resolve?.(api, wanted(sonarr), contextOf())) ?? wanted(sonarr);
    await sonarr.create(api, desired);
    const typed = '3'.repeat(32);
    const held = state.seerr.sonarr[0];
    if (held !== undefined) held.apiKey = typed;
    const media = resource('media_server');
    await media.observe(api, undefined, wanted(media));
    await sonarr.observe(api, undefined, desired);
    state.seerr.echoKey = true;
    const said = await thrown(api.check('/api/v1/nosuch'));
    expect(said).toMatchObject({
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 404): fake failure, holding *** *** *** (GET /api/v1/nosuch)',
    });
    const own = jellyfin.apiKeys.find((k) => k.AppName === 'Seerr')?.AccessToken;
    expect(own).toBeDefined();
    expect(JSON.stringify(said)).not.toMatch(new RegExp(`${own ?? ''}|${typed}`));
  });
});

describe("Seerr's setup", () => {
  const spec = resource('setup');

  it('is initialized once its links are in place, which it requires', async () => {
    const { api, state, calls } = await seerr();
    expect(spec.requires).toEqual([
      'seerr.media_server',
      'seerr.media_server_plex',
      'seerr.server_sonarr',
      'seerr.server_radarr',
    ]);
    const desired = wanted(spec);
    const observed = await spec.observe(api, undefined, desired);
    expect(observed).toEqual({ id: null, name: 'setup', fields: { initialized: false } });
    if (observed === undefined) throw new Error('observed');
    await spec.update(api, desired, observed);
    expect(state.seerr.initialized).toBe(true);
    expect((await spec.observe(api, undefined, desired))?.fields.initialized).toBe(true);
    expect(await spec.create(api, desired)).toEqual({ id: null });
    expect(calls().filter((c) => c.endsWith('/initialize'))).toHaveLength(2);
  });
});
