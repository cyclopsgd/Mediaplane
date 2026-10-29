# An example run

Most of this is real output from a run on an arm64 VM, trimmed where marked. The wiring
lines, the first-run setup's and the last apply's came from a later run of the same
stack, once Seerr was wired. The stack is
[the README's example](../README.md#what-a-stack-looks-like) without the VPN, which is
why `plan` warns about qBittorrent, and with `network.bind: localhost`.

```console
$ mediaplane plan
warning: qBittorrent is running without a VPN (apps.qbittorrent.vpn: false)
  hint: peers will see your real IP address; add a vpn: block and remove vpn: false
+ generated/compose.yaml
  … the whole Compose file, as a diff …

+ generated/.env (secret values, not shown)

+ appdata/prowlarr/config.xml (before first start; secret values, not shown)

+ appdata/qbittorrent/qBittorrent/qBittorrent.conf (before first start; secret values, not shown)

+ appdata/radarr/config.xml (before first start; secret values, not shown)

+ appdata/sonarr/config.xml (before first start; secret values, not shown)

Containers:
  + create    byparr
  + create    jellyfin
  + create    prowlarr
  + create    qbittorrent
  + create    radarr
  + create    seerr
  + create    sonarr
Secrets to generate: admin.password, prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey, seerr.apiKey, sonarr.apiKey
First-run setup:
  + jellyfin (with no port published until it is done)
  + seerr (with no port published until it is done)
Wiring:
  > after start jellyfin.admin
  > after start jellyfin.library_movies
  > after start jellyfin.library_shows
  > after start qbittorrent.admin
  > after start qbittorrent.preferences
  > after start qbittorrent.category_tv
  > after start qbittorrent.category_movies
  > after start radarr.admin
  > after start radarr.download_client
  > after start radarr.root_folder
  > after start radarr.connection_jellyfin
  > after start sonarr.admin
  > after start sonarr.download_client
  > after start sonarr.root_folder
  > after start sonarr.connection_jellyfin
  > after start prowlarr.admin
  > after start prowlarr.application_sonarr
  > after start prowlarr.application_radarr
  > after start prowlarr.indexer_proxy
  > after start seerr.media_server
  > after start seerr.server_sonarr
  > after start seerr.server_radarr
  > after start seerr.setup
Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 2 apps to set up, 23 wiring checks after the start.

$ mediaplane apply --yes
  … the same plan …
  done    secrets: generated admin.password, prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey, seerr.apiKey, sonarr.apiKey
  done    files: wrote generated/compose.yaml and generated/.env; created …
Pulling images (the first time can take several minutes)…
  done    images: images present
  done    appdata ownership: seerr → 1000:1000
Starting containers and waiting until every app is healthy…
  done    containers: every app is running and healthy; started jellyfin, seerr without their ports, to set them up first
Finishing first-run setup before publishing the web UIs…
  done    first-run setup: set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr
Wiring the apps…
  done    wiring jellyfin.admin: adopted
  done    wiring jellyfin.library_movies: created
  done    wiring jellyfin.library_shows: created
  done    wiring qbittorrent.admin: adopted
  done    wiring qbittorrent.preferences: adopted
  done    wiring qbittorrent.category_tv: created
  done    wiring qbittorrent.category_movies: created
  done    wiring radarr.admin: created
  done    wiring radarr.download_client: created
  done    wiring radarr.root_folder: created
  done    wiring radarr.connection_jellyfin: created
  done    wiring sonarr.admin: created
  done    wiring sonarr.download_client: created
  done    wiring sonarr.root_folder: created
  done    wiring sonarr.connection_jellyfin: created
  done    wiring prowlarr.admin: created
  done    wiring prowlarr.application_sonarr: created
  done    wiring prowlarr.application_radarr: created
  done    wiring prowlarr.indexer_proxy: created
  done    wiring seerr.media_server: updated libraries
  done    wiring seerr.server_sonarr: created
  done    wiring seerr.server_radarr: created
  done    wiring seerr.setup: updated initialized
  done    wiring: jellyfin.admin adopted; jellyfin.library_movies created; … seerr.setup updated initialized
  done    verify: no changes remain

Apply complete. Change record: 20261016T030144Z-2bc6267e

$ mediaplane apply --yes
warning: qBittorrent is running without a VPN (apps.qbittorrent.vpn: false)
  hint: peers will see your real IP address; add a vpn: block and remove vpn: false
No changes.

$ mediaplane status
APP          STATE    HEALTH
byparr       running  healthy
jellyfin     running  healthy
prowlarr     running  healthy
qbittorrent  running  healthy
radarr       running  healthy
seerr        running  healthy
sonarr       running  healthy
Last apply: 2026-10-16T03:01:44.032Z, success (20261016T030144Z-2bc6267e)

$ mediaplane credentials
Admin login for the apps:
  user name  admin
  password   … 24 letters and digits …

Jellyfin     http://127.0.0.1:8096
Prowlarr     http://127.0.0.1:9696
qBittorrent  http://127.0.0.1:8080
Radarr       http://127.0.0.1:7878
Seerr        http://127.0.0.1:5055
Sonarr       http://127.0.0.1:8989
```
