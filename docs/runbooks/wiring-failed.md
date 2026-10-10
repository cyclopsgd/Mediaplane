# Runbook: wiring failed

Wiring is what `apply` does through each app's API once the apps run: today, the shared
admin login in Sonarr, Radarr and Prowlarr, and a check that Mediaplane's key still
opens qBittorrent. Later slices add the links between the apps.

## Symptoms

- **`mediaplane apply` stops at the wiring step,** with each failed resource on its own
  line and the app's own message:

  ```console
  Wiring the apps…
    failed  wiring sonarr.admin: Sonarr at http://sonarr:8989 (172.20.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    failed  wiring
    skipped verify
  error: Sonarr at http://sonarr:8989 (172.20.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    hint: see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  error: the wiring failed for sonarr.admin
    hint: the apps' own messages are above; fix what they say, then run apply again. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md

  Apply failed: 5 done, 1 failed, 1 skipped. Run apply again to retry. Change record: 20261010T120000Z-0a1b2c3d
  ```

  An app that has no resources of its own, such as qBittorrent, fails as the app: for
  example `failed  wiring qbittorrent: …`. Later slices add resources that need others.
  One that needs a failed resource is `skipped`, and the others still run.

- **`mediaplane plan`** warns with the same message, lists the resource under `Wiring:`
  as `? unknown`, and exits 2:

  ```console
  $ mediaplane plan
  warning: Sonarr at http://sonarr:8989 (172.20.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    hint: check it with "mediaplane status sonarr", then see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  Wiring:
    ? unknown     sonarr.admin
  Plan: 1 wiring check that could not be made.
  ```

- **`apply` fails at verify** with `changes remain after apply: sonarr.admin (update)`:
  the app took the change, then kept something else.
- **`apply` stops at the containers step** with `could not leave the wiring network …`:
  it couldn't take Mediaplane off the wiring network before starting the apps, so it
  started nothing.
