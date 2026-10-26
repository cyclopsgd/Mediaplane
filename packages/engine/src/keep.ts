import { join, resolve } from 'node:path';
import { parseConfig } from './config/load';
import {
  overrideLine,
  readStackFile,
  valueProblem,
  withOverride,
} from './config/overrides-file';
import { error, warning, type Diagnostic } from './diagnostics';
import {
  isUnmanaged,
  overrideRefused,
  overrideTarget,
  UNMANAGED,
} from './integrations/overrides';
import type { AppDefinition, KeyFile } from './catalog/types';
import { AppApiError } from './http/client';
import { readResources, readState, writeResources } from './integrations/resources';
import type { Scalar } from './integrations/types';
import {
  checkApp,
  DRIFT_RUNBOOK,
  notOnNetwork,
  PLAN_DEADLINE_MS,
  reachApps,
  redactionValues,
  resourceAddress,
  wantedResources,
} from './integrations/wiring';
import { desiredOf } from './integrations/overrides';
import { STACK_PATH } from './paths';
import { planStack, type PlanContext, type PlanOptions } from './plan/plan';
import {
  keyFilePath,
  readKeyFile,
  REBUILD_RUNBOOK,
  withRecoveredKeys,
} from './secrets/recover';
import { splitKey } from './secrets/key-name';
import { APP_SECRET, UNKEEPABLE_KEY, writeSecretStore } from './secrets/store';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { writeFileAtomic } from './util/atomic';
import { fileKind } from './util/fs';
import { foundSecrets, redact } from './util/redact';

export interface KeepOptions extends PlanOptions {
  /**
   * What to keep: `<app>.<resource>.<field>`, or `<app>.<resource>` for one deleted; or
   * `<app>.<key>`, an app's own key, changed at its source (spec §6.3).
   */
  path: string;
  now?: () => Date;
}

/** What `mediaplane keep` did (spec §6.3, Keep mine): never a secret's value. */
export interface KeepResult {
  ok: boolean;
  /** The override key it wrote under `overrides:`, or the app's key it kept. */
  key: string;
  /**
   * Its value: the app's, or `unmanaged` for a resource deleted outside Mediaplane; never
   * a key's, which it keeps in state/secrets.json.
   */
  value: Scalar | undefined;
  /**
   * For an app's own key it kept: the resources of the stack that hold the key, each
   * given the kept one by the next apply. Added in Slice 10a.
   */
  holders?: string[];
  diagnostics: Diagnostic[];
}

/** An app's own key that keep can take: the app, the key's name, and where it keeps it. */
interface KeyTarget {
  def: AppDefinition;
  name: string;
  file: KeyFile;
}

