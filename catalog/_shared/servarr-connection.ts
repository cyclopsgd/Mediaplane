import {
  serviceAddress,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import {
  createProvider,
  findProvider,
  numberOf,
  secretOf,
  settingOf,
  testProvider,
  textOf,
  updateProvider,
  type ProviderKind,
} from './servarr-provider';

/** The name of the connection to Jellyfin Mediaplane makes in Sonarr and Radarr. */
export const JELLYFIN_CONNECTION_NAME = 'Jellyfin (Mediaplane)';

/** Sonarr's and Radarr's "Emby / Jellyfin" connections, in their "notification" API. */
const CONNECTIONS: ProviderKind = {
  path: '/api/v3/notification',
  implementation: 'MediaBrowser',
  what: 'Emby / Jellyfin connection',
  of: 'Jellyfin',
};

/** The settings the connection's key is refused on: the arr's own test names it so. */
const CREDENTIALS = ['ApiKey'];

/** The desired settings, Jellyfin's key in clear: Jellyfin's key goes to the arr. */
function settingsOf(desired: DesiredResource): Record<string, unknown> {
  return {
    host: desired.fields.host,
    port: desired.fields.port,
    updateLibrary: desired.fields.updateLibrary,
    apiKey: secretOf(desired, 'apiKey'),
  };
}

/**
 * The connection of Sonarr or Radarr to Jellyfin (spec §6.2), named
 * JELLYFIN_CONNECTION_NAME, that has Jellyfin update its library on import.
 * - Its host is Jellyfin's service on the stack's network, at its container port, and it
 *   updates the library; Jellyfin's key is its secret, which the arr shows masked.
 * - It is made from the arr's own template, with `triggers` on: what makes the arr tell
 *   Jellyfin, as files come, are upgraded, renamed or deleted. They stay yours after.
 * - Its key is checked with the arr's own test of the connection it holds: a refused key
 *   (`ApiKey`) means an update, which sets it; any other failure the arr explains. The
 *   arr tests a new connection with a trigger on as it saves it, forceSave or not, so a
 *   create fails while it can't reach Jellyfin; an update is saved untested.
 * - It requires Jellyfin's admin, the first thing Mediaplane checks in Jellyfin, after its
 *   key: while Jellyfin is still to be set up, or refuses its key, `plan` leaves the
 *   connection's key unchecked, and the wire step skips it when Jellyfin's admin fails.
 */
export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
  return {
    name: 'connection_jellyfin',
    fields: ['host', 'port', 'updateLibrary'],
    secrets: ['apiKey'],
    requires: ['jellyfin.admin'],
    desired: ({ stack, keys }) => {
      const at = serviceAddress(
        stack.apps.find((app) => app.def.id === 'jellyfin'),
        'web',
      );
      if (at === undefined) return undefined;
      // Jellyfin makes its key in its first-run setup, which plan never runs: until then
      // the connection is still wanted, and apply has the key by the wire step.
      const key = keys.jellyfin?.apiKey;
      const secrets: Record<string, string> = key === undefined ? {} : { apiKey: key };
      return {
        name: JELLYFIN_CONNECTION_NAME,
        fields: { host: at.host, port: at.port, updateLibrary: true },
        secrets,
      };
    },
    async observe(api, known) {
      const held = await findProvider(api, CONNECTIONS, known, JELLYFIN_CONNECTION_NAME);
      return held === undefined
        ? undefined
        : {
            id: held.id,
            name: held.name,
            fields: {
              host: textOf(settingOf(held, 'host')),
              port: numberOf(settingOf(held, 'port')),
              updateLibrary: settingOf(held, 'updateLibrary') === true,
            },
          };
    },
    verify: (api, desired, observed) =>
      testProvider(api, CONNECTIONS, observed.id, desired.name, CREDENTIALS),
    create: (api, desired) =>
      createProvider(api, CONNECTIONS, settingsOf(desired), {
        name: desired.name,
        ...Object.fromEntries(triggers.map((trigger) => [trigger, true])),
      }),
    update: (api, desired, observed) =>
      updateProvider(api, CONNECTIONS, observed.id, settingsOf(desired), {
        name: desired.name,
      }),
  };
}
