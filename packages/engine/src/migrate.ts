import { join, resolve } from 'node:path';
import { parseConfig } from './config/load';
import {
  MIGRATIONS,
  migrateSource,
  STACK_VERSION,
  type Migration,
} from './config/migrations';
import { readStackFile } from './config/overrides-file';
import { error, type Diagnostic } from './diagnostics';
import { STACK_PATH } from './paths';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { writeFileAtomic } from './util/atomic';
import { readIfExists } from './util/fs';

export interface MigrateOptions {
  home: string;
  now?: () => Date;
  /** For tests: the migrations to run instead of Mediaplane's own. */
  migrations?: readonly Migration[];
}

/** What `mediaplane migrate` did (spec §5.2). */
export interface MigrateResult {
  ok: boolean;
  /** The version stack.yaml was, when it could be read. */
  from?: number;
  /** The version this Mediaplane writes. */
  to: number;
  /** Whether stack.yaml was rewritten. */
  changed: boolean;
  /** What each step changed, in order. */
  applied: string[];
  /**
   * The file as it should be, when Mediaplane may not write it: one managed by
   * automation, or one it can't replace safely. stack.yaml holds no secret (ADR 0009).
   */
  text?: string;
  diagnostics: Diagnostic[];
}

/**
 * `mediaplane migrate`: rewrites stack.yaml to the version this Mediaplane writes,
 * keeping its comments and formatting (spec §3.3, §5.2), as Keep mine writes it: read
 * once through one handle, rewritten only where each step says, checked to read as the
 * step says, and written atomically in place of the file read, with its mode and group.
 * It runs under apply's lock. With `managed_by: external`, it writes nothing and gives
 * the file as it should be (spec §4.2).
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  const migrations = options.migrations ?? MIGRATIONS;
  const stackPath = join(home, STACK_PATH);
  const refused = (
    diagnostics: Diagnostic[],
    extra: Partial<MigrateResult> = {},
  ): MigrateResult => ({
    ok: false,
    to: STACK_VERSION,
    changed: false,
    applied: [],
    diagnostics,
    ...extra,
  });
  // Never create state/ in a folder that isn't a Mediaplane home.
  if ((await readIfExists(stackPath)) === undefined) {
    return refused([
      error('config.missing', `no stack.yaml at ${stackPath}`, {
        hint: 'run mediaplane init to write one, or pass --home with the Mediaplane home',
      }),
    ]);
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, now, 'migrate');
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return refused([
      error('migrate.locked', cause.message, {
        hint: 'wait for it to finish, then run migrate again; if nothing is running, delete state/lock',
      }),
    ]);
  }
  try {
    const read = await readStackFile(stackPath);
    // A file it won't write is still read, to give the file as it should be.
    const text = read.ok ? read.file.text : ((await readIfExists(stackPath)) ?? '');
    // Read as plan reads it: an older version migrated in memory, or why not.
    const before = parseConfig(text, migrations);
    if (!before.ok) return refused(before.diagnostics);
    const migrated = migrateSource(text, migrations);
    if (!migrated.ok) {
      return refused([
        error(
          'migrate.rewrite',
          `Mediaplane can't rewrite stack.yaml: ${migrated.reason}`,
          {
            hint: 'rewrite it yourself, as the stack.yaml reference describes the current version',
          },
        ),
      ]);
    }
    const { from, applied } = migrated;
    if (applied.length === 0) {
      return {
        ok: true,
        from,
        to: STACK_VERSION,
        changed: false,
        applied,
        diagnostics: [],
      };
    }
    const byHand =
      'rewrite stack.yaml yourself as migrate gives it (with --json, as its text)';
    const notWritten = (code: string, message: string, hint = byHand) =>
      refused([error(code, message, { hint })], { from, applied, text: migrated.text });
    if (before.config.managed_by === 'external') {
      return notWritten(
        'migrate.external',
        "stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane doesn't write it",
        `${byHand}, where it is kept, such as your playbook`,
      );
    }
    if (!read.ok) {
      return notWritten(
        'migrate.stack-file',
        `Mediaplane won't write stack.yaml: ${read.reason}`,
      );
    }
    try {
      await writeFileAtomic(stackPath, migrated.text, read.file.mode, {
        group: read.file.gid,
        replaces: { dev: read.file.dev, ino: read.file.ino },
      });
    } catch (cause) {
      return notWritten(
        'migrate.stack-file',
        `Mediaplane couldn't write stack.yaml: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return { ok: true, from, to: STACK_VERSION, changed: true, applied, diagnostics: [] };
  } finally {
    await lock.release();
  }
}
