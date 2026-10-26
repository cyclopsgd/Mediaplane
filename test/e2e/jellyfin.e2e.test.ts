import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  plan,
  readSecretStore,
  type ApplyOptions,
  type Runtime,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  getJson,
  jsonBody,
  makeHome,
  runTeardown,
  servarrFailure,
  stackFor,
  wired,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-jellyfin`;
/** Jellyfin's web UI, on 127.0.0.1 once it is published. */
const JELLYFIN = 8096;
/** What the stack wires, in the order apply wires it: Jellyfin and qBittorrent first. */
const WIRED = [
  'jellyfin.admin',
  'jellyfin.library_movies',
  'jellyfin.library_shows',
  'qbittorrent.admin',
  'qbittorrent.preferences',
  'qbittorrent.category_tv',
  'qbittorrent.category_movies',
  'radarr.admin',
  'radarr.download_client',
  'radarr.root_folder',
  'radarr.connection_jellyfin',
  'sonarr.admin',
  'sonarr.download_client',
  'sonarr.root_folder',
  'sonarr.connection_jellyfin',
];
/** Each arr, and its web UI's port. */
const ARRS = [
  { app: 'sonarr', port: 8989 },
  { app: 'radarr', port: 7878 },
] as const;
/** The libraries the stack wants: name, what they hold, and their folder. */
const LIBRARIES = [
  ['Movies', 'movies', ['/data/media/movies']],
  ['Shows', 'tvshows', ['/data/media/tv']],
];
/** A key that isn't Jellyfin's: what a hand-made change leaves in an arr's connection. */
const WRONG_KEY = '9'.repeat(32);

/** Jellyfin's MediaBrowser header for its key, or a sign-in's client fields. */
function mediaBrowser(key?: string): Record<string, string> {
  const client =
    'MediaBrowser Client="Mediaplane e2e", Device="e2e", DeviceId="mediaplane-e2e", Version="1"';
  return { Authorization: key === undefined ? client : `${client}, Token="${key}"` };
}

interface Connection {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
}

interface Library {
  Name: string;
  CollectionType?: string;
  Locations: string[];
  LibraryOptions: { TypeOptions: { Type: string; MetadataFetchers: string[] }[] };
}

/**
 * Jellyfin's container now, and its state as the stack's networks show it: whether its
 * port is published on the host, and whether its startup wizard is open, asked at its
 * address on the wiring network (from source, the host reaches it there). The wizard's
 * flag is read strictly: an answer without a boolean `StartupWizardCompleted` (such as
 * the camelCase one Jellyfin's minimal startup server gives) is an error, never "open".
 */
async function jellyfinState(runtime: Runtime): Promise<{ id: string; state: string }> {
  const container = (await runtime.containers()).find((c) => c.service === 'jellyfin');
  if (container === undefined) return { id: '', state: 'no container' };
  const address = (await runtime.wiringAddresses([container.id]))[container.id] ?? '';
  const answer = await fetch(`http://${address}:${String(JELLYFIN)}/System/Info/Public`, {
    signal: AbortSignal.timeout(10_000),
  });
  const { StartupWizardCompleted: done } = await jsonBody<{
    StartupWizardCompleted?: unknown;
  }>(answer, "Jellyfin's public info");
  if (typeof done !== 'boolean') {
    throw new Error(
      `Jellyfin's public info answered ${String(answer.status)} without a boolean StartupWizardCompleted`,
    );
  }
  const shown = container.published
    .map((p) => `${p.address}:${String(p.port)}`)
    .join(' ');
  return {
    id: container.id,
    state: `ports ${shown === '' ? 'none' : shown}, wizard ${done ? 'done' : 'open'}`,
  };
}

/**
 * Check that `response` answered `status`. Only a refusal is read, to say why: its
 * validation errors, with every one of `secrets` replaced (servarrFailure).
 */
