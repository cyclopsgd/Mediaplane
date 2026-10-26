import { spawn } from 'node:child_process';
import { z } from 'zod';

/** How long the database read may take, in ms, before its process is killed. */
export const DATABASE_DEADLINE_MS = 10_000;

/** The most the database read may print: one row of one column, as JSON. */
const ANSWER_LIMIT = 64 * 1024;

/**
 * What the child process runs: it opens the database at the URL its standard input
 * gives, read-only, through the file descriptor it was handed as its fd 3, runs the one
 * query, and prints what came back as one line of JSON: the column's value of the first
 * row, none, or the error's code and SQLite's own message. Nothing else: no file of its
 * own, no network, and an empty environment.
 */
export const DATABASE_PROGRAM = `import { DatabaseSync } from 'node:sqlite';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { url, query, column } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const say = (answer) => process.stdout.write(JSON.stringify(answer) + '\\n');
try {
  const db = new DatabaseSync(new URL(url), { readOnly: true });
  try {
    const row = db.prepare(query).get();
    say(row === undefined ? { ok: true } : { ok: true, row: { value: row[column] ?? null } });
  } finally {
    db.close();
  }
} catch (cause) {
  say({ ok: false, code: cause?.code ?? null, message: cause?.code === 'ERR_SQLITE_ERROR' ? String(cause.message) : null });
}
`;

const answer = z.union([
  z.strictObject({
    ok: z.literal(true),
    row: z.strictObject({ value: z.unknown() }).optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().nullable(),
    message: z.string().nullable(),
  }),
]);

/** What the read found: the first row's value, none, or why it couldn't read. */
export type DatabaseAnswer =
  { found: 'row'; value: unknown } | { found: 'none' } | { found: 'failed'; why: string };

/** For tests: how the read runs. */
export interface DatabaseSeams {
  deadlineMs?: number;
  /** The program the child process runs, DATABASE_PROGRAM by default. */
  program?: string;
  /** Called as the child process is started, and once it has answered. */
  started?: () => void;
  answered?: () => void;
}

/** Why a read failed, from its error's code, as a key file's read says it. */
function failure(code: string | null, message: string | null): string {
  if (code === 'ERR_SQLITE_ERROR' && message !== null) {
    return `it could not be read as a database (${message})`;
  }
  return code === null ? 'it could not be read' : `it could not be read (${code})`;
}

/**
 * Run `sqlite.query` on the database Mediaplane holds open as `fd`, opened by SQLite at
 * `url` (`/proc/self/fd/3`, the same open file, as the child process sees it), in a
 * process of its own: a database whose file, or whose write-ahead log, is swapped for a
 * pipe just as SQLite opens it would hang SQLite's open (threat model T4); a process can
 * be stopped, where a call in this one can't. The child is Node itself
 * (`process.execPath`), with no shell, an empty environment and no flag but its program;
 * its request comes on its standard input, and its answer, which holds the key, on its
 * standard output, never on a command line. One that doesn't answer within the deadline
 * (DATABASE_DEADLINE_MS) is killed, and the read failed; so did one that exits without an
 * answer Mediaplane understands, or prints more than one row would. Never throws.
 */
export function queryDatabase(
  fd: number,
  url: URL,
  sqlite: { query: string; column: string },
  seams: DatabaseSeams = {},
): Promise<DatabaseAnswer> {
  const deadlineMs = seams.deadlineMs ?? DATABASE_DEADLINE_MS;
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (result: DatabaseAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolvePromise(result);
    };
    seams.started?.();
    const child = spawn(
      process.execPath,
      [
        '--no-warnings',
        '--input-type=module',
        '--eval',
        seams.program ?? DATABASE_PROGRAM,
      ],
      { stdio: ['pipe', 'pipe', 'ignore', fd], env: {} },
    );
    const timer = setTimeout(() => {
      settle({
        found: 'failed',
        why: `it was not read within ${String(deadlineMs / 1000)} seconds, so its read was stopped`,
      });
    }, deadlineMs);
    const { stdin, stdout } = child;
    // Both are pipes, as `stdio` asks: only a guard.
    if (stdin === null || stdout === null) {
      settle({ found: 'failed', why: 'its read could not be started' });
      return;
    }
    let output = '';
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > ANSWER_LIMIT) {
        settle({ found: 'failed', why: 'its read gave more than one row would' });
      }
    });
    child.on('error', (cause: NodeJS.ErrnoException) => {
      settle({ found: 'failed', why: failure(cause.code ?? null, null) });
    });
    child.on('close', () => {
      seams.answered?.();
      let parsed: z.infer<typeof answer>;
      try {
        // Never the answer's own text in a message: it holds the key.
        parsed = answer.parse(JSON.parse(output));
      } catch {
        settle({
          found: 'failed',
          why: 'its read gave no answer Mediaplane understands',
        });
        return;
      }
      if (!parsed.ok) {
        settle({ found: 'failed', why: failure(parsed.code, parsed.message) });
      } else if (parsed.row === undefined) {
        settle({ found: 'none' });
      } else {
        settle({ found: 'row', value: parsed.row.value });
      }
    });
    stdin.on('error', () => {
      // It exited before reading its request: its answer, or none, says why.
    });
    stdin.end(JSON.stringify({ url: url.href, ...sqlite }));
  });
}
