import { join } from 'node:path';
import { error, warning, type Diagnostic } from '../diagnostics';
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

/** What the plan found of first-run setups: the apps to set up, and what to tell the user. */
export interface BootstrapPlan {
  changes: BootstrapChange[];
  diagnostics: Diagnostic[];
}

/**
 * Each app with a first-run setup (`bootstrap`) that apply will finish: one whose key the
 * store doesn't hold, or whose appdata doesn't say the setup is done (a Jellyfin whose
 * appdata was emptied starts its wizard again). It starts unpublished unless its appdata
 * says the setup is done, when nobody can claim it any more. A file Mediaplane can't read
 * says nothing, so the stored key decides, with a warning that it can't tell. An app with a
 * setup that runs inside another app's network is an error: that app publishes its ports,
 * and `ports: !reset []` on the app's own service can't unpublish them. Reads only;
 * writes nothing.
 */
export async function inspectBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<BootstrapPlan> {
  const changes: BootstrapChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of stack.apps) {
    const setup = app.def.bootstrap;
    if (setup === undefined) continue;
    if (app.networkVia !== undefined) {
      diagnostics.push(
        error(
          'bootstrap.network-via',
          `${app.def.name} has a first-run setup but runs inside ${app.networkVia}'s network, which publishes its ports: Mediaplane can't keep it unpublished until it is set up`,
          { hint: `run ${app.def.name} in its own network` },
        ),
      );
      continue;
    }
    const stored = store.apps[app.def.id]?.[setup.secret] !== undefined;
    const done = await setupDone(
      join(stack.home, 'appdata', app.def.id, setup.done.path),
      setup.done.pattern,
    );
    if (done === undefined && stored) {
      diagnostics.push(
        warning(
          'bootstrap.unreadable',
          `Mediaplane can't read the file in ${app.def.name}'s appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; the stored key decides`,
          { hint: `check the permissions of appdata/${app.def.id}` },
        ),
      );
    }
    if (stored && done !== false) continue;
    changes.push({ app: app.def.id, unpublished: done !== true });
  }
  return { changes, diagnostics };
}

/** The apps whose first-run setup apply will finish; see `inspectBootstrap`. */
export async function planBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<BootstrapChange[]> {
  return (await inspectBootstrap(stack, store)).changes;
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
