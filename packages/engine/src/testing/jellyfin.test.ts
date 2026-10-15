import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAKE_JELLYFIN_USER_ID } from './jellyfin';
import { tempDir } from './temp';
import { fakeStackApis, freshAppState, type FakeAppState } from './wiring';

/** The client fields Jellyfin asks of a sign-in. */
const CLIENT =
  'MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"';

/** A token in Jellyfin's MediaBrowser header, with the client fields. */
const withToken = (token: string) => `${CLIENT}, Token="${token}"`;

/** One call to a fake app as `host`: its status, and its body (as JSON when it is). */
function call(
  port: number,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    host?: string;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const text = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? (text === undefined ? 'GET' : 'POST'),
        headers: {
          host: init.host ?? 'jellyfin:8096',
          ...(text === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
        reply.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: unknown = raw;
          try {
            body = JSON.parse(raw) as unknown;
          } catch {
            // Plain text, as Jellyfin's own refusals are.
          }
          resolve({ status: reply.statusCode ?? 0, body });
        });
      },
    );
    sent.on('error', reject);
    sent.end(text);
  });
}

/** The fake Jellyfin's state, as `apis` holds it. */
function jellyfinOf(apis: Awaited<ReturnType<typeof fakeStackApis>>): FakeAppState {
  const state = apis.apps.get('jellyfin');
  if (state === undefined) throw new Error('no Jellyfin faked');
  return state;
}

/** A Jellyfin whose wizard is done, with the admin and the key `key`. */
function setUp(key: string): FakeAppState {
  return {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: 'fake-admin-password',
    apiKeys: [
      {
        AccessToken: key,
        AppName: 'Mediaplane',
        DateCreated: '2026-10-15T12:00:00.000Z',
      },
    ],
  };
}

const KEY = '7'.repeat(32);

