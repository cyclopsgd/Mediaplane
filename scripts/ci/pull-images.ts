import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalog } from '@mediaplane/catalog';
import { isTransientPullError, nodeExec, type Arch, type Exec } from '@mediaplane/engine';
import { ranAsScript, ROOT } from '../root';
import { catalogImages } from './catalog-images';

/**
 * How long CI waits before each retry of an image pull that failed with a temporary
 * registry error: longer than apply's own (5, 15 and 45 seconds), which stays as it is.
 * CI's runners pull every image afresh, and a temporary registry error failed
 * end-to-end jobs that passed on a rerun (pull requests 17 to 19).
 */
export const PRE_PULL_DELAYS_MS: readonly number[] = [
  15_000, 30_000, 60_000, 120_000, 240_000,
];

/** An image pinned by tag and digest, as every image outside the catalog is written. */
const PINNED = /[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}/g;

/**
 * The files whose pinned images the end-to-end suite runs besides the catalog's: its own
 * test servers, Mediaplane's image's bases, and the socket proxy it deploys.
 */
export function suiteFiles(root = ROOT): string[] {
  const tests = readdirSync(join(root, 'test/e2e'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `test/e2e/${name}`);
  return [...tests.sort(), 'Dockerfile', 'deploy/mediaplane.compose.yaml'];
}

/**
 * Every image the end-to-end suite runs on `arch`, once each, sorted. Plex's is among
 * them on every run: the nightly job's real claim is skipped without a plex.tv token,
 * but plex.e2e.test.ts's first test starts Plex against a fake plex.tv in every run.
 */
export function suiteImages(arch: Arch, root = ROOT): string[] {
  const pinned = suiteFiles(root).flatMap((path) => [
    ...readFileSync(join(root, path), 'utf8').matchAll(PINNED),
  ]);
  return [
    ...new Set([...catalogImages(catalog, arch), ...pinned.map((match) => match[0])]),
  ].sort();
}

/**
 * `docker pull <image>`, tried again after a temporary registry error, as apply decides
 * one (isTransientPullError), with CI's longer waits. Anything else fails at once.
 */
export async function pullWithRetries(
  image: string,
  exec: Exec = nodeExec,
  sleep: (ms: number) => Promise<unknown> = delay,
): Promise<{ ok: true; retries: number } | { ok: false; error: string }> {
  for (let retries = 0; ; retries++) {
    const pulled = await exec('docker', ['pull', '--quiet', image], {
      cwd: '/',
      timeoutMs: 1_800_000,
    });
    if (pulled.code === 0) return { ok: true, retries };
    const error = pulled.stderr.trim();
    const wait = PRE_PULL_DELAYS_MS[retries];
    if (!isTransientPullError(error) || wait === undefined) return { ok: false, error };
    await sleep(wait);
  }
}

async function main(arch: string | undefined): Promise<number> {
  if (arch !== 'amd64' && arch !== 'arm64') {
    console.error('usage: pull-images.ts <amd64|arm64>');
    return 1;
  }
  for (const image of suiteImages(arch)) {
    const pulled = await pullWithRetries(image);
    if (!pulled.ok) {
      console.error(`error: could not pull ${image}: ${pulled.error}`);
      return 1;
    }
    console.log(
      `pulled ${image}${pulled.retries === 0 ? '' : `, after ${String(pulled.retries)} retries`}`,
    );
  }
  return 0;
}

if (ranAsScript(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv[2]);
}
