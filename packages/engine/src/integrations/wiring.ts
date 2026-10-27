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
import { desiredOf, isUnmanaged, withOverrides } from './overrides';
import type { KeyChecks, KnownResource, KnownResources } from './resources';
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

/** Where drift found in the apps sends you. */
export const DRIFT_RUNBOOK = runbookUrl('drift-reported');

/** How long plan waits for an app that is starting, in ms: apply waits APP_DEADLINE_MS. */
export const PLAN_DEADLINE_MS = 15_000;

/**
 * What apply would do to one managed resource (spec §5 step 5, "the wiring"):
 * - `create`, `update`: make it, or make it match (`changes` names what differs);
 * - `adopt`: the app already holds it as wanted, and resources.json doesn't say so yet;
 * - `unchanged`;
 * - `after-start`: its app isn't running, or apply will change its container, so it is
 *   checked after the start;
 * - `unknown`: Mediaplane couldn't ask the app (`reason`, and a warning, say why);
 * - `remove`: Mediaplane made it, by its record, the stack no longer wants it, and the app
 *   still holds it as Mediaplane made it: apply removes it (spec §8.1(3) step 4).
 */
export type WiringAction =
  'create' | 'update' | 'adopt' | 'unchanged' | 'after-start' | 'unknown' | 'remove';

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
 *   it, for one it doesn't check again);
 * - `key`: an app refuses its own key, which Mediaplane holds (`resource` is the app, and
 *   `secret` the key's name), or a resource holds that key (`source`): a shared key
 *   changed at its source;
 * - `left`: the app still holds a resource Mediaplane made that the stack no longer
 *   wants, such as Prowlarr's link to an arr taken out of the stack. Apply removes it,
 *   unless `stays` says why it leaves it there.
 */
export interface Drift {
  /** "<app>.<resource>", or "<app>" for an app that refuses its key. */
  resource: string;
  kind: 'field' | 'missing' | 'secret' | 'key' | 'left';
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
  /** key: the app whose key the resource holds. */
  source?: string;
  /**
   * left: why apply leaves it in the app: Mediaplane doesn't remove that kind of resource,
   * the app holds what is yours in it, or it is no longer as Mediaplane made it.
   */
  stays?: string;
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
 * its overrides give it, each without the spaces around it, and without the empty ones.
 * A value that isn't text holds none.
 */
export function listItems(value: Scalar | undefined): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
    : [];
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
  /**
   * `mediaplane drift`'s, which checks again a secret that passed only once the resource's
   * `checkEvery` has gone by, from `now`.
   */
  drift?: { now: () => Date };
  /**
   * false: check none of its secrets, and ask the app nothing but to read the resource
   * (`mediaplane keep`, which needs only its fields): what only the app can say
   * (`resolve`, which may use the app's own test, as Seerr's does) is what was applied.
   */
  secrets?: boolean;
  /**
   * Why its secrets aren't checked, nor what only the app can say asked (`resolve`): it
   * holds a key that the key's own app refuses, so a check would only fail, leaving a
   * mark in both apps.
   */
  blocked?: string;
  /**
   * The values of the secrets apply generates (plan's preview of them, such as a rotated
   * admin password): no app holds one yet, so a secret holding one is a change, which
   * apply sets, and isn't checked. A check would only fail, leaving a mark in the app (a
   * failed sign-in, which counts towards qBittorrent's ban).
   */
  fresh?: readonly string[];
  /**
   * The values the app has never had: the admin password Mediaplane holds, for an app
   * Mediaplane couldn't set it in (`shared.adminPasswordNotIn`). As `fresh`: a change,
   * which apply sets, and isn't checked, since a sign-in with it could only fail.
   */
  lacks?: readonly string[];
}

/** Apply's VerifyContext, without another app: what a check gets by default. */
const APPLYING: VerifyContext = { readOnly: false, peer: () => undefined };

/** A verdict on a secret, without what it is on. */
type Verdict = Omit<SecretCheck, 'resource' | 'secret'>;

/** Why a secret beside one found refused isn't checked. */
const WITH_REFUSED: Verdict = {
  verdict: 'unchecked',
  reason: 'apply sets it with the refused one',
};

/** Why a secret apply generates isn't checked. */
const FRESH: Verdict = {
  verdict: 'unchecked',
  reason: 'apply generates it, and sets it: no app holds it yet',
};

/** Why a secret the app has never had isn't checked. */
const LACKED: Verdict = {
  verdict: 'unchecked',
  reason: 'the app has never had it: apply sets it',
};

/** Why a secret the app made itself at its first-run setup isn't checked. */
const REPLACED: Verdict = {
  verdict: 'unchecked',
  reason: "the app made its own at its first-run setup: apply gives it the stack's",
};

/** Why a secret beside a new one (FRESH, LACKED) isn't checked. */
const WITH_NEW: Verdict = {
  verdict: 'unchecked',
  reason: 'apply sets it with the new one',
};

/** Each of the resource's secrets, with its verdict. */
function eachSecret(
  spec: ResourceSpec,
  resource: string,
  verdictOf: (secret: string) => Verdict,
): SecretCheck[] {
  return spec.secrets.map((secret) => ({ resource, secret, ...verdictOf(secret) }));
}

/** Every one of the resource's secrets, with one verdict. */
function everySecret(
  spec: ResourceSpec,
  resource: string,
  verdict: SecretCheck['verdict'],
  reason?: string,
): SecretCheck[] {
  return eachSecret(spec, resource, () => ({
    verdict,
    ...(reason === undefined ? {} : { reason }),
  }));
}

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
  // What only the app can say, then the overrides again: Keep mine's value wins. Keep
  // takes it from what was applied instead, and so asks the app nothing more. It isn't
  // asked while what the resource requires is yet to be put in place, while it holds a
  // key its own app refuses, nor in plan and drift while one of its secrets is known
  // refused: the app could use that secret to say it, and a key known wrong leaves no new
  // failing mark (the owner's decision of 2026-10-17). Apply asks it.
  const keeping = options.secrets === false && spec.resolve !== undefined;
  const recalled =
    options.context?.readOnly === true &&
    spec.secrets.some((secret) => known?.checks?.[secret]?.verdict === 'refused');
  const resolving =
    spec.resolve !== undefined &&
    !keeping &&
    options.verify !== false &&
    options.blocked === undefined &&
    !recalled;
  const desired = keeping
    ? withOverrides(
        spec,
        address,
        { ...wanted, fields: { ...known?.fields, ...wanted.fields } },
        ctx.stack.config.overrides,
      )
    : resolving && spec.resolve !== undefined
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
  const unchecked = (reason: string) => everySecret(spec, address, 'unchecked', reason);
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
  const unresolved = spec.resolve !== undefined && !keeping && !resolving;
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
  // A secret apply generates, or one the app has never had, is new to the app: a change,
  // set with the others.
  const newVerdict = (secret: string): Verdict | undefined => {
    const value = desired.secrets[secret] ?? '';
    if (value === '') return undefined;
    if ((options.fresh ?? []).includes(value)) return FRESH;
    return (options.lacks ?? []).includes(value) ? LACKED : undefined;
  };
  const fresh = spec.secrets.filter((secret) => newVerdict(secret) !== undefined);
  // A secret the app made itself at its first-run setup, replaced with the stack's until
  // the record says Mediaplane gave it (`adoptSets`, the record's `given`): a change,
  // never checked.
  const replacing = (spec.adoptSets ?? []).filter(
    (secret) => spec.secrets.includes(secret) && !(record?.given ?? []).includes(secret),
  );
  // A field that differs makes it an update, which sets the secrets too: checking them
  // would change nothing, and could mislead. A sign-in with a user name the app doesn't
  // have yet fails as if the password were wrong.
  const checks =
    spec.secrets.length === 0
      ? []
      : replacing.length > 0
        ? eachSecret(spec, address, (secret) =>
            replacing.includes(secret) ? REPLACED : WITH_NEW,
          )
        : changes.length > 0
          ? unchecked('a managed field differs: apply sets the secrets with it')
          : fresh.length > 0
            ? eachSecret(spec, address, (secret) => newVerdict(secret) ?? WITH_NEW)
            : await checkSecrets(spec, api, address, desired, observed, known, options);
  const refused = checks.filter((check) => check.verdict === 'refused');
  changes.push(...refused.map((check) => check.secret));
  if (changes.length === 0) changes.push(...fresh);
  changes.push(...replacing.filter((secret) => !changes.includes(secret)));
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
 * the app holds in a shape Mediaplane can't read has drifted too, with no value. One the
 * stack no longer sets hasn't: apply doesn't set it, so it has nothing to put back.
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
    // What apply would set; and what it applied, when stack.yaml has changed it since.
    const expected = desired.fields[field];
    if (applied === undefined || expected === undefined) return [];
    const was = sameValue(spec, field, expected, applied) ? {} : { applied };
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
      sameValue(spec, field, actual, expected)
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
  const all = (verdict: SecretCheck['verdict'], reason?: string) =>
    everySecret(spec, address, verdict, reason);
  if (options.secrets === false) return all('unchecked', 'keep checks no secret');
  if (options.blocked !== undefined) return all('unchecked', options.blocked);
  const planned = (options.refused ?? []).filter((name) => spec.secrets.includes(name));
  if (planned.length > 0) {
    return eachSecret(spec, address, (secret) =>
      planned.includes(secret) ? { verdict: 'refused' } : WITH_REFUSED,
    );
  }
  const found = context.readOnly
    ? spec.secrets.filter((secret) => known?.checks?.[secret]?.verdict === 'refused')
    : [];
  if (found.length > 0) {
    return eachSecret(spec, address, (secret) => {
      const at = known?.checks?.[secret]?.at;
      return found.includes(secret) && at !== undefined
        ? { verdict: 'refused', at }
        : WITH_REFUSED;
    });
  }
  if (options.verify === false) {
    return all(
      'unchecked',
      'what it requires is yet to be put in place, which apply does first',
    );
  }
  // Drift checks again what passed only once its time has gone by: each check of
  // Jellyfin's admin signs in, which its activity log keeps (the owner's decision).
  const every = spec.checkEvery;
  if (options.drift !== undefined && every !== undefined) {
    const now = options.drift.now().getTime();
    const passed = spec.secrets.map((secret) => known?.checks?.[secret]);
    if (
      passed.every(
        (check) =>
          check?.verdict === 'passed' && now - new Date(check.at).getTime() < every,
      )
    ) {
      return eachSecret(spec, address, (secret) => ({
        verdict: 'passed',
        at: known?.checks?.[secret]?.at ?? '',
      }));
    }
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
  /**
   * The apps' own keys found refused (state/resources.json's `keys`): such an app isn't
   * sent its key again, until apply checks it and it passes.
   */
  refusedKeys?: KeyChecks;
  /**
   * `mediaplane drift`'s, which checks a secret that passed again only once its resource's
   * `checkEvery` has gone by, and reads the apps' own health checks (`health`).
   */
  drift?: { now: () => Date };
  /**
   * `mediaplane keep`'s: look at this one resource ("<app>.<resource>") and its app only,
   * checking none of its secrets.
   */
  only?: string;
  /** The values of the secrets apply generates (ExamineOptions.fresh). */
  fresh?: readonly string[];
  /** By app, the values it has never had (ExamineOptions.lacks). */
  lacking?: Readonly<Record<string, readonly string[]>>;
  /**
   * The apps whose first-run setup plan asks the app itself about (BootstrapPlan.ask), as
   * it reaches each: `open` gives the answers.
   */
  ask?: readonly string[];
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
  /**
   * Of `ask`, by app, whether its first-run setup is open (Bootstrap.open), as the app
   * itself said; one it couldn't ask isn't here.
   */
  open?: Record<string, boolean>;
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
  const open: Record<string, boolean> = {};
  /** The apps that took Mediaplane's key: what a check may ask of another app. */
  const checked = new Map<string, AppApi>();
  const context: VerifyContext = {
    readOnly: true,
    peer: (app) => checked.get(app),
  };
  /** The keys of the apps that refuse their own, as Mediaplane holds them: by value. */
  const refusing = new Map<string, string>();
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
  const { only } = options;
  for (const app of order) {
    if (only !== undefined && !only.startsWith(`${app.def.id}.`)) continue;
    const ctx: WiringContext = {
      stack: options.stack,
      app,
      admin: options.admin,
      keys: options.keys,
    };
    // Only what the stack wants is listed: a resource it doesn't want isn't wiring.
    const targets =
      only === undefined
        ? wiringTargets(ctx)
        : wiringTargets(ctx).filter((target) => target === only);
    // A resource that holds the key of an app that refuses it: drift on the consumer
    // too (§6.3), whether or not its own app can be asked. Its secrets aren't checked.
    const holding = holdingRefused(ctx, refusing);
    drift.push(...holding);
    const blocked = new Map(
      holding.map((entry) => [
        entry.resource,
        `${entry.source ?? ''} refuses its own key, which this holds, so neither is checked until the key is put back, as ${WIRING_RUNBOOK} shows`,
      ]),
    );
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
      for (const change of leftUnasked(ctx, options.known, only, reason)) add(change);
      continue;
    }
    if (client === undefined) {
      for (const resource of targets) add({ resource, action: 'after-start' });
      // Drift and keep say they couldn't look at what is left there either; plan, at
      // what apply's wire step may remove, once the app has started.
      for (const change of leftUnasked(ctx, options.known, only)) {
        if (options.drift !== undefined || removable(ctx, change.resource)) add(change);
      }
      continue;
    }
    // Whether its first-run setup is open, as it says itself, without its key: asked
    // first, since an app whose setup is open takes no key.
    const setup = app.def.bootstrap;
    if (setup !== undefined && options.ask?.includes(app.def.id) === true) {
      try {
        open[app.def.id] = await setup.open(client.api);
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw cause;
      }
      // Open, it takes no key, and is set up first: its wiring is checked after that.
      if (open[app.def.id] === true) {
        for (const resource of targets) add({ resource, action: 'after-start' });
        continue;
      }
    }
    const name = app.def.api?.key.secret;
    const key = name === undefined ? undefined : options.keys[app.def.id]?.[name];
    /** What couldn't be looked at in the app: its resources, and what is left there. */
    const notAsked = (reason: string) => {
      for (const resource of targets) add({ resource, action: 'unknown', reason });
      for (const change of leftUnasked(ctx, options.known, only, reason)) add(change);
    };
    // The app refused its key when last asked: it isn't sent again until apply checks it
    // (the owner's decision on qBittorrent's ban, which counts failed sign-ins).
    const recalled =
      name === undefined ? undefined : options.refusedKeys?.[`${app.def.id}.${name}`];
    if (recalled !== undefined && name !== undefined) {
      drift.push({ resource: app.def.id, kind: 'key', secret: name, since: recalled.at });
      if (key !== undefined) refusing.set(key, app.def.id);
      notAsked(
        `${app.def.name} refused the key Mediaplane holds for it (${name}) at ${recalled.at}, so it isn't sent again until apply checks it; see ${WIRING_RUNBOOK}`,
      );
      continue;
    }
    try {
      await checkApp(client);
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw cause;
      diagnostics.push(unreachableWarning(app, cause));
      notAsked(cause.message);
      // The app refuses the key Mediaplane holds for it: changed at its source (§6.3).
      if (cause.kind === 'auth' && name !== undefined && key !== undefined) {
        drift.push({ resource: app.def.id, kind: 'key', secret: name });
        refusing.set(key, app.def.id);
      }
      continue;
    }
    checked.set(app.def.id, client.api);
    const wanted = wantedResources(ctx).filter(
      (spec) => only === undefined || resourceAddress(app, spec) === only,
    );
    if (wanted.length === 0) add({ resource: app.def.id, action: 'unchanged' });
    /** Why the app stopped answering, when it did: what is left of it isn't asked. */
    let stopped: string | undefined;
    for (const [index, spec] of wanted.entries()) {
      const address = resourceAddress(app, spec);
      // What the wire step would refuse, before anything is sent: plan says so first.
      const desired = desiredOf(spec, ctx);
      const secretField =
        desired === undefined
          ? undefined
          : fieldHoldingSecret(spec, desired, options.secrets);
      if (secretField !== undefined) {
        const reason = secretFieldReason(address, secretField);
        diagnostics.push(
          warning('wire.secret-field', reason, { hint: `see ${WIRING_RUNBOOK}` }),
        );
        add({ resource: address, action: 'unknown', reason });
        continue;
      }
      // Its secrets are checked only once what it requires is in place: plan changes
      // nothing, and the check could make what is missing (spec §5.2, §6.3).
      const waiting = (spec.requires ?? []).some((needed) => pending.has(needed));
      const held = blocked.get(address);
      let result: Examined | undefined;
      try {
        result = await examine(spec, client.api, ctx, options.known[address], {
          verify: !waiting,
          context,
          ...(options.drift === undefined ? {} : { drift: options.drift }),
          ...(only === undefined ? {} : { secrets: false }),
          ...(held === undefined ? {} : { blocked: held }),
          ...(options.fresh === undefined ? {} : { fresh: options.fresh }),
          ...(options.lacking?.[app.def.id] === undefined
            ? {}
            : { lacks: options.lacking[app.def.id] }),
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
          stopped = cause.message;
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
      drift.push(...result.drift);
      checks.push(...result.checks);
      // Its secrets went unchecked, so it isn't known to be in place either: what
      // requires it waits too.
      if (waiting || held !== undefined) pending.add(address);
      if (options.drift !== undefined && spec.health !== undefined && result.observed) {
        const said = await healthOf(spec, client.api, result.observed);
        if (said !== undefined) {
          diagnostics.push(
            warning(
              'drift.health',
              redact(
                `${address}: ${said}`,
                redactionValues([...options.secrets, ...found.values]),
              ),
              {
                hint: `the app's own health check found it, and apply can't put it right: see the app's own health page, and ${DRIFT_RUNBOOK}`,
              },
            ),
          );
        }
      }
    }
    // Keep looks for its one resource among those left, when the stack doesn't want it.
    if (stopped !== undefined) {
      for (const change of leftUnasked(ctx, options.known, only, stopped)) add(change);
    } else if (only === undefined || wanted.length === 0) {
      const left = await leftIn(
        ctx,
        client.api,
        options.known,
        [...options.secrets, ...found.values],
        only,
      );
      drift.push(...left.drift);
      diagnostics.push(...left.diagnostics);
      for (const change of left.changes) add(change);
    }
  }
  const planned = redacted({ changes, diagnostics, drift, checks }, [
    ...options.secrets,
    ...found.values,
  ]);
  return options.ask === undefined ? planned : { ...planned, open };
}

/**
 * What planWiring found, with every secret the run came to know of kept out, once, at its
 * end: a key read in a later app's answer is kept out of what an earlier app said too.
 * A value an app holds, and what was said of one Mediaplane can't read, is shown with
 * *** and marked `redacted`; a check's reason and a change's are redacted as they are,
 * since either may name what an app holds (a category, say), and so is each diagnostic's
 * message, which was redacted as it was made with the secrets known then.
 */
function redacted(planned: PlannedWiring, secrets: readonly string[]): PlannedWiring {
  const values = redactionValues(secrets);
  const hidden = <T>(text: T): T =>
    (typeof text === 'string' ? redact(text, values) : text) as T;
  const drift = planned.drift.map((entry): Drift => {
    // Why one left stays can name what the app holds: a reason, redacted as it is.
    if (entry.stays !== undefined) return { ...entry, stays: hidden(entry.stays) };
    const actual = hidden(entry.actual);
    const unreadable = hidden(entry.unreadable);
    if (actual === entry.actual && unreadable === entry.unreadable) return entry;
    return {
      ...entry,
      ...(actual === undefined ? {} : { actual }),
      ...(unreadable === undefined ? {} : { unreadable }),
      redacted: true,
    };
  });
  const reasoned = <T extends { reason?: string }>(entry: T): T =>
    entry.reason === undefined ? entry : { ...entry, reason: hidden(entry.reason) };
  return {
    changes: planned.changes.map(reasoned),
    diagnostics: planned.diagnostics.map((d) => ({ ...d, message: hidden(d.message) })),
    drift,
    checks: planned.checks.map(reasoned),
  };
}

/**
 * The resources of `ctx`'s app that the stack wants with a key that its source app
 * refuses (`refused`, by value), as `key` drift that names the source.
 */
function holdingRefused(
  ctx: WiringContext,
  refused: ReadonlyMap<string, string>,
): Drift[] {
  if (refused.size === 0) return [];
  return wantedResources(ctx).flatMap((spec) =>
    Object.entries(desiredOf(spec, ctx)?.secrets ?? {}).flatMap(
      ([secret, value]): Drift[] => {
        const source = refused.get(value);
        return source === undefined
          ? []
          : [{ resource: resourceAddress(ctx.app, spec), kind: 'key', secret, source }];
      },
    ),
  );
}

/** What the app's own health check says of a resource, or undefined if it can't say. */
async function healthOf(
  spec: ResourceSpec,
  api: AppApi,
  observed: ObservedResource,
): Promise<string | undefined> {
  try {
    return await spec.health?.(api, observed);
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    return `its app's own health check could not be read: ${cause.message}`;
  }
}

/** The resources Mediaplane recorded in `ctx`'s app that the stack no longer wants. */
export function leftOf(
  ctx: WiringContext,
  known: KnownResources,
  only?: string,
): { spec: ResourceSpec; address: string; record: KnownResource }[] {
  return (ctx.app.def.integration?.resources ?? []).flatMap((spec) => {
    const address = resourceAddress(ctx.app, spec);
    const record = known[address];
    if (only !== undefined && address !== only) return [];
    if (record === undefined || isUnmanaged(ctx.stack, address)) return [];
    return desiredOf(spec, ctx) === undefined ? [{ spec, address, record }] : [];
  });
}

/**
 * What Mediaplane made in `ctx`'s app that the stack no longer wants, when the app can't
 * be asked: a check it couldn't make each, as `unknown` with why (`reason`), or after the
 * start; never said to be gone.
 */
function leftUnasked(
  ctx: WiringContext,
  known: KnownResources,
  only: string | undefined,
  reason?: string,
): WiringChange[] {
  return leftOf(ctx, known, only).map(({ address }) =>
    reason === undefined
      ? { resource: address, action: 'after-start' }
      : {
          resource: address,
          action: 'unknown',
          reason: `Mediaplane made ${address}, which the stack no longer wants, and couldn't ask ${ctx.app.def.name} whether it still holds it: ${reason}`,
        },
  );
}

/** Whether the resource at `address`, of `ctx`'s app, is of a kind apply removes. */
function removable(ctx: WiringContext, address: string): boolean {
  return (ctx.app.def.integration?.resources ?? []).some(
    (spec) => resourceAddress(ctx.app, spec) === address && spec.remove !== undefined,
  );
}

/**
 * Whether what the app holds is the resource Mediaplane made, as its record says: the
 * same id in the app, and the name Mediaplane gave it. One renamed, or one of the name
 * with another id, may be yours now: apply never removes it.
 */
export function madeAsRecorded(
  observed: ObservedResource,
  record: KnownResource,
): boolean {
  return observed.id === record.id && observed.name === record.name;
}

/** Why apply leaves a resource it doesn't remove: there is no way to. */
const CANT_REMOVE = "Mediaplane doesn't remove this kind of resource";

/** Why apply leaves a resource that is no longer as Mediaplane made it. */
const NOT_AS_MADE =
  "it is no longer as Mediaplane made it (its name or its id in the app has changed), so it may be yours: Mediaplane doesn't remove it";

/**
 * Why apply leaves `observed`, the app's resource of `spec` that the stack no longer
 * wants, in the app; undefined when it removes it. Throws AppApiError.
 */
export async function whyItStays(
  spec: ResourceSpec,
  api: AppApi,
  observed: ObservedResource,
  record: KnownResource,
): Promise<string | undefined> {
  if (spec.remove === undefined) return CANT_REMOVE;
  if (!madeAsRecorded(observed, record)) return NOT_AS_MADE;
  return spec.cannotRemove?.(api, observed);
}

/**
 * The resources Mediaplane made in `ctx`'s app, by its record, that the stack no longer
 * wants and the app still holds (`left`): apply removes each that it can (`remove`),
 * still as Mediaplane made it (spec §8.1(3) step 4), and drift says why it leaves the
 * others (`stays`). One you stopped it managing (`unmanaged`) is yours. One the app can't
 * say about is a warning, and a change it couldn't check (`unknown`), never said to be
 * gone, nor removed: drift isn't clear then.
 */
async function leftIn(
  ctx: WiringContext,
  api: AppApi,
  known: KnownResources,
  secrets: readonly string[],
  only?: string,
): Promise<{ drift: Drift[]; diagnostics: Diagnostic[]; changes: WiringChange[] }> {
  const drift: Drift[] = [];
  const diagnostics: Diagnostic[] = [];
  const changes: WiringChange[] = [];
  for (const { spec, address, record } of leftOf(ctx, known, only)) {
    try {
      const observed = await spec.observe(api, record);
      if (observed === undefined) continue;
      const stays = await whyItStays(spec, api, observed, record);
      if (stays === undefined) {
        drift.push({ resource: address, kind: 'left' });
        changes.push({ resource: address, action: 'remove' });
      } else {
        drift.push({
          resource: address,
          kind: 'left',
          stays: redact(stays, redactionValues(secrets)),
        });
      }
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw cause;
      const said = redact(
        `Mediaplane made ${address}, which the stack no longer wants, and couldn't tell whether ${ctx.app.def.name} still holds it: ${cause.message}`,
        redactionValues(secrets),
      );
      diagnostics.push(
        warning('drift.left-unknown', said, { hint: `see ${DRIFT_RUNBOOK}` }),
      );
      changes.push({ resource: address, action: 'unknown', reason: said });
    }
  }
  return { drift, diagnostics, changes };
}
