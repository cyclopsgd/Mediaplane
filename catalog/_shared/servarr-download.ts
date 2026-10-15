import {
  serviceAddress,
  type DesiredResource,
  type Fields,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';
import {
  numberOf,
  secretOf,
  servarrProvider,
  settingOf,
  textOf,
  type Provider,
  type ProviderKind,
} from './servarr-provider';

/** The name of the download client Mediaplane makes in Sonarr and Radarr (spec §6.2). */
export const DOWNLOAD_CLIENT_NAME = 'qBittorrent (Mediaplane)';

/** Sonarr's and Radarr's qBittorrent download clients. */
const CLIENTS: ProviderKind = {
  path: '/api/v3/downloadclient',
  implementation: 'QBittorrent',
  what: 'qBittorrent download client',
  of: 'qBittorrent',
};
const ROOT_FOLDERS = '/api/v3/rootfolder';

/**
 * The settings a refused sign-in names: the key the arr holds for qBittorrent, or a user
 * name or password, is wrong.
 */
const CREDENTIALS = ['ApiKey', 'Username', 'Password'];

const created = z.looseObject({ id: z.number() });

/** How an arr files its downloads in qBittorrent. */
export interface DownloadLink {
  /** The qBittorrent category (spec §6.2), which `qbittorrent.category_<category>` makes. */
  category: 'tv' | 'movies';
  /** The arr's setting that holds it: Sonarr's tvCategory, Radarr's movieCategory. */
  setting: 'tvCategory' | 'movieCategory';
}

/** The managed fields of a download client, from the app's settings. */
function fieldsOf(held: Provider, link: DownloadLink): Fields {
  return {
    host: textOf(settingOf(held, 'host')),
    port: numberOf(settingOf(held, 'port')),
    useSsl: settingOf(held, 'useSsl') === true,
    category: textOf(settingOf(held, link.setting)),
    enable: held.enable === true,
  };
}

/**
 * The desired settings, with qBittorrent's key in clear: the one place one app's key goes
 * to another, in a request body.
 */
function settingsOf(
  desired: DesiredResource,
  link: DownloadLink,
): Record<string, unknown> {
  return {
    host: desired.fields.host,
    port: desired.fields.port,
    useSsl: desired.fields.useSsl,
    [link.setting]: desired.fields.category,
    apiKey: secretOf(desired, 'apiKey'),
  };
}

/** The client's own properties Mediaplane sets: its name, and whether it is on. */
function topOf(desired: DesiredResource): Record<string, unknown> {
  return { name: desired.name, enable: desired.fields.enable === true };
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
      const at = serviceAddress(
        stack.apps.find((app) => app.def.id === 'qbittorrent'),
        'web',
      );
      const key = keys.qbittorrent?.apiKey;
      if (at === undefined || key === undefined) return undefined;
      return {
        name: DOWNLOAD_CLIENT_NAME,
        fields: {
          host: at.host,
          port: at.port,
          useSsl: false,
          category: link.category,
          enable: true,
        },
        secrets: { apiKey: key },
      };
    },
    ...servarrProvider({
      kind: CLIENTS,
      name: DOWNLOAD_CLIENT_NAME,
      credentials: CREDENTIALS,
      fieldsOf: (held) => fieldsOf(held, link),
      settingsOf: (desired) => settingsOf(desired, link),
      topOf,
    }),
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
