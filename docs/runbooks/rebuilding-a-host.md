# Runbook: rebuilding a host

A host is rebuilt from what you keep of it: `stack.yaml`, `secrets/` (the files
`stack.yaml` names, such as your VPN key), `compose.override.yaml` if you have one, the
apps' `appdata/`, and your data folder. Everything else Mediaplane makes again: the
containers and their networks, `generated/`, and `state/`, which holds the keys it gave
the apps (`state/secrets.json`) and what it made in them (`state/resources.json`).

Mediaplane finds what the apps still hold, rather than starting afresh:

- **Each app's key,** from the app's own files in `appdata/` (key recovery): Sonarr's,
  Radarr's and Prowlarr's `config.xml`, qBittorrent's `qBittorrent.conf`, Seerr's
  `settings.json`, Gluetun's `auth/config.toml`, and Jellyfin's database
  (`data/data/jellyfin.db`), read and never written. `plan` lists them under
  `Secrets to recover from the apps' appdata:`.
- **What it made in each app,** by the name it gave it: a download client named
  `qBittorrent (Mediaplane)`, the Movies library, and so on. `plan` shows each as
  `= adopt`, and `apply` records it, changing nothing in the app.

The same holds when only `state/` is lost, with the containers still running.

The shared admin password can't be found again: the apps keep only a hash of it. If
Mediaplane generated it, `apply` generates a new one, and sets it in each app through
the app's key, which it recovered. `mediaplane credentials` shows the new one once
`apply` has run. If it is yours (`admin.password: { file: … }`), nothing changes.

```text
 kept            made again
 ----            ----------
 stack.yaml      containers, networks
 secrets/        generated/
 appdata/   -->  state/secrets.json
 data folder       (keys recovered)
                 state/resources.json
                   (found by name)
```

## Symptoms

- **A new host, or a lost `state/`.** `mediaplane plan` lists keys to recover from the
  apps' appdata, and, for a generated admin password, warns
  `secrets.admin-password-lost`:

  ```console
  $ mediaplane plan
  warning: the admin password Mediaplane generated went with
  state/secrets.json, though the apps still hold the keys it
  gave them: apply generates a new one, and sets it in each
  app through the app's key
  …
  Secrets to recover from the apps' appdata: jellyfin.apiKey,
  prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey,
  seerr.apiKey, sonarr.apiKey
  Secrets to generate: admin.password
  First-run setup:
    + seerr (with no port published until it is done)
  ```

  Seerr is set up again, without its port, because the record that its setup is
  Mediaplane's went with `state/`: the setup asks Seerr, with its key, whether its admin
  is the shared admin and its Jellyfin the stack's, and publishes it only then. On a Plex
  stack, Plex and Seerr are asked the same way, through plex.tv, whose account they are.

- **`keys.unrecoverable`, an error:** a key file is there, but Mediaplane can't read it,
  or it holds the key in a form Mediaplane can't keep. `plan` stops, and nothing is
  generated: a new key would lock Mediaplane out of the app, which still holds the old
  one. A file that leads out of the app's own appdata folder, through a link, is never
  read.
- **`keys.unrecoverable`, a warning, for Jellyfin:** its database can't give its key,
  and the admin password is to be generated too, so `apply` can't sign in to Jellyfin to
  find the key, and leaves Jellyfin unwired.
- **`keys.restore`:** an app keeps its key in a file of its own that holds another key,
  or none, and Mediaplane can't write the file safely (see "A key changed at its source").

## Checks

1. Is everything you keep where `stack.yaml` expects it: `appdata/` and `secrets/` in the
   Mediaplane home, and the data folder at `paths.data`?
2. Can Mediaplane's user read the apps' key files? In the image, that is
   `MEDIAPLANE_UID` (`deploy/mediaplane.compose.yaml`). `ls -l` the file `plan` names.
3. Is the admin password yours, or generated? With `admin.password: { file: … }`, the
   file must hold the password the apps have.

## Fix

### A host rebuilt from its files

1. Install Mediaplane on the new host, as its README's quick start says, with the same
   `MEDIAPLANE_HOME`.
2. Put back `stack.yaml`, `secrets/`, `compose.override.yaml` and `appdata/` in the home,
   and the data folder at `paths.data`, keeping their owners. Leave `state/` and
   `generated/` out: Mediaplane makes them again.
3. Run `mediaplane plan`. Check what it says it recovers and generates, as above. Fix any
   error it gives first.
4. Run `mediaplane apply`. It saves the keys it recovered, starts the apps, sets up
   again what it must, sets a new admin password where the old one went, and finds
   everything it made by name.
5. Run `mediaplane apply` again: it says `No changes.`

### `keys.unrecoverable` (an error)

Make the file `plan` names readable by Mediaplane's user, then run `plan` again. To start
that app afresh instead, losing its settings, move `appdata/<app>` aside: `apply` then
generates a new key and writes the app's file anew.

### Jellyfin's key, when its database can't give it

Its key is made by Jellyfin, so it isn't in a file Mediaplane writes. Either make
`appdata/jellyfin/data/data/jellyfin.db` readable by Mediaplane's user, or give
Mediaplane the password Jellyfin's admin has: put it in a file in the home, set
`admin.password: { file: … }` to it, and run `apply`, which signs in to Jellyfin and
finds, or makes, its key named `Mediaplane`.

### A key changed at its source

An app that keeps its key in a file of its own can be given another, by hand, or from
its web UI: qBittorrent's web UI makes a new key, and writes it into its file at once.
The app then refuses the key Mediaplane holds, and `plan` and `drift` say so.

- **To put Mediaplane's back:** run `apply`. `plan` lists the key under
  `Keys to put back in their apps' own files`, and the app as `> restart`: `apply` stops
  the app, writes the key into its file, keeping the file's mode and group, and starts
  it again. A Gluetun restarted so restarts qBittorrent, in its network, too.
- **To keep the app's own instead:** `mediaplane keep qbittorrent.apiKey`. It asks the
  app with the key its file holds, and only if the app takes it, keeps it in
  `state/secrets.json`. The next `apply` gives it to every resource that holds the old
  one, which `keep` names: Sonarr's and Radarr's download clients.

Sonarr, Radarr, Prowlarr and Seerr take their key from their environment at every start,
which wins over their files, so their web UIs can't change it. Jellyfin makes its own: a
key deleted in its dashboard is made again by the next `apply`, which signs in to
Jellyfin as the shared admin while it stays published.

`keys.restore`, a warning: the file holds another key, but Mediaplane won't write it:
it is a link, has other names, or belongs to another user or group. Fix that, then run
`apply`; or keep the app's key, as above.

`keys.restore`, an error: the file holds no key, as one from before Mediaplane seeded the
app does, and Mediaplane can't write it. Stop the app, move the file aside, and run
`apply`, which writes a new one before the app starts.

### Rotating the admin password

`mediaplane apply --rotate admin.password` generates a new one, and sets it in each app
through the app's key, as after a lost `state/`. `mediaplane plan --rotate admin.password`
shows it first. A password of your own is rotated in its file instead: put another in it,
and run `apply`.

## Prevention

- Back up `stack.yaml`, `secrets/`, `compose.override.yaml` and `appdata/` together.
  `appdata/` holds the apps' keys, so keep the backup private.
- Give the admin password as a file of your own (`admin.password: { file: … }`), kept
  with your other secrets, so a rebuild keeps it too.
- Keep `state/` too, if you can: with it, a rebuild has nothing to recover.
