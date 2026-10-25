import type { DesiredResource, Fields } from '@mediaplane/engine';

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

/**
 * Where `desired` has its app send a key: its `sendsTo`, the stack's own address for the
 * other app, which desired() gives every resource that holds one.
 */
export function sendsToOf(desired: DesiredResource): Fields {
  if (desired.sendsTo === undefined) {
    throw new Error(`${desired.name} says nowhere to send its key`);
  }
  return desired.sendsTo;
}
