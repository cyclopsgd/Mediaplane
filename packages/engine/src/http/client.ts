import { Agent, request } from 'node:http';
import type { z } from 'zod';
import { codeOf } from '../util/error-code';
import { redact } from '../util/redact';

/** How long one request may take, in ms. */
export const HTTP_TIMEOUT_MS = 30_000;

/** The most of an answer Mediaplane reads, in bytes. */
export const HTTP_MAX_BYTES = 5 * 1024 * 1024;

/** How long an app may keep failing transiently before Mediaplane gives up, in ms. */
export const APP_DEADLINE_MS = 120_000;

/**
 * Why an app's API call failed:
 * - `unreachable`: nothing answered (refused, no route, reset);
 * - `timeout`: no answer in time;
 * - `auth`: the app refused Mediaplane's key (401, 403);
 * - `rejected`: the app refused the request itself (another 4xx), with its message;
 * - `server`: the app failed (5xx);
 * - `protocol`: it answered, but not with something Mediaplane understands.
 */
export type AppApiErrorKind =
  'unreachable' | 'timeout' | 'auth' | 'rejected' | 'server' | 'protocol';

/**
 * An app's API call that failed, said for the user: which app, where, what, and the app's
 * own message. It never holds a secret, a request body or a query string.
 */
export class AppApiError extends Error {
  override readonly name = 'AppApiError';
  readonly kind: AppApiErrorKind;
  readonly status: number | undefined;
  /** Worth trying again: a refused connection, a timeout, 502, 503 or 504. */
  readonly transient: boolean;
  /** Whether the request may have reached the app: false only for a refused connection. */
  readonly reachedApp: boolean;

  constructor(
    message: string,
    details: {
      kind: AppApiErrorKind;
      status?: number;
      transient?: boolean;
      reachedApp?: boolean;
    },
  ) {
    super(message);
    this.kind = details.kind;
    this.status = details.status;
    this.transient = details.transient ?? false;
    this.reachedApp = details.reachedApp ?? true;
  }
}

/** Where to connect: the container's address, and its port. */
export interface Endpoint {
  host: string;
  port: number;
}

/** How a failing call is tried again; tests pass a clock and a sleep of their own. */
export interface RetryOptions {
  deadlineMs: number;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  /** A number in [0, 1): the jitter. */
  random: () => number;
}

export interface AppApiOptions {
  /** The app's name, for messages: "Sonarr". */
  name: string;
  /** Its Compose service: the Host header, and the address in messages. */
  service: string;
  /** Its container port: the Host header's port, which qBittorrent checks. */
  port: number;
  endpoint: Endpoint;
  key?: { scheme: 'x-api-key' | 'bearer'; value: string };
  /** Every secret value an answer could hold, replaced with *** in every message. */
  secrets: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  retry?: Partial<RetryOptions>;
}

