import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { emptySecretStore, type SecretStore } from '../secrets/store';
import { FAKE_SETUP, SET_UP_CATALOG, SIGN_IN_CATALOG } from '../testing/bootstrap';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { inspectBootstrap, planBootstrap } from './bootstrap';

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

  it("warns, naming the app and not the file's contents, that it can't tell when a stored key decides", async () => {
    const stack = await stackIn();
    await setupFile(stack, undefined);
    const stored = await inspectBootstrap(stack, KEYED);
    expect(stored.changes).toEqual([]);
    expect(stored.diagnostics).toHaveLength(1);
    expect(stored.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'bootstrap.unreadable',
    });
    expect(stored.diagnostics[0]?.message).toContain('jellyfin');
    expect(stored.diagnostics[0]?.message).not.toContain('setup.txt');
    // With no key stored it starts unpublished anyway, so there is nothing to warn of.
    expect((await inspectBootstrap(stack, emptySecretStore())).diagnostics).toEqual([]);
    // And none when the file reads.
    await rm(join(stack.home, 'appdata', 'jellyfin', 'setup.txt'), { recursive: true });
    await setupFile(stack, 'done\n');
    expect((await inspectBootstrap(stack, KEYED)).diagnostics).toEqual([]);
  });

  it("refuses a setup in another app's network, whose ports that app publishes", async () => {
    const catalog = SET_UP_CATALOG.map((def) =>
      def.id === 'qbittorrent' ? { ...def, bootstrap: FAKE_SETUP } : def,
    );
    const resolved = resolveStack(
      fixtureConfig(`version: 1
paths: { data: /srv/data }
network: { bind: localhost }
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
media_server: jellyfin
apps:
  qbittorrent: {}
`),
      catalog,
      FIXTURE_HOST,
      await tempDir('mediaplane-bootstrap-'),
    );
    if (resolved.stack === undefined)
      throw new Error(JSON.stringify(resolved.diagnostics));
    const found = await inspectBootstrap(resolved.stack, emptySecretStore());
    expect(found.diagnostics).toHaveLength(1);
    expect(found.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'bootstrap.network-via',
    });
    expect(found.diagnostics[0]?.message).toContain("inside gluetun's network");
    // Jellyfin, which runs in its own network, is planned as before.
    expect(found.changes).toEqual([{ app: 'jellyfin', unpublished: true }]);
  });
});

describe('planBootstrap: a setup that makes no key', () => {
  /**
   * What plan finds of the stack, with Sonarr's FAKE_SIGN_IN and its signed-in.txt as
   * `file` says, and Jellyfin's setup done and its key kept.
   */
  async function signInStack(file: { text: string } | 'absent' | 'unreadable') {
    const home = await tempDir('mediaplane-bootstrap-');
    const resolved = resolveStack(
      fixtureConfig(STACK),
      SIGN_IN_CATALOG,
      FIXTURE_HOST,
      home,
    );
    if (resolved.stack === undefined) throw new Error('the stack must resolve');
    await setupFile(resolved.stack, 'done\n');
    const path = join(home, 'appdata', 'sonarr', 'signed-in.txt');
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    if (file === 'unreadable') await mkdir(path);
    else if (file !== 'absent') await writeFile(path, file.text);
    return inspectBootstrap(resolved.stack, KEYED);
  }

  it('sets it up, unpublished, until its file says it is done: there is no key to say so', async () => {
    expect((await signInStack('absent')).changes).toEqual([
      { app: 'sonarr', unpublished: true },
    ]);
    expect((await signInStack({ text: 'no\n' })).changes).toEqual([
      { app: 'sonarr', unpublished: true },
    ]);
    expect(await signInStack({ text: 'yes\n' })).toEqual({
      changes: [],
      diagnostics: [],
    });
  });

  it("sets it up again, unpublished, and warns, when it can't read the file", async () => {
    const found = await signInStack('unreadable');
    expect(found.changes).toEqual([{ app: 'sonarr', unpublished: true }]);
    expect(found.diagnostics).toHaveLength(1);
    expect(found.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'bootstrap.unreadable',
      message:
        "Mediaplane can't read the file in sonarr's appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; sonarr starts unpublished, and is set up again, until it can",
      hint: 'check the permissions of appdata/sonarr',
    });
  });
});
