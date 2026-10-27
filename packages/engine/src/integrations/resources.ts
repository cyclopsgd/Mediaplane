import { join } from 'node:path';
import { z } from 'zod';
import { RESOURCES_PATH, STATE_DIR } from '../paths';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';

export const RESOURCES_SCHEMA = 'mediaplane.resources/v1';

/**
 * "<app>.<resource>", as override keys start (spec §4.2): a resource's name is what the
 * contract allows (catalog.test.ts checks every one).
 */
export const RESOURCE_ADDRESS = /^[a-z0-9-]+\.[a-z][a-z0-9_]*$/;

const knownSchema = z.looseObject({
  /** The app's id for it; null for a singleton. */
  id: z.union([z.string(), z.number(), z.null()]),
  name: z.string(),
  /** The managed fields as last applied (spec §6.3: L). Never a secret. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** The names of the secrets it holds: never their values, nor a hash of them. */
  secrets: z.array(z.string()),
  /**
   * The names of the secrets Mediaplane gave the app in place of ones the app made itself
   * (a resource's `adoptSets`: Seerr's Jellyfin key), so that it gives them only once.
   * Added in Slice 10b; an older release keeps it as a field it doesn't know.
   */
  given: z.array(z.string()).optional(),
  appliedAt: z.iso.datetime(),
  /**
   * What `mediaplane drift` found of each secret when it last checked it, by name: its
   * verdict and when. Plan and drift don't check again a secret found refused, until
   * apply sets it, and its record then has none (spec §6.3). Never a value.
   */
  checks: z
    .record(
      z.string(),
      z.looseObject({
        verdict: z.enum(['passed', 'refused']),
        at: z.iso.datetime(),
      }),
    )
    .optional(),
});

/** "<app>.<key>": an app's own key, by the name the secrets store keeps it under. */
export const KEY_ADDRESS = /^[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*$/;

const fileSchema = z.looseObject({
  schema: z.literal(RESOURCES_SCHEMA),
  resources: z.record(z.string().regex(RESOURCE_ADDRESS), knownSchema),
  /**
   * The apps' own keys that plan or drift found the app refuses (spec §6.3, a key changed
   * at its source), by "<app>.<key>", and since when: neither sends it to the app again
   * until apply checks it and it passes, which takes it out. Never a value.
   */
  keys: z
    .record(
      z.string().regex(KEY_ADDRESS),
      z.looseObject({ verdict: z.literal('refused'), at: z.iso.datetime() }),
    )
    .optional(),
});

/** What Mediaplane last applied to one resource, as state/resources.json keeps it. */
export type KnownResource = z.infer<typeof knownSchema>;

/** Every resource Mediaplane manages, by address. */
export type KnownResources = Record<string, KnownResource>;

/** The apps' own keys found refused, by "<app>.<key>" (KEY_ADDRESS), and since when. */
export type KeyChecks = Record<string, { verdict: 'refused'; at: string }>;

/** Everything state/resources.json holds. */
export interface ResourcesState {
  resources: KnownResources;
  keys: KeyChecks;
}

/**
 * state/resources.json's resources, or none when it doesn't exist yet. It holds no
 * secret, so an error may name what is wrong in it.
 */
export async function readResources(home: string): Promise<KnownResources> {
  return (await readState(home)).resources;
}

/**
 * state/resources.json: its resources, and the apps' keys found refused (readResources).
 * Each object keeps the fields it doesn't know, a later release's, and writeResources
 * writes them back as they were; a known field of another type, or another schema, is
 * still refused.
 */
export async function readState(home: string): Promise<ResourcesState> {
  const parsed = await readFileData(home);
  return parsed === undefined
    ? { resources: {}, keys: {} }
    : { resources: parsed.resources, keys: parsed.keys ?? {} };
}

/** The whole file, as parsed, or undefined when it doesn't exist yet. */
async function readFileData(
  home: string,
): Promise<z.infer<typeof fileSchema> | undefined> {
  const path = join(home, RESOURCES_PATH);
  const text = await readIfExists(path);
  if (text === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const parsed = fileSchema.safeParse(data);
  if (!parsed.success) {
    const faults = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(the file)'}: ${issue.message}`,
    );
    throw new Error(
      `${path} is not a Mediaplane resources file (${RESOURCES_SCHEMA}): ${faults.join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * Save it atomically, sorted, private to its owner: state/ 0700, the file 0600. Without
 * `keys`, the apps' keys found refused that the file holds are kept as they are. The
 * file's own fields that this release doesn't know are kept too.
 */
export async function writeResources(
  home: string,
  resources: KnownResources,
  keys?: KeyChecks,
): Promise<void> {
  const before = await readFileData(home).catch(() => undefined);
  const kept = keys ?? before?.keys ?? {};
  const {
    schema: _schema,
    resources: _resources,
    keys: _keys,
    ...later
  } = before ?? { schema: RESOURCES_SCHEMA, resources: {} };
  const sorted = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
  const checked = fileSchema.parse({
    schema: RESOURCES_SCHEMA,
    resources: sorted(resources),
    ...(Object.keys(kept).length === 0 ? {} : { keys: sorted(kept) }),
    ...later,
  });
  await ensureDir(join(home, STATE_DIR), 0o700);
  await writeFileAtomic(
    join(home, RESOURCES_PATH),
    `${JSON.stringify(checked, null, 2)}\n`,
    0o600,
  );
}
