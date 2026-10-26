import { error, type Diagnostic } from '../diagnostics';
import { AppApiError, APP_DEADLINE_MS, type AppApi } from '../http/client';
import type { ActionResult } from '../history/records';
import { PROJECT_NAME, WIRING_NETWORK } from '../render/compose';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import type { SecretStore } from '../secrets/store';
import { stackKeys } from '../secrets/values';
import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
import { desiredOf } from './overrides';
import {
  readState,
  writeResources,
  type KeyChecks,
  type KnownResources,
} from './resources';
import type {
  DesiredResource,
  Fields,
  ResourceSpec,
  VerifyContext,
  WiringContext,
} from './types';
import {
  checkApp,
  examine,
  fieldHoldingSecret,
  joinFailure,
  knownSecrets,
  notOnNetwork,
  reachApps,
  redactionValues,
  resourceAddress,
  resourcesInvalid,
  secretFieldReason,
  wantedResources,
  WIRING_RUNBOOK,
  wiringOrder,
  wiringTargets,
  type Examined,
  type ReachedApp,
  type WiringChange,
  type WiringSeams,
} from './wiring';

export interface WireOptions {
  home: string;
  stack: ResolvedStack;
  store: SecretStore;
  /** The secret values of .env: kept out of every message. */
  values: Readonly<Record<string, string>>;
  /** The secrets you give (userSecrets), such as Plex's token: keys, never kept. */
  given?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  now: () => Date;
  /** Each resource's result, as it comes. */
  record: (action: ActionResult) => void;
  /**
   * What apply's own plan said of each resource. A secret it found refused (an `update`
   * naming it) is set without another check: one failed sign-in per apply, not two.
   */
  planned?: readonly WiringChange[];
  /**
   * Apps whose first-run setup waits (the bootstrap step's SetupWaiting): their resources
   * are skipped, and so is what requires them.
   */
  waiting?: readonly string[];
  /**
   * Apps whose first-run setup failed, which the bootstrap step said: their resources are
   * skipped, and so is what requires them, as for one that waits.
   */
  failed?: readonly string[];
  /**
   * Apps whose first-run setup the plan held back, since it would sign in with an admin
   * password an app has never had (`bootstrap.needs-password`): skipped as one that waits.
   */
  held?: readonly string[];
  /**
   * The apps that have never had the admin password Mediaplane holds
   * (`shared.adminPasswordNotIn`), as the steps before this one left it: in a run that
   * generated the password, each app it hasn't reached yet. A resource of theirs that holds
   * it is set, never checked (ExamineOptions.lacks), and `passwordSet` is told once the
   * app's own admin (`ownAdmin`) is.
   */
  notIn?: readonly string[];
  /** Told of each app of `notIn` once its own admin is given the admin password. */
  passwordSet?: (app: string) => Promise<void>;
  /** What the run finds in the apps' answers (FoundSecrets); the step's own, by default. */
  found?: FoundSecrets;
  seams?: WiringSeams;
}

/** What one wired resource came to, for the step's own detail. */
const DONE = { create: 'created', update: 'updated', adopt: 'adopted' } as const;

/** What a failed wire step says to do, by what failed. */
const HINTS = {
  resources: `the apps' own messages are above; fix what they say, then run apply again. See ${WIRING_RUNBOOK}`,
  reach: `the error above says why Mediaplane couldn't reach the apps; nothing was changed in them. Fix it, then run apply again. See ${WIRING_RUNBOOK}`,
  file: `state/resources.json was left as it is; fix it or move it aside as the error above says, then run apply again. See ${WIRING_RUNBOOK}`,
  noNetwork: `run "docker network ls" and look for ${PROJECT_NAME}_${WIRING_NETWORK} (<project>_${WIRING_NETWORK} under another project name); a compose.override.yaml that sets the apps' networks can drop it. Then run apply again. See ${WIRING_RUNBOOK}`,
} as const;

/**
 * Apply's wire step (spec §5 step 10): for each app with an API, in order, wait until it
 * is ready and check its key, then make each of its resources what the stack wants, and
 * record it in state/resources.json at once. It reads that file again first, under
 * apply's lock, and never writes over one it can't read. A resource that fails doesn't
 * stop the others; one that `requires` it is skipped (spec §5.1). An error that isn't an
 * app's fails the resource it hit, and stops the step. Each result goes to `record`.
 * Returns what it changed, as "<resource> <what>"; throws WiringFailed when anything
 * failed.
 */
