import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { overrideLine, stackFileProblem, withOverride } from './config/overrides-file';
import { error, warning, type Diagnostic } from './diagnostics';
import {
  isUnmanaged,
  overrideRefused,
  overrideTarget,
  UNMANAGED,
} from './integrations/overrides';
import { readResources, writeResources } from './integrations/resources';
import type { Scalar } from './integrations/types';
import { DRIFT_RUNBOOK } from './integrations/wiring';
import { STACK_PATH } from './paths';
import { planStack, type PlanOptions } from './plan/plan';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { writeFileAtomic } from './util/atomic';
import { readIfExists } from './util/fs';

export interface KeepOptions extends PlanOptions {
  /** What to keep: `<app>.<resource>.<field>`, or `<app>.<resource>` for one deleted. */
  path: string;
  now?: () => Date;
}

/** What `mediaplane keep` did (spec §6.3, Keep mine): never a secret's value. */
export interface KeepResult {
  ok: boolean;
  /** The override key it wrote under `overrides:`. */
  key: string;
  /** Its value: the app's, or `unmanaged` for a resource deleted outside Mediaplane. */
  value: Scalar | undefined;
  diagnostics: Diagnostic[];
}

/**
 * Keep mine (spec §6.3): take the app's own value of a managed field changed outside
 * Mediaplane as the stack's, written as an override in stack.yaml, or stop managing a
 * resource deleted outside it (`<app>.<resource>: unmanaged`). Only what drift finds
 * there is kept: a managed field that drifted, or a resource that is missing. It looks
 * at that resource alone: it checks that its app takes Mediaplane's key, reads the
 * resource, and checks none of its secrets, so every request it makes goes to the app's
 * own address on the stack; what only the app can say (Seerr's profile) is what was
 * applied. It writes stack.yaml by adding one line, keeping the rest as it is, its mode
 * and its group (not an ACL), and never a secret, and then records the value as applied
 * in state/resources.json, so that drift is clear and apply has nothing to do for it. It
 * runs under apply's lock.
 */
export async function keep(options: KeepOptions): Promise<KeepResult> {
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  const key = options.path;
  const refused = (diagnostics: Diagnostic[]): KeepResult => ({
    ok: false,
    key,
    value: undefined,
    diagnostics,
  });
  const named = overrideTarget(options.catalog, key);
  if (!named.ok) return refused([named.diagnostic]);
  const { spec, def, field } = named.target;
  const address = `${def.id}.${spec.name}`;
  const stackPath = join(home, STACK_PATH);
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  if ((await readIfExists(stackPath)) === undefined) {
    return refused((await planStack({ ...options, home })).result.diagnostics);
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, now, 'keep');
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return refused([
      error('keep.locked', cause.message, {
        hint: 'wait for it to finish, then run keep again; if nothing is running, delete state/lock',
      }),
    ]);
  }
  try {
    const { result, context } = await planStack({
      ...options,
      home,
      drift: { now },
      only: address,
    });
    if (!result.ok || context === undefined) return refused(result.diagnostics);
    if (isUnmanaged(context.stack, address)) {
      return refused([
        error(
          'keep.unmanaged',
          `${address} is not Mediaplane's to keep: stack.yaml says it is ${UNMANAGED}`,
        ),
      ]);
    }
    // A resource deleted outside Mediaplane, or left in the app though the stack no
    // longer wants it: either way, it is yours from now on.
    const found = result.drift.find(
      (d) =>
        d.resource === address &&
        (field === undefined
          ? d.kind === 'missing' || d.kind === 'left'
          : d.kind === 'field' && d.field === field),
    );
    if (found === undefined) {
      const looked = result.wiring.find((w) => w.resource === address);
      const couldNot =
        looked?.action === 'unknown' || looked?.action === 'after-start'
          ? `Mediaplane couldn't look at it: ${looked.reason ?? "its app isn't running and healthy"}`
          : field === undefined
            ? `${def.name} holds it as the stack wants it, or it was never applied`
            : `${def.name} holds what Mediaplane applied, or the stack now wants what it holds`;
      return refused([
        error('keep.no-drift', `${key} has not changed outside Mediaplane: ${couldNot}`, {
          hint: `"mediaplane drift" shows what has, and what keep takes; see ${DRIFT_RUNBOOK}`,
        }),
      ]);
    }
    if (found.unreadable !== undefined) {
      return refused([
        error(
          'keep.unreadable',
          `${key} holds what Mediaplane can't read (${found.unreadable}), so it can't keep it`,
          { hint: `set it in ${def.name} to what you want, or run apply to put it back` },
        ),
      ]);
    }
    if (found.redacted === true) {
      return refused([
        error(
          'keep.secret',
          `${key} holds one of the stack's secrets, which stack.yaml must never hold`,
          {
            hint: `set it in ${def.name} to something else, or run apply to put it back`,
          },
        ),
      ]);
    }
    const value: Scalar = field === undefined ? UNMANAGED : (found.actual ?? '');
    // A value the field's own rule refuses, as plan would refuse it as an override.
    const broken = field === undefined ? undefined : overrideRefused(spec, field, value);
    if (broken !== undefined) {
      return refused([
        error('keep.value', `${key} can't be kept as ${def.name} holds it: ${broken}`, {
          hint: `set it in ${def.name} to one that can, or run apply to put it back`,
        }),
      ]);
    }
    const line = overrideLine(key, value);
    const byHand = `add this line under overrides: in stack.yaml yourself: ${line}`;
    if (context.stack.config.managed_by === 'external') {
      return refused([
        error(
          'keep.external',
          `stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane doesn't write it`,
          { hint: `${byHand}, where it is kept, such as your playbook` },
        ),
      ]);
    }
    const problem = await stackFileProblem(stackPath);
    const source = await readFile(stackPath, 'utf8');
    const written = problem === undefined ? withOverride(source, key, value) : undefined;
    if (written === undefined || !written.ok) {
      return refused([
        error(
          'keep.stack-file',
          `Mediaplane won't write stack.yaml: ${problem ?? (written?.ok === false ? written.reason : '')}`,
          { hint: byHand },
        ),
      ]);
    }
    // Its mode and group as they were (stackFileProblem refused a group it couldn't keep).
    const held = await stat(stackPath);
    await writeFileAtomic(stackPath, written.text, held.mode & 0o777, held.gid);
    const diagnostics = [...result.diagnostics];
    try {
      // As applied now: drift is clear, and apply finds the resource as it should be.
      const known = await readResources(home);
      const record = known[address];
      if (field === undefined) {
        Reflect.deleteProperty(known, address);
      } else if (record !== undefined) {
        known[address] = { ...record, fields: { ...record.fields, [field]: value } };
      }
      await writeResources(home, known);
    } catch (cause) {
      diagnostics.push(
        warning(
          'keep.record',
          `stack.yaml keeps ${key}, but state/resources.json could not be updated: ${cause instanceof Error ? cause.message : String(cause)}`,
          { hint: 'the next apply records it, changing nothing in the app' },
        ),
      );
    }
    return { ok: true, key, value, diagnostics };
  } finally {
    await lock.release();
  }
}
