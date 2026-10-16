/**
 * Replace every secret value in `text` with "***". Longest first, so a value that contains
 * another is replaced whole; plain-string matching, so regex characters in a value are safe.
 */
export function redact(text: string, values: Readonly<Record<string, string>>): string {
  return Object.values(values)
    .filter((value) => value !== '')
    .sort((a, b) => b.length - a.length)
    .reduce((redacted, value) => redacted.replaceAll(value, '***'), text);
}

/**
 * The secrets a run comes to read in the apps' answers, which it didn't know of when it
 * started: Seerr's own Jellyfin key, say. A client that reads one adds it
 * (AppApi.addSecret), and from then on the run redacts it as it does the secrets it
 * started with: in the clients' messages, plan's diagnostics, and the bootstrap and wire
 * steps' failures, which go into the change record.
 */
export interface FoundSecrets {
  /** Redact `value` from now on; an empty one is ignored. */
  add(value: string): void;
  /** What was added so far, each once. */
  readonly values: readonly string[];
}

/** A new FoundSecrets, with nothing in it: one per plan, and one per apply. */
export function foundSecrets(): FoundSecrets {
  const values: string[] = [];
  return {
    add(value) {
      if (value !== '' && !values.includes(value)) values.push(value);
    },
    values,
  };
}
