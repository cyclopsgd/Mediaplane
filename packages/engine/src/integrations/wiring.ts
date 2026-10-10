import { error, warning, type Diagnostic } from '../diagnostics';
import { dockerUnavailable } from '../host/failure';
import {
  AppApiError,
  createAppApi,
  type AppApi,
  type Endpoint,
  type RetryOptions,
} from '../http/client';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { runbookUrl } from '../runbooks';
import { OwnContainerUnknown, WiringRefused } from '../runtime/docker';
import type { ContainerState, RuntimeError, Runtime } from '../runtime/types';
import type { SecretStore } from '../secrets/store';
import { compare } from '../util/sort';
import type { KnownResource, KnownResources } from './resources';
import type {
  DesiredResource,
  ObservedResource,
  ResourceSpec,
  WiringContext,
} from './types';

/** Where a failed wiring step sends you. */
export const WIRING_RUNBOOK = runbookUrl('wiring-failed');

/** How long plan waits for an app that is starting, in ms: apply waits APP_DEADLINE_MS. */
export const PLAN_DEADLINE_MS = 15_000;

/**
 * What apply would do to one managed resource (spec §5 step 5, "the wiring"):
 * - `create`, `update`: make it, or make it match (`changes` names what differs);
 * - `adopt`: the app already holds it as wanted, and resources.json doesn't say so yet;
 * - `unchanged`;
 * - `after-start`: its app isn't running, or apply will change its container, so it is
 *   checked after the start;
 * - `unknown`: Mediaplane couldn't ask the app (`reason`, and a warning, say why).
 */
export type WiringAction =
  'create' | 'update' | 'adopt' | 'unchanged' | 'after-start' | 'unknown';

export interface WiringChange {
  /** "<app>.<resource>", or "<app>" alone for an app Mediaplane only checks. */
  resource: string;
  action: WiringAction;
  /** The managed fields and secrets that differ, by name. */
  changes?: string[];
  /** Why it couldn't be checked. */
  reason?: string;
}

/** For tests: where an app is reached, and how long its calls take and are tried. */
export interface WiringSeams {
  endpoint?: (app: ResolvedApp, address: string, port: number) => Endpoint;
  retry?: Partial<RetryOptions>;
  timeoutMs?: number;
}

/** An app Mediaplane calls, ready to be asked. */
export interface ReachedApp {
  app: ResolvedApp;
  api: AppApi;
}

/**
 * The apps with an API, in the order their integrations go (spec §6.2, "Ordering"): an
 * app after every app its integration names in `after`, by id otherwise. Throws on a
 * loop, which the catalog's tests rule out.
 */
export function wiringOrder(stack: ResolvedStack): ResolvedApp[] {
  const apps = stack.apps.filter((app) => app.def.api !== undefined);
  const byId = new Map(apps.map((app) => [app.def.id, app]));
  const ordered: ResolvedApp[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (app: ResolvedApp, path: readonly string[]): void => {
    const id = app.def.id;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      throw new Error(`the integrations' "after" loops: ${[...path, id].join(' → ')}`);
    }
    state.set(id, 'visiting');
    for (const before of [...(app.def.integration?.after ?? [])].sort(compare)) {
      const other = byId.get(before);
      if (other !== undefined) visit(other, [...path, id]);
    }
    state.set(id, 'done');
    ordered.push(app);
  };
  for (const app of apps) visit(app, []);
  return ordered;
}

/** "<app>.<resource>". */
export function resourceAddress(app: ResolvedApp, spec: ResourceSpec): string {
  return `${app.def.id}.${spec.name}`;
}

/** The app's resources that the stack wants: each one whose `desired` gives one. */
export function wantedResources(ctx: WiringContext): ResourceSpec[] {
  return (ctx.app.def.integration?.resources ?? []).filter(
    (spec) => spec.desired(ctx) !== undefined,
  );
}

/**
 * What a change names for the app: each resource the stack wants, or the app itself
 * when it wants none of them, and Mediaplane only checks the app.
 */
export function wiringTargets(ctx: WiringContext): string[] {
  const wanted = wantedResources(ctx);
  return wanted.length === 0
    ? [ctx.app.def.id]
    : wanted.map((spec) => resourceAddress(ctx.app, spec));
}

/** Why Mediaplane can't ask `app`: its container isn't on the stack's wiring network. */
export function notOnNetwork(app: ResolvedApp): string {
  return `${app.def.name}'s container is not on the stack's wiring network, so Mediaplane can't reach it`;
}

/** The service whose container serves the app's API: Gluetun's, for qBittorrent. */
function serviceOf(app: ResolvedApp): string {
  return app.networkVia ?? app.def.id;
}

