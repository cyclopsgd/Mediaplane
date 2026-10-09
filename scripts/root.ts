import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The repository root, with a trailing slash. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Whether the module at `metaUrl` is the script Node was started with (`entry`, which is
 * process.argv[1]). Node resolves symlinks in import.meta.url but not in argv[1], so the
 * two are compared as real paths: a symlinked checkout must still run the script.
 */
export function ranAsScript(metaUrl: string, entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return fileURLToPath(metaUrl) === realpathSync(entry);
  } catch {
    return false; // The entry is no file (node -e, a REPL), so nothing ran this as a script.
  }
}
