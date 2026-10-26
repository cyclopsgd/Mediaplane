import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { KeyFile } from '../catalog/types';
import { error, warning, type Diagnostic } from '../diagnostics';
import { APPDATA_DIR } from '../paths';
import type { ResolvedStack } from '../resolver/resolve';
import { runbookUrl } from '../runbooks';
import { codeOf } from '../util/error-code';
import { isInside } from '../util/path';
import { compare } from '../util/sort';
import { APP_SECRET, type SecretStore } from './store';

/** Where a host is rebuilt from stack.yaml and appdata: what to do when a key isn't found. */
export const REBUILD_RUNBOOK = runbookUrl('rebuilding-a-host');

/**
 * What an app's key file holds (KeyFile): no file, a file without the key, the key, or a
 * file Mediaplane can't read, with why (never the file's content).
 */
export type KeyFound =
  | { found: 'absent' }
  | { found: 'none' }
  | { found: 'key'; value: string }
  | { found: 'unreadable'; why: string };

/** A key found in an app's appdata: the app, the secret's name, and its value. */
export interface RecoveredKey {
  app: string;
  name: string;
  value: string;
}

/** A key file's path relative to the home: appdata/<app>/<path>. */
export function keyFilePath(app: string, file: KeyFile): string {
  return posix.join(APPDATA_DIR, app, file.path);
}

/** Whether something stands at `path`. */
async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/**
 * How to open the SQLite database at `path` without writing anything beside it. One in use
 * has its write-ahead log and its index (-wal, -shm) beside it, which a read-only open
 * reads, as the app's own readers do, making nothing. One closed cleanly has neither, and
 * all it holds is in the file: a read-only open would make both, as Mediaplane's user,
 * in the app's folder (probed), so it is opened immutable, which makes nothing.
 */
async function databaseAt(path: string): Promise<string | URL> {
  if ((await exists(`${path}-wal`)) && (await exists(`${path}-shm`))) return path;
  const url = pathToFileURL(path);
  url.searchParams.set('immutable', '1');
  return url;
}

/** Why a failure to read a key file happened, as its code, without its message. */
function because(cause: unknown): string {
  const code = codeOf(cause);
  return code === undefined ? 'it could not be read' : `it could not be read (${code})`;
}

/** What a key file that is a link, a pipe or a folder gives: nothing, said. */
const LINK: KeyFound = {
  found: 'unreadable',
  why: 'it is a link, which is never followed',
};
const NOT_A_FILE: KeyFound = { found: 'unreadable', why: 'it is not a regular file' };
const CHANGED: KeyFound = {
  found: 'unreadable',
  why: 'it changed while it was being read',
};

/** A key file that is not there, or can't be reached, by its code alone. */
function missing(cause: unknown): KeyFound {
  const code = codeOf(cause);
  if (code === 'ENOENT' || code === 'ENOTDIR') return { found: 'absent' };
  if (code === 'ELOOP') return LINK;
  return { found: 'unreadable', why: because(cause) };
}

/** Whether the real path `real` is in the app's appdata folder (its real path). */
async function insideFolder(real: string, folder: string): Promise<boolean> {
  return isInside(real, await realpath(folder));
}

/**
 * What `file`, in `app`'s appdata folder in the home, holds. Never read: a link at the
 * file itself, a pipe, a folder, or a file whose real path leads out of the app's folder,
 * which an app that owns its folder could otherwise use to have Mediaplane take another
 * app's key, or another file, as its own. Never throws.
 */
export async function readKeyFile(
  home: string,
  app: string,
  file: KeyFile,
): Promise<KeyFound> {
  const folder = join(home, APPDATA_DIR, app);
  const path = join(home, keyFilePath(app, file));
  const outside: KeyFound = {
    found: 'unreadable',
    why: `it leads outside ${posix.join(APPDATA_DIR, app)}`,
  };
  return 'read' in file
    ? readTextKey(path, folder, outside, file)
    : readDatabaseKey(path, folder, outside, file.sqlite);
}

/**
 * A text key file, opened once and read through that handle: the same file is checked and
 * read. Opened without following a link at the file and without waiting (a named pipe in
 * its place is refused, never waited on).
 */
async function readTextKey(
  path: string,
  folder: string,
  outside: KeyFound,
  file: Extract<KeyFile, { read: unknown }>,
): Promise<KeyFound> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (cause) {
    return missing(cause);
  }
  try {
    if (!(await handle.stat()).isFile()) return NOT_A_FILE;
    // Where the open handle leads, whatever the folders on the way were linked to.
    const real = await realpath(`/proc/self/fd/${String(handle.fd)}`);
    if (!(await insideFolder(real, folder))) return outside;
    const text = await handle.readFile('utf8');
    let value;
    try {
      value = file.read(text);
    } catch {
      // Never the reader's message: it may hold the file's text.
      return {
        found: 'unreadable',
        why: "its content isn't in a form Mediaplane understands",
      };
    }
    return value === undefined || value === ''
      ? { found: 'none' }
      : { found: 'key', value };
  } catch (cause) {
    return { found: 'unreadable', why: because(cause) };
  } finally {
    await handle.close();
  }
}

/**
 * A SQLite database: a regular file (checked by its path before it is opened, as SQLite
 * opens by path), and the same file, still in the app's folder, once it is open.
 */
