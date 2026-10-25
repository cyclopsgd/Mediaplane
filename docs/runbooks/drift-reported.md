# Runbook: drift reported

Drift is a change made in an app, outside Mediaplane, to something Mediaplane manages
there: a download client's category changed in Sonarr's web UI, a folder added to a
Jellyfin library, a qBittorrent category deleted, a key changed in Radarr's connection.
Mediaplane reports it, and never puts it back by itself: you choose whether `apply` puts
it back, or `mediaplane keep` keeps it as yours.

What Mediaplane manages in each app is listed in that app's README, under "Managed in
the app". Everything else in the apps is yours, and is never drift.

## Symptoms

- **`mediaplane drift` exits 2,** with each change on its own line. From a run with
  Sonarr, Radarr, qBittorrent and Jellyfin, trimmed, with its long lines wrapped here:

  ```console
  $ mediaplane drift
  Changed outside Mediaplane since it was applied:
    - qbittorrent.category_movies: deleted outside Mediaplane
    ! radarr.connection_jellyfin.apiKey: refused by the app's own
      check
    ~ sonarr.download_client.category: expected "tv", actual
      "television"
  Secrets, checked with each app's own check: 11 passed,
  1 refused, 2 not checked.
    ? radarr.download_client.apiKey: what it requires is yet to
      be put in place, which apply does first
    ? sonarr.download_client.apiKey: a managed field differs:
      apply sets the secrets with it
  Drift found.
    apply puts back each field, resource and secret changed in
    the apps; mediaplane keep <app>.<resource>.<field> keeps
    what the app holds instead, and <app>.<resource> stops
    Mediaplane managing one deleted.
  ```

  The last lines say what puts each kind right: `apply` for a field, a resource or a
  secret; for a key changed at its source, or what is left in an app, they say what does
  instead, and never that `apply` puts it back.

- **`mediaplane plan` shows the same lines,** under
  `Drift, changed outside Mediaplane since it was applied:`, before the wiring that would
  put each back.
- **`mediaplane drift` exits 2 with no drift,** saying it could not look at everything,
  or check every secret: an app wasn't running and healthy, or didn't answer, or refused
  its own key when last asked; a resource Mediaplane made that the stack no longer wants,
  whose app couldn't say whether it still holds it (`drift.left-unknown`); or a secret
  went unchecked. Those are listed under `Not checked:` (marked `?`), and under the
  secrets (marked `?` too), each with why. A warning from an app's own health check
  (`drift.health`) doesn't change the exit code.
- **`passed (1 as last checked)`** in the secrets line, with a line starting `=`: drift
  took that verdict from its last check, at the time it names, rather than check again
  now. Jellyfin's admin password is checked once a day at most, while it passes: a
  password changed in Jellyfin since shows up within a day, and at once in `plan`.

Each line says what kind of drift it is:

- `~` **a field changed:** the value `apply` sets (`expected`), what Mediaplane last
  applied when that is another (`Mediaplane applied …; stack.yaml has changed it since`),
  and what the app holds now (`actual`). `actual one Mediaplane can't read` means the app
  holds the field in a shape Mediaplane doesn't understand, such as a number where it
  expects text. A field `stack.yaml` no longer sets is never drift: `apply` doesn't set
  it.
- `-` **deleted outside Mediaplane:** the app no longer holds the resource.
- `!` **a secret refused by the app's own check:** a key or password that no longer
  works. Mediaplane never compares or shows a secret: it uses it, with the app's own test
  or sign-in. `found by drift at …; not checked again until apply sets it` says drift
  found it earlier, and doesn't check it again, so that the check leaves no more marks
  in the app.
- `!` **refuses the key Mediaplane holds for it:** the app's own key was changed in the
  app, such as qBittorrent's made anew in its web UI. Each resource that holds that key,
  in another app, is listed too, as `holds qbittorrent's key, which qbittorrent refuses`;
  its secrets aren't checked. Drift keeps that the app refused it. Then
  `found at …; not sent again until apply checks it` says neither drift nor `plan` sends
  the app that key again, and that app's resources are listed under `Not checked:`.
  Until a drift has found the refusal, each `plan` still tries the key. Each key that
  fails counts towards qBittorrent's ban of an address after five failed sign-ins.
- `?` **still in the app, though the stack no longer wants it:** Mediaplane made it, such
  as Prowlarr's link to Sonarr, and Sonarr has since left the stack. `apply` leaves it:
  remove it in the app, or keep it as yours with `mediaplane keep <app>.<resource>`.
  Removing it for you comes in Slice 10.

