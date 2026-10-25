import { compare } from '../util/sort';
import type { ObservedResource, Scalar } from './types';

/** What kind of value `value` is: what an app held instead of what was expected. */
function kindOf(value: unknown): string {
  if (value === undefined || value === null) return 'nothing';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'true or false';
  return Array.isArray(value) ? 'a list' : 'an object';
}

/**
 * Reads a resource's managed fields from what its app holds, and notes each one it can't
 * read, of another type or missing, rather than take it as empty (spec §6.3): `observed`
 * leaves such a field out, so it differs, and names it in `unreadable`, so that plan and
 * drift say what was found.
 */
export interface FieldReader {
  text(field: string, value: unknown): string | undefined;
  number(field: string, value: unknown): number | undefined;
  flag(field: string, value: unknown): boolean | undefined;
  /** A list of numbers, as one sorted, comma-separated list: "5000,5010". */
  numbers(field: string, value: unknown): string | undefined;
  /** Note `field` as one Mediaplane can't read, and why: its value is then none. */
  refuse(field: string, why: string): Scalar | undefined;
  /** The resource as read: `fields` without those it couldn't read. */
  observed(
    id: ObservedResource['id'],
    name: string,
    fields: Readonly<Record<string, Scalar | undefined>>,
  ): ObservedResource;
}

/** A new FieldReader, for one resource. */
export function fieldReader(): FieldReader {
  const unreadable: Record<string, string> = {};
  const note = (field: string, why: string) => {
    unreadable[field] = why;
  };
  return {
    text(field, value) {
      if (typeof value === 'string') return value;
      note(field, `${kindOf(value)}, not text`);
      return undefined;
    },
    number(field, value) {
      if (typeof value === 'number') return value;
      note(field, `${kindOf(value)}, not a number`);
      return undefined;
    },
    flag(field, value) {
      if (typeof value === 'boolean') return value;
      note(field, `${kindOf(value)}, not true or false`);
      return undefined;
    },
    numbers(field, value) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
        return [...value].sort((a: number, b: number) => a - b).join(',');
      }
      note(field, `${kindOf(value)}, not a list of numbers`);
      return undefined;
    },
    refuse(field, why) {
      note(field, why);
      return undefined;
    },
    observed(id, name, fields) {
      const read = Object.fromEntries(
        Object.entries(fields).flatMap(([field, value]): [string, Scalar][] =>
          value === undefined ? [] : [[field, value]],
        ),
      );
      const odd = Object.entries(unreadable).sort(([a], [b]) => compare(a, b));
      return {
        id,
        name,
        fields: read,
        ...(odd.length === 0 ? {} : { unreadable: Object.fromEntries(odd) }),
      };
    },
  };
}