export async function wire(options: WireOptions): Promise<string[]> {
  const { stack, runtime } = options;
  const order = wiringOrder(stack);
  if (order.length === 0) return [];
  let known: KnownResources;
  let keys: KeyChecks;
  try {
    ({ resources: known, keys } = await readState(options.home));
  } catch (cause) {
    throw new WiringFailed(
      'state/resources.json could not be read, so nothing was wired',
      [resourcesInvalid(cause)],
      { hint: HINTS.file },
    );
  }
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const given = options.given ?? {};
  const appKeys = stackKeys(stack, options.store, given);
  const secrets = knownSecrets(options.values, options.store, admin, given);
  const found = options.found ?? foundSecrets();
  let reached: Map<string, ReachedApp>;
  try {
    if ((await runtime.joinWiring()) === 'no-network') {
      throw new WiringFailed(
        'the stack has no wiring network, though apply has just started it',
        [],
        { hint: HINTS.noNetwork },
      );
    }
    reached = await reachApps(order, {
      runtime,
      current: await runtime.containers(),
      keys: appKeys,
      secrets,
      found,
      deadlineMs: APP_DEADLINE_MS,
      ...(options.seams === undefined ? {} : { seams: options.seams }),
    });
  } catch (cause) {
    // A join Mediaplane refuses, or Docker failing, says what to do as plan says it.
    if (!(cause instanceof RuntimeError)) throw cause;
    throw new WiringFailed(
      'Mediaplane could not reach the apps, so nothing was wired',
      [joinFailure(cause, options.env)],
      { hint: HINTS.reach },
    );
  }
  const diagnostics: Diagnostic[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  /** Skipped because an app's first-run setup waits, or because they need what is. */
  const waited: string[] = [];
  /**
   * Skipped because an app's first-run setup failed, or because they need what is: by
   * address, the app whose setup failed.
   */
  const unset = new Map<string, string>();
  /** Skipped because an app's first-run setup is held, or because they need what is. */
  const held: string[] = [];
  const done: string[] = [];
  /** The apps that took Mediaplane's key: what a check may ask of another app. */
  const checked = new Map<string, AppApi>();
  const context: VerifyContext = { readOnly: false, peer: (id) => checked.get(id) };
  const values = redactionValues(secrets);
  // Every failure's message is redacted once, here, whoever wrote it: the client, a
  // resource's own error, mkdir or Docker; with the secrets the step has found by then.
  const redacting = () => redactionValues([...secrets, ...found.values]);
  const fail = (resource: string, said: string, code: string) => {
    const message = redact(said, redacting());
    failed.push(resource);
    diagnostics.push(error(code, message, { hint: `see ${WIRING_RUNBOOK}` }));
    options.record({ step: 'wire', resource, result: 'failed', error: message });
  };
  // An error that isn't the app's, such as a resources.json that can't be written, or a
  // bug: what it hit fails, and the step stops with it, keeping what failed before. Only
  // its redacted message goes on, never the error itself, which could hold a secret.
  const stop = (
    resources: readonly string[],
    cause: unknown,
    before = '',
  ): WiringFailed => {
    const said = cause instanceof Error ? cause.message : String(cause);
    const message = redact(`${before}${said}`, redacting());
    for (const resource of resources) {
      options.record({ step: 'wire', resource, result: 'failed', error: message });
    }
    return new WiringFailed(message, diagnostics);
  };
  /**
   * A secret drift found refused that apply's own check now passes, taken out of the
   * resource's record, as it is when the record is written: drift is clear then, and the
   * next plan has nothing to do for it.
   */
  const forgetPassed = async (address: string, result: Examined) => {
    const record = known[address];
    const kept = record?.checks;
    if (record === undefined || kept === undefined) return;
    const passed = result.checks
      .filter((check) => check.verdict === 'passed')
      .map((check) => check.secret);
    const left = Object.fromEntries(
      Object.entries(kept).filter(
        ([secret, check]) => check.verdict !== 'refused' || !passed.includes(secret),
      ),
    );
    if (Object.keys(left).length === Object.keys(kept).length) return;
    const { checks: _checks, ...rest } = record;
    known[address] = Object.keys(left).length === 0 ? rest : { ...rest, checks: left };
    // A failure to save it stops the step, as any error that isn't the app's.
    await writeResources(options.home, known, keys);
  };
  for (const app of order) {
    const ctx: WiringContext = { stack, app, admin, keys: appKeys };
    const targets = wiringTargets(ctx);
    const appId = app.def.id;
    const why = options.held?.includes(appId)
      ? {
          list: held,
          detail:
            "is held: the app it signs in to doesn't have the admin password Mediaplane holds",
        }
      : options.waiting?.includes(appId)
        ? { list: waited, detail: 'waits' }
        : options.failed?.includes(appId)
          ? { list: [], detail: 'failed' }
          : undefined;
    if (why !== undefined) {
      for (const target of targets) {
        skipped.push(target);
        why.list.push(target);
        if (why.detail === 'failed') unset.set(target, appId);
        options.record({
          step: 'wire',
          resource: target,
          result: 'skipped',
          detail: `${appId}'s first-run setup ${why.detail}`,
        });
      }
      continue;
    }
    /** The admin password, for an app that has never had it: set, never checked. */
    const lacks = options.notIn?.includes(appId) === true ? [admin.password] : [];
    const client = reached.get(app.def.id);
    if (client === undefined) {
      for (const target of targets)
        fail(target, notOnNetwork(app), 'wire.not-on-network');
      continue;
    }
    try {
      await checkApp(client);
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw stop(targets, cause);
      for (const target of targets) fail(target, cause.message, `wire.${cause.kind}`);
      continue;
    }
    checked.set(app.def.id, client.api);
    // It takes its key: one drift found it refusing is no longer, so plan and drift send
    // it again.
    const own = `${app.def.id}.${app.def.api?.key.secret ?? ''}`;
    if (Object.hasOwn(keys, own)) {
      Reflect.deleteProperty(keys, own);
      try {
        await writeResources(options.home, known, keys);
      } catch (cause) {
        throw stop(targets, cause, 'state/resources.json could not be saved: ');
      }
    }
    for (const spec of wantedResources(ctx)) {
      const address = resourceAddress(app, spec);
      const blocker = (spec.requires ?? []).find(
        (needed) => failed.includes(needed) || skipped.includes(needed),
      );
      if (blocker !== undefined) {
        skipped.push(address);
        if (waited.includes(blocker)) waited.push(address);
        const unsetBy = unset.get(blocker);
        if (unsetBy !== undefined) unset.set(address, unsetBy);
        if (held.includes(blocker)) held.push(address);
        options.record({
          step: 'wire',
          resource: address,
          result: 'skipped',
          detail: `${blocker} ${failed.includes(blocker) ? 'failed' : 'was skipped'}`,
        });
        continue;
      }
      // Wanted, and desired() is pure: only a guard.
      const desired = desiredOf(spec, ctx);
      if (desired === undefined) continue;
      // Before anything is sent: resources.json keeps the managed fields, and holds no
      // secret, so a field that holds one leaves the resource as it is.
      const secretField = fieldHoldingSecret(spec, desired, secrets);
      if (secretField !== undefined) {
        fail(address, secretFieldReason(address, secretField), 'wire.secret-field');
        continue;
      }
      let result: Examined | undefined;
      let id: string | number | null;
      try {
        const planned = options.planned?.find((change) => change.resource === address);
        result = await examine(spec, client.api, ctx, known[address], {
          refused: planned?.action === 'update' ? (planned.changes ?? []) : [],
          context,
          lacks,
        });
        if (result === undefined) continue;
        if (result.action === 'unchanged') {
          await forgetPassed(address, result);
          options.record({
            step: 'wire',
            resource: address,
            result: 'done',
            detail: 'unchanged',
          });
          continue;
        }
        id = result.observed?.id ?? null;
        // Its folders first, for an update as for a create: an update may point the
        // resource at a folder that isn't there yet (a Jellyfin library's). An adopted
        // resource is already there.
        if (result.action === 'create' || result.action === 'update') {
          const unmade = await makeFolders(options, app, address, result.desired, values);
          if (unmade !== undefined) {
            fail(address, unmade, 'wire.folders');
            continue;
          }
        }
        if (result.action === 'create') {
          ({ id } = await spec.create(client.api, result.desired));
        } else if (result.action === 'update' && result.observed !== undefined) {
          await spec.update(client.api, result.desired, result.observed, result.changes);
        }
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw stop([address], cause);
        fail(address, cause.message, `wire.${cause.kind}`);
        continue;
      }
      // At once: a crash later loses no id, and the next plan finds it as it is. Its
      // checks go, as apply has set its secrets; a later release's fields stay.
      const { checks: _checks, ...prior } = known[address] ?? {};
      known[address] = {
        ...prior,
        id,
        name: result.desired.name,
        fields: managedFields(spec, result.desired),
        secrets: [...spec.secrets],
        appliedAt: options.now().toISOString(),
      };
      try {
        await writeResources(options.home, known, keys);
      } catch (cause) {
        // The app holds it now, as the next plan will find (adopt): say so.
        throw stop(
          [address],
          cause,
          `${app.def.name} has it, but state/resources.json could not be saved: `,
        );
      }
      const what =
        result.action === 'update'
          ? `${DONE.update} ${result.changes.join(', ')}`
          : DONE[result.action];
      done.push(`${address} ${what}`);
      options.record({ step: 'wire', resource: address, result: 'done', detail: what });
      // Its own admin has the admin password now: it is no longer one that never had it.
      // Only its own: another resource may hold the password as another app's login.
      if (lacks.length > 0 && spec.ownAdmin === true) {
        lacks.length = 0;
        try {
          await options.passwordSet?.(appId);
        } catch (cause) {
          throw stop([], cause, 'state/secrets.json could not be saved: ');
        }
      }
    }
  }
  if (failed.length > 0) {
    throw new WiringFailed(
      failureMessage(failed, skipped, waited, unset, held),
      diagnostics,
      {
        hint: HINTS.resources,
      },
    );
  }
  return done;
}

/**
 * Make the folders `desired` needs, in a throwaway container of `app`'s own service (its
 * image and its mounts), as the stack's user: the folders are then the data folder's, as
 * the apps see it, and theirs. Undefined when there are none, or they are made; otherwise
 * why not, from mkdir's own last line, or Docker's. The runtime keeps `values`, every
 * secret the stack knows, out of what it says; the wire step redacts the reason again.
 * A Docker that fails or times out fails this resource only, as the app failing would.
 */
async function makeFolders(
  options: WireOptions,
  app: ResolvedApp,
  address: string,
  desired: DesiredResource,
  values: Readonly<Record<string, string>>,
): Promise<string | undefined> {
  const folders = desired.folders ?? [];
  if (folders.length === 0) return undefined;
  const couldNot = `could not make ${folders.join(', ')} for ${address}`;
  let made;
  try {
    made = await options.runtime.run(app.def.id, {
      user: options.stack.config.user,
      entrypoint: 'mkdir',
      args: ['-p', '--', ...folders],
      values,
    });
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return `${couldNot}: ${cause.message}`;
  }
  if (made.code === 0) return undefined;
  const said = made.stderr.trim().split('\n').at(-1)?.trim() ?? '';
  return `${couldNot}: mkdir in a throwaway ${app.def.name} container exited ${String(made.code)}${said === '' ? '' : `: ${said}`}`;
}

/**
 * "the wiring failed for a; skipped b, which needs what failed; skipped c, which waits for
 * a first-run setup; skipped d, whose app's first-run setup failed; skipped e, which needs
 * f, whose first-run setup failed". A resource skipped because of a setup didn't fail
 * anything here: the bootstrap step said what did. `unset` gives, by address, the app
 * whose setup failed.
 */
function failureMessage(
  failed: readonly string[],
  skipped: readonly string[],
  waited: readonly string[],
  unset: ReadonlyMap<string, string>,
  held: readonly string[],
): string {
  const after = skipped.filter(
    (address) =>
      !waited.includes(address) && !unset.has(address) && !held.includes(address),
  );
  const because =
    after.length === 0
      ? ''
      : `; skipped ${after.join(', ')}, which ${after.length === 1 ? 'needs' : 'need'} what failed`;
  const waits =
    waited.length === 0
      ? ''
      : `; skipped ${waited.join(', ')}, which ${waited.length === 1 ? 'waits' : 'wait'} for a first-run setup`;
  /** Its own resources, then, by app, the others that need one of them. */
  const own = [...unset].filter(([address, app]) => ownedBy(address, app));
  const needing = new Map<string, string[]>();
  for (const [address, app] of unset) {
    if (!ownedBy(address, app)) needing.set(app, [...(needing.get(app) ?? []), address]);
  }
  const unsetUp = [
    ...(own.length === 0
      ? []
      : [
          `; skipped ${own.map(([address]) => address).join(', ')}, whose app's first-run setup failed`,
        ]),
    ...[...needing].map(
      ([app, addresses]) =>
        `; skipped ${addresses.join(', ')}, which ${addresses.length === 1 ? 'needs' : 'need'} ${app}, whose first-run setup failed`,
    ),
  ].join('');
  const heldUp =
    held.length === 0
      ? ''
      : `; skipped ${held.join(', ')}, whose app's first-run setup is held`;
  return `the wiring failed for ${failed.join(', ')}${because}${waits}${unsetUp}${heldUp}`;
}

/** Whether `address` ("<app>.<resource>", or "<app>" for one with none) is `app`'s. */
function ownedBy(address: string, app: string): boolean {
  return address === app || address.startsWith(`${app}.`);
}

/** The managed fields only: what resources.json keeps. */
function managedFields(spec: ResourceSpec, desired: DesiredResource): Fields {
  return Object.fromEntries(
    spec.fields.flatMap((field) => {
      const value = desired.fields[field];
      return value === undefined ? [] : [[field, value]];
    }),
  );
}

/**
 * Some of the wiring failed: each failure's diagnostic, from the app's own message, and
 * what to do when the wire step's own hint doesn't fit. It keeps no cause: the error it
 * stands for could hold a secret, which util.inspect would print.
 */
export class WiringFailed extends Error {
  override readonly name = 'WiringFailed';
  readonly diagnostics: Diagnostic[];
  readonly hint: string | undefined;

  constructor(
    message: string,
    diagnostics: readonly Diagnostic[],
    options: { hint?: string } = {},
  ) {
    super(message);
    this.diagnostics = [...diagnostics];
    this.hint = options.hint;
  }
}
