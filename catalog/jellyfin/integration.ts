import {
  AppApiError,
  defineIntegration,
  listItems,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';
import { secretOf } from '../_shared/secret';
import { signIn } from './bootstrap';

const user = z.looseObject({ Id: z.string(), Name: z.string() });

/**
 * The shared admin (spec §6.1): the user Mediaplane made in Jellyfin's startup wizard,
 * known by the id resources.json records, else by the shared admin's user name. Its name
 * is a managed field, and its password a secret, checked by signing in, then out again.
 * Both are set with the key, which needs neither the old password nor a restart. Jellyfin
 * doesn't lock its admin out after failed sign-ins (probed: none after seven), but its
 * activity log records each sign-in, as it records any.
 */
const admin: ResourceSpec = {
  name: 'admin',
  fields: ['username'],
  secrets: ['password'],
  desired: ({ admin: login }) => ({
    name: 'admin',
    fields: { username: login.username },
    secrets: { password: login.password },
  }),
  async observe(api, known, desired) {
    const users = await api.get('/Users', z.array(user));
    const held =
      users.find((u) => known !== undefined && u.Id === known.id) ??
      users.find((u) => u.Name === desired?.fields.username);
    return held === undefined
      ? undefined
      : { id: held.Id, name: 'admin', fields: { username: held.Name } };
  },
  async verify(api, desired) {
    const token = await signIn(api, {
      username: String(desired.fields.username),
      password: secretOf(desired, 'password'),
    });
    if (token === undefined) return false;
    await api.withKey(token).submit('POST', '/Sessions/Logout');
    return true;
  },
  // The startup wizard makes it: Mediaplane makes no other user.
  create: (api, desired) =>
    Promise.reject(
      new AppApiError(
        `${api.name} at ${api.where} has no user ${String(desired.fields.username)}: Mediaplane makes Jellyfin's admin in its startup wizard, and no other user (GET /Users)`,
        { kind: 'rejected' },
      ),
    ),
  async update(api, desired, observed) {
    const password = secretOf(desired, 'password');
    const path = `/Users/${String(observed.id)}`;
    // The user goes back as Jellyfin gave it, its policy and all: it refuses less.
    const held = await api.get(path, user);
    if (held.Name !== desired.fields.username) {
      await api.submit('POST', path, { ...held, Name: desired.fields.username });
    }
    await api.submit('POST', `${path}/Password`, { NewPw: password });
  },
};

/**
 * The libraries Mediaplane makes in Jellyfin (spec §6.2): their name, what they hold, and
 * their folder under /data/media, which Sonarr and Radarr fill.
 */
export const LIBRARIES = [
  {
    resource: 'library_movies',
    name: 'Movies',
    collectionType: 'movies',
    path: '/data/media/movies',
  },
  {
    resource: 'library_shows',
    name: 'Shows',
    collectionType: 'tvshows',
    path: '/data/media/tv',
  },
] as const;

const VIRTUAL_FOLDERS = '/Library/VirtualFolders';

const library = z.looseObject({
  Name: z.string(),
  /** Absent for mixed content. */
  CollectionType: z.string().optional(),
  Locations: z.array(z.string()),
});

const fetcher = z.looseObject({ Name: z.string(), DefaultEnabled: z.boolean() });
const available = z.looseObject({
  TypeOptions: z.array(
    z.looseObject({
      Type: z.string(),
      MetadataFetchers: z.array(fetcher),
      ImageFetchers: z.array(fetcher),
      DefaultImageOptions: z.array(z.unknown()),
    }),
  ),
});

/** A folder without a trailing "/", as Jellyfin may give it. */
function trimmed(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** A library's folders as one sorted list, each once and without a trailing "/". */
function pathsOf(locations: readonly string[]): string {
  return [...new Set(locations.map(trimmed))].sort().join(',');
}

/** The folders a desired library holds: `paths`, one comma-separated list. */
function wantedPaths(desired: DesiredResource): string[] {
  return listItems(desired.fields.paths).map(trimmed);
}

/**
 * What Jellyfin's own web UI gives a new library of `type`, where it matters: each kind of
 * item it holds gets the metadata and image downloaders Jellyfin turns on by default, in
 * its order; metadata comes from the internet; and new files are picked up as they come.
 * A library made without them still gets its metadata, but doesn't watch its folders for
 * new files. Everything else is Jellyfin's default, and stays yours.
 */
async function newLibraryOptions(api: AppApi, type: string) {
  const { TypeOptions } = await api.get(
    `/Libraries/AvailableOptions?${new URLSearchParams({ libraryContentType: type, isNewLibrary: 'true' }).toString()}`,
    available,
  );
  const on = (offered: z.infer<typeof fetcher>[]) =>
    offered.filter((f) => f.DefaultEnabled).map((f) => f.Name);
  const all = (offered: z.infer<typeof fetcher>[]) => offered.map((f) => f.Name);
  return {
    Enabled: true,
    EnableInternetProviders: true,
    EnableRealtimeMonitor: true,
    TypeOptions: TypeOptions.map((t) => ({
      Type: t.Type,
      MetadataFetchers: on(t.MetadataFetchers),
      MetadataFetcherOrder: all(t.MetadataFetchers),
      ImageFetchers: on(t.ImageFetchers),
      ImageFetcherOrder: all(t.ImageFetchers),
      ImageOptions: t.DefaultImageOptions,
    })),
  };
}

/**
 * One of Jellyfin's libraries (spec §6.2), known by its name: Jellyfin keys a library by
 * its folder, which a rename changes. Its managed fields are its name, what it holds and
 * its folders. It needs its folder to exist: the wire step makes it first. A second
 * library of one name isn't refused but named "<name>2", so one is made only when none
 * has the name. Jellyfin can't change what a library holds. Its folders are its
 * `paths`, the one Mediaplane gives it unless an override names more, as Keep mine does
 * for a folder you added in Jellyfin.
 */
function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
  return {
    name: spec.resource,
    fields: ['name', 'collectionType', 'paths'],
    lists: ['paths'],
    locked: {
      name: `Mediaplane knows the library by its name, and Seerr enables it by its name. Rename it back to ${spec.name} in Jellyfin, or stop Mediaplane managing it with {resource}: unmanaged`,
      collectionType: "Jellyfin can't change what a library holds",
    },
    secrets: [],
    desired: () => ({
      name: spec.name,
      fields: { name: spec.name, collectionType: spec.collectionType, paths: spec.path },
      secrets: {},
      folders: [spec.path],
    }),
    async observe(api) {
      const held = (await api.get(VIRTUAL_FOLDERS, z.array(library))).find(
        (l) => l.Name === spec.name,
      );
      return held === undefined
        ? undefined
        : {
            id: spec.name,
            name: spec.name,
            fields: {
              name: held.Name,
              collectionType: held.CollectionType ?? '',
              paths: pathsOf(held.Locations),
            },
          };
    },
    async create(api, desired) {
      const query = new URLSearchParams([
        ['name', spec.name],
        ['collectionType', spec.collectionType],
        ...wantedPaths(desired).map((path): [string, string] => ['paths', path]),
        ['refreshLibrary', 'true'],
      ]);
      await api.submit('POST', `${VIRTUAL_FOLDERS}?${query.toString()}`, {
        LibraryOptions: await newLibraryOptions(api, spec.collectionType),
      });
      return { id: spec.name };
    },
    async update(api, desired, observed) {
      const holds = String(observed.fields.collectionType);
      if (holds !== spec.collectionType) {
        throw new AppApiError(
          `${api.name} at ${api.where} has a library named ${spec.name} that holds ${holds === '' ? 'mixed content' : holds}, not ${spec.collectionType}, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes ${spec.name} (GET ${VIRTUAL_FOLDERS})`,
          { kind: 'rejected' },
        );
      }
      // Its folders as Jellyfin lists them, each whole: one with a comma in its name
      // can't be told apart in `paths`.
      const found = (await api.get(VIRTUAL_FOLDERS, z.array(library))).find(
        (l) => l.Name === spec.name,
      );
      const held = (found?.Locations ?? []).map(trimmed);
      const wanted = wantedPaths(desired);
      // The wanted folders first, so the library never holds none.
      for (const path of wanted.filter((p) => !held.includes(p))) {
        await api.submit('POST', `${VIRTUAL_FOLDERS}/Paths?refreshLibrary=true`, {
          Name: spec.name,
          Path: path,
        });
      }
      for (const path of held.filter((p) => !wanted.includes(p))) {
        const query = new URLSearchParams({
          name: spec.name,
          path,
          refreshLibrary: 'true',
        });
        await api.submit('DELETE', `${VIRTUAL_FOLDERS}/Paths?${query.toString()}`);
      }
    },
  };
}

/**
 * What Mediaplane wires in Jellyfin (spec §6.2): the shared admin, and the Movies and
 * Shows libraries. Its first-run setup (bootstrap.ts) comes before, with its key.
 */
export default defineIntegration({
  after: [],
  resources: [admin, ...LIBRARIES.map(libraryResource)],
});
