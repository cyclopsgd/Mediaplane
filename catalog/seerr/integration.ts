import {
  AppApiError,
  defineIntegration,
  serviceAddress,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import { z } from 'zod';
import { secretOf } from '../_shared/secret';
import { LIBRARIES } from '../jellyfin/integration';
import { ROOT_FOLDER as MOVIES } from '../radarr/integration';
import { ROOT_FOLDER as TV } from '../sonarr/integration';

const SETTINGS = '/api/v1/settings';

/** The Jellyfin libraries Seerr has enabled: those Mediaplane makes, by name, in order. */
const WANTED = LIBRARIES.map((library) => library.name);

/**
 * The stack's own address for app `id`, and its key as a secret: the only place the
 * stack's keys ever go. Undefined when the stack has no such app. The key is missing
 * before the app has made it: its first-run setup is one `plan` never runs, so until then
 * the link is still wanted, and apply has the key by the wire step.
 */
function stackApp(
  { stack, keys }: Pick<WiringContext, 'stack' | 'keys'>,
  id: string,
): { host: string; port: number; secrets: Record<string, string> } | undefined {
  const at = serviceAddress(
    stack.apps.find((app) => app.def.id === id),
    'web',
  );
  if (at === undefined) return undefined;
  const key = keys[id]?.apiKey;
  return {
    host: at.host,
    port: at.port,
    secrets: key === undefined ? {} : { apiKey: key },
  };
}

const library = z.looseObject({ id: z.string(), name: z.string(), enabled: z.boolean() });
const jellyfinSettings = z.looseObject({
  ip: z.string(),
  port: z.number(),
  apiKey: z.string(),
  libraries: z.array(library),
});

/** Which of Mediaplane's libraries Seerr has enabled, as one list: the managed field. */
function enabledOf(libraries: readonly z.infer<typeof library>[]): string {
  return WANTED.filter((name) =>
    libraries.some((held) => held.name === name && held.enabled),
  ).join(',');
}

/**
 * Whether Seerr reaches Jellyfin with the key it holds: its list of Jellyfin's users, which
 * it asks Jellyfin for with that key, fails with a 500 while Jellyfin refuses the key
 * (probed). That failure logs a line in Seerr's log, as one from its web UI does.
 */
async function heldKeyWorks(api: AppApi): Promise<boolean> {
  try {
    await api.check(`${SETTINGS}/jellyfin/users`);
    return true;
  } catch (cause) {
    if (cause instanceof AppApiError && cause.status === 500) return false;
    throw cause;
  }
}

/**
 * Point Seerr at Jellyfin, with Mediaplane's key for Jellyfin. Seerr saves it only once it
 * has reached Jellyfin there with that key. `ip` is the setting; a `hostname` would be
 * kept as a stray setting, and is the sign-in's field, which Seerr refuses once set.
 */
async function saveJellyfin(api: AppApi, desired: DesiredResource): Promise<void> {
  await api.submit('POST', `${SETTINGS}/jellyfin`, {
    ip: desired.fields.hostname,
    port: desired.fields.port,
    useSsl: false,
    urlBase: '',
    apiKey: secretOf(desired, 'apiKey'),
  });
}

/**
 * Enable Mediaplane's libraries in Seerr: Seerr learns Jellyfin's libraries by syncing
 * them, which keeps those it has enabled, and enables them one at a time. One it finds
 * no library of the name is refused: the Jellyfin library may have been renamed.
 */
async function enableLibraries(api: AppApi): Promise<void> {
  await api.submit('POST', `${SETTINGS}/jellyfin/library/sync`);
  const synced = await api.get(`${SETTINGS}/jellyfin/library`, z.array(library));
  for (const name of WANTED) {
    const held = synced.find((l) => l.name === name);
    if (held === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} finds no Jellyfin library named ${name} (POST ${SETTINGS}/jellyfin/library/sync)`,
        { kind: 'rejected' },
      );
    }
    if (!held.enabled) {
      await api.put(`${SETTINGS}/jellyfin/library/${encodeURIComponent(held.id)}`, {
        enabled: true,
      });
    }
  }
}

/**
 * Seerr's media server (spec §6.2): Jellyfin, at its service and container port, with its
 * Movies and Shows libraries enabled.
 * - Seerr's first sign-in sets it (bootstrap.ts), with a key Seerr makes itself in
 *   Jellyfin ("Seerr"), which Seerr shows in clear: once read, it is kept out of what
 *   the run says. That key stays while it works: the secret is checked by using it
 *   (Seerr's list of Jellyfin's users), never compared. Mediaplane gives Seerr its own
 *   Jellyfin key only when Seerr's is refused, or Jellyfin moves.
 * - `libraries` lists which of Mediaplane's are enabled; a library you enable is yours.
 * - It requires Jellyfin's admin and libraries, and Seerr comes after Jellyfin.
 */
const mediaServer: ResourceSpec = {
  name: 'media_server',
  fields: ['hostname', 'port', 'libraries'],
  secrets: ['apiKey'],
  requires: ['jellyfin.admin', 'jellyfin.library_movies', 'jellyfin.library_shows'],
  desired: (ctx) => {
    const at = stackApp(ctx, 'jellyfin');
    if (at === undefined) return undefined;
    return {
      name: 'Jellyfin',
      fields: { hostname: at.host, port: at.port, libraries: WANTED.join(',') },
      secrets: at.secrets,
    };
  },
  async observe(api) {
    const held = await api.get(`${SETTINGS}/jellyfin`, jellyfinSettings);
    api.addSecret(held.apiKey);
    return held.ip === ''
      ? undefined
      : {
          id: null,
          name: 'Jellyfin',
          fields: {
            hostname: held.ip,
            port: held.port,
            libraries: enabledOf(held.libraries),
          },
        };
  },
  verify: (api) => heldKeyWorks(api),
  async create(api, desired) {
    await saveJellyfin(api, desired);
    await enableLibraries(api);
    return { id: null };
  },
  async update(api, desired, observed) {
    const moved =
      observed.fields.hostname !== desired.fields.hostname ||
      observed.fields.port !== desired.fields.port;
    if (moved || !(await heldKeyWorks(api))) await saveJellyfin(api, desired);
    // Another Jellyfin has other library ids, though the names match: sync them again.
    if (moved || observed.fields.libraries !== desired.fields.libraries) {
      await enableLibraries(api);
    }
  },
};

/** Seerr's quality profile preferences, when the stack names none (spec §6.2). */
export const PREFERRED_PROFILES = ['HD-1080p', 'Any'] as const;

/** Sonarr and Radarr, as Seerr holds them. */
const ARRS = {
  sonarr: {
    name: 'Sonarr',
    folder: TV,
    option: 'sonarr_profile',
    // As Seerr's web UI gives a new server, but season folders on, Sonarr's own default:
    // standard series, anime as anime, and every new episode monitored. They stay yours
    // after.
    extra: {
      seriesType: 'standard',
      animeSeriesType: 'anime',
      animeTags: [],
      enableSeasonFolders: true,
      monitorNewItems: 'all',
    },
  },
  radarr: {
    name: 'Radarr',
    folder: MOVIES,
    option: 'radarr_profile',
    // Seerr requires season folders of a Radarr server too: films have none.
    extra: { minimumAvailability: 'released', enableSeasonFolders: false },
  },
} as const;

const server = z.looseObject({
  id: z.number(),
  name: z.string(),
  hostname: z.string(),
  port: z.number(),
  apiKey: z.string(),
  activeProfileName: z.string(),
  activeDirectory: z.string(),
  isDefault: z.boolean(),
});
const offered = z.looseObject({
  profiles: z.array(z.looseObject({ id: z.number(), name: z.string() })),
});

/**
 * Seerr's Sonarr or Radarr server (spec §6.2), named "<Arr> (Mediaplane)": the arr at its
 * service and container port, with its key, its root folder, a quality profile, and
 * `isDefault`, so requests go to it.
 * - The profile is the one `apps.seerr.<arr>_profile` names, else the first of
 *   PREFERRED_PROFILES that the arr has, else its first: only the arr can say which it
 *   has, so `resolve` asks it through Seerr's own test.
 * - Seerr shows each server's key in clear, the stack's or not: once read, each is kept
 *   out of what the run says. It is checked, never compared, with Seerr's own test of
 *   the server it holds: one that fails is tested again with the stack's key, at the
 *   stack's own address for the arr (never the host Seerr holds, which Seerr's admin can
 *   change), and only a pass then says the key was refused (an update); otherwise Seerr
 *   can't reach the arr, in its own words (500, "Failed to connect", probed, whatever
 *   the cause). A failing
 *   test logs a line in Seerr's log, and the arr one in its own, as from Seerr's web UI.
 * - Seerr keeps a server whole, its id read-only: an update sends it back as Seerr gave
 *   it, without the id, so its other settings stay yours.
 * - It requires the arr's root folder, which it names, and Seerr comes after the arr.
 */
function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
  const spec = ARRS[arr];
  const path = `${SETTINGS}/${arr}`;
  const name = `${spec.name} (Mediaplane)`;
  /** Seerr's test of `sent`: what the arr offers, or undefined when it fails. */
  const test = async (api: AppApi, sent: Record<string, unknown>) => {
    try {
      return await api.post(`${path}/test`, sent, offered);
    } catch (cause) {
      if (cause instanceof AppApiError && cause.status === 500) return undefined;
      throw cause;
    }
  };
  const reach = (desired: DesiredResource) => ({
    hostname: desired.fields.hostname,
    port: desired.fields.port,
    apiKey: secretOf(desired, 'apiKey'),
    useSsl: false,
  });
  const unreachable = (api: AppApi, at: string, how: string) =>
    new AppApiError(
      `${api.name} at ${api.where} can't reach ${spec.name} at ${at} ${how} (POST ${path}/test)`,
      { kind: 'rejected' },
    );
  /** The arr's profiles, as Seerr reaches it with the stack's key. */
  const profiles = async (api: AppApi, desired: DesiredResource) => {
    const found = await test(api, reach(desired));
    if (found === undefined) {
      const at = `http://${String(desired.fields.hostname)}:${String(desired.fields.port)}`;
      throw unreachable(api, at, "with the stack's key");
    }
    return found.profiles;
  };
  /** The profile `desired` names, as the arr has it. */
  const profileOf = async (api: AppApi, desired: DesiredResource) => {
    const wanted = desired.fields.activeProfile;
    const profile = (await profiles(api, desired)).find((p) => p.name === wanted);
    if (profile === undefined) {
      throw new AppApiError(
        `${spec.name} has no quality profile named ${String(wanted)} any more (POST ${path}/test)`,
        { kind: 'rejected' },
      );
    }
    return profile;
  };
  /** The servers Seerr holds, each key in them kept out of what the run says. */
  const servers = async (api: AppApi) => {
    const held = await api.get(path, z.array(server));
    for (const s of held) api.addSecret(s.apiKey);
    return held;
  };
  /** The server Seerr holds as `id`, without its id, which Seerr won't take back. */
  const heldOf = async (api: AppApi, id: unknown) => {
    const found = (await servers(api)).find((s) => s.id === id);
    if (found === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} has no ${spec.name} server ${String(id)} (GET ${path})`,
        { kind: 'rejected' },
      );
    }
    const { id: _id, ...held } = found;
    return held;
  };
  return {
    name: `server_${arr}`,
    fields: ['hostname', 'port', 'activeProfile', 'activeDirectory', 'isDefault'],
    secrets: ['apiKey'],
    requires: [`${arr}.root_folder`],
    desired: (ctx) => {
      const at = stackApp(ctx, arr);
      if (at === undefined) return undefined;
      return {
        name,
        fields: {
          hostname: at.host,
          port: at.port,
          activeDirectory: spec.folder,
          isDefault: true,
        },
        secrets: at.secrets,
      };
    },
    async resolve(api, desired, ctx) {
      const names = (await profiles(api, desired)).map((p) => p.name);
      const asked = ctx.app.context.options[spec.option];
      if (typeof asked === 'string' && !names.includes(asked)) {
        throw new AppApiError(
          `${spec.name} has no quality profile named ${asked}, which apps.seerr.${spec.option} names; it has ${names.join(', ')} (POST ${path}/test)`,
          { kind: 'rejected' },
        );
      }
      const chosen =
        typeof asked === 'string'
          ? asked
          : (PREFERRED_PROFILES.find((p) => names.includes(p)) ?? names[0]);
      if (chosen === undefined) {
        throw new AppApiError(
          `${spec.name} has no quality profile for Seerr to request with (POST ${path}/test)`,
          { kind: 'rejected' },
        );
      }
      return { ...desired, fields: { ...desired.fields, activeProfile: chosen } };
    },
    async observe(api, known) {
      const held = await servers(api);
      const found =
        held.find((s) => known !== undefined && s.id === known.id) ??
        held.find((s) => s.name === name);
      return found === undefined
        ? undefined
        : {
            id: found.id,
            name: found.name,
            fields: {
              hostname: found.hostname,
              port: found.port,
              activeProfile: found.activeProfileName,
              activeDirectory: found.activeDirectory,
              isDefault: found.isDefault,
            },
          };
    },
    async verify(api, desired, observed) {
      const held = await heldOf(api, observed.id);
      if ((await test(api, held)) !== undefined) return true;
      // The stack's key goes only to the stack's own address for the arr, never to the
      // host Seerr holds, which anyone who is Seerr's admin can change.
      if ((await test(api, { ...held, ...reach(desired) })) !== undefined) return false;
      throw unreachable(
        api,
        `http://${String(desired.fields.hostname)}:${String(desired.fields.port)}`,
        "with the key it holds, or the stack's",
      );
    },
    async create(api, desired) {
      const profile = await profileOf(api, desired);
      const made = await api.post(
        path,
        {
          name,
          ...reach(desired),
          activeProfileId: profile.id,
          activeProfileName: profile.name,
          activeDirectory: desired.fields.activeDirectory,
          tags: [],
          is4k: false,
          isDefault: true,
          syncEnabled: false,
          preventSearch: false,
          tagRequests: false,
          ...spec.extra,
        },
        z.looseObject({ id: z.number() }),
      );
      return { id: made.id };
    },
    async update(api, desired, observed) {
      const held = await heldOf(api, observed.id);
      const profile = await profileOf(api, desired);
      await api.put(`${path}/${String(observed.id)}`, {
        ...held,
        ...reach(desired),
        activeProfileId: profile.id,
        activeProfileName: profile.name,
        activeDirectory: desired.fields.activeDirectory,
        isDefault: true,
      });
    },
  };
}

