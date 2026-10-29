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

/** Every secret the stack's state holds once apply has run: no output may hold one. */
let secrets: string[] = [];

/**
 * Everything every command printed (standard output and error), because a secret can be
 * known only later: an apply can make one (a new admin password), and it is the likeliest
 * command to print it.
 */
let held: { what: string; text: string }[] = [];

/** That none of `secrets` is in `text`: a yes or no, which never prints either. */
function expectNoSecret(what: string, text: string): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} printed a secret`).toBe(false);
  }
}

/** Everything printed so far, against the secrets known now. */
function expectNoneHeld(): void {
  for (const output of held) expectNoSecret(output.what, output.text);
}

/**
 * That a document's field is `value`: a yes or no. A document is never asserted whole,
 * and nothing it holds can be in a failure message, which ends up in a log.
 */
function expectField(what: string, doc: Document, field: string, value: unknown): void {
  expect(doc[field] === value, `${what}: ${field} is not ${JSON.stringify(value)}`).toBe(
    true,
  );
}

/** How long a script waits for an apply: a first one waits for every app to be healthy. */
const APPLY_MS = 1_200_000;

/**
 * `mediaplane <command> … --json`, as a playbook runs it: `docker exec` with no terminal,
 * reading only its exit code and the one document it prints, which must be the `schema`
 * the command documents, exactly its published shape, and hold no secret. Its own text is
 * never shown: it could hold what the command printed of an app.
 */
async function run(
  mediaplane: DeployedMediaplane,
  schema: string,
  command: string,
  ...args: string[]
): Promise<{ code: number; doc: Document }> {
  const what = `mediaplane ${command}`;
  const result = await mediaplane.mediaplane(
    [command, ...args, '--json'],
    undefined,
    command === 'apply' ? APPLY_MS : undefined,
  );
  const text = `${result.stdout}\n${result.stderr}`;
  held.push({ what, text });
  // Before anything is asserted of the document.
  expectNoSecret(what, text);
  let doc: Document;
  try {
    doc = JSON.parse(result.stdout) as Document;
  } catch {
    throw new Error(
      `${what} --json printed no single JSON document (exit ${String(result.code)}, ${String(result.stdout.length)} characters)`,
    );
  }
  expect(doc.schema === `mediaplane.${schema}/v1`, `${what} printed a ${schema}`).toBe(
    true,
  );
  const checked = (await publishedSchema(doc.schema)).safeParse(doc);
  expect(
    checked.success
      ? []
      : checked.error.issues.map(
          (i) =>
            `${i.path.join('.')}: ${i.code}${i.code === 'unrecognized_keys' ? ` (${i.keys.join(', ')})` : ''}`,
        ),
    `${what}'s ${doc.schema} against its published JSON Schema`,
  ).toEqual([]);
  expect(result.code, `${what}'s exit code, as documented`).toBe(
    documentedExit(command, doc),
  );
  return { code: result.code, doc };
}

/** The resources a plan or an apply names for an action, sorted. */
const named = (items: unknown, action: string, key = 'action'): string[] =>
  (items as Record<string, unknown>[])
    .filter((item) => item[key] === action)
    .map((item) => String(item.resource ?? item.service))
    .sort();

/**
 * What an apply did to the managed resources: its wire actions, by their detail, which
 * for a done one is a word the contract documents as stable (`actions[].detail`).
 */
const wired = (apply: Document, detail: string): string[] =>
  named(
    (apply.actions as { step: string }[]).filter((a) => a.step === 'wire'),
    detail,
    'detail',
  );

/** What an apply's plan, or a plan, says it does to the managed resources. */
const wiring = (doc: Document, action: string): string[] =>
  named(doc.wiring ?? (doc.plan as { wiring: unknown }).wiring, action);

