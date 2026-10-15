import {
  AppApiError,
  createAppApi,
  planWiring,
  type ResolvedStack,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeContainer,
  fakeHttpApp,
  fakeRuntime,
  fakeStackApis,
  freshAppState,
  wiringStack,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import integration, { PROXY_NAME } from './integration';

const PROWLARR_KEY = '0'.repeat(32);
const SONARR_KEY = '1'.repeat(32);
const RADARR_KEY = '2'.repeat(32);
const KEYS = {
  prowlarr: { apiKey: PROWLARR_KEY },
  sonarr: { apiKey: SONARR_KEY },
  radarr: { apiKey: RADARR_KEY },
};

/** Prowlarr, Sonarr and Radarr, with `more` (Byparr comes with Prowlarr). */
function stack(more = ''): ResolvedStack {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  prowlarr: {}
  sonarr: {}
  radarr: {}
  qbittorrent: { vpn: false }
${more}`,
  );
}

function contextOf(
  resolved: ResolvedStack = stack(),
  keys: WiringContext['keys'] = KEYS,
): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'prowlarr');
  if (app === undefined) throw new Error('no Prowlarr in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys,
  };
}

function resource(name: string): ResourceSpec {
  const spec = integration.resources.find((r) => r.name === name);
  if (spec === undefined) throw new Error(`Prowlarr has no resource ${name}`);
  return spec;
}

const toSonarr = resource('application_sonarr');
const proxy = resource('indexer_proxy');

function wanted(spec: ResourceSpec, ctx: WiringContext = contextOf()) {
  const desired = spec.desired(ctx);
  if (desired === undefined) throw new Error(`${spec.name} is wanted`);
  return desired;
}

/** Prowlarr, faked as fakeStackApis fakes it, Sonarr taking SONARR_KEY, and a client. */
async function prowlarr() {
  const apis = await fakeStackApis();
  const state = freshAppState();
  apis.apps.set('prowlarr', state);
  apis.apps.set('sonarr', { ...freshAppState(), key: SONARR_KEY });
  const api = createAppApi({
    name: 'Prowlarr',
    service: 'prowlarr',
    port: 9696,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: PROWLARR_KEY },
    secrets: [PROWLARR_KEY, SONARR_KEY, RADARR_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, app: apis.app, state, apps: apis.apps };
}

describe("Prowlarr's integration", () => {
  it("links Sonarr and Radarr, after them, and sends indexers through the stack's Cloudflare solver", () => {
    expect(integration.after).toEqual(['radarr', 'sonarr']);
    expect(
      integration.resources.map((r) => [r.name, r.fields, r.secrets, r.requires]),
    ).toEqual([
      ['admin', ['username'], ['password'], undefined],
      [
        'application_sonarr',
        ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
        ['apiKey'],
        ['sonarr.admin'],
      ],
      [
        'application_radarr',
        ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
        ['apiKey'],
        ['radarr.admin'],
      ],
      ['indexer_proxy', ['host', 'requestTimeout', 'tags'], [], undefined],
    ]);
  });
});

describe('a link to Sonarr or Radarr', () => {
  it("syncs fully, each app reaching the other by its service, with the arr's key", () => {
    expect(wanted(toSonarr)).toEqual({
      name: 'Sonarr (Mediaplane)',
      fields: {
        prowlarrUrl: 'http://prowlarr:9696',
        baseUrl: 'http://sonarr:8989',
        syncLevel: 'fullSync',
        syncCategories: '5000,5010,5020,5030,5040,5045,5050,5090',
      },
      secrets: { apiKey: SONARR_KEY },
    });
    expect(wanted(resource('application_radarr'))).toMatchObject({
      name: 'Radarr (Mediaplane)',
      fields: {
        baseUrl: 'http://radarr:7878',
        syncCategories: '2000,2010,2020,2030,2040,2045,2050,2060,2070,2080,2090',
      },
      secrets: { apiKey: RADARR_KEY },
    });
  });

  it("wants none to an arr the stack doesn't run, or whose key isn't stored", () => {
    const withoutRadarr = wiringStack(
      catalog,
      `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  prowlarr: {}
  sonarr: {}
  qbittorrent: { vpn: false }
`,
    );
    expect(resource('application_radarr').desired(contextOf(withoutRadarr))).toBe(
      undefined,
    );
    expect(toSonarr.desired(contextOf(stack(), { prowlarr: KEYS.prowlarr }))).toBe(
      undefined,
    );
  });

  it("is made from Prowlarr's own template, tested as it is saved, and found by its name", async () => {
    const { api, app, state } = await prowlarr();
    expect(await toSonarr.observe(api, undefined)).toBeUndefined();
    expect(await toSonarr.create(api, wanted(toSonarr))).toEqual({ id: 1 });
    const post = app.requests.find((r) => r.method === 'POST');
    expect(post?.path).toBe('/api/v1/applications?forceSave=true');
    expect(JSON.parse(post?.body ?? '{}')).not.toHaveProperty('presets');
    expect(state.applications[0]).toMatchObject({
      name: 'Sonarr (Mediaplane)',
      implementation: 'Sonarr',
      syncLevel: 'fullSync',
    });
    expect(state.applications[0]?.fields).toEqual(
      expect.arrayContaining([
        { name: 'prowlarrUrl', value: 'http://prowlarr:9696' },
        { name: 'baseUrl', value: 'http://sonarr:8989' },
        { name: 'apiKey', value: SONARR_KEY },
        {
          name: 'syncCategories',
          value: [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
        },
        // A setting Mediaplane doesn't manage keeps the template's value.
        { name: 'animeSyncCategories', value: [5070] },
      ]),
    );
    expect(await toSonarr.observe(api, undefined)).toEqual({
      id: 1,
      name: 'Sonarr (Mediaplane)',
      fields: wanted(toSonarr).fields,
    });
  });

  it("checks the arr's key with Prowlarr's own test of the link it holds: a refusal means update", async () => {
    const { api, app, state } = await prowlarr();
    const desired = wanted(toSonarr);
    await toSonarr.create(api, desired);
    const observed = await toSonarr.observe(api, undefined);
    if (observed === undefined) throw new Error('no link observed');
    expect(await toSonarr.verify?.(api, desired, observed)).toBe(true);
    // Tested as Prowlarr holds it: by its id, the key masked.
    const test = app.requests.find((r) => r.path === '/api/v1/applications/test');
    expect(JSON.parse(test?.body ?? '{}')).toMatchObject({ id: 1 });
    expect(test?.body).not.toContain(SONARR_KEY);
    const key = state.applications[0]?.fields.find((f) => f.name === 'apiKey');
    if (key !== undefined) key.value = '9'.repeat(32);
    expect(await toSonarr.verify?.(api, desired, observed)).toBe(false);
    await toSonarr.update(api, desired, observed);
    expect(await toSonarr.verify?.(api, desired, observed)).toBe(true);
  });

  it("says Prowlarr's own words when its test fails for another reason", async () => {
    const { api, state } = await prowlarr();
    const desired = wanted(toSonarr);
    await toSonarr.create(api, desired);
    // Aimed elsewhere by hand: Prowlarr tests a new link as it saves it.
    const [held] = state.applications;
    if (held === undefined) throw new Error('no link made');
    held.fields = held.fields.map((f) =>
      f.name === 'baseUrl' ? { ...f, value: 'http://nowhere:8989' } : f,
    );
    const observed = await toSonarr.observe(api, undefined);
    if (observed === undefined) throw new Error('no link observed');
    const failure = await toSonarr
      .verify?.(api, desired, observed)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect((failure as AppApiError).message).toBe(
      'Prowlarr at http://prowlarr:9696 (127.0.0.1) tested Sonarr (Mediaplane), and it failed: BaseUrl: Unable to complete application test, cannot connect to Sonarr. Resource temporarily unavailable (nowhere:8989) (POST /api/v1/applications/test)',
    );
  });

  it('is tested by plan only once the arr is up and takes its key, and plan never tests the proxy or writes to Prowlarr', async () => {
    // Sonarr is stopped, and apply will start it: Prowlarr's test of the link would fail
    // on Sonarr, not on the link. plan leaves its key unchecked, and warns of nothing.
    const { api, app, apps, state } = await prowlarr();
    await toSonarr.create(api, wanted(toSonarr));
    const tests = () =>
      app.requests.filter((r) => r.path === '/api/v1/applications/test').length;
    // Prowlarr tests a proxy as it makes it, which plan never does: it needs no internet.
    const proxyTests = () =>
      app.requests.filter((r) => r.path === '/api/v1/indexerproxy/test').length;
    const addresses = Object.fromEntries(
      ['prowlarr', 'qbittorrent', 'radarr', 'sonarr'].map((s) => [
        `fake-${s}`,
        '127.0.0.1',
      ]),
    );
    // plan changes nothing in Prowlarr: it only reads there, and asks its test of a link.
    // So it makes no tag, and tests no proxy.
    const plan = async (sonarr: 'running' | 'exited') => {
      const from = app.requests.length;
      const planned = await planWiring({
        stack: stack(),
        // Jellyfin isn't running yet: it is checked after the start.
        current: ['byparr', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr'].map(
          (service) =>
            fakeContainer(service, `fake-${service}`, {
              ...(service === 'sonarr' ? { state: sonarr } : {}),
            }),
        ),
        changing: new Set(sonarr === 'exited' ? ['sonarr'] : []),
        onNetwork: true,
        runtime: fakeRuntime({ addresses }),
        keys: { ...KEYS, qbittorrent: { apiKey: `qbt_${'3'.repeat(28)}` } },
        admin: { username: 'admin', password: 'fake-admin-password' },
        secrets: [PROWLARR_KEY, SONARR_KEY, RADARR_KEY],
        known: {},
        seams: {
          endpoint: () => ({ host: '127.0.0.1', port: app.port }),
          retry: { deadlineMs: 0 },
        },
      });
      const sent = app.requests
        .slice(from)
        .filter((r) => r.headers.host === 'prowlarr:9696')
        .map((r) => `${r.method} ${r.path}`);
      // Checked first: a wrong Host here would make the check below pass on nothing.
      expect(sent.length, 'plan sent Prowlarr nothing').toBeGreaterThan(0);
      expect(
        sent.filter(
          (r) => !r.startsWith('GET ') && r !== 'POST /api/v1/applications/test',
        ),
      ).toEqual([]);
      return planned;
    };
    const stopped = await plan('exited');
    expect(
      stopped.changes.find((c) => c.resource === 'prowlarr.application_sonarr'),
    ).toEqual({ resource: 'prowlarr.application_sonarr', action: 'adopt' });
    expect(stopped.diagnostics).toEqual([]);
    expect(tests()).toBe(0);
    expect(stopped.changes).toContainEqual({
      resource: 'prowlarr.indexer_proxy',
      action: 'create',
    });
    expect(proxyTests()).toBe(0);
    // With Sonarr up and its admin in place, plan asks Prowlarr's own test.
    const sonarr = apps.get('sonarr');
    if (sonarr === undefined) throw new Error('no Sonarr faked');
    sonarr.user = 'admin';
    sonarr.password = 'fake-admin-password';
    expect((await plan('running')).changes).toContainEqual({
      resource: 'prowlarr.application_sonarr',
      action: 'adopt',
    });
    expect(tests()).toBe(1);
    expect(proxyTests()).toBe(0);
    // A proxy that exists and differs is planned as an update, and no more tested.
    await proxy.create(api, wanted(proxy));
    const [held] = state.proxies;
    if (held === undefined) throw new Error('no proxy made');
    held.fields = held.fields.map((f) =>
      f.name === 'host' ? { ...f, value: 'http://flaresolverr:8191/' } : f,
    );
    expect((await plan('running')).changes).toContainEqual({
      resource: 'prowlarr.indexer_proxy',
      action: 'update',
      changes: ['host'],
    });
    expect(proxyTests()).toBe(0);
  });

  it("updates what differs, keeping the settings it doesn't manage", async () => {
    const { api, state } = await prowlarr();
    const desired = wanted(toSonarr);
    await toSonarr.create(api, desired);
    const [held] = state.applications;
    if (held === undefined) throw new Error('no link made');
    held.syncLevel = 'addOnly';
    held.tags = [7];
    held.fields = held.fields.map((f) =>
      f.name === 'syncCategories' ? { ...f, value: [5040, 5000] } : f,
    );
    const observed = await toSonarr.observe(api, undefined);
    expect(observed?.fields).toMatchObject({
      syncLevel: 'addOnly',
      syncCategories: '5000,5040',
    });
    if (observed === undefined) throw new Error('no link observed');
    await toSonarr.update(api, desired, observed);
    expect(state.applications[0]).toMatchObject({ syncLevel: 'fullSync', tags: [7] });
    expect((await toSonarr.observe(api, undefined))?.fields).toEqual(desired.fields);
  });

  it('refuses a Prowlarr that offers no link to the arr, and sends nothing', async () => {
    const app = await fakeHttpApp((request) =>
      request.path === '/api/v1/applications/schema'
        ? { status: 200, body: [{ implementation: 'Lidarr', fields: [] }] }
        : { status: 404 },
    );
    const api = createAppApi({
      name: 'Prowlarr',
      service: 'prowlarr',
      port: 9696,
      endpoint: { host: '127.0.0.1', port: app.port },
      key: { scheme: 'x-api-key', value: PROWLARR_KEY },
      secrets: [PROWLARR_KEY, SONARR_KEY],
      retry: { deadlineMs: 0 },
    });
    const failure = await toSonarr
      .create(api, wanted(toSonarr))
      .catch((thrown: unknown) => thrown);
    expect(failure).toMatchObject({
      kind: 'protocol',
      message:
        'Prowlarr at http://prowlarr:9696 (127.0.0.1) offers no Sonarr application (GET /api/v1/applications/schema)',
    });
    expect(app.requests.map((r) => r.method)).toEqual(['GET']);
  });
});

describe('the indexer proxy', () => {
  it("is the stack's Cloudflare solver, tagged cloudflare: Byparr, or FlareSolverr when you choose it", () => {
    expect(wanted(proxy)).toEqual({
      name: PROXY_NAME,
      fields: { host: 'http://byparr:8191/', requestTimeout: 60, tags: 'cloudflare' },
      secrets: {},
    });
    expect(wanted(proxy, contextOf(stack('  flaresolverr: {}\n'))).fields.host).toBe(
      'http://flaresolverr:8191/',
    );
    expect(proxy.desired(contextOf(stack('  byparr: { enabled: false }\n')))).toBe(
      undefined,
    );
  });

  it('is made with the tag cloudflare, which Prowlarr makes first, and found with its tags by label', async () => {
    const { api, state } = await prowlarr();
    expect(await proxy.observe(api, undefined)).toBeUndefined();
    expect(await proxy.create(api, wanted(proxy))).toEqual({ id: 1 });
    expect(state.tags).toEqual([{ id: 1, label: 'cloudflare' }]);
    expect(state.proxies[0]).toMatchObject({
      name: PROXY_NAME,
      implementation: 'FlareSolverr',
      tags: [1],
    });
    expect(await proxy.observe(api, undefined)).toEqual({
      id: 1,
      name: PROXY_NAME,
      fields: wanted(proxy).fields,
    });
  });

  it('keeps the tag Prowlarr has, and puts back the tags and settings it manages', async () => {
    const { api, state } = await prowlarr();
    state.tags.push({ id: 1, label: 'other' }, { id: 2, label: 'cloudflare' });
    await proxy.create(api, wanted(proxy));
    expect(state.proxies[0]?.tags).toEqual([2]);
    const [held] = state.proxies;
    if (held === undefined) throw new Error('no proxy made');
    held.tags = [2, 1];
    held.fields = held.fields.map((f) =>
      f.name === 'host' ? { ...f, value: 'http://flaresolverr:8191/' } : f,
    );
    const observed = await proxy.observe(api, undefined);
    expect(observed?.fields).toMatchObject({
      host: 'http://flaresolverr:8191/',
      tags: 'cloudflare,other',
    });
    if (observed === undefined) throw new Error('no proxy observed');
    await proxy.update(api, wanted(proxy), observed);
    expect(state.proxies[0]?.tags).toEqual([2]);
    expect((await proxy.observe(api, undefined))?.fields).toEqual(wanted(proxy).fields);
  });
});
