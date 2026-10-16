import { randomUUID } from 'node:crypto';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { codeOf } from '../util/error-code';
import { redact, redactionValues } from '../util/redact';

/** plex.tv, where Plex accounts, their sign-ins and their servers live. */
export const PLEX_TV = 'https://plex.tv';

/**
 * The product Mediaplane names itself as to plex.tv: the device a sign-in makes in the
 * account ("Mediaplane", under Authorized Devices) is named after it.
 */
export const PLEX_PRODUCT = 'Mediaplane';

/**
 * The client identifier Mediaplane's own calls carry. plex.tv makes a device only for a
 * sign-in, whose identifier is its own (`newClientId`); calls with a token make none.
 */
export const PLEX_CLIENT_ID = 'mediaplane';

/**
 * A new device's client identifier, for one sign-in: the token it gets belongs to that
 * device, which the account lists as "Mediaplane" until you remove it.
 */
export function newClientId(): string {
  return `mediaplane-${randomUUID()}`;
}

/** How long one request to plex.tv may take, in ms. */
export const PLEX_TV_TIMEOUT_MS = 30_000;

/** How often a sign-in's PIN is asked about while it waits, in ms. */
export const PIN_POLL_MS = 2_000;

/** The most of an answer Mediaplane reads from plex.tv, in bytes. */
const MAX_BYTES = 1024 * 1024;

/**
 * Why a plex.tv call failed:
 * - `refused`: plex.tv refused the token (401, and only 401): it was revoked, or is not a
 *   Plex token;
 * - `expired`: plex.tv no longer knows the sign-in's PIN (404): it ran out;
 * - `unreachable`: nothing answered in time, or at all;
 * - `failed`: plex.tv failed (5xx), kept refusing to be asked so often (429), or refused
 *   in a way that is not about the token (403, as a CDN or a geo-block answers);
 * - `protocol`: it answered something Mediaplane doesn't understand, or another refusal.
 */
export type PlexTvErrorKind =
  'refused' | 'expired' | 'unreachable' | 'failed' | 'protocol';

/** A plex.tv call that failed, said for the user. It never holds a token or a code. */
export class PlexTvError extends Error {
  override readonly name = 'PlexTvError';
  readonly kind: PlexTvErrorKind;
  readonly status: number | undefined;
  /**
   * Whether Mediaplane couldn't tell: no answer, a timeout, a 5xx or a 429. An answer
   * that refuses, or that Mediaplane can't read, is not unsure.
   */
  readonly unsure: boolean;

  constructor(message: string, details: { kind: PlexTvErrorKind; status?: number }) {
    super(message);
    this.kind = details.kind;
    this.status = details.status;
    this.unsure = details.kind === 'unreachable' || details.kind === 'failed';
  }
}

/** A sign-in's PIN: plex.tv's id for it, its code, and which device asked for it. */
export interface PlexPin {
  id: number;
  /** In the sign-in link. Not a secret, but never kept. */
  code: string;
  /** The device (`X-Plex-Client-Identifier`) the PIN is for: only it may read the PIN. */
  clientId: string;
  /** How long the PIN lasts, in seconds, from when plex.tv made it. */
  expiresIn: number;
}

/**
 * plex.tv, as Mediaplane calls it (spec §6.1). Every method that takes a token keeps it
 * out of every message, as it does a claim token, a code and a sign-in's token.
 */
export interface PlexTv {
  /**
   * A new PIN for a sign-in by the device `clientId`: a strong one, whose 25-character code
   * goes in a link and lasts 30 minutes (probed).
   */
  createPin(clientId: string): Promise<PlexPin>;
  /**
   * Wait up to `seconds` for someone to sign in through `pin`'s link: the account's token
   * (its long-lived one, not the 7-day JWT), or undefined when nobody did by then.
   * Throws PlexTvError `expired` once plex.tv no longer knows the PIN.
   */
  waitForPin(pin: PlexPin, seconds: number): Promise<string | undefined>;
  /** A claim token for a new server, `claim-…`: it lasts 4 minutes, and is used once. */
  claimToken(token: string): Promise<string>;
  /**
   * The id of the account `token` is a token of: yours, or a Plex server's own, which its
   * claim gave it, and which plex.tv answers with its owner's id (probed).
   */
  accountId(token: string): Promise<number>;
}

