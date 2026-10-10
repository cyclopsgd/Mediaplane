import { error, type Diagnostic } from '../diagnostics';
import { AppApiError, APP_DEADLINE_MS } from '../http/client';
import type { ActionResult } from '../history/records';
import { PROJECT_NAME, WIRING_NETWORK } from '../render/compose';
import type { ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import type { SecretStore } from '../secrets/store';
import { redact } from '../util/redact';
import { readResources, writeResources, type KnownResources } from './resources';
import type { DesiredResource, Fields, ResourceSpec, WiringContext } from './types';
import {
  checkApp,
  examine,
  joinFailure,
  knownSecrets,
  notOnNetwork,
  reachApps,
  resourceAddress,
  resourcesInvalid,
  wantedResources,
  WIRING_RUNBOOK,
  wiringOrder,
  wiringTargets,
  type ReachedApp,
  type WiringSeams,
} from './wiring';

export interface WireOptions {
  home: string;
  stack: ResolvedStack;
  store: SecretStore;
  /** The secret values of .env: kept out of every message. */
  values: Readonly<Record<string, string>>;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  now: () => Date;
  /** Each resource's result, as it comes. */
  record: (action: ActionResult) => void;
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
  try {
    known = await readResources(options.home);
  } catch (cause) {
    throw new WiringFailed(
      'state/resources.json could not be read, so nothing was wired',
      [resourcesInvalid(cause)],
      { hint: HINTS.file },
    );
  }
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const secrets = knownSecrets(options.values, options.store, admin);
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
      keys: options.store.apps,
      secrets,
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
  const done: string[] = [];
  const fail = (resource: string, message: string, code: string) => {
    failed.push(resource);
    diagnostics.push(error(code, message, { hint: `see ${WIRING_RUNBOOK}` }));
    options.record({ step: 'wire', resource, result: 'failed', error: message });
  };
  // An error that isn't the app's, such as a resources.json that can't be written, or a
  // bug: what it hit fails, and the step stops with it, keeping what failed before.
  const stop = (resources: readonly string[], cause: unknown): WiringFailed => {
    const said = cause instanceof Error ? cause.message : String(cause);
    const message = redact(said, Object.fromEntries(secrets.map((s, i) => [i, s])));
    for (const resource of resources) {
      options.record({ step: 'wire', resource, result: 'failed', error: message });
    }
    return new WiringFailed(message, diagnostics, { cause });
  };
  for (const app of order) {
    const ctx: WiringContext = { stack, app, admin };
    const targets = wiringTargets(ctx);
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
    for (const spec of wantedResources(ctx)) {
      const address = resourceAddress(app, spec);
      const blocker = (spec.requires ?? []).find(
        (needed) => failed.includes(needed) || skipped.includes(needed),
      );
      if (blocker !== undefined) {
        skipped.push(address);
        options.record({
          step: 'wire',
          resource: address,
          result: 'skipped',
          detail: `${blocker} ${failed.includes(blocker) ? 'failed' : 'was skipped'}`,
        });
        continue;
      }
      // Wanted, and desired() is pure: only a guard.
      const desired = spec.desired(ctx);
      if (desired === undefined) continue;
      // Before anything is sent: resources.json keeps the managed fields, and holds no
      // secret, so a field that holds one leaves the resource as it is.
      const secretField = fieldHoldingSecret(spec, desired, secrets);
      if (secretField !== undefined) {
        fail(
          address,
          `${address}.${secretField} holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value`,
          'wire.secret-field',
        );
        continue;
      }
      try {
        const result = await examine(spec, client.api, ctx, known[address]);
        if (result === undefined) continue;
        if (result.action === 'unchanged') {
          options.record({
            step: 'wire',
            resource: address,
            result: 'done',
            detail: 'unchanged',
          });
          continue;
        }
        let id = result.observed?.id ?? null;
        if (result.action === 'create') {
          ({ id } = await spec.create(client.api, result.desired));
        } else if (result.action === 'update' && result.observed !== undefined) {
          await spec.update(client.api, result.desired, result.observed);
        }
        // At once: a crash later loses no id, and the next plan finds it as it is.
        known[address] = {
          id,
          name: result.desired.name,
          fields: managedFields(spec, result.desired),
          secrets: [...spec.secrets],
          appliedAt: options.now().toISOString(),
        };
        await writeResources(options.home, known);
        const what =
          result.action === 'update'
            ? `${DONE.update} ${result.changes.join(', ')}`
            : DONE[result.action];
        done.push(`${address} ${what}`);
        options.record({ step: 'wire', resource: address, result: 'done', detail: what });
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw stop([address], cause);
        fail(address, cause.message, `wire.${cause.kind}`);
      }
    }
  }
  if (failed.length > 0) {
    throw new WiringFailed(failureMessage(failed, skipped), diagnostics, {
      hint: HINTS.resources,
    });
  }
  return done;
}

/** "the wiring failed for a; skipped b, which needs what failed". */
function failureMessage(failed: readonly string[], skipped: readonly string[]): string {
  const because =
    skipped.length === 0
      ? ''
      : `; skipped ${skipped.join(', ')}, which ${skipped.length === 1 ? 'needs' : 'need'} what failed`;
  return `the wiring failed for ${failed.join(', ')}${because}`;
}

/** The first of the managed fields whose value holds one of `secrets`, by name. */
function fieldHoldingSecret(
  spec: ResourceSpec,
  desired: DesiredResource,
  secrets: readonly string[],
): string | undefined {
  return spec.fields.find((field) => {
    const value = desired.fields[field];
    return (
      value !== undefined && secrets.some((secret) => String(value).includes(secret))
    );
  });
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
 * what to do when the wire step's own hint doesn't fit.
 */
export class WiringFailed extends Error {
  override readonly name = 'WiringFailed';
  readonly diagnostics: Diagnostic[];
  readonly hint: string | undefined;

  constructor(
    message: string,
    diagnostics: readonly Diagnostic[],
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.diagnostics = [...diagnostics];
    this.hint = options.hint;
  }
}