describe("fakeStackApis' Jellyfin", () => {
  it('runs its startup wizard as Jellyfin 12 does: the first user made by asking for it, named once, then completed', async () => {
    const apis = await fakeStackApis();
    const { port } = apis.app;
    const user = (body: unknown) => call(port, '/Startup/User', { body });
    const wizard = async () =>
      ((await call(port, '/System/Info/Public')).body as Record<string, unknown>)
        .StartupWizardCompleted;
    expect(await wizard()).toBe(false);
    // Before anything asks for the first user, there is none to name.
    expect((await user({ Name: 'admin', Password: 'fake-admin-password' })).status).toBe(
      404,
    );
    expect(await call(port, '/Startup/User')).toEqual({
      status: 200,
      body: { Name: 'abc' },
    });
    expect(await user({ Name: 'admin' })).toEqual({
      status: 400,
      body: 'Password must not be empty',
    });
    expect((await user({ Name: 'admin', Password: 'fake-admin-password' })).status).toBe(
      204,
    );
    // Its password is set: a second time is refused.
    expect((await user({ Name: 'admin', Password: 'fake-other-password' })).status).toBe(
      403,
    );
    expect((await call(port, '/Startup/Complete', { method: 'POST' })).status).toBe(204);
    expect(await wizard()).toBe(true);
    // Done: the wizard's endpoints refuse anyone without a token.
    expect((await call(port, '/Startup/User')).status).toBe(401);
    expect((await call(port, '/Startup/Complete', { method: 'POST' })).status).toBe(401);
  });

  it('signs in only with its client fields and the right password, one session per device, until it signs out', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const signIn = (
      Pw: string,
      headers: Record<string, string> = { authorization: CLIENT },
    ) =>
      call(port, '/Users/AuthenticateByName', {
        body: { Username: 'admin', Pw },
        headers,
      });
    expect((await signIn('fake-admin-password', {})).status).toBe(400);
    expect(
      (
        await signIn('fake-admin-password', {
          authorization: 'MediaBrowser Client="Mediaplane", Version="1"',
        })
      ).status,
    ).toBe(400);
    expect(await signIn('wrong')).toEqual({
      status: 401,
      body: 'Error processing request.',
    });
    const first = await signIn('fake-admin-password');
    expect(first).toMatchObject({
      status: 200,
      body: { User: { Name: 'admin', Id: FAKE_JELLYFIN_USER_ID } },
    });
    const token = (first.body as { AccessToken: string }).AccessToken;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const info = (t: string) =>
      call(port, '/System/Info', { headers: { authorization: withToken(t) } });
    expect((await info(token)).status).toBe(200);
    // A second sign-in from the same device ends the first session.
    const second = (await signIn('fake-admin-password')).body as { AccessToken: string };
    expect((await info(token)).status).toBe(401);
    expect(
      (
        await call(port, '/Sessions/Logout', {
          method: 'POST',
          headers: { authorization: withToken(second.AccessToken) },
        })
      ).status,
    ).toBe(204);
    expect((await info(second.AccessToken)).status).toBe(401);
    expect(jellyfinOf(apis).sessions).toEqual({});
  });

  it('makes API keys by name, lists them in full, and takes them only in its MediaBrowser header', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    expect(
      (await call(port, '/Auth/Keys?app=Mediaplane', { method: 'POST', headers: keyed }))
        .status,
    ).toBe(204);
    const { body } = await call(port, '/Auth/Keys', { headers: keyed });
    const items = (body as { Items: { AccessToken: string; AppName: string }[] }).Items;
    expect(items.map((k) => k.AppName)).toEqual(['Mediaplane', 'Mediaplane']);
    expect(items[1]?.AccessToken).toMatch(/^[0-9a-f]{32}$/);
    // Jellyfin 12's legacy ways to send a key are off.
    const info = (headers: Record<string, string>, query = '') =>
      call(port, `/System/Info${query}`, { headers });
    expect((await info({ 'x-emby-token': KEY })).status).toBe(401);
    expect((await info({ 'x-mediabrowser-token': KEY })).status).toBe(401);
    expect((await info({}, `?api_key=${KEY}`)).status).toBe(401);
    expect((await info({ authorization: `Bearer ${KEY}` })).status).toBe(401);
    expect((await info({ authorization: `MediaBrowser Token="${KEY}"` })).status).toBe(
      200,
    );
  });

  it('renames its admin and sets its password with a key, and refuses a user sent without its policy', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    const users = await call(port, '/Users', { headers: keyed });
    expect(users.body).toMatchObject([
      { Name: 'admin', Id: FAKE_JELLYFIN_USER_ID, Policy: { IsAdministrator: true } },
    ]);
    const path = `/Users/${FAKE_JELLYFIN_USER_ID}`;
    const [held] = users.body as Record<string, unknown>[];
    expect(
      (await call(port, path, { body: { Name: 'boss' }, headers: keyed })).status,
    ).toBe(400);
    expect(
      (await call(port, path, { body: { ...held, Name: 'boss' }, headers: keyed }))
        .status,
    ).toBe(204);
    expect(
      (
        await call(port, `${path}/Password`, {
          body: { NewPw: 'fake-new-password' },
          headers: keyed,
        })
      ).status,
    ).toBe(204);
    expect(jellyfinOf(apis)).toMatchObject({
      user: 'boss',
      password: 'fake-new-password',
    });
  });

  it('keeps libraries as Jellyfin does: folders it can see, a second of one name renamed, paths added and removed by name', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    const add = (name: string, folder: string) =>
      call(
        port,
        `/Library/VirtualFolders?${new URLSearchParams({ name, collectionType: 'movies', paths: folder, refreshLibrary: 'true' }).toString()}`,
        { body: { LibraryOptions: { Enabled: true } }, headers: keyed },
      );
    expect(await add('Movies', '/data/media/movies')).toEqual({
      status: 400,
      body: 'Error processing request.',
    });
    // The wire step's folder helper: mkdir, in a throwaway container of Jellyfin.
    apis.mkdir('jellyfin', {
      user: { uid: 1000, gid: 1000 },
      entrypoint: 'mkdir',
      args: ['-p', '--', '/data/media/movies', '/data/media/other'],
      values: {},
    });
    expect((await add('Movies', '/data/media/movies')).status).toBe(204);
    expect((await add('Movies', '/data/media/movies')).status).toBe(204);
    const names = async () =>
      (
        (await call(port, '/Library/VirtualFolders', { headers: keyed })).body as {
          Name: string;
          Locations: string[];
        }[]
      ).map((l) => [l.Name, l.Locations]);
    expect(await names()).toEqual([
      ['Movies', ['/data/media/movies']],
      ['Movies2', ['/data/media/movies']],
    ]);
    const paths = '/Library/VirtualFolders/Paths';
    expect(
      (
        await call(port, `${paths}?refreshLibrary=true`, {
          body: { Name: 'Movies', Path: '/data/media/other/' },
          headers: keyed,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call(port, `${paths}?refreshLibrary=true`, {
          body: { Name: 'Movies', Path: '/nowhere' },
          headers: keyed,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          port,
          `${paths}?${new URLSearchParams({ name: 'Movies', path: '/data/media/movies' }).toString()}`,
          { method: 'DELETE', headers: keyed },
        )
      ).status,
    ).toBe(204);
    expect((await names())[0]).toEqual(['Movies', ['/data/media/other']]);
    const { body } = await call(port, '/Library/VirtualFolders', { headers: keyed });
    expect((body as Record<string, unknown>[])[0]).toMatchObject({
      CollectionType: 'movies',
      LibraryOptions: { Enabled: true, PathInfos: [{ Path: '/data/media/other' }] },
    });
  });

  it('offers a new library the fetchers Jellyfin 12 offers, some on by default', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { body } = await call(
      apis.app.port,
      '/Libraries/AvailableOptions?libraryContentType=movies&isNewLibrary=true',
      { headers: { authorization: withToken(KEY) } },
    );
    expect(body).toMatchObject({
      TypeOptions: [
        {
          Type: 'Movie',
          MetadataFetchers: [
            { Name: 'TheMovieDb', DefaultEnabled: true },
            { Name: 'The Open Movie Database', DefaultEnabled: false },
          ],
        },
      ],
    });
  });

  it('writes system.xml as Jellyfin does: when it starts, and when its wizard is done', async () => {
    const apis = await fakeStackApis();
    const configDir = join(await tempDir('mediaplane-fake-jellyfin-'), 'jellyfin');
    apis.apps.set('jellyfin', { ...freshAppState(), configDir });
    const done = async () =>
      /<IsStartupWizardCompleted>(\w+)</.exec(
        await readFile(join(configDir, 'system.xml'), 'utf8'),
      )?.[1];
    await call(apis.app.port, '/System/Info/Public');
    expect(await done()).toBe('false');
    await call(apis.app.port, '/Startup/Complete', { method: 'POST' });
    expect(await done()).toBe('true');
  });

  it('refuses a user name Jellyfin does not take, in its wizard and on a rename', async () => {
    const apis = await fakeStackApis();
    const { port } = apis.app;
    await call(port, '/Startup/User');
    expect(
      await call(port, '/Startup/User', {
        body: { Name: 'bad name', Password: 'fake-admin-password' },
      }),
    ).toEqual({ status: 400, body: 'Error processing request.' });
    expect(jellyfinOf(apis).password).toBe('');
    // Asking again while the wizard is open gives the same first user.
    expect(await call(port, '/Startup/User')).toEqual({
      status: 200,
      body: { Name: 'abc' },
    });
    apis.apps.set('jellyfin', setUp(KEY));
    const keyed = { authorization: withToken(KEY) };
    const [held] = (await call(port, '/Users', { headers: keyed })).body as Record<
      string,
      unknown
    >[];
    expect(
      (
        await call(port, `/Users/${FAKE_JELLYFIN_USER_ID}`, {
          body: { ...held, Name: '' },
          headers: keyed,
        })
      ).status,
    ).toBe(400);
    expect(jellyfinOf(apis).user).toBe('admin');
  });

  it('reads its user by id, and has none to read before the wizard names one', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    const path = `/Users/${FAKE_JELLYFIN_USER_ID}`;
    expect(await call(port, path, { headers: keyed })).toMatchObject({
      status: 200,
      body: { Name: 'admin', Id: FAKE_JELLYFIN_USER_ID },
    });
    apis.apps.set('jellyfin', { ...setUp(KEY), user: '', password: '' });
    expect((await call(port, path, { headers: keyed })).status).toBe(404);
    expect((await call(port, '/Users', { headers: keyed })).body).toEqual([]);
  });

  it('refuses a key made without a name, and gives each Jellyfin tokens of its own', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    const make = (query: string) =>
      call(port, `/Auth/Keys${query}`, { method: 'POST', headers: keyed });
    expect((await make('')).status).toBe(400);
    expect((await make('?app=')).status).toBe(400);
    expect(jellyfinOf(apis).apiKeys).toHaveLength(1);
    await make('?app=Mediaplane');
    const other = await fakeStackApis();
    other.apps.set('jellyfin', setUp(KEY));
    await call(other.app.port, '/Auth/Keys?app=Mediaplane', {
      method: 'POST',
      headers: keyed,
    });
    // The counter is the Jellyfin's, so the first key made is the same in each.
    expect(jellyfinOf(other).apiKeys[1]).toEqual(jellyfinOf(apis).apiKeys[1]);
  });

  it('removes a library by name, and refuses to remove one it does not have', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    apis.mkdir('jellyfin', {
      user: { uid: 1000, gid: 1000 },
      entrypoint: 'mkdir',
      args: ['-p', '--', '/data/media/movies'],
      values: {},
    });
    await call(
      port,
      `/Library/VirtualFolders?${new URLSearchParams({ name: 'Movies', collectionType: 'movies', paths: '/data/media/movies' }).toString()}`,
      { body: { LibraryOptions: {} }, headers: keyed },
    );
    const remove = (name: string) =>
      call(port, `/Library/VirtualFolders?${new URLSearchParams({ name }).toString()}`, {
        method: 'DELETE',
        headers: keyed,
      });
    expect((await remove('Shows')).status).toBe(404);
    expect(jellyfinOf(apis).libraries).toHaveLength(1);
    expect((await remove('Movies')).status).toBe(204);
    expect(jellyfinOf(apis).libraries).toEqual([]);
  });

  it('answers /System/Info/Public with 503 while it is not up', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', { ...setUp(KEY), up: false });
    expect(await call(apis.app.port, '/System/Info/Public')).toEqual({
      status: 503,
      body: 'Jellyfin Server is loading. Please try again shortly.',
    });
  });

  it('needs each of the four client fields to sign in', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const fields = {
      Client: 'Mediaplane',
      Device: 'Mediaplane',
      DeviceId: 'mediaplane',
      Version: '1',
    };
    const signIn = (sent: Record<string, string>) =>
      call(apis.app.port, '/Users/AuthenticateByName', {
        body: { Username: 'admin', Pw: 'fake-admin-password' },
        headers: {
          authorization: `MediaBrowser ${Object.entries(sent)
            .map(([name, value]) => `${name}="${value}"`)
            .join(', ')}`,
        },
      });
    expect((await signIn(fields)).status).toBe(200);
    for (const missing of Object.keys(fields)) {
      const rest = Object.fromEntries(
        Object.entries(fields).filter(([name]) => name !== missing),
      );
      expect((await signIn(rest)).status, `without ${missing}`).toBe(400);
    }
  });
});

