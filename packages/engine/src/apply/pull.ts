import { setTimeout as delay } from 'node:timers/promises';
import type { Runtime } from '../runtime/types';

/** How long apply waits before each retry of a pull that failed with a temporary error. */
export const PULL_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000];

/**
 * Registry errors that usually pass, as Docker prints them: a slow or dropped connection,
 * a registry that is briefly down, or a rate limit (spec §5.1).
 */
const TRANSIENT_PULL_ERRORS: readonly RegExp[] = [
  /TLS handshake timeout/i,
  /i\/o timeout/i,
  /connection reset by peer/i,
  /unexpected EOF/i,
  /Client\.Timeout exceeded/i,
  /toomanyrequests|Too Many Requests/i,
  /\b(?:500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/i,
];

/**
 * Registry errors that waiting won't fix: a missing image, a refused login, or a name
 * that doesn't resolve.
 */
const PERMANENT_PULL_ERRORS: readonly RegExp[] = [
  /manifest unknown/i,
  // HTTP 404 Not Found too.
  /not found/i,
  // "pull access denied", and "requested access to the resource is denied".
  /denied/i,
  // HTTP 401 Unauthorized too.
  /unauthorized/i,
  /\b403 Forbidden\b/i,
  /no such host/i,
  /invalid reference format/i,
];

/**
 * Whether a failed pull is worth trying again: a temporary error, and nothing that waiting
 * won't fix. Compose prints one line per image, so a pull can fail both ways at once.
 */
export function isTransientPullError(message: string): boolean {
  return (
    TRANSIENT_PULL_ERRORS.some((pattern) => pattern.test(message)) &&
    !PERMANENT_PULL_ERRORS.some((pattern) => pattern.test(message))
  );
}

/**
 * `compose pull`, tried again after a temporary registry error, up to three times. It
 * pulls only what is missing, so a retry repeats no finished download. Returns the pull
 * step's detail, and throws with Compose's error when the pull fails for good.
 */
export async function pullImages(
  runtime: Runtime,
  values: Record<string, string>,
  sleep: (ms: number) => Promise<unknown> = delay,
): Promise<string> {
  for (let retries = 0; ; retries++) {
    const result = await runtime.pull(values);
    if (result.ok) {
      if (retries === 0) return 'images present';
      return `images present, after ${retries} ${retries === 1 ? 'retry' : 'retries'}`;
    }
    if (!isTransientPullError(result.error)) throw new Error(result.error);
    const wait = PULL_RETRY_DELAYS_MS[retries];
    if (wait === undefined) {
      throw new Error(
        `docker compose pull failed ${retries + 1} times with a temporary registry error; the last one: ${result.error}`,
      );
    }
    await sleep(wait);
  }
}
