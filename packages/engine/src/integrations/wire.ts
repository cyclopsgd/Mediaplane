import { error, type Diagnostic } from '../diagnostics';
import { AppApiError, APP_DEADLINE_MS } from '../http/client';
import type { ActionResult } from '../history/records';
import type { ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import type { SecretStore } from '../secrets/store';
import { readResources, writeResources, type KnownResources } from './resources';
import type { DesiredResource, WiringContext } from './types';
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

/**
 * Apply's wire step (spec §5 step 10): for each app with an API, in order, wait until it
 * is ready and check its key, then make each of its resources what the stack wants, and
 * record it in state/resources.json at once. It reads that file again first, under
 * apply's lock, and never writes over one it can't read. A resource that fails doesn't
 * stop the others; one that `requires` it is skipped (spec §5.1). Each result goes to
 * `record`. Returns what it changed, as "<resource> <what>"; throws WiringFailed when
 * anything failed.
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
    );
  }
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const secrets = knownSecrets(options.values, options.store, admin);
  let reached: Map<string, ReachedApp>;
  try {
    if ((await runtime.joinWiring()) === 'no-network') {
      throw new Error(
        'the stack has no wiring network, though apply has just started it',
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
    throw new WiringFailed('Mediaplane could not reach the apps, so nothing was wired', [
      joinFailure(cause, options.env),
    ]);
  }
  const diagnostics: Diagnostic[] = [];
  const failed = new Set<string>();
  const done: string[] = [];
  const fail = (resource: string, message: string, code: string) => {
    failed.add(resource);
    diagnostics.push(error(code, message, { hint: `see ${WIRING_RUNBOOK}` }));
    options.record({ step: 'wire', resource, result: 'failed', error: message });
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
      if (!(cause instanceof AppApiError)) throw cause;
      for (const target of targets) fail(target, cause.message, `wire.${cause.kind}`);
      continue;
    }
    for (const spec of wantedResources(ctx)) {
      const address = resourceAddress(app, spec);
      const blocker = (spec.requires ?? []).find((needed) => failed.has(needed));
      if (blocker !== undefined) {
        failed.add(address);
        options.record({
          step: 'wire',
          resource: address,
          result: 'skipped',
          detail: `${blocker} failed`,
        });
        continue;
      }
      try {
        const result = await examine(spec, client.api, ctx, known[address]);
        // Wanted, and desired() is pure: only a guard.
        if (result === undefined) continue;
        // resources.json holds no secret: a managed field that is one is never kept, so
        // the resource is left as it is.
        const secretField = secretFieldOf(result.desired, secrets);
        if (secretField !== undefined) {
          fail(
            address,
            `${address}.${secretField} is the same as one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value`,
            'wire.secret-field',
          );
          continue;
        }
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
          fields: { ...result.desired.fields },
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
        if (!(cause instanceof AppApiError)) throw cause;
        fail(address, cause.message, `wire.${cause.kind}`);
      }
    }
  }
  if (failed.size > 0) {
    const names = [...failed].join(', ');
    throw new WiringFailed(`the wiring failed for ${names}`, diagnostics);
  }
  return done;
}

/** The first managed field whose value is one of `secrets`, by name. */
function secretFieldOf(
  desired: DesiredResource,
  secrets: readonly string[],
): string | undefined {
  return Object.keys(desired.fields).find((field) =>
    secrets.includes(String(desired.fields[field])),
  );
}

/** Some of the wiring failed: each failure's diagnostic, from the app's own message. */
export class WiringFailed extends Error {
  override readonly name = 'WiringFailed';
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[]) {
    super(message);
    this.diagnostics = diagnostics;
  }
}
