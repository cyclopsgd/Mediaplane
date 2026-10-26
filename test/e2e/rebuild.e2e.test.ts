import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  drift,
  keep,
  nodeProbe,
  plan,
  readSecretStore,
  type ApplyOptions,
  type ApplyResult,
  type SecretStore,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  makeHome,
  runTeardown,
  wired,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-rebuild`;
/** qBittorrent's web UI, on 127.0.0.1. */
const QBITTORRENT = 8080;
/** Every key Mediaplane holds for the stack's apps, as state/secrets.json names them. */
const KEYS = [
  'jellyfin.apiKey',
  'prowlarr.apiKey',
  'qbittorrent.apiKey',
  'radarr.apiKey',
  'seerr.apiKey',
  'sonarr.apiKey',
];
/** The resources that hold the shared admin's password, set again through each key. */
const ADMINS = [
  'jellyfin.admin',
  'qbittorrent.admin',
  'radarr.admin',
  'sonarr.admin',
  'prowlarr.admin',
];

interface Resources {
  resources: Record<string, { id: string | number | null }>;
}

/** Each resource's id in its app, as state/resources.json keeps it: no secret. */
async function idsIn(home: string): Promise<Record<string, unknown>> {
  const file = await readFile(join(home, 'state', 'resources.json'), 'utf8');
  const { resources } = JSON.parse(file) as Resources;
  return Object.fromEntries(Object.entries(resources).map(([key, r]) => [key, r.id]));
}

/** A key's value, by its "<app>.<name>": a secret, compared, never printed. */
function keyOf(store: SecretStore, key: string): string {
  const [app = '', name = ''] = key.split('.');
  return store.apps[app]?.[name] ?? '';
}

/** Whether qBittorrent takes `key`, as its own API says: yes or no, never the key. */
async function qbittorrentTakes(key: string): Promise<boolean> {
  const answer = await api(QBITTORRENT, '/api/v2/app/version', {
    Authorization: `Bearer ${key}`,
  });
  return answer.status === 200;
}

/**
 * qBittorrent's key made anew in its web UI, as you would: signed in as the shared admin,
 * a session's rotateAPIKey, which writes the new key into qBittorrent.conf at once
 * (probed). Says only whether each step worked.
 */
async function rotateQbittorrentKey(password: string): Promise<void> {
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const origin = { Referer: `http://127.0.0.1:${String(QBITTORRENT)}` };
  const signIn = await fetch(
    `http://127.0.0.1:${String(QBITTORRENT)}/api/v2/auth/login`,
    {
      method: 'POST',
      headers: { ...form, ...origin },
      body: new URLSearchParams({ username: 'admin', password }).toString(),
      signal: AbortSignal.timeout(30_000),
    },
  );
  expect(signIn.status, "the shared admin's sign-in to qBittorrent").toBe(204);
  const session = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const rotated = await api(
    QBITTORRENT,
    '/api/v2/app/rotateAPIKey',
    { ...origin, Cookie: session },
    { method: 'POST' },
  );
  expect(rotated.status, "qBittorrent's rotateAPIKey").toBe(200);
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

/** An apply that found nothing to do; a failure names what changed, never a value. */
function expectNoChanges(result: ApplyResult): void {
  expect(
    result.plan.wiring
      .filter((w) => w.action !== 'unchanged')
      .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
    'wiring changed',
  ).toEqual([]);
  expect(result.outcome).toBe('no-changes');
}

