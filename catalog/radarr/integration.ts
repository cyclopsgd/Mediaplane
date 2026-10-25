import { servarrIntegration } from '../_shared/servarr';
import { servarrJellyfin, servarrPlex } from '../_shared/servarr-connection';
import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';

/**
 * What tells the media server of a change in Radarr's library: a film imported, upgraded
 * or renamed, or a film or its file deleted. Radarr's Plex connection offers each of them
 * too (probed).
 */
export const LIBRARY_TRIGGERS = [
  'onDownload',
  'onUpgrade',
  'onRename',
  'onMovieDelete',
  'onMovieFileDelete',
  'onMovieFileDeleteForUpgrade',
] as const;

/** Where Radarr files films: its root folder, which Seerr's Radarr server names too. */
export const ROOT_FOLDER = '/data/media/movies';

/**
 * What Mediaplane wires in Radarr (spec §6.2): the shared admin login, qBittorrent as its
 * download client, filing under the `movies` category, the root folder
 * /data/media/movies, and its connection to the media server, Jellyfin or Plex. It comes
 * after qBittorrent, whose category the download client needs, and after the media
 * server, whose first resource the connection needs.
 */
export default servarrIntegration(
  'v3',
  ['jellyfin', 'plex', 'qbittorrent'],
  [
    servarrDownloadClient({
      category: 'movies',
      setting: 'movieCategory',
      imported: 'movieImportedCategory',
    }),
    servarrRootFolder(ROOT_FOLDER),
    servarrJellyfin(LIBRARY_TRIGGERS),
    servarrPlex(LIBRARY_TRIGGERS, 'plex.library_movies'),
  ],
);