/**
 * plex.tv for a caller that was given none, such as a test of a stack without Plex: every
 * call fails, as plex.tv out of reach does.
 */
export const NO_PLEX_TV: PlexTv = {
  createPin: () => Promise.reject(unavailable()),
  waitForPin: () => Promise.reject(unavailable()),
  claimToken: () => Promise.reject(unavailable()),
  accountId: () => Promise.reject(unavailable()),
};

function unavailable(): PlexTvError {
  return new PlexTvError('Mediaplane was given no way to reach plex.tv', {
    kind: 'unreachable',
  });
}

/** How a plex.tv client is made; tests give a fake plex.tv's address and a clock. */
export interface PlexTvOptions {
  /** plex.tv's address: PLEX_TV, unless a test points it at a fake. */
  base?: string;
  timeoutMs?: number;
  /** How often waitForPin asks. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
  /** A clock that only moves forward, in ms. */
  now?: () => number;
}

const pinSchema = z.looseObject({
  id: z.number(),
  code: z.string().min(1),
  expiresIn: z.number(),
  authToken: z.string().nullable(),
});
const claimSchema = z.looseObject({ token: z.string().regex(/^claim-./) });
const userSchema = z.looseObject({ id: z.number() });

/** How many times a request plex.tv was too busy for (429, 5xx) is asked again. */
const AGAIN = 2;

/** The link a sign-in through `pin` starts from: plex.tv's own page for it. */
export function signInLink(pin: PlexPin): string {
  const query = new URLSearchParams({
    clientID: pin.clientId,
    code: pin.code,
    'context[device][product]': PLEX_PRODUCT,
  });
  return `https://app.plex.tv/auth#?${query.toString()}`;
}

/**
 * A plex.tv client that calls plex.tv itself, as Mediaplane run from source does, and the
 * plex.tv helper does for Mediaplane in its image. It uses an agent of its own, so a proxy
 * from the environment never sees a token, follows no redirect, reads at most 1 MiB of an
 * answer, and asks again, twice, a GET that plex.tv was too busy for (429, 5xx) or that
 * went unanswered, after 5 then 15 seconds.
 */
