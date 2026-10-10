import { isIP } from 'node:net';

/**
 * Where vpn-check asks "which address do I come from?" by default: Cloudflare's trace, by
 * IP, so no DNS is needed. Cloudflare is already Gluetun's own DNS-over-TLS resolver.
 */
export const DEFAULT_VPN_CHECK_URL = 'https://1.1.1.1/cdn-cgi/trace';

/** How long each side of the egress check waits for an answer, in ms. */
export const EGRESS_TIMEOUT_MS = 10_000;

/** The most of an answer either side reads, in bytes: a trace is a few hundred. */
export const EGRESS_MAX_BYTES = 16_384;

/** The address an IP-echo service saw, or why there is none. */
export type EgressResult = { ok: true; address: string } | { ok: false; error: string };

/**
 * The caller's address in an IP-echo service's answer: an `ip=` line, as Cloudflare's
 * /cdn-cgi/trace gives it, or an answer that is only an address, as plain-text services
 * give it. Undefined when there is no valid IPv4 or IPv6 address.
 */
export function egressAddress(answer: string): string | undefined {
  const text = answer.slice(0, EGRESS_MAX_BYTES);
  const candidate = (/^ip=(.*)$/m.exec(text)?.[1] ?? text).trim();
  return isIP(candidate) === 0 ? undefined : candidate;
}

/**
 * Whether `url` can be an egress check's: an http or https URL, without a user name or
 * password (fetch refuses those, and its error would repeat the password).
 */
export function isEgressUrl(url: string): boolean {
  try {
    const { protocol, username, password } = new URL(url);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      username === '' &&
      password === ''
    );
  } catch {
    return false;
  }
}

/** What can send Node's own fetch through a proxy: as in `process`, which is the default. */
export interface NodeSettings {
  env: NodeJS.ProcessEnv;
  /** Node's own command-line flags, as `process.execArgv` has them. */
  execArgv: readonly string[];
}

/**
 * The setting that would send Node's own fetch through HTTP(S)_PROXY (Node 24), or
 * undefined: NODE_USE_ENV_PROXY, or --use-env-proxy in NODE_OPTIONS or on node's own
 * command line. The address it sees would then be the proxy's, not this host's, so a leak
 * would read as a pass.
 */
function envProxySetting({ env, execArgv }: NodeSettings): string | undefined {
  const use = env.NODE_USE_ENV_PROXY ?? '';
  if (use !== '' && use !== '0') return 'NODE_USE_ENV_PROXY';
  // Anywhere in the text, quoted or not: NODE_OPTIONS may quote it.
  if (
    [env.NODE_OPTIONS ?? '', ...execArgv].some((arg) => arg.includes('--use-env-proxy'))
  ) {
    return '--use-env-proxy';
  }
  return undefined;
}

/**
 * Ask the IP-echo service at `url` which address this machine comes from. Refuses to ask
 * when `node` (the process's environment and flags) makes fetch use a proxy: the answer
 * would not be this host's.
 */
export async function fetchEgress(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = EGRESS_TIMEOUT_MS,
  node: NodeSettings = process,
): Promise<EgressResult> {
  const proxy = envProxySetting(node);
  if (proxy !== undefined) {
    return {
      ok: false,
      error: `the request would go through a proxy (${proxy}), so it can't see this host's own address`,
    };
  }
  let answer: string;
  try {
    const response = await fetchFn(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, error: `${url} answered HTTP ${String(response.status)}` };
    }
    answer = await readCapped(response, EGRESS_MAX_BYTES);
  } catch (cause) {
    return { ok: false, error: `no answer from ${url}: ${reason(cause, timeoutMs)}` };
  }
  const address = egressAddress(answer);
  return address === undefined
    ? { ok: false, error: `${url} answered without an address` }
    : { ok: true, address };
}

/** The first `max` bytes of a response's body, as text; the rest is never read. */
async function readCapped(response: Response, max: number): Promise<string> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
    response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

/** Why a fetch failed, in words: undici keeps the network error in `cause`. */
function reason(cause: unknown, timeoutMs: number): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return `nothing within ${String(timeoutMs / 1000)} s`;
  }
  const inner = cause instanceof Error ? cause.cause : undefined;
  if (inner instanceof Error) return inner.message;
  return cause instanceof Error ? cause.message : String(cause);
}
