/**
 * Where the runbooks are published. A hint gives this address, not a path in the repo:
 * someone running Mediaplane's image has no copy of the repo.
 */
export const RUNBOOKS_URL =
  'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks';

/** The runbooks (docs/runbooks/<name>.md). */
export type Runbook = 'app-wont-start' | 'vpn-down' | 'wiring-failed';

/** A runbook's address on GitHub. */
export function runbookUrl(name: Runbook): string {
  return `${RUNBOOKS_URL}/${name}.md`;
}
