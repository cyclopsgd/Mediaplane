# Runbook: wiring failed

Wiring is what `apply` does through each app's API once the apps run: today, the shared
admin login in Sonarr, Radarr, Prowlarr, qBittorrent and Jellyfin, qBittorrent's settings
and its `tv` and `movies` categories, in Sonarr and Radarr, qBittorrent as their download
client, their root folders and their connection to Jellyfin, in Prowlarr, its links to
Sonarr and Radarr and its indexer proxy, in Jellyfin, its first-run setup, before its
port is published, and the Movies and Shows libraries, and in Seerr, its first sign-in
through Jellyfin, before its port is published, its links to Jellyfin, Sonarr and
Radarr, and its setup, finished. On a Plex stack, Plex is claimed for your plex.tv
account before its port is published, and gets its name and its Movies and TV Shows
libraries; Sonarr and Radarr get their connection to Plex, and Seerr signs in with your
Plex token, before its port is published, and links to Plex.

## Symptoms

- **`mediaplane apply` stops at the wiring step,** with each failed resource on its own
  line and the app's own message. An app that refuses Mediaplane's key fails all of its
  resources the same way: Sonarr has three (`admin`, `download_client` and
  `root_folder`). The plan that `apply` shows first has already warned about it, so the
  final error doesn't repeat the message (trimmed):

  ```console
  warning: Sonarr at http://sonarr:8989 (172.19.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    hint: check it with "mediaplane status sonarr", then see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  … the plan, and the steps before the wiring …
  Wiring the apps…
    done    wiring qbittorrent.admin: unchanged
    done    wiring qbittorrent.preferences: unchanged
    done    wiring qbittorrent.category_tv: unchanged
    failed  wiring sonarr.admin: Sonarr at http://sonarr:8989 (172.19.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    failed  wiring sonarr.download_client: Sonarr at http://sonarr:8989 (172.19.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    failed  wiring sonarr.root_folder: Sonarr at http://sonarr:8989 (172.19.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    failed  wiring
    skipped verify
  error: the wiring failed for sonarr.admin, sonarr.download_client, sonarr.root_folder
    hint: the apps' own messages are above; fix what they say, then run apply again. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md

  Apply failed: 8 done, 3 failed, 1 skipped. Run apply again to retry. Change record: 20261011T131435Z-439e27ae
  ```

  When the plan couldn't ask the app (it was still starting, say), each failed resource
  also prints its message as an `error:` line, with a hint.

  A resource that needs a failed one is `skipped`, and the others still run. Sonarr's
  download client needs qBittorrent's `tv` category, and Radarr's its `movies` one;
  Prowlarr's link to Sonarr needs `sonarr.admin`, and its link to Radarr `radarr.admin`.
  So when qBittorrent refuses the key, its resources fail and the download client is
  skipped (the wiring lines only):

  ```console
  Wiring the apps…
    failed  wiring qbittorrent.admin: qBittorrent at http://qbittorrent:8080 (172.19.0.2) refused Mediaplane's API key (HTTP 403): Forbidden (GET /api/v2/app/version)
    failed  wiring qbittorrent.preferences: qBittorrent at http://qbittorrent:8080 (172.19.0.2) refused Mediaplane's API key (HTTP 403): Forbidden (GET /api/v2/app/version)
    failed  wiring qbittorrent.category_tv: qBittorrent at http://qbittorrent:8080 (172.19.0.2) refused Mediaplane's API key (HTTP 403): Forbidden (GET /api/v2/app/version)
    done    wiring sonarr.admin: unchanged
    skipped wiring sonarr.download_client: qbittorrent.category_tv failed
    done    wiring sonarr.root_folder: unchanged
  ```

  A resource can fail on its own, while its app's others are done. Here Prowlarr couldn't
  add its indexer proxy, because Byparr couldn't reach the page Prowlarr's test of a new
  proxy asks for (trimmed):

  ```console
  Wiring the apps…
    …
    done    wiring prowlarr.admin: unchanged
    done    wiring prowlarr.application_sonarr: unchanged
    done    wiring prowlarr.application_radarr: unchanged
    failed  wiring prowlarr.indexer_proxy: Prowlarr at http://prowlarr:9696 (172.20.0.4) refused the request (HTTP 400): Host: Unable to connect to proxy: HTTP request failed: [502:BadGateway] [POST] at [http://byparr:8191/v1]. Check the log surrounding this error for details (POST /api/v1/indexerproxy)
    failed  wiring
    skipped verify
  ```

- **`mediaplane apply` stops at the first-run setup step,** before the wiring. Jellyfin's
  startup wizard is finished there, before its port is published. A Jellyfin whose
  wizard is still open stays unpublished, and so does one whose wizard didn't look done
  when `apply` started it but now refuses the shared admin. One whose wizard Mediaplane
  finished, or that was done before `apply` started it, is published all the same. The
  step's line, then its error (trimmed):

  ```console
  Finishing first-run setup before publishing the web UIs…
    failed  first-run setup
    skipped wiring
    skipped verify
  error: the first-run setup failed: Jellyfin at http://jellyfin:8096 (172.19.0.5) refused the shared admin's sign-in: its startup wizard was finished with another login (POST /Users/AuthenticateByName)
    hint: fix what the error says, then run apply again: an app whose setup is still open keeps its ports unpublished until then. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  ```

- **`mediaplane apply` warns that Seerr's setup waits** (`bootstrap.waiting`), then fails
  at verify with `seerr (first-run setup)` among what remains. Seerr signs in through
  Jellyfin, as the shared admin, and Jellyfin refused that login. Seerr stays
  unpublished; the rest of the stack is wired, and each of Seerr's resources is
  `skipped`:

  ```console
    done    first-run setup: seerr waits: Seerr at http://seerr:5055 (172.19.0.6) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)
    …
    skipped wiring seerr.media_server: seerr's first-run setup waits
  ```

- **`mediaplane apply` stops at the containers step** on a Plex stack, before any
  container starts, with
  `Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started`
  or `Plex can't be claimed: Mediaplane has no Plex token, so nothing was started`. Plex
  starts unpublished, with a claim token of your plex.tv account that `apply` fetches
  the moment before, and here it had none to give. Every app that runs and isn't yet
  shown to be yours, Plex, and Seerr, is stopped, so that it isn't left published: a
  Plex that an `apply` before Slice 7 published unclaimed, say, or a Seerr set up by
  hand then. The message names each app it stopped
  (`Mediaplane stopped plex and seerr, which ran, but aren't shown to be yours`), or,
  when they couldn't be stopped, says that, and you stop them yourself.