async function expectStatus(
  response: Response,
  status: number,
  what: string,
  secrets: readonly string[],
): Promise<void> {
  if (response.status === status) return;
  const why = await servarrFailure(response, secrets);
  expect(response.status, `${what}: ${why}`).toBe(status);
}

describe('Jellyfin, set up before it is published', () => {
  it('is wired headlessly: its setup, its libraries, and the arrs telling it of imports', async () => {
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
      const data = join(home, 'data');
      await writeFile(
        join(home, 'stack.yaml'),
        stackFor(data, { seerr: false, prowlarr: false }),
      );
      const docker = createDockerRuntime({ home, project: PROJECT });
      // Jellyfin as each up leaves it, and as the up that publishes it finds it, with
      // the container each reading saw.
      const seen: string[] = [];
      const ids: string[] = [];
      const record = async (when: string) => {
        const { id, state } = await jellyfinState(docker);
        seen.push(`${when}: ${state}`);
        ids.push(id);
      };
      const runtime: Runtime = {
        ...docker,
        up: async (seconds, values, unpublished = []) => {
          if (unpublished.length === 0) await record('before an up of every port');
          const result = await docker.up(seconds, values, unpublished);
          const what =
            unpublished.length === 0 ? 'every port' : `no ${unpublished.join(' ')} port`;
          await record(`after an up of ${what}`);
          return result;
        },
      };
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

      // plan names the setup, and never runs it.
      const planned = await plan(options);
      expect(planned.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);

      // Jellyfin starts with no published port; Mediaplane finishes its startup wizard
      // over the wiring network, makes its key, and only then publishes it.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(seen).toEqual([
        'after an up of no jellyfin port: ports none, wizard open',
        'before an up of every port: ports none, wizard done',
        `after an up of every port: ports 127.0.0.1:${String(JELLYFIN)}, wizard done`,
      ]);
      // The wizard was finished in the container that started unpublished, and the
      // publishing up recreated it.
      expect(
        [ids[0] !== '' && ids[1] === ids[0], ids[2] !== ids[1]],
        "Jellyfin's containers: set up in the unpublished one, published in a new one",
      ).toEqual([true, true]);
      expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
        'set up jellyfin and saved jellyfin.apiKey; published jellyfin',
      );
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      // The wizard made the shared admin: the wire step finds it as wanted.
      expect(wired(first.actions)).toEqual([
        ['jellyfin.admin', 'adopted'],
        ['jellyfin.library_movies', 'created'],
        ['jellyfin.library_shows', 'created'],
        ['qbittorrent.admin', 'adopted'],
        ['qbittorrent.preferences', 'adopted'],
        ['qbittorrent.category_tv', 'created'],
        ['qbittorrent.category_movies', 'created'],
        ['radarr.admin', 'created'],
        ['radarr.download_client', 'created'],
        ['radarr.root_folder', 'created'],
        ['radarr.connection_jellyfin', 'created'],
        ['sonarr.admin', 'created'],
        ['sonarr.download_client', 'created'],
        ['sonarr.root_folder', 'created'],
        ['sonarr.connection_jellyfin', 'created'],
      ]);

      // Its key, made by Jellyfin, kept in the store and nowhere Mediaplane shows.
      const store = await readSecretStore(home);
      const key = store.apps.jellyfin?.apiKey ?? '';
      expect(/^[0-9a-f]{32}$/.test(key), 'Jellyfin made no key of 32 hex').toBe(true);
      const password = store.shared?.adminPassword ?? '';
      expect(password !== '', 'no admin password stored').toBe(true);
      const secrets = [
        ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
        password,
      ];
      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      for (const [what, text] of [
        ['resources.json', resources],
        ["apply's result", JSON.stringify(first)],
      ] as const) {
        expect(text.includes(key), `${what} holds Jellyfin's key`).toBe(false);
        expect(text.includes(password), `${what} holds the password`).toBe(false);
      }

      // The shared admin signs in to Jellyfin's published web UI; another password doesn't.
      const signIn = (pw: string) =>
        api(JELLYFIN, '/Users/AuthenticateByName', mediaBrowser(), {
          method: 'POST',
          body: JSON.stringify({ Username: 'admin', Pw: pw }),
          type: 'application/json',
          timeoutMs: 30_000,
        });
      const right = await signIn(password);
      expect(right.status, 'the shared admin signs in').toBe(200);
      const { AccessToken: session } = await jsonBody<{ AccessToken: string }>(
        right,
        "Jellyfin's sign-in",
      );
      const out = await api(JELLYFIN, '/Sessions/Logout', mediaBrowser(session), {
        method: 'POST',
      });
      expect(out.status, 'signed out').toBe(204);
      expect((await signIn('fake-not-the-password')).status).toBe(401);

      // The libraries, each in its folder, with Jellyfin's default metadata downloaders.
      const libraries = async () =>
        (
          await getJson<Library[]>(JELLYFIN, '/Library/VirtualFolders', mediaBrowser(key))
        ).sort((a, b) => (a.Name < b.Name ? -1 : 1));
      const held = await libraries();
      expect(held.map((l) => [l.Name, l.CollectionType, l.Locations])).toEqual(LIBRARIES);
      expect(
        held[0]?.LibraryOptions.TypeOptions.find((t) => t.Type === 'Movie')
          ?.MetadataFetchers,
      ).toContain('TheMovieDb');

      // Both arrs hold "Jellyfin (Mediaplane)", aimed at Jellyfin's service, its key masked,
      // and their own test of it passes.
      const connectionOf = async (arr: (typeof ARRS)[number]) => {
        const all = await getJson<Connection[]>(arr.port, '/api/v3/notification', {
          'X-Api-Key': store.apps[arr.app]?.apiKey ?? '',
        });
        return all.find((c) => c.name === 'Jellyfin (Mediaplane)');
      };
      const testConnection = async (arr: (typeof ARRS)[number]) => {
        const held = await connectionOf(arr);
        const tested = await api(
          arr.port,
          '/api/v3/notification/test',
          { 'X-Api-Key': store.apps[arr.app]?.apiKey ?? '' },
          { method: 'POST', body: JSON.stringify(held), type: 'application/json' },
        );
        return tested.status === 200 ? 'passes' : await servarrFailure(tested, secrets);
      };
      for (const arr of ARRS) {
        const held = await connectionOf(arr);
        const setting = (name: string) =>
          held?.fields.find((f) => f.name === name)?.value;
        expect(
          [
            held?.implementation,
            setting('host'),
            setting('port'),
            setting('updateLibrary'),
          ],
          `${arr.app}'s connection`,
        ).toEqual(['MediaBrowser', 'jellyfin', JELLYFIN, true]);
        // Yes or no only: a failure must never print what the arr showed, the key itself.
        expect(setting('apiKey') === '********', `${arr.app} shows the key masked`).toBe(
          true,
        );
        expect(await testConnection(arr), `${arr.app}'s test of it`).toBe('passes');
      }

      // A second apply changes nothing.
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // Changed by hand: a key in Sonarr's connection that isn't Jellyfin's, the Shows
      // library deleted, and a folder added to Movies. apply puts each back, and nothing
      // else changes.
      const [sonarr] = ARRS;
      const sonarrKey = { 'X-Api-Key': store.apps.sonarr?.apiKey ?? '' };
      const connection = await connectionOf(sonarr);
      const wrong = await api(
        sonarr.port,
        `/api/v3/notification/${String(connection?.id)}?forceSave=true`,
        sonarrKey,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...connection,
            fields: connection?.fields.map((f) =>
              f.name === 'apiKey' ? { ...f, value: WRONG_KEY } : f,
            ),
          }),
          type: 'application/json',
        },
      );
      await expectStatus(wrong, 202, "a wrong key in Sonarr's connection", secrets);
      const removed = await api(
        JELLYFIN,
        '/Library/VirtualFolders?name=Shows&refreshLibrary=false',
        mediaBrowser(key),
        { method: 'DELETE' },
      );
      expect(removed.status, 'Shows removed by hand').toBe(204);
      await mkdir(join(data, 'media', 'other'));
      const added = await api(
        JELLYFIN,
        '/Library/VirtualFolders/Paths?refreshLibrary=false',
        mediaBrowser(key),
        {
          method: 'POST',
          body: JSON.stringify({ Name: 'Movies', Path: '/data/media/other' }),
          type: 'application/json',
        },
      );
      expect(added.status, 'a folder added to Movies by hand').toBe(204);
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'jellyfin.library_movies', action: 'update', changes: ['paths'] },
        { resource: 'jellyfin.library_shows', action: 'create' },
        { resource: 'sonarr.connection_jellyfin', action: 'update', changes: ['apiKey'] },
      ]);
      expect(
        wired(restored.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([
        ['jellyfin.library_movies', 'updated paths'],
        ['jellyfin.library_shows', 'created'],
        ['sonarr.connection_jellyfin', 'updated apiKey'],
      ]);
      expect(restored.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
      expect(
        (await libraries()).map((l) => [l.Name, l.CollectionType, l.Locations]),
      ).toEqual(LIBRARIES);
      expect(await testConnection(sonarr), "Sonarr's test of it").toBe('passes');

      // Jellyfin's own key, deleted in its dashboard: plan says Jellyfin refuses it, and
      // both arrs' own test refuses the old key their connections hold. apply signs in as
      // the admin, published, makes a new key, and gives it to both arrs' connections,
      // whose test then passes (Slice 10a: no hand edit of state/secrets.json).
      const revoked = await api(JELLYFIN, `/Auth/Keys/${key}`, mediaBrowser(key), {
        method: 'DELETE',
      });
      expect(revoked.status, "Jellyfin's key revoked by hand").toBe(204);
      const refused = await plan(options);
      expect(refused.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
      expect(refused.wiring.filter((w) => w.resource.startsWith('jellyfin.'))).toEqual(
        WIRED.slice(0, 3).map((resource) => ({
          resource,
          action: 'unknown',
          reason: expect.stringContaining(
            "refused Mediaplane's API key (HTTP 401)",
          ) as string,
        })),
      );
      // Both arrs' connections still hold the old key, and their own test refuses it.
      for (const arr of ARRS) {
        expect(await testConnection(arr), `${arr.app}'s test of the old key`).toContain(
          'ApiKey:',
        );
      }
      seen.length = 0;
      ids.length = 0;
      const rekeyed = await apply(options);
      expect(rekeyed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(rekeyed.outcome).toBe('success');
      expect(rekeyed.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
      // The start step's up, and no other: Jellyfin stayed published throughout.
      expect(seen).toEqual([
        `before an up of every port: ports 127.0.0.1:${String(JELLYFIN)}, wizard done`,
        `after an up of every port: ports 127.0.0.1:${String(JELLYFIN)}, wizard done`,
      ]);
      expect(
        ids[0] !== '' && ids[1] === ids[0],
        'Jellyfin was not recreated by the rekey',
      ).toBe(true);
      const newKey = (await readSecretStore(home)).apps.jellyfin?.apiKey ?? '';
      expect(newKey !== '' && newKey !== key, 'a new key was made and saved').toBe(true);
      // Kept out of every message from here on, as the old one is.
      secrets.push(newKey);
      expect(
        wired(rekeyed.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([
        ['radarr.connection_jellyfin', 'updated apiKey'],
        ['sonarr.connection_jellyfin', 'updated apiKey'],
      ]);
      for (const arr of ARRS) {
        expect(await testConnection(arr), `${arr.app}'s test of it`).toBe('passes');
      }
      const settled = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(settled.outcome).toBe('no-changes');
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is only logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 1_200_000);
});
