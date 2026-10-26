import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { KeyFile } from '../catalog/types';
import { error, warning, type Diagnostic } from '../diagnostics';
import { APPDATA_DIR } from '../paths';
import { appSetupDone } from '../plan/bootstrap';
import type { ResolvedStack } from '../resolver/resolve';
import { runbookUrl } from '../runbooks';
import { codeOf } from '../util/error-code';
import { isInside } from '../util/path';
import { compare } from '../util/sort';
import { APP_SECRET, UNKEEPABLE_KEY, type SecretStore } from './store';

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

/** The largest text key file Mediaplane reads: an app's settings are far smaller. */
export const KEY_FILE_LIMIT = 1024 * 1024;

/**
 * What stands beside a database, at `path`: nothing, a regular file, or something else
 * (a link, which SQLite could be made to write through, a pipe, a folder).
 */
async function besideIt(path: string): Promise<'none' | 'file' | 'other'> {
  try {
    return (await lstat(path)).isFile() ? 'file' : 'other';
  } catch (cause) {
    const code = codeOf(cause);
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'none';
    throw cause;
  }
}

/**
 * How SQLite opens the database Mediaplane holds open as `fd`, at `path`, without writing
 * anything beside it; undefined when its write-ahead log or its index (-wal, -shm) is not a
 * regular file, which is never opened. One in use has both beside it, which a read-only
 * open reads, as the app's own readers do, making nothing. One closed cleanly has neither,
 * and all it holds is in the file: a read-only open would make both, as Mediaplane's user,
 * in the app's folder (probed), so it is opened immutable, which makes nothing.
 *
 * SQLite is given the open file (/proc/self/fd/<fd>), not the path: it opens the file by
 * the name that link has as it opens it, so a file put at the path after Mediaplane
 * checked it, a pipe included, is never what it opens (probed). What is left: another file
 * put at that very name between SQLite's look at the link and its own open, or the file
 * unlinked and one named "<name> (deleted)" put beside it, in that instant.
 * readDatabaseKey checks again once SQLite has it.
 */
async function databaseAt(path: string, fd: number): Promise<URL | undefined> {
  const log = await besideIt(`${path}-wal`);
  const index = await besideIt(`${path}-shm`);
  if (log === 'other' || index === 'other') return undefined;
  const url = pathToFileURL(`/proc/self/fd/${String(fd)}`);
  url.searchParams.set('mode', 'ro');
  if (log === 'none' || index === 'none') url.searchParams.set('immutable', '1');
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
const TOO_LARGE: KeyFound = { found: 'unreadable', why: 'it is larger than 1 MiB' };
const BESIDE: KeyFound = {
  found: 'unreadable',
  why: 'its write-ahead log or its index (-wal, -shm) is not a regular file',
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
    handle = await open(path, OPEN_FLAGS);
  } catch (cause) {
    return missing(cause);
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return NOT_A_FILE;
    if (stats.size > KEY_FILE_LIMIT) return TOO_LARGE;
    // Where the open handle leads, whatever the folders on the way were linked to.
    const real = await realpath(`/proc/self/fd/${String(handle.fd)}`);
    if (!(await insideFolder(real, folder))) return outside;
    const text = await readUpTo(handle, KEY_FILE_LIMIT);
    if (text === undefined) return TOO_LARGE;
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
    // Never a throw: a read-only handle that won't close has read what it read.
    await handle.close().catch(() => undefined);
  }
}

/** How a key file or a database is opened: never through a link at it, never waiting. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * The text `handle` holds, read to its end; undefined when that is more than `limit`
 * bytes, as a file that grew after its size was looked at may be.
 */
async function readUpTo(handle: FileHandle, limit: number): Promise<string | undefined> {
  const buffer = Buffer.alloc(limit + 1);
  let length = 0;
  for (;;) {
    const { bytesRead } = await handle.read(
      buffer,
      length,
      buffer.length - length,
      length,
    );
    if (bytesRead === 0) break;
    length += bytesRead;
    if (length > limit) return undefined;
  }
  return buffer.subarray(0, length).toString('utf8');
}

/**
 * A SQLite database: opened by Mediaplane, as a text key file is, checked to be a regular
 * file in the app's folder, and given to SQLite open (databaseAt), so that SQLite reads
 * the file checked. Once SQLite has it, the path must still be that file, and its name
 * still in the folder.
 */
