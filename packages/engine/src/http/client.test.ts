import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { z } from 'zod';
import { closedPort, fakeHttpApp, type FakeHandler } from '../testing/http';
import {
  AppApiError,
  appMessage,
  createAppApi,
  type AppApiOptions,
  type RetryOptions,
} from './client';

const KEY = 'f'.repeat(32);
const PASSWORD = 'fake-admin-password';

/** A clock that only moves when the client sleeps; `slept` lists each wait. */
function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  const retry: RetryOptions = {
    deadlineMs: 120_000,
    now: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
    random: () => 1,
  };
  return { retry, slept };
}

async function sonarr(handler: FakeHandler, extra: Partial<AppApiOptions> = {}) {
  const app = await fakeHttpApp(handler);
  const clock = fakeClock();
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: app.port },
    key: { scheme: 'x-api-key', value: KEY },
    secrets: [KEY, PASSWORD],
    retry: clock.retry,
    ...extra,
  });
  return { api, app, slept: clock.slept };
}

/** What the call threw, as an AppApiError. */
async function failure(call: Promise<unknown>): Promise<AppApiError> {
  const thrown = await call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(thrown instanceof AppApiError))
    throw new Error(`expected an AppApiError, got ${String(thrown)}`);
  return thrown;
}

const STATUS = z.looseObject({ version: z.string() });

