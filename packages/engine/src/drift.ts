import { join, resolve } from 'node:path';
import { error, warning, type Diagnostic } from './diagnostics';
import { readState, writeResources } from './integrations/resources';
import {
  DRIFT_RUNBOOK,
  type Drift,
  type SecretCheck,
  type WiringChange,
} from './integrations/wiring';
import { STACK_PATH } from './paths';
import { planStack, type PlanOptions } from './plan/plan';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { readIfExists } from './util/fs';

export interface DriftOptions extends PlanOptions {
  now?: () => Date;
}

/** What `mediaplane drift` found (spec §6.3): never a secret's value. */
export interface DriftResult {
  /** False when it couldn't look: an error diagnostic says why. */
  ok: boolean;
  /**
   * Nothing changed outside Mediaplane, and it saw everything: every resource looked at,
   * and every secret checked.
   */
  clear: boolean;
  /** What changed in the apps outside Mediaplane since it applied them. */
  drift: Drift[];
  /** How each secret was checked: passed, refused, or unchecked and why. */
  checks: SecretCheck[];
  /** The resources it couldn't look at, and why: the drift there is unknown. */
  unchecked: { resource: string; reason: string }[];
  diagnostics: Diagnostic[];
}

/** Why a resource checked after the start, in plan, isn't looked at by drift. */
const NOT_RUNNING =
  "its app isn't running and healthy, or is to be set up first: run apply, then drift again";

/**
 * Report what changed in the apps outside Mediaplane since it applied them (spec §5.2,
 * §6.3): `plan`, in observe-only mode, under apply's lock, so neither runs while the
 * other does. It changes nothing in the apps but for the marks its checks leave, which
 * it keeps few: a secret it finds refused isn't checked again until apply sets it, and
 * one that passed only once its resource's `checkEvery` has gone by. To know that, it
 * keeps each check's verdict and time in state/resources.json, its one write. A schedule
 * can call it as it is (M2).
 */
export async function drift(options: DriftOptions): Promise<DriftResult> {
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  if ((await readIfExists(join(home, STACK_PATH))) === undefined) {
    return failedDrift((await planStack({ ...options, home })).result.diagnostics);
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, now, 'drift');
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return failedDrift([
      error('drift.locked', cause.message, {
        hint: 'wait for it to finish, then run drift again; if nothing is running, delete state/lock',
      }),
    ]);
  }
  try {
    const { result } = await planStack({ ...options, home, drift: { now } });
    if (!result.ok) return failedDrift(result.diagnostics);
    const diagnostics = [...result.diagnostics];
    try {
      await keepChecks(home, result.checks, result.drift, now());
    } catch (cause) {
      diagnostics.push(
        warning(
          'drift.checks-not-kept',
          `what drift found of each secret could not be kept in state/resources.json: ${cause instanceof Error ? cause.message : String(cause)}`,
          {
            hint: `the next drift checks them again; check that this user can write to state/. See ${DRIFT_RUNBOOK}`,
          },
        ),
      );
    }
    const unchecked = result.wiring.flatMap(notLooked);
    return {
      ok: true,
      clear:
        result.drift.length === 0 &&
        unchecked.length === 0 &&
        result.checks.every((check) => check.verdict !== 'unchecked'),
      drift: result.drift,
      checks: result.checks,
      unchecked,
      diagnostics,
    };
  } finally {
    await lock.release();
  }
}

/** A resource drift couldn't look at, and why; none for one it did. */
function notLooked(change: WiringChange): { resource: string; reason: string }[] {
  if (change.action === 'after-start') {
    return [{ resource: change.resource, reason: NOT_RUNNING }];
  }
  if (change.action === 'unknown') {
    return [
      {
        resource: change.resource,
        reason: change.reason ?? 'the app could not be asked',
      },
    ];
  }
  return [];
}

/** A check drift ran now, rather than took from the last one. */
type Ran = SecretCheck & { verdict: 'passed' | 'refused'; at?: undefined };

/**
 * Keep the verdict and time of each check drift ran now, in the record of its resource:
 * what lets the next drift leave a refused secret, or one that passed lately, unchecked.
 * And each app found now refusing its own key (`key` drift on the app), by "<app>.<key>":
 * neither plan nor drift sends it that key again until apply checks it. Written only when
 * something changed, and only for resources Mediaplane recorded.
 */
async function keepChecks(
  home: string,
  checks: readonly SecretCheck[],
  drift: readonly Drift[],
  at: Date,
): Promise<void> {
  const ran = checks.filter(
    (check): check is Ran => check.at === undefined && check.verdict !== 'unchecked',
  );
  const refusing = drift.filter(
    (d) => d.kind === 'key' && d.source === undefined && d.since === undefined,
  );
  if (ran.length === 0 && refusing.length === 0) return;
  const { resources: known, keys } = await readState(home);
  const when = at.toISOString();
  let changed = false;
  for (const check of ran) {
    const record = known[check.resource];
    if (record === undefined) continue;
    record.checks = {
      ...record.checks,
      [check.secret]: { verdict: check.verdict, at: when },
    };
    changed = true;
  }
  for (const { resource, secret = '' } of refusing) {
    keys[`${resource}.${secret}`] = { verdict: 'refused', at: when };
    changed = true;
  }
  if (changed) await writeResources(home, known, keys);
}

function failedDrift(diagnostics: Diagnostic[]): DriftResult {
  return { ok: false, clear: false, drift: [], checks: [], unchecked: [], diagnostics };
}
