import { request as httpRequest } from 'node:http';
import {
  AppApiError,
  createAppApi,
  examine,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  FAKE_JELLYFIN_USER_ID,
  fakeHttpApp,
  fakeStackApis,
  freshAppState,
  NO_SETUP_CONTEXT,
  wiringStack,
  type FakeAppState,
  type FakeReply,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { jellyfinBootstrap, KEY_NAME } from './bootstrap';
import integration, { LIBRARIES } from './integration';

const PASSWORD = 'fake-admin-password';
const ADMIN = { username: 'admin', password: PASSWORD };
const KEY = '7'.repeat(32);

/** Jellyfin, faked as fakeStackApis fakes it, and a client: keyed with KEY, or not. */
async function jellyfin(state: FakeAppState = freshAppState(), keyed = false) {
  const apis = await fakeStackApis();
  apis.apps.set('jellyfin', state);
  const api = createAppApi({
    name: 'Jellyfin',
    service: 'jellyfin',
    port: 8096,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'mediabrowser', ...(keyed ? { value: KEY } : {}) },
    secrets: [PASSWORD, KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, apis, state, app: apis.app };
}

/**
 * Like `jellyfin()`, but through a proxy that answers some calls itself: `reply` gives the
 * answer to a request, or undefined to let the fake Jellyfin have it. `seen` has every
 * body Jellyfin answered, such as a sign-in's token.
 */
async function throughProxy(
  state: FakeAppState,
  reply: (request: FakeRequest) => FakeReply | undefined,
) {
  const apis = await fakeStackApis();
  apis.apps.set('jellyfin', state);
  const seen: string[] = [];
  const proxy = await fakeHttpApp(
    (request) =>
      reply(request) ??
      new Promise<FakeReply>((answered) => {
        const forwarded = httpRequest(
          {
            host: '127.0.0.1',
            port: apis.app.port,
            method: request.method,
            path: request.path,
            headers: request.headers,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              seen.push(text);
              answered({
                status: res.statusCode ?? 502,
                ...(text === '' ? {} : { body: text }),
                headers: { 'Content-Type': 'application/json' },
              });
            });
          },
        );
        forwarded.end(request.body);
      }),
  );
  const api = createAppApi({
    name: 'Jellyfin',
    service: 'jellyfin',
    port: 8096,
    endpoint: { host: '127.0.0.1', port: proxy.port },
    key: { scheme: 'mediabrowser' },
    secrets: [PASSWORD, KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, state, seen };
}

/** "METHOD /path" of a request, without its query. */
const callOf = ({ method, path }: FakeRequest) => `${method} ${path.split('?')[0] ?? ''}`;

/** A Jellyfin set up by Mediaplane: its wizard done, its admin, and KEY. */
function setUp(more: Partial<FakeAppState> = {}): FakeAppState {
  return {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: PASSWORD,
    apiKeys: [
      { AccessToken: KEY, AppName: KEY_NAME, DateCreated: '2026-10-15T12:00:00.000Z' },
    ],
    ...more,
  };
}

/** What `api` failed with, as an AppApiError. */
async function failure(call: Promise<unknown>): Promise<AppApiError> {
  const thrown = await call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(thrown instanceof AppApiError)) throw new Error(`expected an AppApiError`);
  return thrown;
}

/** Each call `app` received, as "METHOD /path". */
function calls(app: { requests: { method: string; path: string }[] }): string[] {
  return app.requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`);
}

function resource(name: string): ResourceSpec {
  const spec = integration.resources.find((r) => r.name === name);
  if (spec === undefined) throw new Error(`Jellyfin has no resource ${name}`);
  return spec;
}

function contextOf(): WiringContext {
  const stack = wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`,
  );
  const app = stack.apps.find((a) => a.def.id === 'jellyfin');
  if (app === undefined) throw new Error('no Jellyfin in the stack');
  return { stack, app, admin: ADMIN, keys: {} };
}

function wanted(spec: ResourceSpec) {
  const desired = spec.desired(contextOf());
  if (desired === undefined) throw new Error(`${spec.name} is wanted`);
  return desired;
}

