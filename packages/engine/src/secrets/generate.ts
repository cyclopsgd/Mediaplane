import { randomBytes } from 'node:crypto';
import type { ResolvedStack } from '../resolver/resolve';
import { ADMIN_PASSWORD_PATH, adminPasswordToGenerate } from './admin';
import type { SecretStore } from './store';
import { missingGeneratedSecrets } from './values';

/** Cryptographically random bytes. Tests pass a deterministic source instead. */
export type RandomBytes = (size: number) => Buffer;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** The largest multiple of 62 that fits in a byte: higher bytes would bias the alphabet. */
const BASE62_LIMIT = 248;

/** What Mediaplane can generate. */
export type GeneratedKind = 'hex32' | 'qbt' | 'password';

/**
 * A new secret (spec §6.1): 32 hex characters; qBittorrent's "qbt_" and 28 base62; or a
 * password of 24 base62, about 143 bits.
 */
export function generateSecret(
  kind: GeneratedKind,
  random: RandomBytes = randomBytes,
): string {
  if (kind === 'hex32') return random(16).toString('hex');
  if (kind === 'qbt') return `qbt_${base62(28, random)}`;
  return base62(24, random);
}

/** `length` base62 characters, from unbiased random bytes. */
function base62(length: number, random: RandomBytes): string {
  let text = '';
  while (text.length < length) {
    for (const byte of random(length)) {
      if (byte < BASE62_LIMIT && text.length < length) text += BASE62.charAt(byte % 62);
    }
  }
  return text;
}

/**
 * The store with every missing generated secret filled in, the admin password first.
 * Existing ones are kept.
 */
export function withGeneratedSecrets(
  stack: ResolvedStack,
  store: SecretStore,
  random: RandomBytes = randomBytes,
): { store: SecretStore; generated: string[] } {
  const apps: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(store.apps).map(([id, secrets]) => [id, { ...secrets }]),
  );
  const generated: string[] = [];
  let shared = store.shared;
  if (adminPasswordToGenerate(stack.config, store)) {
    shared = { ...shared, adminPassword: generateSecret('password', random) };
    generated.push(ADMIN_PASSWORD_PATH);
  }
  for (const { app, name, kind } of missingGeneratedSecrets(stack, store)) {
    (apps[app] ??= {})[name] = generateSecret(kind, random);
    generated.push(`${app}.${name}`);
  }
  return {
    store: { version: 1, apps, ...(shared === undefined ? {} : { shared }) },
    generated,
  };
}
