import { lstat } from 'node:fs/promises';
import {
  isMap,
  isScalar,
  parseAllDocuments,
  parseDocument,
  stringify,
  type Pair,
} from 'yaml';
import type { Scalar } from '../integrations/types';
import { parseConfig } from './load';

/**
 * The line an override takes under `overrides:`, as Keep mine writes it and as you can
 * add it yourself: `sonarr.download_client.category: television`.
 */
export function overrideLine(key: string, value: Scalar): string {
  const text = stringify(value, { lineWidth: 0 }).trimEnd();
  // A value YAML would write on several lines goes as one JSON string, valid YAML too.
  return `${key}: ${text.includes('\n') ? JSON.stringify(value) : text}`;
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
 * stack with that override, or why not is said and nothing is changed.
 */
export function withOverride(
  source: string,
  key: string,
  value: Scalar,
): { ok: true; text: string } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
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
  const valueText = line.slice(key.length + 2);
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
      text = `${source.slice(0, start)}${valueText}${source.slice(end)}`;
    } else if (map.flow === true) {
      // `overrides: { … }`: after the last one, or in place of `{}`.
      const last = map.items.at(-1);
      if (last === undefined) {
        const [start, end] = map.range;
        text = `${source.slice(0, start)}{ ${line} }${source.slice(source.lastIndexOf('}', end) + 1)}`;
      } else {
        text = insert(valueEnd(last), `, ${line}`);
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

/**
 * Why `path`, a stack.yaml, can't be written safely, or undefined when it can: a link
 * (Mediaplane would replace the link, not the file it leads to), not a regular file,
 * a file with other names (hard links, which a rewrite would part from it), one that
 * belongs to another user (a rewrite would take it over), or one of a group this user
 * isn't in (the rewrite couldn't keep it). Its mode and group are kept; an ACL isn't.
 */
export async function stackFileProblem(
  path: string,
  uid: number | undefined = process.getuid?.(),
  groups: readonly number[] = userGroups(),
): Promise<string | undefined> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    return 'it is a link, which Mediaplane would replace with a file, rather than change the file it leads to';
  }
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
