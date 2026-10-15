import { servarrIntegration } from '../_shared/servarr';
import { servarrJellyfin } from '../_shared/servarr-connection';
import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';

/**
 * What tells Jellyfin of a change in Sonarr's library: an episode imported, upgraded or
 * renamed, or a series or an episode's file deleted.
 */
export const JELLYFIN_TRIGGERS = [
  'onDownload',
  'onUpgrade',
  'onRename',
  'onSeriesDelete',
  'onEpisodeFileDelete',
  'onEpisodeFileDeleteForUpgrade',
] as const;

/**
 * What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, qBittorrent as its
 * download client, filing under the `tv` category, the root folder /data/media/tv, and
 * its connection to Jellyfin. It comes after qBittorrent, whose category the download
 * client needs, and after Jellyfin, whose admin the connection needs.
 */
export default servarrIntegration(
  'v3',
  ['jellyfin', 'qbittorrent'],
  [
    servarrDownloadClient({ category: 'tv', setting: 'tvCategory' }),
    servarrRootFolder('/data/media/tv'),
    servarrJellyfin(JELLYFIN_TRIGGERS),
  ],
);
