import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { KeyFile } from '../catalog/types';
import { readStackFile, type StackFile } from '../config/overrides-file';
import { error, warning, type Diagnostic } from '../diagnostics';
import { APPDATA_DIR } from '../paths';
import type { ResolvedStack } from '../resolver/resolve';
import { writeFileAtomic } from '../util/atomic';
import { codeOf } from '../util/error-code';
import { isInside } from '../util/path';
import { compare } from '../util/sort';
import { keyFilePath, readKeyFile, REBUILD_RUNBOOK } from './recover';
import type { SecretStore } from './store';

/** A key file that says how to write its key back. */
type WritableKeyFile = Extract<KeyFile, { read: unknown }> & {
  write: NonNullable<Extract<KeyFile, { read: unknown }>['write']>;
};

/** The app's key files that say how to write their key back, by the secret's name. */
function writable(
  files: Readonly<Record<string, KeyFile>> | undefined,
): [string, WritableKeyFile][] {
  return Object.entries(files ?? {})
    .filter((entry): entry is [string, WritableKeyFile] => 'write' in entry[1])
    .sort(([a], [b]) => compare(a, b));
}

/**
 * The path, relative to the home, of every file whose key planKeyRestores looks after:
 * one of them that lacks its key has it put back, rather than reported as from before
 * Mediaplane seeded the app.
 */
export function restorableKeyFiles(stack: ResolvedStack): Set<string> {
  return new Set(
    stack.apps.flatMap((app) =>
      writable(app.def.keyFiles).map(([, file]) => keyFilePath(app.def.id, file)),
    ),
  );
}

/**
 * The key file, read to be rewritten: refused, with why, as Keep mine refuses a stack.yaml
 * (readStackFile): a link, a file with other names, or one of another user or of a group
 * Mediaplane's user isn't in; and one in a folder that leads out of the app's appdata.
 */
async function openKeyFile(
  home: string,
  app: string,
  file: KeyFile,
): Promise<{ ok: true; path: string; file: StackFile } | { ok: false; why: string }> {
  const path = join(home, keyFilePath(app, file));
  try {
    const folder = await realpath(dirname(path));
    if (!isInside(folder, await realpath(join(home, APPDATA_DIR, app)))) {
      return { ok: false, why: `a folder on its way leads outside appdata/${app}` };
    }
    const read = await readStackFile(path);
    return read.ok
      ? { ok: true, path, file: read.file }
      : { ok: false, why: read.reason };
  } catch (cause) {
    const code = codeOf(cause);
    return {
      ok: false,
      why: `it could not be read${code === undefined ? '' : ` (${code})`}`,
    };
  }
}

/**
 * The keys to put back at their source (spec §6.3, "Re-apply restores the old key at the
 * source"): each key of the store's (`store`, with those apply generates) that its app
 * keeps in a file of its own that Mediaplane can write, which holds another key, or none,
 * as one from before Slice 3a does. The app reads the file when it starts, so apply stops
 * it first. A file that is not there says nothing; one Mediaplane can't read is a warning
 * that it can't tell whether it holds the key. One it can read but not rewrite safely is an error for a file without the key, which the app can't work
 * with, and a warning for one with another, which `mediaplane keep` can keep. Reads only.
 */
export async function planKeyRestores(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<{ restore: string[]; diagnostics: Diagnostic[] }> {
  const restore: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of stack.apps) {
    const { id, name: appName } = app.def;
    for (const [name, file] of writable(app.def.keyFiles)) {
      const value = store.apps[id]?.[name];
      if (value === undefined) continue;
      const found = await readKeyFile(stack.home, id, file);
      if (found.found === 'absent') continue;
      const key = `${id}.${name}`;
      const path = keyFilePath(id, file);
      if (found.found === 'unreadable') {
        // Never the file's content nor the reader's message: its short reason alone.
        diagnostics.push(
          warning(
            'keys.restore',
            `Mediaplane can't tell whether ${path} holds Mediaplane's key for ${appName} (${key}): ${found.why}`,
            {
              hint: `make ${path} a regular file that Mediaplane may read, then run plan again; see ${REBUILD_RUNBOOK}`,
            },
          ),
        );
        continue;
      }
      if (found.found === 'key' && found.value === value) continue;
      const opened = await openKeyFile(stack.home, id, file);
      const placed = opened.ok ? file.write(opened.file.text, value) : undefined;
      if (opened.ok && placed !== undefined) {
        restore.push(key);
        continue;
      }
      const why = opened.ok
        ? "Mediaplane can't tell where in it the key goes"
        : opened.why;
      const holds =
        found.found === 'key'
          ? `holds another key than the one Mediaplane holds for ${appName} (${key})`
          : `lacks the key Mediaplane holds for ${appName} (${key}), as a file from before Mediaplane seeded ${appName} does`;
      diagnostics.push(
        (found.found === 'key' ? warning : error)(
          'keys.restore',
          `${path} ${holds}, and Mediaplane can't put its key there: ${why}`,
          {
            hint:
              found.found === 'key'
                ? `fix what stops it, as said above, then run apply, which puts the key back and restarts ${appName}; see ${REBUILD_RUNBOOK}`
                : `stop ${appName}, move ${path} aside, then run apply, which writes a new one; see ${REBUILD_RUNBOOK}`,
          },
        ),
      );
    }
  }
  return { restore, diagnostics };
}

/**
 * Put each key ("<app>.<name>") back in its app's own file (planKeyRestores), with the
 * store's value, while the app is stopped: the file's mode and group as they were, all at
 * once, and only in place of the file read. Returns the keys it put back. Throws an error
 * that names the file, never the key, when it can't.
 */
export async function restoreKeys(
  stack: ResolvedStack,
  store: SecretStore,
  keys: readonly string[],
): Promise<string[]> {
  const done: string[] = [];
  for (const key of keys) {
    // App ids hold no ".": what comes before the first is the app.
    const [id = '', name = ''] = key.split(/\.(.*)/);
    const app = stack.apps.find((candidate) => candidate.def.id === id);
    const file = writable(app?.def.keyFiles).find(([secret]) => secret === name)?.[1];
    const value = store.apps[id]?.[name];
    if (file === undefined || value === undefined) {
      throw new Error(`${key} can't be put back: Mediaplane has no file or key for it`);
    }
    const opened = await openKeyFile(stack.home, id, file);
    const where = keyFilePath(id, file);
    if (!opened.ok) throw new Error(`cannot put ${key} back in ${where}: ${opened.why}`);
    const text = file.write(opened.file.text, value);
    if (text === undefined) {
      throw new Error(
        `cannot put ${key} back in ${where}: Mediaplane can't tell where it goes`,
      );
    }
    const { mode, gid, dev, ino } = opened.file;
    try {
      await writeFileAtomic(opened.path, text, mode, {
        group: gid,
        replaces: { dev, ino },
      });
    } catch (cause) {
      // writeFileAtomic names the path and the reason, never the content.
      throw new Error(
        `cannot put ${key} back: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    done.push(key);
  }
  return done;
}