describe("Jellyfin's first-run setup", () => {
  it('runs its startup wizard as the shared admin, makes its key, reads it back, and signs out', async () => {
    const { api, state, app } = await jellyfin();
    expect(await jellyfinBootstrap.open(api)).toBe(true);
    const key = await jellyfinBootstrap.run(
      api,
      ADMIN,
      contextOf().stack,
      NO_SETUP_CONTEXT,
    );
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(state).toMatchObject({ wizard: 'done', user: 'admin', password: PASSWORD });
    expect(state.apiKeys.map((k) => [k.AccessToken, k.AppName])).toEqual([
      [key, 'Mediaplane'],
    ]);
    expect(state.sessions).toEqual({});
    expect(await jellyfinBootstrap.open(api)).toBe(false);
    // Signed in before it completes the wizard: a first user it can't sign in as isn't
    // Mediaplane's.
    expect(calls(app)).toEqual([
      'GET /System/Info/Public',
      'GET /System/Info/Public',
      'GET /Startup/User',
      'POST /Startup/User',
      'POST /Users/AuthenticateByName',
      'POST /Startup/Complete',
      'GET /Auth/Keys',
      'POST /Auth/Keys',
      'GET /Auth/Keys',
      'POST /Sessions/Logout',
      'GET /System/Info/Public',
    ]);
  });

  it('keeps the key it made before rather than make another', async () => {
    const { api, state, app } = await jellyfin(setUp());
    expect(
      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    ).toBe(KEY);
    expect(state.apiKeys).toHaveLength(1);
    expect(calls(app)).not.toContain('POST /Auth/Keys');
  });

  it('finishes a setup that stopped once the first user had its password', async () => {
    const { api, state } = await jellyfin({
      ...freshAppState(),
      wizard: 'open',
      user: 'admin',
      password: PASSWORD,
    });
    expect(
      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    ).toMatch(/^[0-9a-f]{32}$/);
    expect(state.wizard).toBe('done');
  });

  it('leaves the wizard open, and says so, when its first user is not the shared admin', async () => {
    const { api, state, app } = await jellyfin({
      ...freshAppState(),
      wizard: 'open',
      user: 'abc',
      password: 'fake-someone-else',
    });
    const refused = await failure(
      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    );
    expect(refused.message).toBe(
      "Jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in: its startup wizard has a first user that Mediaplane did not set, so Mediaplane left the wizard open (POST /Users/AuthenticateByName)",
    );
    expect(state.wizard).toBe('open');
    expect(calls(app)).not.toContain('POST /Startup/Complete');
  });

  it('says when its wizard was finished with another login', async () => {
    const { api } = await jellyfin(setUp({ password: 'fake-someone-else' }));
    expect(
      (
        await failure(
          jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
        )
      ).message,
    ).toContain(
      "refused the shared admin's sign-in: its startup wizard was finished with another login",
    );
  });

  it('signs out when a step after the sign-in fails, and shows that failure, not the sign-out', async () => {
    const { api, state } = await throughProxy(freshAppState(), (request) =>
      callOf(request) === 'POST /Auth/Keys' ? { status: 502 } : undefined,
    );
    const failed = await failure(
      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    );
    expect(failed.status).toBe(502);
    expect(state.sessions).toEqual({});

    // A sign-out that fails after a failure doesn't hide it.
    const both = await throughProxy(freshAppState(), (request) => {
      const call = callOf(request);
      if (call === 'POST /Auth/Keys') return { status: 502 };
      return call === 'POST /Sessions/Logout' ? { status: 503 } : undefined;
    });
    expect(
      (
        await failure(
          jellyfinBootstrap.run(both.api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
        )
      ).status,
    ).toBe(502);
  });

  it('ignores the keys of other apps, and takes the newest of its own by date', async () => {
    const key = (n: number, AppName: string, DateCreated: string) => ({
      AccessToken: String(n).repeat(32),
      AppName,
      DateCreated,
    });
    // As strings, "…:05Z" sorts after "…:05.5Z": .NET drops a fraction's trailing zeros.
    const { api, state } = await jellyfin(
      setUp({
        apiKeys: [
          key(1, KEY_NAME, '2026-10-15T12:00:05Z'),
          key(2, KEY_NAME, '2026-10-15T12:00:05.5Z'),
          key(3, 'Other app', '2026-10-16T12:00:00Z'),
          key(4, KEY_NAME, '2026-10-15T12:00:05.25Z'),
        ],
      }),
    );
    expect(
      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    ).toBe('2'.repeat(32));
    expect(state.apiKeys).toHaveLength(4);
  });

  it("keeps every key Jellyfin lists out of what it says after, another app's too", async () => {
    const seerrs = '3'.repeat(32);
    const { api } = await throughProxy(
      setUp({
        apiKeys: [
          { AccessToken: KEY, AppName: KEY_NAME, DateCreated: '2026-10-15T12:00:00Z' },
          { AccessToken: seerrs, AppName: 'Seerr', DateCreated: '2026-10-15T12:01:00Z' },
        ],
      }),
      (request) =>
        callOf(request) === 'POST /Sessions/Logout'
          ? { status: 500, body: { message: `fake failure near ${seerrs}` } }
          : undefined,
    );
    const failed = await failure(
      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    );
    expect(failed.message).toBe(
      'Jellyfin at http://jellyfin:8096 (127.0.0.1) failed (HTTP 500): fake failure near *** (POST /Sessions/Logout)',
    );
  });

  it('takes the first of two keys made at the same moment', async () => {
    const at = '2026-10-15T12:00:05Z';
    const { api } = await jellyfin(
      setUp({
        apiKeys: [
          { AccessToken: '8'.repeat(32), AppName: KEY_NAME, DateCreated: at },
          { AccessToken: '9'.repeat(32), AppName: KEY_NAME, DateCreated: at },
        ],
      }),
    );
    expect(
      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    ).toBe('8'.repeat(32));
  });

  it('makes a key when only other apps have one', async () => {
    const { api, state } = await jellyfin(
      setUp({
        apiKeys: [
          { AccessToken: KEY, AppName: 'Other app', DateCreated: '2026-10-15T12:00:00Z' },
        ],
      }),
    );
    const made = await jellyfinBootstrap.run(
      api,
      ADMIN,
      contextOf().stack,
      NO_SETUP_CONTEXT,
    );
    expect(made).not.toBe(KEY);
    expect(state.apiKeys.map((k) => k.AppName)).toEqual(['Other app', KEY_NAME]);
  });

  it('says it when Jellyfin lists no key after it made one, with no secret in that, and signs out', async () => {
    const { api, state, seen } = await throughProxy(freshAppState(), (request) =>
      callOf(request) === 'POST /Auth/Keys' ? { status: 204 } : undefined,
    );
    const failed = await failure(
      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
    );
    expect(failed.message).toBe(
      'Jellyfin at http://jellyfin:8096 (127.0.0.1) made no key named Mediaplane (GET /Auth/Keys)',
    );
    expect(failed.kind).toBe('protocol');
    expect(state.sessions).toEqual({});
    // The sign-in's token is among what Jellyfin answered.
    const session = seen
      .map((text) => /"AccessToken":"([0-9a-f]+)"/.exec(text)?.[1])
      .find((found) => found !== undefined);
    expect(session).toMatch(/^[0-9a-f]{32}$/);
    for (const secret of [PASSWORD, KEY, session ?? '']) {
      expect(JSON.stringify(failed)).not.toContain(secret);
      expect(failed.message).not.toContain(secret);
    }
  });

  it('is done once system.xml says its wizard is', () => {
    const { done } = jellyfinBootstrap;
    expect(done.path).toBe('system.xml');
    expect(
      done.pattern.test('  <IsStartupWizardCompleted>true</IsStartupWizardCompleted>'),
    ).toBe(true);
    expect(
      done.pattern.test('<IsStartupWizardCompleted>false</IsStartupWizardCompleted>'),
    ).toBe(false);
  });
});

describe("Jellyfin's integration", () => {
  it('has the shared admin, then the Movies and Shows libraries, after nothing', () => {
    expect(integration.after).toEqual([]);
    expect(
      integration.resources.map((r) => [r.name, r.fields, r.secrets, r.requires]),
    ).toEqual([
      ['admin', ['username'], ['password'], undefined],
      ['library_movies', ['name', 'collectionType', 'paths'], [], undefined],
      ['library_shows', ['name', 'collectionType', 'paths'], [], undefined],
    ]);
  });
});

describe("Jellyfin's admin", () => {
  const admin = resource('admin');

  it('is the user named as the shared admin, then the one of the id it was found by', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    const desired = wanted(admin);
    const found = await admin.observe(api, undefined, desired);
    expect(found).toEqual({
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'admin' },
    });
    state.user = 'renamed';
    expect(await admin.observe(api, undefined, desired)).toBeUndefined();
    const known = {
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'admin' },
      secrets: ['password'],
      appliedAt: '2026-10-15T12:00:00.000Z',
    };
    expect(await admin.observe(api, known, desired)).toMatchObject({
      fields: { username: 'renamed' },
    });
    // Named in another shape: unreadable, never empty.
    Object.assign(state, { user: 7 });
    expect(await admin.observe(api, known, desired)).toEqual({
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: {},
      unreadable: { username: 'a number, not text' },
    });
  });

  it('checks its password by signing in, then out', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    const desired = wanted(admin);
    const held = await admin.observe(api, undefined, desired);
    if (held === undefined) throw new Error('the admin is there');
    expect(await admin.verify?.(api, desired, held)).toBe(true);
    expect(state.sessions).toEqual({});
    state.password = 'fake-changed-by-hand';
    expect(await admin.verify?.(api, desired, held)).toBe(false);
  });

  it('renames it and sets its password with the key, and makes no other user', async () => {
    const { api, state } = await jellyfin(
      setUp({ user: 'renamed', password: 'x' }),
      true,
    );
    const desired = wanted(admin);
    const held = {
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'renamed' },
    };
    await admin.update(api, desired, held);
    expect(state).toMatchObject({ user: 'admin', password: PASSWORD });
    expect((await failure(admin.create(api, desired))).message).toBe(
      "Jellyfin at http://jellyfin:8096 (127.0.0.1) has no user admin: Mediaplane makes Jellyfin's admin in its startup wizard, and no other user (GET /Users)",
    );
  });

  it('sends no empty password: without one it signs in to nothing and sets nothing', async () => {
    const { api, state, app } = await jellyfin(
      setUp({ user: 'renamed', password: 'x' }),
      true,
    );
    const desired = { ...wanted(admin), secrets: {} };
    const held = {
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'renamed' },
    };
    await expect(admin.verify?.(api, desired, held)).rejects.toThrow(
      'admin has no password to send',
    );
    await expect(admin.update(api, desired, held)).rejects.toThrow(
      'admin has no password to send',
    );
    expect(state.password).toBe('x');
    expect(calls(app)).not.toContain('POST /Users/AuthenticateByName');
    expect(calls(app)).not.toContain(`POST /Users/${FAKE_JELLYFIN_USER_ID}/Password`);
  });
});

