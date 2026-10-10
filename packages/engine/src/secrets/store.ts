import { join } from 'node:path';
import { z } from 'zod';
import { SECRETS_PATH, STATE_DIR } from '../paths';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare, unique } from '../util/sort';

/**
 * Every app secret goes into the app's own files as it is, unescaped (config.xml,
 * qBittorrent.conf, Gluetun's config.toml), so a hand-edited one must not hold a quote, a
 * "<" or a newline. Everything Mediaplane generates fits: hex, base62 and "qbt_".
 */
const appSecret = z.string().regex(/^[A-Za-z0-9_]+$/);

const storeSchema = z.strictObject({
  version: z.literal(1),
  apps: z.record(z.string(), z.record(z.string(), appSecret)),
  /**
   * Secrets the whole stack shares. Added in Slice 3a: older stores have none. The admin
   * password goes into an app's file only hashed, so any characters will do.
   */
  shared: z.strictObject({ adminPassword: z.string().min(1).optional() }).optional(),
});

/** Secrets Mediaplane generated, or apps created, per app, and the shared admin password. */
export type SecretStore = z.infer<typeof storeSchema>;

export function emptySecretStore(): SecretStore {
  return { version: 1, apps: {} };
}

/** The store, or an empty one if it does not exist yet. Errors never include its contents. */
export async function readSecretStore(home: string): Promise<SecretStore> {
  const path = join(home, SECRETS_PATH);
  const text = await readIfExists(path);
  if (text === undefined) return emptySecretStore();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const parsed = storeSchema.safeParse(data);
  if (!parsed.success) {
    const faults = unique(parsed.error.issues.flatMap((issue) => fault(issue.path)));
    throw new Error(
      `${path} is not a Mediaplane secrets file${faults.length === 0 ? '' : `: ${faults.join('; ')}`}`,
    );
  }
  return parsed.data;
}

/**
 * What is wrong with one secret, named as the rest of Mediaplane names it ("sonarr.apiKey",
 * "shared.adminPassword"), and never its value. Nothing for a fault that isn't a secret's.
 */
function fault(path: readonly PropertyKey[]): string[] {
  const [section, app, name] = path;
  if (section === 'apps' && path.length === 3) {
    return [
      `${String(app)}.${String(name)} must be text of letters, digits and "_" only, as the apps' files take it unescaped`,
    ];
  }
  if (section === 'shared' && app === 'adminPassword' && path.length === 2) {
    return ['shared.adminPassword must not be empty'];
  }
  return [];
}

/** Save the store atomically, private to its owner: state/ 0700, the file 0600 (§7.2(4)). */
export async function writeSecretStore(home: string, store: SecretStore): Promise<void> {
  const sorted = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
  const apps = Object.fromEntries(
    Object.entries(sorted(store.apps)).map(([id, secrets]) => [id, sorted(secrets)]),
  );
  await ensureDir(join(home, STATE_DIR), 0o700);
  const adminPassword = store.shared?.adminPassword;
  await writeFileAtomic(
    join(home, SECRETS_PATH),
    `${JSON.stringify(
      {
        version: 1,
        apps,
        ...(adminPassword === undefined ? {} : { shared: { adminPassword } }),
      },
      null,
      2,
    )}\n`,
    0o600,
  );
}
