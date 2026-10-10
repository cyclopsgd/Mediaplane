import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../runtime/types';
import { fakeRuntime } from '../testing/fakes';
import { isTransientPullError, PULL_RETRY_DELAYS_MS, pullImages } from './pull';

const TLS: CommandResult = {
  ok: false,
  error: 'Get "https://registry.test/v2/": net/http: TLS handshake timeout',
};

/** A sleep that returns at once and records how long it was asked to wait. */
function sleeper(): { slept: number[]; sleep: (ms: number) => Promise<void> } {
  const slept: number[] = [];
  return {
    slept,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

describe('isTransientPullError', () => {
  it.each([
    'Get "https://lscr.io/v2/": net/http: TLS handshake timeout',
    'dial tcp 192.0.2.1:443: i/o timeout',
    'read tcp 10.0.0.2:51234->192.0.2.1:443: read: connection reset by peer',
    'unexpected EOF',
    'net/http: request canceled (Client.Timeout exceeded while awaiting headers)',
    'toomanyrequests: You have reached your pull rate limit.',
    'received unexpected HTTP status: 429 Too Many Requests',
    'received unexpected HTTP status: 503 Service Unavailable',
    'received unexpected HTTP status: 502 Bad Gateway',
    'received unexpected HTTP status: 500 Internal Server Error',
    'received unexpected HTTP status: 504 Gateway Timeout',
    // nginx's and Cloudflare's spelling.
    'received unexpected HTTP status: 504 Gateway Time-out',
  ])('retries "%s"', (message) => {
    expect(isTransientPullError(message)).toBe(true);
  });

  it.each([
    'manifest unknown: manifest unknown',
    'pull access denied for registry.test/fake, repository does not exist',
    'dial tcp: lookup registry.test: no such host',
    'fake registry unreachable',
    'unauthorized: authentication required',
    'failed to resolve reference "registry.test/fake:1": registry.test/fake:1: not found',
    'unexpected status from HEAD request to https://registry.test/v2/fake/manifests/1: 404 Not Found',
    'unexpected status from HEAD request to https://registry.test/v2/fake/manifests/1: 403 Forbidden',
    'invalid reference format',
  ])('does not retry "%s"', (message) => {
    expect(isTransientPullError(message)).toBe(false);
  });

  it('does not retry a temporary error mixed with one that waiting will not fix', () => {
    const mixed = [
      'sonarr Error Get "https://lscr.io/v2/": net/http: TLS handshake timeout',
      'radarr Error manifest unknown: manifest unknown',
    ].join('\n');
    expect(isTransientPullError(mixed)).toBe(false);
  });
});

describe('pullImages', () => {
  it('pulls once when the first pull works', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    expect(await pullImages(fakeRuntime({ calls }), {}, sleep)).toBe('images present');
    expect(calls).toEqual(['pull']);
    expect(slept).toEqual([]);
  });

  it('tries again after a temporary registry error, waiting longer each time', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    const runtime = fakeRuntime({ calls, pull: [TLS, TLS, { ok: true }] });
    expect(await pullImages(runtime, {}, sleep)).toBe('images present, after 2 retries');
    expect(calls).toEqual(['pull', 'pull', 'pull']);
    expect(slept).toEqual([5_000, 15_000]);
  });

  it('gives up after three retries, with the last error', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    await expect(
      pullImages(fakeRuntime({ calls, pull: TLS }), {}, sleep),
    ).rejects.toThrow(
      'docker compose pull failed 4 times with a temporary registry error; the last one: Get "https://registry.test/v2/": net/http: TLS handshake timeout',
    );
    expect(calls).toHaveLength(4);
    expect(slept).toEqual([...PULL_RETRY_DELAYS_MS]);
  });

  it('never retries an error that waiting will not fix', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    const runtime = fakeRuntime({
      calls,
      pull: { ok: false, error: 'manifest unknown' },
    });
    await expect(pullImages(runtime, {}, sleep)).rejects.toThrow(/^manifest unknown$/);
    expect(calls).toEqual(['pull']);
    expect(slept).toEqual([]);
  });
});
