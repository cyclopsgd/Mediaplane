import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ranAsScript, ROOT } from '../root';

/**
 * Node itself is a binary in the image's base, not an Alpine package, so neither Trivy
 * nor pnpm audit sees its vulnerabilities (spec §11, Slice 2c). This check does: it fails
 * while Node has published a security release of the image's line that the image lacks.
 */

/** One release in Node's index (https://nodejs.org/dist/index.json): what this reads. */
export interface NodeRelease {
  version: string;
  security: boolean;
}

export const NODE_INDEX = 'https://nodejs.org/dist/index.json';

/** The Node version of the Dockerfile's node:<version>-… bases, which must all agree. */
export function imageNode(dockerfile: string): string {
  const versions = new Set(
    [...dockerfile.matchAll(/^FROM (?:--platform=\S+ )?node:(\d+\.\d+\.\d+)-/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
  if (versions.size === 0) throw new Error('the Dockerfile has no node:<version> base');
  if (versions.size > 1) {
    throw new Error(
      `the Dockerfile builds on more than one Node: ${[...versions].sort().join(', ')}`,
    );
  }
  return [...versions][0] ?? '';
}

const parts = (version: string): number[] =>
  version.replace(/^v/, '').split('.').map(Number);

const newer = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};

/**
 * The security releases of `current`'s major line newer than `current`, oldest first.
 * An index that lists nothing of that line is refused: it can't show the image current.
 */
export function missedSecurityReleases(
  current: string,
  index: readonly NodeRelease[],
): string[] {
  const mine = parts(current);
  const line = index.filter((release) => parts(release.version)[0] === mine[0]);
  if (line.length === 0) {
    throw new Error(`Node's release index lists no ${String(mine[0])}.x release`);
  }
  return line
    .filter((release) => release.security && newer(parts(release.version), mine))
    .map((release) => release.version.replace(/^v/, ''))
    .sort((a, b) => (newer(parts(a), parts(b)) ? 1 : -1));
}

/** Node's index, tried three times, 5 and 15 seconds apart, 30 seconds each. */
async function fetchIndex(): Promise<NodeRelease[]> {
  let last: unknown;
  for (const wait of [0, 5_000, 15_000]) {
    await sleep(wait);
    try {
      const response = await fetch(NODE_INDEX, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return (await response.json()) as NodeRelease[];
    } catch (cause) {
      last = cause;
    }
  }
  throw new Error(
    `couldn't read ${NODE_INDEX}: ${last instanceof Error ? last.message : String(last)}`,
  );
}

async function main(): Promise<number> {
  const current = imageNode(await readFile(join(ROOT, 'Dockerfile'), 'utf8'));
  const missed = missedSecurityReleases(current, await fetchIndex());
  if (missed.length === 0) {
    console.log(`The image's Node, ${current}, has every security release of its line.`);
    return 0;
  }
  console.error(
    `The image's Node is ${current}, but Node has published security releases since: ${missed.join(', ')}. Bump the node pin in the Dockerfile (Renovate opens that pull request).`,
  );
  return 1;
}

if (ranAsScript(import.meta.url, process.argv[1])) {
  try {
    process.exitCode = await main();
  } catch (cause) {
    console.error(`error: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
