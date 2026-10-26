import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { emptySecretStore, type SecretStore } from '../secrets/store';
import { FAKE_SETUP, SET_UP_CATALOG, SIGN_IN_CATALOG } from '../testing/bootstrap';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { REBUILD_RUNBOOK } from '../secrets/recover';
import {
  inspectBootstrap,
  planBootstrap,
  setupsToMakeKeys,
  withoutSignInsToCome,
} from './bootstrap';

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
  async function signInStack(
    file: { text: string } | 'absent' | 'unreadable',
    store: SecretStore = KEYED,
  ) {
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
    const found = await inspectBootstrap(resolved.stack, store);
    return { ...found, home };
  }

  /** Jellyfin's key, and Mediaplane's record that it set Sonarr up, or checked it. */
  const RECORDED: SecretStore = { ...KEYED, setUp: ['sonarr'] };

  it('sets it up, unpublished, until its file says it is done and Mediaplane knows the setup is its own', async () => {
    expect((await signInStack('absent', RECORDED)).changes).toEqual([
      { app: 'sonarr', unpublished: true },
    ]);
    expect((await signInStack({ text: 'no\n' }, RECORDED)).changes).toEqual([
      { app: 'sonarr', unpublished: true },
    ]);
    const known = await signInStack({ text: 'yes\n' }, RECORDED);
    expect({ changes: known.changes, diagnostics: known.diagnostics }).toEqual({
      changes: [],
      diagnostics: [],
    });
  });

  it("sets it up again, unpublished, when its file says it is done but nothing says the setup is Mediaplane's", async () => {
    // Someone else's, or from before Mediaplane recorded it: the setup then checks it.
    expect((await signInStack({ text: 'yes\n' })).changes).toEqual([
      { app: 'sonarr', unpublished: true },
    ]);
    // A record of another app says nothing of this one.
    expect(
      (await signInStack({ text: 'yes\n' }, { ...KEYED, setUp: ['radarr'] })).changes,
    ).toEqual([{ app: 'sonarr', unpublished: true }]);
  });

  it('reads the record and writes nothing', async () => {
    const found = await signInStack({ text: 'yes\n' }, RECORDED);
    expect(found.changes).toEqual([]);
    expect(await readdir(found.home)).toEqual(['appdata']);
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

describe('setupsToMakeKeys', () => {
  it('sets up again, published, an app that refuses the key its setup made, once its setup is done', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(await setupsToMakeKeys(stack, ['jellyfin'], [])).toEqual([
      { app: 'jellyfin', unpublished: false },
    ]);
    // Not one that takes its key, nor one the plan sets up already.
    expect(await setupsToMakeKeys(stack, [], [])).toEqual([]);
    expect(
      await setupsToMakeKeys(
        stack,
        ['jellyfin'],
        [{ app: 'jellyfin', unpublished: true }],
      ),
    ).toEqual([]);
  });

  it("leaves one whose setup isn't shown to be done, and one whose setup makes no key", async () => {
    const stack = await stackIn();
    await setupFile(stack, 'open\n');
    expect(await setupsToMakeKeys(stack, ['jellyfin'], [])).toEqual([]);
    await rm(join(stack.home, 'appdata', 'jellyfin', 'setup.txt'));
    // It can't be read: whether the setup is open can't be told.
    await setupFile(stack, undefined);
    expect(await setupsToMakeKeys(stack, ['jellyfin'], [])).toEqual([]);
    const resolved = resolveStack(
      fixtureConfig(STACK),
      SIGN_IN_CATALOG,
      FIXTURE_HOST,
      stack.home,
    );
    if (resolved.stack === undefined) throw new Error('the stack did not resolve');
    await mkdir(join(stack.home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(stack.home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    expect(await setupsToMakeKeys(resolved.stack, ['sonarr'], [])).toEqual([]);
  });

  it("leaves one whose setup makes a secret that isn't its API's key", async () => {
    // Its key is still good: what the setup made is something else, which no refusal of
    // the key says is gone.
    const catalog = SET_UP_CATALOG.map((def) =>
      def.id === 'jellyfin'
        ? {
            ...def,
            secrets: { ...def.secrets, token: { createdBy: 'app' as const } },
            bootstrap: { ...FAKE_SETUP, secret: 'token' },
          }
        : def,
    );
    const home = await tempDir('mediaplane-bootstrap-');
    const resolved = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, home);
    if (resolved.stack === undefined) throw new Error('the stack did not resolve');
    await setupFile(resolved.stack, 'done\n');
    expect(await setupsToMakeKeys(resolved.stack, ['jellyfin'], [])).toEqual([]);
  });
});

describe('inspectBootstrap: with an admin password the app has never had', () => {
  const HELD = {
    severity: 'warning',
    code: 'bootstrap.needs-password',
    message:
      "jellyfin takes no key Mediaplane holds, and only its first-run setup can find one, by signing in as the shared admin; but jellyfin has never had the admin password Mediaplane gives the apps, so apply doesn't sign in to it, and leaves it unwired",
    hint: `set admin.password to a file holding the password jellyfin's admin has, or make an API key named Mediaplane in jellyfin, then run apply again; see ${REBUILD_RUNBOOK}`,
  };

  it('holds back, with a warning, a setup that would only sign in with one to generate', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(
      await inspectBootstrap(stack, emptySecretStore(), { toGenerate: 'generate' }),
    ).toEqual({
      changes: [],
      held: [{ app: 'jellyfin', unpublished: false }],
      diagnostics: [HELD],
    });
  });

  it('holds back one listed as never having had the stored password, on every run', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(
      await inspectBootstrap(stack, emptySecretStore(), { notIn: ['jellyfin'] }),
    ).toEqual({
      changes: [],
      held: [{ app: 'jellyfin', unpublished: false }],
      diagnostics: [HELD],
    });
    // Rotating doesn't change that: it has had neither.
    expect(
      await inspectBootstrap(stack, emptySecretStore(), {
        toGenerate: 'rotate',
        notIn: ['jellyfin'],
      }),
    ).toEqual({
      changes: [],
      held: [{ app: 'jellyfin', unpublished: false }],
      diagnostics: [HELD],
    });
  });

  it('refuses to rotate while one that has the password can only be signed in to', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    const rotated = await inspectBootstrap(stack, emptySecretStore(), {
      toGenerate: 'rotate',
    });
    expect(rotated.changes).toEqual([]);
    expect(rotated.held).toEqual([{ app: 'jellyfin', unpublished: false }]);
    expect(rotated.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'bootstrap.needs-password',
        message:
          'jellyfin takes no key Mediaplane holds, and only its first-run setup can find one, by signing in as the shared admin with the admin password it has: rotating that password now would leave jellyfin with one Mediaplane no longer holds',
        hint: `run apply without --rotate first, which finds jellyfin's key, then rotate it; see ${REBUILD_RUNBOOK}`,
      },
    ]);
  });

  it("holds back one whose setup file it can't read: its wizard may be done", async () => {
    const stack = await stackIn();
    await setupFile(stack, undefined);
    const held = await inspectBootstrap(stack, emptySecretStore(), {
      toGenerate: 'generate',
    });
    expect(held.changes).toEqual([]);
    expect(held.held).toEqual([{ app: 'jellyfin', unpublished: true }]);
    expect(held.diagnostics.map((d) => d.code)).toEqual(['bootstrap.needs-password']);
  });

  it('still sets up, unpublished, an app whose wizard is open, which makes the admin', async () => {
    const stack = await stackIn();
    expect(
      await inspectBootstrap(stack, emptySecretStore(), {
        toGenerate: 'generate',
        notIn: ['jellyfin'],
      }),
    ).toEqual({
      changes: [{ app: 'jellyfin', unpublished: true }],
      held: [],
      diagnostics: [],
    });
    await setupFile(stack, 'done\n');
    // Its key stored, it has nothing to set up, nor to hold back.
    expect(await inspectBootstrap(stack, KEYED, { toGenerate: 'generate' })).toEqual({
      changes: [],
      held: [],
      diagnostics: [],
    });
  });

  it('holds back an app another diagnostic explains already, saying nothing more', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(
      await inspectBootstrap(stack, emptySecretStore(), {
        toGenerate: 'generate',
        explained: ['jellyfin'],
      }),
    ).toEqual({
      changes: [],
      held: [{ app: 'jellyfin', unpublished: false }],
      diagnostics: [],
    });
  });
});