/**
 * Seerr's setup, finished (spec §6.1): `POST /api/v1/settings/initialize`, once Seerr's
 * links are in place, which it requires. Seerr's web UI then stops showing its admin the
 * setup wizard. Seerr takes it again, but it is sent only while Seerr isn't initialized.
 */
const setup: ResourceSpec = {
  name: 'setup',
  fields: ['initialized'],
  secrets: [],
  requires: ['seerr.media_server', 'seerr.server_sonarr', 'seerr.server_radarr'],
  desired: () => ({ name: 'setup', fields: { initialized: true }, secrets: {} }),
  async observe(api) {
    const { initialized } = await api.get(
      `${SETTINGS}/public`,
      z.looseObject({ initialized: z.boolean() }),
    );
    return { id: null, name: 'setup', fields: { initialized } };
  },
  async create(api) {
    await api.submit('POST', `${SETTINGS}/initialize`);
    return { id: null };
  },
  update: (api) => api.submit('POST', `${SETTINGS}/initialize`),
};

/**
 * What Mediaplane wires in Seerr (spec §6.2): Jellyfin as its media server, with its
 * libraries; Sonarr and Radarr, each while the stack runs it; then its setup, finished.
 * Its first sign-in (bootstrap.ts) comes before, and makes its admin. It comes after
 * Jellyfin, Sonarr and Radarr, whose resources its own require, and after Prowlarr, as
 * spec §6.2 orders them.
 */
export default defineIntegration({
  after: ['jellyfin', 'prowlarr', 'radarr', 'sonarr'],
  resources: [mediaServer, seerrServer('sonarr'), seerrServer('radarr'), setup],
});