- **`mediaplane apply` stops at the first-run setup step** on a Plex stack, with Plex
  unpublished, and an error such as `didn't claim itself as it started`,
  `is claimed by another plex.tv account than yours`,
  `is claimed, and Mediaplane couldn't tell whether by your plex.tv account`, or
  `is yours, but` and a setting that lets a client in without a sign-in
  (`allowedNetworks`, `enableLocalSecurity` or `DlnaEnabled`). Plex is published only
  once plex.tv says the token its claim gave it is your account's, and none of those
  settings lets a client in without a sign-in. Plex's setup asks Plex without your
  token: the one read of its settings, once plex.tv has said it is yours, is the first
  call that carries it.
- **`plan` warns `bootstrap.open-published`** (`Plex runs published, though its
first-run setup isn't shown to be done`): Plex was signed out of your plex.tv account
  while it ran, as its web UI's sign-out does, and anyone who reaches it can claim it now. Run
  `apply` at once: it starts Plex again without its ports, claims it for your account
  through Plex's own API (its image doesn't claim a Plex signed out so), and publishes it
  once it is shown to be yours. If that fails with
  `was signed out of its plex.tv account, and Mediaplane couldn't get a claim token`,
  Plex stays unpublished: check your token, as below, and run `apply` again.
- **Sonarr, Radarr and Seerr still hold your old Plex token** after
  `mediaplane plex-login --force`: they keep one that works. Run
  `mediaplane apply --rotate plex.token`: it gives the new token to both arrs'
  connections, and signs Seerr in again with it (`First-run setup:` lists Seerr,
  "signing in again"). A token of another plex.tv account is given to no app, and Seerr's
  sign-in fails with `has an admin of another plex.tv account than your new Plex token's`,
  still holding its old token: put back a token of its admin's account (run
  `plex-login --force`, signing in as that account), and run `apply --rotate plex.token`
  again.
- **`apply` stops at the same step** with a setup that reported success. Before
  publishing an app, Mediaplane asks it once more whether its setup is still open, and
  publishes it only if it is not. Jellyfin's key is already kept. The error:

  ```console
  error: the first-run setup failed: Jellyfin's setup reported success, but the app still looks open (or can't be asked), so it stays unpublished
  ```

- **`mediaplane plan` warns that it can't read a setup's file** (`bootstrap.unreadable`):

  ```console
  warning: Mediaplane can't read the file in Jellyfin's appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; the stored key decides
    hint: check the permissions of appdata/jellyfin
  ```

  For Seerr, which has no key to decide, `plan` warns that it starts unpublished, and
  `apply` fails at verify (exit 1) on every run, until the file is readable:

  ```console
  warning: Mediaplane can't read the file in Seerr's appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; Seerr starts unpublished, and is set up again, until it can
    hint: check the permissions of appdata/seerr
  …
  error: changes remain after apply: seerr (first-run setup)
  ```

- **`mediaplane plan` fails** with an app whose first-run setup is in another app's
  network (`bootstrap.network-via`). No app in the catalog does this today:

  ```console
  error: Jellyfin has a first-run setup but runs inside <app>'s network, which publishes its ports: Mediaplane can't keep it unpublished until it is set up
    hint: run Jellyfin in its own network
  ```

- **`mediaplane plan`** warns with the same message, once for the app, and exits 2. It
  lists each of the app's resources under `Wiring:` as `? unknown` when the app refuses
  the key. When it refuses one resource only, the app's others are still checked. An app
  that stops answering, or keeps failing with a 502, 503 or 504, leaves all that is left
  of it `unknown`, so `plan` waits for it once:

  ```console
  $ mediaplane plan
  warning: Sonarr at http://sonarr:8989 (172.19.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    hint: check it with "mediaplane status sonarr", then see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  Wiring:
    ? unknown     sonarr.admin
    ? unknown     sonarr.download_client
    ? unknown     sonarr.root_folder
  Plan: 3 wiring checks that could not be made.
  ```

- **`apply` fails at verify** with `changes remain after apply: sonarr.admin (update)`:
  the app took the change, then kept something else. For a download client, verify runs
  the arr's own test of it: a failure there is `sonarr.download_client (unknown: …)`,
  with the arr's own words after `tested qBittorrent (Mediaplane), and it failed:`. For
  Prowlarr's links, it runs Prowlarr's test: a failure is
  `prowlarr.application_sonarr (unknown: …)`, with Prowlarr's own words after
  `tested Sonarr (Mediaplane), and it failed:`.
- **`apply` stops at the containers step** with `could not leave the wiring network …`,
  `docker network inspect failed: …`, or
  `docker network inspect printed a line that is not …`. Before starting the apps, it
  couldn't read the wiring network, or couldn't take Mediaplane off it, so it started
  nothing. The first-run setup step takes Mediaplane off the network too, before it
  publishes the apps. When that fails, `apply` stops there with the same message, and
  this hint, which says that nothing was published:

  ```console
  hint: Mediaplane steps off the stack's wiring network before Compose publishes the apps, and couldn't, so nothing was published; fix what the error says, then run apply again. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  ```

- **`plan` or `apply` stops** with `wire.network` (Mediaplane won't join the wiring
  network, Docker refused the join, or Mediaplane can't tell which container it runs
  in), or with `resources.invalid` (it can't read `state/resources.json`). `apply` can
  also say that the stack has no wiring network, or that `state/resources.json` could
  not be read.

In `--json` output, each `diagnostics` entry has a `code`:

- `wire.auth`: the app refused Mediaplane's key, or qBittorrent refused its sign-in (see
  its ban, below).
- `wire.rejected`: the app refused the request itself, with its message.
- `wire.server`: the app failed.
- `wire.unreachable` and `wire.timeout`: nothing answered, or not in time.
- `wire.protocol`: the app answered something Mediaplane doesn't understand.
- `wire.not-on-network`: the app's container is not on the wiring network.
- `wire.secret-field`: a managed field holds one of the stack's secrets.
- `wire.folders`: a folder a resource needs, such as a root folder, couldn't be made.
- `wire.network`: Mediaplane won't join the wiring network, or Docker refused the join.
- `resources.invalid`: `state/resources.json` can't be read.
- `bootstrap.unreadable` (a warning): Mediaplane can't read an app's setup-done file, so
  it can't tell whether the setup is open. Jellyfin has its stored key to decide. Seerr
  has none, since Mediaplane makes its key: only its file and Mediaplane's record
  (`setUp` in `state/secrets.json`) can say it is done, and a file Mediaplane can't read
  says nothing. So Seerr starts unpublished and is set up again, and `apply` fails at
  verify (exit 1) on every run, until the file is readable.
