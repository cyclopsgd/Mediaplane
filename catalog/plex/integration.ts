import {
  AppApiError,
  defineIntegration,
  fieldReader,
  listItems,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';

/** The name Plex shows for itself, unless `apps.plex.server_name` names another. */
export const SERVER_NAME = 'Mediaplane';

/** Plex's settings, as `GET /:/prefs` lists them: asked for here and by Plex's setup. */
export const prefs = z.looseObject({
  MediaContainer: z.looseObject({
    Setting: z.array(z.looseObject({ id: z.string(), value: z.unknown() })),
  }),
});

/**
 * Plex's name for itself (spec §6.2): `FriendlyName`, which Plex shows in its apps and in
 * your plex.tv account. A new Plex has none, so it shows its container's hostname, which
 * Docker makes random (probed). Mediaplane names it, so it can't be taken for another Plex
 * of yours: "Mediaplane", or `apps.plex.server_name`. It is set with your token, through
 * `PUT /:/prefs`, which needs no restart.
 */
const server: ResourceSpec = {
  name: 'server',
  fields: ['name'],
  secrets: [],
  desired: ({ app }) => {
    const named = app.context.options.server_name;
    return {
      name: 'server',
      fields: { name: typeof named === 'string' ? named : SERVER_NAME },
      secrets: {},
    };
  },
  async observe(api) {
    const { Setting } = (await api.get('/:/prefs', prefs)).MediaContainer;
    const read = fieldReader();
    return read.observed(null, 'server', {
      name: read.text('name', Setting.find((s) => s.id === 'FriendlyName')?.value),
    });
  },
  async create(api, desired) {
    await setName(api, String(desired.fields.name));
    return { id: null };
  },
  update: (api, desired) => setName(api, String(desired.fields.name)),
};

async function setName(api: AppApi, name: string): Promise<void> {
  const query = new URLSearchParams({ FriendlyName: name });
  await api.put(`/:/prefs?${query.toString()}`, {});
}

/**
 * The libraries Mediaplane makes in Plex (spec §6.2): Movies and TV Shows, on the folders
 * under /data/media that Radarr and Sonarr fill, with the agent and scanner Plex's web UI
 * gives a new one (probed on the pinned image).
 */
export const LIBRARIES = [
  {
    resource: 'library_movies',
    name: 'Movies',
    type: 'movie',
    agent: 'tv.plex.agents.movie',
    scanner: 'Plex Movie',
    path: '/data/media/movies',
  },
  {
    resource: 'library_tv',
    name: 'TV Shows',
    type: 'show',
    agent: 'tv.plex.agents.series',
    scanner: 'Plex TV Series',
    path: '/data/media/tv',
  },
] as const;

/** The language a new library's metadata comes in; yours to change in Plex after. */
const LANGUAGE = 'en-US';

const SECTIONS = '/library/sections';

const section = z.looseObject({
  key: z.string(),
  title: z.string(),
  type: z.unknown(),
  agent: z.string(),
  Location: z.array(z.looseObject({ path: z.string() })).optional(),
});

const sections = z.looseObject({
  MediaContainer: z.looseObject({ Directory: z.array(section).optional() }),
});

const made = z.looseObject({
  MediaContainer: z.looseObject({ Directory: z.array(section).min(1) }),
});

/** Plex's libraries, as it lists them: none is no Directory at all. */
async function sectionsOf(api: AppApi): Promise<z.infer<typeof section>[]> {
  return (await api.get(SECTIONS, sections)).MediaContainer.Directory ?? [];
}

/** A library's folders, each without a trailing "/". */
function foldersOf(held: z.infer<typeof section>): string[] {
  return (held.Location ?? []).map(({ path }) =>
    path.length > 1 ? path.replace(/\/+$/, '') : path,
  );
}

/** A library's folders as one sorted list, each once. */
function locationsOf(held: z.infer<typeof section>): string {
  return [...new Set(foldersOf(held))].sort().join(',');
}

/** The folders a desired library holds: `location`, one comma-separated list. */
function wantedLocations(desired: DesiredResource): string[] {
  return listItems(desired.fields.location);
}

/**
 * One of Plex's libraries (spec §6.2), known by Plex's key for it (`resources.json`),
 * else by its name. Plex takes a second library of one name, so one is made only when
 * none has the name. Its managed fields are its name, what it holds and its folder, which
 * the wire step makes first, though Plex takes one that doesn't exist (probed). An update
 * sends the library back with the agent it has, which Plex needs (400 without), so it
 * stays yours; Plex can't change what a library holds (400), which the update refuses with
 * what to do.
 */
function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
  return {
    name: spec.resource,
    fields: ['name', 'type', 'location'],
    lists: ['location'],
    locked: {
      name: `Seerr enables the library by its name, and Mediaplane finds it by its name when state/resources.json is lost. Rename it back to ${spec.name} in Plex, or stop Mediaplane managing it with {resource}: unmanaged`,
      type: "Plex can't change what a library holds",
    },
    refuses: {
      location: (value) =>
        listItems(value).length === 0
          ? 'a library holds at least one folder: name each one, separated by ","'
          : undefined,
    },
    secrets: [],
    desired: () => ({
      name: spec.name,
      fields: { name: spec.name, type: spec.type, location: spec.path },
      secrets: {},
      folders: [spec.path],
    }),
    async observe(api, known) {
      const held = await sectionsOf(api);
      const found =
        held.find((s) => known !== undefined && s.key === known.id) ??
        held.find((s) => s.title === spec.name);
      if (found === undefined) return undefined;
      const read = fieldReader();
      // `location` is one comma-separated list: a folder with a comma in its name can't be
      // told apart in it, so it is said to be. The update sends the folders wanted.
      const odd = foldersOf(found).find((path) => path.includes(','));
      return read.observed(found.key, found.title, {
        name: found.title,
        type: read.text('type', found.type),
        location:
          odd === undefined
            ? locationsOf(found)
            : read.refuse('location', `a folder with a comma in its name, ${odd}`),
      });
    },
    async create(api, desired) {
      // A library of another name may hold the folder already: this one renamed by hand,
      // and lost from state/resources.json. Another would put the folder in two libraries.
      const wanted = wantedLocations(desired);
      const holder = (await sectionsOf(api)).find((s) =>
        foldersOf(s).some((path) => wanted.includes(path)),
      );
      const folder =
        holder === undefined
          ? undefined
          : foldersOf(holder).find((path) => wanted.includes(path));
      if (holder !== undefined && folder !== undefined) {
        // Renamed by hand, or another library on a folder an override names.
        throw new AppApiError(
          `${api.name} at ${api.where} has no library named ${spec.name}, but its library ${holder.title} holds ${folder}, one of its folders: if it is ${spec.name} renamed, rename it back in Plex; if it is another library, take ${folder} out of it, or out of plex.${spec.resource}.location under overrides:; to keep it as it is, stop Mediaplane managing ${spec.name} with plex.${spec.resource}: unmanaged under overrides: (GET ${SECTIONS})`,
          { kind: 'rejected' },
        );
      }
      const query = new URLSearchParams([
        ['name', spec.name],
        ['type', spec.type],
        ['agent', spec.agent],
        ['scanner', spec.scanner],
        ['language', LANGUAGE],
        ...wantedLocations(desired).map((path): [string, string] => ['location', path]),
      ]);
      const answer = await api.post(`${SECTIONS}?${query.toString()}`, {}, made);
      // The one that is the library just asked for, whatever else Plex lists in its answer.
      const created = answer.MediaContainer.Directory.find(
        (s) => s.title === spec.name && s.type === spec.type,
      );
      if (created === undefined) {
        throw new AppApiError(
          `${api.name} at ${api.where} made the library ${spec.name}, but its answer doesn't list a ${spec.type} library of that name, so Mediaplane can't tell which it is (POST ${SECTIONS})`,
          { kind: 'rejected' },
        );
      }
      return { id: created.key };
    },
    async update(api, desired, observed) {
      const holds = observed.fields.type;
      if (holds !== spec.type) {
        throw new AppApiError(
          `${api.name} at ${api.where} has a library named ${String(observed.fields.name)} that holds ${holds === undefined ? "a kind Mediaplane can't read" : String(holds)}, not ${spec.type}, and Plex can't change what a library holds: rename or remove it in Plex, and the next apply makes ${spec.name} (GET ${SECTIONS})`,
          { kind: 'rejected' },
        );
      }
      const held = (await sectionsOf(api)).find((s) => s.key === observed.id);
      if (held === undefined) {
        throw new AppApiError(
          `${api.name} at ${api.where} no longer has the library ${String(observed.fields.name)} (GET ${SECTIONS})`,
          { kind: 'rejected' },
        );
      }
      // Plex takes the folders as one `location` each, and keeps those it is sent.
      const query = new URLSearchParams([
        ['agent', held.agent],
        ['name', spec.name],
        ...wantedLocations(desired).map((path): [string, string] => ['location', path]),
      ]);
      await api.put(
        `${SECTIONS}/${encodeURIComponent(held.key)}?${query.toString()}`,
        {},
      );
    },
  };
}

/**
 * What Mediaplane wires in Plex (spec §6.2): its name, and the Movies and TV Shows
 * libraries. Its claim (bootstrap.ts) comes before. Its remote access, and the settings
 * that let a client in without signing in (the networks allowed, local security, DLNA),
 * stay Plex's defaults and yours: Mediaplane never sets them, and its setup refuses to
 * publish a Plex of yours that has them open (bootstrap.ts, OPEN_SETTINGS).
 */
export default defineIntegration({
  after: [],
  resources: [server, ...LIBRARIES.map(libraryResource)],
});
