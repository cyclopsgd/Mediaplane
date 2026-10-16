import { Agent, request } from 'node:http';
import type { z } from 'zod';
import { codeOf } from '../util/error-code';
import { foundSecrets, redact, type FoundSecrets } from '../util/redact';

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
  /**
   * For an `auth` refusal of an app found set up: Mediaplane couldn't tell whether the
   * app is its own (the question failed), rather than found it isn't.
   */
  readonly unsure: boolean;

  constructor(
    message: string,
    details: {
      kind: AppApiErrorKind;
      status?: number;
      transient?: boolean;
      reachedApp?: boolean;
      unsure?: boolean;
    },
  ) {
    super(message);
    this.kind = details.kind;
    this.status = details.status;
    this.transient = details.transient ?? false;
    this.reachedApp = details.reachedApp ?? true;
    this.unsure = details.unsure ?? false;
  }
}

/** One thing an app's own test of a setting found wrong (Servarr's validation list). */
export interface TestFailure {
  /** The setting it is about, as the app names it ("ApiKey", "Host"), or "". */
  property: string;
  /** What the app said, and its details: redacted, on one line, at most 200 characters. */
  message: string;
}

/**
 * How a request carries the key: the X-Api-Key header (Servarr), a Bearer token
 * (qBittorrent), Jellyfin's `Authorization: MediaBrowser …` header, whose client fields go
 * with every request, a token or not, or Plex's X-Plex-Token header.
 */
export type KeyScheme = 'x-api-key' | 'bearer' | 'mediabrowser' | 'x-plex-token';

/**
 * The client fields Jellyfin asks of every request in its MediaBrowser header: a sign-in
 * is refused without them. One device id, so a new sign-in ends the last one's session.
 */
const MEDIA_BROWSER =
  'MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"';

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
  /**
   * How requests carry the key, and the key itself, once Mediaplane has one: before its
   * first-run setup, Jellyfin has none, and is still called its own way.
   */
  key?: { scheme: KeyScheme; value?: string };
  /** A session's cookie, sent in place of the key: what a session client carries. */
  cookie?: { name: string; value: string };
  /**
   * Every secret value an answer could hold, replaced with *** in every message, in the
   * forms an app may echo it in (as it is, JSON-escaped, percent-encoded, form-encoded,
   * HTML-escaped). The client adds the key it sends and the password it signs in with.
   */
  secrets: readonly string[];
  /**
   * The run's FoundSecrets: a secret any of its clients reads in an answer is redacted by
   * this one too, from the moment it is added. Without it, the client keeps its own,
   * which the clients it makes (`session`, `withKey`) share.
   */
  found?: FoundSecrets;
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
  /**
   * POST or DELETE with the key, and a JSON body if given; any 2xx answer is success, and
   * its body isn't read (Jellyfin answers 204). A POST is sent again only when nothing
   * reached the app; a DELETE, like a GET.
   */
  submit(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void>;
  /** POST a JSON body with the key, and the JSON answer, checked with `schema`. */
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  /**
   * POST a form with the key, as qBittorrent's API takes one; any 2xx answer is success.
   * `secrets` are values the form sends, kept out of every message, listed or not.
   */
  form(
    path: string,
    fields: Readonly<Record<string, string>>,
    options?: { secrets?: readonly string[] },
  ): Promise<void>;
  /**
   * POST a JSON body with the key to an app's own test of a setting (Servarr's
   * `…/test`). A 2xx answer passes; a 400 is the app's verdict: the errors of its
   * validation list, never a warning, nor the value it was given; warnings alone pass.
   * Any other answer, or a 400 that isn't such a list (an empty one, or one with an item
   * without a message), throws as `post` would.
   */
  test(
    path: string,
    body: unknown,
  ): Promise<{ passed: boolean; failures: TestFailure[] }>;
  /**
   * POST a form, without the key and never following a redirect: an app's own sign-in
   * page. Its status and Location; its cookies are dropped. A 2xx or 3xx answer is the
   * answer, and so is any status in `answers` (qBittorrent's 401 for a wrong password).
   * Without `answers`, a sign-in is tried again like a GET (a starting app). With them, it
   * is sent like `post`, again only when nothing reached the app: an app that answers a
   * wrong password itself counts each failure towards a ban, and a resend after a timeout
   * or a 5xx could spend another.
   */
  login(
    path: string,
    fields: Readonly<Record<string, string>>,
    options?: { answers?: readonly number[] },
  ): Promise<{ status: number; location: string | undefined }>;
  /**
   * POST `fields` as JSON, without the key, to an app's own sign-in that answers JSON
   * (Jellyfin's): its answer, checked with `schema`, or undefined when the app refuses
   * the sign-in (401). Like `post`, it is sent again only when nothing reached the app.
   * `secrets` are values it sends, kept out of every message, listed or not.
   */
  signIn<T>(
    path: string,
    fields: Readonly<Record<string, unknown>>,
    schema: z.ZodType<T>,
    secrets: readonly string[],
  ): Promise<T | undefined>;
  /**
   * POST `fields` as JSON, without the key, to an app's own sign-in that keeps its session
   * in the cookie `cookie` (Seerr's `connect.sid`): the same app's API, carrying that
   * cookie in place of the key, for what only the session can do, such as signing out;
   * or undefined when the app refuses the sign-in (401). It is sent as `signIn` is, and
   * the cookie is kept out of every message, as `secrets`, the values it sends, are.
   */
  session(
    path: string,
    fields: Readonly<Record<string, unknown>>,
    cookie: string,
    secrets: readonly string[],
  ): Promise<AppApi | undefined>;
  /** Wait, until the deadline, for `path` to answer 200 without the key. */
  ready(path: string): Promise<void>;
  /**
   * GET `path` with the key (without it, when `anonymous`), checked with `schema`, again
   * and again until `done` says so of the answer or the deadline passes, waiting a little
   * longer each time, up to 2 s: the last answer, either way. For what an app finishes by
   * itself once it is ready, such as Plex claiming itself as it first starts.
   */
  until<T>(
    path: string,
    schema: z.ZodType<T>,
    done: (answer: T) => boolean,
    options?: { anonymous?: boolean },
  ): Promise<T>;
  /**
   * The same app's API, carrying `value` as its key, the way this one carries its own: a
   * session's token, say. It keeps `value` out of its messages.
   */
  withKey(value: string): AppApi;
  /**
   * Treat `value`, a secret read in the app's answer (a key it holds in clear), as one
   * of the run's: from now on, it is replaced with *** in every message of the run,
   * this client's and the others' that share its FoundSecrets.
   */
  addSecret(value: string): void;
}

