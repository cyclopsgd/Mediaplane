import { constants, type Stats } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  isMap,
  isScalar,
  parseAllDocuments,
  parseDocument,
  stringify,
  type Pair,
} from 'yaml';
import type { Scalar } from '../integrations/types';
import { codeOf } from '../util/error-code';
import { parseConfig } from './load';

/**
 * What no value Keep mine writes may hold: a C0 or C1 control character (a tab and a line
 * end too), a line or paragraph separator (U+2028, U+2029), or a bidirectional control
 * (U+202A to U+202E, U+2066 to U+2069). YAML reads them, but an editor can show the file
 * as holding what it doesn't: a line that isn't one, or text in another order.
 */
// eslint-disable-next-line no-control-regex -- the characters it looks for
const MISLEADING = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** Why `value` can't be written into stack.yaml as an app holds it, or undefined. */
export function valueProblem(value: Scalar): string | undefined {
  return typeof value === 'string' && MISLEADING.test(value)
    ? 'it holds a control character, a line or paragraph separator, or one that turns the direction of text, which could make stack.yaml show what it does not hold'
    : undefined;
}

/** A "," or a bracket: what ends a plain value inside `{ … }`. */
const FLOW_INDICATOR = /[,[\]{}]/;

/**
 * The line an override takes under `overrides:`, as Keep mine writes it and as you can
 * add it yourself: `sonarr.download_client.category: television`. `flow`: for one inside
 * `overrides: { … }`, where a "," or a bracket ends a plain value, such a value is
 * quoted; quoted, the line is right under a block `overrides:` too.
 */
export function overrideLine(key: string, value: Scalar, flow = false): string {
  const text = stringify(value, { lineWidth: 0 }).trimEnd();
  // A value YAML would write on several lines goes as one JSON string, valid YAML too.
  const plain = typeof value === 'string' && !/^["']/.test(text);
  const quoted = text.includes('\n') || (flow && plain && FLOW_INDICATOR.test(text));
  return `${key}: ${quoted ? JSON.stringify(value) : text}`;
}

/** Where a key's value ends in the source: its value's end, or its key's when it has none. */
function valueEnd(pair: Pair): number {
  const { key, value } = pair;
  if ((isScalar(value) || isMap(value)) && value.range) return value.range[1];
  return isScalar(key) ? (key.range?.[1] ?? 0) : 0;
}

/**
 * `source`, a stack.yaml, with the override `key: value` set under `overrides:`, and
 * nothing else of it changed: its comments, key order, quoting, spacing and line ends
 * stay as they are (spec §3.3, §6.3). The line goes after the last override, in their
 * indentation; one that sets `key` already has its value replaced; `overrides:` is added
 * at the end when the file has none. The result is checked: it must parse to the same
 * stack with that override, or why not is said and nothing is changed. A value that
 * could make the file show what it doesn't hold (valueProblem) is refused.
 */
export function withOverride(
  source: string,
  key: string,
  value: Scalar,
): { ok: true; text: string } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
  const odd = valueProblem(value);
  if (odd !== undefined) return refuse(`its value ${odd}`);
  const before = parseConfig(source);
  if (!before.ok) return refuse('it is not a valid stack.yaml');
  if (parseAllDocuments(source).length !== 1) {
    return refuse('it holds more than one YAML document');
  }
  const doc = parseDocument(source);
  const root = doc.contents;
  if (!isMap(root) || root.flow === true) {
    return refuse('its top level is not a YAML block of keys, one per line');
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const line = overrideLine(key, value);
  const flowLine = overrideLine(key, value, true);
  /** Where the line that holds `offset` ends, before its line end. */
  const lineEnd = (offset: number) => {
    const at = source.indexOf('\n', offset);
    if (at < 0) return source.length;
    return source[at - 1] === '\r' ? at - 1 : at;
  };
  const insert = (at: number, text: string) =>
    `${source.slice(0, at)}${text}${source.slice(at)}`;
  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'overrides');
  let text: string;
  if (pair === undefined) {
    const ended = source === '' || source.endsWith('\n') ? source : `${source}${eol}`;
    text = `${ended}overrides:${eol}  ${line}${eol}`;
  } else if (isMap(pair.value)) {
    const map = pair.value;
    const held = map.items.find((p) => isScalar(p.key) && p.key.value === key);
    if (held !== undefined) {
      // Kept before: its value is replaced, where it is.
      if (!isScalar(held.value)) {
        return refuse(`its ${key} under overrides: is not a single value`);
      }
      const [start, end] = held.value.range;
      const valueText = (map.flow === true ? flowLine : line).slice(key.length + 2);
      text = `${source.slice(0, start)}${valueText}${source.slice(end)}`;
    } else if (map.flow === true) {
      // `overrides: { … }`: after the last one, or in place of `{}`.
      const last = map.items.at(-1);
      if (last === undefined) {
        const [start, end] = map.range;
        text = `${source.slice(0, start)}{ ${flowLine} }${source.slice(source.lastIndexOf('}', end) + 1)}`;
      } else {
        text = insert(valueEnd(last), `, ${flowLine}`);
      }
    } else {
      // A line of its own, after the last override's, as they are indented.
      const [first] = map.items;
      const last = map.items.at(-1);
      if (first === undefined || last === undefined || !isScalar(first.key)) {
        return refuse('its overrides: is not a list of keys');
      }
      const [firstStart] = first.key.range;
      const indent = firstStart - (source.lastIndexOf('\n', firstStart - 1) + 1);
      // From the value's last character: a block value ends after its line end.
      text = insert(lineEnd(valueEnd(last) - 1), `${eol}${' '.repeat(indent)}${line}`);
    }
  } else {
    return refuse('its overrides: is not a list of keys');
  }
  // The stack it gives must be the same, with the override.
  const after = parseConfig(text);
  const wanted = {
    ...before.config,
    overrides: { ...before.config.overrides, [key]: value },
  };
  if (!after.ok || JSON.stringify(after.config) !== JSON.stringify(wanted)) {
    return refuse("Mediaplane can't add the line there without changing more than it");
  }
  return { ok: true, text };
}

