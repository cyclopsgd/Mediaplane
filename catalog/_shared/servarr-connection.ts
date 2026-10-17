import {
  serviceAddress,
  type DesiredResource,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  numberOf,
  secretOf,
  servarrProvider,
  settingOf,
  textOf,
  type Provider,
  type ProviderKind,
} from './servarr-provider';

/** The name of the connection to Jellyfin Mediaplane makes in Sonarr and Radarr. */
export const JELLYFIN_CONNECTION_NAME = 'Jellyfin (Mediaplane)';

/** The name of the connection to Plex Mediaplane makes in Sonarr and Radarr. */
export const PLEX_CONNECTION_NAME = 'Plex (Mediaplane)';

/** One media server an arr can tell of the changes in its library, and how. */
interface MediaServer {
  /** The app, and the resource named after it: `connection_<app>`. */
  app: 'jellyfin' | 'plex';
  /** The connection's name in the arr. */
  name: string;
  /** Its kind, in the arr's "notification" API. */
  kind: ProviderKind;
  /** The setting that holds the media server's key, which the arr shows masked. */
  keyField: 'apiKey' | 'authToken';
  /** The media server's key, from the stack's keys: undefined before there is one. */
  keyOf: (keys: WiringContext['keys']) => string | undefined;
  /** The settings the key is refused on: the arr's own test names it so. */
  credentials: readonly string[];
  /** The media server's resources the arr's own test needs in place first. */
  requires: readonly string[];
}

const JELLYFIN: MediaServer = {
  app: 'jellyfin',
  name: JELLYFIN_CONNECTION_NAME,
  kind: {
    path: '/api/v3/notification',
    implementation: 'MediaBrowser',
    what: 'Emby / Jellyfin connection',
    of: 'Jellyfin',
  },
  keyField: 'apiKey',
  // Jellyfin makes its key in its first-run setup, which plan never runs.
  keyOf: (keys) => keys.jellyfin?.apiKey,
  credentials: ['ApiKey'],
  requires: ['jellyfin.admin'],
};

const PLEX: MediaServer = {
  app: 'plex',
  name: PLEX_CONNECTION_NAME,
  kind: {
    path: '/api/v3/notification',
    implementation: 'PlexServer',
    what: 'Plex Media Server connection',
    of: 'Plex',
  },
  keyField: 'authToken',
  // Your Plex token, which Plex takes as its claim's account's (probed): a secret you give.
  keyOf: (keys) => keys.plex?.token,
  credentials: ['AuthToken'],
  requires: ['plex.server'],
};

/**
 * Where the arr reaches the media server, as one host to compare: its `host`, or, with TLS
 * or a URL base, the whole URL the arr builds from them, which is never the stack's
 * service (a URL base of `@<host>` is another host).
 */
function heldHost(held: Provider): string {
  const host = textOf(settingOf(held, 'host'));
  const tls = settingOf(held, 'useSsl') === true;
  const base = textOf(settingOf(held, 'urlBase'));
  if (!tls && base === '') return host;
  const port = String(numberOf(settingOf(held, 'port')));
  return `${tls ? 'https' : 'http'}://${host}:${port}${base}`;
}

/**
 * The connection of Sonarr or Radarr to the stack's media server (spec §6.2), named
 * `server.name`, that has the media server update its library on import.
 * - Its host is the media server's service on the stack's network, at its container port,
 *   without TLS or a URL base, and it updates the library; the media server's key is its
 *   secret, which the arr shows masked. With TLS or a URL base held, `host` is observed as
 *   the URL the arr calls, so it differs, and the update puts the stack's address back:
 *   the arr's test of what it holds sends the key it holds only to the stack's address.
 * - It is made from the arr's own template, with `triggers` on: what makes the arr tell
 *   the media server, as files come, are upgraded, renamed or deleted. They stay yours
 *   after. A template without one of them is refused, as the arr would drop it unsaid.
 * - Its key is checked with the arr's own test of the connection it holds: a refused key
 *   means an update, which sets it; any other failure the arr explains. The arr tests a
 *   new connection with a trigger on as it saves it, forceSave or not, so a create fails
 *   while it can't reach the media server; an update is saved untested.
 * - It requires the media server's first resource, which Mediaplane checks after its key:
 *   while the media server is still to be set up, or refuses its key, `plan` leaves the
 *   connection's key unchecked, and the wire step skips it when that resource fails.
 */
function servarrMediaServer(
  server: MediaServer,
  triggers: readonly string[],
): ResourceSpec {
  const settingsOf = (desired: DesiredResource): Record<string, unknown> => ({
    host: desired.fields.host,
    port: desired.fields.port,
    useSsl: false,
    urlBase: '',
    updateLibrary: desired.fields.updateLibrary,
    // The media server's key goes to the arr, in this request body only.
    [server.keyField]: secretOf(desired, server.keyField),
  });
  return {
    name: `connection_${server.app}`,
    fields: ['host', 'port', 'updateLibrary'],
    secrets: [server.keyField],
    requires: server.requires,
    desired: ({ stack, keys }) => {
      const at = serviceAddress(
        stack.apps.find((app) => app.def.id === server.app),
        'web',
      );
      if (at === undefined) return undefined;
      // Until there is a key, the connection is still wanted: apply has it by the wire
      // step.
      const key = server.keyOf(keys);
      return {
        name: server.name,
        fields: { host: at.host, port: at.port, updateLibrary: true },
        secrets: key === undefined ? {} : { [server.keyField]: key },
      };
    },
    ...servarrProvider({
      kind: server.kind,
      name: server.name,
      credentials: server.credentials,
      fieldsOf: (held) => ({
        host: heldHost(held),
        port: numberOf(settingOf(held, 'port')),
        updateLibrary: settingOf(held, 'updateLibrary') === true,
      }),
      settingsOf,
      topOf: (desired) => ({ name: desired.name }),
      onCreate: triggers,
    }),
  };
}

/** The connection of Sonarr or Radarr to Jellyfin, an Emby / Jellyfin one (`MediaBrowser`). */
export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
  return servarrMediaServer(JELLYFIN, triggers);
}

/**
 * The connection of Sonarr or Radarr to Plex, a Plex Media Server one (`PlexServer`). The
 * arr's own test needs a Plex library of what it files (probed: "At least one TV library
 * is required"), so it requires that one too: `library`.
 */
export function servarrPlex(triggers: readonly string[], library: string): ResourceSpec {
  return servarrMediaServer({ ...PLEX, requires: [...PLEX.requires, library] }, triggers);
}
