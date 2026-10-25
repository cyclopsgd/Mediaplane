import {
  fieldReader,
  listItems,
  provides,
  SENDS_A_KEY,
  serviceAddress,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';
import { servarrIntegration } from '../_shared/servarr';
import {
  createProvider,
  findProvider,
  secretOf,
  sendsToOf,
  servarrProvider,
  settingOf,
  updateProvider,
  type ProviderKind,
} from '../_shared/servarr-provider';

/**
 * The arrs Prowlarr syncs its indexers to (spec §6.2), each with the categories it syncs:
 * Prowlarr 2.6's own defaults for that app.
 */
export const LINKED = [
  {
    arr: 'sonarr',
    implementation: 'Sonarr',
    categories: [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
  },
  {
    arr: 'radarr',
    implementation: 'Radarr',
    categories: [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090],
  },
] as const;

/** The name of the indexer proxy Mediaplane makes, whichever solver the stack runs. */
export const PROXY_NAME = 'Cloudflare (Mediaplane)';

/** The tag that routes an indexer through the proxy (spec §6.2). */
export const PROXY_TAG = 'cloudflare';

/** Prowlarr's FlareSolverr proxies: Byparr answers as FlareSolverr does. */
const PROXIES: ProviderKind = {
  path: '/api/v1/indexerproxy',
  implementation: 'FlareSolverr',
  what: 'FlareSolverr indexer proxy',
  of: 'FlareSolverr',
};

/** How long Prowlarr gives the solver for a page, in seconds: Prowlarr's own default. */
const REQUEST_TIMEOUT = 60;

const TAGS = '/api/v1/tag';
const HEALTH = '/api/v1/health';
const health = z.array(z.looseObject({ source: z.string(), message: z.string() }));
const tag = z.looseObject({ id: z.number(), label: z.string() });
const tagIds = z.array(z.number());

/** A provider's categories, as one sorted list: "5000,5010". */
function categoriesOf(value: unknown): string {
  const parsed = z.array(z.number()).safeParse(value);
  return parsed.success ? [...parsed.data].sort((a, b) => a - b).join(',') : '';
}

/**
 * Prowlarr's link to Sonarr or Radarr (spec §6.2, an "application"), named
 * "<arr> (Mediaplane)", with full sync: an indexer you add in Prowlarr reaches the arr.
 * - baseUrl is how Prowlarr reaches the arr, and prowlarrUrl how the arr reaches
 *   Prowlarr back, each by its service on the stack's network, at its container port.
 *   Each says where a key goes, so both are fixed (SENDS_A_KEY), and every create, update
 *   and test is sent with the stack's own (`sendsTo`), whatever an override or Prowlarr
 *   holds.
 * - Its secret is the arr's key, checked with Prowlarr's own test of the link it holds,
 *   which calls the arr with it, and has the arr call Prowlarr back: a refused key means
 *   an update, which sets it; any other failure Prowlarr explains.
 * - It is saved with forceSave: Prowlarr still tests a new one as it saves it, so a create
 *   fails while it can't reach the arr. Prowlarr comes after the arrs, so they are up.
 * - It requires the arr's admin, the first thing Mediaplane checks there: while the arr
 *   isn't up, refuses its key, or has its admin yet to be set, `plan` leaves the link's
 *   key unchecked rather than blame the link, and the wire step skips the link when the
 *   arr's admin fails.
 */
function application(link: (typeof LINKED)[number]): ResourceSpec {
  const kind: ProviderKind = {
    path: '/api/v1/applications',
    implementation: link.implementation,
    what: `${link.implementation} application`,
    of: link.implementation,
  };
  const name = `${link.implementation} (Mediaplane)`;
  const settingsOf = (desired: DesiredResource) => ({
    // Where Prowlarr sends the arr's key, and where the arr sends Prowlarr's.
    ...sendsToOf(desired),
    apiKey: secretOf(desired, 'apiKey'),
    syncCategories: listItems(desired.fields.syncCategories).map(Number),
  });
  const topOf = (desired: DesiredResource) => ({
    name: desired.name,
    syncLevel: desired.fields.syncLevel,
  });
  return {
    name: `application_${link.arr}`,
    fields: ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
    lists: ['syncCategories'],
    locked: { prowlarrUrl: SENDS_A_KEY, baseUrl: SENDS_A_KEY },
    refuses: {
      syncCategories: (value) =>
        listItems(value).every((item) => /^\d+$/.test(item))
          ? undefined
          : 'each category Prowlarr syncs is a number, such as 5000, separated by ","',
    },
    secrets: ['apiKey'],
    requires: [`${link.arr}.admin`],
    desired: ({ stack, app, keys }) => {
      const arr = serviceAddress(
        stack.apps.find((a) => a.def.id === link.arr),
        'web',
      );
      const own = serviceAddress(app, 'web');
      const key = keys[link.arr]?.apiKey;
      if (arr === undefined || own === undefined || key === undefined) return undefined;
      const urls = {
        prowlarrUrl: `http://${own.host}:${String(own.port)}`,
        baseUrl: `http://${arr.host}:${String(arr.port)}`,
      };
      return {
        name,
        fields: {
          ...urls,
          syncLevel: 'fullSync',
          syncCategories: categoriesOf(link.categories),
        },
        secrets: { apiKey: key },
        sendsTo: urls,
      };
    },
    ...servarrProvider({
      kind,
      name,
      credentials: ['ApiKey'],
      fieldsOf: (held, read) => ({
        prowlarrUrl: read.text('prowlarrUrl', settingOf(held, 'prowlarrUrl')),
        baseUrl: read.text('baseUrl', settingOf(held, 'baseUrl')),
        syncLevel: read.text('syncLevel', held.syncLevel),
        syncCategories: read.numbers('syncCategories', settingOf(held, 'syncCategories')),
      }),
      settingsOf,
      topOf,
    }),
  };
}

/** The id of the tag `label`: Prowlarr gives back the one it has, or makes it. */
async function tagId(api: AppApi, label: string): Promise<number> {
  return (await api.post(TAGS, { label }, tag)).id;
}

/**
 * The proxy's settings, and its own properties: its name, and its tags' ids, `cloudflare`
 * unless an override names others (`prowlarr.indexer_proxy.tags`).
 */
async function proxyBody(api: AppApi, desired: DesiredResource) {
  const tags: number[] = [];
  for (const label of listItems(desired.fields.tags)) tags.push(await tagId(api, label));
  return {
    settings: {
      ...sendsToOf(desired),
      requestTimeout: desired.fields.requestTimeout,
    },
    top: { name: desired.name, tags },
  };
}

/**
 * Prowlarr's indexer proxy (spec §6.2): the stack's Cloudflare solver, Byparr or
 * FlareSolverr, as a proxy of type FlareSolverr, which both answer, tagged `cloudflare`.
 * Prowlarr sends an indexer through it only when they share a tag, so you tag the indexers
 * Cloudflare protects. Its tags are known by their labels. It holds no secret. Prowlarr
 * tests a new one as it saves it: it has the solver fetch a page of Prowlarr's own
 * service, so the solver needs the internet then.
 */
const indexerProxy: ResourceSpec = {
  name: 'indexer_proxy',
  fields: ['host', 'requestTimeout', 'tags'],
  lists: ['tags'],
  locked: {
    host: "Prowlarr sends your indexers' requests through it, and the keys in them: it is the stack's own solver (spec §11, Slice 6)",
  },
  secrets: [],
  desired: ({ stack }) => {
    const solver = serviceAddress(
      stack.apps.find((a) => provides(a.def, 'cloudflare-solver')),
      'api',
    );
    if (solver === undefined) return undefined;
    return {
      name: PROXY_NAME,
      fields: {
        host: `http://${solver.host}:${String(solver.port)}/`,
        requestTimeout: REQUEST_TIMEOUT,
        tags: PROXY_TAG,
      },
      secrets: {},
      sendsTo: { host: `http://${solver.host}:${String(solver.port)}/` },
    };
  },
  async observe(api, known) {
    const held = await findProvider(api, PROXIES, known, PROXY_NAME);
    if (held === undefined) return undefined;
    const labels = new Map(
      (await api.get(TAGS, z.array(tag))).map((t) => [t.id, t.label]),
    );
    const ids = tagIds.safeParse(held.tags);
    const read = fieldReader();
    return read.observed(held.id, held.name, {
      host: read.text('host', settingOf(held, 'host')),
      requestTimeout: read.number('requestTimeout', settingOf(held, 'requestTimeout')),
      tags: ids.success
        ? ids.data
            .map((id) => labels.get(id) ?? String(id))
            .sort()
            .join(',')
        : read.refuse('tags', 'not a list of tag ids'),
    });
  },
  // Prowlarr's own health check tests its proxies, every six hours (probed): drift reads
  // what it found, and never tests the proxy itself, which would need the internet.
  async health(api) {
    const found = (await api.get(HEALTH, health)).find(
      (item) => item.source === 'IndexerProxyStatusCheck',
    );
    return found === undefined
      ? undefined
      : `Prowlarr's own health check, which runs every six hours, says: ${found.message} (GET ${HEALTH})`;
  },
  async create(api, desired) {
    const { settings, top } = await proxyBody(api, desired);
    return createProvider(api, PROXIES, settings, top);
  },
  async update(api, desired, observed) {
    const { settings, top } = await proxyBody(api, desired);
    await updateProvider(api, PROXIES, observed.id, settings, top);
  },
};

/**
 * What Mediaplane wires in Prowlarr (spec §6.2): the shared admin login, its links to
 * Sonarr and Radarr, which it tests against them, so it comes after them, and the
 * indexer proxy. Indexers stay yours: you add them in Prowlarr, and it syncs them.
 */
export default servarrIntegration(
  'v1',
  ['radarr', 'sonarr'],
  [...LINKED.map(application), indexerProxy],
);
