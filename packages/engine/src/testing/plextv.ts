import { plexTvClient, type PlexTv } from '../plextv/client';
import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';

/** A plex.tv account the fake knows: its id, and the token a sign-in gave it. */
export interface FakePlexAccount {
  id: number;
  token: string;
}

/** A server a fake account owns, by its machine identifier, as plex.tv lists it. */
export interface FakePlexServer {
  machineId: string;
  owner: number;
  name: string;
  /** Its own token, which its claim gave it: plex.tv takes it as its owner's. */
  token: string;
}

/** A sign-in's PIN, as the fake plex.tv keeps it. */
export interface FakePlexPin {
  id: number;
  code: string;
  clientId: string;
  /** The token of whoever signed in through its link; null until someone has. */
  authToken: string | null;
  /** Forgotten by plex.tv, as an expired PIN is: reading it is 404. */
  expired: boolean;
  /** How many times it was read. */
  reads: number;
}

/** What the fake plex.tv holds; a test may change it between calls. */
export interface FakePlexTvState {
  accounts: FakePlexAccount[];
  servers: FakePlexServer[];
  pins: FakePlexPin[];
  /** The claim tokens it gave, each with its account, until a server uses it. */
  claims: { token: string; account: number; used: boolean }[];
  /**
   * Someone signs in through each PIN's link once it has been read `afterReads` times, as
   * the account whose token is `token`. Unset: nobody does.
   */
  signIn?: { token: string; afterReads: number };
  /** Paths (without the query) that answer `status` instead, as plex.tv failing. */
  failing: { path: string; status: number }[];
  /** Every request's method and path (with the query), in order. */
  calls: string[];
}

/** The account a fake plex.tv knows from the start, and its token. */
export const FAKE_PLEX_ACCOUNT: FakePlexAccount = {
  id: 7_000_001,
  token: 'fake-plex-token-0001',
};

/** A plex.tv that knows FAKE_PLEX_ACCOUNT and nothing else. */
export function freshPlexTv(): FakePlexTvState {
  return {
    accounts: [{ ...FAKE_PLEX_ACCOUNT }],
    servers: [],
    pins: [],
    claims: [],
    failing: [],
    calls: [],
  };
}

/** plex.tv's refusal of a token it doesn't know, as `/api/v2/…` gives it (probed). */
const NOT_AUTHENTICATED: FakeReply = {
  status: 401,
  body: {
    errors: [{ code: 1001, message: 'User could not be authenticated', status: 401 }],
  },
};

/** plex.tv's answer for a PIN it doesn't know, or no longer does (probed). */
const NO_PIN: FakeReply = {
  status: 404,
  body: { errors: [{ code: 1020, message: 'Code not found or expired', status: 404 }] },
};

/** A strong PIN's code: 25 characters (probed). */
function pinCode(id: number): string {
  return `fakecode${String(id)}`.padEnd(25, 'x');
}

/**
 * plex.tv's API, as far as Mediaplane uses it, from `state`, as plex.tv answered it when
 * probed (2026-10-16):
 * - `POST /api/v2/pins?strong=true` makes a PIN for the device in
 *   `X-Plex-Client-Identifier` (201: a 25-character code, 1800 s), and `GET
 *   /api/v2/pins/<id>` reads it, `authToken` null until someone signs in, for that device
 *   only: another device, an unknown id or an expired PIN is 404;
 * - `GET /api/claim/token.json` gives a claim token (`claim-` and 20 characters) for the
 *   token's account; an unknown token is 401 with `{"error":…}`;
 * - `GET /api/v2/user` gives the token's account: an account's own token, or a server's,
 *   which its claim gave it, as its owner's; an unknown token, or a server's once the
 *   server is removed from its account, is 401.
 */
export function answerPlexTv(request: FakeRequest, state: FakePlexTvState): FakeReply {
  state.calls.push(`${request.method} ${request.path}`);
  const url = new URL(request.path, 'http://plex.tv');
  const failing = state.failing.find((f) => f.path === url.pathname);
  if (failing !== undefined) {
    return { status: failing.status, body: '<html>fake failure</html>' };
  }
  const clientId = request.headers['x-plex-client-identifier'];
  const account = state.accounts.find((a) => a.token === request.headers['x-plex-token']);
  if (url.pathname === '/api/v2/pins' && request.method === 'POST') {
    if (typeof clientId !== 'string' || clientId === '') {
      return {
        status: 400,
        body: {
          errors: [
            { code: 1000, message: 'X-Plex-Client-Identifier is missing', status: 400 },
          ],
        },
      };
    }
    const id = state.pins.length + 1;
    const pin: FakePlexPin = {
      id,
      code: pinCode(id),
      clientId,
      authToken: null,
      expired: false,
      reads: 0,
    };
    state.pins.push(pin);
    return {
      status: 201,
      body: {
        id,
        code: pin.code,
        product: 'Mediaplane',
        trusted: false,
        clientIdentifier: clientId,
        expiresIn: 1800,
        authToken: null,
        newRegistration: null,
      },
    };
  }
  const pinPath = /^\/api\/v2\/pins\/(\d+)$/.exec(url.pathname);
  if (pinPath !== null && request.method === 'GET') {
    const pin = state.pins.find((p) => p.id === Number(pinPath[1]));
    if (pin === undefined || pin.expired || pin.clientId !== clientId) return NO_PIN;
    pin.reads += 1;
    if (state.signIn !== undefined && pin.reads > state.signIn.afterReads) {
      pin.authToken = state.signIn.token;
    }
    return {
      status: 200,
      body: {
        id: pin.id,
        code: pin.code,
        clientIdentifier: pin.clientId,
        expiresIn: 1700,
        authToken: pin.authToken,
      },
    };
  }
  if (url.pathname === '/api/claim/token.json' && request.method === 'GET') {
    if (account === undefined) {
      return { status: 401, body: { error: 'Invalid authentication token.' } };
    }
    const token = `claim-fake${String(state.claims.length + 1)}`.padEnd(26, 'c');
    state.claims.push({ token, account: account.id, used: false });
    return { status: 200, body: { token } };
  }
  if (url.pathname === '/api/v2/user' && request.method === 'GET') {
    const server = state.servers.find((s) => s.token === request.headers['x-plex-token']);
    const whose = account ?? state.accounts.find((a) => a.id === server?.owner);
    if (whose === undefined) return NOT_AUTHENTICATED;
    return {
      status: 200,
      body: {
        id: whose.id,
        uuid: 'fakeuuid',
        username: 'fake-user',
        authToken: whose.token,
      },
    };
  }
  return { status: 404, body: { errors: [{ code: 1, message: 'Not Found' }] } };
}

/**
 * A fake plex.tv on 127.0.0.1, answering as answerPlexTv does, and a client of it as
 * Mediaplane's own (plexTvClient), on a clock of its own that a wait moves forward at
 * once: a sign-in's PIN is asked about every 2 seconds of that clock, and nobody waits.
 */
export async function fakePlexTv(state: FakePlexTvState = freshPlexTv()): Promise<{
  app: FakeApp;
  state: FakePlexTvState;
  client: PlexTv;
}> {
  const app = await fakeHttpApp((request) => answerPlexTv(request, state));
  let clock = 0;
  const client = plexTvClient({
    base: `http://127.0.0.1:${String(app.port)}`,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  });
  return { app, state, client };
}