export function plexTvClient(options: PlexTvOptions = {}): PlexTv {
  const base = new URL(options.base ?? PLEX_TV);
  const secure = base.protocol === 'https:';
  const agent = secure
    ? new HttpsAgent({ keepAlive: false })
    : new HttpAgent({ keepAlive: false });
  const timeoutMs = options.timeoutMs ?? PLEX_TV_TIMEOUT_MS;
  const pollMs = options.pollMs ?? PIN_POLL_MS;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise((done) => {
        setTimeout(done, ms);
      }));
  const now = options.now ?? (() => performance.now());

  interface Call {
    method: 'GET' | 'POST';
    path: string;
    token?: string;
    clientId?: string;
    /** Secrets this call sends or may get back, kept out of every message. */
    secrets: readonly string[];
  }

  function attempt(call: Call): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Client-Identifier': call.clientId ?? PLEX_CLIENT_ID,
      };
      if (call.token !== undefined) headers['X-Plex-Token'] = call.token;
      const send = secure ? httpsRequest : httpRequest;
      try {
        const req = send(
          {
            agent,
            protocol: base.protocol,
            host: base.hostname,
            port: base.port === '' ? undefined : Number(base.port),
            method: call.method,
            path: call.path,
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_BYTES) {
                res.destroy();
                reject(failure(call, 'answered more than 1 MiB', { kind: 'protocol' }));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
            res.on('error', (cause) => {
              reject(connectionFailure(call, cause));
            });
          },
        );
        req.on('error', (cause) => {
          reject(connectionFailure(call, cause));
        });
        req.end();
      } catch (cause) {
        // Node refuses to build the request, say for a token with a newline in it. Its
        // message could quote the value; the code says enough.
        reject(
          failure(call, `could not be asked (${codeOf(cause) ?? 'no reason given'})`, {
            kind: 'protocol',
          }),
        );
      }
    });
  }

  /** `what` went wrong with `call`: the message names the method and path, never a query. */
  function failure(
    call: Call,
    what: string,
    details: ConstructorParameters<typeof PlexTvError>[1],
  ): PlexTvError {
    const path = call.path.split('?')[0] ?? call.path;
    return new PlexTvError(
      redact(`plex.tv ${what} (${call.method} ${path})`, redactionValues(call.secrets)),
      details,
    );
  }

  function connectionFailure(call: Call, cause: unknown): PlexTvError {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return failure(call, `did not answer within ${String(timeoutMs / 1000)} s`, {
        kind: 'unreachable',
      });
    }
    const code = codeOf(cause);
    return failure(
      call,
      `could not be reached (${code === undefined || code === '' ? 'no reason given' : code})`,
      { kind: 'unreachable' },
    );
  }

  /** `call`'s answer, of a status `ok` takes; plex.tv's refusals as PlexTvErrors. */
  async function send(
    call: Call,
    ok: (status: number) => boolean = (status) => status >= 200 && status < 300,
  ): Promise<{ status: number; body: string }> {
    for (let tries = 0; ; tries++) {
      let error: PlexTvError;
      try {
        const answer = await attempt(call);
        if (ok(answer.status)) return answer;
        error = statusFailure(call, answer.status);
      } catch (cause) {
        if (!(cause instanceof PlexTvError)) throw cause;
        error = cause;
      }
      // A POST makes something (a PIN): it isn't sent twice.
      if (!error.unsure || call.method !== 'GET' || tries >= AGAIN) throw error;
      await sleep(tries === 0 ? 5_000 : 15_000);
    }
  }

  function statusFailure(call: Call, status: number): PlexTvError {
    if (status === 401) {
      return failure(call, 'refused the Plex token (HTTP 401)', {
        kind: 'refused',
        status,
      });
    }
    // Not the token's refusal, which is a 401: a CDN or a geo-block says 403 too. Unsure.
    if (status === 403) {
      return failure(
        call,
        'refused the request, which is not a refusal of the token (HTTP 403)',
        {
          kind: 'failed',
          status,
        },
      );
    }
    if (status === 429) {
      return failure(call, 'is being asked too often (HTTP 429)', {
        kind: 'failed',
        status,
      });
    }
    if (status >= 500) {
      return failure(call, `failed (HTTP ${String(status)})`, { kind: 'failed', status });
    }
    return failure(call, `refused the request (HTTP ${String(status)})`, {
      kind: 'protocol',
      status,
    });
  }

  function parsed<T>(call: Call, body: string, schema: z.ZodType<T>): T {
    let data: unknown;
    try {
      data = JSON.parse(body) as unknown;
    } catch {
      throw failure(call, 'answered with something that is not JSON', {
        kind: 'protocol',
      });
    }
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    // The paths only: a value could be a token.
    const at = [
      ...new Set(result.error.issues.map((i) => i.path.join('.') || '(the answer)')),
    ];
    throw failure(
      call,
      `answered something Mediaplane doesn't understand (at ${at.join(', ')})`,
      { kind: 'protocol' },
    );
  }

  async function get<T>(call: Call, schema: z.ZodType<T>): Promise<T> {
    return parsed(call, (await send(call)).body, schema);
  }

  return {
    async createPin(clientId) {
      const call: Call = {
        method: 'POST',
        path: '/api/v2/pins?strong=true',
        clientId,
        secrets: [],
      };
      const pin = parsed(call, (await send(call)).body, pinSchema);
      return { id: pin.id, code: pin.code, clientId, expiresIn: pin.expiresIn };
    },
    async waitForPin(pin, seconds) {
      const until = now() + seconds * 1000;
      const call: Call = {
        method: 'GET',
        path: `/api/v2/pins/${String(pin.id)}`,
        clientId: pin.clientId,
        secrets: [pin.code],
      };
      for (;;) {
        const answer = await send(call, (status) => status === 200 || status === 404);
        if (answer.status === 404) {
          throw failure(call, 'no longer knows the sign-in: its link ran out', {
            kind: 'expired',
            status: 404,
          });
        }
        const { authToken } = parsed(call, answer.body, pinSchema);
        if (authToken !== null && authToken !== '') return authToken;
        if (now() + pollMs > until) return undefined;
        await sleep(pollMs);
      }
    },
    async claimToken(token) {
      const call: Call = {
        method: 'GET',
        path: '/api/claim/token.json',
        token,
        secrets: [token],
      };
      const { token: claim } = await get(call, claimSchema);
      return claim;
    },
    async accountId(token) {
      const call: Call = { method: 'GET', path: '/api/v2/user', token, secrets: [token] };
      return (await get(call, userSchema)).id;
    },
  };
}
