import type { AppDefinition, Catalog } from '../catalog/types';
import { error, warning, type Diagnostic } from '../diagnostics';
import type { ResolvedStack } from '../resolver/resolve';
import { didYouMean } from '../util/did-you-mean';
import type { DesiredResource, ResourceSpec, Scalar, WiringContext } from './types';

/** `<app>.<resource>: unmanaged`: Mediaplane no longer manages the resource (spec §6.3). */
export const UNMANAGED = 'unmanaged';

/**
 * Why a field that says where an app sends a key can't be kept (`locked`): the stack's
 * keys go only to its own addresses (spec §11, Slice 6), whatever the app holds.
 */
export const SENDS_A_KEY = 'it sets where a key is sent (spec §11, Slice 6)';

/** The stack's overrides (spec §4.2), by key. */
type Overrides = Readonly<Record<string, Scalar>>;

/** Whether the stack's overrides say Mediaplane no longer manages `address`. */
export function isUnmanaged(stack: ResolvedStack, address: string): boolean {
  return stack.config.overrides[address] === UNMANAGED;
}

/**
 * `desired` with the overrides that name the resource's managed fields, as
 * `<address>.<field>` (spec §4.2): Keep mine's values. A locked field keeps its own.
 */
export function withOverrides(
  spec: ResourceSpec,
  address: string,
  desired: DesiredResource,
  overrides: Overrides,
): DesiredResource {
  const kept = spec.fields.flatMap((field): [string, Scalar][] => {
    const value = overrides[`${address}.${field}`];
    return value === undefined || Object.hasOwn(spec.locked ?? {}, field)
      ? []
      : [[field, value]];
  });
  if (kept.length === 0) return desired;
  return { ...desired, fields: { ...desired.fields, ...Object.fromEntries(kept) } };
}

/**
 * What the stack wants of a resource (spec §6.3: D): stack.yaml, through the resource's
 * desired(), plus its overrides. Undefined when the stack wants none, or no longer has
 * Mediaplane manage it (`unmanaged`).
 */
export function desiredOf(
  spec: ResourceSpec,
  ctx: WiringContext,
): DesiredResource | undefined {
  const address = `${ctx.app.def.id}.${spec.name}`;
  if (isUnmanaged(ctx.stack, address)) return undefined;
  const wanted = spec.desired(ctx);
  return wanted === undefined
    ? undefined
    : withOverrides(spec, address, wanted, ctx.stack.config.overrides);
}

/** What an override key names in the catalog: an app's resource, and maybe its field. */
export interface OverrideTarget {
  def: AppDefinition;
  spec: ResourceSpec;
  /** Undefined for `<app>.<resource>`, which takes only `unmanaged`. */
  field: string | undefined;
}

/**
 * The resource, and field, that the override key `key` names (spec §4.2), or why it
 * names none: an app, a resource or a field that isn't there (with the closest name), a
 * secret, or a field Mediaplane won't let an override change. Field names are
 * case-sensitive, as the apps' are.
 */