/** The groups this user is in: its own, and the others. */
function userGroups(): number[] {
  const own = process.getgid?.();
  return [...(own === undefined ? [] : [own]), ...(process.getgroups?.() ?? [])];
}

/** A stack.yaml as Keep mine read it to rewrite it: its text, and what of it to keep. */
export interface StackFile {
  text: string;
  /** Its permissions and its group: the new file gets both. */
  mode: number;
  gid: number;
  /** Which file it is: the one replaced must still be it (writeFileAtomic's `replaces`). */
  dev: number;
  ino: number;
}

const LINK =
  'it is a link, which Mediaplane would replace with a file, rather than change the file it leads to';

/**
 * `path`, a stack.yaml, read to be rewritten: opened once, without following a link, and
 * checked and read through that one handle, so the file checked is the file read. Or why
 * it can't be written safely: a link (Mediaplane would replace the link, not the file it
 * leads to), not a regular file, a file with other names (hard links, which a rewrite
 * would part from it), one that belongs to another user (a rewrite would take it over),
 * or one of a group this user isn't in (the rewrite couldn't keep it). Its mode and group
 * are kept; an ACL isn't.
 */
export async function readStackFile(
  path: string,
  uid: number | undefined = process.getuid?.(),
  groups: readonly number[] = userGroups(),
): Promise<{ ok: true; file: StackFile } | { ok: false; reason: string }> {
  let handle;
  try {
    // Without waiting: a named pipe in its place is refused, never waited on.
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (cause) {
    if (codeOf(cause) === 'ELOOP') return { ok: false, reason: LINK };
    throw cause;
  }
  try {
    const stats = await handle.stat();
    const reason = fileProblem(stats, uid, groups);
    if (reason !== undefined) return { ok: false, reason };
    const text = await handle.readFile('utf8');
    const { mode, gid, dev, ino } = stats;
    return { ok: true, file: { text, mode: mode & 0o777, gid, dev, ino } };
  } finally {
    await handle.close();
  }
}

/** Why the file `stats` describes can't be rewritten safely, or undefined (readStackFile). */
function fileProblem(
  stats: Stats,
  uid: number | undefined,
  groups: readonly number[],
): string | undefined {
  if (!stats.isFile()) return 'it is not a regular file';
  if (stats.nlink > 1) {
    return 'it has other names (hard links), which a rewrite would part from it';
  }
  if (uid !== undefined && stats.uid !== uid) {
    return `it belongs to uid ${String(stats.uid)}, and Mediaplane runs as uid ${String(uid)}: a rewrite would make it Mediaplane's`;
  }
  if (groups.length > 0 && !groups.includes(stats.gid)) {
    return `it belongs to group ${String(stats.gid)}, which Mediaplane's user isn't in: a rewrite would give it Mediaplane's group`;
  }
  return undefined;
}
