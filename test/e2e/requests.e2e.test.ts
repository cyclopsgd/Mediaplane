import { readFile } from 'node:fs/promises';
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
  type ApplyResult,
  type Runtime,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  BUSYBOX,
  composeDown,
  docker as dockerCli,
  expectWiringRemoved,
  getJson,
  jsonBody,
  makeHome,
  runTeardown,
  servarrFailure,
  wired,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-requests`;
/** Seerr's web UI, on 127.0.0.1 once it is published. */
const SEERR = 5055;
/** Jellyfin's, where Seerr's key of its own shows in Jellyfin's list of keys. */
const JELLYFIN = 8096;
/**
 * What the whole stack wires, in the order apply wires it: Jellyfin and qBittorrent, the
 * arrs, Prowlarr, then Seerr, after Jellyfin and the arrs.
 */
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
  'prowlarr.admin',
  'prowlarr.application_sonarr',
  'prowlarr.application_radarr',
  'prowlarr.indexer_proxy',
  'seerr.media_server',
  'seerr.server_sonarr',
  'seerr.server_radarr',
  'seerr.setup',
];
/** Each arr, its web UI's port, and its root folder. */
const ARRS = [
  { app: 'sonarr', port: 8989, folder: '/data/media/tv' },
  { app: 'radarr', port: 7878, folder: '/data/media/movies' },
] as const;
/** A key that isn't the arr's: what a hand-made change leaves in a Seerr server. */
const WRONG_KEY = '9'.repeat(32);

/** A Sonarr or Radarr server, as Seerr shows it: its key in clear, never printed. */
interface Server {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  isDefault: boolean;
}

/** Seerr's Jellyfin, as it shows it: its key in clear, never printed. */
interface JellyfinSettings {
  ip: string;
  port: number;
  apiKey: string;
  libraries: { id: string; name: string; enabled: boolean }[];
}

/**
 * Seerr's container now, and its state as the stack's networks show it: whether its port
 * is published, and whether its setup is open, asked at its address on the wiring network
 * (from source, the host reaches it there). The media-server type is read strictly: an
 * answer without a number is an error, never "open".
 */
async function seerrState(runtime: Runtime): Promise<{ id: string; state: string }> {
  const container = (await runtime.containers()).find((c) => c.service === 'seerr');
  if (container === undefined) return { id: '', state: 'no container' };
  const address = (await runtime.wiringAddresses([container.id]))[container.id] ?? '';
  const answer = await fetch(
    `http://${address}:${String(SEERR)}/api/v1/settings/public`,
    {
      signal: AbortSignal.timeout(30_000),
    },
  );
  const { mediaServerType } = await jsonBody<{ mediaServerType?: unknown }>(
    answer,
    "Seerr's public settings",
  );
  if (typeof mediaServerType !== 'number') {
    throw new Error(
      `Seerr's public settings answered ${String(answer.status)} without a numeric mediaServerType`,
    );
  }
  const shown = container.published
    .map((p) => `${p.address}:${String(p.port)}`)
    .join(' ');
  // 4 is Seerr's "not configured": anyone who reaches it can still set it up.
  return {
    id: container.id,
    state: `ports ${shown === '' ? 'none' : shown}, setup ${mediaServerType === 4 ? 'open' : 'done'}`,
  };
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

/**
 * An apply that found nothing to do. A failure names what changed, and how: resources,
 * services, actions and field names, never a value.
 */
function expectNoChanges(result: ApplyResult): void {
  expect(
    result.plan.wiring
      .filter((w) => w.action !== 'unchanged')
      .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
    'wiring changed',
  ).toEqual([]);
  expect(
    result.plan.containers
      .filter((c) => c.action !== 'unchanged')
      .map((c) => `${c.service} ${c.action}`),
    'containers changed',
  ).toEqual([]);
  expect(result.outcome).toBe('no-changes');
}

