import type { DesiredResource } from '@mediaplane/engine';

/**
 * The secret `name` that `desired` holds, to send in clear in a request body: one app's
 * key, given to another, or a password set in qBittorrent. desired() gives it whenever it
 * wants the resource.
 */
export function secretOf(desired: DesiredResource, name: string): string {
  const value = desired.secrets[name];
  if (value === undefined) throw new Error(`${desired.name} has no ${name} to send`);
  return value;
}
