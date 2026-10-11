import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
  type ExecResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  composeDown,
  deployMediaplane,
  expectWiringRemoved,
  makeHome,
  parseRevealed,
  REPO,
  runTeardown,
  type DeployedMediaplane,
} from './helpers';
import {
  envLines,
  gluetunEnv,
  startWireGuard,
  TUNNEL,
  type WireGuardServer,
} from './wireguard';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-download`;
/** qBittorrent's web UI port, off the default: the download clients must follow it. */
const QBT_PORT = 8090;
/** Verify's detail when it ran vpn-check's checks and found the VPN up. */
const VPN_UP =
  "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up";
/** What the stack wires, in the order apply wires it: qBittorrent before the arrs. */
const WIRED = [
  'qbittorrent.admin',
  'qbittorrent.preferences',
  'qbittorrent.category_tv',
  'qbittorrent.category_movies',
  'radarr.admin',
  'radarr.download_client',
  'radarr.root_folder',
  'sonarr.admin',
  'sonarr.download_client',
  'sonarr.root_folder',
];
/** Each arr: its port, its category, the setting that holds it, and its root folder. */
const ARRS = [
  {
    app: 'sonarr',
    port: 8989,
    category: 'tv',
    setting: 'tvCategory',
    root: '/data/media/tv',
  },
  {
    app: 'radarr',
    port: 7878,
    category: 'movies',
    setting: 'movieCategory',
    root: '/data/media/movies',
  },
] as const;
const [SONARR, RADARR] = ARRS;
/** A password that isn't the shared one: what a hand-made change leaves in qBittorrent. */
const OTHER_PASSWORD = 'fake-other-password-1';
/** A key that isn't qBittorrent's: what a hand-made change leaves in Sonarr's client. */
const WRONG_KEY = `qbt_${'9'.repeat(28)}`;

const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

/** `mediaplane <args>`, run from source as a user would, for the test's project. */
function mediaplane(...args: string[]): Promise<ExecResult> {
  return nodeExec(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    cwd: REPO,
    env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT },
    timeoutMs: 120_000,
  });
}

/** Sonarr, Radarr, and qBittorrent behind Gluetun on the test's WireGuard server. */
function downloadStack(data: string, wg: WireGuardServer): string {
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${JSON.stringify(data)} }
network: { bind: localhost }
media_server: jellyfin
vpn:
  provider: custom
  private_key: { file: secrets/wg.key }
  addresses: ${JSON.stringify(TUNNEL.client)}
apps:
  sonarr: {}
  radarr: {}
  qbittorrent: { port: ${String(QBT_PORT)} }
  gluetun:
    env:
${envLines(gluetunEnv(wg), '      ')}
`;
}

/** A call to an app's API on its published port, with its key, as JSON. */
async function api(
  port: number,
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: string; type?: string } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...headers,
      ...(init.type === undefined ? {} : { 'Content-Type': init.type }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(60_000),
  });
}

/**
 * A GET of an app's API, as JSON, after checking it answered 2xx. A failure gives the
 * status, and only the body's length when it isn't JSON: an app's answer can hold a key
 * (qBittorrent's preferences hold its own), and CI's log is public.
 */
async function getJson<T>(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<T> {
  const response = await api(port, path, headers);
  const what = `GET ${path} on port ${String(port)}`;
  expect(response.ok, `${what} answered ${String(response.status)}`).toBe(true);
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `${what} answered ${String(response.status)} with ${String(body.length)} characters that aren't JSON`,
    );
  }
}

/**
 * Why an arr refused a request, safe for CI's public log: the status, and each validation
 * error's `propertyName: errorMessage`, with every one of `secrets` replaced. Never the
 * raw body, nor an error's `attemptedValue`, which can be the key under test. A body that
 * isn't such a list gives only its length.
 */
async function servarrFailure(
  response: Response,
  secrets: readonly string[],
): Promise<string> {
  const status = `status ${String(response.status)}`;
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `${status}, with ${String(body.length)} characters that aren't JSON`;
  }
  if (!Array.isArray(parsed)) {
    return `${status}, with ${String(body.length)} characters of JSON that isn't a list`;
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '?');
  const said = parsed.map((item: unknown) => {
    const { propertyName, errorMessage } = (
      typeof item === 'object' && item !== null ? item : {}
    ) as Record<string, unknown>;
    return `${text(propertyName)}: ${text(errorMessage)}`;
  });
  return secrets
    .filter((secret) => secret !== '')
    .reduce(
      (message, secret) => message.replaceAll(secret, '***'),
      `${status}: ${said.join('; ')}`,
    );
}

