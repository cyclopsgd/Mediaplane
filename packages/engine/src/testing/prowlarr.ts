import type { FakeReply, FakeRequest } from './http';
import type { FakeAppState } from './wiring';

/**
 * One of Prowlarr's providers, as it keeps one: a link to Sonarr or Radarr (an
 * application) or an indexer proxy, with its secrets in clear.
 */
export interface FakeProvider {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
  /** Its tags, by id. */
  tags: number[];
  /** An application's: "fullSync", "addOnly" or "disabled". */
  syncLevel?: string;
}

/** Where the fake apps listen in their containers: what Prowlarr's links must name. */
const PORTS: Readonly<Record<string, number>> = {
  prowlarr: 9696,
  radarr: 7878,
  sonarr: 8989,
};

/** The Cloudflare solvers' services, and the port their API is on. */
const SOLVERS = ['byparr', 'flaresolverr'];
const SOLVER_PORT = 8191;

/**
 * Prowlarr's templates for a link to Sonarr and to Radarr, as `…/schema` gives them, with
 * Prowlarr 2.6's own categories, and one Mediaplane skips.
 */
function applicationTemplates(): (Omit<FakeProvider, 'id'> & { presets: unknown[] })[] {
  const template = (
    implementation: string,
    port: number,
    categories: number[],
    more: FakeProvider['fields'] = [],
  ) => ({
    name: '',
    implementation,
    syncLevel: 'fullSync',
    tags: [],
    presets: [],
    fields: [
      { name: 'prowlarrUrl', value: 'http://localhost:9696' },
      { name: 'baseUrl', value: `http://localhost:${String(port)}` },
      { name: 'apiKey' },
      { name: 'authUsername' },
      { name: 'authPassword' },
      { name: 'syncCategories', value: categories },
      ...more,
    ],
  });
  return [
    template('Lidarr', 8686, [3000, 3010, 3030, 3040, 3050, 3060]),
    template(
      'Radarr',
      7878,
      [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090],
    ),
    template(
      'Sonarr',
      8989,
      [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
      [{ name: 'animeSyncCategories', value: [5070] }],
    ),
  ];
}

/** Prowlarr's templates for an indexer proxy: FlareSolverr's, and one Mediaplane skips. */
function proxyTemplates(): (Omit<FakeProvider, 'id'> & { presets: unknown[] })[] {
  return [
    {
      name: '',
      implementation: 'FlareSolverr',
      tags: [],
      presets: [],
      fields: [
        { name: 'host', value: 'http://localhost:8191/' },
        { name: 'requestTimeout', value: 60 },
      ],
    },
    {
      name: '',
      implementation: 'Http',
      tags: [],
      presets: [],
      fields: [{ name: 'host' }, { name: 'port', value: 0 }],
    },
  ];
}

/** A provider as Prowlarr shows it: its key masked. */
function masked(held: FakeProvider): FakeProvider {
  return {
    ...held,
    fields: held.fields.map((f) =>
      f.name === 'apiKey' && f.value !== undefined ? { ...f, value: '********' } : f,
    ),
  };
}

/** A refusal of Prowlarr's own test, as its validation list says it. */
function refused(property: string, message: string): FakeReply & { status: 400 } {
  return {
    status: 400,
    body: [{ propertyName: property, errorMessage: message, isWarning: false }],
  };
}

/** "host:port" of a URL a test is given, as Prowlarr's messages name it. */
function hostOf(url: unknown): { host: string; port: number; at: string } {
  const parsed = /^https?:\/\/([^:/]+):(\d+)\/?$/.exec(String(url));
  const host = parsed?.[1] ?? '';
  const port = Number(parsed?.[2] ?? 0);
  return { host, port, at: `${host}:${String(port)}` };
}

/**
 * Prowlarr's test of a link to Sonarr or Radarr, `sent` holding `key` in clear: its
 * refusal, or undefined when it passes. As Prowlarr's does, it reaches the arr at
 * `baseUrl`, by its service and port, with `key`, which must be the arr's `key` when that
 * is set; and the arr reaches Prowlarr back at `prowlarrUrl`.
 */
function testApplication(
  sent: Pick<FakeProvider, 'implementation' | 'fields'>,
  key: unknown,
  stateOf: (service: string) => FakeAppState,
): (FakeReply & { status: 400 }) | undefined {
  const value = (name: string) => sent.fields.find((f) => f.name === name)?.value;
  const arr = sent.implementation.toLowerCase();
  const base = hostOf(value('baseUrl'));
  if (base.host !== arr || base.port !== PORTS[arr]) {
    const why =
      base.host === arr ? 'Connection refused' : 'Resource temporarily unavailable';
    return refused(
      'BaseUrl',
      `Unable to complete application test, cannot connect to ${sent.implementation}. ${why} (${base.at})`,
    );
  }
  const expected = stateOf(arr).key;
  if (typeof key !== 'string' || key === '' || (expected !== '' && key !== expected)) {
    return refused('ApiKey', 'API Key is invalid');
  }
  const back = hostOf(value('prowlarrUrl'));
  if (back.host !== 'prowlarr' || back.port !== PORTS.prowlarr) {
    return refused(
      'ProwlarrUrl',
      `Prowlarr URL is invalid, ${sent.implementation} cannot connect to Prowlarr`,
    );
  }
  return undefined;
}

/**
 * Prowlarr's test of an indexer proxy: undefined when its host is a Cloudflare solver of
 * the stack, at its API's port, as Prowlarr reaches one; otherwise its refusal.
 */
function testProxy(
  sent: Pick<FakeProvider, 'fields'>,
): (FakeReply & { status: 400 }) | undefined {
  const host = hostOf(sent.fields.find((f) => f.name === 'host')?.value);
  return SOLVERS.includes(host.host) && host.port === SOLVER_PORT
    ? undefined
    : refused(
        'Host',
        `Unable to connect to proxy: Resource temporarily unavailable (${host.at}). Check the log surrounding this error for details`,
      );
}

/**
 * One kind of Prowlarr's providers at `path`, kept in `held`: listed, read and updated by
 * id (an update with forceSave isn't tested), made from `templates` (tested as it is
 * saved, with forceSave too, and refused under a name already taken), and tested by
 * `test`, with a masked key standing for the one held.
 */
function fakeProviders(
  request: FakeRequest,
  path: string,
  held: FakeProvider[],
  templates: () => unknown[],
  test: (sent: FakeProvider, key: unknown) => (FakeReply & { status: 400 }) | undefined,
): FakeReply | undefined {
  const { method } = request;
  if (request.path === `${path}/schema`) return { status: 200, body: templates() };
  if (request.path === path && method === 'GET') {
    return { status: 200, body: held.map(masked) };
  }
  const keyOf = (sent: FakeProvider) => {
    const key = sent.fields.find((f) => f.name === 'apiKey')?.value;
    const stored = held
      .find((p) => p.id === sent.id)
      ?.fields.find((f) => f.name === 'apiKey')?.value;
    return key === '********' ? stored : key;
  };
  const one = new RegExp(`^${path}/(\\d+)(\\?forceSave=true)?$`).exec(request.path);
  const found = held.find((p) => p.id === Number(one?.[1]));
  if (one !== null && method === 'GET') {
    return found === undefined ? { status: 404 } : { status: 200, body: masked(found) };
  }
  if (request.path === `${path}?forceSave=true` && method === 'POST') {
    const sent = { tags: [], ...JSON.parse(request.body) } as FakeProvider;
    if (held.some((p) => p.name === sent.name)) {
      return {
        status: 400,
        body: [{ propertyName: 'Name', errorMessage: 'Should be unique' }],
      };
    }
    const failed = test(sent, keyOf(sent));
    if (failed !== undefined) return failed;
    const made = { ...sent, id: held.length + 1 };
    held.push(made);
    return { status: 201, body: masked(made) };
  }
  if (one?.[2] !== undefined && method === 'PUT' && found !== undefined) {
    const sent = JSON.parse(request.body) as FakeProvider;
    const key = found.fields.find((f) => f.name === 'apiKey')?.value;
    Object.assign(found, {
      ...sent,
      fields: sent.fields.map((f) =>
        f.name === 'apiKey' && f.value === '********' ? { ...f, value: key } : f,
      ),
    });
    return { status: 202, body: masked(found) };
  }
  if (request.path === `${path}/test` && method === 'POST') {
    const sent = JSON.parse(request.body) as FakeProvider;
    return test(sent, keyOf(sent)) ?? { status: 200, body: {} };
  }
  return undefined;
}

/**
 * Prowlarr's links to Sonarr and Radarr, its indexer proxies and its tags, as
 * fakeStackApis answers them, as Prowlarr 2.6 does. A tag's label is kept lower-case,
 * and asking for one it has gives that one back.
 */
export function fakeProwlarr(
  request: FakeRequest,
  state: FakeAppState,
  stateOf: (service: string) => FakeAppState,
): FakeReply | undefined {
  const answered =
    fakeProviders(
      request,
      '/api/v1/applications',
      state.applications,
      applicationTemplates,
      (sent, key) => testApplication(sent, key, stateOf),
    ) ??
    fakeProviders(
      request,
      '/api/v1/indexerproxy',
      state.proxies,
      proxyTemplates,
      testProxy,
    );
  if (answered !== undefined) return answered;
  if (request.path === '/api/v1/tag' && request.method === 'GET') {
    return { status: 200, body: state.tags };
  }
  if (request.path === '/api/v1/tag' && request.method === 'POST') {
    const label = (JSON.parse(request.body) as { label: string }).label.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(label)) {
      return refused('Label', 'Allowed characters a-z, 0-9 and -');
    }
    const known = state.tags.find((t) => t.label === label);
    if (known !== undefined) return { status: 201, body: known };
    const made = { id: state.tags.length + 1, label };
    state.tags.push(made);
    return { status: 201, body: made };
  }
  return undefined;
}