async function readDatabaseKey(
  path: string,
  folder: string,
  outside: KeyFound,
  sqlite: { query: string; column: string },
): Promise<KeyFound> {
  let handle;
  try {
    handle = await open(path, OPEN_FLAGS);
  } catch (cause) {
    return missing(cause);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return NOT_A_FILE;
    const fd = `/proc/self/fd/${String(handle.fd)}`;
    if (!(await insideFolder(await realpath(fd), folder))) return outside;
    const at = await databaseAt(path, handle.fd);
    if (at === undefined) return BESIDE;
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(at, { readOnly: true });
    } catch (cause) {
      return databaseFailure(cause);
    }
    try {
      // Swapped for another file, or moved out of the folder, since it was checked?
      const now = await lstat(path);
      if (now.dev !== opened.dev || now.ino !== opened.ino) return CHANGED;
      if (!(await insideFolder(await realpath(fd), folder))) return outside;
      let row;
      try {
        row = db.prepare(sqlite.query).get();
      } catch (cause) {
        return databaseFailure(cause);
      }
      const value = row?.[sqlite.column];
      if (row === undefined) return { found: 'none' };
      return typeof value === 'string' && value !== ''
        ? { found: 'key', value }
        : { found: 'unreadable', why: `its ${sqlite.column} isn't text` };
    } finally {
      db.close();
    }
  } catch (cause) {
    // The file's own errors, by their code alone: never Node's message, with its path.
    return { found: 'unreadable', why: because(cause) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Why SQLite couldn't read a database: its own message, which names what failed (a table,
 * a lock), never a value; any other error by its code alone.
 */
function databaseFailure(cause: unknown): KeyFound {
  if (codeOf(cause) !== 'ERR_SQLITE_ERROR') {
    return { found: 'unreadable', why: because(cause) };
  }
  const said = cause instanceof Error ? cause.message : String(cause);
  return { found: 'unreadable', why: `it could not be read as a database (${said})` };
}

/** Why a key file found gave no key Mediaplane can keep; undefined for none at all. */
function noKey(found: KeyFound): string | undefined {
  if (found.found === 'unreadable') return found.why;
  if (found.found === 'key') {
    return UNKEEPABLE_KEY;
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
 * - A key that is another app's, as the store holds it or as it is found, is an error too,
 *   as keep says: an app can hold another's key (Prowlarr holds the arrs'), but never as
 *   its own, and Mediaplane would send that app's key to it.
 * - A key the app made (Jellyfin's) that can't be found is found by the app's setup, which
 *   signs in as the shared admin. That needs the password the app has: with the admin
 *   password to be generated (`newPassword`), which the app doesn't know, it is a warning,
 *   and the app is `unfound`: the warning says why it is left unwired. Not while the
 *   app's appdata says its startup wizard is open: its setup makes the admin, with the new
 *   password, and then the key.
 * Reads only; never says a key's value.
 */
export async function recoverKeys(
  stack: ResolvedStack,
  store: SecretStore,
  newPassword: boolean,
): Promise<{ recovered: RecoveredKey[]; unfound: string[]; diagnostics: Diagnostic[] }> {
  const found: (RecoveredKey & { where: string; appName: string })[] = [];
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
      const read = await readKeyFile(stack.home, id, file);
      const where = keyFilePath(id, file);
      if (read.found === 'key' && APP_SECRET.test(read.value)) {
        found.push({ app: id, name, value: read.value, where, appName });
        continue;
      }
      const why = noKey(read);
      const made = 'createdBy' in source;
      if (why === undefined || (made ? !newPassword : read.found === 'none')) continue;
      // Its wizard open: the setup makes the admin with the new password, then the key.
      if (made && (await appSetupDone(stack.home, app)) === false) continue;
      // An app that takes its key from its environment takes a new one at its next start;
      // what holds the old one then is the resources that use it. One that keeps it only
      // in its file is locked against Mediaplane's new key.
      const fromEnvironment = app.def.credentials.some(
        (step) => step.step === 'env' && step.secret === name,
      );
      const consequence = fromEnvironment
        ? 'The old key is still held by the resources that use it; a new key would break them'
        : `A new key would lock Mediaplane out of ${appName}, which still holds the old one`;
      const lacks = cantGive(id, name, where, appName, why);
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
  const recovered: RecoveredKey[] = [];
  for (const key of found) {
    // Another app's, as the store holds it or as it was found now.
    const others = [
      ...Object.entries(store.apps).flatMap(([app, secrets]) =>
        Object.entries(secrets).map(([name, value]) => ({ app, name, value })),
      ),
      ...found,
    ]
      .filter(
        (other) =>
          other.value === key.value &&
          !(other.app === key.app && other.name === key.name),
      )
      .map((other) => `${other.app}.${other.name}`);
    if (others.length === 0) {
      recovered.push({ app: key.app, name: key.name, value: key.value });
      continue;
    }
    diagnostics.push(
      error(
        'keys.unrecoverable',
        cantGive(
          key.app,
          key.name,
          key.where,
          key.appName,
          `it holds the key Mediaplane holds for ${[...new Set(others)].sort(compare).join(', ')}`,
        ),
        {
          hint: `an app can hold another app's key, but never as its own: put ${key.appName}'s own key back in ${key.where}, or move appdata/${key.app} aside to start ${key.appName} afresh, then run plan again; see ${REBUILD_RUNBOOK}`,
        },
      ),
    );
  }
  diagnostics.sort((a, b) => compare(a.message, b.message));
  return { recovered, unfound, diagnostics };
}

/** "state/secrets.json has no <app>.<name>, and <where>, ..., can't give it: <why>". */
function cantGive(
  app: string,
  name: string,
  where: string,
  appName: string,
  why: string,
): string {
  return `state/secrets.json has no ${app}.${name}, and ${where}, where ${appName} keeps it, can't give it: ${why}`;
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
