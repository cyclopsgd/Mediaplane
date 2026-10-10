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

/** Whether `url` can be an egress check's: an http or https URL. */
export function isEgressUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Ask the IP-echo service at `url` which address this machine comes from. */
export async function fetchEgress(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = EGRESS_TIMEOUT_MS,
): Promise<EgressResult> {
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
