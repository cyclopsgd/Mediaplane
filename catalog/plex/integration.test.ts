import { createAppApi, type ResourceSpec, type WiringContext } from '@mediaplane/engine';
import {
  claimFakePlex,
  FAKE_PLEX_ACCOUNT,
  fakePlexTv,
  fakeStackApis,
  freshAppState,
  thrown,
  wiringStack,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import integration, { LIBRARIES, SERVER_NAME } from './integration';

const TOKEN = FAKE_PLEX_ACCOUNT.token;

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

/** One of Plex's resources, by name. */
function resource(name: string): ResourceSpec {
  const found = integration.resources.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
}

function contextOf(source = STACK): WiringContext {
  const stack = wiringStack(catalog, source);
  const app = stack.apps.find((a) => a.def.id === 'plex');
  if (app === undefined) throw new Error('no Plex in the stack');
  return {
    stack,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys: { plex: { token: TOKEN } },
  };
}

function wanted(name: string, ctx = contextOf()) {
  const desired = resource(name).desired(ctx);
  if (desired === undefined) throw new Error(`${name} is wanted`);
  return desired;
}

/** A Plex your account claimed, faked as fakeStackApis fakes it, and a client with your token. */
async function plexOf() {
  const plexTv = await fakePlexTv();
  const apis = await fakeStackApis(plexTv.state);
  const state = freshAppState();
  claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
  apis.apps.set('plex', state);
  const api = createAppApi({
    name: 'Plex',
    service: 'plex',
    port: 32400,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-plex-token', value: TOKEN },
    secrets: [TOKEN],
    retry: { deadlineMs: 0 },
  });
  const calls = () =>
    apis.app.requests.map(({ method, path }: FakeRequest) => `${method} ${path}`);
  return { api, plex: state.plex, calls };
}

describe("Plex's name", () => {
  it('is Mediaplane, or the name apps.plex.server_name gives', () => {
    expect(wanted('server')).toEqual({
      name: 'server',
      fields: { name: SERVER_NAME },
      secrets: {},
    });
    expect(SERVER_NAME).toBe('Mediaplane');
    const named = contextOf(`${STACK}  plex: { server_name: Living room }\n`);
    expect(wanted('server', named).fields).toEqual({ name: 'Living room' });
  });

  it("is set where Plex has none, and Plex's name for itself is then the one it shows", async () => {
    const { api, plex } = await plexOf();
    const spec = resource('server');
    // A new Plex has no name of its own: it shows its container's hostname.
    expect(await spec.observe(api, undefined)).toEqual({
      id: null,
      name: 'server',
      fields: { name: '' },
    });
    expect(plex.friendlyName).toBe('');
    await spec.create(api, wanted('server'));
    expect(plex.friendlyName).toBe('Mediaplane');
    plex.friendlyName = 'Renamed by hand';
    const held = await spec.observe(api, undefined);
    if (held === undefined) throw new Error('Plex has a name');
    await spec.update(api, wanted('server'), held);
    expect(plex.friendlyName).toBe('Mediaplane');
  });

  it('never turns on remote access, nor adds a network allowed in without signing in', async () => {
    const { api, plex, calls } = await plexOf();
    const spec = resource('server');
    await spec.create(api, wanted('server'));
    expect(plex.remoteAccess).toBe(false);
    expect(plex.allowedNetworks).toBe('');
    expect(calls().filter((c) => c.startsWith('PUT'))).toEqual([
      'PUT /:/prefs?FriendlyName=Mediaplane',
    ]);
  });
});

describe("Plex's API", () => {
  it('says Plex has started only once /identity has no startState', () => {
    const plex = catalog.find((app) => app.id === 'plex');
    const done = plex?.api?.started?.done;
    expect(plex?.api?.started?.path).toBe('/identity');
    expect(
      done?.({ MediaContainer: { claimed: true, startState: 'startingPlugins' } }),
    ).toBe(false);
    expect(done?.({ MediaContainer: { claimed: true } })).toBe(true);
    expect(done?.('not an identity')).toBe(false);
  });

  it('refuses a new library while it starts, which the fake says, as Plex does', async () => {
    const { api, plex } = await plexOf();
    plex.startingFor = 1;
    expect(
      await thrown(resource('library_movies').create(api, wanted('library_movies'))),
    ).toMatchObject({ kind: 'rejected', status: 400 });
  });
});

describe("Plex's libraries", () => {
  it('are Movies and TV Shows, on the folders the arrs fill, made first', () => {
    expect(LIBRARIES.map((l) => [l.resource, l.name])).toEqual([
      ['library_movies', 'Movies'],
      ['library_tv', 'TV Shows'],
    ]);
    expect(wanted('library_movies')).toEqual({
      name: 'Movies',
      fields: { name: 'Movies', type: 'movie', location: '/data/media/movies' },
      secrets: {},
      folders: ['/data/media/movies'],
    });
    expect(wanted('library_tv').fields).toEqual({
      name: 'TV Shows',
      type: 'show',
      location: '/data/media/tv',
    });
  });

  it("are made with Plex's agent and scanner for what they hold, and found again by their key", async () => {
    const { api, plex } = await plexOf();
    const movies = resource('library_movies');
    const tv = resource('library_tv');
    expect(await movies.observe(api, undefined)).toBeUndefined();
    expect(await movies.create(api, wanted('library_movies'))).toEqual({ id: '1' });
    expect(await tv.create(api, wanted('library_tv'))).toEqual({ id: '2' });
    expect(plex.sections).toEqual([
      {
        key: '1',
        title: 'Movies',
        type: 'movie',
        agent: 'tv.plex.agents.movie',
        scanner: 'Plex Movie',
        language: 'en-US',
        locations: ['/data/media/movies'],
      },
      {
        key: '2',
        title: 'TV Shows',
        type: 'show',
        agent: 'tv.plex.agents.series',
        scanner: 'Plex TV Series',
        language: 'en-US',
        locations: ['/data/media/tv'],
      },
    ]);
    // Renamed by hand, it is still found by the key resources.json recorded.
    const [made] = plex.sections;
    if (made === undefined) throw new Error('no library made');
    made.title = 'Films';
    const known = {
      id: '1',
      name: 'Movies',
      fields: {},
      secrets: [],
      appliedAt: '2026-10-16T12:00:00.000Z',
    };
    expect(await movies.observe(api, known)).toEqual({
      id: '1',
      name: 'Films',
      fields: { name: 'Films', type: 'movie', location: '/data/media/movies' },
    });
    // Without the record, a library of its name: none now.
    expect(await movies.observe(api, undefined)).toBeUndefined();
  });

  it('records the library it made, not the first Plex lists in its answer', async () => {
    const { api, plex } = await plexOf();
    plex.sections.push({
      key: '5',
      title: 'Documentaries',
      type: 'movie',
      agent: 'tv.plex.agents.movie',
      scanner: 'Plex Movie',
      language: 'en-US',
      locations: ['/data/elsewhere'],
    });
    // Plex lists every library, the new one last: its key is 6, not 5.
    plex.createListing = 'every';
    expect(
      await resource('library_movies').create(api, wanted('library_movies')),
    ).toEqual({
      id: '6',
    });
    // Two of a name differ by what they hold: the TV one is not the movie one.
    plex.sections.push({
      key: '8',
      title: 'TV Shows',
      type: 'movie',
      agent: 'tv.plex.agents.movie',
      scanner: 'Plex Movie',
      language: 'en-US',
      locations: ['/data/other'],
    });
    expect(await resource('library_tv').create(api, wanted('library_tv'))).toEqual({
      id: '9',
    });
  });

  it("never guesses which library it made: an answer that doesn't list it is an error", async () => {
    const { api, plex } = await plexOf();
    plex.createListing = 'other';
    expect(
      await thrown(resource('library_movies').create(api, wanted('library_movies'))),
    ).toMatchObject({
      kind: 'rejected',
      message:
        "Plex at http://plex:32400 (127.0.0.1) made the library Movies, but its answer doesn't list a movie library of that name, so Mediaplane can't tell which it is (POST /library/sections)",
    });
  });

  it('puts back its name and folder, keeping the agent you chose', async () => {
    const { api, plex } = await plexOf();
    const movies = resource('library_movies');
    await movies.create(api, wanted('library_movies'));
    const [made] = plex.sections;
    if (made === undefined) throw new Error('no library made');
    made.agent = 'tv.plex.agents.none';
    made.locations = ['/data/media/movies/', '/data/elsewhere'];
    const held = await movies.observe(api, undefined);
    expect(held?.fields.location).toBe('/data/elsewhere,/data/media/movies');
    if (held === undefined) throw new Error('the library is there');
    await movies.update(api, wanted('library_movies'), held);
    expect(plex.sections[0]).toMatchObject({
      title: 'Movies',
      agent: 'tv.plex.agents.none',
      locations: ['/data/media/movies'],
    });
  });

  it('says a library of another name holds its folder, rather than put it in two', async () => {
    const { api, plex } = await plexOf();
    plex.sections.push({
      key: '3',
      title: 'Series',
      type: 'show',
      agent: 'tv.plex.agents.series',
      scanner: 'Plex TV Series',
      language: 'en-US',
      locations: ['/data/media/tv'],
    });
    const tv = resource('library_tv');
    expect(await tv.observe(api, undefined)).toBeUndefined();
    expect(await thrown(tv.create(api, wanted('library_tv')))).toMatchObject({
      kind: 'rejected',
      message:
        'Plex at http://plex:32400 (127.0.0.1) has no library named TV Shows, but its library Series holds /data/media/tv, one of its folders: if it is TV Shows renamed, rename it back in Plex; if it is another library, take /data/media/tv out of it, or out of plex.library_tv.location under overrides:; to keep it as it is, stop Mediaplane managing TV Shows with plex.library_tv: unmanaged under overrides: (GET /library/sections)',
    });
    expect(plex.sections.map((s) => s.title)).toEqual(['Series']);
    // Known by its key, renamed is found, and its name put back.
    const movies = resource('library_movies');
    await movies.create(api, wanted('library_movies'));
    const made = plex.sections.find((s) => s.title === 'Movies');
    if (made === undefined) throw new Error('no library made');
    made.title = 'Films';
    const known = {
      id: made.key,
      name: 'Movies',
      fields: {},
      secrets: [],
      appliedAt: '2026-10-20T08:00:00.000Z',
    };
    expect((await movies.observe(api, known))?.fields.name).toBe('Films');
  });

  it("reads a folder with a comma in its name, what a library holds and Plex's name, when it can't, as such", async () => {
    const { api, plex } = await plexOf();
    const movies = resource('library_movies');
    await movies.create(api, wanted('library_movies'));
    const [made] = plex.sections;
    if (made === undefined) throw new Error('no library made');
    made.locations = ['/data/media/movies', '/data/a,b'];
    expect((await movies.observe(api, undefined))?.unreadable).toEqual({
      location: 'a folder with a comma in its name, /data/a,b',
    });
    // What it holds, of another type: unreadable, and the update says so.
    Object.assign(made, { type: 7 });
    const odd = await movies.observe(api, undefined);
    expect(odd?.fields.type).toBeUndefined();
    expect(odd?.unreadable?.type).toBe('a number, not text');
    if (odd === undefined) throw new Error('the library is there');
    expect(await thrown(movies.update(api, wanted('library_movies'), odd))).toMatchObject(
      {
        message: expect.stringContaining(
          "that holds a kind Mediaplane can't read, not movie",
        ) as string,
      },
    );
    // Plex's name for itself, of another type: unreadable, never empty.
    plex.prefsAnswer = {
      status: 200,
      body: { MediaContainer: { Setting: [{ id: 'FriendlyName', value: 7 }] } },
    };
    expect(await resource('server').observe(api, undefined)).toEqual({
      id: null,
      name: 'server',
      fields: {},
      unreadable: { name: 'a number, not text' },
    });
  });

  it('holds the folders an override names, made in one go and put back', async () => {
    const { api, plex } = await plexOf();
    const movies = resource('library_movies');
    const kept = {
      ...wanted('library_movies'),
      fields: {
        ...wanted('library_movies').fields,
        location: '/data/more,/data/media/movies',
      },
    };
    await movies.create(api, kept);
    expect(plex.sections[0]?.locations).toEqual(['/data/more', '/data/media/movies']);
    const [made] = plex.sections;
    if (made === undefined) throw new Error('no library made');
    made.locations = ['/data/media/movies'];
    const held = await movies.observe(api, undefined);
    if (held === undefined) throw new Error('the library is there');
    await movies.update(api, kept, held);
    expect(plex.sections[0]?.locations).toEqual(['/data/more', '/data/media/movies']);
  });

  it("refuses to change what a library holds, which Plex can't, saying what to do", async () => {
    const { api, plex } = await plexOf();
    const tv = resource('library_tv');
    plex.sections.push({
      key: '7',
      title: 'TV Shows',
      type: 'movie',
      agent: 'tv.plex.agents.movie',
      scanner: 'Plex Movie',
      language: 'en-US',
      locations: ['/data/media/tv'],
    });
    const held = await tv.observe(api, undefined);
    if (held === undefined) throw new Error('the library is there');
    expect(await thrown(tv.update(api, wanted('library_tv'), held))).toMatchObject({
      kind: 'rejected',
      message:
        "Plex at http://plex:32400 (127.0.0.1) has a library named TV Shows that holds movie, not show, and Plex can't change what a library holds: rename or remove it in Plex, and the next apply makes TV Shows (GET /library/sections)",
    });
    plex.sections = [];
    expect(
      await thrown(
        tv.update(api, wanted('library_tv'), {
          ...held,
          fields: { ...held.fields, type: 'show' },
        }),
      ),
    ).toMatchObject({
      message:
        'Plex at http://plex:32400 (127.0.0.1) no longer has the library TV Shows (GET /library/sections)',
    });
  });
});
