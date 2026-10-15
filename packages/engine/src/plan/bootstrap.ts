import { join } from 'node:path';
import type { ResolvedStack } from '../resolver/resolve';
import type { SecretStore } from '../secrets/store';
import { readIfExists } from '../util/fs';

/** An app whose first-run setup apply will finish (spec §5 step 9, §6.4). */
export interface BootstrapChange {
  /** The app, such as "jellyfin". */
  app: string;
  /**
   * Whether it starts with no published ports first: its setup is open to anyone who
   * reaches it, or Mediaplane can't tell. Otherwise apply only signs in to make its key.
   */
  unpublished: boolean;
}

/**
 * Each app with a first-run setup (`bootstrap`) that apply will finish: one whose key the
 * store doesn't hold, or whose appdata doesn't say the setup is done (a Jellyfin whose
 * appdata was emptied starts its wizard again). It starts unpublished unless its appdata
 * says the setup is done, when nobody can claim it any more. A file Mediaplane can't read
 * says nothing, so the stored key decides. Reads only; writes nothing.
 */
export async function planBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<BootstrapChange[]> {
  const changes: BootstrapChange[] = [];
  for (const app of stack.apps) {
    const setup = app.def.bootstrap;
    if (setup === undefined) continue;
    const stored = store.apps[app.def.id]?.[setup.secret] !== undefined;
    const done = await setupDone(
      join(stack.home, 'appdata', app.def.id, setup.done.path),
      setup.done.pattern,
    );
    if (stored && done !== false) continue;
    changes.push({ app: app.def.id, unpublished: done !== true });
  }
  return changes;
}

/** Whether the file at `path` says the setup is done; undefined when it can't be read. */
async function setupDone(path: string, pattern: RegExp): Promise<boolean | undefined> {
  try {
    const text = await readIfExists(path);
    return text !== undefined && pattern.test(text);
  } catch {
    return undefined;
  }
}
