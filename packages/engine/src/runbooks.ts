/**
 * Where the docs are published. Help and hints give this address, not a path in the
 * repo: someone running Mediaplane's image has no copy of the repo.
 */
export const DOCS_URL = 'https://github.com/cyclopsgd/Mediaplane/blob/main/docs';

/** A page of the docs, by its path in docs/ ("reference/stack-yaml.md"), on GitHub. */
export function docsUrl(path: string): string {
  return `${DOCS_URL}/${path}`;
}

/** Where the runbooks are published. */
export const RUNBOOKS_URL = docsUrl('runbooks');

/** The runbooks (docs/runbooks/<name>.md). */
export type Runbook =
  | 'app-wont-start'
  | 'drift-reported'
  | 'rebuilding-a-host'
  | 'vpn-down'
  | 'wiring-failed';

/** A runbook's address on GitHub. */
export function runbookUrl(name: Runbook): string {
  return `${RUNBOOKS_URL}/${name}.md`;
}
