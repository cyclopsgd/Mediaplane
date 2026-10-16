import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { z } from 'zod';
import { closedPort, fakeHttpApp, type FakeHandler } from '../testing/http';
import { foundSecrets } from '../util/redact';
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

/** Text as it is, for `appMessage`'s required `clean`. */
const same = (text: string) => text;

/** A password with every character that an encoding changes, and a space at the end. */
const PW = 'fake<pass&x"pw\\! ';

/** The forms an app may echo `PW` in, written out here, not made by the client. */
const PW_FORMS = {
  'JSON-escaped': 'fake<pass&x\\"pw\\\\! ',
  'percent-encoded': 'fake%3Cpass%26x%22pw%5C!%20',
  'percent-encoded in lowercase hex': 'fake%3cpass%26x%22pw%5c!%20',
  'form-encoded': 'fake%3Cpass%26x%22pw%5C%21+',
  'form-encoded in lowercase hex, as .NET writes it': 'fake%3cpass%26x%22pw%5c%21+',
  'HTML-escaped': 'fake&lt;pass&amp;x&quot;pw\\! ',
};

/** What no message may hold of `PW`, in any of its forms. */
const PW_PARTS = ['fake', 'pass&', 'pass%', 'x%22', 'x&quot', 'x\\"', 'pw'];