interface Client {
  id: number;
  name: string;
  enable: boolean;
  fields: { name: string; value?: unknown }[];
}

/**
 * What success criterion 1 asks of the download path, read back from each app:
 * - qBittorrent takes the shared login, and keeps a category for each arr, saving under
 *   /data/torrents, with Automatic Torrent Management on;
 * - Sonarr and Radarr each hold "qBittorrent (Mediaplane)", aimed at Gluetun on
 *   qBittorrent's port, and their own test of it passes: through Gluetun's firewall;
 * - their root folders exist under /data/media, which shares one mount with the downloads.
 * Each assertion that could see a key or the password says only whether it passed, but
 * the arr's test, which says each setting it refused and why, every secret replaced.
 */
async function expectDownloadPath(home: string): Promise<void> {
  const store = await readSecretStore(home);
  const shown = await mediaplane('credentials', '--home', home, '--json', '--reveal');
  expect(shown.code, shown.stderr).toBe(0);
  const login = parseRevealed(shown.stdout);
  const signIn = await api(
    QBT_PORT,
    '/api/v2/auth/login',
    {},
    {
      method: 'POST',
      body: new URLSearchParams({
        username: login.username,
        password: login.password,
      }).toString(),
      type: 'application/x-www-form-urlencoded',
    },
  );
  expect(signIn.status, 'qBittorrent refused the shared login').toBe(204);
  // Kept out of every failure message below, whatever an app says.
  const secrets = [
    login.password,
    ...Object.values(store.apps).flatMap((held) => Object.values(held)),
  ];
  const bearer = { Authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` };
  const categories = await getJson<Record<string, { savePath: string }>>(
    QBT_PORT,
    '/api/v2/torrents/categories',
    bearer,
  );
  expect(
    Object.fromEntries(Object.entries(categories).map(([name, c]) => [name, c.savePath])),
  ).toEqual({ movies: '/data/torrents/movies', tv: '/data/torrents/tv' });
  const preferences = await getJson<{ save_path: string; auto_tmm_enabled: boolean }>(
    QBT_PORT,
    '/api/v2/app/preferences',
    bearer,
  );
  // Only these two: the preferences hold qBittorrent's key too.
  expect([preferences.save_path, preferences.auto_tmm_enabled]).toEqual([
    '/data/torrents',
    true,
  ]);
  for (const arr of ARRS) {
    const keyed = { 'X-Api-Key': store.apps[arr.app]?.apiKey ?? '' };
    const clients = await getJson<Client[]>(arr.port, '/api/v3/downloadclient', keyed);
    expect(
      clients.map((c) => c.name),
      `${arr.app}'s download clients`,
    ).toEqual(['qBittorrent (Mediaplane)']);
    const [held] = clients;
    if (held === undefined) throw new Error(`${arr.app} has no download client`);
    const value = (name: string) => held.fields.find((f) => f.name === name)?.value;
    expect(
      [held.enable, value('host'), value('port'), value('useSsl'), value(arr.setting)],
      `${arr.app}'s download client`,
    ).toEqual([true, 'gluetun', QBT_PORT, false, arr.category]);
    // The arr's own test: it signs in to qBittorrent with its key, through Gluetun.
    const tested = await api(arr.port, '/api/v3/downloadclient/test', keyed, {
      method: 'POST',
      body: JSON.stringify(held),
      type: 'application/json',
    });
    expect(
      tested.status,
      `${arr.app}'s test of qBittorrent failed: ${await servarrFailure(tested, secrets)}`,
    ).toBe(200);
    const folders = await getJson<{ path: string; accessible: boolean }[]>(
      arr.port,
      '/api/v3/rootfolder',
      keyed,
    );
    expect(
      folders.map((f) => [f.path, f.accessible]),
      `${arr.app}'s root folders`,
    ).toEqual([[arr.root, true]]);
    expect(
      (await stat(join(home, 'data', arr.root.slice('/data/'.length)))).isDirectory(),
    ).toBe(true);
  }
  // One mount for downloads and media: an import is a hard link.
  const sources = await Promise.all(
    ['qbittorrent', 'radarr', 'sonarr'].map(async (service) => {
      const inspect = await nodeExec(
        'docker',
        [
          'container',
          'inspect',
          '--format',
          '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}',
          `${PROJECT}-${service}-1`,
        ],
        { cwd: '/', timeoutMs: 120_000 },
      );
      expect(inspect.code, inspect.stderr).toBe(0);
      return inspect.stdout.trim();
    }),
  );
  expect(sources).toEqual([0, 1, 2].map(() => join(home, 'data')));
}

