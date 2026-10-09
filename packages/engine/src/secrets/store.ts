import { join } from 'node:path';
import { z } from 'zod';
import { SECRETS_PATH, STATE_DIR } from '../paths';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';

const storeSchema = z.strictObject({
  version: z.literal(1),
  apps: z.record(z.string(), z.record(z.string(), z.string())),
});

/** Secrets Mediaplane generated, or apps created, per app: { sonarr: { apiKey: "…" } }. */
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
  if (!parsed.success) throw new Error(`${path} is not a Mediaplane secrets file`);
  return parsed.data;
}

/** Save the store atomically, private to its owner: state/ 0700, the file 0600 (§7.2(4)). */
export async function writeSecretStore(home: string, store: SecretStore): Promise<void> {
  const sorted = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
  const apps = Object.fromEntries(
    Object.entries(sorted(store.apps)).map(([id, secrets]) => [id, sorted(secrets)]),
  );
  await ensureDir(join(home, STATE_DIR), 0o700);
  await writeFileAtomic(
    join(home, SECRETS_PATH),
    `${JSON.stringify({ version: 1, apps }, null, 2)}\n`,
    0o600,
  );
}