describe('a host rebuilt from stack.yaml and its appdata (spec §6.1, §6.3, §10)', () => {
  it("recovers every key from the apps' appdata, adopts every resource by name, sets a new admin password, and changes nothing after", async () => {
    const home = await makeHome();
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime: createDockerRuntime({ home, project: PROJECT }),
        probe: nodeProbe,
        project: PROJECT,
        confirm: () => Promise.resolve(true),
      };
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      const before = await readSecretStore(home);
      const ids = await idsIn(home);
      const oldPassword = before.shared?.adminPassword ?? '';
      const secrets = [...KEYS.map((key) => keyOf(before, key)), oldPassword];

      // The host is lost: its containers and networks, and Mediaplane's state/ and
      // generated/. What is left is what a rebuild starts from: stack.yaml, appdata/ and
      // the data folder.
      const down = await composeDown(PROJECT);
      expect(down.code, down.stderr).toBe(0);
      await expectWiringRemoved(PROJECT);
      await rm(join(home, 'state'), { recursive: true });
      await rm(join(home, 'generated'), { recursive: true });

      // plan recovers every key from the apps' own files, and generates only the admin
      // password, which went with the store, saying so. Seerr's record that its setup
      // is Mediaplane's went too: it is checked again, unpublished, with its key.
      // Jellyfin's database, closed cleanly, is opened immutable: nothing is made beside it.
      const database = join(home, 'appdata', 'jellyfin', 'data', 'data');
      const besideDatabase = async () =>
        (await readdir(database)).filter((name) => name.startsWith('jellyfin.db')).sort();
      expect(await besideDatabase()).toEqual(['jellyfin.db']);
      const shown = await plan(options);
      expect(await besideDatabase()).toEqual(['jellyfin.db']);
      expect(shown.ok).toBe(true);
      expect(shown.secrets).toEqual({
        generate: ['admin.password'],
        recover: KEYS,
        restore: [],
      });
      expect(shown.diagnostics.map((d) => d.code)).toContain(
        'secrets.admin-password-lost',
      );
      expect(shown.bootstrap).toEqual([{ app: 'seerr', unpublished: true }]);
      // Jellyfin's key is recovered, so nothing waits on its admin password: Seerr's setup,
      // done, signs in through nothing.
      expect(shown.diagnostics.map((d) => d.code)).not.toContain(
        'bootstrap.needs-password',
      );

      const rebuilt = await apply(options);
      expect(rebuilt.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(rebuilt.outcome).toBe('success');
      expect(rebuilt.actions[0]?.detail).toBe(
        `recovered ${KEYS.join(', ')} from appdata; generated admin.password`,
      );
      // Each admin gets the new password through its app's key; everything else Mediaplane
      // made is found by name, and adopted as it is.
      expect(wired(rebuilt.actions).filter(([, detail]) => detail !== 'adopted')).toEqual(
        ADMINS.map((resource) => [resource, 'updated password']),
      );
      const after = await readSecretStore(home);
      // Each app has the new password now: none is left listed as lacking it.
      expect(after.shared?.adminPasswordNotIn).toBeUndefined();
      for (const key of KEYS) {
        expect(keyOf(after, key) === keyOf(before, key), `${key} is the one before`).toBe(
          true,
        );
      }
      const newPassword = after.shared?.adminPassword ?? '';
      expect(newPassword !== '' && newPassword !== oldPassword, 'a new password').toBe(
        true,
      );
      secrets.push(newPassword);
      // The same resources, by the same ids in the apps: none made again.
      expect(await idsIn(home)).toEqual(ids);
      expect(after.setUp).toEqual(['seerr']);
      expectNoSecret("the rebuild's result", JSON.stringify(rebuilt), secrets);
      expectNoSecret(
        'resources.json',
        await readFile(join(home, 'state', 'resources.json'), 'utf8'),
        secrets,
      );
      expectNoChanges(await apply(options));

      // qBittorrent's key made anew in its web UI: apply puts Mediaplane's back in its
      // file, restarting it, and nothing else changes.
      const qbittorrentKey = keyOf(after, 'qbittorrent.apiKey');
      await rotateQbittorrentKey(newPassword);
      expect(await qbittorrentTakes(qbittorrentKey), 'qBittorrent refuses it now').toBe(
        false,
      );
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.secrets.restore).toEqual(['qbittorrent.apiKey']);
      expect(restored.plan.containers.filter((c) => c.action !== 'unchanged')).toEqual([
        { service: 'qbittorrent', action: 'restart' },
      ]);
      expect(restored.actions.find((a) => a.step === 'start')?.detail).toBe(
        "every app is running and healthy; restarted qbittorrent; put qbittorrent.apiKey back in its app's file",
      );
      expect(await qbittorrentTakes(qbittorrentKey), 'qBittorrent takes it again').toBe(
        true,
      );
      expectNoChanges(await apply(options));

      // Made anew again, and this time kept (Keep mine): drift finds qBittorrent
      // refusing Mediaplane's key; keep takes its own into state/secrets.json; the next
      // apply gives it to both arrs' download clients, and then nothing changes.
      await rotateQbittorrentKey(newPassword);
      const found = await drift(options);
      expect(found.drift).toContainEqual({
        resource: 'qbittorrent',
        kind: 'key',
        secret: 'apiKey',
      });
      const kept = await keep({ ...options, path: 'qbittorrent.apiKey' });
      expect(kept).toMatchObject({
        ok: true,
        key: 'qbittorrent.apiKey',
        holders: ['radarr.download_client', 'sonarr.download_client'],
      });
      expect(kept.value).toBeUndefined();
      expect(kept.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const ownKey = keyOf(await readSecretStore(home), 'qbittorrent.apiKey');
      secrets.push(ownKey);
      expect(ownKey !== qbittorrentKey, "qBittorrent's own key is kept").toBe(true);
      expect(await qbittorrentTakes(ownKey), 'qBittorrent takes the kept key').toBe(true);
      const given = await apply(options);
      expect(given.outcome).toBe('success');
      expect(wired(given.actions).filter(([, detail]) => detail !== 'unchanged')).toEqual(
        [
          ['radarr.download_client', 'updated apiKey'],
          ['sonarr.download_client', 'updated apiKey'],
        ],
      );
      expectNoSecret(
        "keep's and apply's results",
        JSON.stringify([kept, given]),
        secrets,
      );
      expectNoChanges(await apply(options));
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is only logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 1_500_000);
});
