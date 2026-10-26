import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  docker,
  expectWiringRemoved,
  getJson,
  jsonBody,
  makeHome,
  runTeardown,
  servarrFailure,
  stackFor,
  wired,
} from './helpers';
import { startFakeIndexer, type FakeIndexer } from './indexer';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-indexers`;
/** Prowlarr's web UI, on 127.0.0.1. */
const PROWLARR = 9696;
/** What the stack wires, in the order apply wires it: Prowlarr after the arrs. */
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
];
/** Each arr, and its web UI's port. */
const ARRS = [
  { app: 'sonarr', port: 8989 },
  { app: 'radarr', port: 7878 },
] as const;
/** The made-up items the fake indexer knows. */
const ITEMS = ['Mediaplane Test Movie 2026', 'Mediaplane Test Show S01E01'];

/**
 * How the test calls an app: with this key, and every secret the stack stores kept out of
 * what a failure says, since CI's log is public.
 */
interface Access {
  key: string;
  secrets: readonly string[];
}

/**
 * How long a call may wait. Prowlarr gives the solver 60 s (the proxy's request
 * timeout), and a call through it can wait that long: the test waits twice as long.
 */
const TIMEOUT_MS = 120_000;

/** A GET of an app's API, with its key, as JSON, after checking it answered 2xx. */
function get<T>(port: number, path: string, access: Access): Promise<T> {
  return getJson<T>(port, path, { 'X-Api-Key': access.key }, { timeoutMs: TIMEOUT_MS });
}

/** A POST or PUT to an app's API, with its key, of `body` as JSON. */
function send(
  port: number,
  path: string,
  access: Access,
  method: 'POST' | 'PUT',
  body: unknown,
): Promise<Response> {
  return api(
    port,
    path,
    { 'X-Api-Key': access.key },
    {
      method,
      body: JSON.stringify(body),
      type: 'application/json',
      timeoutMs: TIMEOUT_MS,
    },
  );
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

interface Provider {
  id: number;
  name: string;
  implementation: string;
  syncLevel?: string;
  tags: number[];
  fields: { name: string; value?: unknown }[];
}

function settingOf(held: Provider | undefined, name: string): unknown {
  return held?.fields.find((f) => f.name === name)?.value;
}

/** Ask `check` again, each second, until it holds or `seconds` have gone. */
async function eventually(check: () => Promise<boolean>, seconds = 60): Promise<void> {
  for (let tried = 0; tried < seconds && !(await check()); tried++) {
    await new Promise((done) => setTimeout(done, 1000));
  }
}

/**
 * Add a fake indexer in Prowlarr, as you would in its web UI: Generic Torznab, at `feed`,
 * with `tags`. Prowlarr tests it as it saves it: it fetches the feed's caps and a search.
 */
async function addIndexer(
  prowlarr: Access,
  indexer: FakeIndexer,
  name: string,
  feed: string,
  tags: number[],
): Promise<number> {
  const added = await send(PROWLARR, '/api/v1/indexer', prowlarr, 'POST', {
    name,
    implementation: 'Torznab',
    configContract: 'TorznabSettings',
    protocol: 'torrent',
    enable: true,
    appProfileId: 1,
    priority: 25,
    tags,
    fields: [
      { name: 'baseUrl', value: indexer.url },
      { name: 'apiPath', value: feed },
      { name: 'apiKey', value: 'fake-indexer-key' },
    ],
  });
  await expectStatus(added, 201, `Prowlarr did not add ${name}`, prowlarr.secrets);
  return (await jsonBody<{ id: number }>(added, `POST /api/v1/indexer of ${name}`)).id;
}

/** The titles a search of Prowlarr's indexer `id` finds. */
async function searched(prowlarr: Access, id: number): Promise<string[]> {
  const found = await get<{ title: string }[]>(
    PROWLARR,
    `/api/v1/search?query=Mediaplane&type=search&indexerIds=${String(id)}`,
    prowlarr,
  );
  return found.map((release) => release.title).sort();
}

/**
 * What the slice asks of Prowlarr, read back from it: a link to each arr, with full sync,
 * reaching it by its service and port and reached back, which Prowlarr's own test passes,
 * syncing Prowlarr's own categories for that app; and the indexer proxy, tagged
 * cloudflare, aimed at the stack's solver. Returns the tag's id.
 */
async function expectLinks(prowlarr: Access, solver: string): Promise<number> {
  // By name, in code-unit order (as `compare` sorts), whatever order Prowlarr lists them in.
  const links = (await get<Provider[]>(PROWLARR, '/api/v1/applications', prowlarr)).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const templates = await get<Provider[]>(
    PROWLARR,
    '/api/v1/applications/schema',
    prowlarr,
  );
  expect(
    links.map((l) => [
      l.name,
      l.syncLevel,
      settingOf(l, 'baseUrl'),
      settingOf(l, 'prowlarrUrl'),
    ]),
  ).toEqual([
    ['Radarr (Mediaplane)', 'fullSync', 'http://radarr:7878', 'http://prowlarr:9696'],
    ['Sonarr (Mediaplane)', 'fullSync', 'http://sonarr:8989', 'http://prowlarr:9696'],
  ]);
  for (const link of links) {
    const template = templates.find((t) => t.implementation === link.implementation);
    expect(settingOf(link, 'syncCategories'), `${link.name}'s categories`).toEqual(
      settingOf(template, 'syncCategories'),
    );
    // Prowlarr's own test: it calls the arr with the arr's key, and the arr calls it back.
    const tested = await send(
      PROWLARR,
      '/api/v1/applications/test',
      prowlarr,
      'POST',
      link,
    );
    await expectStatus(tested, 200, link.name, prowlarr.secrets);
  }
  const tags = await get<{ id: number; label: string }[]>(
    PROWLARR,
    '/api/v1/tag',
    prowlarr,
  );
  const cloudflare = tags.find((t) => t.label === 'cloudflare');
  if (cloudflare === undefined) throw new Error('Prowlarr has no cloudflare tag');
  const proxies = await get<Provider[]>(PROWLARR, '/api/v1/indexerproxy', prowlarr);
  expect(
    proxies.map((p) => [p.name, p.implementation, settingOf(p, 'host'), p.tags]),
  ).toEqual([
    [
      'Cloudflare (Mediaplane)',
      'FlareSolverr',
      `http://${solver}:8191/`,
      [cloudflare.id],
    ],
  ]);
  return cloudflare.id;
}