/** One app's API, as Mediaplane calls it (spec §5.1, §6.1). */
export interface AppApi {
  /** "Sonarr". */
  readonly name: string;
  /** Where it was reached: "http://sonarr:8989 (172.20.0.3)". */
  readonly where: string;
  /** GET with the key, and the JSON answer, checked with `schema`. */
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  /** GET with the key, for a 2xx answer only: whatever its body, it isn't read. */
  check(path: string): Promise<void>;
  /** PUT a JSON body with the key; any 2xx answer is success. */
  put(path: string, body: unknown): Promise<void>;
  /** POST a JSON body with the key, and the JSON answer, checked with `schema`. */
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  /**
   * POST a form, without the key and never following a redirect: an app's own sign-in
   * page. Its status and Location; its cookies are dropped.
   */
  login(
    path: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<{ status: number; location: string | undefined }>;
  /** Wait, until the deadline, for `path` to answer 200 without the key. */
  ready(path: string): Promise<void>;
}

interface Call {
  method: 'GET' | 'PUT' | 'POST';
  path: string;
  body?: { type: string; text: string };
  /** Without the API key. */
  anonymous?: boolean;
}

interface Answer {
  status: number;
  location: string | undefined;
  body: string;
}

const TRANSIENT_STATUS = new Set([502, 503, 504]);

/** Connection errors that mean nothing reached the app. */
const NOT_SENT = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Connection errors after which the app may have seen the request. */
const CUT_OFF = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

/**
 * A client for one app's API. It goes straight to the container, through an agent of its
 * own: Node's global agent can send requests through a proxy from the environment
 * (NODE_USE_ENV_PROXY), which would hand the proxy the API key. It sends
 * `Host: <service>:<port>`, as the other apps of the stack do, which the apps' allowed
 * hosts and qBittorrent's Host check accept.
 */
export function createAppApi(options: AppApiOptions): AppApi {
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? HTTP_MAX_BYTES;
  const retry: RetryOptions = {
    deadlineMs: options.retry?.deadlineMs ?? APP_DEADLINE_MS,
    sleep:
      options.retry?.sleep ??
      ((ms) =>
        new Promise((done) => {
          setTimeout(done, ms);
        })),
    now: options.retry?.now ?? Date.now,
    random: options.retry?.random ?? Math.random,
  };
  const agent = new Agent({ keepAlive: false });
  const host = `${options.service}:${String(options.port)}`;
  const where = `http://${host} (${options.endpoint.host})`;
  const clean = (text: string) => redact(text, toValues(options.secrets));

  /** One attempt. Any status is an answer; a failed connection throws. */
  function attempt(call: Call): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      const headers: Record<string, string> = {
        Host: host,
        'User-Agent': 'Mediaplane',
        Accept: 'application/json',
      };
      if (!call.anonymous && options.key !== undefined) {
        if (options.key.scheme === 'bearer') {
          headers.Authorization = `Bearer ${options.key.value}`;
        } else {
          headers['X-Api-Key'] = options.key.value;
        }
      }
      if (call.body !== undefined) {
        headers['Content-Type'] = call.body.type;
        headers['Content-Length'] = String(Buffer.byteLength(call.body.text));
      }
      const req = request(
        {
          agent,
          host: options.endpoint.host,
          port: options.endpoint.port,
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
            if (size > maxBytes) {
              res.destroy();
              reject(
                failure(call, `answered more than ${sizeOf(maxBytes)}`, {
                  kind: 'protocol',
                }),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location,
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
      req.end(call.body?.text);
    });
  }

  /** `what` failed on this call: the message names the app, where, the method and path. */
  function failure(
    call: Call,
    what: string,
    details: ConstructorParameters<typeof AppApiError>[1],
  ): AppApiError {
    const path = call.path.split('?')[0] ?? call.path;
    return new AppApiError(
      clean(`${options.name} at ${where} ${what} (${call.method} ${path})`),
      details,
    );
  }

  function connectionFailure(call: Call, cause: unknown): AppApiError {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return failure(call, `did not answer within ${String(timeoutMs / 1000)} s`, {
        kind: 'timeout',
        transient: true,
      });
    }
    const code = codeOf(cause) ?? '';
    if (NOT_SENT.has(code)) {
      return failure(call, `could not be reached (${code})`, {
        kind: 'unreachable',
        transient: true,
        reachedApp: false,
      });
    }
    return failure(
      call,
      `cut the connection (${code === '' ? 'no reason given' : code})`,
      { kind: 'unreachable', transient: CUT_OFF.has(code) || code === '' },
    );
  }

  /** What a non-2xx answer means. */
  function statusFailure(call: Call, answer: Answer): AppApiError {
    const { status } = answer;
    const said = appMessage(answer.body, clean);
    const message = said === undefined ? '' : `: ${clean(said)}`;
    if (status === 401 || status === 403) {
      return failure(
        call,
        `refused Mediaplane's API key (HTTP ${String(status)})${message}`,
        {
          kind: 'auth',
          status,
        },
      );
    }
    if (status >= 500) {
      return failure(call, `failed (HTTP ${String(status)})${message}`, {
        kind: 'server',
        status,
        transient: TRANSIENT_STATUS.has(status),
      });
    }
    if (status >= 400) {
      return failure(call, `refused the request (HTTP ${String(status)})${message}`, {
        kind: 'rejected',
        status,
      });
    }
    return failure(call, `answered HTTP ${String(status)}, not a success`, {
      kind: 'protocol',
      status,
    });
  }

  /**
   * `call` until it succeeds, or until the deadline for a transient failure. Only an
   * idempotent call is tried again after the app may have seen it.
   */
  async function send(
    call: Call,
    idempotent: boolean,
    ok: (answer: Answer) => boolean = (answer) =>
      answer.status >= 200 && answer.status < 300,
  ): Promise<Answer> {
    const start = retry.now();
    for (let tries = 0; ; tries++) {
      let error: AppApiError;
      try {
        const answer = await attempt(call);
        if (ok(answer)) return answer;
        error = statusFailure(call, answer);
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw cause;
        error = cause;
      }
      const again = error.transient && (idempotent || !error.reachedApp);
      // Full jitter: a random wait up to an exponential cap, so apps that come back at
      // once aren't all asked at once.
      const delay = retry.random() * Math.min(10_000, 500 * 2 ** tries);
      if (!again || retry.now() + delay - start > retry.deadlineMs) {
        if (again) {
          throw new AppApiError(
            `${error.message}, and still did after ${String(Math.round((retry.now() - start) / 1000))} s`,
            {
              kind: error.kind,
              ...(error.status === undefined ? {} : { status: error.status }),
              transient: true,
              reachedApp: error.reachedApp,
            },
          );
        }
        throw error;
      }
      await retry.sleep(delay);
    }
  }

  function parsed<T>(call: Call, answer: Answer, schema: z.ZodType<T>): T {
    let data: unknown;
    try {
      data = JSON.parse(answer.body) as unknown;
    } catch {
      throw failure(call, 'answered with something that is not JSON', {
        kind: 'protocol',
      });
    }
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    // The paths only: a value could be a key, a password or its hash.
    const at = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join('.') || '(the answer)'),
      ),
    ];
    throw failure(
      call,
      `answered something Mediaplane doesn't understand (at ${at.join(', ')})`,
      { kind: 'protocol' },
    );
  }

  const json = (body: unknown) => ({
    type: 'application/json',
    text: JSON.stringify(body),
  });

  return {
    name: options.name,
    where,
    async get(path, schema) {
      const call: Call = { method: 'GET', path };
      return parsed(call, await send(call, true), schema);
    },
    async check(path) {
      await send({ method: 'GET', path }, true);
    },
    async put(path, body) {
      await send({ method: 'PUT', path, body: json(body) }, true);
    },
    async post(path, body, schema) {
      const call: Call = { method: 'POST', path, body: json(body) };
      return parsed(call, await send(call, false), schema);
    },
    async login(path, fields) {
      const call: Call = {
        method: 'POST',
        path,
        anonymous: true,
        body: {
          type: 'application/x-www-form-urlencoded',
          text: new URLSearchParams(fields).toString(),
        },
      };
      // A redirect is the answer: where it leads says whether the login worked.
      const answer = await send(call, true, (a) => a.status >= 200 && a.status < 400);
      return { status: answer.status, location: answer.location };
    },
    async ready(path) {
      // A starting app answers 503, or nothing: both are tried again until the deadline.
      await send(
        { method: 'GET', path, anonymous: true },
        true,
        (answer) => answer.status === 200,
      );
    },
  };
}