describe('createAppApi', () => {
  it('sends the key, the Host the stack uses, and reads the JSON it is given', async () => {
    const { api, app } = await sonarr(() => ({
      status: 200,
      body: { version: '4.0.20' },
    }));
    expect(await api.get('/api/v3/system/status', STATUS)).toEqual({ version: '4.0.20' });
    expect(app.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/v3/system/status',
      headers: { 'x-api-key': KEY, host: 'sonarr:8989', 'user-agent': 'Mediaplane' },
    });
    expect(api.where).toBe('http://sonarr:8989 (127.0.0.1)');
  });

  it('sends a Bearer key when the app takes one', async () => {
    const { api, app } = await sonarr(
      () => ({ status: 200, body: { version: 'v5.2.4' } }),
      {
        key: { scheme: 'bearer', value: KEY },
      },
    );
    await api.get('/api/v2/app/version', z.unknown());
    expect(app.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('checks a key with any 2xx answer, reading no JSON: qBittorrent answers plain text', async () => {
    const { api, app } = await sonarr(() => ({ status: 200, body: 'v5.2.4' }), {
      key: { scheme: 'bearer', value: KEY },
    });
    await api.check('/api/v2/app/version');
    expect(app.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    const refused = await sonarr(() => ({ status: 403, body: 'Forbidden' }));
    expect(await failure(refused.api.check('/api/v2/app/version'))).toMatchObject({
      kind: 'auth',
      status: 403,
    });
  });

  it('PUTs JSON, and takes any 2xx as done', async () => {
    const { api, app } = await sonarr(() => ({ status: 202, body: {} }));
    await api.put('/api/v3/config/host/1', { username: 'admin' });
    expect(app.requests[0]).toMatchObject({
      method: 'PUT',
      body: '{"username":"admin"}',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('says the key was refused, and never repeats a secret the app echoes', async () => {
    const { api } = await sonarr(() => ({ status: 401, body: `bad key ${KEY}` }));
    const error = await failure(api.get('/api/v3/system/status?apikey=x', STATUS));
    expect(error).toMatchObject({ kind: 'auth', status: 401, transient: false });
    expect(error.message).toBe(
      "Sonarr at http://sonarr:8989 (127.0.0.1) refused Mediaplane's API key (HTTP 401): bad key *** (GET /api/v3/system/status)",
    );
  });

  it('never shows part of a secret that the cut would split', async () => {
    // The key starts at character 190 of a 300-character answer, across the 200-character
    // cut: cut first, its first characters would stay.
    const body = `${'x'.repeat(190)}${KEY}${'y'.repeat(300 - 190 - KEY.length)}`;
    const { api } = await sonarr(() => ({ status: 400, body }));
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error.message).toContain('refused the request (HTTP 400): xxx');
    for (let i = 0; i + 8 <= KEY.length; i++) {
      expect(error.message).not.toContain(KEY.slice(i, i + 8));
    }
  });

  it('never shows a password with runs of spaces, which the collapse would change', async () => {
    const spaced = 'fake-one  fake-two   fake-three';
    const { api } = await sonarr(
      () => ({ status: 400, body: `the password ${spaced} is too weak` }),
      { secrets: [KEY, spaced] },
    );
    const error = await failure(api.put('/api/v3/config/host/1', { password: spaced }));
    expect(error.message).toContain(
      'refused the request (HTTP 400): the password *** is too weak',
    );
    expect(error.message).not.toMatch(/fake-(one|two|three)/);
  });

  it('never shows part of a secret that JSON escapes hid from the raw answer', async () => {
    // A quote is written \" in JSON, so only the parsed message holds the password whole.
    // It starts at character 190 of that message: the cut would split it, if the parsed
    // message weren't redacted before the cut.
    const quoted = 'fake"quoted-password';
    const message = `${'x'.repeat(190)}${quoted}`;
    const { api } = await sonarr(() => ({ status: 400, body: { message } }), {
      secrets: [KEY, quoted],
    });
    const error = await failure(api.put('/api/v3/config/host/1', { password: quoted }));
    expect(error.message).toContain('refused the request (HTTP 400): xxx');
    expect(error.message).toContain('***');
    expect(error.message).not.toContain('fake');
    expect(error.message).not.toContain('quoted');
  });

  it('never shows a secret that taking the HTML out put together', async () => {
    // Neither the raw answer nor any text node holds the phrase: only the tag-free text.
    const phrase = 'fake pass phrase';
    const { api } = await sonarr(
      () => ({ status: 400, body: '<p>fake</p><b>pass</b> phrase' }),
      { secrets: [KEY, phrase] },
    );
    const error = await failure(api.put('/api/v3/config/host/1', { password: phrase }));
    expect(error.message).toContain('refused the request (HTTP 400): *** (PUT');
    expect(error.message).not.toContain('fake');
    expect(error.message).not.toContain('phrase');
  });

  it.each([
    ['taking the HTML out', '<b>fake</b><i>pass</i> phrase'],
    ['collapsing its whitespace', 'fake\n\npass \t phrase'],
  ])(
    'never shows part of a secret that %s put together, across the cut',
    async (_how, tail) => {
      // The raw answer doesn't hold the phrase; the clean text does, from character 191 of
      // 207: the 200-character cut would keep its first characters, if the clean text
      // weren't redacted before the cut.
      const phrase = 'fake pass phrase';
      const body = `${'x'.repeat(190)} ${tail}`;
      expect(body).not.toContain(phrase);
      const { api } = await sonarr(() => ({ status: 400, body }), {
        secrets: [KEY, phrase],
      });
      const error = await failure(api.put('/api/v3/config/host/1', { password: phrase }));
      expect(error.message).toContain('refused the request (HTTP 400): xxx');
      expect(error.message).toContain('***');
      expect(error.message).not.toContain('fake');
      expect(error.message).not.toContain('pass');
      expect(appMessage(body, (text) => text.replaceAll(phrase, '***'))).not.toContain(
        'fake',
      );
    },
  );

  it('names the path without a secret in it, and without its query', async () => {
    const { api } = await sonarr(() => ({ status: 404, body: 'Not Found' }));
    const error = await failure(api.get(`/api/v3/lookup/${KEY}?term=hidden`, STATUS));
    expect(error.message).toContain('(GET /api/v3/lookup/***)');
    expect(error.message).not.toContain(KEY.slice(0, 8));
    expect(error.message).not.toContain('hidden');
  });

  it("gives Servarr's own validation message, and never the value it was given", async () => {
    const { api } = await sonarr(() => ({
      status: 400,
      body: [
        {
          propertyName: 'PasswordConfirmation',
          errorMessage: 'Must match Password',
          attemptedValue: 'not-the-password',
        },
      ],
    }));
    const error = await failure(api.put('/api/v3/config/host/1', { password: PASSWORD }));
    expect(error).toMatchObject({ kind: 'rejected', status: 400 });
    expect(error.message).toContain(
      'refused the request (HTTP 400): PasswordConfirmation: Must match Password (PUT /api/v3/config/host/1)',
    );
    expect(error.message).not.toContain('not-the-password');
  });

  it('reads the other shapes an app explains a refusal in', () => {
    expect(
      appMessage(
        JSON.stringify({ title: 'One or more errors.', errors: { id: ['Bad id'] } }),
      ),
    ).toBe('One or more errors.; id: Bad id');
    expect(appMessage(JSON.stringify({ message: 'Nope' }))).toBe('Nope');
    expect(appMessage('Category does not exist')).toBe('Category does not exist');
    expect(
      appMessage(
        '<!DOCTYPE HTML><html><head><title>Bad Request</title><style>h2{}</style></head><body><h2>Bad Request - Invalid Hostname</h2></body></html>',
      ),
    ).toBe('Bad Request Bad Request - Invalid Hostname');
    expect(appMessage('')).toBeUndefined();
    expect(appMessage('x'.repeat(500))).toHaveLength(200);
  });

  it('tries a GET again while the app is starting, waiting longer each time', async () => {
    const answers = [503, 502, 200];
    const { api, app, slept } = await sonarr(() => {
      const status = answers.shift() ?? 200;
      return { status, body: status === 200 ? { version: '4' } : 'starting' };
    });
    expect(await api.get('/api/v3/system/status', STATUS)).toEqual({ version: '4' });
    expect(app.requests).toHaveLength(3);
    expect(slept).toEqual([500, 1000]);
  });

  it('gives up on an app that keeps failing once the deadline passes, and says how long it tried', async () => {
    const { api, slept } = await sonarr(() => ({ status: 503, body: 'starting' }));
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error).toMatchObject({ kind: 'server', status: 503 });
    expect(error.message).toMatch(
      /failed \(HTTP 503\): starting \(GET \/api\/v3\/system\/status\), and still did after \d+ s$/,
    );
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(120_000);
    expect(Math.max(...slept)).toBe(10_000);
  });

  it('never tries a 500 again: the app failed, it is not starting', async () => {
    const { api, app } = await sonarr(() => ({ status: 500, body: 'boom' }));
    expect(await failure(api.get('/api/v3/x', STATUS))).toMatchObject({ kind: 'server' });
    expect(app.requests).toHaveLength(1);
  });

  it('tries a POST again only when nothing reached the app', async () => {
    const { api, app } = await sonarr(() => ({ status: 503, body: 'busy' }));
    expect(await failure(api.post('/api/v3/rootfolder', {}, z.unknown()))).toMatchObject({
      kind: 'server',
      status: 503,
    });
    expect(app.requests).toHaveLength(1);
    const clock = fakeClock();
    const refused = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port: await closedPort() },
      secrets: [],
      retry: clock.retry,
    });
    const error = await failure(refused.post('/api/v3/rootfolder', {}, z.unknown()));
    expect(error).toMatchObject({ kind: 'unreachable', reachedApp: false });
    expect(error.message).toContain('could not be reached (ECONNREFUSED)');
    expect(clock.slept.length).toBeGreaterThan(1);
  });

  it('never sends a POST again once the connection was cut, as the app may have seen it', async () => {
    // A server that closes every connection at once: the request may or may not have run.
    let connections = 0;
    const server = createTcpServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    onTestFinished(
      () =>
        new Promise<void>((done) => {
          server.close(() => {
            done();
          });
        }),
    );
    const clock = fakeClock();
    const api = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port: (server.address() as AddressInfo).port },
      secrets: [],
      retry: clock.retry,
    });
    const post = await failure(api.post('/api/v3/rootfolder', {}, z.unknown()));
    expect(post).toMatchObject({
      kind: 'unreachable',
      transient: true,
      reachedApp: true,
    });
    expect(post.message).toMatch(/cut the connection \((ECONNRESET|EPIPE)\)/);
    expect(connections).toBe(1);
    expect(clock.slept).toEqual([]);
    // A GET changes nothing, so it is tried again until the deadline.
    const get = await failure(api.get('/api/v3/system/status', STATUS));
    expect(get).toMatchObject({ kind: 'unreachable', transient: true });
    expect(get.message).toMatch(/and still did after \d+ s$/);
    expect(connections).toBeGreaterThan(2);
  });

  it('names a size limit in the unit it is a whole number of', async () => {
    const bytes = await sonarr(() => ({ status: 200, body: 'x'.repeat(2048) }), {
      maxBytes: 1536,
    });
    expect((await failure(bytes.api.get('/x', STATUS))).message).toContain(
      'answered more than 1536 bytes',
    );
    const mebibyte = await sonarr(
      () => ({ status: 200, body: 'x'.repeat(1024 * 1024 + 1) }),
      {
        maxBytes: 1024 * 1024,
      },
    );
    expect((await failure(mebibyte.api.get('/x', STATUS))).message).toContain(
      'answered more than 1 MiB',
    );
  });

  it('gives up on an answer that never comes', async () => {
    const { api, app } = await sonarr(() => 'hang', {
      timeoutMs: 50,
      retry: { deadlineMs: 0 },
    });
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error).toMatchObject({ kind: 'timeout', transient: true });
    expect(error.message).toContain('did not answer within 0.05 s');
    expect(app.requests).toHaveLength(1);
  });

  it('refuses an answer that is too big, not JSON, or not what was expected, showing no value', async () => {
    const big = await sonarr(() => ({ status: 200, body: 'x'.repeat(2048) }), {
      maxBytes: 1024,
    });
    expect((await failure(big.api.get('/x', STATUS))).message).toContain(
      'answered more than 1 KiB',
    );
    const text = await sonarr(() => ({ status: 200, body: 'not json' }));
    expect((await failure(text.api.get('/x', STATUS))).message).toContain(
      'answered with something that is not JSON',
    );
    const odd = await sonarr(() => ({
      status: 200,
      body: { version: KEY.length, apiKey: KEY },
    }));
    const error = await failure(odd.api.get('/x', STATUS));
    expect(error).toMatchObject({ kind: 'protocol' });
    expect(error.message).toContain(
      "answered something Mediaplane doesn't understand (at version)",
    );
    expect(error.message).not.toContain('32');
  });

  it('follows no redirect for a call with the key', async () => {
    const { api } = await sonarr(() => ({
      status: 302,
      headers: { Location: '/login' },
    }));
    expect((await failure(api.get('/x', STATUS))).message).toContain(
      'answered HTTP 302, not a success',
    );
  });

  it('signs in with a form, without the key, and gives back where it redirects', async () => {
    const { api, app } = await sonarr(() => ({
      status: 302,
      headers: { Location: '/', 'Set-Cookie': 'SonarrAuth=fake-cookie' },
    }));
    expect(await api.login('/login', { username: 'admin', password: PASSWORD })).toEqual({
      status: 302,
      location: '/',
    });
    expect(app.requests[0]).toMatchObject({
      method: 'POST',
      path: '/login',
      body: `username=admin&password=${PASSWORD}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('waits for the app to be ready, without the key', async () => {
    const answers = [503, 503, 200];
    const { api, app } = await sonarr(() => ({ status: answers.shift() ?? 200 }));
    await api.ready('/ping');
    expect(app.requests.map((r) => r.headers['x-api-key'])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('goes straight to the app, never through a proxy from the environment', async () => {
    // Node's global agent sends a request to HTTP_PROXY with NODE_USE_ENV_PROXY set: the
    // proxy would see the key. The child's first request, through that agent, shows the
    // proxy is used; the client's, which must not be, comes next.
    const seen: string[] = [];
    const proxy = createServer((req, res) => {
      seen.push(String(req.headers['x-api-key']));
      res.end('proxied');
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    onTestFinished(
      () =>
        new Promise<void>((done) => {
          proxy.close(() => {
            done();
          });
        }),
    );
    const app = await fakeHttpApp(() => ({ status: 200, body: { version: 'direct' } }));
    const client = fileURLToPath(new URL('./client.ts', import.meta.url));
    const script = `
      const { get } = await import('node:http');
      const control = await new Promise((done, fail) => {
        get('http://127.0.0.1:${String(app.port)}/control', { headers: { 'x-api-key': 'control' } },
          (res) => { res.resume(); res.on('end', () => done(res.statusCode)); }).on('error', fail);
      });
      const { createAppApi } = await import(${JSON.stringify(client)});
      const api = createAppApi({ name: 'Sonarr', service: 'sonarr', port: 8989,
        endpoint: { host: '127.0.0.1', port: ${String(app.port)} },
        key: { scheme: 'x-api-key', value: 'fake-key-0123' }, secrets: [] });
      const any = { safeParse: (data) => ({ success: true, data }) };
      console.log(JSON.stringify({ control, answer: await api.get('/status', any) }));`;
    const proxyUrl = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        {
          env: {
            PATH: process.env.PATH,
            NODE_USE_ENV_PROXY: '1',
            HTTP_PROXY: proxyUrl,
            http_proxy: proxyUrl,
          },
        },
      );
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.on('error', reject);
      child.on('close', () => {
        resolve(out.trim());
      });
    });
    expect(output).toBe('{"control":200,"answer":{"version":"direct"}}');
    // The global agent's request went to the proxy; the client's went straight to the app.
    expect(seen).toEqual(['control']);
    expect(app.requests.map((r) => r.path)).toEqual(['/status']);
  });
});
