import { servarrIntegration } from '../_shared/servarr';
import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';

/**
 * What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, qBittorrent as its
 * download client, filing under the `tv` category, and the root folder /data/media/tv.
 * It comes after qBittorrent, whose category the download client needs.
 */
export default servarrIntegration(
  'v3',
  ['qbittorrent'],
  [
    servarrDownloadClient({ category: 'tv', setting: 'tvCategory' }),
    servarrRootFolder('/data/media/tv'),
  ],
);
