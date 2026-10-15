import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { emptySecretStore, type SecretStore } from '../secrets/store';
import { SET_UP_CATALOG } from '../testing/bootstrap';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { planBootstrap } from './bootstrap';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

/** The stack, resolved with the fake setup's Jellyfin, in a home of its own. */
async function stackIn(): Promise<ResolvedStack> {
  const home = await tempDir('mediaplane-bootstrap-');
  const resolved = resolveStack(fixtureConfig(STACK), SET_UP_CATALOG, FIXTURE_HOST, home);
  if (resolved.stack === undefined) throw new Error(JSON.stringify(resolved.diagnostics));
  return resolved.stack;
}

/** Jellyfin's setup.txt, saying `text` (a folder, for undefined: it can't be read). */
async function setupFile(stack: ResolvedStack, text: string | undefined): Promise<void> {
  const folder = join(stack.home, 'appdata', 'jellyfin');
  await mkdir(folder, { recursive: true });
  if (text === undefined) await mkdir(join(folder, 'setup.txt'));
  else await writeFile(join(folder, 'setup.txt'), text);
}

const KEYED: SecretStore = { version: 1, apps: { jellyfin: { apiKey: '9'.repeat(32) } } };

describe('planBootstrap', () => {
  it('sets up, unpublished, an app with no key and no sign that its setup is done', async () => {
    const stack = await stackIn();
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
    // Its file says the setup is still open.
    await setupFile(stack, 'open\n');
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
  });

  it('only makes the key, published, when the setup is done but no key is stored', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: false },
    ]);
  });

  it('sets up again, unpublished, an app whose appdata lost its setup, though its key is stored', async () => {
    const stack = await stackIn();
    expect(await planBootstrap(stack, KEYED)).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
  });

  it('has nothing to do with the key stored and the setup done', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(await planBootstrap(stack, KEYED)).toEqual([]);
  });

  it('lets the stored key decide when it cannot read the file', async () => {
    const stack = await stackIn();
    await setupFile(stack, undefined);
    expect(await planBootstrap(stack, KEYED)).toEqual([]);
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
  });

  it('has nothing to set up in a stack whose apps have no setup', async () => {
    const resolved = resolveStack(
      fixtureConfig(STACK),
      fixtureCatalog,
      FIXTURE_HOST,
      await tempDir('mediaplane-bootstrap-'),
    );
    if (resolved.stack === undefined) throw new Error('the stack must resolve');
    expect(await planBootstrap(resolved.stack, emptySecretStore())).toEqual([]);
  });
});