## Checks

1. **Run `mediaplane drift --json`** for the same, with each change's fields, and how
   each secret was checked (`checks`): `passed`, `refused`, or `unchecked` with why.
2. **Look at the app's own web UI** for the change. A field's line names the setting:
   `sonarr.download_client.category` is the category of Sonarr's download client
   `qBittorrent (Mediaplane)`. The app's README lists each.
3. **For a secret refused,** think whether you changed it in `stack.yaml` or in
   `secrets/`, such as `admin.password`. Drift can't tell that from a change made in the
   app: the app refuses the secret the stack has either way. `apply` sets it in both
   cases.
4. **For `refuses the key Mediaplane holds for it`,** check the app's own settings for its
   API key: it was made anew, or set by hand.

## Fix

Choose, for each change, which side wins.

- **Put it back: run `mediaplane apply`.** It shows the plan first, with the drift, and
  asks, unless you pass `--yes`. It makes each resource what the stack wants again, makes
  a deleted one again, and sets each refused secret. A root folder whose folder was
  deleted gets its folder again. A secret drift found refused that `apply`'s own check
  now passes, re-entered in the app say, is no longer taken as refused.
- **Keep what the app holds: `mediaplane keep <app>.<resource>.<field>`,** as the drift
  line names it. Here, with its line wrapped:

  ```console
  $ mediaplane keep sonarr.download_client.category
  Wrote sonarr.download_client.category: television under
  overrides: in stack.yaml. apply now leaves it as the app
  holds it, and drift no longer reports it.
  ```

  It adds one line under `overrides:` in `stack.yaml`, and changes nothing else in the
  file, its comments neither, and keeps its mode and its group (not an ACL or extended
  attributes, which a rewrite drops). `apply` then sets that value, as it would any other
  setting of the stack, so the change stays. To undo it, take the line out of
  `overrides:`, and run `apply`.

  For most fields, drift is clear at once. A download client's category is the
  exception: qBittorrent needs a category of that name, which only `apply` makes. Until
  it has, drift leaves the client's key unchecked, and exits 2. So keep, apply, then
  drift:

  ```console
  $ mediaplane keep sonarr.download_client.category
  $ mediaplane apply
  $ mediaplane drift
  ```

  What `keep` asks: it checks that the app takes Mediaplane's key, and reads that one
  resource. It checks none of its secrets and runs no test of the app's, so each request
  it makes goes to the app's own address on the stack; a value only the app can say,
  such as Seerr's quality profile, is the one last applied.

- **Stop managing a resource deleted outside Mediaplane, or left in an app:**
  `mediaplane keep <app>.<resource>` writes `<app>.<resource>: unmanaged`. Mediaplane
  doesn't make it again, look at it, or report it. A library of Seerr's that is no longer
  managed in Jellyfin or Plex is no longer enabled by Mediaplane in Seerr either.