/**
 * Give Prowlarr's link to Sonarr a key that isn't Sonarr's, as a hand-made change would:
 * saved with forceSave, since Prowlarr's own test of it fails.
 */
async function wrongSonarrKey(prowlarr: Access): Promise<void> {
  const links = await get<Provider[]>(PROWLARR, '/api/v1/applications', prowlarr);
  const link = links.find((l) => l.name === 'Sonarr (Mediaplane)');
  if (link === undefined) throw new Error('Prowlarr has no link to Sonarr');
  const wrong = '9'.repeat(32);
  const put = await send(
    PROWLARR,
    `/api/v1/applications/${String(link.id)}?forceSave=true`,
    prowlarr,
    'PUT',
    {
      ...link,
      fields: link.fields.map((f) => (f.name === 'apiKey' ? { ...f, value: wrong } : f)),
    },
  );
  await expectStatus(put, 202, 'Prowlarr did not save the link', [
    wrong,
    ...prowlarr.secrets,
  ]);
}

describe('indexers, through Prowlarr', () => {
  it('reach Sonarr and Radarr, through Byparr or FlareSolverr when tagged cloudflare', async () => {
    const home = await makeHome();
    const indexer = await startFakeIndexer(PROJECT);
    /**
     * Every removal, each whether or not the one before it worked. Each command is bounded
     * by TEARDOWN_MS (120 s): the test's timeout leaves room for them.
     */
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
        () => indexer.remove(),
      ]);
    try {
      // The video stack without Seerr: Prowlarr brings Byparr.
      const data = join(home, 'data');
      await writeFile(join(home, 'stack.yaml'), stackFor(data, { seerr: false }));
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

      // Prowlarr links to Sonarr and Radarr after them, and makes its proxy. Its own test
      // of the new proxy has Byparr fetch a page of Prowlarr's own service.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      expect(wired(first.actions).slice(-4)).toEqual([
        ['prowlarr.admin', 'created'],
        ['prowlarr.application_sonarr', 'created'],
        ['prowlarr.application_radarr', 'created'],
        ['prowlarr.indexer_proxy', 'created'],
      ]);
      const store = await readSecretStore(home);
      // Every secret the store holds: each app's, and the shared admin password.
      const secrets = [
        ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
        store.shared?.adminPassword ?? '',
      ];
      const access = (app: string): Access => {
        const key = store.apps[app]?.apiKey ?? '';
        expect(key !== '', `no ${app} key stored`).toBe(true);
        return { key, secrets };
      };
      const prowlarr = access('prowlarr');
      const cloudflare = await expectLinks(prowlarr, 'byparr');
      // resources.json names the links' secret, and never holds it.
      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      for (const arr of ARRS) {
        expect(
          resources.includes(access(arr.app).key),
          `resources.json holds ${arr.app}'s key`,
        ).toBe(false);
      }

      // Two indexers you add in Prowlarr: one open, and one behind a challenge, tagged
      // cloudflare. Prowlarr fetches the second through Byparr's browser, and both reach
      // the arrs, which Prowlarr adds them to.
      await addIndexer(prowlarr, indexer, 'Open indexer', indexer.open, []);
      expect(await indexer.browserVisits()).toBe(0);
      const guarded = await addIndexer(
        prowlarr,
        indexer,
        'Protected indexer',
        indexer.protected,
        [cloudflare],
      );
      expect(await indexer.browserVisits(1), 'browser visits').toBeGreaterThan(0);
      expect(await searched(prowlarr, guarded)).toEqual(ITEMS);
      for (const arr of ARRS) {
        const names = async () =>
          (await get<{ name: string }[]>(arr.port, '/api/v3/indexer', access(arr.app)))
            .map((i) => i.name)
            .sort();
        await eventually(async () => (await names()).length === 2);
        expect(await names(), `${arr.app}'s indexers`).toEqual([
          'Open indexer (Prowlarr)',
          'Protected indexer (Prowlarr)',
        ]);
      }

      // A key in Prowlarr's link to Sonarr that isn't Sonarr's, as a hand-made change
      // would leave it: Prowlarr's own test refuses it, naming it, so apply sets it again.
      await wrongSonarrKey(prowlarr);
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(
        wired(restored.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([['prowlarr.application_sonarr', 'updated apiKey']]);
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // FlareSolverr instead of Byparr: the proxy is aimed at it, and a new indexer
      // behind the challenge goes through FlareSolverr's browser.
      await writeFile(
        join(home, 'stack.yaml'),
        `${stackFor(data, { seerr: false })}  flaresolverr: {}\n`,
      );
      const switched = await apply(options);
      expect(switched.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(switched.outcome).toBe('success');
      expect(
        wired(switched.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([['prowlarr.indexer_proxy', 'updated host']]);
      expect(
        (await runtime.containers())
          .filter((c) => c.service === 'byparr' || c.service === 'flaresolverr')
          .map((c) => `${c.service} ${c.state} ${c.health}`),
      ).toEqual(['flaresolverr running healthy']);
      // Its image declares a volume at /config: a folder of its own is mounted there, so
      // no container of it leaves an anonymous volume behind.
      const mounts = JSON.parse(
        await docker(
          'inspect',
          '--format',
          '{{json .Mounts}}',
          `${PROJECT}-flaresolverr-1`,
        ),
      ) as { Type: string; Source: string; Destination: string }[];
      expect(mounts.filter((m) => m.Type !== 'bind')).toEqual([]);
      expect(mounts.find((m) => m.Destination === '/config')?.Source).toBe(
        join(home, 'appdata', 'flaresolverr'),
      );
      expect(await expectLinks(prowlarr, 'flaresolverr')).toBe(cloudflare);
      const visits = await indexer.browserVisits();
      const second = await addIndexer(
        prowlarr,
        indexer,
        'Protected again',
        indexer.protected,
        [cloudflare],
      );
      expect(await indexer.browserVisits(visits + 1), 'browser visits').toBeGreaterThan(
        visits,
      );
      expect(await searched(prowlarr, second)).toEqual(ITEMS);
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
