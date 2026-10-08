import type { Catalog } from '@mediaplane/engine';
import byparr from './byparr/app';
import flaresolverr from './flaresolverr/app';
import gluetun from './gluetun/app';
import jellyfin from './jellyfin/app';
import plex from './plex/app';
import prowlarr from './prowlarr/app';
import qbittorrent from './qbittorrent/app';
import radarr from './radarr/app';
import seerr from './seerr/app';
import sonarr from './sonarr/app';

/** Every app Mediaplane can deploy, sorted by id. */
export const catalog: Catalog = [
  byparr,
  flaresolverr,
  gluetun,
  jellyfin,
  plex,
  prowlarr,
  qbittorrent,
  radarr,
  seerr,
  sonarr,
];