/**
 * Whether apply would leave `app`'s containers as they are, running and healthy: only
 * then is what its API says now what apply would find.
 */
export function settled(
  app: ResolvedApp,
  current: readonly ContainerState[],
  changing: ReadonlySet<string>,
): boolean {
  const services = [app.def.id, serviceOf(app)];
  return services.every((service) => {
    if (changing.has(service)) return false;
    const containers = current.filter((c) => c.service === service);
    return (
      containers.length > 0 &&
      containers.every(
        (c) => c.state === 'running' && (c.health === '' || c.health === 'healthy'),
      )
    );
  });
}

/**
 * A client for each of `apps` that has an address on the wiring network: where its
 * service's container is on it, its key from the store, and every secret to keep out
 * of messages. An app missing from the answer has no address yet.
 */
export async function reachApps(
  apps: readonly ResolvedApp[],
  options: {
    runtime: Runtime;
    current: readonly ContainerState[];
    keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
    secrets: readonly string[];
    deadlineMs: number;
    seams?: WiringSeams;
  },
): Promise<Map<string, ReachedApp>> {
  const containerOf = (app: ResolvedApp) =>
    options.current.find((c) => c.service === serviceOf(app));
  const ids = apps.flatMap((app) => {
    const container = containerOf(app);
    return container === undefined ? [] : [container.id];
  });
  const addresses = await options.runtime.wiringAddresses(ids);
  const reached = new Map<string, ReachedApp>();
  for (const app of apps) {
    const spec = app.def.api;
    const container = containerOf(app);
    const address = container === undefined ? undefined : addresses[container.id];
    if (spec === undefined || address === undefined) continue;
    const port = app.containerPorts[spec.port] ?? 0;
    const key = options.keys[app.def.id]?.[spec.key.secret];
    reached.set(app.def.id, {
      app,
      api: createAppApi({
        name: app.def.name,
        service: serviceOf(app),
        port,
        endpoint: options.seams?.endpoint?.(app, address, port) ?? {
          host: address,
          port,
        },
        ...(key === undefined ? {} : { key: { scheme: spec.key.scheme, value: key } }),
        secrets: options.secrets,
        ...(options.seams?.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.seams.timeoutMs }),
        retry: { deadlineMs: options.deadlineMs, ...options.seams?.retry },
      }),
    });
  }
  return reached;
}

/**
 * Every secret an app's answer could repeat: the .env values, every key in the store, the
 * admin password in use, and the one the store keeps. That one stays stored when you set
 * admin.password to a file of your own, and an app may still hold it. The client
 * replaces each with *** in what it says.
 */
export function knownSecrets(
  values: Readonly<Record<string, string>>,
  store: SecretStore,
  admin: { password: string },
): string[] {
  const all = [
    ...Object.values(values),
    ...Object.values(store.apps).flatMap((secrets) => Object.values(secrets)),
    ...(store.shared?.adminPassword === undefined ? [] : [store.shared.adminPassword]),
    admin.password,
  ];
  return [...new Set(all)].filter((value) => value !== '');
}

/** The app is up, and still takes Mediaplane's key (spec §6.3, "the source"). */
export async function checkApp(reached: ReachedApp): Promise<void> {
  const spec = reached.app.def.api;
  if (spec === undefined) return;
  await reached.api.ready(spec.ready);
  await reached.api.check(spec.check);
}

/** What one resource is, against what it should be. */
export interface Examined {
  desired: DesiredResource;
  observed: ObservedResource | undefined;
  /** What the change would be; never 'after-start' or 'unknown'. */
  action: 'create' | 'update' | 'adopt' | 'unchanged';
  /** The managed fields and secrets that differ, by name. */
  changes: string[];
}

/**
 * Look at one resource: observe it, compare its managed fields, and check its secrets by
 * using them (spec §6.3). Undefined when the stack wants none. Throws AppApiError.
 */
export async function examine(
  spec: ResourceSpec,
  api: AppApi,
  ctx: WiringContext,
  known: KnownResource | undefined,
): Promise<Examined | undefined> {
  const desired = spec.desired(ctx);
  if (desired === undefined) return undefined;
  const observed = await spec.observe(api, known);
  if (observed === undefined) {
    return { desired, observed, action: 'create', changes: [] };
  }
  const changes = spec.fields.filter(
    (field) => observed.fields[field] !== desired.fields[field],
  );
  if (spec.secrets.length > 0 && spec.verify !== undefined) {
    if (!(await spec.verify(api, desired))) changes.push(...spec.secrets);
  }
  if (changes.length > 0) return { desired, observed, action: 'update', changes };
  const recorded =
    known !== undefined &&
    spec.fields.every((field) => known.fields[field] === desired.fields[field]);
  return { desired, observed, action: recorded ? 'unchanged' : 'adopt', changes };
}

