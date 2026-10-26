import {
  defineIntegration,
  fieldReader,
  isUnmanaged,
  SHARED_LOGIN,
  type AppApi,
  type DesiredResource,
  type ResolvedStack,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';
import { secretOf } from '../_shared/secret';
import { categoryProblem } from '../_shared/servarr-download';

/** Where qBittorrent saves a torrent without a category (spec §6.2). */
export const DEFAULT_SAVE_PATH = '/data/torrents';

/**
 * The category each arr files its torrents under (spec §6.2), made while that arr is in
 * the stack: `name`, unless the arr's download client is kept with another (categoryOf).
 * Its save path is DEFAULT_SAVE_PATH/<category>.
 */
export const CATEGORIES = [
  { arr: 'sonarr', name: 'tv' },
  { arr: 'radarr', name: 'movies' },
] as const;

const PREFERENCES = '/api/v2/app/preferences';
const SET_PREFERENCES = '/api/v2/app/setPreferences';
const CATEGORIES_PATH = '/api/v2/torrents/categories';
const TORRENTS_PATH = '/api/v2/torrents/info';

/**
 * What Mediaplane reads of qBittorrent's preferences, each read with a FieldReader. They
 * hold its API key too: z.object drops every other field, so nothing else is kept.
 */
const preferences = z.object({
  web_ui_username: z.unknown(),
  save_path: z.unknown(),
  auto_tmm_enabled: z.unknown(),
  bypass_auth_subnet_whitelist_enabled: z.unknown(),
  bypass_auth_subnet_whitelist: z.unknown(),
});

/** qBittorrent's categories, by name. */
const categories = z.record(z.string(), z.looseObject({ savePath: z.unknown() }));

/** A path as qBittorrent gives it back: without a trailing "/". */
function asKept(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Subnets as one comma-separated list, with no space: qBittorrent answers with one per
 * line, and would keep a space as part of the next subnet.
 */
function subnetList(list: string): string {
  return list
    .split(/[\s,]+/)
    .filter((subnet) => subnet !== '')
    .join(',');
}

/** Set qBittorrent's preferences: a JSON object in a form's `json` field, with the key. */
async function setPreferences(
  api: AppApi,
  values: Readonly<Record<string, unknown>>,
  secrets: readonly string[] = [],
): Promise<void> {
  await api.form(SET_PREFERENCES, { json: JSON.stringify(values) }, { secrets });
}

/**
 * The shared admin login (spec §6.1), after qBittorrent's first start: its user name is a
 * managed field and its password a secret, checked by signing in with it. Both are set
 * through its preferences with the key, which needs neither the old password nor a
 * restart.
 */
const admin: ResourceSpec = {
  name: 'admin',
  fields: ['username'],
  locked: { username: SHARED_LOGIN },
  secrets: ['password'],
  ownAdmin: true,
  desired: ({ admin: login }) => ({
    name: 'admin',
    fields: { username: login.username },
    secrets: { password: login.password },
  }),
  async observe(api) {
    const held = await api.get(PREFERENCES, preferences);
    const read = fieldReader();
    return read.observed(null, 'admin', {
      username: read.text('username', held.web_ui_username),
    });
  },
  async verify(api, desired) {
    // A 2xx signs in (204 in qBittorrent 5); 401 is a wrong user name or password. After
    // five of those in a row, qBittorrent bans this address from signing in (403), for an
    // hour by default, which the client throws: the ban says nothing of the password.
    const signedIn = await api.login(
      '/api/v2/auth/login',
      {
        username: String(desired.fields.username),
        password: secretOf(desired, 'password'),
      },
      { answers: [401] },
    );
    return signedIn.status >= 200 && signedIn.status < 300;
  },
  async create(api, desired) {
    await saveAdmin(api, desired);
    return { id: null };
  },
  update: (api, desired) => saveAdmin(api, desired),
};

async function saveAdmin(api: AppApi, desired: DesiredResource): Promise<void> {
  const password = secretOf(desired, 'password');
  await setPreferences(
    api,
    { web_ui_username: desired.fields.username, web_ui_password: password },
    [password],
  );
}

/**
 * Why who may skip qBittorrent's login can't be kept (`locked`): it is stack.yaml's
 * security setting, which every app's login follows.
 */
const LOGIN_ON_LAN =
  "it says who may skip qBittorrent's login, a security setting: set security.login_on_lan in stack.yaml instead";

/**
 * The settings Mediaplane manages in qBittorrent (spec §6.1, §6.2): the default save path,
 * Automatic Torrent Management (so a torrent follows its category's save path), and who
 * may skip the login: the LAN subnets, only with `security.login_on_lan: false` and the
 * web UI published on the LAN, as the pre-start file sets them.
 */
const settings: ResourceSpec = {
  name: 'preferences',
  fields: ['savePath', 'autoTmm', 'authSubnetWhitelistEnabled', 'authSubnetWhitelist'],
  lists: ['authSubnetWhitelist'],
  locked: {
    authSubnetWhitelistEnabled: LOGIN_ON_LAN,
    authSubnetWhitelist: LOGIN_ON_LAN,
  },
  secrets: [],
  desired: ({ stack, app }) => {
    const whitelist = stack.config.security.login_on_lan
      ? []
      : app.context.lanClientSubnets;
    return {
      name: 'preferences',
      fields: {
        savePath: DEFAULT_SAVE_PATH,
        autoTmm: true,
        authSubnetWhitelistEnabled: whitelist.length > 0,
        authSubnetWhitelist: subnetList(whitelist.join(',')),
      },
      secrets: {},
    };
  },
  async observe(api) {
    const held = await api.get(PREFERENCES, preferences);
    const read = fieldReader();
    const whitelist = read.text('authSubnetWhitelist', held.bypass_auth_subnet_whitelist);
    return read.observed(null, 'preferences', {
      savePath: asKept(read.text('savePath', held.save_path)),
      autoTmm: read.flag('autoTmm', held.auto_tmm_enabled),
      authSubnetWhitelistEnabled: read.flag(
        'authSubnetWhitelistEnabled',
        held.bypass_auth_subnet_whitelist_enabled,
      ),
      authSubnetWhitelist: whitelist === undefined ? undefined : subnetList(whitelist),
    });
  },
  async create(api, desired) {
    await saveSettings(api, desired);
    return { id: null };
  },
  update: (api, desired) => saveSettings(api, desired),
};

/** Each value with the type qBittorrent expects: it ignores a wrong one, or misreads it. */
async function saveSettings(api: AppApi, desired: DesiredResource): Promise<void> {
  const { fields } = desired;
  await setPreferences(api, {
    save_path: String(fields.savePath),
    auto_tmm_enabled: fields.autoTmm === true,
    bypass_auth_subnet_whitelist_enabled: fields.authSubnetWhitelistEnabled === true,
    bypass_auth_subnet_whitelist: String(fields.authSubnetWhitelist),
  });
}

/**
 * The category `arr`'s download client files under: `name`, or the one it is kept with
 * (`<arr>.download_client.category`, Keep mine), so that qBittorrent has the category the
 * client names, made by apply. Otherwise the arr's own test of the client would make it,
 * with no save path, which plan and drift never let it do.
 */
function categoryOf(stack: ResolvedStack, arr: string, name: string): string {
  const kept = stack.config.overrides[`${arr}.download_client.category`];
  // Plan refuses one that isn't a category name (categoryProblem): only a guard.
  return typeof kept === 'string' &&
    categoryProblem(kept) === undefined &&
    !isUnmanaged(stack, `${arr}.download_client`)
    ? kept
    : name;
}

/**
 * The category `name` (spec §6.2), or the one `arr`'s download client is kept with
 * (categoryOf), with its save path under DEFAULT_SAVE_PATH, while `arr` is in the stack.
 * qBittorrent knows a category by its name: it gives it no id. One Mediaplane made before
 * under another name stays as it is, yours. Once `arr` leaves the stack, apply removes it,
 * unless it holds a torrent.
 */
function category(arr: string, name: string): ResourceSpec {
  const save = (api: AppApi, path: string, desired: DesiredResource) =>
    api.form(path, {
      category: desired.name,
      savePath: String(desired.fields.savePath),
    });
  return {
    name: `category_${name}`,
    fields: ['savePath'],
    secrets: [],
    desired: ({ stack }) => {
      if (!stack.apps.some((app) => app.def.id === arr)) return undefined;
      const wanted = categoryOf(stack, arr, name);
      return {
        name: wanted,
        fields: { savePath: `${DEFAULT_SAVE_PATH}/${wanted}` },
        secrets: {},
      };
    },
    // By the name the stack wants, or, for one it no longer wants, the name it was made
    // with, which its record keeps (a category kept as another, whose arr left).
    async observe(api, known, desired) {
      const named = desired?.name ?? known?.name ?? name;
      const held = (await api.get(CATEGORIES_PATH, categories))[named];
      if (held === undefined) return undefined;
      const read = fieldReader();
      return read.observed(named, named, {
        savePath: asKept(read.text('savePath', held.savePath)),
      });
    },
    async create(api, desired) {
      await save(api, '/api/v2/torrents/createCategory', desired);
      return { id: desired.name };
    },
    async update(api, desired) {
      await save(api, '/api/v2/torrents/editCategory', desired);
    },
    // Removing a category takes it from its torrents, and Automatic Torrent Management
    // then moves their files to the default save path (probed): they are yours, so a
    // category that holds any stays.
    async cannotRemove(api, observed) {
      const held = await api.get(
        `${TORRENTS_PATH}?category=${encodeURIComponent(observed.name)}`,
        z.array(z.unknown()),
      );
      if (held.length === 0) return undefined;
      const many = held.length === 1 ? 'a torrent' : `${String(held.length)} torrents`;
      return `it holds ${many}, which removing it would move to ${DEFAULT_SAVE_PATH}: move ${held.length === 1 ? 'it' : 'them'} to another category first, or keep it`;
    },
    async remove(api, observed) {
      await api.form('/api/v2/torrents/removeCategories', { categories: observed.name });
    },
  };
}

/**
 * What Mediaplane wires in qBittorrent (spec §6.1, §6.2): the shared admin login, its
 * settings, and a category for each arr in the stack. Sonarr and Radarr come after it.
 */
export default defineIntegration({
  after: [],
  resources: [admin, settings, ...CATEGORIES.map(({ arr, name }) => category(arr, name))],
});
