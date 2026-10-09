import { randomBytes } from 'node:crypto';
import type { ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';
import type { SecretStore } from './store';

/** Cryptographically random bytes. Tests pass a deterministic source instead. */
export type RandomBytes = (size: number) => Buffer;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** The largest multiple of 62 that fits in a byte: higher bytes would bias the alphabet. */
const BASE62_LIMIT = 248;

/** A new secret: 32 hex characters, or qBittorrent's "qbt_" + 28 base62 (spec §6.1). */
export function generateSecret(
  kind: 'hex32' | 'qbt',
  random: RandomBytes = randomBytes,
): string {
  if (kind === 'hex32') return random(16).toString('hex');
  let key = '';
  while (key.length < 28) {
    for (const byte of random(28)) {
      if (byte < BASE62_LIMIT && key.length < 28) key += BASE62.charAt(byte % 62);
    }
  }
  return `qbt_${key}`;
}

/** The store with every missing generated secret filled in. Existing ones are kept. */
export function withGeneratedSecrets(
  stack: ResolvedStack,
  store: SecretStore,
  random: RandomBytes = randomBytes,
): { store: SecretStore; generated: string[] } {
  const apps: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(store.apps).map(([id, secrets]) => [id, { ...secrets }]),
  );
  const generated: string[] = [];
  for (const app of stack.apps) {
    const secrets = Object.entries(app.def.secrets).sort(([a], [b]) => compare(a, b));
    for (const [name, source] of secrets) {
      if (!('generate' in source) || apps[app.def.id]?.[name] !== undefined) continue;
      (apps[app.def.id] ??= {})[name] = generateSecret(source.generate, random);
      generated.push(`${app.def.id}.${name}`);
    }
  }
  return { store: { version: 1, apps }, generated };
}
