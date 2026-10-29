import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSecretStore } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  composeDown,
  deployMediaplane,
  expectWiringRemoved,
  makeHome,
  REPO,
  runTeardown,
  stackFor,
  type DeployedMediaplane,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-playbook`;

/**
 * Each documented --json shape, as a script reads it: the published JSON Schema file of
 * this release (docs/reference/json/), not the code it was generated from.
 */
async function publishedSchema(schema: string): Promise<z.ZodType> {
  const name = /^mediaplane\.([a-z-]+)\/v1$/.exec(schema)?.[1];
  if (name === undefined) throw new Error(`not a documented schema: ${schema}`);
  const file = join(REPO, 'docs', 'reference', 'json', `${name}.schema.json`);
  return z.fromJSONSchema(
    JSON.parse(await readFile(file, 'utf8')) as Parameters<typeof z.fromJSONSchema>[0],
  );
}

/** A document a command printed: its schema, `ok`, and the rest, as a script reads it. */
interface Document {
  schema: string;
  ok: boolean;
  [field: string]: unknown;
}

/** What each command's exit code is, by its document (docs/reference/cli.md). */
function documentedExit(command: string, doc: Document): number {
  if (!doc.ok) return 1;
  if (command === 'plan') return doc.changed === true ? 2 : 0;
  if (command === 'drift') return doc.clear === true ? 0 : 2;
  return 0;
}

/** Every secret the stack's state holds once apply has run: no document may hold one. */
let secrets: string[] = [];

/** What commands printed before the secrets were known: checked once they are. */
let early: { what: string; stdout: string }[] = [];

/** That none of `secrets` is in `text`: a yes or no, which never prints either. */
function expectNoSecret(what: string, text: string): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} printed a secret`).toBe(false);
  }
}

/**
 * `mediaplane <command> … --json`, as a playbook runs it: `docker exec` with no terminal,
 * reading only its exit code and the one document it prints, which must be its documented
 * shape, exactly, and hold no secret. Its own text is never shown: it could hold what the
 * command printed of an app.
 */
async function run(
  mediaplane: DeployedMediaplane,
  command: string,
  ...args: string[]
): Promise<{ code: number; doc: Document }> {
  const result = await mediaplane.mediaplane([command, ...args, '--json']);
  let doc: Document;
  try {
    doc = JSON.parse(result.stdout) as Document;
  } catch {
    throw new Error(
      `mediaplane ${command} --json printed no single JSON document (exit ${String(result.code)}, ${String(result.stdout.length)} characters)`,
    );
  }
  const checked = (await publishedSchema(doc.schema)).safeParse(doc);
  expect(
    checked.success
      ? []
      : checked.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    `mediaplane ${command}'s ${doc.schema} against its published JSON Schema`,
  ).toEqual([]);
  expect(result.code, `mediaplane ${command}'s exit code, as documented`).toBe(
    documentedExit(command, doc),
  );
  if (secrets.length === 0)
    early.push({ what: `mediaplane ${command}`, stdout: result.stdout });
  expectNoSecret(`mediaplane ${command}`, result.stdout);
  return { code: result.code, doc };
}

/** The resources a plan or an apply names for an action, sorted. */
const named = (items: unknown, action: string, key = 'action'): string[] =>
  (items as Record<string, unknown>[])
    .filter((item) => item[key] === action)
    .map((item) => String(item.resource ?? item.service))
    .sort();

