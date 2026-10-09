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
  step: z.enum(['keys', 'files', 'pull', 'ownership', 'start', 'verify']),
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

export async function writeRecord(home: string, record: ChangeRecord): Promise<void> {
  await ensureDir(join(home, HISTORY_DIR), 0o700);
  await writeFileAtomic(
    join(home, HISTORY_DIR, `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    0o600,
  );
}

/** Every record, newest first. Files that don't validate are listed, not thrown. */
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
    const record = parseRecord(await readFile(join(home, HISTORY_DIR, name), 'utf8'));
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

function parseRecord(text: string): ChangeRecord | undefined {
  try {
    const parsed = changeRecordSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