interface Call {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  body?: { type: string; text: string };
  /** Without the API key. */
  anonymous?: boolean;
  /** Secrets this call sends, which the options don't list: a sign-in's password. */
  secrets?: readonly string[];
}

interface Answer {
  status: number;
  location: string | undefined;
  /** Each Set-Cookie header, as it came. */
  cookies: readonly string[];
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
 * The least an attempt may take near the deadline, in ms: a request needs a moment to
 * connect, and an app that answers in that moment shouldn't be missed by a hair.
 */
const MIN_ATTEMPT_MS = 250;

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
    // A clock that only moves forward: a change of the system's time can't cut a wait short.
    now: options.retry?.now ?? (() => performance.now()),
    random: options.retry?.random ?? Math.random,
  };
  const agent = new Agent({ keepAlive: false });
  const host = `${options.service}:${String(options.port)}`;
  const where = `http://${host} (${options.endpoint.host})`;
  // What the client sends is redacted whether or not the caller listed it.
  const sent = [
    ...(options.key?.value === undefined ? [] : [options.key.value]),
    ...(options.cookie === undefined ? [] : [options.cookie.value]),
  ];
  const found = options.found ?? foundSecrets();
  // Made again only once the run has found another secret.
  let always = { found: 0, clean: redactor([...options.secrets, ...sent]) };

  /**
   * Redacts `call`'s messages: the options' secrets, the ones this call sends, and those
   * the run has found by now.
   */
  function cleanFor(call: Call): (text: string) => string {
    if (call.secrets !== undefined) {
      return redactor([...options.secrets, ...sent, ...found.values, ...call.secrets]);
    }
    if (always.found !== found.values.length) {
      always = {
        found: found.values.length,
        clean: redactor([...options.secrets, ...sent, ...found.values]),
      };
    }
    return always.clean;
  }

  /** One attempt, of at most `limitMs`. Any status is an answer; a failed connection throws. */
  function attempt(call: Call, limitMs: number): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      const headers: Record<string, string> = {
        Host: host,
        'User-Agent': 'Mediaplane',
        Accept: 'application/json',
      };
      const key = call.anonymous ? undefined : options.key?.value;
      if (options.key?.scheme === 'mediabrowser') {
        headers.Authorization =
          key === undefined ? MEDIA_BROWSER : `${MEDIA_BROWSER}, Token="${key}"`;
      } else if (key !== undefined) {
        if (options.key?.scheme === 'bearer') headers.Authorization = `Bearer ${key}`;
        else if (options.key?.scheme === 'x-plex-token') headers['X-Plex-Token'] = key;
        else headers['X-Api-Key'] = key;
      }
      if (options.cookie !== undefined && !call.anonymous) {
        headers.Cookie = `${options.cookie.name}=${options.cookie.value}`;
      }
      if (call.body !== undefined) {
        headers['Content-Type'] = call.body.type;
        headers['Content-Length'] = String(Buffer.byteLength(call.body.text));
      }
      try {
        const req = request(
          {
            agent,
            host: options.endpoint.host,
            port: options.endpoint.port,
            method: call.method,
            path: call.path,
            headers,
            signal: AbortSignal.timeout(limitMs),
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
                cookies: res.headers['set-cookie'] ?? [],
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
            res.on('error', (cause) => {
              reject(connectionFailure(call, cause, limitMs));
            });
          },
        );
        req.on('error', (cause) => {
          reject(connectionFailure(call, cause, limitMs));
        });
        req.end(call.body?.text);
      } catch (cause) {
        // Node refuses to build the request: a header value with a newline in it, a path
        // with a space. Its message could quote the value; the code says enough.
        reject(
          failure(
            call,
            `could not make the request (${codeOf(cause) ?? 'no reason given'})`,
            { kind: 'protocol' },
          ),
        );
      }
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
      cleanFor(call)(`${options.name} at ${where} ${what} (${call.method} ${path})`),
      details,
    );
  }

  function connectionFailure(call: Call, cause: unknown, limitMs: number): AppApiError {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return failure(call, `did not answer within ${seconds(limitMs)} s`, {
        kind: 'timeout',
        transient: true,
      });
    }
    const code = codeOf(cause) ?? '';
    // Node's parser refused what the app sent (HPE_INVALID_CONSTANT…): not HTTP.
    if (code.startsWith('HPE_')) {
      return failure(call, `answered something that is not valid HTTP (${code})`, {
        kind: 'protocol',
      });
    }
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
    const clean = cleanFor(call);
    const said = appMessage(answer.body, clean);
    const message = said === undefined ? '' : `: ${clean(said)}`;
    if (status === 401 || status === 403) {
      // Without the key, the key isn't what was refused: a sign-in, say.
      const refused = call.anonymous ? 'the request' : "Mediaplane's API key";
      return failure(call, `refused ${refused} (HTTP ${String(status)})${message}`, {
        kind: 'auth',
        status,
      });
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
      // An attempt may take as long as one request may, but no longer than the time left
      // before the deadline: an app that hangs costs a caller its deadline, not a
      // deadline and a timeout.
      const left = retry.deadlineMs - (retry.now() - start);
      // A whole number of ms: the clock's are fractions, and a timer takes none.
      const limitMs = Math.ceil(Math.min(timeoutMs, Math.max(MIN_ATTEMPT_MS, left)));
      let error: AppApiError;
      try {
        const answer = await attempt(call, limitMs);
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
    // The paths only: a value could be a key, a password or its hash. A path can name a
    // key of the app's answer (a record's), so it is made plain too: redacted first, so
    // collapsing its whitespace can't hide a secret from the redaction.
    const clean = cleanFor(call);
    const at = [
      ...new Set(
        result.error.issues.map(
          (issue) => plain(clean(issue.path.join('.'))) || '(the answer)',
        ),
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
    async submit(method, path, body) {
      await send(
        { method, path, ...(body === undefined ? {} : { body: json(body) }) },
        method === 'DELETE',
      );
    },
    async post(path, body, schema) {
      const call: Call = { method: 'POST', path, body: json(body) };
      return parsed(call, await send(call, false), schema);
    },
    async form(path, fields, extra = {}) {
      await send(
        {
          method: 'POST',
          path,
          ...(extra.secrets === undefined ? {} : { secrets: extra.secrets }),
          body: {
            type: 'application/x-www-form-urlencoded',
            text: new URLSearchParams(fields).toString(),
          },
        },
        false,
      );
    },
    async test(path, body) {
      const call: Call = { method: 'POST', path, body: json(body) };
      const answer = await send(
        call,
        false,
        (a) => (a.status >= 200 && a.status < 300) || a.status === 400,
      );
      if (answer.status !== 400) return { passed: true, failures: [] };
      const failures = testFailures(answer.body, cleanFor(call));
      if (failures === undefined) throw statusFailure(call, answer);
      return { passed: failures.length === 0, failures };
    },
    async login(path, fields, extra = {}) {
      const answers = extra.answers ?? [];
      const call: Call = {
        method: 'POST',
        path,
        anonymous: true,
        // The field named `password` is a secret of this call, listed or not.
        secrets: fields.password === undefined ? [] : [fields.password],
        body: {
          type: 'application/x-www-form-urlencoded',
          text: new URLSearchParams(fields).toString(),
        },
      };
      // A redirect is the answer: where it leads says whether the login worked.
      const answer = await send(
        call,
        answers.length === 0,
        (a) => (a.status >= 200 && a.status < 400) || answers.includes(a.status),
      );
      return {
        status: answer.status,
        location:
          answer.location === undefined ? undefined : cleanFor(call)(answer.location),
      };
    },
    async signIn(path, fields, schema, secrets) {
      const call: Call = {
        method: 'POST',
        path,
        anonymous: true,
        secrets,
        body: json(fields),
      };
      const answer = await send(
        call,
        false,
        (a) => (a.status >= 200 && a.status < 300) || a.status === 401,
      );
      return answer.status === 401 ? undefined : parsed(call, answer, schema);
    },
    async session(path, fields, cookie, secrets) {
      const call: Call = {
        method: 'POST',
        path,
        anonymous: true,
        secrets,
        body: json(fields),
      };
      const answer = await send(
        call,
        false,
        (a) => (a.status >= 200 && a.status < 300) || a.status === 401,
      );
      if (answer.status === 401) return undefined;
      const value = cookieOf(answer.cookies, cookie);
      if (value === undefined) {
        throw failure(call, `signed in, but set no ${cookie} cookie`, {
          kind: 'protocol',
        });
      }
      // The run redacts the cookie from now on, in the form Seerr sets (`s%3A…`) and
      // decoded (`s:…`), whichever client or catalog error quotes it.
      found.add(value);
      found.add(decoded(value));
      return createAppApi({
        ...options,
        found,
        secrets: [...options.secrets, ...sent, ...secrets],
        key: { scheme: options.key?.scheme ?? 'x-api-key' },
        cookie: { name: cookie, value },
      });
    },
    async ready(path) {
      // A starting app answers 503, or nothing: both are tried again until the deadline.
      await send(
        { method: 'GET', path, anonymous: true },
        true,
        (answer) => answer.status === 200,
      );
    },
    async until(path, schema, done, how = {}) {
      const start = retry.now();
      const call: Call = { method: 'GET', path, anonymous: how.anonymous === true };
      for (let tries = 0; ; tries++) {
        const answer = parsed(call, await send(call, true), schema);
        if (done(answer)) return answer;
        const delay = Math.min(2_000, 250 * 2 ** tries);
        if (retry.now() + delay - start > retry.deadlineMs) return answer;
        await retry.sleep(delay);
      }
    },
    withKey: (value) =>
      createAppApi({
        // The key only: a session's cookie is not carried over (it stays redacted).
        ...withoutCookie(options),
        found,
        // The key it replaces stays out of what it says too.
        secrets: [...options.secrets, ...sent],
        key: { scheme: options.key?.scheme ?? 'x-api-key', value },
      }),
    addSecret: (value) => {
      found.add(value);
    },
  };
}

/** `options` without its session cookie. */
function withoutCookie(options: AppApiOptions): AppApiOptions {
  const rest = { ...options };
  delete rest.cookie;
  return rest;
}

/** `value` percent-decoded, or as it is when it isn't validly encoded. */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The value of the cookie `name` among Set-Cookie headers, if one sets it to something. */
function cookieOf(headers: readonly string[], name: string): string | undefined {
  for (const header of headers) {
    const [pair = ''] = header.split(';');
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) {
      const value = pair.slice(at + 1).trim();
      if (value !== '') return value;
    }
  }
  return undefined;
}

function toValues(secrets: readonly string[]): Record<string, string> {
  return Object.fromEntries(secrets.map((value, index) => [String(index), value]));
}

/**
 * The ways an app may write `secret` into an answer: as it is; JSON-escaped (inside a
 * quoted string, or a message that quotes JSON); percent-encoded (a URL, a Location);
 * form-encoded (a sign-in form echoed back; a space is a +), both in upper- or lowercase
 * hex (.NET's `HttpUtility.UrlEncode` writes `%5b`); and HTML-escaped (an error page),
 * where apps differ in how they write a quote (`&quot;`, `&#34;`, or as it is) and an
 * apostrophe (`&#39;`, `&#x27;`, or as it is).
 *
 * Each of those is also written for the JSON-escaped secret, when that differs: it is
 * what a secret sent JSON-escaped inside a form field (qBittorrent's `setPreferences`)
 * or quoted in a page looks like once the field is form-encoded or the page escaped.
 */
function formsOf(secret: string): string[] {
  const escaped = JSON.stringify(secret).slice(1, -1);
  return [
    ...new Set([
      ...encodingsOf(secret),
      ...(escaped === secret ? [] : encodingsOf(escaped)),
    ]),
  ];
}

/** `text` as it is, percent-encoded, form-encoded (both in either hex case) and HTML-escaped. */
function encodingsOf(text: string): string[] {
  const html = (quote: string, apostrophe: string) =>
    text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', quote)
      .replaceAll("'", apostrophe);
  const lowerHex = (encoded: string) =>
    encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
  const percent = encodeURIComponent(text);
  const form = new URLSearchParams({ v: text }).toString().slice(2);
  return [
    text,
    percent,
    lowerHex(percent),
    form,
    lowerHex(form),
    ...['&quot;', '&#34;', '"'].flatMap((quote) =>
      ['&#39;', '&#x27;', "'"].map((apostrophe) => html(quote, apostrophe)),
    ),
  ];
}

/**
 * Replaces every secret, in each of its forms, with ***. The forms are deduplicated, and
 * `redact` replaces the longest first, so a form that holds another is replaced whole.
 */
function redactor(secrets: readonly string[]): (text: string) => string {
  const forms = [...new Set(secrets.filter((s) => s !== '').flatMap(formsOf))];
  const values = toValues(forms);
  return (text) => redact(text, values);
}

/** Milliseconds as seconds, to the hundredth: 50 is 0.05, 30000 is 30. */
function seconds(ms: number): string {
  return String(Math.round(ms / 10) / 100);
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
 * `attemptedValue`, which can be the very password that was refused.
 *
 * The order is what keeps a secret out. JSON is parsed from the body as it came, since
 * redacting it first can break it (a password ending in a backslash, found at the end of
 * `fake-pw\"`); only text is redacted before it is read. Then `clean` takes the secrets
 * out of the message once it is read (a JSON escape such as \" appears only once parsed),
 * the control characters become spaces, the whitespace collapses, `clean` runs again
 * (taking the HTML out and collapsing can put a secret together), and only then is the
 * message cut, which would split a secret still in it. Callers redact the whole message
 * once more.
 */
export function appMessage(
  body: string,
  clean: (text: string) => string,
): string | undefined {
  const json = parseJson(body);
  const said =
    json === undefined
      ? clean(body)
          .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
      : jsonMessage(json.value);
  if (said === undefined) return undefined;
  const message = oneLine(said, clean);
  return message === '' ? undefined : message;
}

/**
 * What an app said, safe to show: redacted, on one plain line (redacted again, since
 * collapsing it can put a secret together), and only then cut to MESSAGE_LIMIT.
 */
function oneLine(said: string, clean: (text: string) => string): string {
  const message = clean(plain(clean(said)));
  return message.length > MESSAGE_LIMIT
    ? `${message.slice(0, MESSAGE_LIMIT - 1)}…`
    : message;
}

/**
 * The errors of Servarr's validation list, from a test's answer: each one's property, and
 * its message with its details, made safe as appMessage makes a message. A warning is
 * not an error, and an `attemptedValue` is never read. Undefined for an answer that
 * isn't such a list: an empty one, or one with anything but items with a message, which
 * would otherwise read as a pass.
 */
function testFailures(
  body: string,
  clean: (text: string) => string,
): TestFailure[] | undefined {
  const json = parseJson(body);
  if (json === undefined || !Array.isArray(json.value) || json.value.length === 0) {
    return undefined;
  }
  const failures: TestFailure[] = [];
  for (const item of json.value as unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { propertyName, errorMessage, detailedDescription, isWarning } = item as Record<
      string,
      unknown
    >;
    if (typeof errorMessage !== 'string') return undefined;
    if (isWarning === true) continue;
    const details =
      typeof detailedDescription === 'string' && detailedDescription !== ''
        ? ` (${detailedDescription})`
        : '';
    failures.push({
      property: typeof propertyName === 'string' ? oneLine(propertyName, clean) : '',
      message: oneLine(`${errorMessage}${details}`, clean),
    });
  }
  return failures;
}

function parseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * One line of plain text: each control character (ESC, a newline, a carriage return…, DEL
 * and the C1 range) becomes a space, so an app's answer can't move a terminal's cursor or
 * change its colours, and runs of whitespace collapse.
 */
function plain(text: string): string {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
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
