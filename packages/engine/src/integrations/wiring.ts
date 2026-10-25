import { z } from 'zod';
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
import { serviceAddress, serviceOf } from './address';
import { JoinFailed, OwnContainerUnknown, WiringRefused } from '../runtime/docker';
import type { ContainerState, RuntimeError, Runtime } from '../runtime/types';
import type { SecretStore } from '../secrets/store';
import { foundSecrets, redact, redactionValues, type FoundSecrets } from '../util/redact';
import { compare } from '../util/sort';
import { desiredOf, withOverrides } from './overrides';
import type { KnownResource, KnownResources } from './resources';
import type {
  DesiredResource,
  ObservedResource,
  ResourceSpec,
  Scalar,
  VerifyContext,
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

/**
 * What changed in an app outside Mediaplane since Mediaplane last applied a resource
 * (spec §6.3: O ≠ L), never a secret's value:
 * - `field`: a managed field holds another value than the one applied, and than the one
 *   the stack now wants (`expected`, what apply sets): `actual`, or null with `unreadable`
 *   when the app holds it in a shape Mediaplane can't read. When stack.yaml has changed
 *   it since, `applied` is the value Mediaplane applied;
 * - `missing`: the app no longer holds it;
 * - `secret`: the app's own check refuses one of its secrets (`since`: when drift found
 *   it, for one it doesn't check again).
 */
export interface Drift {
  /** "<app>.<resource>". */
  resource: string;
  kind: 'field' | 'missing' | 'secret';
  field?: string;
  /** The value apply sets: what the stack wants (D). */
  expected?: Scalar;
  /** What Mediaplane applied (L), when the stack now wants another value. */
  applied?: Scalar;
  actual?: Scalar | null;
  unreadable?: string;
  /** true when `actual` or `unreadable` held one of the run's secrets, shown as ***. */
  redacted?: boolean;
  secret?: string;
  since?: string;
}

/**
 * How one secret of a resource was checked (spec §6.3, "verified, never compared"): passed
 * or refused by the app's own check, or unchecked, with why. `at`: when drift last checked
 * it, for a verdict it took from then, rather than check again now.
 */
export interface SecretCheck {
  resource: string;
  secret: string;
  verdict: 'passed' | 'refused' | 'unchecked';
  reason?: string;
  at?: string;
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

/**
 * The app's resources that the stack wants: each one whose `desired` gives one, and that
 * isn't `unmanaged` (desiredOf).
 */
export function wantedResources(ctx: WiringContext): ResourceSpec[] {
  return (ctx.app.def.integration?.resources ?? []).filter(
    (spec) => desiredOf(spec, ctx) !== undefined,
  );
}

/**
 * The items of a list field's value (`lists`): one comma-separated list, as the stack and
 * its overrides give it, without the empty ones. A value that isn't text holds none.
 */
export function listItems(value: Scalar | undefined): string[] {
  return typeof value === 'string' ? value.split(',').filter((item) => item !== '') : [];
}

/**
 * Whether two values of `spec`'s managed `field` are the same: a list field (`lists`) as
 * a set of its items (listItems), whatever their order; any other exactly.
 */
export function sameValue(
  spec: ResourceSpec,
  field: string,
  a: Scalar | undefined,
  b: Scalar | undefined,
): boolean {
  if (a === b) return true;
  if (!(spec.lists ?? []).includes(field)) return false;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const items = (list: string) => [...new Set(listItems(list))].sort(compare).join(',');
  return items(a) === items(b);
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
    /** What the run finds: every client shares it. */
    found: FoundSecrets;
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
    const at = serviceAddress(app, spec.port);
    if (at === undefined) {
      throw new Error(`${app.def.name} has no ${spec.port} port for its API`);
    }
    const { port } = at;
    const key = options.keys[app.def.id]?.[spec.key.secret];
    reached.set(app.def.id, {
      app,
      api: createAppApi({
        name: app.def.name,
        service: at.host,
        port,
        endpoint: options.seams?.endpoint?.(app, address, port) ?? {
          host: address,
          port,
        },
        // Without a key, as Jellyfin is before its first-run setup, still its own way.
        key: { scheme: spec.key.scheme, ...(key === undefined ? {} : { value: key }) },
        secrets: options.secrets,
        found: options.found,
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
 * ones you give (`given`: Plex's token), the admin password in use, and the one the store
 * keeps. That one stays stored when you set admin.password to a file of your own, and an
 * app may still hold it. The client replaces each with *** in what it says.
 */
export function knownSecrets(
  values: Readonly<Record<string, string>>,
  store: SecretStore,
  admin: { password: string },
  given: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): string[] {
  const all = [
    ...Object.values(values),
    ...Object.values(store.apps).flatMap((secrets) => Object.values(secrets)),
    ...Object.values(given).flatMap((secrets) => Object.values(secrets)),
    ...(store.shared?.adminPassword === undefined ? [] : [store.shared.adminPassword]),
    admin.password,
  ];
  return [...new Set(all)].filter((value) => value !== '');
}

export { redactionValues };

/**
 * The app is up, has started if it says when (`started`), and still takes Mediaplane's
 * key (spec §6.3, "the source"). One still starting at the deadline is unreachable for
 * now, as one that doesn't answer is.
 */
export async function checkApp(reached: ReachedApp): Promise<void> {
  const spec = reached.app.def.api;
  if (spec === undefined) return;
  await reached.api.ready(spec.ready);
  if (spec.started !== undefined) {
    const { path, done } = spec.started;
    if (!done(await reached.api.until(path, z.unknown(), done))) {
      throw new AppApiError(
        `${reached.api.name} at ${reached.api.where} is still starting (GET ${path})`,
        { kind: 'unreachable', transient: true },
      );
    }
  }
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
  /** What changed in the app since Mediaplane last applied it; none without a record. */
  drift: Drift[];
  /** How each of its secrets was checked. */
  checks: SecretCheck[];
}

/** How examine treats a resource's secrets. */
export interface ExamineOptions {
  /**
   * false: leave them unchecked, because a resource this one requires is yet to be made
   * or changed. The check could use what isn't there yet: Sonarr's own test of its
   * download client makes a missing qBittorrent category, with no save path. What only
   * the app can say (`resolve`) is left out too, and the fields it fills uncompared.
   */
  verify?: boolean;
  /**
   * The secrets apply's own plan found refused (an `update` naming them). They differ,
   * and the update sets them, without another check: each check of qBittorrent's
   * password that fails counts towards its ban.
   */
  refused?: readonly string[];
  /**
   * What the resource's verify may use (VerifyContext); apply's, which may change things,
   * by default. Plan and drift give `readOnly`, and then a secret drift found refused (the
   * record's `checks`) is taken as refused, without another check, until apply sets it.
   */
  context?: VerifyContext;
}

/** Apply's VerifyContext, without another app: what a check gets by default. */
const APPLYING: VerifyContext = { readOnly: false, peer: () => undefined };

/**
 * Look at one resource: observe it, compare its managed fields with what the stack wants
 * (D against O), and check its secrets by using them (spec §6.3), unless `options` say
 * not to. Against its record (L), say what changed in the app outside Mediaplane: drift,
 * a field that differs from both what was applied and what is wanted now. Undefined when
 * the stack wants none. Throws AppApiError.
 */
export async function examine(
  spec: ResourceSpec,
  api: AppApi,
  ctx: WiringContext,
  known: KnownResource | undefined,
  options: ExamineOptions = {},
): Promise<Examined | undefined> {
  const wanted = desiredOf(spec, ctx);
  if (wanted === undefined) return undefined;
  const address = resourceAddress(ctx.app, spec);
  // What only the app can say, then the overrides again: Keep mine's value wins.
  const desired =
    options.verify !== false && spec.resolve !== undefined
      ? withOverrides(
          spec,
          address,
          await spec.resolve(api, wanted, ctx),
          ctx.stack.config.overrides,
        )
      : wanted;
  const observed = await spec.observe(api, known, desired);
  // A record of another name is of what the stack wanted before, such as qBittorrent's
  // category, once Sonarr's is kept as another: what differs from it is the stack's own
  // change, which apply makes, not one made in the app.
  const record = known?.name === desired.name ? known : undefined;
  const unchecked = (reason: string): SecretCheck[] =>
    spec.secrets.map((secret) => ({
      resource: address,
      secret,
      verdict: 'unchecked',
      reason,
    }));
  if (observed === undefined) {
    return {
      desired,
      observed,
      action: 'create',
      changes: [],
      drift: record === undefined ? [] : [{ resource: address, kind: 'missing' }],
      checks: unchecked('the app has none to check: apply makes it with them'),
    };
  }
  // A field left to a `resolve` that wasn't run isn't known yet: it isn't compared.
  // Every other field is, set or not.
  const unresolved = spec.resolve !== undefined && options.verify === false;
  const compared = unresolved
    ? spec.fields.filter((field) => desired.fields[field] !== undefined)
    : spec.fields;
  const changes = compared.filter(
    (field) => !sameValue(spec, field, observed.fields[field], desired.fields[field]),
  );
  const drift =
    record === undefined
      ? []
      : fieldDrift(spec, address, compared, record, desired, observed);
  // A field that differs makes it an update, which sets the secrets too: checking them
  // would change nothing, and could mislead. A sign-in with a user name the app doesn't
  // have yet fails as if the password were wrong.
  const checks =
    spec.secrets.length === 0
      ? []
      : changes.length > 0
        ? unchecked('a managed field differs: apply sets the secrets with it')
        : await checkSecrets(spec, api, address, desired, observed, known, options);
  const refused = checks.filter((check) => check.verdict === 'refused');
  changes.push(...refused.map((check) => check.secret));
  if (record !== undefined) {
    drift.push(
      ...refused.map((check): Drift => ({
        resource: address,
        kind: 'secret',
        secret: check.secret,
        ...(check.at === undefined ? {} : { since: check.at }),
      })),
    );
  }
  if (changes.length > 0) {
    return { desired, observed, action: 'update', changes, drift, checks };
  }
  const recorded =
    record !== undefined &&
    compared.every((field) =>
      sameValue(spec, field, record.fields[field], desired.fields[field]),
    );
  return {
    desired,
    observed,
    action: recorded ? 'unchanged' : 'adopt',
    changes,
    drift,
    checks,
  };
}

/**
 * The managed fields that changed in the app since they were applied (O ≠ L), unless the
 * app now holds what the stack wants (O = D: stack.yaml was changed to match). A field
 * the app holds in a shape Mediaplane can't read has drifted too, with no value.
 */
function fieldDrift(
  spec: ResourceSpec,
  address: string,
  compared: readonly string[],
  known: KnownResource,
  desired: DesiredResource,
  observed: ObservedResource,
): Drift[] {
  return compared.flatMap((field): Drift[] => {
    const applied = known.fields[field];
    if (applied === undefined) return [];
    // What apply would set; and what it applied, when stack.yaml has changed it since.
    const wanted = desired.fields[field];
    const expected = wanted ?? applied;
    const was =
      wanted === undefined || sameValue(spec, field, wanted, applied) ? {} : { applied };
    const unreadable =
      observed.unreadable?.[field] ??
      (observed.fields[field] === undefined ? 'the app gave none' : undefined);
    if (unreadable !== undefined) {
      return [
        {
          resource: address,
          kind: 'field',
          field,
          expected,
          ...was,
          actual: null,
          unreadable,
        },
      ];
    }
    const actual = observed.fields[field];
    if (
      sameValue(spec, field, actual, applied) ||
      sameValue(spec, field, actual, wanted)
    ) {
      return [];
    }
    return [{ resource: address, kind: 'field', field, expected, ...was, actual }];
  });
}

/**
 * Check a resource's secrets by using them, once every managed field matches: refused
 * ones that apply's own plan found (`refused`), or, in plan and drift, that drift found
 * (the record's `checks`), are taken as refused without another check; secrets waiting
 * for what they require stay unchecked.
 */
async function checkSecrets(
  spec: ResourceSpec,
  api: AppApi,
  address: string,
  desired: DesiredResource,
  observed: ObservedResource,
  known: KnownResource | undefined,
  options: ExamineOptions,
): Promise<SecretCheck[]> {
  const context = options.context ?? APPLYING;
  const all = (verdict: SecretCheck['verdict'], reason?: string): SecretCheck[] =>
    spec.secrets.map((secret) => ({
      resource: address,
      secret,
      verdict,
      ...(reason === undefined ? {} : { reason }),
    }));
  const planned = (options.refused ?? []).filter((name) => spec.secrets.includes(name));
  if (planned.length > 0) {
    return spec.secrets.map((secret) =>
      planned.includes(secret)
        ? { resource: address, secret, verdict: 'refused' }
        : {
            resource: address,
            secret,
            verdict: 'unchecked',
            reason: 'apply sets it with the refused one',
          },
    );
  }
  const found = context.readOnly
    ? spec.secrets.filter((secret) => known?.checks?.[secret]?.verdict === 'refused')
    : [];
  if (found.length > 0) {
    return spec.secrets.map((secret): SecretCheck => {
      const at = known?.checks?.[secret]?.at;
      return found.includes(secret) && at !== undefined
        ? { resource: address, secret, verdict: 'refused', at }
        : {
            resource: address,
            secret,
            verdict: 'unchecked',
            reason: 'apply sets it with the refused one',
          };
    });
  }
  if (options.verify === false) {
    return all('unchecked', 'what it requires is yet to be put in place');
  }
  // The catalog's tests make every resource with secrets give a verify.
  if (spec.verify === undefined) return all('unchecked', 'it has no check');
  const verdict = await spec.verify(api, desired, observed, context);
  if (verdict === true) return all('passed');
  if (verdict === false) return all('refused');
  return all('unchecked', verdict.unchecked);
}

/**
 * The first of the resource's managed fields whose value holds one of `secrets`, by name.
 * resources.json keeps the managed fields and holds no secret, so such a resource is
 * refused before anything is sent for it.
 */
export function fieldHoldingSecret(
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

/** Why a resource whose managed `field` holds a secret is refused. */
export function secretFieldReason(address: string, field: string): string {
  return `${address}.${field} holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value`;
}

/** The warning for an app Mediaplane couldn't ask, with what to do. */
export function unreachableWarning(app: ResolvedApp, cause: AppApiError): Diagnostic {
  return warning(`wire.${cause.kind}`, cause.message, {
    hint: `check it with "mediaplane status ${app.def.id}", then see ${WIRING_RUNBOOK}`,
  });
}

/**
 * The error for a join of the wiring network that failed (plan, and apply's wire step):
 * a network Mediaplane refuses, a container it can't find itself in, a join Docker
 * refused, or Docker itself.
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
  // Docker read the network a moment before: advice for a Docker out of reach rarely fits.
  if (cause instanceof JoinFailed) {
    return error('wire.network', cause.message, {
      hint: `the reason after the colon is Docker's. If it says "not found", the network was removed or made anew meanwhile: run apply again. Otherwise see "could not join" in ${WIRING_RUNBOOK}`,
    });
  }
  return dockerUnavailable(cause, env);
}

/**
 * The error for a state/resources.json that doesn't parse (plan, and apply's wire step),
 * which Mediaplane never writes over. The file holds no secret, so the message may name
 * what is wrong in it.
 */
export function resourcesInvalid(cause: unknown): Diagnostic {
  return error(
    'resources.invalid',
    cause instanceof Error ? cause.message : String(cause),
    {
      hint: `move it aside and run plan again: Mediaplane finds what it made by name, and adopts it (${WIRING_RUNBOOK})`,
    },
  );
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
  /** What the run finds in the apps' answers (FoundSecrets); plan's own, by default. */
  found?: FoundSecrets;
  known: KnownResources;
  seams?: WiringSeams;
}

/** What planWiring found: apply's changes, and what drift found on the way. */
export interface PlannedWiring {
  changes: WiringChange[];
  diagnostics: Diagnostic[];
  /** What changed in the apps outside Mediaplane since it applied them (spec §6.3). */
  drift: Drift[];
  /** How each secret of each resource it looked at was checked. */
  checks: SecretCheck[];
}

/**
 * What apply would do to the wiring (spec §5 step 5): for each app with an API, in order,
 * whether it is up and takes Mediaplane's key, then each of its resources, and what
 * changed in them outside Mediaplane (spec §6.3). An app that isn't settled is checked
 * after the start. Asks the apps; changes nothing but for the marks its checks leave.
 */
export async function planWiring(options: PlanWiringOptions): Promise<PlannedWiring> {
  const order = wiringOrder(options.stack);
  const ready = options.onNetwork
    ? order.filter((app) => settled(app, options.current, options.changing))
    : [];
  const found = options.found ?? foundSecrets();
  const reached = await reachApps(ready, {
    ...options,
    found,
    deadlineMs: PLAN_DEADLINE_MS,
  });
  const changes: WiringChange[] = [];
  const diagnostics: Diagnostic[] = [];
  const drift: Drift[] = [];
  const checks: SecretCheck[] = [];
  /** The apps that took Mediaplane's key: what a check may ask of another app. */
  const checked = new Map<string, AppApi>();
  const context: VerifyContext = {
    readOnly: true,
    peer: (app) => checked.get(app),
  };
  /**
   * A value from an app, and what was said of one Mediaplane can't read, shown without any
   * secret the run knows of by then.
   */
  const shown = (entry: Drift): Drift => {
    const values = redactionValues([...options.secrets, ...found.values]);
    const hidden = (text: string | null | Scalar | undefined) =>
      typeof text === 'string' ? redact(text, values) : text;
    const actual = hidden(entry.actual);
    const unreadable = hidden(entry.unreadable);
    if (actual === entry.actual && unreadable === entry.unreadable) return entry;
    return {
      ...entry,
      ...(actual === undefined ? {} : { actual }),
      ...(typeof unreadable === 'string' ? { unreadable } : {}),
      redacted: true,
    };
  };
  /**
   * Resources apply would make or change, that couldn't be looked at, or whose secrets
   * went unchecked: not known to be in place.
   */
  const pending = new Set<string>();
  const add = (change: WiringChange) => {
    changes.push(change);
    if (change.action !== 'unchanged' && change.action !== 'adopt') {
      pending.add(change.resource);
    }
  };
  for (const app of order) {
    const ctx: WiringContext = {
      stack: options.stack,
      app,
      admin: options.admin,
      keys: options.keys,
    };
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
      for (const resource of targets) add({ resource, action: 'unknown', reason });
      continue;
    }
    if (client === undefined) {
      for (const resource of targets) add({ resource, action: 'after-start' });
      continue;
    }
    try {
      await checkApp(client);
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw cause;
      diagnostics.push(unreachableWarning(app, cause));
      for (const resource of targets) {
        add({ resource, action: 'unknown', reason: cause.message });
      }
      continue;
    }
    checked.set(app.def.id, client.api);
    const wanted = wantedResources(ctx);
    if (wanted.length === 0) add({ resource: app.def.id, action: 'unchanged' });
    for (const [index, spec] of wanted.entries()) {
      const address = resourceAddress(app, spec);
      // What the wire step would refuse, before anything is sent: plan says so first.
      const desired = desiredOf(spec, ctx);
      const held =
        desired === undefined
          ? undefined
          : fieldHoldingSecret(spec, desired, options.secrets);
      if (held !== undefined) {
        const reason = secretFieldReason(address, held);
        diagnostics.push(
          warning('wire.secret-field', reason, { hint: `see ${WIRING_RUNBOOK}` }),
        );
        add({ resource: address, action: 'unknown', reason });
        continue;
      }
      // Its secrets are checked only once what it requires is in place: plan changes
      // nothing, and the check could make what is missing (spec §5.2, §6.3).
      const waiting = (spec.requires ?? []).some((needed) => pending.has(needed));
      let result: Examined | undefined;
      try {
        result = await examine(spec, client.api, ctx, options.known[address], {
          verify: !waiting,
          context,
        });
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw cause;
        if (cause.kind === 'unreachable' || cause.kind === 'timeout' || cause.transient) {
          // The app stopped answering, or keeps failing for now (502, 503, 504): what is
          // left of it can't be looked at either, and plan's wait is the app's, once.
          diagnostics.push(unreachableWarning(app, cause));
          for (const left of wanted.slice(index)) {
            add({
              resource: resourceAddress(app, left),
              action: 'unknown',
              reason: cause.message,
            });
          }
          break;
        }
        // The app answered, about this resource: its others are still asked. A resource
        // can write its own message, which the client never saw: it is redacted here.
        const said = redact(
          cause.message,
          redactionValues([...options.secrets, ...found.values]),
        );
        diagnostics.push(
          warning(`wire.${cause.kind}`, said, { hint: `see ${WIRING_RUNBOOK}` }),
        );
        add({ resource: address, action: 'unknown', reason: said });
        continue;
      }
      // Wanted, and desired() is pure: only a guard.
      if (result === undefined) continue;
      add({
        resource: address,
        action: result.action,
        ...(result.changes.length === 0 ? {} : { changes: result.changes }),
      });
      drift.push(...result.drift.map(shown));
      checks.push(...result.checks);
      // Its secrets went unchecked, so it isn't known to be in place either: what
      // requires it waits too.
      if (waiting) pending.add(address);
    }
  }
  return { changes, diagnostics, drift, checks };
}
