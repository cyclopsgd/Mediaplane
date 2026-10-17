import { servarrIntegration } from '../_shared/servarr';
import { servarrJellyfin, servarrPlex } from '../_shared/servarr-connection';
import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';

/**
 * What tells the media server of a change in Sonarr's library: an episode imported,
 * upgraded or renamed, or a series or an episode's file deleted. Sonarr's Plex
 * connection offers each of them too (probed).
 */
export const LIBRARY_TRIGGERS = [
  'onDownload',
  'onUpgrade',
  'onRename',
  'onSeriesDelete',
  'onEpisodeFileDelete',
  'onEpisodeFileDeleteForUpgrade',
] as const;

/** Where Sonarr files series: its root folder, which Seerr's Sonarr server names too. */
export const ROOT_FOLDER = '/data/media/tv';

/**
 * What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, qBittorrent as its
 * download client, filing under the `tv` category, the root folder /data/media/tv, and
 * its connection to the media server, Jellyfin or Plex. It comes after qBittorrent, whose
 * category the download client needs, and after the media server, whose first resource
 * the connection needs.
 */
export default servarrIntegration(
  'v3',
  ['jellyfin', 'plex', 'qbittorrent'],
  [
    servarrDownloadClient({ category: 'tv', setting: 'tvCategory' }),
    servarrRootFolder(ROOT_FOLDER),
    servarrJellyfin(LIBRARY_TRIGGERS),
    servarrPlex(LIBRARY_TRIGGERS, 'plex.library_tv'),
  ],
);