/** The secrets in a store, by name (`app.key`) and by value. */
async function secretsIn(home: string): Promise<{ names: string[]; values: string[] }> {
  const store = await readSecretStore(home);
  const entries = Object.entries(store.apps).flatMap(([app, keys]) =>
    Object.entries(keys).map(([key, value]) => [`${app}.${key}`, value] as const),
  );
  const admin = store.shared?.adminPassword ?? '';
  return {
    names: [
      ...entries.map(([name]) => name),
      ...(admin === '' ? [] : ['admin.password']),
    ].sort(),
    values: [...entries.map(([, value]) => value), admin],
  };
}

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
      held = [];
      // Deployed as the playbook deploys it: mediaplane.compose.yaml, its image built here.
      deployed = await deployMediaplane({ home, stack: PROJECT });
      const planned = await run(deployed, 'plan', 'plan');
      expect(planned.code).toBe(2);
      const applied = await run(deployed, 'apply', 'apply', '--yes');
      // The secrets, and that there are some to look for: an empty list would check nothing.
      const first = await secretsIn(home);
      expect(first.names).toEqual([
        'admin.password',
        'jellyfin.apiKey',
        'prowlarr.apiKey',
        'qbittorrent.apiKey',
        'radarr.apiKey',
        'sonarr.apiKey',
      ]);
      expect(first.values.every((value) => value !== '')).toBe(true);
      secrets = first.values;
      // What the first plan and apply printed came before the secrets were known.
      expectNoneHeld();
      expectField('the first apply', applied.doc, 'ok', true);
      expectField('the first apply', applied.doc, 'changed', true);
      expectField('the first apply', applied.doc, 'outcome', 'success');
      // A second apply changes nothing (spec §2.3, criterion 3).
      const again = await run(deployed, 'apply', 'apply', '--yes');
      expectField('the second apply', again.doc, 'ok', true);
      expectField('the second apply', again.doc, 'changed', false);
      expectField('the second apply', again.doc, 'outcome', 'no-changes');
      const status = await run(deployed, 'status', 'status');
      expectField('status', status.doc, 'healthy', true);
      // The login, without its password: that needs --reveal.
      const login = await run(deployed, 'credentials', 'credentials');
      expectField('credentials', login.doc, 'username', 'admin');
      expectField('credentials', login.doc, 'password', null);
      // A usage error is a document too.
      await run(deployed, 'error', 'plan', '--no-such-option');

      // Radarr taken out of the stack: its container goes, and what Mediaplane made for
      // it in the other apps; its appdata stays.
      await writeFile(
        join(home, 'stack.yaml'),
        stackFor(data, { seerr: false }).replace('  radarr: {}\n', ''),
      );
      const removal = await run(deployed, 'plan', 'plan');
      expect(removal.code).toBe(2);
      expect(named(removal.doc.containers, 'remove')).toEqual(['radarr']);
      const toRemove = wiring(removal.doc, 'remove');
      expect(toRemove).toEqual([
        'prowlarr.application_radarr',
        'qbittorrent.category_movies',
      ]);
      const removed = await run(deployed, 'apply', 'apply', '--yes');
      expectField('the removal', removed.doc, 'changed', true);
      expectField('the removal', removed.doc, 'outcome', 'success');
      expect(wiring(removed.doc, 'remove')).toEqual(toRemove);
      expect(wired(removed.doc, 'removed')).toEqual(toRemove);
      const settled = await run(deployed, 'apply', 'apply', '--yes');
      expectField('the apply after it', settled.doc, 'changed', false);
      expectField('the apply after it', settled.doc, 'outcome', 'no-changes');
      // Confirmed from the contract: no container of Radarr's is left in the stack.
      const left = await run(deployed, 'status', 'status');
      expect(
        (left.doc.containers as { service: string }[]).some(
          (c) => c.service === 'radarr',
        ),
        'status lists a container of the removed app',
      ).toBe(false);

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
      const rebuild = await run(deployed, 'plan', 'plan');
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
      const rebuilt = await run(deployed, 'apply', 'apply', '--yes');
      // The new admin password is a secret now, with the keys recovered.
      const after = await secretsIn(home);
      expect(after.names).toEqual([
        'admin.password',
        'jellyfin.apiKey',
        'prowlarr.apiKey',
        'qbittorrent.apiKey',
        'sonarr.apiKey',
      ]);
      expect(after.values.every((value) => value !== '')).toBe(true);
      expect(
        after.values.filter((value) => !secrets.includes(value)).length,
        'the admin password was made again',
      ).toBe(1);
      secrets = [...new Set([...secrets, ...after.values])];
      expectNoneHeld();
      expectField('the rebuild', rebuilt.doc, 'ok', true);
      expectField('the rebuild', rebuilt.doc, 'changed', true);
      expectField('the rebuild', rebuilt.doc, 'outcome', 'success');
      // Every resource found by name, and adopted: none made again.
      expect(wired(rebuilt.doc, 'created')).toEqual([]);
      expect(wired(rebuilt.doc, 'adopted')).toEqual([
        'jellyfin.library_movies',
        'jellyfin.library_shows',
        'prowlarr.application_sonarr',
        'prowlarr.indexer_proxy',
        'qbittorrent.category_tv',
        'qbittorrent.preferences',
        'sonarr.connection_jellyfin',
        'sonarr.download_client',
        'sonarr.root_folder',
      ]);
      const last = await run(deployed, 'apply', 'apply', '--yes');
      expectField('the last apply', last.doc, 'changed', false);
      expectField('the last apply', last.doc, 'outcome', 'no-changes');
      const drift = await run(deployed, 'drift', 'drift');
      expectField('drift', drift.doc, 'clear', true);
      expect((drift.doc.drift as unknown[]).length, 'drift lists something').toBe(0);
      // The rebuilt host's history, and its apply's record in full.
      const history = await run(deployed, 'history', 'history');
      const records = history.doc.records as { id: string; outcome: string }[];
      expect(records.map((r) => r.outcome)).toEqual(['success']);
      const record = await run(deployed, 'change', 'history', records[0]?.id ?? '');
      expect(
        record.doc.id === rebuilt.doc.recordId,
        "history's record is the apply's",
      ).toBe(true);
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
