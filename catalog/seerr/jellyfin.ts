import { z } from 'zod';

/** Seerr's Jellyfin settings (`GET /api/v1/settings/jellyfin`), its key in clear. */
export const jellyfinSettings = z.looseObject({
  ip: z.string(),
  port: z.number(),
  useSsl: z.boolean(),
  urlBase: z.string(),
  apiKey: z.string(),
});

type Held = Pick<z.infer<typeof jellyfinSettings>, 'ip' | 'port' | 'useSsl' | 'urlBase'>;

/**
 * Whether Seerr's Jellyfin is the stack's, at `at`: Seerr reaches Jellyfin at
 * `http(s)://<ip>:<port><urlBase>` (its `getHostname`), so the stack's `ip` and `port`
 * are not enough. TLS, or any URL base, is another address: `@<host>` in `urlBase` takes
 * Seerr to that host.
 */
export function atStackJellyfin(held: Held, at: { host: string; port: number }): boolean {
  return (
    held.ip === at.host && held.port === at.port && !held.useSsl && held.urlBase === ''
  );
}

/**
 * Where Seerr reaches Jellyfin, as one host to compare: its `ip`, or, with TLS or a URL
 * base, the whole URL Seerr builds from them, which is never the stack's service.
 */
export function heldHost(held: Held): string {
  if (!held.useSsl && held.urlBase === '') return held.ip;
  return `${held.useSsl ? 'https' : 'http'}://${held.ip}:${String(held.port)}${held.urlBase}`;
}
