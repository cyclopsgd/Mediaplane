import { servarrIntegration } from '../_shared/servarr';
import { servarrJellyfin } from '../_shared/servarr-connection';
import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';

/**
 * What tells Jellyfin of a change in Radarr's library: a film imported, upgraded or
 * renamed, or a film or its file deleted.
 */
export const JELLYFIN_TRIGGERS = [
  'onDownload',
  'onUpgrade',
  'onRename',
  'onMovieDelete',
  'onMovieFileDelete',
  'onMovieFileDeleteForUpgrade',
] as const;

/**
 * What Mediaplane wires in Radarr (spec §6.2): the shared admin login, qBittorrent as its
 * download client, filing under the `movies` category, the root folder
 * /data/media/movies, and its connection to Jellyfin. It comes after qBittorrent, whose
 * category the download client needs, and after Jellyfin, whose admin the connection
 * needs.
 */
export default servarrIntegration(
  'v3',
  ['jellyfin', 'qbittorrent'],
  [
    servarrDownloadClient({ category: 'movies', setting: 'movieCategory' }),
    servarrRootFolder('/data/media/movies'),
    servarrJellyfin(JELLYFIN_TRIGGERS),
  ],
);
