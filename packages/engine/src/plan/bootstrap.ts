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
   * The setups held back, as they would have started (withoutSignInsToCome, heldThrough):
   * not run, their resources skipped, and an app whose setup is open, or can't be told,
   * still started without its ports.
   */
  held: BootstrapChange[];
  diagnostics: Diagnostic[];
}

/** Which apps the admin password apply signs in with is one they have never had. */
export interface PasswordsToCome {
  /**
   * Apply generates it in this run, so no app has it: state/secrets.json has none, as
   * after a lost store (`generate`), or `--rotate admin.password` (`rotate`).
   */
  toGenerate?: 'generate' | 'rotate';
  /** The apps that have never had the one the store holds (`shared.adminPasswordNotIn`). */
  notIn?: readonly string[];
  /**
   * The apps whose being left unwired another diagnostic explains already (Jellyfin's
   * `keys.unrecoverable`): held with no warning of their own. Never an error's.
   */
  explained?: readonly string[];
}

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
 * them. A setup that would sign in with an admin password the app has never had
 * (`toCome`) is held back (withoutSignInsToCome). Reads only; writes nothing.
 */
export async function inspectBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
  toCome: PasswordsToCome = {},
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
  const kept = await withoutSignInsToCome(stack, changes, toCome);
  const through = heldThrough(stack, kept.changes, kept.held, toCome);
  return {
    changes: through.changes,
    held: [...kept.held, ...through.held],
    diagnostics: [...diagnostics, ...kept.diagnostics, ...through.diagnostics],
  };
}

/**
 * `changes` without the setups that would sign in, as the shared admin, with an admin
 * password the app has never had (`toCome`): one generated in this run, or the one the
 * store holds for an app listed in `notIn`. Such a sign-in could only fail, leaving a mark
 * in the app (decision 15). Only a setup whose secret is the app's API key signs in so,
 * to find the key, unless its startup wizard is shown to be open (its appdata says it
 * isn't done): then the setup makes the admin, with that password. Each held app's
 * resources are skipped. A warning names it, unless `explained` does; under `rotate`, an
 * app that still has the password Mediaplane holds is an error, which stops the plan:
 * rotating would leave it with a password Mediaplane no longer holds. Reads only.
 */
export async function withoutSignInsToCome(
  stack: ResolvedStack,
  changes: readonly BootstrapChange[],
  toCome: PasswordsToCome,
): Promise<HeldSetups> {
  const kept: BootstrapChange[] = [];
  const held: BootstrapChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const change of changes) {
    const app = stack.apps.find((a) => a.def.id === change.app);
    const secret = app?.def.bootstrap?.secret;
    const listed = toCome.notIn?.includes(change.app) === true;
    const lacks = listed || toCome.toGenerate !== undefined;
    const signsIn =
      app !== undefined &&
      lacks &&
      secret !== undefined &&
      secret === app.def.api?.key.secret &&
      (!change.unpublished || (await appSetupDone(stack.home, app)) !== false);
    if (app === undefined || !signsIn) {
      kept.push(change);
      continue;
    }
    held.push(change);
    if (!listed && toCome.toGenerate === 'rotate') {
      diagnostics.push(rotateBlocked(app));
    } else if (toCome.explained?.includes(change.app) !== true) {
      diagnostics.push(needsPassword(app));
    }
  }
  return { changes: kept, held, diagnostics };
}

/** What a filter of setups kept, held back, and said. */
export interface HeldSetups {
  changes: BootstrapChange[];
  held: BootstrapChange[];
  diagnostics: Diagnostic[];
}

/**
 * `changes` without the setups that go through an app whose own is held (`held`): one
 * that comes after it (`integration.after`), as Seerr signs in through Jellyfin. Held too,
 * as it would have started (an open one still without its ports), with a diagnostic of
 * the held app's level that names both. Pure.
 */
export function heldThrough(
  stack: ResolvedStack,
  changes: readonly BootstrapChange[],
  held: readonly BootstrapChange[],
  toCome: PasswordsToCome,
): HeldSetups {
  /** The level of each held app's diagnostic: an error only for a rotation it stops. */
  const levels = new Map(
    held.map((h) => [
      h.app,
      toCome.toGenerate === 'rotate' && toCome.notIn?.includes(h.app) !== true
        ? ('error' as const)
        : ('warning' as const),
    ]),
  );
  let kept = [...changes];
  const more: BootstrapChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (let found = true; found;) {
    found = false;
    for (const change of kept) {
      const app = stack.apps.find((a) => a.def.id === change.app);
      const through = (app?.def.integration?.after ?? []).find((id) => levels.has(id));
      if (app === undefined || through === undefined) continue;
      const level = levels.get(through) ?? 'warning';
      const name = stack.apps.find((a) => a.def.id === through)?.def.name ?? through;
      const make = level === 'error' ? error : warning;
      diagnostics.push(
        make(
          NEEDS_PASSWORD,
          `${app.def.name}'s first-run setup signs in through ${name}, whose own is held: it is held too, and waits on ${name}'s admin password`,
          {
            hint: `once ${name} has the admin password Mediaplane gives the apps, apply sets ${app.def.name} up; see ${REBUILD_RUNBOOK}`,
          },
        ),
      );
      levels.set(change.app, level);
      more.push(change);
      kept = kept.filter((c) => c !== change);
      found = true;
      break;
    }
  }
  return { changes: kept, held: more, diagnostics };
}

/** The code of what plan says of a setup held back by withoutSignInsToCome. */
export const NEEDS_PASSWORD = 'bootstrap.needs-password';

/** The warning for an app whose setup would sign in with a password it never had. */
function needsPassword(app: ResolvedApp): Diagnostic {
  const name = app.def.name;
  return warning(
    NEEDS_PASSWORD,
    `${name} takes no key Mediaplane holds, and only its first-run setup can find one, by signing in as the shared admin; but ${name} has never had the admin password Mediaplane gives the apps, so apply doesn't sign in to it, and leaves it unwired`,
    {
      hint: `set admin.password to a file holding the password ${name}'s admin has, or make an API key named Mediaplane in ${name}, then run apply again; see ${REBUILD_RUNBOOK}`,
    },
  );
}

/** The error for a rotation that would leave `app` with a password nobody holds. */
function rotateBlocked(app: ResolvedApp): Diagnostic {
  const name = app.def.name;
  return error(
    NEEDS_PASSWORD,
    `${name} takes no key Mediaplane holds, and only its first-run setup can find one, by signing in as the shared admin with the admin password it has: rotating that password now would leave ${name} with one Mediaplane no longer holds`,
    {
      hint: `run apply without --rotate first, which finds ${name}'s key, then rotate it; see ${REBUILD_RUNBOOK}`,
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