function toValues(secrets: readonly string[]): Record<string, string> {
  return Object.fromEntries(secrets.map((value, index) => [String(index), value]));
}

/** A size limit, in the largest unit it is a whole number of: MiB, KiB, or bytes. */
function sizeOf(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${String(bytes / 1024 / 1024)} MiB`;
  if (bytes % 1024 === 0) return `${String(bytes / 1024)} KiB`;
  return `${String(bytes)} bytes`;
}

/** At most this much of an app's own message is shown. */
const MESSAGE_LIMIT = 200;

/**
 * What an app said about a refused request, from its answer's body: Servarr's validation
 * list (`[{propertyName, errorMessage}]`), ASP.NET's problem details (`{title, errors}`),
 * a `{message}`, or plain text such as qBittorrent's or an HTML error page. Never an
 * `attemptedValue`, which can be the very password that was refused. `clean` takes the
 * secrets out before anything else changes the text, and again after the HTML is taken
 * out and the whitespace collapsed (which can put one together), and always before the
 * cut: a secret that the whitespace collapse changed, or the cut split, would no longer
 * be found whole. Callers redact the whole message once more.
 */
export function appMessage(
  body: string,
  clean: (text: string) => string = (text) => text,
): string | undefined {
  const raw = clean(body);
  let message: string | undefined;
  try {
    const said = jsonMessage(JSON.parse(raw) as unknown);
    // A secret written with JSON escapes, such as \" or \u0020, appears only once parsed.
    message = said === undefined ? undefined : clean(said);
  } catch {
    // Taking the tags out and collapsing the whitespace can put a secret together that
    // the raw text didn't hold: redact again before the cut can split it.
    message = clean(
      raw
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  if (message === undefined || message === '') return undefined;
  return message.length > MESSAGE_LIMIT
    ? `${message.slice(0, MESSAGE_LIMIT - 1)}…`
    : message;
}

function jsonMessage(data: unknown): string | undefined {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  if (Array.isArray(data)) {
    const parts = data.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const { propertyName, errorMessage } = item as Record<string, unknown>;
      const said = text(errorMessage);
      if (said === undefined) return [];
      const field = text(propertyName);
      return [field === undefined || field === '' ? said : `${field}: ${said}`];
    });
    return parts.length === 0 ? undefined : parts.join('; ');
  }
  if (typeof data !== 'object' || data === null) return text(data);
  const { title, errors, message } = data as Record<string, unknown>;
  if (text(title) !== undefined) {
    const details =
      typeof errors === 'object' && errors !== null
        ? Object.entries(errors as Record<string, unknown>).flatMap(([field, said]) =>
            Array.isArray(said)
              ? said.flatMap((s: unknown) =>
                  text(s) === undefined ? [] : [`${field}: ${String(s)}`],
                )
              : [],
          )
        : [];
    return [text(title), ...details].join('; ');
  }
  return text(message);
}