describe("Jellyfin's libraries", () => {
  const movies = resource('library_movies');
  const shows = resource('library_shows');

  it('are Movies and Shows, in their folders under /data/media, which are made first', () => {
    expect(wanted(movies)).toEqual({
      name: 'Movies',
      fields: { name: 'Movies', collectionType: 'movies', paths: '/data/media/movies' },
      secrets: {},
      folders: ['/data/media/movies'],
    });
    expect(wanted(shows).fields).toEqual({
      name: 'Shows',
      collectionType: 'tvshows',
      paths: '/data/media/tv',
    });
    expect(LIBRARIES.map((l) => l.name)).toEqual(['Movies', 'Shows']);
  });

  it("makes one as Jellyfin's web UI makes a new library, with its default downloaders, and finds it by name", async () => {
    const { api, apis, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/movies');
    expect(await movies.observe(api, undefined)).toBeUndefined();
    expect(await movies.create(api, wanted(movies))).toEqual({ id: 'Movies' });
    const [made] = state.libraries;
    expect(made).toMatchObject({
      Name: 'Movies',
      CollectionType: 'movies',
      Locations: ['/data/media/movies'],
      LibraryOptions: {
        Enabled: true,
        EnableInternetProviders: true,
        EnableRealtimeMonitor: true,
        TypeOptions: [
          {
            Type: 'Movie',
            MetadataFetchers: ['TheMovieDb'],
            MetadataFetcherOrder: ['TheMovieDb', 'The Open Movie Database'],
            ImageFetchers: ['TheMovieDb', 'Screen Grabber'],
          },
        ],
      },
    });
    expect(await movies.observe(api, undefined)).toEqual({
      id: 'Movies',
      name: 'Movies',
      fields: { name: 'Movies', collectionType: 'movies', paths: '/data/media/movies' },
    });
    expect(apis.app.requests.at(-2)?.path).toBe(
      '/Library/VirtualFolders?name=Movies&collectionType=movies&paths=%2Fdata%2Fmedia%2Fmovies&refreshLibrary=true',
    );
  });

  it('puts back its folder, and takes out one added by hand, as often as Jellyfin holds it', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/tv', '/data/media/other');
    state.libraries.push({
      Name: 'Shows',
      CollectionType: 'tvshows',
      Locations: ['/data/media/other', '/data/media/other'],
      LibraryOptions: {},
    });
    const held = await shows.observe(api, undefined);
    expect(held?.fields.paths).toBe('/data/media/other');
    if (held === undefined) throw new Error('Shows is there');
    // Jellyfin keeps a path given twice twice, and takes one out at a time: the update
    // reads them as Jellyfin lists them.
    await shows.update(api, wanted(shows), held);
    expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv']);
  });

  it('says a library of another name holds its folder, rather than put it in two', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/tv');
    state.libraries.push({
      Name: 'Series',
      CollectionType: 'tvshows',
      Locations: ['/data/media/tv/'],
      LibraryOptions: {},
    });
    expect(await shows.observe(api, undefined)).toBeUndefined();
    expect((await failure(shows.create(api, wanted(shows)))).message).toBe(
      'Jellyfin at http://jellyfin:8096 (127.0.0.1) has no library named Shows, but its library Series holds /data/media/tv, one of its folders: if it is Shows renamed, rename it back in Jellyfin; if it is another library, take /data/media/tv out of it, or out of jellyfin.library_shows.paths under overrides:; to keep it as it is, stop Mediaplane managing Shows with jellyfin.library_shows: unmanaged under overrides: (GET /Library/VirtualFolders)',
    );
    expect(state.libraries.map((l) => l.Name)).toEqual(['Series']);
  });

  it('removes a folder with a comma in its name, which `paths` cannot tell apart', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/tv', '/data/media/a,b');
    state.libraries.push({
      Name: 'Shows',
      CollectionType: 'tvshows',
      Locations: ['/data/media/tv', '/data/media/a,b'],
      LibraryOptions: {},
    });
    const held = await shows.observe(api, undefined);
    if (held === undefined) throw new Error('Shows is there');
    // It can't be listed in `paths`, so it is said to be.
    expect(held.unreadable).toEqual({
      paths: 'a folder with a comma in its name, /data/media/a,b',
    });
    await shows.update(api, wanted(shows), held);
    expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv']);
  });

  it('holds the folders an override names, made in one go or added to', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/tv', '/data/media/more');
    const kept = {
      ...wanted(shows),
      fields: { ...wanted(shows).fields, paths: '/data/media/more,/data/media/tv' },
    };
    await shows.create(api, kept);
    expect(state.libraries[0]?.Locations).toEqual(['/data/media/more', '/data/media/tv']);
    // Taken out by hand: the update adds it again.
    state.libraries[0]?.Locations.splice(0, 1);
    const held = await shows.observe(api, undefined);
    if (held === undefined) throw new Error('Shows is there');
    await shows.update(api, kept, held);
    expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv', '/data/media/more']);
  });

  it("is checked by drift once a day at most, while it passes: each check is in Jellyfin's activity log", async () => {
    const { api, app } = await jellyfin(setUp(), true);
    const spec = resource('admin');
    const observed = await spec.observe(api, undefined, wanted(spec));
    if (observed === undefined) throw new Error('no admin');
    const at = '2026-10-20T08:00:00.000Z';
    const known = {
      id: observed.id,
      name: 'admin',
      fields: { username: 'admin' },
      secrets: ['password'],
      appliedAt: at,
      checks: { password: { verdict: 'passed' as const, at } },
    };
    const signIns = () =>
      calls(app).filter((call) => call === 'POST /Users/AuthenticateByName').length;
    const look = { readOnly: true, peer: () => undefined };
    const driftAfter = (hours: number) =>
      examine(spec, api, contextOf(), known, {
        context: look,
        drift: { now: () => new Date(Date.parse(at) + hours * 60 * 60 * 1000) },
      });
    // Within a day of the check that passed: taken from then, without signing in.
    expect((await driftAfter(23))?.checks).toEqual([
      { resource: 'jellyfin.admin', secret: 'password', verdict: 'passed', at },
    ]);
    expect(signIns()).toBe(0);
    // A day on, it signs in again.
    expect((await driftAfter(25))?.checks).toEqual([
      { resource: 'jellyfin.admin', secret: 'password', verdict: 'passed' },
    ]);
    expect(signIns()).toBe(1);
    // plan checks it every time.
    await examine(spec, api, contextOf(), known, { context: look });
    expect(signIns()).toBe(2);
  });

  it("says Jellyfin can't change what a library of that name holds", async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.libraries.push({
      Name: 'Shows',
      Locations: ['/data/media/tv'],
      LibraryOptions: {},
    });
    const held = await shows.observe(api, undefined);
    if (held === undefined) throw new Error('Shows is there');
    // Jellyfin gives none for mixed content: read as one Mediaplane can't, never empty.
    expect(held.fields.collectionType).toBeUndefined();
    expect(held.unreadable).toEqual({ collectionType: 'nothing, not text' });
    expect((await failure(shows.update(api, wanted(shows), held))).message).toBe(
      "Jellyfin at http://jellyfin:8096 (127.0.0.1) has a library named Shows that holds mixed content, or a kind Mediaplane can't read, not tvshows, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes Shows (GET /Library/VirtualFolders)",
    );
  });
});
