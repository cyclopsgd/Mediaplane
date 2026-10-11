import { servarrIntegration } from '../_shared/servarr';
import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';

/**
 * What Mediaplane wires in Radarr (spec §6.2): the shared admin login, qBittorrent as its
 * download client, filing under the `movies` category, and the root folder
 * /data/media/movies. It comes after qBittorrent, whose category the download client
 * needs.
 */
export default servarrIntegration(
  'v3',
  ['qbittorrent'],
  [
    servarrDownloadClient({ category: 'movies', setting: 'movieCategory' }),
    servarrRootFolder('/data/media/movies'),
  ],
);
