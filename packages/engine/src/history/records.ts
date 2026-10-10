import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { HISTORY_DIR } from '../paths';
import type { RandomBytes } from '../secrets/generate';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';

export const CHANGE_SCHEMA = 'mediaplane.change/v1';

/** 20261009T094312Z-a1b2c3d4 */
const RECORD_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

const actionSchema = z.strictObject({
  step: z.enum(['keys', 'files', 'pull', 'ownership', 'start', 'wire', 'verify']),
  /** The wire step's actions name the resource ("sonarr.admin"). Added in Slice 3b. */
  resource: z.string().optional(),
  result: z.enum(['done', 'failed', 'skipped']),
  detail: z.string().optional(),
  error: z.string().optional(),
});

/** One apply, as recorded in state/history/<id>.json. Never holds a secret value. */
export const changeRecordSchema = z.strictObject({
  schema: z.literal(CHANGE_SCHEMA),
  id: z.string().regex(RECORD_ID),
  trigger: z.literal('cli'),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  durationMs: z.int().min(0),
  outcome: z.enum(['success', 'failed']),
  stackSha256: z.string().regex(/^[0-9a-f]{64}$/),
  plan: z.strictObject({
    files: z.array(
      z.strictObject({
        path: z.string(),
        status: z.enum(['create', 'update', 'unchanged']),
      }),
    ),
    containers: z.array(
      z.strictObject({
        service: z.string(),
        action: z.enum(['create', 'recreate', 'start', 'remove', 'unchanged']),
      }),
    ),
    secrets: z.strictObject({ generate: z.array(z.string()) }),
    /** What the plan said of each managed resource. Added in Slice 3b. */
    wiring: z
      .array(
        z.strictObject({
          resource: z.string(),
          action: z.enum([
            'create',
            'update',
            'adopt',
            'unchanged',
            'after-start',
            'unknown',
          ]),
          changes: z.array(z.string()).optional(),
          reason: z.string().optional(),
        }),
      )
      .optional(),
  }),
  actions: z.array(actionSchema),
});

export type ChangeRecord = z.infer<typeof changeRecordSchema>;
export type ActionResult = z.infer<typeof actionSchema>;
export type ApplyStep = ActionResult['step'];

/** A record id that sorts by time and is unique within a second. */
export function newRecordId(at: Date, random: RandomBytes = randomBytes): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return `${stamp}-${random(4).toString('hex')}`;
}

export function stackSha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * Write one record. It is checked against the schema first, so a record that could not be
 * read back (or whose id is not a safe file name) is refused before anything is written.
 */
export async function writeRecord(home: string, record: ChangeRecord): Promise<void> {
  const checked = changeRecordSchema.safeParse(record);
  if (!checked.success) {
    const problems = checked.error.issues
      .map((issue) => `${issue.path.join('.') || '(record)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid change record: ${problems}`);
  }
  await ensureDir(join(home, HISTORY_DIR), 0o700);
  await writeFileAtomic(
    join(home, HISTORY_DIR, `${checked.data.id}.json`),
    `${JSON.stringify(checked.data, null, 2)}\n`,
    0o600,
  );
}

/**
 * Every record, newest first. An entry that can't be read or doesn't validate is listed
 * in `unreadable`, not thrown; only a failure to read the folder itself throws.
 */
export async function listRecords(
  home: string,
): Promise<{ records: ChangeRecord[]; unreadable: string[] }> {
  let names: string[];
  try {
    names = await readdir(join(home, HISTORY_DIR));
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return { records: [], unreadable: [] };
    }
    throw cause;
  }
  const records: ChangeRecord[] = [];
  const unreadable: string[] = [];
  for (const name of names
    .filter((n) => n.endsWith('.json'))
    .sort(compare)
    .reverse()) {
    const record = await readRecordFile(join(home, HISTORY_DIR, name));
    if (record === undefined) unreadable.push(name);
    else records.push(record);
  }
  return { records, unreadable };
}

/** One record, or undefined for an unknown id (or one that isn't a record id at all). */
export async function readRecord(
  home: string,
  id: string,
): Promise<ChangeRecord | undefined> {
  if (!RECORD_ID.test(id)) return undefined;
  const text = await readIfExists(join(home, HISTORY_DIR, `${id}.json`));
  return text === undefined ? undefined : parseRecord(text);
}

/** The record in this file, or undefined if it can't be read (EACCES, EISDIR, gone) or parsed. */
async function readRecordFile(path: string): Promise<ChangeRecord | undefined> {
  try {
    return parseRecord(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function parseRecord(text: string): ChangeRecord | undefined {
  try {
    const parsed = changeRecordSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