- **A key changed at its source** (`refuses the key Mediaplane holds for it`): put the
  stored key back in the app, as the
  [wiring failed runbook](wiring-failed.md#fix) shows for each app, then run `apply`.
  `apply` checks the key again, and once the app takes it, drift and `plan` ask the app
  again. Mediaplane doesn't put the key back for you yet (Slice 10).
- **A download client's key not checked, because qBittorrent lacks a category it
  names.** Sonarr's or Radarr's own test of its download client makes each such
  category in qBittorrent, with no save path, so `plan` and drift don't run it:
  - a category you kept (`keep sonarr.download_client.category`) is qBittorrent's to
    have: `plan` shows `qbittorrent.category_tv`, and `apply` makes it, with its save
    path, then checks the key. The reason says
    `what it requires is yet to be put in place, which apply does first`;
  - its post-import category, which Mediaplane doesn't manage, or a category you stopped
    Mediaplane managing (`qbittorrent.category_tv: unmanaged`) and deleted: make it in
    qBittorrent, or name one in the arr that qBittorrent has, then run drift again. The
    reason names the category and the setting;
  - qBittorrent didn't answer: run drift again once it does.

`keep` refuses, saying why, and changes nothing:

- **a secret** (`sonarr.download_client.apiKey`): Mediaplane never keeps one. `apply`
  sets it;
- **a field it doesn't manage**, with the closest name it does: the other settings are
  yours already;
- **a fixed field**, which the app's README marks `(fixed)`. Changing one changes what
  the resource is, where a key goes, or a setting `stack.yaml` keeps for every app.
  `apply` puts such a field back:
  - a root folder's path, a library's name or what it holds, whether an arr reaches its
    root folder, and Seerr's setup;
  - every field that says where an app sends a key (a host, a port, TLS, a URL; a URL
    base held in an arr's download client reads as part of its host), as the stack's
    keys go only to its own addresses;
  - an app's admin user name: it is the shared admin login, which
    `mediaplane credentials` shows for every app. Change `admin.username` in
    `stack.yaml` instead;
  - who may skip qBittorrent's login: a security setting. Set `security.login_on_lan` in
    `stack.yaml` instead.

  To keep a library you renamed, for instance, stop Mediaplane managing it:
  `mediaplane keep jellyfin.library_movies` once drift says it was deleted, or add
  `jellyfin.library_movies: unmanaged` under `overrides:` yourself;

- **a value its field can't take,** as `plan` refuses it in `overrides:` too:
  - a download client's category must stay a folder in `/data/torrents`, where
    qBittorrent saves it: a folder name, or several joined by `/` (a subcategory such as
    `tv/anime`), never empty, nor with a `.` or `..` folder, a `/` at either end or two
    together, a `\`, or a control character;
  - a Jellyfin or Plex library holds at least one folder;
  - each category Prowlarr syncs to an arr is a number, such as `5000`;
  - Seerr's quality profile for an arr is its name, as text;
- **a value that could make `stack.yaml` show what it doesn't hold:** one with a control
  character (a tab or a line end too), a line or paragraph separator, or a character
  that turns the direction of text. Set it in the app to something plain;
- **something that hasn't drifted**, or that drift couldn't look at: run
  `mediaplane drift` first;
- **a value Mediaplane can't read,** or one that holds one of the stack's secrets: set
  it in the app to what you want, then keep it, or run `apply`;
- **a `stack.yaml` it won't or can't write:** a link, not a regular file, a file with
  other names (hard links), one that belongs to another user, or to a group Mediaplane's
  user isn't in, one written as a single `{ … }` block, one it can't parse, one managed
  by automation (`managed_by: external`, checked again in the file it is about to
  write), or one whose folder it can't write in. The error gives the line to add under
  `overrides:` yourself.

## Warnings and errors of drift's and keep's own

- **`drift.health`** (a warning): an app's own health check says something is wrong with
  a resource of Mediaplane's. Prowlarr's checks its indexer proxy every six hours:
  `All indexer proxies are unavailable due to failures` means the Cloudflare solver
  (Byparr or FlareSolverr) is down or can't reach the internet. `apply` can't put that
  right. Check the solver with `mediaplane status`; Prowlarr's next health check clears
  it. A health check Mediaplane can't read is a warning too. Neither changes drift's exit
  code.
- **`drift.checks-not-kept`** (a warning): drift couldn't keep what its checks found in
  `state/resources.json`, so the next drift checks those secrets again. Check that
  Mediaplane's user can write to `state/`. It doesn't change the exit code.
- **`drift.locked`** and **`keep.locked`** (errors, and nothing was looked at): another
  `apply`, `drift` or `keep` is running. Wait for it, then run the command again. If
  none is running, delete `state/lock`. `apply` says the same when one of them holds it.

## Prevention

- **Change what Mediaplane manages in `stack.yaml`,** not in the apps: an override
  under `overrides:` is the same as Keep mine, written by hand. Each app's README lists
  the fields. `plan` checks every override before it asks any app, whatever the stack
  runs, and refuses one that names nothing Mediaplane manages, a fixed field, a secret,
  or a value its field can't take.
- **Run `mediaplane drift` before `apply`** after working in the apps' web UIs, to see
  what `apply` would put back.
- **Keep a secret right in one place.** After changing `admin.password`, or a key in
  `secrets/`, run `apply` soon: until then, the apps refuse the new one, and drift and
  `plan` report it.
- **Drift's checks leave few marks.** A check of a secret uses it, and some apps record
  each that fails: a failure in an arr's status of its download client, a line in Seerr's
  log. Drift checks a secret it found refused no more, until `apply` sets it, sends an
  app no more the key it refused, until `apply` checks it, and checks Jellyfin's admin
  password once a day at most, so running it often costs little. Running it on a
  schedule comes in M2.