- **`plan` or `apply` stops** with `wire.network` (Mediaplane won't join the wiring
  network, or can't tell which container it runs in), or with `resources.invalid` (it
  can't read `state/resources.json`). `apply` can also say that the stack has no wiring
  network, or that `state/resources.json` could not be read.

In `--json` output, each `diagnostics` entry has a `code`:

- `wire.auth`: the app refused Mediaplane's key.
- `wire.rejected`: the app refused the request itself, with its message.
- `wire.server`: the app failed.
- `wire.unreachable` and `wire.timeout`: nothing answered, or not in time.
- `wire.protocol`: the app answered something Mediaplane doesn't understand.
- `wire.not-on-network`: the app's container is not on the wiring network.
- `wire.secret-field`: a managed field holds one of the stack's secrets.
- `wire.network`: Mediaplane won't join the wiring network.
- `resources.invalid`: `state/resources.json` can't be read.
- `apply.wire-failed`: the wiring step itself failed.
- `apply.start-failed`: the containers step failed. For this runbook, that is a failure
  to leave the wiring network, or Compose refusing to change it (see Fix).

`plan --json` lists each resource under `wiring`, with its `action`, the `changes` that
differ, and a `reason` when it is `unknown`.

## Checks

1. **What it says:** `mediaplane plan`, and read the `Wiring:` lines and each warning.
   `mediaplane history <id>` shows each resource's result from an apply.
2. **Whether the app runs:** `mediaplane status <app>`. An app that isn't healthy is
   checked after the start, not before.
3. **Its log,** on the host: `docker compose -p mediaplane logs --tail 100 <app>`.
4. **Who is on the wiring network,** on the host:
   `docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' mediaplane_wiring`.
   It holds the apps Mediaplane calls (Gluetun for qBittorrent, with a VPN), and, in
   the image, Mediaplane's own container. If Docker says there is no such network, see
   "No wiring network" under Fix.

## Fix

- **`refused Mediaplane's API key (HTTP 401 or 403)`.** The app's key is no longer the
  one in `state/secrets.json`.
  - **qBittorrent** keeps its key only in its file, so a key made anew in its web UI
    shuts Mediaplane out. Stop it, put the stored key back, and start it:
    `docker stop mediaplane-qbittorrent-1`, set `WebUI\APIKey=` in
    `appdata/qbittorrent/qBittorrent/qBittorrent.conf` to `qbittorrent.apiKey` from
    `state/secrets.json`, then `docker start mediaplane-qbittorrent-1`.
  - **Sonarr, Radarr and Prowlarr** get the stored key in their environment, and in
    `config.xml` before their first start. Restarting the container may put the stored
    key back, if the app prefers its environment, but that depends on the app. What works
    either way: stop the app, set `<ApiKey>` in `appdata/<app>/config.xml` to
    `<app>.apiKey` from `state/secrets.json` (use `sudo` if the file isn't yours), and
    start it. If `plan` says `<app>.not-seeded`, follow the app's README.
  - Slice 4 restores a key at its source for you.
- **`could not be reached`, `cut the connection` or `did not answer within … s`.** The
  app isn't up, or Mediaplane can't get to it.
  - Wait until `mediaplane status` shows it healthy, then run `apply` again: `apply`
    waits up to two minutes for an app that is starting, and `plan` up to 15 seconds.
  - In the image, check that Mediaplane is on the wiring network (check 4). `plan` and
    `apply` join it themselves.
- **No wiring network.** `apply` says that the stack has no wiring network, though it has
  just started it. On the host, `docker network ls` should show `<project>_wiring`,
  `mediaplane_wiring` for the usual project. A `compose.override.yaml` that sets the
  apps' `networks:` can drop it, because Compose makes only a network that some app is
  on. Take that entry out, then run `apply` again.
- **`container is not on the stack's wiring network`.** The error says the app's
  container is not on the network (`wire.not-on-network`). Something took it off, such
  as `docker network disconnect`, or a `networks:` entry in `compose.override.yaml`.
  Take out the entry, or put the container back on the host:
  `docker network connect mediaplane_wiring mediaplane-<app>-1`, or
  `mediaplane-gluetun-1` for qBittorrent behind the VPN.
- **`refused the request (HTTP 400): … Invalid Hostname`.** With
  `security.login_on_lan: false`, Sonarr, Radarr and Prowlarr take only the Host names
  Mediaplane lists in `<APP>__SERVER__ALLOWEDHOSTS`: their own name and the addresses
  their web UI is published on. If you set that variable yourself, in `apps.<app>.env`,
  keep the app's name, such as `sonarr`, in it, with commas between the names. A browser
  that uses another name, such as your host's, needs it listed there too.
- **A resource the app refused** (`refused the request`, with another HTTP status). The
  message after the status is the app's own, cut to 200 characters. Messages from Sonarr,
  Radarr and Prowlarr start with the name of the setting they didn't take. Fix that value in `stack.yaml`, then
  run `apply` again.
- **`failed (HTTP 500)`, or another 5xx.** The app failed. Read its log (check 3).
- **`answered something Mediaplane doesn't understand`.** The app answered in a shape the
  tested version doesn't. Usually that is a `version:` of your own in `apps.<app>`:
  remove it to go back to the tested image.
- **`holds one of the stack's secrets`** (`wire.secret-field`). A value that Mediaplane
  keeps in `state/resources.json`, such as `admin.username`, is the same as a key or the
  password. That file never holds a secret, so Mediaplane sets nothing in that app until
  the value is another one. Change it in `stack.yaml`, then run `apply` again.
- **`resources.invalid`.** `state/resources.json` can't be read, and Mediaplane leaves it
  as it is. Fix it from the message, or move it aside and run `plan` again. Mediaplane
  finds what it made in each app by name, adopts it, and writes the file anew at the
  next `apply`.
- **`wire.network`: `can't tell which container it runs in`.** Mediaplane looks for its
  own container in `/proc/self/mountinfo`, and the image's settings say it runs in a
  container, but it found none. Run Mediaplane with Docker as
  `deploy/mediaplane.compose.yaml` does, or from source on the host, where it joins
  nothing.
- **`wire.network`: `refusing to join mediaplane_wiring`.** The wiring network isn't the
  one Mediaplane's `compose.yaml` makes: it isn't internal or isn't a bridge network, or
  it isn't labelled as this project's `wiring` network (another project made it, or it
  was made by hand). Look for a `networks:` entry in `compose.override.yaml` that changes
  it, and take it out. Then remove the network on the host, as below.
- **`could not leave the wiring network …`** (under `apply.start-failed`). Before
  `docker compose up`, `apply` takes Mediaplane's container off the wiring network, so
  that Compose can change it if it must. When that fails, nothing is started. The
  message after the colon is Docker's. Then:
  1. On the host, run `docker network disconnect mediaplane_wiring mediaplane`.
  2. Run `mediaplane apply` again.
  3. If the socket proxy refused the call, see the `Forbidden` item in the
     [deploy guide's troubleshooting](../../deploy/README.md#troubleshooting).
- **The wiring network must be made anew,** when its settings changed, or when
  Mediaplane refused it (`wire.network`, above). When its settings changed, Compose has
  to delete the network, and through the socket proxy it can't: `apply` then stops at
  the containers step, with a message from Compose that names the network. The apps are
  on the network, so bring the stack down first (or take each container off it with
  `docker network disconnect`). On the host:

  ```bash
  docker network disconnect mediaplane_wiring mediaplane
  docker compose -p mediaplane down
  mediaplane apply
  ```

  `down` keeps every app's data, and removes the network when Compose made it. If
  `docker network ls` still shows it (it was made by hand), check that nothing you need
  is on it with `docker network inspect mediaplane_wiring`, then remove it with
  `docker network rm mediaplane_wiring`. Use the container name of your Mediaplane, as
  `docker ps` shows it. The first command may say Mediaplane is not connected when
  it isn't on the network, which is fine.

- **`docker compose -p mediaplane down` left the wiring network behind**
  (`Resource is still in use`). Mediaplane was still on it. Take it off with
  `docker network disconnect mediaplane_wiring mediaplane`, then run
  `docker compose -p mediaplane down` again. The
  [deploy guide](../../deploy/README.md#how-mediaplane-reaches-the-apps) says why, and
  how to avoid it.

Then run `mediaplane apply`. It plans again and does only what is left
([ADR 0004](../adr/0004-converge-forward-apply.md)).

## Prevention

- **Run `mediaplane plan` first.** It checks every app's key and each resource, and
  shows what `apply` would change.
- **Leave the keys as Mediaplane set them,** and don't make one anew in an app's web UI.
- **Leave the wiring network out of `compose.override.yaml`**
  ([ADR 0011](../adr/0011-a-private-wiring-network.md)).
- **Bring `mediaplane-system` down before the stack.** While Mediaplane is on the wiring
  network, `docker compose -p mediaplane down` leaves it behind ("Resource is still in
  use"). That holds after a plain `plan` too, because `plan` in the image joins the
  network. Or take Mediaplane off first, as above.
- **Keep the tested versions:** leave out `version:`.