async function readDatabaseKey(
  path: string,
  folder: string,
  outside: KeyFound,
  sqlite: { query: string; column: string },
): Promise<KeyFound> {
  let before;
  try {
    before = await lstat(path);
  } catch (cause) {
    return missing(cause);
  }
  if (before.isSymbolicLink()) return LINK;
  if (!before.isFile()) return NOT_A_FILE;
  let real;
  try {
    real = await realpath(path);
    if (!(await insideFolder(real, folder))) return outside;
  } catch (cause) {
    return { found: 'unreadable', why: because(cause) };
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(await databaseAt(real), { readOnly: true });
    // Swapped for another file, or moved out of the folder, since the checks?
    const after = await stat(path);
    if (after.dev !== before.dev || after.ino !== before.ino) return CHANGED;
    if (!(await insideFolder(await realpath(path), folder))) return outside;
    const row = db.prepare(sqlite.query).get();
    const value = row?.[sqlite.column];
    if (row === undefined) return { found: 'none' };
    return typeof value === 'string' && value !== ''
      ? { found: 'key', value }
      : { found: 'unreadable', why: `its ${sqlite.column} isn't text` };
  } catch (cause) {
    // SQLite's own message names what failed (a table, a lock), never a value.
    const said = cause instanceof Error ? cause.message : String(cause);
    return { found: 'unreadable', why: `it could not be read as a database (${said})` };
  } finally {
    db?.close();
  }
}

/** Why a key file found gave no key Mediaplane can keep; undefined for none at all. */
function noKey(found: KeyFound): string | undefined {
  if (found.found === 'unreadable') return found.why;
  if (found.found === 'key') {
    return 'it holds the key in a form Mediaplane can\'t keep (only letters, digits and "_")';
  }
  return found.found === 'none' ? 'it holds none' : undefined;
}

/**
 * The keys state/secrets.json lacks that the apps keep in their appdata (spec §6.1, key
 * recovery), by app then name, found before anything is generated.
 * - A key Mediaplane generates that is in a file it can't read, or in a form it can't
 *   keep, is an error: a new one would lock Mediaplane out of the app, which still holds
 *   the old one. A file without it is from before Mediaplane seeded the app, which plan's
 *   pre-start check reports.
 * - A key the app made (Jellyfin's) that can't be found is found by the app's setup, which
 *   signs in as the shared admin. That needs the password the app has: with the admin
 *   password to be generated (`newPassword`), which the app doesn't know, it is a warning,
 *   and the app is `unfound`: the warning says why it is left unwired.
 * Reads only; never says a key's value.
 */
export async function recoverKeys(
  stack: ResolvedStack,
  store: SecretStore,
  newPassword: boolean,
): Promise<{ recovered: RecoveredKey[]; unfound: string[]; diagnostics: Diagnostic[] }> {
  const recovered: RecoveredKey[] = [];
  const unfound: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of stack.apps) {
    const { id, name: appName } = app.def;
    const files = Object.entries(app.def.keyFiles ?? {}).sort(([a], [b]) =>
      compare(a, b),
    );
    for (const [name, file] of files) {
      const source = app.def.secrets[name];
      if (source === undefined || store.apps[id]?.[name] !== undefined) continue;
      const found = await readKeyFile(stack.home, id, file);
      if (found.found === 'key' && APP_SECRET.test(found.value)) {
        recovered.push({ app: id, name, value: found.value });
        continue;
      }
      const why = noKey(found);
      const made = 'createdBy' in source;
      if (why === undefined || (made ? !newPassword : found.found === 'none')) continue;
      const where = keyFilePath(id, file);
      // An app that takes its key from its environment takes a new one at its next start;
      // what holds the old one then is the resources that use it. One that keeps it only
      // in its file is locked against Mediaplane's new key.
      const fromEnvironment = app.def.credentials.some(
        (step) => step.step === 'env' && step.secret === name,
      );
      const consequence = fromEnvironment
        ? 'The old key is still held by the resources that use it; a new key would break them'
        : `A new key would lock Mediaplane out of ${appName}, which still holds the old one`;
      const lacks = `state/secrets.json has no ${id}.${name}, and ${where}, where ${appName} keeps it, can't give it: ${why}`;
      if (made) unfound.push(id);
      diagnostics.push(
        made
          ? warning(
              'keys.unrecoverable',
              `${lacks}. The admin password is to be generated too, so apply can't sign in to ${appName} to find its key, and leaves ${appName} unwired`,
              {
                hint: `set admin.password to a file holding the password ${appName}'s admin has, then run plan again; the runbook has the other ways: ${REBUILD_RUNBOOK}`,
              },
            )
          : error('keys.unrecoverable', `${lacks}. ${consequence}`, {
              hint: `make ${where} readable by the user Mediaplane runs as (MEDIAPLANE_UID in its container), or move appdata/${id} aside to start ${appName} afresh, then run plan again; see ${REBUILD_RUNBOOK}`,
            }),
      );
    }
  }
  return { recovered, unfound, diagnostics };
}

/** `store`, with each recovered key added. */
export function withRecoveredKeys(
  store: SecretStore,
  recovered: readonly RecoveredKey[],
): SecretStore {
  if (recovered.length === 0) return store;
  const apps: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(store.apps).map(([id, secrets]) => [id, { ...secrets }]),
  );
  for (const { app, name, value } of recovered) (apps[app] ??= {})[name] = value;
  return { ...store, apps };
}