/** A TCP server that hands each connection to `onConnection`; closed with the test. */
async function rawServer(onConnection: (socket: Socket) => void): Promise<number> {
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    onConnection(socket);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  onTestFinished(
    () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          done();
        });
      }),
  );
  return (server.address() as AddressInfo).port;
}

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

  it('asks again until the answer says it is done, or the deadline passes, giving the last', async () => {
    let asked = 0;
    const slept: number[] = [];
    let clock = 0;
    const app = await fakeHttpApp(() => {
      asked += 1;
      return { status: 200, body: { claimed: asked >= 3 } };
    });
    const client = (deadlineMs: number) =>
      createAppApi({
        name: 'Plex',
        service: 'plex',
        port: 32400,
        endpoint: { host: '127.0.0.1', port: app.port },
        key: { scheme: 'x-plex-token', value: KEY },
        secrets: [],
        retry: {
          deadlineMs,
          now: () => clock,
          sleep: (ms) => {
            slept.push(ms);
            clock += ms;
            return Promise.resolve();
          },
        },
      });
    const claimed = z.looseObject({ claimed: z.boolean() });
    expect(await client(60_000).until('/identity', claimed, (i) => i.claimed)).toEqual({
      claimed: true,
    });
    expect(slept).toEqual([250, 500]);
    // Out of time: the last answer, not done.
    asked = -100;
    expect(await client(0).until('/identity', claimed, (i) => i.claimed)).toEqual({
      claimed: false,
    });
    expect(asked).toBe(-99);
    // Without the key, when asked so: an app not shown to be yours never gets it.
    await client(0).until('/identity', claimed, () => true, { anonymous: true });
    expect(app.requests.at(-1)?.headers['x-plex-token']).toBeUndefined();
    expect(app.requests.at(-2)?.headers['x-plex-token']).toBe(KEY);
  });

  it("sends Plex's token in X-Plex-Token when the app takes one", async () => {
    const { api, app } = await sonarr(() => ({ status: 200, body: {} }), {
      key: { scheme: 'x-plex-token', value: KEY },
    });
    await api.check('/library/sections');
    expect(app.requests[0]?.headers['x-plex-token']).toBe(KEY);
    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
    expect(app.requests[0]?.headers.authorization).toBeUndefined();
    // Anonymous calls carry no token, as Plex's readiness path takes none.
    await api.ready('/identity');
    expect(app.requests[1]?.headers['x-plex-token']).toBeUndefined();
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

  it.each(Object.entries(PW_FORMS))(
    'never repeats a secret the app echoes %s, in a plain-text answer',
    async (_name, form) => {
      const { api } = await sonarr(
        () => ({ status: 400, body: `Invalid value ${form}. Try another` }),
        { secrets: [KEY, PW] },
      );
      const error = await failure(api.put('/api/v3/config/host/1', { password: PW }));
      expect(error.message).toContain(
        'refused the request (HTTP 400): Invalid value ***. Try another (PUT',
      );
      for (const part of PW_PARTS) expect(error.message).not.toContain(part);
    },
  );

  it('never repeats a secret the app echoes HTML-escaped in a page', async () => {
    const page = `<html><body><h1>Bad Request</h1><p>The password ${PW_FORMS['HTML-escaped']}is not allowed</p></body></html>`;
    const { api } = await sonarr(() => ({ status: 400, body: page }), {
      secrets: [KEY, PW],
    });
    const error = await failure(api.put('/api/v3/config/host/1', { password: PW }));
    expect(error.message).toContain(
      'refused the request (HTTP 400): Bad Request The password ***is not allowed (PUT',
    );
    for (const part of PW_PARTS) expect(error.message).not.toContain(part);
  });

  it.each(['&#39;', '&#x27;', "'"])(
    'never repeats a secret with an apostrophe the app escapes as %s',
    async (apostrophe) => {
      const quoted = "fake'<b>";
      const { api } = await sonarr(
        () => ({ status: 400, body: `<p>fake${apostrophe}&lt;b&gt; is taken</p>` }),
        { secrets: [KEY, quoted] },
      );
      const error = await failure(api.put('/api/v3/config/host/1', { password: quoted }));
      expect(error.message).toContain(
        'refused the request (HTTP 400): *** is taken (PUT',
      );
      expect(error.message).not.toContain('fake');
    },
  );

  it('never repeats a secret that a JSON message quotes as JSON', async () => {
    const message = JSON.stringify({ password: PW, note: 'rejected' });
    const { api } = await sonarr(() => ({ status: 400, body: { message } }), {
      secrets: [KEY, PW],
    });
    const error = await failure(api.put('/api/v3/config/host/1', { password: PW }));
    expect(error.message).toContain(
      'refused the request (HTTP 400): {"password":"***","note":"rejected"} (PUT',
    );
    for (const part of PW_PARTS) expect(error.message).not.toContain(part);
  });

  it('never repeats the password of a sign-in form the app echoes back', async () => {
    const { api } = await sonarr(
      (request) => ({ status: 400, body: `Bad form: ${request.body}` }),
      { secrets: [KEY, PW] },
    );
    const error = await failure(api.login('/login', { username: 'admin', password: PW }));
    expect(error.message).toContain(
      'refused the request (HTTP 400): Bad form: username=admin&password=*** (POST /login)',
    );
    for (const part of PW_PARTS) expect(error.message).not.toContain(part);
  });

  it('redacts the key it sends and the password it signs in with, whatever secrets it was given', async () => {
    const echoed = await sonarr(
      (request) => ({
        status: 401,
        body: `bad key ${String(request.headers['x-api-key'])}`,
      }),
      { secrets: [] },
    );
    const refused = await failure(echoed.api.get('/api/v3/system/status', STATUS));
    expect(refused.message).toContain(
      "refused Mediaplane's API key (HTTP 401): bad key *** (GET",
    );
    expect(refused.message).not.toContain(KEY.slice(0, 8));
    const form = await sonarr(
      (request) => ({ status: 400, body: `Bad: ${request.body}` }),
      {
        secrets: [],
      },
    );
    const signIn = await failure(
      form.api.login('/login', { username: 'admin', password: PASSWORD }),
    );
    expect(signIn.message).toContain('Bad: username=admin&password=*** (POST /login)');
    expect(signIn.message).not.toContain(PASSWORD);
  });

  it('reads the message of a JSON answer from the answer itself, not from its redacted text', async () => {
    // The password ends in a backslash. Redacting the raw JSON would take the backslash of
    // the escaped quote in `fake-pw\"` and break the JSON: the message would then fall
    // back to the raw list, with its attemptedValue.
    const { api } = await sonarr(
      () => ({
        status: 400,
        body: [
          {
            propertyName: 'Password',
            errorMessage: 'Must be stronger',
            attemptedValue: 'fake-pw"',
          },
        ],
      }),
      { secrets: [KEY, 'fake-pw\\'] },
    );
    const error = await failure(api.put('/api/v3/config/host/1', { password: 'x' }));
    expect(error.message).toContain(
      'refused the request (HTTP 400): Password: Must be stronger (PUT',
    );
    expect(error.message).not.toContain('attemptedValue');
    expect(error.message).not.toContain('fake-pw');
  });

  it('shows an app message without control characters', async () => {
    const text = await sonarr(() => ({
      status: 400,
      body: '\u001b[31mbad\u001b[0m request\r\nsecond line\u0007\u009b2J\u007f',
    }));
    const json = await sonarr(() => ({
      status: 400,
      body: { message: 'first\nsecond \u001b[1mbold' },
    }));
    const shown = [
      (await failure(text.api.get('/x', STATUS))).message,
      (await failure(json.api.get('/x', STATUS))).message,
    ];
    expect(shown[0]).toContain('(HTTP 400): [31mbad [0m request second line 2J (GET');
    expect(shown[1]).toContain('(HTTP 400): first second [1mbold (GET');
    for (const message of shown) {
      // C0, DEL and C1.
      const control = (char: string) =>
        char < ' ' || (char >= '\u007f' && char <= '\u009f');
      expect(Array.from(message).some(control)).toBe(false);
    }
  });

  it('never shows a secret that holds a newline, which turning it into a space would hide', async () => {
    const secret = 'fake\npass';
    const { api } = await sonarr(
      () => ({ status: 400, body: { message: `bad ${secret} here` } }),
      { secrets: [KEY, secret] },
    );
    const error = await failure(api.put('/api/v3/config/host/1', { password: secret }));
    expect(error.message).toContain('refused the request (HTTP 400): bad *** here (PUT');
    expect(error.message).not.toContain('fake');
  });

  it.each(['&quot;', '&#34;', '"'])(
    'never repeats a secret with a quote the app escapes as %s',
    async (quote) => {
      const quoted = 'say "hi" <b>';
      const { api } = await sonarr(
        () => ({
          status: 400,
          body: `<p>say ${quote}hi${quote} &lt;b&gt; is taken</p>`,
        }),
        { secrets: [KEY, quoted] },
      );
      const error = await failure(api.put('/api/v3/config/host/1', { password: quoted }));
      expect(error.message).toContain(
        'refused the request (HTTP 400): *** is taken (PUT',
      );
      expect(error.message).not.toContain('hi');
    },
  );

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
        same,
      ),
    ).toBe('One or more errors.; id: Bad id');
    expect(appMessage(JSON.stringify({ message: 'Nope' }), same)).toBe('Nope');
    expect(appMessage('Category does not exist', same)).toBe('Category does not exist');
    expect(
      appMessage(
        '<!DOCTYPE HTML><html><head><title>Bad Request</title><style>h2{}</style></head><body><h2>Bad Request - Invalid Hostname</h2></body></html>',
        same,
      ),
    ).toBe('Bad Request Bad Request - Invalid Hostname');
    expect(appMessage('', same)).toBeUndefined();
    expect(appMessage('x'.repeat(500), same)).toHaveLength(200);
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
    const port = await rawServer((socket) => {
      connections++;
      socket.destroy();
    });
    const clock = fakeClock();
    const api = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port },
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

  it('lets an attempt take no longer than the time left before the deadline', async () => {
    // Each attempt may take 30 s, but the deadline is 0.3 s away, and the clock is still.
    const near = await sonarr(() => 'hang', {
      retry: { deadlineMs: 300, now: () => 0, random: () => 1 },
    });
    const started = performance.now();
    const error = await failure(near.api.get('/api/v3/system/status', STATUS));
    expect(error).toMatchObject({ kind: 'timeout', transient: true });
    expect(error.message).toContain('did not answer within 0.3 s');
    expect(performance.now() - started).toBeLessThan(5000);
    // Past the deadline, an attempt still gets a short while, not none.
    const past = await sonarr(() => 'hang', {
      retry: { deadlineMs: 0, now: () => 0, random: () => 1 },
    });
    expect((await failure(past.api.get('/x', STATUS))).message).toContain(
      'did not answer within 0.25 s',
    );
  });

  it('waits with the real clock and sleep when it is given none', async () => {
    const api = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port: await closedPort() },
      secrets: [],
      // Waits 500 ms, then sees that the next wait of 1000 ms would pass the deadline.
      retry: { deadlineMs: 1000, random: () => 1 },
    });
    const started = performance.now();
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    const waited = performance.now() - started;
    expect(error).toMatchObject({ kind: 'unreachable', transient: true });
    expect(error.message).toMatch(/and still did after \d+ s$/);
    expect(waited).toBeGreaterThanOrEqual(450);
    expect(waited).toBeLessThan(3000);
  });

  it('says so when the app answers something that is not HTTP', async () => {
    let connections = 0;
    const port = await rawServer((socket) => {
      connections++;
      socket.end('not http at all\r\n\r\n');
    });
    const api = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port },
      secrets: [],
      retry: fakeClock().retry,
    });
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error).toMatchObject({ kind: 'protocol', transient: false });
    expect(error.message).toContain('answered something that is not valid HTTP (HPE_');
    expect(connections).toBe(1);
  });

  it('says so, with no secret in it, when Node refuses to build the request', async () => {
    const badKey = await sonarr(() => ({ status: 200, body: {} }), {
      key: { scheme: 'x-api-key', value: `${KEY}\nInjected: yes` },
    });
    const header = await failure(badKey.api.get('/x', STATUS));
    expect(header).toMatchObject({ kind: 'protocol', transient: false });
    expect(header.message).toContain(
      'could not make the request (ERR_INVALID_CHAR) (GET /x)',
    );
    expect(header.message).not.toContain(KEY.slice(0, 8));
    const badPath = await sonarr(() => ({ status: 200, body: {} }));
    const path = await failure(badPath.api.get('/api/v3/a b', STATUS));
    expect(path).toMatchObject({ kind: 'protocol', transient: false });
    expect(path.message).toContain(
      'could not make the request (ERR_UNESCAPED_CHARACTERS)',
    );
    expect(badKey.app.requests).toHaveLength(0);
    expect(badPath.app.requests).toHaveLength(0);
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

  it("names a path from the app's answer without its control characters", async () => {
    // A record's keys come from the app, and a path names them.
    const counts = z.record(z.string(), z.number());
    const { api } = await sonarr(() => ({
      status: 200,
      body: { '\u001b[2Jcleared': 'x', 'new\nline\u009b': 'y' },
    }));
    const error = await failure(api.get('/x', counts));
    expect(error.message).toContain(
      "answered something Mediaplane doesn't understand (at [2Jcleared, new line) (GET /x)",
    );
    const control = (char: string) =>
      char < ' ' || (char >= '\u007f' && char <= '\u009f');
    expect(Array.from(error.message).some(control)).toBe(false);
  });

  it('hides a secret that names a path, before its whitespace is collapsed', async () => {
    // Collapsing first would turn the runs of spaces into one, and the redaction would
    // then no longer find the secret.
    const secret = 'fake  spaced   secret';
    const counts = z.record(z.string(), z.number());
    const { api } = await sonarr(() => ({ status: 200, body: { [secret]: 'x' } }), {
      secrets: [KEY, PASSWORD, secret],
    });
    const error = await failure(api.get('/x', counts));
    expect(error.message).toContain("doesn't understand (at ***) (GET /x)");
    expect(error.message).not.toContain('spaced');
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

  it('gives back the sign-in redirect without a secret in it', async () => {
    const { api } = await sonarr(
      () => ({
        status: 302,
        headers: { Location: `/login?loginFailed&echo=${PW_FORMS['form-encoded']}` },
      }),
      { secrets: [KEY, PW] },
    );
    const answer = await api.login('/login', { username: 'admin', password: PW });
    expect(answer).toEqual({ status: 302, location: '/login?loginFailed&echo=***' });
  });

  it('takes a status the caller names as the answer to a sign-in', async () => {
    // qBittorrent answers a wrong password with 401, and a right one with 204.
    const { api } = await sonarr(() => ({ status: 401, body: 'Unauthorized' }));
    expect(
      await api.login(
        '/api/v2/auth/login',
        { username: 'admin', password: PASSWORD },
        { answers: [401] },
      ),
    ).toEqual({ status: 401, location: undefined });
    expect(
      await failure(api.login('/api/v2/auth/login', { password: PASSWORD })),
    ).toMatchObject({ kind: 'auth', status: 401 });
  });

  it('says a request without the key was refused, not the key', async () => {
    const { api } = await sonarr(() => ({
      status: 403,
      body: 'Your IP address has been banned after too many failed authentication attempts.',
    }));
    const error = await failure(
      api.login('/api/v2/auth/login', { username: 'admin', password: PASSWORD }),
    );
    expect(error).toMatchObject({ kind: 'auth', status: 403 });
    expect(error.message).toBe(
      'Sonarr at http://sonarr:8989 (127.0.0.1) refused the request (HTTP 403): Your IP address has been banned after too many failed authentication attempts. (POST /api/v2/auth/login)',
    );
  });

  it('POSTs a form with the key, and takes any 2xx as done', async () => {
    const { api, app } = await sonarr(() => ({ status: 200 }), {
      key: { scheme: 'bearer', value: KEY },
    });
    await api.form('/api/v2/torrents/createCategory', {
      category: 'tv',
      savePath: '/data/torrents/tv',
    });
    expect(app.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/v2/torrents/createCategory',
      body: 'category=tv&savePath=%2Fdata%2Ftorrents%2Ftv',
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
    });
    const refused = await sonarr(() => ({
      status: 409,
      body: 'Unable to create category',
    }));
    expect(
      (await failure(refused.api.form('/api/v2/torrents/createCategory', {}))).message,
    ).toContain(
      'refused the request (HTTP 409): Unable to create category (POST /api/v2/torrents/createCategory)',
    );
  });

  it('keeps a secret that a form sends out of what the app says, listed or not', async () => {
    const { api } = await sonarr(
      (request) => ({ status: 400, body: `Bad: ${decodeURIComponent(request.body)}` }),
      { secrets: [] },
    );
    const error = await failure(
      api.form(
        '/api/v2/app/setPreferences',
        { json: JSON.stringify({ web_ui_password: PASSWORD }) },
        { secrets: [PASSWORD] },
      ),
    );
    expect(error.message).toContain('Bad: json={"web_ui_password":"***"}');
    expect(error.message).not.toContain(PASSWORD);
  });

  it("runs an app's own test: a 2xx passes, and a 400 says what failed, never a warning or a value", async () => {
    const passing = await sonarr(() => ({ status: 200, body: {} }));
    expect(
      await passing.api.test('/api/v3/downloadclient/test', { name: 'qBittorrent' }),
    ).toEqual({ passed: true, failures: [] });
    expect(passing.app.requests[0]).toMatchObject({
      method: 'POST',
      body: '{"name":"qBittorrent"}',
      headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    });
    const failing = await sonarr(() => ({
      status: 400,
      body: [
        {
          propertyName: 'ApiKey',
          errorMessage: 'Authentication Failure',
          detailedDescription: 'Please verify your credentials.',
          attemptedValue: `qbt_${'x'.repeat(28)}`,
          isWarning: false,
        },
        {
          propertyName: 'Host',
          errorMessage: 'Unable to connect to qBittorrent',
          detailedDescription: `Connection refused (gluetun:8080) ${KEY}`,
        },
        { propertyName: 'Category', errorMessage: 'Only a warning', isWarning: true },
      ],
    }));
    const result = await failing.api.test('/api/v3/downloadclient/test', {});
    expect(result).toEqual({
      passed: false,
      failures: [
        {
          property: 'ApiKey',
          message: 'Authentication Failure (Please verify your credentials.)',
        },
        {
          property: 'Host',
          message:
            'Unable to connect to qBittorrent (Connection refused (gluetun:8080) ***)',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('qbt_');
    // Warnings alone pass, as the app's own UI says.
    const warned = await sonarr(() => ({
      status: 400,
      body: [{ propertyName: '', errorMessage: 'Only a warning', isWarning: true }],
    }));
    expect(await warned.api.test('/api/v3/downloadclient/test', {})).toEqual({
      passed: true,
      failures: [],
    });
  });

  it('refuses a test answer it cannot read as a verdict', async () => {
    const { api } = await sonarr(() => ({
      status: 400,
      body: { title: 'One or more errors.', errors: { id: ['Bad id'] } },
    }));
    const error = await failure(api.test('/api/v3/downloadclient/test', {}));
    expect(error).toMatchObject({ kind: 'rejected', status: 400 });
    expect(error.message).toContain(
      'refused the request (HTTP 400): One or more errors.; id: Bad id (POST /api/v3/downloadclient/test)',
    );
    // A list that says nothing is no verdict either, never a pass.
    for (const body of [[], ['bad'], [{ propertyName: 'Host' }]]) {
      const unreadable = await sonarr(() => ({ status: 400, body }));
      expect(
        await failure(unreadable.api.test('/api/v3/downloadclient/test', {})),
        JSON.stringify(body),
      ).toMatchObject({ kind: 'rejected', status: 400 });
    }
    const broken = await sonarr(() => ({ status: 500, body: 'Oops' }));
    expect(
      await failure(broken.api.test('/api/v3/downloadclient/test', {})),
    ).toMatchObject({ kind: 'server', status: 500 });
  });

  describe('a password that a form sends inside JSON', () => {
    // qBittorrent's setPreferences takes JSON in a form field: the password is
    // JSON-escaped, and then form-encoded. These forms are written out, not made by the
    // client.
    const NESTED_FORMS = {
      'form-encoded JSON-escaped': 'fake%3Cpass%26x%5C%22pw%5C%5C%21+',
      'form-encoded JSON-escaped, in lowercase hex': 'fake%3cpass%26x%5c%22pw%5c%5c%21+',
      'percent-encoded JSON-escaped': 'fake%3Cpass%26x%5C%22pw%5C%5C!%20',
      'HTML-escaped JSON-escaped': 'fake&lt;pass&amp;x\\&quot;pw\\\\! ',
    };

    it.each([
      [
        'the raw body',
        (request: { body: string }) => ({ status: 400, body: `Bad: ${request.body}` }),
      ],
      [
        'the decoded JSON, HTML-escaped',
        () => ({
          status: 400,
          body: 'Bad: {&quot;web_ui_password&quot;:&quot;fake&lt;pass&amp;x\\&quot;pw\\\\! &quot;}',
        }),
      ],
    ])('stays out of what an app says when it echoes %s', async (_echo, handler) => {
      const { api } = await sonarr(handler, { secrets: [] });
      const error = await failure(
        api.form(
          '/api/v2/app/setPreferences',
          { json: JSON.stringify({ web_ui_password: PW }) },
          { secrets: [PW] },
        ),
      );
      expect(error.message).toContain('***');
      for (const [name, form] of Object.entries(NESTED_FORMS)) {
        expect(error.message, name).not.toContain(form);
      }
      for (const part of PW_PARTS) expect(error.message).not.toContain(part);
    });
  });

  it('sends a sign-in that names its own answers once it may have reached the app', async () => {
    // qBittorrent counts each failed sign-in towards a ban, so a resend could spend more.
    const { api, app, slept } = await sonarr(() => ({ status: 503, body: 'busy' }));
    const error = await failure(
      api.login(
        '/api/v2/auth/login',
        { username: 'admin', password: PASSWORD },
        { answers: [401] },
      ),
    );
    expect(error).toMatchObject({ kind: 'server', status: 503 });
    expect(app.requests).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('tries a sign-in with no answers of its own again while the app is starting', async () => {
    const answers = [503, 503, 302];
    const { api, app, slept } = await sonarr(() => {
      const status = answers.shift() ?? 302;
      return { status, headers: { Location: '/' }, body: status === 302 ? '' : 'busy' };
    });
    expect(await api.login('/login', { username: 'admin', password: PASSWORD })).toEqual({
      status: 302,
      location: '/',
    });
    expect(app.requests).toHaveLength(3);
    expect(slept).toEqual([500, 1000]);
  });

  it('sends a form or an app test once when the app answered 503, as a POST', async () => {
    const form = await sonarr(() => ({ status: 503, body: 'busy' }));
    expect(
      await failure(form.api.form('/api/v2/torrents/createCategory', { category: 'tv' })),
    ).toMatchObject({ kind: 'server', status: 503 });
    expect(form.app.requests).toHaveLength(1);
    expect(form.slept).toEqual([]);
    const test = await sonarr(() => ({ status: 503, body: 'busy' }));
    expect(await failure(test.api.test('/api/v3/downloadclient/test', {}))).toMatchObject(
      { kind: 'server', status: 503 },
    );
    expect(test.app.requests).toHaveLength(1);
    expect(test.slept).toEqual([]);
  });

  it('tries a form again while the connection is refused, and sends it once the app is up', async () => {
    const port = await closedPort();
    const clock = fakeClock();
    const received: string[] = [];
    // The app starts listening while the client waits for the first time.
    const api = createAppApi({
      name: 'qBittorrent',
      service: 'qbittorrent',
      port: 8080,
      endpoint: { host: '127.0.0.1', port },
      secrets: [],
      retry: {
        ...clock.retry,
        sleep: async (ms) => {
          await clock.retry.sleep(ms);
          if (clock.slept.length > 1) return;
          const server = createServer((req, res) => {
            req.on('data', (chunk: Buffer) => received.push(chunk.toString('utf8')));
            req.on('end', () => res.writeHead(200).end());
          });
          await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
          onTestFinished(
            () =>
              new Promise<void>((done) => {
                server.closeAllConnections();
                server.close(() => {
                  done();
                });
              }),
          );
        },
      },
    });
    await api.form('/api/v2/torrents/createCategory', { category: 'tv' });
    expect(clock.slept.length).toBeGreaterThan(0);
    expect(received).toEqual(['category=tv']);
  });

  it('shows what an app test says as one plain line, whatever the app put in it', async () => {
    const secret = 'fake pass';
    const key = `qbt_${'1'.repeat(28)}`;
    const { api } = await sonarr(
      () => ({
        status: 400,
        body: [
          {
            // A newline and an escape sequence, a secret that the newline splits, and a
            // property that is a secret itself.
            propertyName: `Key ${key}`,
            errorMessage: 'Bad\n\u001b[31mred\u001b[0m token fake\npass here',
            detailedDescription: `Try ${key}\r\nagain`,
          },
          {
            propertyName: 'Host',
            errorMessage: `${'x'.repeat(150)} ${'y'.repeat(100)}`,
          },
        ],
      }),
      { secrets: [KEY, secret, key] },
    );
    const result = await api.test('/api/v3/downloadclient/test', {});
    expect(result.failures).toEqual([
      { property: 'Key ***', message: 'Bad [31mred [0m token *** here (Try *** again)' },
      { property: 'Host', message: `${'x'.repeat(150)} ${'y'.repeat(48)}…` },
    ]);
    // 199 characters and the ellipsis, as appMessage cuts.
    expect(result.failures[1]?.message).toHaveLength(200);
    // C0, DEL and C1.
    const control = (char: string) =>
      char < ' ' || (char >= '\u007f' && char <= '\u009f');
    for (const item of result.failures) {
      for (const text of [item.property, item.message]) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(key);
        expect(Array.from(text).some(control)).toBe(false);
      }
    }
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

/** The client fields Mediaplane sends Jellyfin on every call. */
const CLIENT_FIELDS =
  'MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"';

describe("createAppApi: Jellyfin's ways", () => {
  const jellyfin = { name: 'Jellyfin', service: 'jellyfin', port: 8096 };

  it('carries its key in the MediaBrowser header, with its client fields on every call', async () => {
    const { api, app } = await sonarr(
      () => ({ status: 200, body: { version: '12.2.0' } }),
      {
        ...jellyfin,
        key: { scheme: 'mediabrowser', value: KEY },
      },
    );
    await api.get('/System/Info', STATUS);
    await api.ready('/System/Info/Public');
    expect(app.requests.map((r) => r.headers.authorization)).toEqual([
      `${CLIENT_FIELDS}, Token="${KEY}"`,
      CLIENT_FIELDS,
    ]);
    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('calls an app its own way before it has a key, and a Servarr app with no key header', async () => {
    const { api, app } = await sonarr(
      () => ({ status: 200, body: { version: '12.2.0' } }),
      {
        ...jellyfin,
        key: { scheme: 'mediabrowser' },
      },
    );
    await api.get('/System/Info/Public', STATUS);
    expect(app.requests[0]?.headers.authorization).toBe(CLIENT_FIELDS);
    const keyless = await sonarr(() => ({ status: 200, body: { version: '4.0.20' } }), {
      key: { scheme: 'x-api-key' },
    });
    await keyless.api.get('/api/v3/system/status', STATUS);
    expect(keyless.app.requests[0]?.headers).not.toHaveProperty('x-api-key');
    expect(keyless.app.requests[0]?.headers).not.toHaveProperty('authorization');
  });

  it('POSTs and DELETEs, taking any 2xx as done without reading it, and sends a POST again only when nothing reached the app', async () => {
    const statuses = [204, 503, 503, 204];
    const { api, app, slept } = await sonarr(
      () => ({ status: statuses.shift() ?? 500 }),
      {
        ...jellyfin,
        key: { scheme: 'mediabrowser', value: KEY },
      },
    );
    await api.submit('POST', '/Startup/User', { Name: 'admin' });
    expect(app.requests[0]).toMatchObject({
      method: 'POST',
      path: '/Startup/User',
      body: '{"Name":"admin"}',
      headers: { 'content-type': 'application/json' },
    });
    expect(await failure(api.submit('POST', '/Startup/Complete'))).toMatchObject({
      kind: 'server',
      status: 503,
    });
    expect(app.requests[1]?.body).toBe('');
    // A DELETE is tried again, as a GET is.
    await api.submit('DELETE', '/Library/VirtualFolders/Paths?name=Movies');
    expect(app.requests.map((r) => r.method)).toEqual([
      'POST',
      'POST',
      'DELETE',
      'DELETE',
    ]);
    expect(slept).toHaveLength(1);
  });

  it('signs in with JSON and without the key: the answer, or nothing when refused, never the password', async () => {
    const { api, app } = await sonarr(
      (request) => {
        const { Pw } = JSON.parse(request.body) as { Pw: string };
        if (Pw === PASSWORD)
          return { status: 200, body: { AccessToken: 'e'.repeat(32) } };
        if (Pw === 'fake-odd-password') return { status: 400, body: `bad ${Pw}` };
        return { status: 401, body: 'Error processing request.' };
      },
      { ...jellyfin, key: { scheme: 'mediabrowser', value: KEY } },
    );
    const token = z.looseObject({ AccessToken: z.string() });
    const signIn = (pw: string) =>
      api.signIn('/Users/AuthenticateByName', { Username: 'admin', Pw: pw }, token, [pw]);
    expect(await signIn(PASSWORD)).toEqual({ AccessToken: 'e'.repeat(32) });
    expect(await signIn('fake-wrong-password')).toBeUndefined();
    const refused = await failure(signIn('fake-odd-password'));
    expect(refused.message).toBe(
      'Jellyfin at http://jellyfin:8096 (127.0.0.1) refused the request (HTTP 400): bad *** (POST /Users/AuthenticateByName)',
    );
    expect(app.requests[0]?.headers.authorization).toBe(CLIENT_FIELDS);
    expect(app.requests[0]?.headers['content-type']).toBe('application/json');
    expect(app.requests).toHaveLength(3);
  });

  it('gives the same app with another key, which it keeps out of what it says', async () => {
    const session = 'd'.repeat(32);
    const { api, app } = await sonarr(
      (request) => ({ status: 401, body: `no ${String(request.headers.authorization)}` }),
      { ...jellyfin, key: { scheme: 'mediabrowser', value: KEY }, secrets: [] },
    );
    const refused = await failure(api.withKey(session).check('/System/Info'));
    expect(app.requests[0]?.headers.authorization).toBe(
      `${CLIENT_FIELDS}, Token="${session}"`,
    );
    expect(refused.message).toBe(
      `Jellyfin at http://jellyfin:8096 (127.0.0.1) refused Mediaplane's API key (HTTP 401): no ${CLIENT_FIELDS}, Token="***" (GET /System/Info)`,
    );
  });

  it("keeps the key it replaces out of the other client's messages too", async () => {
    const { api } = await sonarr(() => ({ status: 401, body: `was ${KEY}` }), {
      ...jellyfin,
      key: { scheme: 'mediabrowser', value: KEY },
      secrets: [],
    });
    const refused = await failure(api.withKey('d'.repeat(32)).check('/System/Info'));
    expect(refused.message).toContain('was ***');
    expect(refused.message).not.toContain(KEY);
  });
});

describe("createAppApi: Seerr's session", () => {
  const seerr = { name: 'Seerr', service: 'seerr', port: 5055 };
  const COOKIE = 's%3Afake-session.signed';

  it('signs in with JSON and without the key, and gives a client that carries the session cookie in place of the key', async () => {
    const { api, app } = await sonarr(
      (request) => {
        if (request.path === '/api/v1/auth/jellyfin') {
          const { password } = JSON.parse(request.body) as { password: string };
          return password === PASSWORD
            ? {
                status: 200,
                body: { id: 1 },
                headers: { 'Set-Cookie': `connect.sid=${COOKIE}; Path=/; HttpOnly` },
              }
            : { status: 401, body: { message: 'INVALID_CREDENTIALS' } };
        }
        return { status: 200, body: { status: 'ok' } };
      },
      { ...seerr },
    );
    const signIn = (password: string) =>
      api.session(
        '/api/v1/auth/jellyfin',
        { username: 'admin', password, port: 8096, useSsl: false },
        'connect.sid',
        [password],
      );
    expect(await signIn('fake-wrong-password')).toBeUndefined();
    const session = await signIn(PASSWORD);
    expect(session).toBeDefined();
    await session?.submit('POST', '/api/v1/auth/logout');
    const [refused, signedIn, signedOut] = app.requests;
    expect(refused?.headers).not.toHaveProperty('x-api-key');
    expect(signedIn).toMatchObject({
      body: '{"username":"admin","password":"fake-admin-password","port":8096,"useSsl":false}',
      headers: { 'content-type': 'application/json' },
    });
    expect(signedIn?.headers).not.toHaveProperty('cookie');
    expect(signedOut?.headers.cookie).toBe(`connect.sid=${COOKIE}`);
    expect(signedOut?.headers).not.toHaveProperty('x-api-key');
    // The client it came from still carries its key, and no cookie.
    await api.check('/api/v1/auth/me');
    expect(app.requests[3]?.headers).toMatchObject({ 'x-api-key': KEY });
    expect(app.requests[3]?.headers).not.toHaveProperty('cookie');
  });

  it('keeps the cookie and the password out of what it says, and fails a sign-in that sets no cookie', async () => {
    const replies = [
      {
        status: 200,
        body: {},
        headers: { 'Set-Cookie': `connect.sid=${COOKIE}; Path=/` },
      },
      { status: 500, body: { message: `fake failure with ${COOKIE} and ${PW}` } },
      { status: 200, body: {}, headers: { 'Set-Cookie': 'connect.sid=; Path=/' } },
      { status: 400, body: { message: `bad ${PW}` } },
    ];
    const { api } = await sonarr(() => replies.shift() ?? { status: 404 }, {
      ...seerr,
      secrets: [],
    });
    const signIn = () =>
      api.session('/api/v1/auth/jellyfin', { password: PW }, 'connect.sid', [PW]);
    const session = await signIn();
    const said = await failure(
      session?.submit('POST', '/api/v1/auth/logout') ?? Promise.resolve(),
    );
    expect(said.message).toBe(
      'Seerr at http://seerr:5055 (127.0.0.1) failed (HTTP 500): fake failure with *** and *** (POST /api/v1/auth/logout)',
    );
    expect(await failure(signIn())).toMatchObject({
      kind: 'protocol',
      message:
        'Seerr at http://seerr:5055 (127.0.0.1) signed in, but set no connect.sid cookie (POST /api/v1/auth/jellyfin)',
    });
    expect((await failure(signIn())).message).toContain('bad ***');
  });

  it('sends a sign-in once it may have reached the app', async () => {
    const { api, app } = await sonarr(() => ({ status: 503 }), { ...seerr });
    expect(
      await failure(api.session('/api/v1/auth/jellyfin', {}, 'connect.sid', [])),
    ).toMatchObject({ kind: 'server', status: 503 });
    expect(app.requests).toHaveLength(1);
  });

  /** Signs in, answering `cookies`, and gives the session and the app it came from. */
  async function sessionOf(cookies: string[], extra: Partial<AppApiOptions> = {}) {
    const made = await sonarr(
      (request) =>
        request.path === '/api/v1/auth/jellyfin'
          ? { status: 200, body: {}, headers: { 'Set-Cookie': cookies } }
          : request.path === '/boom'
            ? {
                status: 500,
                body: { message: `near ${COOKIE} and s:fake-session.signed` },
              }
            : { status: 200, body: { status: 'ok' } },
      { ...seerr, ...extra },
    );
    const session = await made.api.session(
      '/api/v1/auth/jellyfin',
      {},
      'connect.sid',
      [],
    );
    if (session === undefined) throw new Error('the sign-in must pass');
    return { ...made, session };
  }

  it("takes the cookie's value up to the first ';', whatever dated attribute follows, among several Set-Cookie headers", async () => {
    const { session, app } = await sessionOf([
      'locale=en; Path=/',
      `connect.sid=${COOKIE}; Path=/; Expires=Sun, 15 Nov 2026 12:00:00 GMT; HttpOnly`,
      'connect.sidx=wrong; Path=/',
    ]);
    await session.submit('POST', '/api/v1/auth/logout');
    expect(app.requests[1]?.headers.cookie).toBe(`connect.sid=${COOKIE}`);
  });

  it('gives the key alone, never its parent session cookie, to a client made with withKey', async () => {
    const { session, app } = await sessionOf([`connect.sid=${COOKIE}; Path=/`]);
    const other = 'd'.repeat(32);
    await session.withKey(other).check('/api/v1/auth/me');
    expect(app.requests[1]?.headers).toMatchObject({ 'x-api-key': other });
    expect(app.requests[1]?.headers).not.toHaveProperty('cookie');
  });

  it("keeps the cookie, as set and decoded, out of every client's messages in the run, the session's withKey too", async () => {
    const found = foundSecrets();
    const { session } = await sessionOf([`connect.sid=${COOKIE}; Path=/`], {
      found,
      secrets: [],
    });
    expect(found.values).toEqual([COOKIE, 's:fake-session.signed']);
    const { api: other } = await sonarr(
      () => ({
        status: 500,
        body: { message: `near ${COOKIE} and s:fake-session.signed` },
      }),
      { found, secrets: [] },
    );
    for (const client of [other, session, session.withKey('d'.repeat(32))]) {
      expect((await failure(client.check('/boom'))).message).toContain(
        'near *** and ***',
      );
    }
  });
});

describe('createAppApi: a session cookie that is not validly percent-encoded', () => {
  it('is kept out of what the run says as it is set, and the session still works', async () => {
    const found = foundSecrets();
    const odd = 's%ZZfake-session.signed';
    const { api, app } = await sonarr(
      (request) =>
        request.path === '/api/v1/auth/jellyfin'
          ? {
              status: 200,
              body: {},
              headers: { 'Set-Cookie': `connect.sid=${odd}; Path=/` },
            }
          : { status: 500, body: { message: `near ${odd}` } },
      { found, secrets: [] },
    );
    const session = await api.session('/api/v1/auth/jellyfin', {}, 'connect.sid', []);
    if (session === undefined) throw new Error('the sign-in must pass');
    expect(found.values).toEqual([odd]);
    expect((await failure(session.check('/boom'))).message).toContain('near ***');
    expect(app.requests[1]?.headers.cookie).toBe(`connect.sid=${odd}`);
  });
});

describe('createAppApi: a secret read in an answer', () => {
  /** A key an app holds in clear, which the run didn't know of when it started. */
  const HELD = 'e'.repeat(32);
  const quoting = () => ({ status: 500, body: { message: `fake failure near ${HELD}` } });

  it('is redacted from then on, by every client of the run that shares its FoundSecrets', async () => {
    const found = foundSecrets();
    const { api } = await sonarr(quoting, { found });
    const { api: other } = await sonarr(quoting, { found });
    // Not one of the run's secrets yet: nothing tells the client it is one.
    expect((await failure(api.check('/api/v3/system/status'))).message).toContain(HELD);
    api.addSecret(HELD);
    expect(found.values).toEqual([HELD]);
    for (const client of [api, other, api.withKey('d'.repeat(32))]) {
      const said = await failure(client.check('/api/v3/system/status'));
      expect(said.message).toBe(
        'Sonarr at http://sonarr:8989 (127.0.0.1) failed (HTTP 500): fake failure near *** (GET /api/v3/system/status)',
      );
    }
    // In each form an app may echo it in, and in a call that sends secrets of its own.
    const { api: escaped } = await sonarr(
      () => ({ status: 500, body: `fake failure near ${encodeURIComponent(PW)}` }),
      { found },
    );
    found.add(PW);
    expect((await failure(escaped.submit('POST', '/x'))).message).toContain('near ***');
    expect(
      (await failure(escaped.session('/x', {}, 'connect.sid', ['fake-other']))).message,
    ).toContain('near ***');
  });

  it("is kept by a client without the run's FoundSecrets, and shared with the clients it makes", async () => {
    const { api } = await sonarr(quoting);
    api.withKey('d'.repeat(32)).addSecret(HELD);
    expect((await failure(api.check('/api/v3/system/status'))).message).toContain(
      'near ***',
    );
  });
});
