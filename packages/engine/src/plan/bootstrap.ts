import { join } from 'node:path';
import { error, warning, type Diagnostic } from '../diagnostics';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { REBUILD_RUNBOOK } from '../secrets/recover';
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
  /**
   * The apps whose setup would only sign in with an admin password apply is yet to
   * generate (withoutSignInsToCome): not set up, and their resources skipped.
   */
  held: string[];
  diagnostics: Diagnostic[];
}

/**
 * Why the admin password is one apply is yet to generate: state/secrets.json has none, as
 * after a lost store (`generate`), or `--rotate admin.password` (`rotate`).
 */
export type PasswordToGenerate = 'generate' | 'rotate';

/**
 * Each app with a first-run setup (`bootstrap`) that apply will finish: one whose key the
 * store doesn't hold, or whose appdata doesn't say the setup is done (a Jellyfin whose
 * appdata was emptied starts its wizard again). It starts unpublished unless its appdata
 * says the setup is done, when nobody can claim it any more. A file Mediaplane can't read
 * says nothing, so the stored key decides, with a warning that it can't tell; for a setup
 * that makes no key (Seerr's), there is none to decide, so the app starts unpublished and
 * is set up again, with that warning. A setup that makes no key counts as done only when
 * its file says so and the store names the app (`setUp`): an app set up by someone else,
 * or before Mediaplane knew, starts unpublished, and its setup checks it is Mediaplane's.
 * An app with a setup that runs inside another app's network is an error: that app
 * publishes its ports, and `ports: !reset []` on the app's own service can't unpublish
 * them. With an admin password apply is yet to generate (`toGenerate`), a setup that
 * would only sign in is held back (withoutSignInsToCome). Reads only; writes nothing.
 */
export async function inspectBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
  toGenerate?: PasswordToGenerate,
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
    // A key the app made says its setup was done once; without one, its file and the
    // store's record of the setup (`setUp`) say, below.
    const made =
      setup.secret !== undefined && store.apps[app.def.id]?.[setup.secret] !== undefined;
    const done = await appSetupDone(stack.home, app);
    if (done === undefined && (made || setup.secret === undefined)) {
      const decides = made
        ? 'the stored key decides'
        : `${app.def.name} starts unpublished, and is set up again, until it can`;
      diagnostics.push(
        warning(
          'bootstrap.unreadable',
          `Mediaplane can't read the file in ${app.def.name}'s appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; ${decides}`,
          { hint: `check the permissions of appdata/${app.def.id}` },
        ),
      );
    }
    // Set up already: its key made, and its file not saying otherwise; or, for a setup
    // that makes no key, its file saying so and Mediaplane knowing the setup is its own
    // (the store names it): a file alone doesn't say who set the app up.
    const known = store.setUp?.includes(app.def.id) === true;
    if (setup.secret === undefined ? done === true && known : made && done !== false) {
      continue;
    }
    changes.push({
      app: app.def.id,
      // A setup that makes no key starts unpublished until it is known to be
      // Mediaplane's.
      unpublished: setup.secret === undefined || done !== true,
    });
  }
  const kept = withoutSignInsToCome(stack, changes, toGenerate);
  return {
    changes: kept.changes,
    held: kept.held,
    diagnostics: [...diagnostics, ...kept.diagnostics],
  };
}

/**
 * `changes` without the setups that would only sign in, as the shared admin, to find the
 * key the setup made (published, its secret the app's API key), when the admin password
 * is one apply is yet to generate (`toGenerate`): the app has never had it, so the
 * sign-in could only fail, leaving a mark in the app (decision 15). Each such app is
 * `held`, with an error naming it: its resources are skipped. A setup that starts its app
 * unpublished makes the admin, or signs in through another app, and is kept. Pure.
 */
export function withoutSignInsToCome(
  stack: ResolvedStack,
  changes: readonly BootstrapChange[],
  toGenerate: PasswordToGenerate | undefined,
): { changes: BootstrapChange[]; held: string[]; diagnostics: Diagnostic[] } {
  const kept: BootstrapChange[] = [];
  const held: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const change of changes) {
    const app = stack.apps.find((a) => a.def.id === change.app);
    const secret = app?.def.bootstrap?.secret;
    const signsInOnly =
      !change.unpublished && secret !== undefined && secret === app?.def.api?.key.secret;
    if (toGenerate === undefined || app === undefined || !signsInOnly) {
      kept.push(change);
      continue;
    }
    held.push(change.app);
    diagnostics.push(needsPassword(app, toGenerate));
  }
  return { changes: kept, held, diagnostics };
}

/** The code of the error for a setup held back by withoutSignInsToCome. */
export const NEEDS_PASSWORD = 'bootstrap.needs-password';

/** The error for an app whose setup would sign in with a password it never had. */
function needsPassword(app: ResolvedApp, toGenerate: PasswordToGenerate): Diagnostic {
  const name = app.def.name;
  return error(
    NEEDS_PASSWORD,
    `${name} takes no key Mediaplane holds, and only its first-run setup can find one, signing in as the shared admin; but the admin password is one apply is yet to generate, which ${name} has never had. Apply doesn't sign in to ${name}, and leaves it unwired`,
    {
      hint:
        toGenerate === 'rotate'
          ? `run apply without --rotate first, which finds ${name}'s key with the admin password it has, then rotate it; see ${REBUILD_RUNBOOK}`
          : `set admin.password to a file holding the password ${name}'s admin has, then run apply again, which finds its key; the runbook has the other ways: ${REBUILD_RUNBOOK}`,
    },
  );
}

/**
 * The apps whose first-run setup runs again, published, because they refuse the key it
 * made (`refusing`, by app: spec §6.3, "a key changed at its source"), as Jellyfin does once
 * its key is deleted by hand. Only one whose appdata says its setup is done, so nobody can
 * claim it, and that `listed` doesn't name already: its setup signs in as the shared
 * admin, finds the key named for Mediaplane or makes another, and saves it; the resources
 * that hold the old one take the new one in the wire step. Reads only.
 */
export async function setupsToMakeKeys(
  stack: ResolvedStack,
  refusing: readonly string[],
  listed: readonly BootstrapChange[],
): Promise<BootstrapChange[]> {
  const changes: BootstrapChange[] = [];
  for (const app of stack.apps) {
    const setup = app.def.bootstrap;
    const id = app.def.id;
    if (setup?.secret === undefined || setup.secret !== app.def.api?.key.secret) continue;
    if (!refusing.includes(id) || listed.some((change) => change.app === id)) continue;
    if ((await appSetupDone(stack.home, app)) === true) {
      changes.push({ app: id, unpublished: false });
    }
  }
  return changes;
}

/** The apps whose first-run setup apply will finish; see `inspectBootstrap`. */
export async function planBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<BootstrapChange[]> {
  return (await inspectBootstrap(stack, store)).changes;
}

/**
 * Whether `app`'s appdata, in the stack at `home`, says its first-run setup is done:
 * undefined when the file can't be read, or the app has no setup.
 */
export async function appSetupDone(
  home: string,
  app: ResolvedApp,
): Promise<boolean | undefined> {
  const setup = app.def.bootstrap;
  if (setup === undefined) return undefined;
  return setupDone(
    join(home, 'appdata', app.def.id, setup.done.path),
    setup.done.pattern,
  );
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
