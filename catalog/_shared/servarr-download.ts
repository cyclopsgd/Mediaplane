import {
  AppApiError,
  fieldReader,
  SENDS_A_KEY,
  serviceAddress,
  type AppApi,
  type DesiredResource,
  type FieldReader,
  type ObservedResource,
  type ResourceSpec,
  type Scalar,
  type VerifyContext,
} from '@mediaplane/engine';
import { z } from 'zod';
import {
  optionalText,
  providerOf,
  secretOf,
  sendsToOf,
  servarrProvider,
  settingOf,
  testProvider,
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
  /**
   * The arr's setting of the category it moves a download to once imported, which
   * Mediaplane doesn't manage: Sonarr's tvImportedCategory, Radarr's
   * movieImportedCategory.
   */
  imported: 'tvImportedCategory' | 'movieImportedCategory';
}

const QBT_CATEGORIES = '/api/v2/torrents/categories';

/**
 * Why plan and drift leave the client's key unchecked, if they do: the arr's own test
 * makes in qBittorrent each category the client names that qBittorrent lacks, with no
 * save path (probed), and they change nothing (spec §5.2). That is its post-import one,
 * which Mediaplane doesn't manage (the owner's decision of 2026-10-17, which this widens
 * in its direction), or its own, once qBittorrent's is no longer Mediaplane's
 * (`unmanaged`) and deleted. (One kept as another, Keep mine, is qBittorrent's category to
 * make, by apply: the client waits for it.) A setting it can't read, or a qBittorrent it
 * can't ask, leaves the key unchecked too. With qBittorrent holding each, undefined: the
 * test is run.
 */
async function testWouldMake(
  api: AppApi,
  link: DownloadLink,
  observed: ObservedResource,
  ctx: VerifyContext,
): Promise<string | undefined> {
  const held = await providerOf(api, CLIENTS, observed.id);
  const named: { setting: string; category: string }[] = [];
  for (const setting of [link.setting, link.imported]) {
    // Unset, the arr leaves a setting out; cleared, it holds "" (probed).
    const category = optionalText(settingOf(held, setting));
    if (category === undefined) {
      return `${api.name}'s download client holds a ${setting} that isn't text, so its own test of it, which could make a category in qBittorrent, isn't run: set ${setting} in ${api.name}, then run drift again`;
    }
    if (category !== '') named.push({ setting, category });
  }
  if (named.length === 0) return undefined;
  const which = (list: typeof named) =>
    list.map(({ setting, category }) => `${category} (${setting})`).join(' and ');
  const cannot = `${api.name}'s own test of its download client would make any of ${which(named)} that qBittorrent lacks, with no save path, so it isn't run while qBittorrent can't be asked which it has`;
  const qbittorrent = ctx.peer('qbittorrent');
  if (qbittorrent === undefined) return `${cannot}: run drift again once it answers`;
  let categories: Record<string, unknown>;
  try {
    categories = await qbittorrent.get(QBT_CATEGORIES, z.record(z.string(), z.unknown()));
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    return `${cannot} (${cause.message}): run drift again once it answers`;
  }
  const missing = named.filter(({ category }) => !Object.hasOwn(categories, category));
  return missing.length === 0
    ? undefined
    : `qBittorrent has no category ${which(missing)}, which ${api.name}'s download client names, and ${api.name}'s own test of it would make it with no save path, so it isn't run: make it in qBittorrent, or name one in ${api.name} that qBittorrent has, then run drift again`;
}

/** The managed fields of a download client, read from the app's settings. */
function fieldsOf(
  held: Provider,
  link: DownloadLink,
  read: FieldReader,
): Record<string, Scalar | undefined> {
  return {
    host: read.text('host', settingOf(held, 'host')),
    port: read.number('port', settingOf(held, 'port')),
    useSsl: read.flag('useSsl', settingOf(held, 'useSsl')),
    category: read.text('category', settingOf(held, link.setting)),
    enable: read.flag('enable', held.enable),
  };
}

/**
 * The desired settings, with qBittorrent's key in clear: the one place one app's key goes
 * to another, in a request body, with where the arr sends it, the stack's own address for
 * qBittorrent (`sendsTo`).
 */
function settingsOf(
  desired: DesiredResource,
  link: DownloadLink,
): Record<string, unknown> {
  return {
    ...sendsToOf(desired),
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
 *   Gluetun's network, at qBittorrent's own port, which its Host check needs, without TLS
 *   or a URL base. The arr sends qBittorrent's key there, so the host, port and TLS are
 *   fixed (SENDS_A_KEY), and every create, update and test is sent there (`sendsTo`),
 *   whatever an override or the arr holds.
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
    locked: { host: SENDS_A_KEY, port: SENDS_A_KEY, useSsl: SENDS_A_KEY },
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
        sendsTo: { host: at.host, port: at.port, useSsl: false, urlBase: '' },
      };
    },
    ...servarrProvider({
      kind: CLIENTS,
      name: DOWNLOAD_CLIENT_NAME,
      credentials: CREDENTIALS,
      fieldsOf: (held, read) => fieldsOf(held, link, read),
      settingsOf: (desired) => settingsOf(desired, link),
      topOf,
    }),
    async verify(api, desired, observed, ctx) {
      if (ctx?.readOnly === true) {
        const unchecked = await testWouldMake(api, link, observed, ctx);
        if (unchecked !== undefined) return { unchecked };
      }
      return testProvider(
        api,
        CLIENTS,
        observed.id,
        desired.name,
        CREDENTIALS,
        sendsToOf(desired),
      );
    },
  };
}

const rootFolder = z.looseObject({
  id: z.number(),
  path: z.string(),
  accessible: z.unknown().optional(),
});

/**
 * A root folder of Sonarr or Radarr (spec §6.2): where its library lives, under the data
 * folder, which the downloads share, so that an import is a hard link. The app needs the
 * folder to exist: the wire step makes it first, and again when the arr says it can't
 * reach it (`accessible`, which the arr reads from the disk each time it is asked:
 * probed). A root folder is known by its path, and the app can't change one (a PUT
 * answers 405), so there is nothing else to update.
 */
export function servarrRootFolder(path: string): ResourceSpec {
  return {
    name: 'root_folder',
    fields: ['path', 'accessible'],
    locked: {
      path: "the arr knows a root folder by its path, and can't move one: another path would add a second root folder beside this one, which holds your library. To move your library, move it in the arr, then stop Mediaplane managing this one with {resource}: unmanaged",
      accessible:
        'the arr says whether it can reach the folder, from the disk: apply makes the folder again',
    },
    secrets: [],
    desired: () => ({
      name: path,
      fields: { path, accessible: true },
      secrets: {},
      folders: [path],
    }),
    async observe(api) {
      const held = (await api.get(ROOT_FOLDERS, z.array(rootFolder))).find(
        (folder) => folder.path.replace(/\/+$/, '') === path,
      );
      if (held === undefined) return undefined;
      const read = fieldReader();
      return read.observed(held.id, path, {
        path,
        accessible: read.flag('accessible', held.accessible),
      });
    },
    async create(api) {
      const made = await api.post(ROOT_FOLDERS, { path }, created);
      return { id: made.id };
    },
    // The wire step made its folder again first, which is all an update can do.
    update: () => Promise.resolve(),
  };
}