describe('withoutSignInsToCome', () => {
  it("holds back setupsToMakeKeys' setups, which only sign in, only with a password the app lacks", async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    const remade = await setupsToMakeKeys(stack, ['jellyfin'], []);
    expect(await withoutSignInsToCome(stack, remade, {})).toEqual({
      changes: remade,
      held: [],
      diagnostics: [],
    });
    expect(await withoutSignInsToCome(stack, remade, { toGenerate: 'rotate' })).toEqual({
      changes: [],
      held: [{ app: 'jellyfin', unpublished: false }],
      diagnostics: [expect.objectContaining({ severity: 'error' })],
    });
    expect(await withoutSignInsToCome(stack, remade, { notIn: ['jellyfin'] })).toEqual({
      changes: [],
      held: [{ app: 'jellyfin', unpublished: false }],
      diagnostics: [expect.objectContaining({ severity: 'warning' })],
    });
  });

  it('says to keep a key named Mediaplane when the app refuses the one Mediaplane holds', async () => {
    // A new key in the app isn't recovered while the store holds one: keep reads it.
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    const remade = await setupsToMakeKeys(stack, ['jellyfin'], []);
    const held = await withoutSignInsToCome(stack, remade, { notIn: ['jellyfin'] }, [
      'jellyfin',
    ]);
    expect(held.diagnostics.map((d) => d.hint)).toEqual([
      `set admin.password to a file holding the password jellyfin's admin has; or make an API key named Mediaplane in jellyfin, then run "mediaplane keep jellyfin.apiKey", which keeps it; then run apply again. See ${REBUILD_RUNBOOK}`,
    ]);
  });
});