describe('the whole stack, wired with no clicking', () => {
  it('signs Seerr in through Jellyfin before it is published, and links it to Jellyfin, Sonarr and Radarr', async () => {
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
      const docker = createDockerRuntime({ home, project: PROJECT });
      // Seerr as each up leaves it, and as the up that publishes it finds it, with the
      // container each reading saw.
      const seen: string[] = [];
      const ids: string[] = [];
      const record = async (when: string) => {
        const { id, state } = await seerrState(docker);
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

      // Before anything is started, plan names both setups, each app to start
      // unpublished: apply finishes each before it publishes the app.
      expect((await plan(options)).bootstrap).toEqual([
        { app: 'jellyfin', unpublished: true },
        { app: 'seerr', unpublished: true },
      ]);

      // One apply wires the whole stack: Seerr starts with no published port, signs in
      // through Jellyfin once Jellyfin is set up, and only then is published.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(seen).toEqual([
        'after an up of no jellyfin seerr port: ports none, setup open',
        'before an up of every port: ports none, setup done',
        `after an up of every port: ports 127.0.0.1:${String(SEERR)}, setup done`,
      ]);
      expect(
        ids[0] !== '' && ids[1] === ids[0],
        'Seerr set up in the unpublished container',
      ).toBe(true);
      expect(ids[2] !== ids[1], 'Seerr published in a new container').toBe(true);
      expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
        'set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr',
      );
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      expect(wired(first.actions).slice(-4)).toEqual([
        // Its first sign-in set Jellyfin as its media server, with no library yet, and a
        // key Seerr made itself, which Mediaplane's replaces (Slice 10b).
        ['seerr.media_server', 'updated libraries, apiKey'],
        ['seerr.server_sonarr', 'created'],
        ['seerr.server_radarr', 'created'],
        ['seerr.setup', 'updated initialized'],
      ]);
      expect(wired(first.actions).map(([resource]) => resource)).toEqual(WIRED);

      const store = await readSecretStore(home);
      // Mediaplane recorded Seerr's setup as its own (a list of names, no secret), so a
      // later plan finds no setup left to do.
      expect(
        store.setUp?.includes('seerr') === true,
        'Seerr recorded as set up by Mediaplane',
      ).toBe(true);
      expect((await plan(options)).bootstrap).toEqual([]);
      // Its settings.json made unreadable, as root, to every user but root: Seerr is
      // asked itself, says its setup is done, and stays as it is (Slice 10b).
      const chmod = (mode: string) =>
        dockerCli(
          'run',
          '--rm',
          '-v',
          `${join(home, 'appdata', 'seerr')}:/seerr`,
          BUSYBOX,
          'chmod',
          mode,
          '/seerr/settings.json',
        );
      await chmod('000');
      try {
        const asked = await plan(options);
        expect(asked.bootstrap).toEqual([]);
        expect(asked.changed).toBe(false);
        expect(asked.diagnostics.map((d) => d.code)).toContain('bootstrap.unreadable');
      } finally {
        await chmod('644');
      }
      const keyOf = (app: string) => store.apps[app]?.apiKey ?? '';
      const password = store.shared?.adminPassword ?? '';
      // Seerr's key is the one Mediaplane made, as its own settings.json keeps it. The
      // file holds keys, so a failure says only what failed: a failed read its own code
      // (EACCES, ENOENT) and path, and a failed parse nothing of the parser's message,
      // which would quote the file.
      const file = await readFile(
        join(home, 'appdata', 'seerr', 'settings.json'),
        'utf8',
      );
      let settings: { main?: { apiKey?: unknown } };
      try {
        settings = JSON.parse(file) as typeof settings;
      } catch {
        throw new Error(
          `Seerr's settings.json isn't JSON (${String(file.length)} characters)`,
        );
      }
      expect(keyOf('seerr') !== '', 'no Seerr key stored').toBe(true);
      expect(
        settings.main?.apiKey === keyOf('seerr'),
        "Seerr's settings.json holds the stored key",
      ).toBe(true);
      const seerrKey = { 'X-Api-Key': keyOf('seerr') };
      const jellyfinHeader = {
        Authorization: `MediaBrowser Client="Mediaplane e2e", Device="e2e", DeviceId="mediaplane-e2e", Version="1", Token="${keyOf('jellyfin')}"`,
      };
      // Seerr made itself a key in Jellyfin as it signed in; Mediaplane gave it its own
      // in its place, and removed Seerr's: Jellyfin holds Mediaplane's alone, which Seerr
      // holds (it shows its Jellyfin key, compared here, yes or no).
      const keys = await getJson<{ Items: { AccessToken: string; AppName: string }[] }>(
        JELLYFIN,
        '/Auth/Keys',
        jellyfinHeader,
      );
      expect(keys.Items.map((k) => k.AppName)).toEqual(['Mediaplane']);
      const held = await getJson<{ apiKey: string }>(
        SEERR,
        '/api/v1/settings/jellyfin',
        seerrKey,
      );
      expect(held.apiKey === keyOf('jellyfin'), "Seerr holds Mediaplane's key").toBe(
        true,
      );
      const secrets = [
        ...Object.values(store.apps).flatMap((value) => Object.values(value)),
        password,
      ];
      const resourcesFile = join(home, 'state', 'resources.json');
      expectNoSecret('resources.json', await readFile(resourcesFile, 'utf8'), secrets);
      expectNoSecret("apply's result", JSON.stringify(first), secrets);

      // The shared admin signs in to Seerr's published web UI through Jellyfin, as its
      // admin; another password doesn't.
      const signIn = (pw: string) =>
        api(
          SEERR,
          '/api/v1/auth/jellyfin',
          {},
          {
            method: 'POST',
            body: JSON.stringify({ username: 'admin', password: pw }),
            type: 'application/json',
            timeoutMs: 30_000,
          },
        );
      const right = await signIn(password);
      expect(right.status, 'the shared admin signs in to Seerr').toBe(200);
      const user = await jsonBody<{ id: number; permissions: number }>(
        right,
        "Seerr's sign-in",
      );
      expect([user.id, user.permissions], "as Seerr's admin").toEqual([1, 2]);
      const cookie = (right.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const out = await api(
        SEERR,
        '/api/v1/auth/logout',
        { Cookie: cookie },
        {
          method: 'POST',
        },
      );
      expect(out.status, 'signed out of Seerr').toBe(200);
      expect((await signIn('fake-not-the-password')).status).toBe(401);

      // Seerr's media server is Jellyfin, at its service, with Movies and Shows enabled.
      const jellyfinOf = () =>
        getJson<JellyfinSettings>(SEERR, '/api/v1/settings/jellyfin', seerrKey);
      const linked = await jellyfinOf();
      expect([linked.ip, linked.port], "Seerr's Jellyfin").toEqual([
        'jellyfin',
        JELLYFIN,
      ]);
      const enabled = (held: JellyfinSettings) =>
        held.libraries
          .filter((l) => l.enabled)
          .map((l) => l.name)
          .sort();
      expect(enabled(linked)).toEqual(['Movies', 'Shows']);
      // Seerr reaches Jellyfin with the key it holds: its list of Jellyfin's users works.
      const users = await api(SEERR, '/api/v1/settings/jellyfin/users', seerrKey);
      expect(users.status, "Seerr's list of Jellyfin's users").toBe(200);

      // Its Sonarr and Radarr servers: each arr at its service, its root folder, the
      // HD-1080p profile, by default, and Seerr's own test of each passes.
      const serversOf = (arr: string) =>
        getJson<Server[]>(SEERR, `/api/v1/settings/${arr}`, seerrKey);
      const testServer = async (arr: string, held: Server) => {
        const { id: _id, ...sent } = held;
        const tested = await api(SEERR, `/api/v1/settings/${arr}/test`, seerrKey, {
          method: 'POST',
          body: JSON.stringify(sent),
          type: 'application/json',
          timeoutMs: 60_000,
        });
        return tested.status === 200 ? 'passes' : await servarrFailure(tested, secrets);
      };
      // The id of the arr's profile of that name, from Seerr's own test of the server it
      // holds, which lists the arr's profiles.
      const profileId = async (arr: string, held: Server, name: string) => {
        const { id: _id, ...sent } = held;
        const tested = await api(SEERR, `/api/v1/settings/${arr}/test`, seerrKey, {
          method: 'POST',
          body: JSON.stringify(sent),
          type: 'application/json',
          timeoutMs: 60_000,
        });
        expect(tested.status, `Seerr's test of ${arr}`).toBe(200);
        const { profiles } = await jsonBody<{ profiles: { id: number; name: string }[] }>(
          tested,
          `Seerr's test of ${arr}`,
        );
        const profile = profiles.find((p) => p.name === name);
        if (profile === undefined) throw new Error(`${arr} has no ${name} profile`);
        return profile.id;
      };
      const serverOf = async (arr: string) => {
        const [held] = await serversOf(arr);
        if (held === undefined) throw new Error(`no ${arr} server in Seerr`);
        return held;
      };
      for (const arr of ARRS) {
        const servers = await serversOf(arr.app);
        // Only what is compared is printed: the server holds the arr's key in clear.
        expect(
          servers.map((s) => [
            s.name,
            s.hostname,
            s.port,
            s.activeProfileName,
            s.activeDirectory,
            s.isDefault,
          ]),
          `Seerr's ${arr.app} server`,
        ).toEqual([
          [
            `${arr.app === 'sonarr' ? 'Sonarr' : 'Radarr'} (Mediaplane)`,
            arr.app,
            arr.port,
            'HD-1080p',
            arr.folder,
            true,
          ],
        ]);
        const [held] = servers;
        if (held === undefined) throw new Error(`no ${arr.app} server`);
        expect(await testServer(arr.app, held), `Seerr's test of ${arr.app}`).toBe(
          'passes',
        );
      }
      // Its setup is finished: its web UI no longer offers the wizard.
      const shown = await getJson<{ initialized: boolean }>(
        SEERR,
        '/api/v1/settings/public',
        {},
      );
      expect(shown.initialized).toBe(true);

      // A second apply changes nothing.
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expectNoChanges(again);

      // Changed by hand in Seerr: Shows turned off, a wrong key in its Radarr server, and
      // the Any profile in its Sonarr server. apply puts each back, and nothing else
      // changes.
      const shows = linked.libraries.find((l) => l.name === 'Shows');
      if (shows === undefined) throw new Error("no Shows library in Seerr's Jellyfin");
      const off = await api(
        SEERR,
        `/api/v1/settings/jellyfin/library/${shows.id}`,
        seerrKey,
        {
          method: 'PUT',
          body: JSON.stringify({ enabled: false }),
          type: 'application/json',
        },
      );
      expect(off.status, 'Shows turned off by hand').toBe(200);
      const change = async (arr: string, edit: (held: Server) => Server) => {
        const { id, ...rest } = edit(await serverOf(arr));
        const saved = await api(
          SEERR,
          `/api/v1/settings/${arr}/${String(id)}`,
          seerrKey,
          {
            method: 'PUT',
            body: JSON.stringify(rest),
            type: 'application/json',
          },
        );
        expect(saved.status, `${arr}'s server changed by hand`).toBe(200);
      };
      await change('radarr', (held) => ({ ...held, apiKey: WRONG_KEY }));
      await change('sonarr', (held) => ({
        ...held,
        activeProfileId: 1,
        activeProfileName: 'Any',
      }));
      expect(await testServer('radarr', await serverOf('radarr'))).not.toBe('passes');
      const restored = await apply(options);
      expect(restored.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'seerr.media_server', action: 'update', changes: ['libraries'] },
        { resource: 'seerr.server_sonarr', action: 'update', changes: ['activeProfile'] },
        { resource: 'seerr.server_radarr', action: 'update', changes: ['apiKey'] },
      ]);
      expect(
        restored.plan.containers
          .filter((c) => c.action !== 'unchanged')
          .map((c) => `${c.service} ${c.action}`),
        'containers changed',
      ).toEqual([]);
      // The restore read the Radarr server's key back from Seerr, the wrong one, and
      // tested the stack's: neither, nor any other key, is kept or shown.
      const restoredSecrets = [
        ...secrets,
        ...Object.values((await readSecretStore(home)).apps).flatMap((held) =>
          Object.values(held),
        ),
        WRONG_KEY,
      ];
      expectNoSecret(
        'resources.json, restored',
        await readFile(resourcesFile, 'utf8'),
        restoredSecrets,
      );
      expectNoSecret(
        "the restoring apply's result",
        JSON.stringify(restored),
        restoredSecrets,
      );
      expect(enabled(await jellyfinOf())).toEqual(['Movies', 'Shows']);
      for (const arr of ARRS) {
        const held = await serverOf(arr.app);
        // Seerr sends requests with the profile's id, so the id is put back as well as
        // the name.
        expect(
          [held.activeProfileName, held.activeProfileId],
          `Seerr's ${arr.app} profile`,
        ).toEqual(['HD-1080p', await profileId(arr.app, held, 'HD-1080p')]);
        expect(await testServer(arr.app, held), `Seerr's test of ${arr.app}`).toBe(
          'passes',
        );
      }
      const settled = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expectNoChanges(settled);
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