/** Set qBittorrent's preferences by hand, with its key, as its web UI would. */
async function setPreferences(home: string, values: Record<string, unknown>) {
  const store = await readSecretStore(home);
  const set = await api(
    QBT_PORT,
    '/api/v2/app/setPreferences',
    { Authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` },
    {
      method: 'POST',
      body: new URLSearchParams({ json: JSON.stringify(values) }).toString(),
      type: 'application/x-www-form-urlencoded',
    },
  );
  expect(set.status).toBe(200);
}

/**
 * Take Radarr's link apart by hand: its download client and root folder, the folder
 * itself, and qBittorrent's movies category. And change qBittorrent's password.
 */
async function undoRadarr(home: string): Promise<void> {
  const store = await readSecretStore(home);
  const keyed = { 'X-Api-Key': store.apps.radarr?.apiKey ?? '' };
  const clients = await getJson<Client[]>(RADARR.port, '/api/v3/downloadclient', keyed);
  const folders = await getJson<{ id: number }[]>(
    RADARR.port,
    '/api/v3/rootfolder',
    keyed,
  );
  for (const path of [
    ...clients.map((c) => `/api/v3/downloadclient/${String(c.id)}`),
    ...folders.map((f) => `/api/v3/rootfolder/${String(f.id)}`),
  ]) {
    const deleted = await api(RADARR.port, path, keyed, { method: 'DELETE' });
    expect(deleted.status, path).toBe(200);
  }
  await rm(join(home, 'data', 'media', 'movies'), { recursive: true });
  const removed = await api(
    QBT_PORT,
    '/api/v2/torrents/removeCategories',
    { Authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` },
    {
      method: 'POST',
      body: new URLSearchParams({ categories: 'movies' }).toString(),
      type: 'application/x-www-form-urlencoded',
    },
  );
  expect(removed.status).toBe(200);
  await setPreferences(home, { web_ui_password: OTHER_PASSWORD });
}

/**
 * Give Sonarr's download client a key that isn't qBittorrent's, as a hand-made change
 * would: saved with forceSave, since Sonarr's own test of it fails.
 */
async function wrongSonarrKey(home: string): Promise<void> {
  const store = await readSecretStore(home);
  const keyed = { 'X-Api-Key': store.apps.sonarr?.apiKey ?? '' };
  const [held] = await getJson<Client[]>(SONARR.port, '/api/v3/downloadclient', keyed);
  if (held === undefined) throw new Error('sonarr has no download client');
  const put = await api(
    SONARR.port,
    `/api/v3/downloadclient/${String(held.id)}?forceSave=true`,
    keyed,
    {
      method: 'PUT',
      body: JSON.stringify({
        ...held,
        fields: held.fields.map((f) =>
          f.name === 'apiKey' ? { ...f, value: WRONG_KEY } : f,
        ),
      }),
      type: 'application/json',
    },
  );
  const secrets = [
    WRONG_KEY,
    ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
  ];
  expect(
    put.status,
    `Sonarr did not save the client: ${await servarrFailure(put, secrets)}`,
  ).toBe(202);
}

interface WireActions {
  outcome: string;
  actions: { step: string; resource?: string; detail?: string }[];
}

/** Each wired resource's detail, in order. */
function wired(actions: WireActions['actions']): string[][] {
  return actions
    .filter((a) => a.resource !== undefined)
    .map((a) => [a.resource ?? '', a.detail ?? '']);
}

