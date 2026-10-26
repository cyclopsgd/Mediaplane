import { lstat, readFile, realpath } from 'node:fs/promises';
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

/**
 * What `file`, in `app`'s appdata folder in the home, holds. A file whose real path leads
 * out of the app's folder is never read: an app that owns its folder could otherwise have
 * Mediaplane take another app's key, or another file, as its own. Never throws.
 */
export async function readKeyFile(
  home: string,
  app: string,
  file: KeyFile,
): Promise<KeyFound> {
  const folder = join(home, APPDATA_DIR, app);
  const path = join(home, keyFilePath(app, file));
  try {
    await lstat(path);
  } catch (cause) {
    const code = codeOf(cause);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { found: 'absent' };
    return { found: 'unreadable', why: because(cause) };
  }
  let real: string;
  try {
    real = await realpath(path);
    if (!isInside(real, await realpath(folder))) {
      return {
        found: 'unreadable',
        why: `it leads outside ${posix.join(APPDATA_DIR, app)}`,
      };
    }
  } catch (cause) {
    return { found: 'unreadable', why: because(cause) };
  }
  if ('read' in file) {
    let text: string;
    try {
      text = await readFile(real, 'utf8');
    } catch (cause) {
      return { found: 'unreadable', why: because(cause) };
    }
    const value = file.read(text);
    return value === undefined || value === ''
      ? { found: 'none' }
      : { found: 'key', value };
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(await databaseAt(real), { readOnly: true });
    const row = db.prepare(file.sqlite.query).get();
    const value = row?.[file.sqlite.column];
    if (row === undefined) return { found: 'none' };
    return typeof value === 'string' && value !== ''
      ? { found: 'key', value }
      : { found: 'unreadable', why: `its ${file.sqlite.column} isn't text` };
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
 *   password to be generated (`newPassword`), which the app doesn't know, it is a warning.
 * Reads only; never says a key's value.
 */
export async function recoverKeys(
  stack: ResolvedStack,
  store: SecretStore,
  newPassword: boolean,
): Promise<{ recovered: RecoveredKey[]; diagnostics: Diagnostic[] }> {
  const recovered: RecoveredKey[] = [];
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
      const lacks = `state/secrets.json has no ${id}.${name}, and ${where}, where ${appName} keeps it, can't give it: ${why}`;
      diagnostics.push(
        made
          ? warning(
              'keys.unrecoverable',
              `${lacks}. The admin password is to be generated too, so apply can't sign in to ${appName} to find its key, and leaves ${appName} unwired`,
              {
                hint: `set admin.password to a file holding the password ${appName}'s admin has, then run plan again; the runbook has the other ways: ${REBUILD_RUNBOOK}`,
              },
            )
          : error(
              'keys.unrecoverable',
              `${lacks}. A new key would lock Mediaplane out of ${appName}, which still holds the old one`,
              {
                hint: `make ${where} readable by the user Mediaplane runs as (MEDIAPLANE_UID in its container), or move appdata/${id} aside to start ${appName} afresh, then run plan again; see ${REBUILD_RUNBOOK}`,
              },
            ),
      );
    }
  }
  return { recovered, diagnostics };
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
