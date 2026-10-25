import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  drift,
  keep,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
  type Drift,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  getJson,
  makeHome,
  qbittorrentForm,
  runTeardown,
  setServarrSetting,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-drift`;
const SONARR = 8989;
const RADARR = 7878;
const QBITTORRENT = 8080;
const JELLYFIN = 8096;
/** A key that isn't Jellyfin's: what a hand-made change leaves in Radarr's connection. */
const WRONG_KEY = '9'.repeat(32);

/** A Servarr provider as its API gives it: its settings, a key among them, masked. */
interface Provider {
  id: number;
  fields: { name: string; value?: unknown }[];
}

/** The stack, written by hand: its comments and spacing are what keep must keep. */
function stackOf(data: string): string {
  return `# The stack of the drift test.
version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${data} }      # the data folder
network: { bind: localhost }
media_server: jellyfin

apps:
  sonarr: {}                    # TV
  radarr: {}
  qbittorrent: { vpn: false }
`;
}

/**
 * What drift (or a plan) found, as the test compares it: each change by its address, kind
 * and, for a field, what was applied and what the app holds. A secret is named, never
 * shown.
 */
function found(result: { drift: readonly Drift[] }): string[] {
  return result.drift.map((d) =>
    d.kind === 'field'
      ? `${d.resource}.${d.field ?? ''}: ${JSON.stringify(d.expected)} → ${JSON.stringify(d.actual)}`
      : `${d.resource}${d.secret === undefined ? '' : `.${d.secret}`}: ${d.kind}${d.since === undefined ? '' : ' (since)'}`,
  );
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

describe('drift, Re-apply and Keep mine (success criterion 4)', () => {
  it('reports a managed field changed in an app with what was applied and what it holds; apply puts it back; keep keeps it', async () => {
    const home = await makeHome();
    const data = join(home, 'data');
    const stack = stackOf(data);
    await writeFile(join(home, 'stack.yaml'), stack);
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      const runtime = createDockerRuntime({ home, project: PROJECT });
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        project: PROJECT,
        confirm: () => Promise.resolve(true),
      };
      const unconfirmed: ApplyOptions = {
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      };
      const driftNow = () => drift(options);
      const keepNow = (path: string) => keep({ ...options, path });

      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      const clear = await driftNow();
      expect(found(clear)).toEqual([]);
      expect([clear.ok, clear.clear], 'drift is clear after apply').toEqual([true, true]);

      const store = await readSecretStore(home);
      const keyOf = (app: string) => store.apps[app]?.apiKey ?? '';
      const secrets = [
        ...Object.values(store.apps).flatMap((held) => Object.values(held)),
        store.shared?.adminPassword ?? '',
        WRONG_KEY,
      ];
      const sonarrKey = { 'X-Api-Key': keyOf('sonarr') };
      const bearer = { Authorization: `Bearer ${keyOf('qbittorrent')}` };
      const jellyfinKey = {
        Authorization: `MediaBrowser Client="Mediaplane e2e", Device="e2e", DeviceId="mediaplane-e2e", Version="1", Token="${keyOf('jellyfin')}"`,
      };
      const television = { name: 'tvCategory', value: 'television' };
      const qbtForm = (path: string, fields: Record<string, string>) =>
        qbittorrentForm(QBITTORRENT, path, keyOf('qbittorrent'), fields);
      const categoryOf = async () => {
        const [held] = await getJson<Provider[]>(
          SONARR,
          '/api/v3/downloadclient',
          sonarrKey,
        );
        return held?.fields.find((f) => f.name === 'tvCategory')?.value;
      };
      const qbt = async () => ({
        savePath: (
          await getJson<{ save_path: string }>(
            QBITTORRENT,
            '/api/v2/app/preferences',
            bearer,
          )
        ).save_path,
        categories: Object.keys(
          await getJson<Record<string, unknown>>(
            QBITTORRENT,
            '/api/v2/torrents/categories',
            bearer,
          ),
        ).sort(),
      });
      const moviesFolders = async () =>
        (
          await getJson<{ Name: string; Locations: string[] }[]>(
            JELLYFIN,
            '/Library/VirtualFolders',
            jellyfinKey,
          )
        )
          .find((l) => l.Name === 'Movies')
          ?.Locations.sort();
      const addMoviesFolder = async () => {
        await mkdir(join(data, 'media', 'extra'), { recursive: true });
        const added = await api(
          JELLYFIN,
          '/Library/VirtualFolders/Paths?refreshLibrary=false',
          jellyfinKey,
          {
            method: 'POST',
            body: JSON.stringify({ Name: 'Movies', Path: '/data/media/extra' }),
            type: 'application/json',
          },
        );
        expect(added.status, 'a folder added to Movies by hand').toBe(204);
      };

      // Changed by hand in each app, through its API, as its web UI would.
      const downloadClients = '/api/v3/downloadclient';
      await setServarrSetting(
        SONARR,
        downloadClients,
        keyOf('sonarr'),
        television,
        secrets,
      );
      await setServarrSetting(
        RADARR,
        '/api/v3/notification',
        keyOf('radarr'),
        { name: 'apiKey', value: WRONG_KEY },
        secrets,
      );
      await qbtForm('/api/v2/app/setPreferences', {
        json: JSON.stringify({ save_path: '/data/torrents/other' }),
      });
      await qbtForm('/api/v2/torrents/removeCategories', { categories: 'movies' });
      await addMoviesFolder();

      // drift reports each, with what was applied and what the app holds; a secret by
      // its name and the app's own check only.
      const changed = await driftNow();
      expect(found(changed)).toEqual([
        'jellyfin.library_movies.paths: "/data/media/movies" → "/data/media/extra,/data/media/movies"',
        'qbittorrent.preferences.savePath: "/data/torrents" → "/data/torrents/other"',
        'qbittorrent.category_movies: missing',
        'radarr.connection_jellyfin.apiKey: secret',
        'sonarr.download_client.category: "tv" → "television"',
      ]);
      expect([changed.ok, changed.clear]).toEqual([true, false]);
      expectNoSecret('what drift found', JSON.stringify(changed), secrets);
      // A secret it found refused isn't checked again until apply sets it: the same
      // drift, the refused key now taken from the last check.
      const recalled = found(changed).map((line) =>
        line === 'radarr.connection_jellyfin.apiKey: secret' ? `${line} (since)` : line,
      );
      const again = await driftNow();
      expect(found(again)).toEqual(recalled);
      // plan shows the same drift, as what apply would put back.
      const restored = await apply(options);
      expect(restored.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(restored.outcome).toBe('success');
      expect(found(restored.plan)).toEqual(recalled);
      expectNoSecret("the restoring apply's result", JSON.stringify(restored), secrets);
      // Re-apply put each back.
      expect(await categoryOf()).toBe('tv');
      expect(await qbt()).toEqual({
        savePath: '/data/torrents',
        categories: ['movies', 'tv'],
      });
      expect(await moviesFolders()).toEqual(['/data/media/movies']);
      const afterApply = await driftNow();
      expect(found(afterApply)).toEqual([]);
      expect(afterApply.clear).toBe(true);

      // Changed by hand again, and kept: the category, which qBittorrent doesn't have,
      // the folder added to Movies, and Sonarr's root folder deleted, which Mediaplane
      // then no longer manages.
      await setServarrSetting(
        SONARR,
        downloadClients,
        keyOf('sonarr'),
        television,
        secrets,
      );
      await addMoviesFolder();
      const [root] = await getJson<{ id: number }[]>(
        SONARR,
        '/api/v3/rootfolder',
        sonarrKey,
      );
      if (root === undefined) throw new Error('no root folder in Sonarr');
      const gone = await api(SONARR, `/api/v3/rootfolder/${String(root.id)}`, sonarrKey, {
        method: 'DELETE',
      });
      expect(gone.status).toBe(200);
      expect(found(await driftNow())).toEqual([
        'jellyfin.library_movies.paths: "/data/media/movies" → "/data/media/extra,/data/media/movies"',
        'sonarr.download_client.category: "tv" → "television"',
        'sonarr.root_folder: missing',
      ]);
      // What can't be kept is refused, and stack.yaml stays as it was.
      for (const [path, code] of [
        ['sonarr.download_client.apiKey', 'overrides.secret'],
        ['sonarr.download_client.priority', 'overrides.unmanaged-field'],
        ['jellyfin.library_movies.name', 'overrides.locked'],
        // Where Sonarr sends qBittorrent's key.
        ['sonarr.download_client.host', 'overrides.locked'],
        ['radarr.download_client.category', 'keep.no-drift'],
      ] as const) {
        const refused = await keepNow(path);
        expect([path, refused.ok, refused.diagnostics.map((d) => d.code)]).toEqual([
          path,
          false,
          [code],
        ]);
      }
      expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(stack);
      for (const path of [
        'sonarr.download_client.category',
        'jellyfin.library_movies.paths',
        'sonarr.root_folder',
      ]) {
        const kept = await keepNow(path);
        expect([
          path,
          kept.ok,
          kept.diagnostics.filter((d) => d.severity === 'error'),
        ]).toEqual([path, true, []]);
      }
      // Written under overrides:, the rest of the file as it was, its comments too.
      expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(
        `${stack}overrides:\n  sonarr.download_client.category: television\n  jellyfin.library_movies.paths: /data/media/extra,/data/media/movies\n  sonarr.root_folder: unmanaged\n`,
      );
      // Nothing changed outside Mediaplane now; but qBittorrent is to have the kept
      // category, which apply makes, and Sonarr's own test of its client would make it
      // with no save path: drift leaves the client's key unchecked until then.
      const kept = await driftNow();
      expect(found(kept)).toEqual([]);
      expect(kept.clear, 'drift waits for the kept category').toBe(false);
      expect(
        kept.checks
          .filter((c) => c.verdict === 'unchecked')
          .map((c) => `${c.resource}.${c.secret}: ${c.reason ?? ''}`),
      ).toEqual([
        'sonarr.download_client.apiKey: what it requires is yet to be put in place, which apply does first',
      ]);
      expect((await qbt()).categories).toEqual(['movies', 'tv']);
      // apply makes it, and changes nothing else; then drift is clear, and apply has
      // nothing more to do: what was kept stays as the apps hold it.
      const made = await apply(options);
      expect(
        made.plan.wiring
          .filter((w) => w.action !== 'unchanged')
          .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
        'apply after keep',
      ).toEqual(['qbittorrent.category_tv create ']);
      // Nor does it change a container.
      expect(
        made.plan.containers
          .filter((c) => c.action !== 'unchanged')
          .map((c) => `${c.service} ${c.action}`),
        'containers after keep',
      ).toEqual([]);
      expect(made.outcome).toBe('success');
      expect((await qbt()).categories).toEqual(['movies', 'television', 'tv']);
      const cleared = await driftNow();
      expect(found(cleared)).toEqual([]);
      expect(cleared.clear, 'drift is clear once apply made it').toBe(true);
      const settled = await apply(unconfirmed);
      expect(
        settled.plan.wiring
          .filter((w) => w.action !== 'unchanged')
          .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
        'apply again',
      ).toEqual([]);
      expect(settled.outcome).toBe('no-changes');
      expect(await categoryOf()).toBe('television');
      expect(await moviesFolders()).toEqual(['/data/media/extra', '/data/media/movies']);
      // Only the paths: the arr's answer holds more than the test needs to print.
      const roots = await getJson<{ path: string }[]>(
        SONARR,
        '/api/v3/rootfolder',
        sonarrKey,
      );
      expect(roots.map((r) => r.path)).toEqual([]);
      const records = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      expectNoSecret('resources.json', records, secrets);
      expectNoSecret(
        'stack.yaml',
        await readFile(join(home, 'stack.yaml'), 'utf8'),
        secrets,
      );
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