- `bootstrap.waiting` (a warning): an app's first-run setup waits for another app, as
  Seerr's waits for Jellyfin to take the shared admin; the rest is wired without it.
- `bootstrap.network-via` (an error): an app with a first-run setup runs inside another
  app's network.
- `apply.bootstrap-failed`: the first-run setup step failed.
- `apply.wire-failed`: the wiring step itself failed.
- `apply.start-failed`: the containers step failed. For this runbook, that is a failure
  to read or leave the wiring network, or Compose refusing to change it (see Fix).

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
5. **Whether an app's first-run setup is done, and whether it is published,** for
   Jellyfin:
   - `mediaplane plan` lists an app that is still to be set up under `First-run setup:`,
     and warns with `bootstrap.unreadable` when it can't tell;
   - on the host, `docker port mediaplane-jellyfin-1` prints nothing while Jellyfin is
     not published;
   - `grep IsStartupWizardCompleted appdata/jellyfin/system.xml` says `true` once its
     wizard is done;
   - `ls -l appdata/jellyfin/system.xml` shows whether the user Mediaplane runs as can
     read it (`MEDIAPLANE_UID` in the image, or your own user from source);
   - for Seerr, `docker port mediaplane-seerr-1` likewise, and
     `grep mediaServerType appdata/seerr/settings.json` says `2` (Jellyfin) or `1` (Plex)
     once its first sign-in is done, `4` before; `ls -l appdata/seerr/settings.json` and
     `ls -ld appdata appdata/seerr` show whether the user Mediaplane runs as can read it;
   - for Plex, `docker port mediaplane-plex-1` likewise, and
     `grep -c PlexOnlineToken "appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml"`
     prints `1` once Plex is claimed, `0` before (it counts, and prints no token); Plex's
     log (check 3) says why a claim failed;
   - `mediaplane history <id>` shows the first-run setup step's result and error.
