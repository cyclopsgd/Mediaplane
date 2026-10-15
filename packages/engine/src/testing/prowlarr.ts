import type { FakeReply, FakeRequest } from './http';
import {
  fakeProviders,
  fieldValue,
  refusal,
  type FakeProviderBase,
  type FakeRefusal,
} from './providers';
import type { FakeAppState } from './wiring';

/**
 * One of Prowlarr's providers, as it keeps one: a link to Sonarr or Radarr (an
 * application) or an indexer proxy, with its secrets in clear.
 */
export interface FakeProvider extends FakeProviderBase {
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

/**
 * What a URL a test is given names, as Prowlarr's messages name it: "host:port", and
 * whether it asks for TLS, which none of these apps serves on those ports.
 */
function hostOf(url: unknown): { host: string; port: number; at: string; tls: boolean } {
  const parsed = /^(https?):\/\/([^:/]+):(\d+)\/?$/.exec(String(url));
  const host = parsed?.[2] ?? '';
  const port = Number(parsed?.[3] ?? 0);
  return { host, port, at: `${host}:${String(port)}`, tls: parsed?.[1] === 'https' };
}

/**
 * Prowlarr's test of a link to Sonarr or Radarr, `sent` holding `key` in clear: its
 * refusal, or undefined when it passes. As Prowlarr's does, it reaches the arr at
 * `baseUrl`, by its service and port, over plain HTTP, while the arr is up, with `key`,
 * which must be the arr's `key` when that is set; and the arr reaches Prowlarr back at
 * `prowlarrUrl`.
 */
function testApplication(
  sent: Pick<FakeProvider, 'implementation' | 'fields'>,
  key: unknown,
  peek: (service: string) => FakeAppState,
): FakeRefusal | undefined {
  const value = (name: string) => fieldValue(sent, name);
  const arr = sent.implementation.toLowerCase();
  const base = hostOf(value('baseUrl'));
  const named = base.host === arr && base.port === PORTS[arr] && !base.tls;
  // A stopped arr is nowhere to be found, as a host that isn't one.
  if (!named || !peek(arr).up) {
    const why =
      base.host === arr && !named
        ? 'Connection refused'
        : 'Resource temporarily unavailable';
    return refusal(
      'BaseUrl',
      `Unable to complete application test, cannot connect to ${sent.implementation}. ${why} (${base.at})`,
    );
  }
  const expected = peek(arr).key;
  if (typeof key !== 'string' || key === '' || (expected !== '' && key !== expected)) {
    return refusal('ApiKey', 'API Key is invalid');
  }
  const back = hostOf(value('prowlarrUrl'));
  if (back.host !== 'prowlarr' || back.port !== PORTS.prowlarr || back.tls) {
    return refusal(
      'ProwlarrUrl',
      `Prowlarr URL is invalid, ${sent.implementation} cannot connect to Prowlarr`,
    );
  }
  return undefined;
}

/**
 * Prowlarr's test of an indexer proxy: undefined when its host is a Cloudflare solver that
 * runs, at its API's port, over plain HTTP, as Prowlarr reaches one; otherwise its
 * refusal. A solver "runs" while its state is up: the fakes know no more of the stack than
 * that, so a test that means the stack doesn't run one sets its `up` to false.
 */
function testProxy(
  sent: Pick<FakeProvider, 'fields'>,
  peek: (service: string) => FakeAppState,
): FakeRefusal | undefined {
  const host = hostOf(fieldValue(sent, 'host'));
  const reached = SOLVERS.includes(host.host) && host.port === SOLVER_PORT && !host.tls;
  return reached && peek(host.host).up
    ? undefined
    : refusal(
        'Host',
        `Unable to connect to proxy: Resource temporarily unavailable (${host.at}). Check the log surrounding this error for details`,
      );
}
/**
 * Prowlarr's links to Sonarr and Radarr, its indexer proxies and its tags, as
 * fakeStackApis answers them, as Prowlarr 2.6 does. A tag's label is kept lower-case,
 * and asking for one it has gives that one back. Its tests read the other apps through
 * `peek`, which gives an app it doesn't hold as it first starts, and holds it nowhere.
 */
export function fakeProwlarr(
  request: FakeRequest,
  state: FakeAppState,
  peek: (service: string) => FakeAppState,
): FakeReply | undefined {
  const answered =
    fakeProviders(request, {
      path: '/api/v1/applications',
      held: state.applications,
      templates: applicationTemplates,
      test: (sent, key) => testApplication(sent, key, peek),
      defaults: { tags: [] },
    }) ??
    fakeProviders(request, {
      path: '/api/v1/indexerproxy',
      held: state.proxies,
      templates: proxyTemplates,
      test: (sent) => testProxy(sent, peek),
      defaults: { tags: [] },
    });
  if (answered !== undefined) return answered;
  if (request.path === '/api/v1/tag' && request.method === 'GET') {
    return { status: 200, body: state.tags };
  }
  if (request.path === '/api/v1/tag' && request.method === 'POST') {
    const label = (JSON.parse(request.body) as { label: string }).label.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(label)) {
      return refusal('Label', 'Allowed characters a-z, 0-9 and -');
    }
    const known = state.tags.find((t) => t.label === label);
    if (known !== undefined) return { status: 201, body: known };
    const made = { id: state.tags.length + 1, label };
    state.tags.push(made);
    return { status: 201, body: made };
  }
  return undefined;
}