/** A connection to Jellyfin as Sonarr's template makes it, with these settings. */
function connection(
  values: { host?: string; port?: number; useSsl?: boolean; apiKey?: string } = {},
  triggers: Record<string, boolean> = { onDownload: true },
) {
  return {
    name: 'Jellyfin (Mediaplane)',
    implementation: 'MediaBrowser',
    tags: [],
    ...triggers,
    fields: [
      { name: 'host', value: values.host ?? 'jellyfin' },
      { name: 'port', value: values.port ?? 8096 },
      { name: 'useSsl', value: values.useSsl ?? false },
      { name: 'apiKey', value: values.apiKey ?? KEY },
      { name: 'updateLibrary', value: true },
    ],
  };
}

describe("fakeStackApis' Sonarr and Radarr connections to Jellyfin", () => {
  const save = (apis: Awaited<ReturnType<typeof fakeStackApis>>, sent: unknown) =>
    call(apis.app.port, '/api/v3/notification?forceSave=true', {
      body: sent,
      host: 'sonarr:8989',
      headers: { 'x-api-key': '0'.repeat(32) },
    });
  const refused = (property: string, message: string) => ({
    status: 400,
    body: [{ propertyName: property, errorMessage: message }],
  });

  it('tests a new one with a trigger on as it saves it, as Sonarr does: Jellyfin by its service, port and key', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const unsent = (why: string) =>
      refused('Host', `Unable to send test message: ${why}`);
    expect(await save(apis, connection({ host: 'nowhere' }))).toMatchObject(
      unsent('Resource temporarily unavailable (nowhere:8096)'),
    );
    expect(await save(apis, connection({ port: 8097 }))).toMatchObject(
      unsent('Connection refused (jellyfin:8097)'),
    );
    expect(await save(apis, connection({ useSsl: true }))).toMatchObject(
      unsent('The SSL connection could not be established, see inner exception.'),
    );
    expect(await save(apis, connection({ apiKey: '' }))).toMatchObject(
      refused('ApiKey', "'Api Key' must not be empty."),
    );
    expect(await save(apis, connection({ apiKey: '9'.repeat(32) }))).toMatchObject(
      refused('ApiKey', 'API Key is invalid'),
    );
    expect(apis.apps.get('sonarr')?.connections).toEqual([]);
    expect(await save(apis, connection())).toMatchObject({
      status: 201,
      body: { id: 1 },
    });
    // Read back with its key masked.
    const held = await call(apis.app.port, '/api/v3/notification/1', {
      host: 'sonarr:8989',
      headers: { 'x-api-key': '0'.repeat(32) },
    });
    expect(JSON.stringify(held.body)).not.toContain(KEY);
  });

  it("fails with the arr's own words when a testFailure is set on it, whatever the connection holds", async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    await save(apis, connection({ apiKey: '9'.repeat(32) }, { onDownload: false }));
    apis.apps.set('sonarr', {
      ...freshAppState(),
      connections: apis.apps.get('sonarr')?.connections ?? [],
      testFailure: 'Something else went wrong',
    });
    expect(await save(apis, { ...connection(), name: 'Another' })).toMatchObject(
      refused('Host', 'Something else went wrong'),
    );
  });

  it('refuses every key while Jellyfin has made none', async () => {
    const apis = await fakeStackApis();
    expect(await save(apis, connection())).toMatchObject(
      refused('ApiKey', 'API Key is invalid'),
    );
  });

  it('saves one with no trigger on untested, as the arrs do', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    expect(
      (await save(apis, connection({ apiKey: '9'.repeat(32) }, { onDownload: false })))
        .status,
    ).toBe(201);
  });

  it("offers Sonarr's and Radarr's own triggers in their templates, all off", async () => {
    const apis = await fakeStackApis();
    const template = async (host: string) => {
      const { body } = await call(apis.app.port, '/api/v3/notification/schema', {
        host,
        headers: { 'x-api-key': '0'.repeat(32) },
      });
      const [offered] = body as Record<string, unknown>[];
      return Object.entries(offered ?? {}).filter(([name]) => name.startsWith('on'));
    };
    expect(await template('sonarr:8989')).toContainEqual(['onSeriesDelete', false]);
    expect(await template('radarr:7878')).toContainEqual(['onMovieDelete', false]);
  });
});
