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

const knownSchema = z.strictObject({
  /** The app's id for it; null for a singleton. */
  id: z.union([z.string(), z.number(), z.null()]),
  name: z.string(),
  /** The managed fields as last applied (spec §6.3: L). Never a secret. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** The names of the secrets it holds: never their values, nor a hash of them. */
  secrets: z.array(z.string()),
  appliedAt: z.iso.datetime(),
});

const fileSchema = z.strictObject({
  schema: z.literal(RESOURCES_SCHEMA),
  resources: z.record(z.string().regex(RESOURCE_ADDRESS), knownSchema),
});

/** What Mediaplane last applied to one resource, as state/resources.json keeps it. */
export type KnownResource = z.infer<typeof knownSchema>;

/** Every resource Mediaplane manages, by address. */
export type KnownResources = Record<string, KnownResource>;

/**
 * state/resources.json, or nothing when it doesn't exist yet. It holds no secret, so an
 * error may name what is wrong in it.
 */
export async function readResources(home: string): Promise<KnownResources> {
  const path = join(home, RESOURCES_PATH);
  const text = await readIfExists(path);
  if (text === undefined) return {};
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
  return parsed.data.resources;
}

/** Save it atomically, sorted, private to its owner: state/ 0700, the file 0600. */
export async function writeResources(
  home: string,
  resources: KnownResources,
): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(resources).sort(([a], [b]) => compare(a, b)),
  );
  const checked = fileSchema.parse({ schema: RESOURCES_SCHEMA, resources: sorted });
  await ensureDir(join(home, STATE_DIR), 0o700);
  await writeFileAtomic(
    join(home, RESOURCES_PATH),
    `${JSON.stringify(checked, null, 2)}\n`,
    0o600,
  );
}