export function overrideTarget(
  catalog: Catalog,
  key: string,
): { ok: true; target: OverrideTarget } | { ok: false; diagnostic: Diagnostic } {
  const refuse = (code: string, message: string, hint?: string) => ({
    ok: false as const,
    diagnostic: error(code, message, {
      path: `overrides.${key}`,
      ...(hint === undefined ? {} : { hint }),
    }),
  });
  const closest = (name: string, names: readonly string[]) => {
    const near = didYouMean(name, names);
    return near === undefined ? undefined : `did you mean "${near}"?`;
  };
  const [app = '', resource = '', field, ...rest] = key.split('.');
  if (resource === '' || rest.length > 0) {
    return refuse(
      'overrides.invalid',
      `"${key}" is not an override key: they look like <app>.<resource>.<field>`,
    );
  }
  const def = catalog.find((d) => d.id === app);
  if (def === undefined) {
    return refuse(
      'overrides.unknown',
      `"${key}" names no app: there is no ${app}`,
      closest(
        app,
        catalog.map((d) => d.id),
      ),
    );
  }
  const specs = def.integration?.resources ?? [];
  const spec = specs.find((s) => s.name === resource);
  if (spec === undefined) {
    return refuse(
      'overrides.unknown',
      `"${key}" names nothing Mediaplane manages in ${def.name}: it has no ${resource}`,
      closest(
        resource,
        specs.map((s) => s.name),
      ) ?? `${def.name}'s README lists what Mediaplane manages there`,
    );
  }
  if (field === undefined) return { ok: true, target: { def, spec, field } };
  if (spec.secrets.includes(field)) {
    return refuse(
      'overrides.secret',
      `${key} is a secret: Mediaplane checks it with ${def.name}'s own check, and never keeps it`,
      'take it out of overrides:; apply sets it again, or the runbook says what to do if it was changed in the app',
    );
  }
  if (!spec.fields.includes(field)) {
    return refuse(
      'overrides.unmanaged-field',
      `${key} is not a field Mediaplane manages: ${def.id}.${spec.name}'s are ${spec.fields.join(', ')}`,
      closest(field, spec.fields) ??
        `the others are yours already; ${def.name}'s README lists the managed ones`,
    );
  }
  const locked = spec.locked?.[field];
  if (locked !== undefined) {
    return refuse(
      'overrides.locked',
      `${key} can't be kept: ${locked.replaceAll('{resource}', `${def.id}.${spec.name}`)}`,
    );
  }
  return { ok: true, target: { def, spec, field } };
}

/** "text", "a number", "true or false": what a value of `value`'s type is called. */
function kindOf(value: Scalar): string {
  if (typeof value === 'string') return 'text';
  return typeof value === 'number' ? 'a number' : 'true or false';
}

/**
 * What is wrong with the stack's overrides (spec §4.2): a key that names nothing
 * Mediaplane manages, a secret or a locked field (errors), a value of another type than
 * the field's, `<app>.<resource>` with anything but `unmanaged`, and an override that
 * does nothing (a warning): of something this stack doesn't have, or of a field of a
 * resource made `unmanaged`. `unmanaged` of a resource the stack doesn't want is quiet:
 * it keeps one left in the app yours.
 */
export function checkOverrides(
  stack: ResolvedStack,
  catalog: Catalog,
  wiring: Pick<WiringContext, 'admin' | 'keys'>,
): Diagnostic[] {
  return Object.entries(stack.config.overrides).flatMap(([key, value]): Diagnostic[] => {
    const named = overrideTarget(catalog, key);
    if (!named.ok) return [named.diagnostic];
    const { def, spec, field } = named.target;
    const path = `overrides.${key}`;
    if (field === undefined && value !== UNMANAGED) {
      return [
        error(
          'overrides.invalid',
          `${key} takes only "${UNMANAGED}", to stop Mediaplane managing it; a field goes after it, as ${key}.<field>`,
          { path },
        ),
      ];
    }
    const app = stack.apps.find((a) => a.def.id === def.id);
    if (app === undefined) {
      return [
        warning('overrides.unused', `${key} does nothing: the stack has no ${def.name}`, {
          path,
        }),
      ];
    }
    const wanted = spec.desired({ stack, app, ...wiring });
    // Unmanaged, one the stack doesn't want stays so: one left in the app is yours.
    if (wanted === undefined && value === UNMANAGED) return [];
    const address = `${def.id}.${spec.name}`;
    if (field !== undefined && isUnmanaged(stack, address)) {
      return [
        warning(
          'overrides.unused',
          `${key} does nothing: ${address} is ${UNMANAGED}, so Mediaplane neither looks at it nor sets it`,
          { path },
        ),
      ];
    }
    if (wanted === undefined) {
      return [
        warning(
          'overrides.unused',
          `${key} does nothing: Mediaplane doesn't make ${def.id}.${spec.name} in this stack`,
          { path },
        ),
      ];
    }
    const own = field === undefined ? undefined : wanted.fields[field];
    if (own !== undefined && typeof own !== typeof value) {
      return [
        error(
          'overrides.type',
          `${key} must be ${kindOf(own)}, as ${def.name} holds it, not ${kindOf(value)}`,
          { path },
        ),
      ];
    }
    return [];
  });
}