/** The warning for an app Mediaplane couldn't ask, with what to do. */
export function unreachableWarning(app: ResolvedApp, cause: AppApiError): Diagnostic {
  return warning(`wire.${cause.kind}`, cause.message, {
    hint: `check it with "mediaplane status ${app.def.id}", then see ${WIRING_RUNBOOK}`,
  });
}

/**
 * The error for a join of the wiring network that failed (plan, and apply's wire step):
 * a network Mediaplane refuses, a container it can't find itself in, or Docker itself.
 */
export function joinFailure(cause: RuntimeError, env: NodeJS.ProcessEnv): Diagnostic {
  if (cause instanceof WiringRefused) {
    return error('wire.network', cause.message, {
      hint: `the wiring network must be the one compose.yaml makes: take out any networks: entry that changes it in compose.override.yaml (or a network of that name made by hand), then remove the network on the host, as the runbook shows, and run apply: ${WIRING_RUNBOOK}`,
    });
  }
  if (cause instanceof OwnContainerUnknown) {
    return error('wire.network', cause.message, {
      hint: `run Mediaplane with Docker, as deploy/mediaplane.compose.yaml does, or from source on the host, where it joins nothing; see ${WIRING_RUNBOOK}`,
    });
  }
  return dockerUnavailable(cause, env);
}

export interface PlanWiringOptions {
  stack: ResolvedStack;
  current: readonly ContainerState[];
  /** Services apply will create, recreate, start or remove. */
  changing: ReadonlySet<string>;
  /** Whether Mediaplane is on the wiring network, or doesn't need to be. */
  onNetwork: boolean;
  runtime: Runtime;
  keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
  admin: { username: string; password: string };
  secrets: readonly string[];
  known: KnownResources;
  seams?: WiringSeams;
}

/**
 * What apply would do to the wiring (spec §5 step 5): for each app with an API, in order,
 * whether it is up and takes Mediaplane's key, then each of its resources. An app that
 * isn't settled is checked after the start. Asks the apps; changes nothing.
 */
export async function planWiring(
  options: PlanWiringOptions,
): Promise<{ changes: WiringChange[]; diagnostics: Diagnostic[] }> {
  const order = wiringOrder(options.stack);
  const ready = options.onNetwork
    ? order.filter((app) => settled(app, options.current, options.changing))
    : [];
  const reached = await reachApps(ready, { ...options, deadlineMs: PLAN_DEADLINE_MS });
  const changes: WiringChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of order) {
    const ctx: WiringContext = { stack: options.stack, app, admin: options.admin };
    // Only what the stack wants is listed: a resource it doesn't want isn't wiring.
    const targets = wiringTargets(ctx);
    const client = reached.get(app.def.id);
    if (client === undefined && ready.includes(app)) {
      // Running, and apply leaves it as it is, but it isn't on the network.
      const reason = notOnNetwork(app);
      diagnostics.push(
        warning('wire.not-on-network', reason, {
          hint: `see ${WIRING_RUNBOOK}`,
        }),
      );
      changes.push(
        ...targets.map((resource) => ({
          resource,
          action: 'unknown' as const,
          reason,
        })),
      );
      continue;
    }
    if (client === undefined) {
      changes.push(
        ...targets.map((resource) => ({
          resource,
          action: 'after-start' as const,
        })),
      );
      continue;
    }
    const wanted = wantedResources(ctx);
    let looked = 0;
    try {
      await checkApp(client);
      if (wanted.length === 0)
        changes.push({ resource: app.def.id, action: 'unchanged' });
      for (const spec of wanted) {
        const address = resourceAddress(app, spec);
        const result = await examine(spec, client.api, ctx, options.known[address]);
        looked++;
        // Wanted, and desired() is pure: only a guard.
        if (result === undefined) continue;
        changes.push({
          resource: address,
          action: result.action,
          ...(result.changes.length === 0 ? {} : { changes: result.changes }),
        });
      }
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw cause;
      diagnostics.push(unreachableWarning(app, cause));
      // What is left of the app could not be looked at.
      const left = targets.slice(wanted.length === 0 ? 0 : looked);
      changes.push(
        ...left.map((resource) => ({
          resource,
          action: 'unknown' as const,
          reason: cause.message,
        })),
      );
    }
  }
  return { changes, diagnostics };
}