describe('inspectBootstrap: a setup that signs in through one held', () => {
  it('holds it too, as it starts, saying it waits on the held app', async () => {
    const home = await tempDir('mediaplane-bootstrap-');
    const resolved = resolveStack(
      fixtureConfig(STACK),
      SIGN_IN_CATALOG,
      FIXTURE_HOST,
      home,
    );
    if (resolved.stack === undefined) throw new Error('the stack did not resolve');
    const stack = resolved.stack;
    await setupFile(stack, 'done\n');
    // Sonarr's sign-in setup is open: it would sign in through Jellyfin.
    const held = await inspectBootstrap(stack, emptySecretStore(), {
      toGenerate: 'generate',
    });
    expect(held.changes).toEqual([]);
    expect(held.held).toEqual([
      { app: 'jellyfin', unpublished: false },
      { app: 'sonarr', unpublished: true },
    ]);
    expect(held.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([
      [
        'warning',
        'bootstrap.needs-password',
        expect.stringContaining('jellyfin has never had the admin password') as string,
      ],
      [
        'warning',
        'bootstrap.needs-password',
        "sonarr's first-run setup signs in through jellyfin, whose own is held: it is held too, and waits on jellyfin's admin password",
      ],
    ]);
    // Without Jellyfin held, it is set up as before.
    expect((await inspectBootstrap(stack, KEYED)).changes).toEqual([
      { app: 'sonarr', unpublished: true },
    ]);
  });

  it('sets up one whose own appdata says its setup is done: it signs in through nothing', async () => {
    const stack = await signInStack();
    await setupFile(stack, 'done\n');
    await signedIn(stack, 'yes\n');
    const held = await inspectBootstrap(stack, emptySecretStore(), {
      toGenerate: 'generate',
    });
    // Its record went with the store: checked again, unpublished, with its own key.
    expect(held.changes).toEqual([{ app: 'sonarr', unpublished: true }]);
    expect(held.held).toEqual([{ app: 'jellyfin', unpublished: false }]);
    expect(held.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('jellyfin has never had the admin password') as string,
    ]);
    // One whose file can't be read may still be open: held.
    await rm(join(stack.home, 'appdata', 'sonarr', 'signed-in.txt'));
    await mkdir(join(stack.home, 'appdata', 'sonarr', 'signed-in.txt'));
    const unknown = await inspectBootstrap(stack, emptySecretStore(), {
      toGenerate: 'generate',
    });
    expect(unknown.held.map((h) => h.app)).toEqual(['jellyfin', 'sonarr']);
  });

  it("holds an open one that would sign in through an app that won't have the password yet, though that app isn't held", async () => {
    const stack = await signInStack();
    await setupFile(stack, 'done\n');
    // Jellyfin's key is stored, so nothing in it is set up, but until the wire step sets
    // the password in it through its key, it hasn't the one Sonarr would sign in with.
    for (const toCome of [
      { notIn: ['jellyfin'] },
      { toGenerate: 'generate' as const },
      { toGenerate: 'rotate' as const },
    ]) {
      expect(await inspectBootstrap(stack, KEYED, toCome)).toEqual({
        changes: [],
        held: [{ app: 'sonarr', unpublished: true }],
        diagnostics: [
          {
            severity: 'warning',
            code: 'bootstrap.needs-password',
            message:
              "sonarr's first-run setup signs in through jellyfin, which doesn't have the admin password Mediaplane gives the apps yet: it is held, and waits until apply has set it in jellyfin through jellyfin's key",
            hint: `once jellyfin has it, the next apply sets sonarr up; see ${REBUILD_RUNBOOK}`,
          },
        ],
      });
    }
    // Jellyfin's wizard open: its setup makes the admin with the password first.
    await rm(join(stack.home, 'appdata', 'jellyfin', 'setup.txt'));
    expect(
      await inspectBootstrap(stack, emptySecretStore(), { toGenerate: 'generate' }),
    ).toEqual({
      changes: [
        { app: 'jellyfin', unpublished: true },
        { app: 'sonarr', unpublished: true },
      ],
      held: [],
      diagnostics: [],
    });
  });
});

/** The stack, resolved with Jellyfin's fake setup and Sonarr's sign-in setup after it. */
async function signInStack(): Promise<ResolvedStack> {
  const home = await tempDir('mediaplane-bootstrap-');
  const resolved = resolveStack(
    fixtureConfig(STACK),
    SIGN_IN_CATALOG,
    FIXTURE_HOST,
    home,
  );
  if (resolved.stack === undefined) throw new Error('the stack did not resolve');
  return resolved.stack;
}

/** Sonarr's signed-in.txt, saying `text`. */
async function signedIn(stack: ResolvedStack, text: string): Promise<void> {
  const folder = join(stack.home, 'appdata', 'sonarr');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'signed-in.txt'), text);
}
