import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fakeStackApis, freshAppState } from './wiring';

/** One request to the fake apps' port, as the app named in the Host header. */
function send(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
  method = body === undefined ? 'GET' : 'POST',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          host,
          ...(body === undefined
            ? {}
            : { 'content-type': 'application/x-www-form-urlencoded' }),
          ...headers,
        },
      },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
        reply.on('end', () => {
          resolve({
            status: reply.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    sent.on('error', reject);
    sent.end(body);
  });
}

const BEARER = { authorization: `Bearer qbt_${'0'.repeat(28)}` };

describe("fakeStackApis' qBittorrent", () => {
  it('refuses X-Api-Key, with or without a key set, as qBittorrent does', async () => {
    const apis = await fakeStackApis();
    const version = '/api/v2/app/version';
    const call = (headers: Record<string, string>) =>
      send(apis.app.port, 'gluetun:8080', version, headers);
    expect((await call({ 'x-api-key': 'anything' })).status).toBe(403);
    expect((await call({})).status).toBe(403);
    expect((await call(BEARER)).status).toBe(200);
    // With a key set, only that key, as a Bearer token.
    apis.apps.set('qbittorrent', { ...freshAppState(), key: `qbt_${'0'.repeat(28)}` });
    expect((await call({ 'x-api-key': `qbt_${'0'.repeat(28)}` })).status).toBe(403);
    expect((await call({ authorization: `Bearer qbt_${'1'.repeat(28)}` })).status).toBe(
      403,
    );
    expect((await call(BEARER)).status).toBe(200);
  });

  it("keeps each whitelisted subnet as its network address, as qBittorrent's does", async () => {
    // Set "192.168.1.10/24\n10.1.2.3/8", qBittorrent 5.2 gives "192.168.1.0/24\n10.0.0.0/8".
    const apis = await fakeStackApis();
    const set = await send(
      apis.app.port,
      'qbittorrent:8080',
      '/api/v2/app/setPreferences',
      BEARER,
      new URLSearchParams({
        json: JSON.stringify({
          bypass_auth_subnet_whitelist: '192.168.1.10/24\n10.1.2.3/8',
        }),
      }).toString(),
    );
    expect(set.status).toBe(200);
    const preferences = await send(
      apis.app.port,
      'qbittorrent:8080',
      '/api/v2/app/preferences',
      BEARER,
    );
    expect(
      (JSON.parse(preferences.body) as Record<string, unknown>)
        .bypass_auth_subnet_whitelist,
    ).toBe('192.168.1.0/24\n10.0.0.0/8');
  });
});

/** What a fake app answered `sent` as `host`, with a key: its status, and its JSON. */
async function json(
  port: number,
  host: string,
  path: string,
  sent: unknown,
  method = 'POST',
): Promise<{ status: number; body: unknown }> {
  const answer = await send(
    port,
    host,
    path,
    { 'x-api-key': '0'.repeat(32), 'content-type': 'application/json' },
    JSON.stringify(sent),
    method,
  );
  return {
    status: answer.status,
    body: answer.body === '' ? '' : (JSON.parse(answer.body) as unknown),
  };
}

/** A qBittorrent client as Sonarr's template makes it, aimed at `host` and `port`. */
function client(host: string, port: number, useSsl = false) {
  return {
    name: 'qBittorrent (Mediaplane)',
    enable: true,
    implementation: 'QBittorrent',
    priority: 1,
    fields: [
      { name: 'host', value: host },
      { name: 'port', value: port },
      { name: 'useSsl', value: useSsl },
      { name: 'apiKey', value: `qbt_${'0'.repeat(28)}` },
      { name: 'tvCategory', value: 'tv' },
    ],
  };
}

/** Sonarr's refusal of a client it can't reach at qBittorrent, for `why`. */
function unreachable(why: string) {
  return {
    status: 400,
    body: [
      {
        propertyName: 'Host',
        errorMessage: 'Unable to connect to qBittorrent',
        detailedDescription: why,
      },
    ],
  };
}

describe("fakeStackApis' Sonarr and Radarr", () => {
  it('refuses a root folder whose folder was never made, as the arrs do', async () => {
    const apis = await fakeStackApis();
    const add = () =>
      json(apis.app.port, 'sonarr:8989', '/api/v3/rootfolder', {
        path: '/data/media/tv',
      });
    expect(await add()).toMatchObject({
      status: 400,
      body: [
        { propertyName: 'Path', errorMessage: "Path '/data/media/tv' does not exist" },
      ],
    });
    // The wire step's folder helper: mkdir, in a throwaway container of the arr.
    apis.mkdir('sonarr', {
      user: { uid: 1000, gid: 1000 },
      entrypoint: 'mkdir',
      args: ['-p', '--', '/data/media/tv'],
      values: {},
    });
    expect((await add()).status).toBe(201);
    expect(apis.apps.get('sonarr')?.rootFolders).toEqual([
      { id: 1, path: '/data/media/tv' },
    ]);
  });

  it('tests a new download client as it saves it, and keeps none that fails', async () => {
    const apis = await fakeStackApis();
    const save = (sent: unknown) =>
      json(apis.app.port, 'sonarr:8989', '/api/v3/downloadclient?forceSave=true', sent);
    expect(await save(client('gluetun', 8090))).toMatchObject(
      unreachable('Connection refused (gluetun:8090)'),
    );
    expect(apis.apps.get('sonarr')?.downloadClients).toEqual([]);
    expect((await save(client('gluetun', 8080))).status).toBe(201);
    expect(apis.apps.get('sonarr')?.downloadClients).toHaveLength(1);
  });

  it("fails a client's test at a port qBittorrent doesn't listen on, or over TLS", async () => {
    const apis = await fakeStackApis();
    apis.apps.set('qbittorrent', { ...freshAppState(), port: 8090 });
    const test = (sent: unknown) =>
      json(apis.app.port, 'sonarr:8989', '/api/v3/downloadclient/test', sent);
    expect(await test(client('qbittorrent', 8080))).toMatchObject(
      unreachable('Connection refused (qbittorrent:8080)'),
    );
    expect(await test(client('qbittorrent', 8090, true))).toMatchObject(
      unreachable('The SSL connection could not be established, see inner exception.'),
    );
    expect((await test(client('qbittorrent', 8090))).status).toBe(200);
  });
});

const SONARR_KEY = '1'.repeat(32);

/** A link to Sonarr as Prowlarr's template makes it, with these settings. */
function link(values: { baseUrl?: string; apiKey?: string; prowlarrUrl?: string } = {}) {
  return {
    name: 'Sonarr (Mediaplane)',
    implementation: 'Sonarr',
    syncLevel: 'fullSync',
    tags: [],
    fields: [
      { name: 'prowlarrUrl', value: values.prowlarrUrl ?? 'http://prowlarr:9696' },
      { name: 'baseUrl', value: values.baseUrl ?? 'http://sonarr:8989' },
      { name: 'apiKey', value: values.apiKey ?? SONARR_KEY },
      { name: 'syncCategories', value: [5000] },
    ],
  };
}

describe("fakeStackApis' Prowlarr", () => {
  it('tests a link to Sonarr as it saves it: Prowlarr reaches Sonarr with its key, and Sonarr Prowlarr', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('sonarr', { ...freshAppState(), key: SONARR_KEY });
    const save = (sent: unknown) =>
      json(apis.app.port, 'prowlarr:9696', '/api/v1/applications?forceSave=true', sent);
    const refused = (property: string, message: string) => ({
      status: 400,
      body: [{ propertyName: property, errorMessage: message }],
    });
    expect(await save(link({ baseUrl: 'http://nowhere:8989' }))).toMatchObject(
      refused(
        'BaseUrl',
        'Unable to complete application test, cannot connect to Sonarr. Resource temporarily unavailable (nowhere:8989)',
      ),
    );
    expect(await save(link({ apiKey: '9'.repeat(32) }))).toMatchObject(
      refused('ApiKey', 'API Key is invalid'),
    );
    expect(await save(link({ prowlarrUrl: 'http://localhost:9696' }))).toMatchObject(
      refused(
        'ProwlarrUrl',
        'Prowlarr URL is invalid, Sonarr cannot connect to Prowlarr',
      ),
    );
    expect(apis.apps.get('prowlarr')?.applications).toEqual([]);
    expect(await save(link())).toMatchObject({ status: 201, body: { id: 1 } });
    expect(await save(link())).toMatchObject(refused('Name', 'Should be unique'));
    // Read back with its key masked, and tested as it is held: by its id, the key masked.
    const held = await send(apis.app.port, 'prowlarr:9696', '/api/v1/applications/1', {
      'x-api-key': '0'.repeat(32),
    });
    expect(held.body).not.toContain(SONARR_KEY);
    const tested = await json(
      apis.app.port,
      'prowlarr:9696',
      '/api/v1/applications/test',
      JSON.parse(held.body),
    );
    expect(tested.status).toBe(200);
  });

  it('saves an update with forceSave untested, keeping the key it holds for a masked one', async () => {
    const apis = await fakeStackApis();
    await json(
      apis.app.port,
      'prowlarr:9696',
      '/api/v1/applications?forceSave=true',
      link(),
    );
    const update = (sent: unknown) =>
      json(
        apis.app.port,
        'prowlarr:9696',
        '/api/v1/applications/1?forceSave=true',
        sent,
        'PUT',
      );
    expect(
      await update({
        ...link({ baseUrl: 'http://nowhere:8989', apiKey: '********' }),
        id: 1,
      }),
    ).toMatchObject({ status: 202 });
    const [held] = apis.apps.get('prowlarr')?.applications ?? [];
    expect(held?.fields).toEqual(
      expect.arrayContaining([
        { name: 'baseUrl', value: 'http://nowhere:8989' },
        { name: 'apiKey', value: SONARR_KEY },
      ]),
    );
  });

  it('tests an indexer proxy as it saves it: Prowlarr must reach a Cloudflare solver', async () => {
    const apis = await fakeStackApis();
    const proxy = (host: string) => ({
      name: 'Cloudflare (Mediaplane)',
      implementation: 'FlareSolverr',
      tags: [1],
      fields: [
        { name: 'host', value: host },
        { name: 'requestTimeout', value: 60 },
      ],
    });
    const save = (sent: unknown) =>
      json(apis.app.port, 'prowlarr:9696', '/api/v1/indexerproxy?forceSave=true', sent);
    expect(await save(proxy('http://nowhere:8191/'))).toMatchObject({
      status: 400,
      body: [
        {
          propertyName: 'Host',
          errorMessage:
            'Unable to connect to proxy: Resource temporarily unavailable (nowhere:8191). Check the log surrounding this error for details',
        },
      ],
    });
    expect((await save(proxy('http://byparr:8191/'))).status).toBe(201);
    expect(apis.apps.get('prowlarr')?.proxies).toMatchObject([
      { id: 1, name: 'Cloudflare (Mediaplane)', tags: [1] },
    ]);
  });

  it('keeps a tag lower-case, and gives back the one it has by that label', async () => {
    const apis = await fakeStackApis();
    const tag = (label: string) =>
      json(apis.app.port, 'prowlarr:9696', '/api/v1/tag', { label });
    expect(await tag('Cloudflare')).toEqual({
      status: 201,
      body: { id: 1, label: 'cloudflare' },
    });
    expect(await tag('cloudflare')).toEqual({
      status: 201,
      body: { id: 1, label: 'cloudflare' },
    });
    expect(await tag('not a label')).toMatchObject({ status: 400 });
    expect(apis.apps.get('prowlarr')?.tags).toEqual([{ id: 1, label: 'cloudflare' }]);
  });
});
