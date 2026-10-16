import { describe, expect, it } from 'vitest';
import { closedPort, fakeHttpApp } from '../testing/http';
import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '../testing/plextv';
import {
  newClientId,
  PLEX_CLIENT_ID,
  plexTvClient,
  PlexTvError,
  signInLink,
  type PlexPin,
} from './client';

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const WRONG = 'wrong-plex-token-000';

/** What `call` threw. */
async function caught(call: Promise<unknown>): Promise<PlexTvError> {
  const error = await call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(error instanceof PlexTvError)) throw new Error('expected a PlexTvError');
  return error;
}

describe('plexTvClient', () => {
  it('makes a strong PIN for the device that asks, and names the sign-in link', async () => {
    const { client, app } = await fakePlexTv();
    const clientId = newClientId();
    const pin = await client.createPin(clientId);
    expect(pin).toEqual({ id: 1, code: pin.code, clientId, expiresIn: 1800 });
    expect(pin.code).toHaveLength(25);
    expect(app.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/v2/pins?strong=true',
      headers: {
        'x-plex-product': 'Mediaplane',
        'x-plex-client-identifier': clientId,
      },
    });
    expect(app.requests[0]?.headers['x-plex-token']).toBeUndefined();
    expect(signInLink(pin)).toBe(
      `https://app.plex.tv/auth#?clientID=${clientId}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=Mediaplane`,
    );
  });

  it('gives each sign-in a device of its own', () => {
    expect(newClientId()).toMatch(/^mediaplane-[0-9a-f-]{36}$/);
    expect(newClientId()).not.toBe(newClientId());
  });

  it("waits for a PIN's sign-in, as the device it is for, and gives the token", async () => {
    const { client, state, app } = await fakePlexTv();
    state.signIn = { token: TOKEN, afterReads: 2 };
    const pin = await client.createPin(newClientId());
    expect(await client.waitForPin(pin, 60)).toBe(TOKEN);
    const asked = app.requests.slice(1);
    expect(asked).toHaveLength(3);
    for (const request of asked) {
      expect(request).toMatchObject({
        method: 'GET',
        path: `/api/v2/pins/${String(pin.id)}`,
      });
      expect(request.headers['x-plex-client-identifier']).toBe(pin.clientId);
      expect(request.headers['x-plex-token']).toBeUndefined();
    }
  });

  it('gives nothing when nobody signs in in time', async () => {
    const { client } = await fakePlexTv();
    const pin = await client.createPin(newClientId());
    expect(await client.waitForPin(pin, 0)).toBeUndefined();
  });

  it('says a PIN plex.tv has forgotten ran out, and never shows its code', async () => {
    const { client, state } = await fakePlexTv();
    const pin = await client.createPin(newClientId());
    if (state.pins[0] !== undefined) state.pins[0].expired = true;
    const error = await caught(client.waitForPin(pin, 60));
    expect(error).toMatchObject({
      kind: 'expired',
      status: 404,
      unsure: false,
      message:
        'plex.tv no longer knows the sign-in: its link ran out (GET /api/v2/pins/1)',
    });
    expect(error.message).not.toContain(pin.code);
  });

  it('reads a PIN only as the device it was made for', async () => {
    const { client } = await fakePlexTv();
    const pin = await client.createPin(newClientId());
    const other: PlexPin = { ...pin, clientId: newClientId() };
    expect(await caught(client.waitForPin(other, 60))).toMatchObject({ kind: 'expired' });
  });

  it("gets a claim token, and an account's id", async () => {
    const { client, state, app } = await fakePlexTv();
    const claim = await client.claimToken(TOKEN);
    expect(claim).toMatch(/^claim-.{20}$/);
    expect(state.claims).toEqual([
      { token: claim, account: FAKE_PLEX_ACCOUNT.id, used: false },
    ]);
    expect(await client.accountId(TOKEN)).toBe(FAKE_PLEX_ACCOUNT.id);
    for (const request of app.requests) {
      expect(request.headers['x-plex-token']).toBe(TOKEN);
      expect(request.headers['x-plex-client-identifier']).toBe(PLEX_CLIENT_ID);
    }
  });

  it("gives a server's own token as its owner's, until it is removed from the account", async () => {
    const { client, state } = await fakePlexTv();
    const server = {
      machineId: 'fake-machine',
      owner: FAKE_PLEX_ACCOUNT.id,
      name: 'x',
      token: 'fake-server-token-77',
    };
    state.servers.push(server);
    expect(await client.accountId(server.token)).toBe(FAKE_PLEX_ACCOUNT.id);
    state.servers = [];
    const gone = await caught(client.accountId(server.token));
    expect(gone).toMatchObject({ kind: 'refused', status: 401 });
    expect(gone.message).not.toContain(server.token);
  });

  it('says plex.tv refused a token, and never shows it', async () => {
    const { client } = await fakePlexTv();
    for (const call of [client.claimToken(WRONG), client.accountId(WRONG)]) {
      const error = await caught(call);
      expect(error).toMatchObject({ kind: 'refused', status: 401, unsure: false });
      expect(error.message).toMatch(/^plex\.tv refused the Plex token \(HTTP 401\)/);
      expect(error.message).not.toContain(WRONG);
    }
  });

  it('asks a GET again, twice, after a 5xx or a 429, then says plex.tv failed', async () => {
    const { client, state } = await fakePlexTv();
    state.failing.push({ path: '/api/claim/token.json', status: 503 });
    const error = await caught(client.claimToken(TOKEN));
    expect(error).toMatchObject({
      kind: 'failed',
      status: 503,
      unsure: true,
      message: 'plex.tv failed (HTTP 503) (GET /api/claim/token.json)',
    });
    expect(state.calls).toEqual([
      'GET /api/claim/token.json',
      'GET /api/claim/token.json',
      'GET /api/claim/token.json',
    ]);
    state.failing = [{ path: '/api/v2/user', status: 429 }];
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'failed',
      status: 429,
      unsure: true,
    });
  });

  it('waits 5 then 15 seconds between tries', async () => {
    const slept: number[] = [];
    const app = await fakeHttpApp(() => ({ status: 502 }));
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(app.port)}`,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await caught(client.accountId(TOKEN));
    expect(slept).toEqual([5_000, 15_000]);
  });

  it('never makes a second PIN after a failure: a POST is sent once', async () => {
    const { client, state } = await fakePlexTv();
    state.failing.push({ path: '/api/v2/pins', status: 503 });
    expect(await caught(client.createPin(newClientId()))).toMatchObject({
      kind: 'failed',
    });
    expect(state.calls).toEqual(['POST /api/v2/pins?strong=true']);
  });

  it('says nothing answered, as unsure, when plex.tv can not be reached', async () => {
    const port = await closedPort();
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(port)}`,
      sleep: () => Promise.resolve(),
    });
    const error = await caught(client.accountId(TOKEN));
    expect(error).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message: 'plex.tv could not be reached (ECONNREFUSED) (GET /api/v2/user)',
    });
  });

  it('says plex.tv did not answer in time, as unsure', async () => {
    const app = await fakeHttpApp(() => 'hang');
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(app.port)}`,
      timeoutMs: 50,
      sleep: () => Promise.resolve(),
    });
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message: 'plex.tv did not answer within 0.05 s (GET /api/v2/user)',
    });
  });

  it("refuses an answer it doesn't understand, naming only where, not as unsure", async () => {
    const app = await fakeHttpApp((request) =>
      request.path.startsWith('/api/claim')
        ? { status: 200, body: { token: `not-a-claim ${TOKEN}` } }
        : { status: 200, body: `not json ${TOKEN}` },
    );
    const client = plexTvClient({ base: `http://127.0.0.1:${String(app.port)}` });
    const claim = await caught(client.claimToken(TOKEN));
    expect(claim).toMatchObject({
      kind: 'protocol',
      unsure: false,
      message:
        "plex.tv answered something Mediaplane doesn't understand (at token) (GET /api/claim/token.json)",
    });
    const user = await caught(client.accountId(TOKEN));
    expect(user.message).toBe(
      'plex.tv answered with something that is not JSON (GET /api/v2/user)',
    );
  });

  it('refuses another refusal, such as a 400, as plex.tv refusing the request', async () => {
    const app = await fakeHttpApp(() => ({ status: 400, body: 'no' }));
    const client = plexTvClient({ base: `http://127.0.0.1:${String(app.port)}` });
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'protocol',
      status: 400,
      unsure: false,
      message: 'plex.tv refused the request (HTTP 400) (GET /api/v2/user)',
    });
  });

  it('stops reading an answer of more than 1 MiB', async () => {
    const app = await fakeHttpApp(() => ({
      status: 200,
      body: 'x'.repeat(1024 * 1024 + 1),
    }));
    const client = plexTvClient({ base: `http://127.0.0.1:${String(app.port)}` });
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'protocol',
      message: 'plex.tv answered more than 1 MiB (GET /api/v2/user)',
    });
  });

  it('refuses a token that can not go in a header, without showing it', async () => {
    const { client, app } = await fakePlexTv();
    const bad = 'line\nbreak-token';
    const error = await caught(client.accountId(bad));
    expect(error).toMatchObject({ kind: 'protocol' });
    expect(error.message).toMatch(/^plex\.tv could not be asked \(/);
    expect(error.message).not.toContain('break-token');
    expect(app.requests).toEqual([]);
  });
});