6. **Whether your Plex token works:** `mediaplane plex-login` keeps a saved token that
   plex.tv still takes, or can't say about, and says which, without opening a sign-in. Your plex.tv account's
   devices (in Plex's web app, Settings, Authorized Devices) list each Plex claimed for
   it, by the name Mediaplane gives it (`Mediaplane`, or `apps.plex.server_name`).

## Fix

- **`refused Mediaplane's API key (HTTP 401 or 403)`.** The app's key is no longer the
  one in `state/secrets.json`: a key changed at its source. The
  [rebuilding a host runbook](rebuilding-a-host.md#a-key-changed-at-its-source) has the
  details.
  - **qBittorrent** keeps its key only in its file, which its web UI writes when it makes
    a new key. Run `apply`: it stops qBittorrent, puts the stored key back in
    `appdata/qbittorrent/qBittorrent/qBittorrent.conf`, and starts it again. Or keep
    qBittorrent's own key: `mediaplane keep qbittorrent.apiKey`, then `apply`, which gives
    it to Sonarr's and Radarr's download clients.
  - **Sonarr, Radarr, Prowlarr and Seerr** take the stored key from their environment at
    every start, and their web UIs can't change it then. One that refuses it was given
    another by hand, such as an `<APP>__AUTH__APIKEY` or `API_KEY` in
    `compose.override.yaml`: take that out, and run `apply`.
  - **Jellyfin** makes its own key. One deleted in its dashboard (API Keys) shuts
    Mediaplane out of every Jellyfin resource, and `plan` shows them as `? unknown`, with
    this message, and lists Jellyfin's first-run setup again,
    `signing in as the admin, to make its key`. Run `apply`: Jellyfin is still set up, so
    Mediaplane signs in as the shared admin, with its port published, takes the newest
    key named `Mediaplane` or makes one, keeps it, and gives it to Sonarr's and Radarr's
    connections, whose own test refuses the old one (`updated apiKey`). That needs the
    password Jellyfin's admin has.
  - `mediaplane drift` reports a key changed at its source, on the app and on each
    resource that holds it, and keeps that the app refused it: neither drift nor `plan`
    sends the app that key again until `apply` checks it.
- **`refused the request (HTTP 403)`, with
  `banned after too many failed authentication attempts`** (`wire.auth`). qBittorrent
  stops an address from signing in for an hour after five failed sign-ins in a row.
  Mediaplane checks qBittorrent's password by signing in: each `plan`, and each `apply`'s
  own plan, signs in once, and fails while qBittorrent's password differs from the
  stack's, such as after `admin.password` changed. Mediaplane doesn't send a sign-in
  again once it may have reached qBittorrent, such as after a timeout, so each costs at
  most one failure. So four `plan`s, or declined `apply`s, before the `apply` are enough:
  it sets the password with the key, but its last check is refused, and it stops at
  verify with `changes remain after apply: qbittorrent.admin (unknown: …)`, which holds
  the message above. After five or more, `apply`'s own plan is already refused, and it
  stops earlier, at the wiring step, with `failed  wiring qbittorrent.admin:` and the same
  message, before it sets the password. `plan` warns with the same message. Its key still
  works, and only Mediaplane's address is banned, not your browser's. Wait an hour, or
  restart qBittorrent, which forgets the ban (`docker restart mediaplane-qbittorrent-1`),
  then run `apply` again: it sets the password if it hasn't yet, and its check then
  passes. Once `mediaplane drift` has found the password refused, neither drift nor `plan`
  signs in again until `apply` sets it, so running `mediaplane drift` first spares the
  failures.
- **`Host: Unable to connect to qBittorrent`.** Sonarr or Radarr can't reach qBittorrent.
  Behind the VPN they reach it through Gluetun, as `gluetun`, at qBittorrent's port:
  check that both run and are healthy (`mediaplane status`), and that the VPN is up
  (`mediaplane vpn-check`). A `compose.override.yaml` that takes Sonarr, Radarr or
  Gluetun off the stack's network breaks it too. Fix that, then run `apply` again. A
  failure that names `ApiKey` is never this one: Mediaplane puts qBittorrent's key back
  itself. The message takes one of two forms:
  - from `plan`, verify, or `apply` checking a client the arr holds, it follows
    `tested qBittorrent (Mediaplane), and it failed:`;
  - when `apply` makes the client, since the arr tests a new client before it saves
    it: `refused the request (HTTP 400): Host: Unable to connect to qBittorrent`.
- **`refused the shared admin's sign-in: its startup wizard was finished with another login`**
  (`apply.bootstrap-failed`). Jellyfin's startup wizard was finished with a login other
  than the shared admin's. Mediaplane can't make Jellyfin's key, and until it can,
  `apply` wires no app. What follows the message says when the wizard was finished:
  - **Nothing follows it:** the wizard was done before this `apply` started Jellyfin,
    by hand, from before Slice 5, say. Jellyfin is published and belongs to whoever
    finished its wizard. If you finished it, either set `admin.username`, and
    `admin.password` to a file of your own, to Jellyfin's admin login, and run `apply`
    again (the other apps take that login too), or start Jellyfin afresh, as below.
    With the login fixed, a library of yours named Movies or Shows becomes
    Mediaplane's: `plan` shows its folders changing, so rename it first to keep it. If
    you did not finish it, or can't tell, start Jellyfin afresh.
  - **`Jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished`**
    follows it: `apply` started Jellyfin unpublished, and Jellyfin stays so. There are
    two causes, and the rest of the message says which. Check the safe one first:
    - **`Mediaplane can't read appdata/jellyfin/system.xml`:** this may be a Jellyfin
      you set up yourself, whose file Mediaplane can't read (see
      `bootstrap.unreadable` below). Don't start it afresh, which would lose its
      database. Make the file readable by Mediaplane, or set `admin.username`, and
      `admin.password` to a file of your own, to its admin login, then run `apply`
      again.
    - **`its setup was finished with another login while Mediaplane set it up`:** the
      wizard was open when `apply` started Jellyfin, and something else reached it and
      finished it before Mediaplane could. That is a container on the stack's networks,
      or a way in that an override opened. With `and the next apply would publish it`,
      its `system.xml` now says the wizard is done. If you finished it yourself, set the
      admin login as above. If you did not, start Jellyfin afresh before you run `apply`
      again, and find which container reached it.
  - To start Jellyfin afresh, stop it (`docker stop mediaplane-jellyfin-1`), remove
    `appdata/jellyfin` (with `sudo` if it isn't yours), and run `apply`, which sets it
    up anew. That loses Jellyfin's database and settings, but not your media.
- **`its startup wizard has a first user that Mediaplane did not set, so Mediaplane left the wizard open`**
  (`apply.bootstrap-failed`). Someone set Jellyfin's first user before Mediaplane could,
  so Mediaplane didn't complete the wizard for them, and Jellyfin stays unpublished.
  Start Jellyfin afresh, as above, and run `apply`.
- **`has no user admin`, for `jellyfin.admin`.** The shared admin's user isn't in
  Jellyfin by that name: it was removed, or renamed while Mediaplane had no record of it.
  Rename it back in Jellyfin, or set `admin.username` to its name, and run `apply`
  again. Mediaplane makes Jellyfin's admin only in its startup wizard.
- **`has a library named Shows that holds mixed content, not tvshows`** (or Movies).
  Jellyfin has a library of that name, made by hand, which holds something else, and
  Jellyfin can't change what a library holds. Rename it or remove it in Jellyfin's
  dashboard, then run `apply`, which makes the library anew.
- **`Host: Unable to send test message`, for `<arr>.connection_jellyfin`.** Sonarr or
  Radarr can't reach Jellyfin at `jellyfin:8096`: check that Jellyfin runs and is
  healthy (`mediaplane status jellyfin`). A `compose.override.yaml` that takes either off
  the stack's network breaks it too. Fix that, then run `apply` again. A failure that
  names `ApiKey` is never this one: Mediaplane gives the arr Jellyfin's key again itself.
  From `plan`, verify, or `apply` checking a connection the arr holds, it follows
  `tested Jellyfin (Mediaplane), and it failed:`; when `apply` makes the connection, the
  arr tests it before it saves it, so it follows `refused the request (HTTP 400):`. While
  Jellyfin is still to be set up, or refuses its key, `plan` doesn't run the test.
- **`the app still looks open (or can't be asked), so it stays unpublished`**
  (`apply.bootstrap-failed`). The setup finished, and Mediaplane kept the key, but the
  re-check before publishing says Jellyfin's wizard is still open, or Jellyfin didn't
  answer it: then Jellyfin's own error follows. Jellyfin is not published. Read
  Jellyfin's log (check 3), check that it is healthy (`mediaplane status jellyfin`),
  and run `apply` again. If its wizard stays open, start Jellyfin afresh, as above.
- **`the app still looks open (or can't be asked), and it is published`**
  (`apply.bootstrap-failed`). The same re-check failed for a Jellyfin that `apply`
  started published, since its `system.xml` said the wizard was done. Its wizard may be
  open to anyone who reaches its port: stop it as the message says
  (`docker stop mediaplane-jellyfin-1`), then start Jellyfin afresh, as above.
- **`made no key named Mediaplane`** (`apply.bootstrap-failed`). Jellyfin's wizard is
  done and Mediaplane signed in, but Jellyfin's list of keys has none named `Mediaplane`
  after it made one. Jellyfin is published. Read its log (check 3), then run `apply`
  again: it signs in as the shared admin and tries again.
- **`can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password`**
  (`bootstrap.waiting`). Seerr's first sign-in goes through Jellyfin, as the shared
  admin, and Jellyfin's admin has another password: after `admin.password` changed, or
  one changed in Jellyfin's dashboard. The same `apply` sets it again in Jellyfin
  (`jellyfin.admin`), so run `apply` again, and it signs Seerr in. If `jellyfin.admin`
  failed too, fix that first, as its own message says. Seerr stays unpublished until
  then. Mediaplane asks Seerr once more after it waits: if someone else set Seerr up in
  the meantime, the setup fails with the message below instead, and Seerr stays
  unpublished.
- **`Seerr waits for Jellyfin's first-run setup, which isn't done`** (or Plex's).
  Jellyfin's setup, or Plex's, failed in the same `apply`, so Mediaplane didn't try
  Seerr's, which goes through it. Fix that error, which comes first, then run `apply`
  again.
- **`refused the request (HTTP 404): INVALID_URL (POST /api/v1/auth/jellyfin)`**
  (`apply.bootstrap-failed`). Seerr can't reach Jellyfin at `jellyfin:8096`, with no
  URL base and no TLS, on the stack's network. Check that Jellyfin is healthy
  (`mediaplane status jellyfin`), and that no `compose.override.yaml` takes Jellyfin or
  Seerr off the stack's network, then run `apply` again. Seerr stays unpublished. So
  it does when its setup fails in any other way, even if Seerr then looks set up:
  Seerr's key is Mediaplane's own, so nothing but a setup that succeeds shows that Seerr
  is Mediaplane's.
- **`plex.token: file secrets/plex-token is missing, empty or unreadable`**
  (`secret.missing`, from `plan`, and from the plan `apply` makes first). Mediaplane has
  no Plex token. Run `mediaplane plex-login`, which signs you in to plex.tv and saves
  your token there, then run `apply` again.
- **`Plex can't be claimed: Mediaplane has no Plex token`.** The same, found at the
  containers step: the token file went missing after the plan. Run
  `mediaplane plex-login`, then run `apply` again. Nothing was started, and a Plex or a
  Seerr that ran is stopped (see Symptoms).
- **`needs a claim token from plex.tv, which Mediaplane couldn't get`.** Nothing was
  started, and a Plex or a Seerr that ran is stopped (see Symptoms); the next `apply`
  that gets a claim token starts them again, unpublished. Only a 401 from plex.tv is a refusal of your
  token. What follows the colon says which:
  - `plex.tv refused the Plex token (HTTP 401)`: it was revoked (signed out of every
    device, or the password changed), or it is not one. Run `mediaplane plex-login` to
    sign in again; it replaces a token plex.tv refuses. Then run `apply` again.
  - Anything else: plex.tv didn't answer (`could not be reached`,
    `did not answer within …`), answered with an error of its own (HTTP 5xx), asked
    Mediaplane to wait (HTTP 429), refused the request in a way that isn't about the
    token (HTTP 403, as a firewall or a geo-block may), or the call failed on the way
    (`the plex.tv helper did not finish within …`, `the plex.tv helper failed: …`, or
    `the call to plex.tv failed (…)`). Mediaplane can't tell whether your token works,
    so it starts nothing. In the image, the call goes from a short-lived helper on
    Docker's default `bridge` network: check that containers there reach the internet
    (a firewall, or `"bridge": "none"` in Docker's `daemon.json`, stops them), then run
    `apply` again. A 403 that won't clear may be about your plex.tv account instead:
    check that it may claim a server, as the hint says.
- **`didn't claim itself as it started, so it stays unpublished`.** Plex had its claim
  token, but didn't trade it at plex.tv while `apply` waited: it couldn't reach plex.tv,
  or the token, which lasts four minutes, ran out first. Plex's log (check 3) says which.
  Run `apply` again: it fetches a new claim token, and starts Plex with it, unpublished.
  If `plan` also warns that it can't read Plex's `Preferences.xml`, fix that first
  (check appdata's owner against `user:`): Mediaplane fetches no claim token for a Plex
  whose file it can't read.
- **`is claimed, and Mediaplane couldn't tell whether by your plex.tv account`.** plex.tv
  didn't answer (a timeout, an error of its own, no connection), asked Mediaplane to wait
  (HTTP 429), refused the request in a way that isn't about a token (HTTP 403), or the
  call to it failed on the way (the plex.tv helper, or Docker). Run `apply` again first:
  Plex stays unpublished until plex.tv says it is yours.
- **`is claimed, and its Preferences.xml holds no token of its claim`.** Plex says it is
  claimed, but its file doesn't hold the token its claim gave it, so nothing can tell
  whose it is. Run `apply` again; if it says the same, follow the ways out of
  `is claimed by another plex.tv account than yours`, below, the safe ones first.
- **`is claimed, and Mediaplane can't read appdata/plex/… (…) to tell by whose plex.tv account`.**
  First check who owns `appdata/plex` and the `Preferences.xml` in it (`ls -ln`) against
  `user:` in `stack.yaml`: Plex writes the file 0600, as `user:`, so Mediaplane must run
  as that user (in the image, `MEDIAPLANE_UID`). Give the folder back to `user:`, or run
  Mediaplane as it, then run `apply` again. While it can't read the file, `apply` gets
  Plex no new claim token, so it doesn't recreate Plex on every run.
- **`plex.tv's answer doesn't say by whose account`.** plex.tv answered in a shape
  Mediaplane doesn't understand, or the plex.tv helper printed an answer it doesn't
  understand (a protocol error, not "couldn't tell"), so Plex stays unpublished. Run
  `apply` again; if it says the same, plex.tv may have changed, and the ways out of
  `is claimed by another plex.tv account than yours`, below, still apply.
- **`is yours, but …`, naming `allowedNetworks`, `enableLocalSecurity` or
  `DlnaEnabled`.** Plex is yours, but one of its settings lets a client in without a
  sign-in. Mediaplane never sets them, and anyone who reached Plex while it was
  unclaimed could have, and they survive the claim. So Plex stays unpublished, on every
  `apply` until each is safe:
  - `lets … in without a sign-in (allowedNetworks)`: its list of networks allowed
    without auth isn't empty;
  - `has enableLocalSecurity at …, not -1 or 1`: it may let a local client in without a
    sign-in. Plex's default, `-1`, refuses a client that hasn't signed in (probed on a
    claimed Plex);
  - `has DlnaEnabled at …, not false`: DLNA is on, and DLNA streams without a sign-in.

  Stop Plex (`mediaplane status plex` names its container: `docker stop` it). In
  `appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml`, delete
  each attribute the message names, or set it to its default as the file writes it:
  `allowedNetworks=""`, `enableLocalSecurity="-1"`, `DlnaEnabled="0"`. Then run
  `apply`. Mediaplane checks these only before Plex is first published, never on later
  applies: one you set afterwards, in Plex's settings, is left alone.

- **`plex.tv refused your Plex token when asked whose it is`.** Run
  `mediaplane plex-login` to sign in again, then run `apply` again.
- **`is claimed by another plex.tv account than yours`**, or
  **`is claimed by no plex.tv account of yours`** (`apply.bootstrap-failed`). Plex holds
  a claim, and plex.tv says the token its claim gave it is another account's, or refuses
  it (as it does once the server is removed from its account). It stays unpublished, on
  every `apply` until it is yours. It was claimed before Mediaplane came to it: by
  someone who reached it while it was unclaimed, or by you, with another account, by
  hand. Three ways out, the safe ones first:
  - If that plex.tv account is yours too, run `mediaplane plex-login --force` and sign in
    as it (without `--force`, `plex-login` keeps a saved token plex.tv still takes),
    then run `apply` again. Plex and everything it holds stay as they are.
  - Or keep what Plex holds, and claim it for your account: stop it
    (`docker stop mediaplane-plex-1`, as the message names it), and in
    `appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml`
    remove every attribute whose name starts with `PlexOnline` (such as
    `PlexOnlineToken="…"`), then run `apply`. It starts Plex unpublished with a claim
    token of yours; Plex keeps its libraries and its machine identifier.
  - Last, only if you don't need what it holds: stop it, remove `appdata/plex`, and
    run `apply`. That loses Plex's libraries' metadata and its watch history, but none
    of your media.
- **`refused Mediaplane's API key (HTTP 401 or 403)`, for Plex.** Plex's key is your Plex
  token, and Plex checks it with plex.tv: the token was revoked, or Plex was claimed
  for another account since. Run `mediaplane plex-login`; if the error stays, see
  `is claimed by another plex.tv account than yours` above.
- **`Plex at http://plex:32400 … is still starting (GET /identity)`.** Plex answers
  before it has started for good, and takes no change until then. Run `apply` again.
- **`has a library named Movies that holds …, not movie`** (or TV Shows, not show).
  Plex can't change what a library holds. Rename or remove that library in Plex, and the
  next `apply` makes `Movies` (or `TV Shows`) again, on the stack's folder.
- **`AuthToken: Authentication Token is invalid`, for `<arr>.connection_plex`.** The arr's
  own test of its connection to Plex failed. First check that the connection holds the
  stack's token: a token changed by hand in the arr is refused, and `apply` sets the
  stack's back, so run `apply` again. If it fails the same way with the stack's token,
  Plex refuses your token too. Run `mediaplane plex-login`: it replaces a token plex.tv
  refuses, with no `--force` needed. If it says the token works, plex.tv still takes it,
  and Plex was claimed for another account since: see
  `is claimed by another plex.tv account than yours`, above, where `--force` is the way
  to sign in as another account.
- **`Host: Unable to connect to Plex Media Server`, for `<arr>.connection_plex`.** Sonarr
  or Radarr can't reach Plex at `plex:32400`. Check that Plex is healthy
  (`mediaplane status plex`), and that no override takes either off the stack's network.
- **`At least one TV library is required`** (Sonarr) or
  **`At least one Movie library is required`** (Radarr), for `<arr>.connection_plex`.
  The arr's test needs a Plex library of its kind, which `plex.library_tv` (or
  `library_movies`) makes first: it was removed in Plex meanwhile. Run `apply` again,
  which makes it.
- **`plan` shows `<arr>.connection_jellyfin` or `<arr>.connection_plex` to update,**
  with a `host` that is a whole URL, such as `https://jellyfin:8096`. The connection was
  set by hand to use TLS or a URL base, and Mediaplane reads that as moved: it sends the
  key only to the stack's own address. The next `apply` puts back the media server's
  service and port, without TLS or a URL base.
- **`couldn't sign in with your Plex token, which it checks at plex.tv`**, for Seerr.
  Seerr asks plex.tv whose your token is, and couldn't. Check that Seerr reaches the
  internet (it does from the stack's own network), and that `mediaplane plex-login` keeps
  your token, then run `apply` again. Seerr stays unpublished until then.
- **`signed Mediaplane in as a user that isn't its admin, so someone set it up before Mediaplane did`**,
  for Seerr (`apply.bootstrap-failed`), through Jellyfin or with your Plex token alike.
  Seerr's first sign-in makes its admin, so Mediaplane's must be its first user. This
  one wasn't: someone signed in between Mediaplane's look at Seerr and its sign-in.
  Mediaplane signs out again, and Seerr stays unpublished, as one set up by someone
  else. The message ends with the ways out, the safe ones first, as for
  `was set up with another …`, below. If Seerr couldn't say whose the session is, the
  message says `couldn't tell whether as its admin` instead: run `apply` again first.
- **`was set up with another plex.tv account or another Plex`**, for Seerr
  (`apply.bootstrap-failed`). Seerr was set up already, and its admin (its first user)
  isn't your plex.tv account, as plex.tv says your token is, or its Plex is set and isn't
  `plex:32400` without TLS. Mediaplane asks it with Seerr's key, and never signs in to it,
  which would hand your token to whoever set it up. Seerr stays unpublished. The common
  case is a Seerr set up by hand on a Plex stack before Slice 7, as Seerr's README said
  then: its Plex is the one Seerr's own list offered, a LAN address or a `plex.direct`
  URL with TLS. The safe ways out first:
  - If that plex.tv account is yours, run `mediaplane plex-login --force` and sign in as
    it (without `--force`, `plex-login` keeps the saved token, of your other account,
    since plex.tv still takes it), then run `apply` again.
  - If Seerr's Plex is set and isn't `plex`, port 32400, without TLS: Seerr is
    unpublished, so its web UI can't be reached to change it. Stop Seerr
    (`docker stop mediaplane-seerr-1`, for the stack `mediaplane`), and in
    `appdata/seerr/settings.json` set `plex.ip` to `"plex"`, `plex.port` to `32400` and
    `plex.useSsl` to `false`, then run `apply`. Seerr reads the file as it starts, and
    writes it back when its settings change, so edit it only while Seerr is stopped,
    and keep it valid JSON.
  - Last, if you did not set Seerr up, start it afresh, as below.

  On a Plex stack, `is set up, and Mediaplane couldn't tell whether it is its own` and
  `its answers don't show that it is Mediaplane's` mean what they mean below: the first
  covers plex.tv not answering too, as for Plex above. And
  `plex.tv refused your Plex token when asked whose it is` means: run
  `mediaplane plex-login`, then `apply` again.

- **Seerr is set up, but Mediaplane can't show that it is its own**
  (`apply.bootstrap-failed`). The message says
  `was set up with another login or another Jellyfin`,
  `its answers don't show that it is Mediaplane's`, or
  `is set up, and Mediaplane couldn't tell whether it is its own`. Seerr
  was already set up when Mediaplane came to it: it looked open when `apply` started it
  but was set up before its sign-in, or it is a Seerr from before Slice 6, or one
  Mediaplane has no record of (`setUp` in `state/secrets.json`). Mediaplane never sends
  the password to such a Seerr, which would pass it on to its Jellyfin; it asks with
  Seerr's key. It counts Seerr as its own only when Seerr's admin (its first user) is
  the Jellyfin login `admin.username` names and its Jellyfin is `jellyfin:8096`, with
  no URL base and no TLS (a URL base such as `@<host>` takes Seerr to another host).
  Otherwise Seerr stays unpublished, on every `apply` until Mediaplane can show that it
  is its own. What the message says decides what to do:
  - **`couldn't tell whether it is its own`:** one of the two questions went
    unanswered (a timeout, an error of Seerr's, no connection), and the message says
    how. Run `apply` again first: a failure that was temporary clears the
    next time, and Seerr, if it is Mediaplane's, is then recorded and published. If it
    fails again, read Seerr's log (check 3).
  - **`was set up with another login or another Jellyfin`**, or
    **`its answers don't show that it is Mediaplane's`:** Seerr answered, and its admin
    or its Jellyfin is not the stack's, or its answer doesn't show they are (a port
    that isn't a number, say). Three ways out, the safe one first:
    - If the Jellyfin login Seerr was set up with is yours, set `admin.username` and
      `admin.password` to it. This works only if Seerr's Jellyfin is already
      `jellyfin:8096`, with no URL base and no TLS.
    - Or make Seerr's first user the Jellyfin login `admin.username` names, with
      Seerr's Jellyfin already at `jellyfin:8096`, with no URL base and no TLS.
    - Or, if you did not set Seerr up, start it afresh: stop it
      (`docker stop mediaplane-seerr-1`), remove `appdata/seerr` (with `sudo`: uid 1000
      owns it), and run `apply`. That loses Seerr's requests and users, but nothing in
      the other apps.

  Then run `apply` again. It checks Seerr once, unpublished, records it in
  `state/secrets.json`, and publishes it from then on.

- **`can't reach Sonarr at http://sonarr:8989`** (or Radarr), for `seerr.server_sonarr`
  or `seerr.server_radarr`. Seerr's own test of the server fails, with the key it holds
  and with the stack's: Seerr can't reach the arr, whatever the cause (it says only
  "Failed to connect"). Check that the arr is healthy (`mediaplane status sonarr`), and
  that no override takes either off the stack's network, then run `apply` again. A key
  that Seerr held wrong is never this one: Mediaplane finds it with the second test, and
  sets it.
- **`Sonarr has no quality profile named …, which apps.seerr.sonarr_profile names`** (or
  Radarr). The profile in `stack.yaml` isn't one of the arr's: the message lists the
  arr's. Set `apps.seerr.sonarr_profile` to one of them, or remove it for the default
  (`HD-1080p`, else `Any`, else the arr's first), then run `apply`.
- **`finds no Jellyfin library named Shows`** (or Movies), for `seerr.media_server`.
  Seerr synced Jellyfin's libraries, and none had the name. Check that Seerr's Jellyfin
  is the stack's (Seerr's settings, Jellyfin: `jellyfin`, port 8096), and that the
  library is in Jellyfin's dashboard, as `jellyfin.library_shows` keeps it, then run
  `apply` again.
- **`finds no Plex library named TV Shows`** (or Movies), for `seerr.media_server_plex`.
  The same, on a Plex stack: check that Seerr's Plex is the stack's (`plex`, port 32400),
  and that the library is in Plex, as `plex.library_tv` keeps it, then run `apply` again.
- **`plan` shows `seerr.media_server` or `seerr.media_server_plex` to create,** though
  Seerr's settings show a server. Seerr keeps the address of Plex even when it couldn't
  save the link, but sets Plex's own id (`machineId`) only once it has; it sets
  Jellyfin's (`serverId`) at its first sign-in and on each link it saves. A link with no
  id reads as not linked, and `apply` links it again.
- **`Mediaplane can't read the file in Jellyfin's appdata`** (`bootstrap.unreadable`).
  With Jellyfin's key stored, `plan` takes its setup as done, but it can't check: the
  user Mediaplane runs as can't read `appdata/jellyfin/system.xml`. That is
  `MEDIAPLANE_UID` in the image, or your own user from source, and it is the stack's
  `user:` only when you set them alike (`init` and the
  [deploy guide](../../deploy/README.md) both use your own user). Run Mediaplane as the
  user that owns the file, which is usually the stack's `user:`: set `MEDIAPLANE_UID` to
  its uid. Or make the file readable by Mediaplane's own user. Then run `plan` again.
  Until then, an emptied `appdata/jellyfin` isn't noticed.
- **`Mediaplane can't read the file in Seerr's appdata`** (`bootstrap.unreadable`).
  Seerr has no stored key to decide, so `plan` takes its setup as not done: Seerr starts
  unpublished, and `apply` signs it in again (or checks it) on every run, which recreates
  it twice. Then verify fails with `seerr (first-run setup)` still to do (exit 1), on
  every `apply`, until Mediaplane can read `appdata/seerr/settings.json`. Seerr writes
  its own files readable by all (0644, uid 1000), so what stops Mediaplane is usually
  `appdata/` itself (0700, the stack's `user:`) or the user it runs as. Run Mediaplane
  as the user that owns `appdata/`: set `MEDIAPLANE_UID` in the image to its uid, or
  run from source as that user. Or make the file readable by Mediaplane's own user.
  Then run `plan` again: the warning is gone, and the next `apply` sets Seerr up, or
  checks it, and records it.
- **`runs inside <app>'s network, which publishes its ports`** (`bootstrap.network-via`).
  Mediaplane can't keep an app unpublished while its setup is open when the app shares
  another app's network, because that app publishes the ports. Run the app in its own
  network. No app in the catalog has this setting today.
- **`has no onDownload, … property for Jellyfin, which Mediaplane turns on`**
  (`wire.protocol`, for `<arr>.connection_jellyfin`). The arr's template for an Emby /
  Jellyfin connection lacks one of the triggers that Mediaplane turns on, so it made
  nothing. A Sonarr or Radarr version Mediaplane hasn't tested can do this: leave out
  `version:` for the tested one (see Prevention), then run `apply` again.
- **`could not make /data/media/tv for sonarr.root_folder`** (`wire.folders`). Sonarr and
  Radarr need their root folder to exist, and Jellyfin its libraries', so Mediaplane
  makes it first, as the stack's `user:`, in a throwaway container of the app. mkdir's
  own message follows. Usually the folder that holds it, such as `media/` in the data
  folder, belongs to another user: give it to the stack's user, such as
  `sudo chown <uid>:<gid> /srv/data/media` with the ids of `user:` in `stack.yaml`, then
  run `apply` again.
- **`Host: Unable to connect to proxy`, for `prowlarr.indexer_proxy`.** Prowlarr tests a
  new indexer proxy as it saves it: it has the Cloudflare solver fetch
  `https://prowlarr.servarr.com/v1/ping`, a page of Prowlarr's own service.
  - With `HTTP request failed: [502:BadGateway]`, the solver answered, but couldn't load
    that page. Byparr's log says why: run
    `docker compose -p mediaplane logs --tail 20 byparr`, and look for
    `Could not reach the target`. Look for what keeps the solver off the internet, such
    as a firewall, a DNS that fails, or a `compose.override.yaml` that changes its
    network, then run `apply` again. With FlareSolverr, read its log the same way.
  - With `Resource temporarily unavailable (byparr:8191)` or `Connection refused`,
    Prowlarr couldn't reach the solver at all: check that it runs and is healthy
    (`mediaplane status byparr`).
- **`tested Sonarr (Mediaplane), and it failed`** (or Radarr). Prowlarr's own test of its
  link failed for another reason than the key, which Mediaplane would set again itself.
  Prowlarr's words say which way:
  - `BaseUrl: Unable to complete application test, cannot connect to Sonarr`: Prowlarr
    can't reach Sonarr at `http://sonarr:8989`. Check that Sonarr runs and is healthy.
  - `ProwlarrUrl: Prowlarr URL is invalid, Sonarr cannot connect to Prowlarr`: Sonarr
    can't reach Prowlarr back at `http://prowlarr:9696`.

  A `compose.override.yaml` that takes either app off the stack's network breaks both.
  Fix that, then run `apply` again. When `apply` makes the link, the same words follow
  `refused the request (HTTP 400):`, since Prowlarr tests a new link before it saves it.
  While Sonarr isn't up, or its admin login is yet to be set, `plan` doesn't run the
  test.

- **`refused the request (HTTP 400): Name: Should be unique`.** Sonarr or Radarr already
  has a download client called `qBittorrent (Mediaplane)` that isn't a qBittorrent one,
  or Prowlarr has an application called `Sonarr (Mediaplane)` or `Radarr (Mediaplane)`
  of another kind, or an indexer proxy called `Cloudflare (Mediaplane)` that isn't a
  FlareSolverr one, or Sonarr or Radarr has a connection called `Jellyfin (Mediaplane)`
  that isn't an Emby / Jellyfin one, or one called `Plex (Mediaplane)` that isn't a Plex
  Media Server one. Rename or remove it in the app's web UI, then run
  `apply` again.
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
  Radarr and Prowlarr start with the name of the setting they didn't take. Fix that
  value in `stack.yaml`, then run `apply` again.
- **`failed (HTTP 500)`, or another 5xx.** The app failed. Read its log (check 3).
- **`answered something Mediaplane doesn't understand`.** The app answered in a shape the
  tested version doesn't. Usually that is a `version:` of your own in `apps.<app>`:
  remove it to go back to the tested image.
- **`holds one of the stack's secrets`** (`wire.secret-field`). A value that Mediaplane
  keeps in `state/resources.json`, such as `admin.username`, is the same as a key or the
  password. That file never holds a secret, so Mediaplane sets nothing in that resource
  until the value is another one; the app's other resources are still set. Change it in
  `stack.yaml`, then run `apply` again.
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
- **`wire.network`: `could not join the wiring network …`.** Mediaplane checked the
  network, and Docker then refused to put Mediaplane's container on it. The message
  after the colon is Docker's. Then:
  1. If it says the network was not found, the network was removed or made anew in the
     meantime. Run `mediaplane apply` again.
  2. If the socket proxy refused the call, see the `Forbidden` item in the
     [deploy guide's troubleshooting](../../deploy/README.md#troubleshooting).
  3. Otherwise, see who is on the network (check 4), and run `mediaplane apply` again.
     If it still fails, make the network anew, as below.
- **`could not leave the wiring network …`, `docker network inspect failed: …`, or
  `docker network inspect printed a line that is not …`** (under `apply.start-failed`).
  Before `docker compose up`, `apply` reads the wiring network and takes Mediaplane's
  container off it, so that Compose can change it if it must. When either fails,
  nothing is started. In the first two, Docker's own message follows the colon. The
  third means Docker answered, but not in the shape Mediaplane reads. Then:
  1. On the host, run `docker network disconnect mediaplane_wiring mediaplane`.
  2. Run `mediaplane apply` again.
  3. If the socket proxy refused the call, see the `Forbidden` item in the
     [deploy guide's troubleshooting](../../deploy/README.md#troubleshooting).
  4. If Docker's answer couldn't be read, look at the network on the host with
     `docker network inspect mediaplane_wiring`. If it isn't the one `compose.yaml`
     makes, make it anew, as below.
- **The wiring network must be made anew,** when its settings changed, or when
  Mediaplane refused it (`wire.network`, above). No release of Mediaplane changes its
  settings: one that had to would say so in its notes, with its own steps. When its
  settings changed, Compose has to delete the network, and through the socket proxy it
  can't: `apply` then stops at
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
  In Jellyfin's dashboard, leave the API key named `Mediaplane`.
- **Let `apply` finish Jellyfin's wizard.** Don't finish it by hand, and don't reach it
  by other means before `apply` has set it up, with an override that publishes it
  another way (`network_mode: host`, or the network of a service that publishes ports)
  or a container of your own on the stack's networks. Either one prevents the two
  `apply.bootstrap-failed` errors about a wizard finished with another login. See
  [T16](../security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
- **Let `apply` sign Seerr in:** don't finish Seerr's setup page by hand. On a Jellyfin
  stack it goes through Jellyfin's admin, so keep that login the shared one; on a Plex
  stack, it signs in with your Plex token.
- **Let `apply` claim Plex.** Don't claim it by hand, nor give it `PLEX_CLAIM` in
  `apps.plex.env`: `apply` fetches a claim token as Plex first starts. Run
  `mediaplane plex-login` once, before the first `apply`.
- **Keep `appdata/jellyfin`, `appdata/plex` and `appdata/seerr` readable** by the user
  Mediaplane runs as, so `plan` can tell whether their setup is open. Seerr's folder
  belongs to uid 1000, and its files are readable by all, as Seerr writes them. Until
  Mediaplane can read Seerr's `settings.json`, every `apply` fails at verify.
- **Leave the wiring network out of `compose.override.yaml`**
  ([ADR 0011](../adr/0011-a-private-wiring-network.md)).
- **Bring `mediaplane-system` down before the stack.** While Mediaplane is on the wiring
  network, `docker compose -p mediaplane down` leaves it behind ("Resource is still in
  use"). That holds after a plain `plan` too, because `plan` in the image joins the
  network. Or take Mediaplane off first, as above.
- **Keep the tested versions:** leave out `version:`.
