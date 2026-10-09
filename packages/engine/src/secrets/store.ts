import { join } from 'node:path';
import { z } from 'zod';
import { SECRETS_PATH } from '../paths';
import { readIfExists } from '../util/fs';

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