describe('a playbook, reading only the documented contract (the roadmap: S10c)', () => {
  it('deploys a stack, removes an app from it, and rebuilds the host', async () => {
    const home = await makeHome();
    const data = join(home, 'data');
    await writeFile(join(home, 'stack.yaml'), stackFor(data, { seerr: false }));
    let deployed: DeployedMediaplane | undefined;
    const removeAll = () =>
      runTeardown([
        async () => {
          await deployed?.remove();
        },
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      secrets = [];
      early = [];
      // Deployed as the playbook deploys it: mediaplane.compose.yaml, its image built here.
      deployed = await deployMediaplane({ home, stack: PROJECT });
      const planned = await run(deployed, 'plan');
      expect([planned.code, planned.doc.schema]).toEqual([2, 'mediaplane.plan/v1']);
      const applied = await run(deployed, 'apply', '--yes');
      expect(applied.doc).toMatchObject({ ok: true, changed: true, outcome: 'success' });
      const store = await readSecretStore(home);
      secrets = [
        ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
        store.shared?.adminPassword ?? '',
      ];
      // The first plan and apply came before the secrets were known.
      for (const output of early) expectNoSecret(output.what, output.stdout);
      // A second apply changes nothing (spec §2.3, criterion 3).
      const again = await run(deployed, 'apply', '--yes');
      expect(again.doc).toMatchObject({
        ok: true,
        changed: false,
        outcome: 'no-changes',
      });
      const status = await run(deployed, 'status');
      expect(status.doc).toMatchObject({ ok: true, healthy: true });
      // The login, without its password: that needs --reveal.
      const login = await run(deployed, 'credentials');
      expect(login.doc).toMatchObject({ ok: true, username: 'admin', password: null });
      // A usage error is a document too.
      const wrong = await run(deployed, 'plan', '--no-such-option');
      expect(wrong.doc.schema).toBe('mediaplane.error/v1');

      // Radarr taken out of the stack: its container goes, and what Mediaplane made for
      // it in the other apps; its appdata stays.
      await writeFile(
        join(home, 'stack.yaml'),
        stackFor(data, { seerr: false }).replace('  radarr: {}\n', ''),
      );
      const removal = await run(deployed, 'plan');
      expect(removal.code).toBe(2);
      expect(named(removal.doc.containers, 'remove')).toEqual(['radarr']);
      const toRemove = named(removal.doc.wiring, 'remove');
      expect(toRemove).toEqual([
        'prowlarr.application_radarr',
        'qbittorrent.category_movies',
      ]);
      const removed = await run(deployed, 'apply', '--yes');
      expect(removed.doc).toMatchObject({ ok: true, changed: true, outcome: 'success' });
      expect(named(removed.doc.actions, 'removed', 'detail')).toEqual(toRemove);
      const settled = await run(deployed, 'apply', '--yes');
      expect(settled.doc).toMatchObject({ changed: false, outcome: 'no-changes' });

      // The host is lost: the stack's containers, Mediaplane's deployment, its state/ and
      // generated/. What is left is what a rebuild starts from: stack.yaml, appdata/ and
      // the data folder. The playbook deploys Mediaplane again, and applies.
      await deployed.remove();
      deployed = undefined;
      const down = await composeDown(PROJECT);
      expect(down.code, down.stderr).toBe(0);
      await expectWiringRemoved(PROJECT);
      await rm(join(home, 'state'), { recursive: true });
      await rm(join(home, 'generated'), { recursive: true });
      deployed = await deployMediaplane({ home, stack: PROJECT });
      const rebuild = await run(deployed, 'plan');
      expect(rebuild.code).toBe(2);
      expect(rebuild.doc.secrets).toEqual({
        generate: ['admin.password'],
        recover: [
          'jellyfin.apiKey',
          'prowlarr.apiKey',
          'qbittorrent.apiKey',
          'sonarr.apiKey',
        ],
        restore: [],
      });
      expect(
        (rebuild.doc.diagnostics as { code: string }[]).map((d) => d.code),
      ).toContain('secrets.admin-password-lost');
      const rebuilt = await run(deployed, 'apply', '--yes');
      expect(rebuilt.doc).toMatchObject({ ok: true, changed: true, outcome: 'success' });
      // Every resource found by name, and adopted; the new password set through the keys.
      expect(named(rebuilt.doc.actions, 'created', 'detail')).toEqual([]);
      const after = await readSecretStore(home);
      secrets.push(after.shared?.adminPassword ?? '');
      const last = await run(deployed, 'apply', '--yes');
      expect(last.doc).toMatchObject({ changed: false, outcome: 'no-changes' });
      const drift = await run(deployed, 'drift');
      expect(drift.doc).toMatchObject({ ok: true, clear: true, drift: [] });
      // The rebuilt host's history, and its apply's record in full.
      const history = await run(deployed, 'history');
      const records = history.doc.records as { id: string; outcome: string }[];
      expect(records.map((r) => r.outcome)).toEqual(['success']);
      const record = await run(deployed, 'history', records[0]?.id ?? '');
      expect(record.doc).toMatchObject({
        schema: 'mediaplane.change/v1',
        ok: true,
        id: rebuilt.doc.recordId,
      });
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 2_400_000);
});
