import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeResources, type KnownResources } from '../integrations/resources';
import { SECRETS_PATH } from '../paths';
import type { Runtime } from '../runtime/types';
import { fakeRuntime, running } from './fakes';
import { tempDir } from './temp';

/**
 * A Mediaplane home of a stack wired to the fakes (fakeSonarr), for drift's and keep's
 * tests: `stack` as its stack.yaml, Sonarr's `key` and the shared admin's `password` in
 * its secrets store, and `known` as what Mediaplane last applied, in
 * state/resources.json.
 */
export async function wiredHome(options: {
  prefix: string;
  stack: string;
  key: string;
  password: string;
  known: KnownResources;
}): Promise<string> {
  const dir = await tempDir(options.prefix);
  await writeFile(join(dir, 'stack.yaml'), options.stack);
  await mkdir(join(dir, 'state'));
  await writeFile(
    join(dir, SECRETS_PATH),
    JSON.stringify({
      version: 1,
      apps: { sonarr: { apiKey: options.key } },
      shared: { adminPassword: options.password },
    }),
  );
  await writeResources(dir, options.known);
  return dir;
}

/**
 * The containers of a stack of Jellyfin, qBittorrent and Sonarr, running and healthy, at
 * `addresses` on the wiring network: what wiredHome's stack runs.
 */
export function wiredRuntime(addresses: Record<string, string>): Runtime {
  return fakeRuntime({
    hashes: { ok: true, hashes: {} },
    containers: running({
      jellyfin: 'a'.repeat(64),
      qbittorrent: 'c'.repeat(64),
      sonarr: 'b'.repeat(64),
    }),
    addresses,
  });
}