/** The app's own key `path` names (`<app>.<key>`, which a key file holds), if it names one. */
function keyTarget(catalog: PlanOptions['catalog'], path: string): KeyTarget | undefined {
  const { app, name } = splitKey(path);
  const def = catalog.find((d) => d.id === app);
  // Among the app's own keys: `constructor` and the like are not.
  const file =
    def?.keyFiles !== undefined && Object.hasOwn(def.keyFiles, name)
      ? def.keyFiles[name]
      : undefined;
  return def === undefined || file === undefined ? undefined : { def, name, file };
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
  // An app's own key, or else what an override names.
  const named = keyTarget(options.catalog, key) ?? overrideTarget(options.catalog, key);
  if ('ok' in named && !named.ok) return refused([named.diagnostic]);
  const stackPath = join(home, STACK_PATH);
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  // Looked at, not opened: a named pipe would make an open wait for a writer.
  const kind = await fileKind(stackPath);
  if (kind === 'missing') {
    return refused((await planStack({ ...options, home })).result.diagnostics);
  }
  if (kind === 'other') {
    return refused([
      error(
        'keep.stack-file',
        `Mediaplane won't read stack.yaml: ${stackPath} is not a regular file`,
      ),
    ]);
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
    if (!('ok' in named)) return await keepKey({ ...options, home }, now, named);
    const { spec, def, field } = named.target;
    const address = `${def.id}.${spec.name}`;
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
    // A value it holds none of is one it can't read, never an empty one.
    const value = field === undefined ? UNMANAGED : found.actual;
    if (value === undefined || value === null) {
      return refused([
        error('keep.unreadable', `${key} holds no value Mediaplane can read`, {
          hint: `set it in ${def.name} to what you want, or run apply to put it back`,
        }),
      ]);
    }
    // A value the field's own rule refuses, as plan would refuse it as an override, or
    // one that could make stack.yaml show what it doesn't hold.
    const broken =
      (field === undefined ? undefined : overrideRefused(spec, field, value)) ??
      valueProblem(value);
    if (broken !== undefined) {
      return refused([
        error('keep.value', `${key} can't be kept as ${def.name} holds it: ${broken}`, {
          hint: `set it in ${def.name} to one that can, or run apply to put it back`,
        }),
      ]);
    }
    // Quoted where `overrides: { … }` would need it, and right under a block one too.
    const byHand = `add this line under overrides: in stack.yaml yourself: ${overrideLine(key, value, true)}`;
    const external = () =>
      refused([
        error(
          'keep.external',
          `stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane doesn't write it`,
          { hint: `${byHand}, where it is kept, such as your playbook` },
        ),
      ]);
    if (context.stack.config.managed_by === 'external') return external();
    const cannot = (why: string) =>
      refused([error('keep.stack-file', why, { hint: byHand })]);
    // Read once, through one handle, as it is checked: the file written is the one read.
    const read = await readStackFile(stackPath);
    if (!read.ok) return cannot(`Mediaplane won't write stack.yaml: ${read.reason}`);
    const { file } = read;
    // What the file says now, which may have changed since the plan read it.
    const current = parseConfig(file.text);
    if (current.ok && current.config.managed_by === 'external') return external();
    if (current.ok && current.config.overrides[address] === UNMANAGED) {
      return refused([
        error(
          'keep.unmanaged',
          `${address} is not Mediaplane's to keep: stack.yaml says it is ${UNMANAGED}`,
        ),
      ]);
    }
    const written = withOverride(file.text, key, value);
    if (!written.ok)
      return cannot(`Mediaplane won't write stack.yaml: ${written.reason}`);
    try {
      // Its mode and group as they were (readStackFile refused a group it couldn't keep),
      // and only in place of the file read.
      await writeFileAtomic(stackPath, written.text, file.mode, {
        group: file.gid,
        replaces: { dev: file.dev, ino: file.ino },
      });
    } catch (cause) {
      return cannot(
        `Mediaplane couldn't write stack.yaml: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
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

/**
 * Keep mine for an app's own key, changed at its source (spec §6.3): the key the app's own
 * file holds (its KeyFile), taken as the stack's, in state/secrets.json, once the app is
 * shown to refuse the key Mediaplane holds, and to take that one. The next apply gives it
 * to every resource of the stack that holds it (`holders`), as one the other app refuses:
 * keep itself writes to no app. Under apply's lock, as keep is. Its plan asks the app with
 * the key Mediaplane holds, and nothing else; then the app is asked with the file's.
 * Never says either key.
 */
async function keepKey(
  options: KeepOptions,
  now: () => Date,
  { def, name, file }: KeyTarget,
): Promise<KeepResult> {
  const key = `${def.id}.${name}`;
  const refused = (code: string, message: string, hint?: string): KeepResult => ({
    ok: false,
    key,
    value: undefined,
    diagnostics: [error(code, message, hint === undefined ? {} : { hint })],
  });
  const where = keyFilePath(def.id, file);
  if (def.api?.key.secret !== name) {
    return refused(
      'keep.no-check',
      `Mediaplane can't ask ${def.name} whether it takes the key ${where} holds, so it doesn't keep it`,
      `apply puts the key Mediaplane holds back in ${where}, and restarts ${def.name}; see ${REBUILD_RUNBOOK}`,
    );
  }
  // Only this app is asked, with the key Mediaplane holds: `key` names no resource.
  const { result, context } = await planStack({ ...options, drift: { now }, only: key });
  if (!result.ok || context === undefined) {
    return { ok: false, key, value: undefined, diagnostics: result.diagnostics };
  }
  const refusing = result.drift.some(
    (d) => d.kind === 'key' && d.resource === def.id && d.source === undefined,
  );
  // Plan's warnings go with a refusal, for the why. Those of the app refusing the key it
  // holds are what a refusal to keep, past that, takes for granted.
  const refusedWith = (code: string, message: string, hint?: string): KeepResult => {
    const said = refused(code, message, hint);
    const warnings = result.diagnostics.filter(
      (d) => code === 'keep.no-drift' || !d.code.startsWith('wire.'),
    );
    return { ...said, diagnostics: [...said.diagnostics, ...warnings] };
  };
  if (!refusing) {
    // The app was asked and took the key when plan found it unchanged; else it wasn't asked.
    const asked = result.wiring.some(
      (change) => change.resource === def.id && change.action === 'unchanged',
    );
    return refusedWith(
      'keep.no-drift',
      asked
        ? `${key} has not changed outside Mediaplane: ${def.name} takes the key Mediaplane holds`
        : `Mediaplane couldn't ask ${def.name} whether it still takes the key it holds, so it can't tell whether ${key} changed`,
      `"mediaplane drift" says more; see ${DRIFT_RUNBOOK}`,
    );
  }
  const found = await readKeyFile(context.stack.home, def.id, file);
  const held = context.store.apps[def.id]?.[name];
  // The key of another app in the store is never this app's: an app can hold another's.
  const another =
    found.found === 'key'
      ? Object.entries(context.store.apps).flatMap(([app, secrets]) =>
          Object.entries(secrets).flatMap(([secret, stored]) =>
            stored === found.value && !(app === def.id && secret === name)
              ? [`${app}.${secret}`]
              : [],
          ),
        )
      : [];
  // Nor is any other secret plan knows: the admin password, a key you give, a value of
  // .env. This app's own key, as the store holds it, is said apart.
  const otherSecret =
    found.found === 'key' &&
    found.value !== held &&
    context.secrets.includes(found.value);
  if (
    found.found !== 'key' ||
    !APP_SECRET.test(found.value) ||
    found.value === held ||
    another.length > 0 ||
    otherSecret
  ) {
    const why =
      found.found === 'unreadable'
        ? found.why
        : found.found !== 'key'
          ? 'it holds none'
          : found.value === held
            ? 'it holds the one Mediaplane holds, which the app refuses'
            : !APP_SECRET.test(found.value)
              ? UNKEEPABLE_KEY
              : another.length > 0
                ? `it holds the key Mediaplane holds for ${another.join(', ')}`
                : 'it holds a secret Mediaplane holds for another use';
    return refusedWith(
      'keep.no-key',
      `Mediaplane can't keep ${def.name}'s own key: ${where} can't give it: ${why}`,
      `see "A key changed at its source" in ${REBUILD_RUNBOOK}`,
    );
  }
  const value = found.value;
  const asked = await askWith(options, context, def, name, value);
  if (asked !== undefined)
    return refusedWith('keep.refused', asked, `see ${REBUILD_RUNBOOK}`);
  // Only this key: the keys plan recovered for other apps are apply's to save.
  await writeSecretStore(
    context.stack.home,
    withRecoveredKeys(context.stored, [{ app: def.id, name, value }]),
  );
  const diagnostics = result.diagnostics.filter(
    (d) =>
      // What the plan said of the app refusing the key it held, and of the key it
      // couldn't put back in the app's file, is what keep has put right.
      !d.code.startsWith('wire.') &&
      !(d.code === 'keys.restore' && d.message.includes(`(${key})`)),
  );
  try {
    // The app takes Mediaplane's key again: plan and drift may send it.
    const state = await readState(context.stack.home);
    if (Object.hasOwn(state.keys, key)) {
      Reflect.deleteProperty(state.keys, key);
      await writeResources(context.stack.home, state.resources, state.keys);
    }
  } catch (cause) {
    diagnostics.push(
      warning(
        'keep.record',
        `state/secrets.json keeps ${key}, but state/resources.json could not be updated: ${cause instanceof Error ? cause.message : String(cause)}`,
        { hint: 'the next apply records it, changing nothing in the app' },
      ),
    );
  }
  return {
    ok: true,
    key,
    value: undefined,
    holders: held === undefined ? [] : holdersOf(context, held),
    diagnostics,
  };
}

/**
 * Why `def` doesn't take `value` as its key, asked as plan asks it, or undefined when it
 * does. Any failure, a refusal or no answer, is a reason not to keep it: an unsure answer
 * never becomes "it takes it". The key is kept out of what is said.
 */
async function askWith(
  options: KeepOptions,
  context: PlanContext,
  def: AppDefinition,
  name: string,
  value: string,
): Promise<string | undefined> {
  const app = context.stack.apps.find((candidate) => candidate.def.id === def.id);
  if (app === undefined) return `${def.name} is not in the stack`;
  // The secrets plan keeps out of what it says, and the key asked with.
  const secrets = [value, ...context.secrets];
  const reached = await reachApps([app], {
    runtime: options.runtime,
    current: context.current,
    keys: { [def.id]: { [name]: value } },
    secrets,
    found: foundSecrets(),
    deadlineMs: PLAN_DEADLINE_MS,
    ...(options.wiring === undefined ? {} : { seams: options.wiring }),
  });
  const client = reached.get(def.id);
  if (client === undefined) return notOnNetwork(app);
  try {
    await checkApp(client);
    return undefined;
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    const said = redact(cause.message, redactionValues(secrets));
    return cause.kind === 'auth'
      ? `${def.name} refuses the key its own file holds too: ${said}`
      : `Mediaplane couldn't tell whether ${def.name} takes the key its own file holds: ${said}`;
  }
}

/** Each resource the stack wants that holds `value` as one of its secrets, by address. */
function holdersOf(context: PlanContext, value: string): string[] {
  const { stack, store } = context;
  const admin = { username: stack.config.admin.username, password: '' };
  return stack.apps.flatMap((app) => {
    const ctx = { stack, app, admin, keys: store.apps };
    return wantedResources(ctx).flatMap((spec) =>
      Object.values(desiredOf(spec, ctx)?.secrets ?? {}).includes(value)
        ? [resourceAddress(app, spec)]
        : [],
    );
  });
}
