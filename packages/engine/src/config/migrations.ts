import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, parseDocument, type Document } from 'yaml';

/**
 * The version of stack.yaml this Mediaplane reads and writes (spec §4.2). Load reads an
 * older one through the migrations below, in memory, with a warning; only
 * `mediaplane migrate` rewrites the file (spec §5 step 2).
 */
export const STACK_VERSION = 1;

/** One replacement of the text between two offsets. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** One step from a version of stack.yaml to the next. */
export interface Migration {
  /** The version it reads; it makes the next. */
  from: number;
  /** What it changes, in a few words: migrate's output, and load's warning. */
  summary: string;
  /** The change on the file as data, which is what Mediaplane reads in memory. */
  data(stack: Readonly<Record<string, unknown>>): Record<string, unknown>;
  /**
   * The same change as edits of the text, leaving everything else as it is: comments,
   * order, quoting, spacing and line ends (spec §3.3). The version is changed for it.
   */
  text(source: string, doc: Document.Parsed): Edit[];
}

/**
 * Every migration, in order. None yet: stack.yaml has only ever been version 1, so
 * `migrate` has nothing to do. The machinery is tested with a made-up one
 * (testing/migrations.ts).
 */
export const MIGRATIONS: readonly Migration[] = [];

export type Migrated =
  | { ok: true; data: Record<string, unknown>; from: number; applied: string[] }
  | {
      ok: false;
      code: 'config.newer-version' | 'config.unknown-version';
      message: string;
    };

/** The steps from `from` to `current`, or the first version none starts from. */
function steps(
  from: number,
  migrations: readonly Migration[],
  current: number,
): Migration[] | number {
  const path: Migration[] = [];
  for (let version = from; version < current; version++) {
    const step = migrations.find((m) => m.from === version);
    if (step === undefined) return version;
    path.push(step);
  }
  return path;
}

const newer = (version: number, current: number) =>
  `stack.yaml is version ${String(version)}, newer than this Mediaplane reads (${String(current)}): it was written for a later Mediaplane`;
const unknown = (version: number, current: number) =>
  `stack.yaml is version ${String(version)}, which no Mediaplane wrote: this one reads version ${String(current)}`;

/**
 * `data`, a parsed stack.yaml, as this Mediaplane reads it: an older version is migrated
 * one step after another. A version that isn't a whole number is left for the schema to
 * refuse.
 */
export function migrateData(
  data: Readonly<Record<string, unknown>>,
  migrations: readonly Migration[] = MIGRATIONS,
  current: number = STACK_VERSION,
): Migrated {
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: true, data: { ...data }, from: current, applied: [] };
  }
  if (version > current) {
    return { ok: false, code: 'config.newer-version', message: newer(version, current) };
  }
  const path = steps(version, migrations, current);
  if (typeof path === 'number') {
    return { ok: false, code: 'config.unknown-version', message: unknown(path, current) };
  }
  let migrated: Record<string, unknown> = { ...data };
  for (const step of path) {
    migrated = { ...step.data(migrated), version: step.from + 1 };
  }
  return { ok: true, data: migrated, from: version, applied: path.map((s) => s.summary) };
}

/** `edits` applied to `source`, or undefined if two overlap. */
function applyEdits(source: string, edits: readonly Edit[]): string | undefined {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let text = source;
  let limit = source.length;
  for (const edit of sorted) {
    if (edit.end > limit || edit.start > edit.end) return undefined;
    text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
    limit = edit.start;
  }
  return text;
}

export type Rewritten =
  | { ok: true; text: string; from: number; to: number; applied: string[] }
  | { ok: false; reason: string };

/**
 * `source`, a stack.yaml, rewritten to the current version, with nothing else changed.
 * Each step's edits, and its version, are checked: the text must then read as the step
 * says the data changes, or nothing is rewritten.
 */
export function migrateSource(
  source: string,
  migrations: readonly Migration[] = MIGRATIONS,
  current: number = STACK_VERSION,
): Rewritten {
  let text = source;
  let from: number | undefined;
  const applied: string[] = [];
  for (;;) {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return { ok: false, reason: 'it is not valid YAML' };
    const root = doc.contents;
    if (!isMap(root) || root.flow === true) {
      return {
        ok: false,
        reason: 'its top level is not a YAML block of keys, one per line',
      };
    }
    const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'version');
    const value = pair?.value;
    if (!isScalar(value) || typeof value.value !== 'number') {
      return { ok: false, reason: 'it has no version: line of its own' };
    }
    const version = value.value;
    from ??= version;
    if (version > current) return { ok: false, reason: newer(version, current) };
    if (version === current) return { ok: true, text, from, to: current, applied };
    const step = steps(version, migrations, current);
    if (typeof step === 'number' || step[0] === undefined) {
      return { ok: false, reason: unknown(version, current) };
    }
    const [next] = step;
    const [start, end] = value.range;
    const edited = applyEdits(text, [
      ...next.text(text, doc),
      { start, end, text: String(next.from + 1) },
    ]);
    const wanted = {
      ...next.data(doc.toJS() as Record<string, unknown>),
      version: next.from + 1,
    };
    const after = edited === undefined ? undefined : parseDocument(edited);
    if (
      edited === undefined ||
      after === undefined ||
      after.errors.length > 0 ||
      !isDeepStrictEqual(after.toJS(), wanted)
    ) {
      return {
        ok: false,
        reason: `migrating it from version ${String(version)} (${next.summary}) would change more than the migration does, or less, so Mediaplane can't rewrite it`,
      };
    }
    text = edited;
    applied.push(next.summary);
  }
}
