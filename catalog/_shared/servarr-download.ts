import {
  AppApiError,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';

/** The name of the download client Mediaplane makes in Sonarr and Radarr (spec §6.2). */
export const DOWNLOAD_CLIENT_NAME = 'qBittorrent (Mediaplane)';

const CLIENTS = '/api/v3/downloadclient';
const ROOT_FOLDERS = '/api/v3/rootfolder';

/** The settings a refused sign-in names: Sonarr's key, or a user name or password, is wrong. */
const CREDENTIALS = new Set(['ApiKey', 'Username', 'Password']);

/** One setting of a Servarr provider; the rest of it goes back as it came. */
const setting = z.looseObject({ name: z.string(), value: z.unknown().optional() });

/**
 * A download client as Sonarr or Radarr gives it, its key masked as "********". The rest
 * of it goes back as it came, so a setting Mediaplane doesn't manage stays the user's.
 */
const client = z.looseObject({
  id: z.number(),
  name: z.string(),
  enable: z.boolean(),
  implementation: z.string(),
  fields: z.array(setting),
});

/** One of the app's templates for a new download client (`…/schema`). */
const template = z.looseObject({ implementation: z.string(), fields: z.array(setting) });

const created = z.looseObject({ id: z.number() });

/** How an arr files its downloads in qBittorrent. */
export interface DownloadLink {
  /** The qBittorrent category (spec §6.2), which `qbittorrent.category_<category>` makes. */
  category: 'tv' | 'movies';
  /** The arr's setting that holds it: Sonarr's tvCategory, Radarr's movieCategory. */
  setting: 'tvCategory' | 'movieCategory';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The managed fields of a download client, from the app's settings. */
function fieldsOf(held: z.infer<typeof client>, link: DownloadLink) {
  const value = (name: string) => held.fields.find((f) => f.name === name)?.value;
  const port = value('port');
  return {
    host: text(value('host')),
    port: typeof port === 'number' ? port : 0,
    useSsl: value('useSsl') === true,
    category: text(value(link.setting)),
    enable: held.enable,
  };
}

/**
 * `body` with the desired settings, and qBittorrent's key in clear: the one place one
 * app's key goes to another, in a request body. A setting the app doesn't have means a
 * version Mediaplane doesn't know: say so, rather than save a client that can't work.
 */
function withSettings<T extends { fields: z.infer<typeof setting>[] }>(
  api: AppApi,
  body: T,
  desired: DesiredResource,
  link: DownloadLink,
): T & { name: string; enable: boolean } {
  const key = desired.secrets.apiKey;
  if (key === undefined) throw new Error(`${desired.name} has no apiKey to send`);
  const values: Record<string, unknown> = {
    host: desired.fields.host,
    port: desired.fields.port,
    useSsl: desired.fields.useSsl,
    [link.setting]: desired.fields.category,
    apiKey: key,
  };
  const missing = Object.keys(values).filter(
    (name) => !body.fields.some((f) => f.name === name),
  );
  if (missing.length > 0) {
    throw new AppApiError(
      `${api.name} at ${api.where} has no ${missing.join(', ')} setting for qBittorrent, which Mediaplane needs (GET ${CLIENTS})`,
      { kind: 'protocol' },
    );
  }
  return {
    ...body,
    name: desired.name,
    enable: desired.fields.enable === true,
    fields: body.fields.map((f) =>
      Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f,
    ),
  };
}

/**
 * qBittorrent as the download client of Sonarr or Radarr (spec §6.2), named
 * DOWNLOAD_CLIENT_NAME, filing its downloads under `link.category`. It needs that category
 * in place first: Sonarr's own test makes a missing one, with no save path.
 * - Its host is how the arr reaches qBittorrent: through Gluetun when qBittorrent shares
 *   Gluetun's network, at qBittorrent's own port, which its Host check needs.
 * - Its key is checked with the app's own test of the client it holds, as it holds it
 *   (the key masked): a refused sign-in means the key differs, and an update sets it.
 *   Any other failure, such as qBittorrent out of the arr's reach, the app explains.
 * - It is saved with forceSave. The app then skips its test of an update, which is saved
 *   even while qBittorrent is down: the check says whether it works. It still tests a
 *   new client, skipping only the warnings, so a create fails while it can't reach
 *   qBittorrent.
 */
export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
  return {
    name: 'download_client',
    fields: ['host', 'port', 'useSsl', 'category', 'enable'],
    secrets: ['apiKey'],
    requires: [`qbittorrent.category_${link.category}`],
    desired: ({ stack, keys }) => {
      const qbittorrent = stack.apps.find((app) => app.def.id === 'qbittorrent');
      const port = qbittorrent?.containerPorts.web;
      const key = keys.qbittorrent?.apiKey;
      if (qbittorrent === undefined || port === undefined || key === undefined) {
        return undefined;
      }
      return {
        name: DOWNLOAD_CLIENT_NAME,
        fields: {
          host: qbittorrent.networkVia ?? qbittorrent.def.id,
          port,
          useSsl: false,
          category: link.category,
          enable: true,
        },
        secrets: { apiKey: key },
      };
    },
    async observe(api, known) {
      const clients = (await api.get(CLIENTS, z.array(client))).filter(
        (c) => c.implementation === 'QBittorrent',
      );
      const held =
        clients.find((c) => known !== undefined && c.id === known.id) ??
        clients.find((c) => c.name === DOWNLOAD_CLIENT_NAME);
      return held === undefined
        ? undefined
        : { id: held.id, name: held.name, fields: fieldsOf(held, link) };
    },
    async verify(api, _desired, observed) {
      const held = await api.get(`${CLIENTS}/${String(observed.id)}`, client);
      const result = await api.test(`${CLIENTS}/test`, held);
      if (result.passed) return true;
      if (result.failures.some((f) => CREDENTIALS.has(f.property))) return false;
      const said = result.failures
        .map((f) => (f.property === '' ? f.message : `${f.property}: ${f.message}`))
        .join('; ');
      throw new AppApiError(
        `${api.name} at ${api.where} tested ${DOWNLOAD_CLIENT_NAME}, and it failed: ${said} (POST ${CLIENTS}/test)`,
        { kind: 'rejected', status: 400 },
      );
    },
    async create(api, desired) {
      const offered = (await api.get(`${CLIENTS}/schema`, z.array(template))).find(
        (t) => t.implementation === 'QBittorrent',
      );
      if (offered === undefined) {
        throw new AppApiError(
          `${api.name} at ${api.where} offers no qBittorrent download client (GET ${CLIENTS}/schema)`,
          { kind: 'protocol' },
        );
      }
      // Its presets are the UI's, not part of a client.
      const { presets, ...body } = offered;
      const made = await api.post(
        `${CLIENTS}?forceSave=true`,
        withSettings(api, body, desired, link),
        created,
      );
      return { id: made.id };
    },
    async update(api, desired, observed) {
      const path = `${CLIENTS}/${String(observed.id)}`;
      const held = await api.get(path, client);
      await api.put(`${path}?forceSave=true`, withSettings(api, held, desired, link));
    },
  };
}

const rootFolder = z.looseObject({ id: z.number(), path: z.string() });

/**
 * A root folder of Sonarr or Radarr (spec §6.2): where its library lives, under the data
 * folder, which the downloads share, so that an import is a hard link. The app needs the
 * folder to exist: the wire step makes it first. A root folder is known by its path, and
 * the app can't change one (a PUT answers 405), so a found one is always as wanted.
 */
export function servarrRootFolder(path: string): ResourceSpec {
  return {
    name: 'root_folder',
    fields: ['path'],
    secrets: [],
    desired: () => ({ name: path, fields: { path }, secrets: {}, folders: [path] }),
    async observe(api) {
      const held = (await api.get(ROOT_FOLDERS, z.array(rootFolder))).find(
        (folder) => folder.path.replace(/\/+$/, '') === path,
      );
      return held === undefined
        ? undefined
        : { id: held.id, name: path, fields: { path } };
    },
    async create(api) {
      const made = await api.post(ROOT_FOLDERS, { path }, created);
      return { id: made.id };
    },
    // Found by its path, it never differs from the one wanted: there is nothing to update.
    update: () => Promise.resolve(),
  };
}
