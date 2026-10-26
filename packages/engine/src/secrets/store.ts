import { join } from 'node:path';
import { z } from 'zod';
import { SECRETS_PATH, STATE_DIR } from '../paths';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare, unique } from '../util/sort';

/**
 * Every app secret goes into the app's own files as it is, unescaped (config.xml,
 * qBittorrent.conf, Gluetun's config.toml), so a hand-edited one must not hold a quote, a
 * "<" or a newline. Everything Mediaplane generates fits: hex, base62 and "qbt_". So must
 * a key an app creates itself (Jellyfin's is 32 hex characters): writeSecretStore
 * refuses to save one that doesn't.
 */
export const APP_SECRET = /^[A-Za-z0-9_]+$/;

/** Why a key that isn't of APP_SECRET's form can't be kept: plan and keep say so. */
export const UNKEEPABLE_KEY =
  'it holds the key in a form Mediaplane can\'t keep (only letters, digits and "_")';

const appSecret = z.string().regex(APP_SECRET);

/** An app's id, as the catalog names it ("sonarr"): never shaped like a secret. */
const APP_ID = /^[a-z][a-z0-9-]*$/;

/**
 * state/secrets.json. Each object keeps the fields it doesn't know, a later release's, and
 * writeSecretStore writes them back as they were: going back one release never stops at
 * the store, and the older release never acts on what it doesn't know. A known field of
 * another type, or another version, is still refused.
 */
const storeSchema = z.looseObject({
  version: z.literal(1),
  apps: z.record(z.string(), z.record(z.string(), appSecret)),
  /**
   * Secrets the whole stack shares. Added in Slice 3a: older stores have none. The admin
   * password goes into an app's file only hashed, so any characters will do.
   */
  shared: z
    .looseObject({
      adminPassword: z.string().min(1).optional(),
      /**
       * The apps that have never had `adminPassword`, which Mediaplane generated while it
       * couldn't set it in them: their sign-in is held until it is set through their key,
       * or their setup signs in with it. Added in Slice 10: older stores have none. Ids of
       * apps, never a secret.
       */
      adminPasswordNotIn: z.array(z.string().regex(APP_ID)).optional(),
    })
    .optional(),
  /**
   * The apps whose first-run setup makes no key (Seerr's), and that Mediaplane finished
   * itself, or checked and found to be its own. Added in Slice 6: older stores have none.
   * Such an app counts as set up only when it is named here; names, not secrets.
   */
  setUp: z.array(z.string().min(1)).optional(),
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

/**
 * Save the store atomically, private to its owner: state/ 0700, the file 0600 (§7.2(4)).
 * A store that readSecretStore would refuse is never written, so a key an app made with
 * other characters can't lock plan out of the store; the error names the key, never its
 * value, and the store on disk stays as it was.
 */
export async function writeSecretStore(home: string, store: SecretStore): Promise<void> {
  const checked = storeSchema.safeParse(store);
  if (!checked.success) {
    const faults = unique(checked.error.issues.flatMap((issue) => fault(issue.path)));
    throw new Error(
      `cannot save ${join(home, SECRETS_PATH)}${faults.length === 0 ? '' : `: ${faults.join('; ')}`}`,
    );
  }
  const sorted = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
  const apps = Object.fromEntries(
    Object.entries(sorted(store.apps)).map(([id, secrets]) => [id, sorted(secrets)]),
  );
  await ensureDir(join(home, STATE_DIR), 0o700);
  // The fields a later release wrote, which this one doesn't know: back as they came.
  const {
    version: _version,
    apps: _apps,
    shared: storeShared,
    setUp: storeSetUp,
    ...later
  } = checked.data;
  const {
    adminPassword,
    adminPasswordNotIn: storeNotIn,
    ...laterShared
  } = storeShared ?? {};
  const notIn = unique(storeNotIn ?? []).sort(compare);
  const shared = {
    ...(adminPassword === undefined ? {} : { adminPassword }),
    // Only when there is one, as for setUp.
    ...(notIn.length === 0 ? {} : { adminPasswordNotIn: notIn }),
    ...laterShared,
  };
  const setUp = unique(storeSetUp ?? []).sort(compare);
  await writeFileAtomic(
    join(home, SECRETS_PATH),
    `${JSON.stringify(
      {
        version: 1,
        apps,
        ...(Object.keys(shared).length === 0 ? {} : { shared }),
        // Only when there is one, so a store without any is written as it always was.
        ...(setUp.length === 0 ? {} : { setUp }),
        ...later,
      },
      null,
      2,
    )}\n`,
    0o600,
  );
}
