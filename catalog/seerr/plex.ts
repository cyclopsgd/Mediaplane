import { z } from 'zod';

/**
 * Seerr's Plex settings (`GET /api/v1/settings/plex`): where it reaches Plex, which it does
 * with the token its admin signed in with, never a key in these settings.
 */
export const plexSettings = z.looseObject({
  ip: z.string(),
  port: z.number(),
  useSsl: z.boolean(),
});

type Held = z.infer<typeof plexSettings>;

/**
 * Whether Seerr's Plex is the stack's, at `at`: Seerr reaches Plex at
 * `http(s)://<ip>:<port>` (its Plex client), with no URL base, so TLS is another address.
 */
export function atStackPlex(held: Held, at: { host: string; port: number }): boolean {
  return held.ip === at.host && held.port === at.port && !held.useSsl;
}

/**
 * Where Seerr reaches Plex, as one host to compare: its `ip`, or, with TLS, the URL Seerr
 * builds, which is never the stack's service.
 */
export function heldPlexHost(held: Held): string {
  return held.useSsl ? `https://${held.ip}:${String(held.port)}` : held.ip;
}