describe('the download path, behind the VPN', () => {
  it('links Sonarr and Radarr to qBittorrent through Gluetun, from source and from the image', async () => {
    const home = await makeHome();
    const wg = await startWireGuard(PROJECT);
    let deployed: DeployedMediaplane | undefined;
    /**
     * Every removal, each whether or not the one before it worked. Each command is bounded
     * by TEARDOWN_MS (120 s): the test's timeout leaves room for them.
     */
    const removeAll = () =>
      runTeardown([
        () => deployed?.remove() ?? Promise.resolve(),
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        // The deployed Mediaplane joined the wiring network, and went down first so the
        // stack's down could remove it.
        () => expectWiringRemoved(PROJECT),
        () => wg.remove(),
      ]);
    try {
      await writeFile(join(home, 'stack.yaml'), downloadStack(join(home, 'data'), wg));
      await mkdir(join(home, 'secrets'), { mode: 0o700 });
      await writeFile(join(home, 'secrets', 'wg.key'), `${wg.clientPrivateKey}\n`, {
        mode: 0o600,
      });
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

      // From source: qBittorrent first, then the arrs, each linked through Gluetun.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      // qBittorrent's login and settings came with its pre-start file: they are adopted.
      expect(wired(first.actions)).toEqual([
        ['qbittorrent.admin', 'adopted'],
        ['qbittorrent.preferences', 'adopted'],
        ['qbittorrent.category_tv', 'created'],
        ['qbittorrent.category_movies', 'created'],
        ['radarr.admin', 'created'],
        ['radarr.download_client', 'created'],
        ['radarr.root_folder', 'created'],
        ['sonarr.admin', 'created'],
        ['sonarr.download_client', 'created'],
        ['sonarr.root_folder', 'created'],
      ]);
      // Verify tested both download clients through Gluetun, and ran vpn-check's checks.
      expect(first.actions.find((a) => a.step === 'verify')?.detail).toBe(VPN_UP);
      await expectDownloadPath(home);

      // qBittorrent takes the shared password through its API: changed by hand, it comes
      // back, and nothing else changes.
      await setPreferences(home, { web_ui_password: OTHER_PASSWORD });
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'qbittorrent.admin', action: 'update', changes: ['password'] },
      ]);
      expect(restored.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
      await expectDownloadPath(home);
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // From the image, behind the socket proxy. Radarr's link, taken apart by hand, is made
      // again through the proxy: its folder in a throwaway Radarr container, its root folder
      // and download client, qBittorrent's category, and the password. Sonarr's own test
      // refuses the wrong key its client was given, naming it, so the key is set again.
      // Where the host's Compose isn't the image's (CI's is 2.38), it also recreates the
      // apps with bind volumes: the two hash them differently (ADR 0010).
      deployed = await deployMediaplane({ home, stack: PROJECT });
      await undoRadarr(home);
      await wrongSonarrKey(home);
      const inImage = await deployed.mediaplane(['apply', '--yes', '--json']);
      expect(inImage.code, inImage.stdout + inImage.stderr).toBe(0);
      const appliedInImage = JSON.parse(inImage.stdout) as WireActions;
      expect(appliedInImage.outcome).toBe('success');
      expect(wired(appliedInImage.actions)).toEqual([
        ['qbittorrent.admin', 'updated password'],
        ['qbittorrent.preferences', 'unchanged'],
        ['qbittorrent.category_tv', 'unchanged'],
        ['qbittorrent.category_movies', 'created'],
        ['radarr.admin', 'unchanged'],
        ['radarr.download_client', 'created'],
        ['radarr.root_folder', 'created'],
        ['sonarr.admin', 'unchanged'],
        ['sonarr.download_client', 'updated apiKey'],
        ['sonarr.root_folder', 'unchanged'],
      ]);
      expect(appliedInImage.actions.find((a) => a.step === 'verify')?.detail).toBe(
        VPN_UP,
      );
      await expectDownloadPath(home);
      // The image's plan, and its second apply, find nothing to change.
      const planned = await deployed.mediaplane(['plan', '--json']);
      expect(planned.code, planned.stdout + planned.stderr).toBe(0);
      expect(JSON.parse(planned.stdout)).toMatchObject({
        changed: false,
        wiring: WIRED.map((resource) => ({ resource, action: 'unchanged' })),
      });
      const second = await deployed.mediaplane(['apply', '--yes', '--json']);
      expect(second.code, second.stdout + second.stderr).toBe(0);
      expect(JSON.parse(second.stdout)).toMatchObject({ outcome: 'no-changes' });
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is only logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 1_800_000);
});
