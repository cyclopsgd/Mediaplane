# 0003. Drift: detect and warn, with Keep mine

- **Status:** Accepted
- **Date:** 2026-10-25

## Context

Mediaplane makes resources in the apps through their APIs: download clients, root
folders, Prowlarr's links, libraries, Seerr's servers, and the shared admin login. You
can change any of them in the app's own web UI afterwards. Before Slice 8, `plan`
compared only what the stack wants with what the app holds, so a change made by hand
showed as an update, and the next `apply` undid it, without saying that someone had
changed it, and without a way to keep the change.

Three things can differ, and each means something else:

- **What the stack wants** (D): `stack.yaml`, with its `overrides:`;
- **what Mediaplane last applied** (L): its record in `state/resources.json`;
- **what the app holds** (O): read through its API.

D against L is a change you made in `stack.yaml`. O against L is a change made in the
app, outside Mediaplane: drift. A secret can't be compared: the apps show their keys
masked, and Mediaplane keeps no hash of one. Checking a secret means using it, with the
app's own test, and some of those tests leave a mark in the app: a failure in its status
of a client, a line in its log, a sign-in in Jellyfin's activity log. qBittorrent bans an
address after five failed sign-ins in a row.

## Decision

- **`mediaplane drift` reports, and never writes to an app.** It is `plan` in
  observe-only mode, under apply's lock: what changed outside Mediaplane since the last
  apply, with what was applied and what the app holds for each managed field; a resource
  deleted; a secret the app's own check refuses; an app that refuses its own key, and
  the resources that hold that key; and a resource Mediaplane made that the stack no
  longer wants. A field the app holds in a shape Mediaplane can't read is said to be,
  never read as empty. `plan` shows the same drift, as what `apply` would put back.
- **Re-apply is `apply`.** It makes each resource what the stack wants again.
- **Keep mine is `mediaplane keep <app>.<resource>.<field>`.** It writes the app's value
  under `overrides:` in `stack.yaml`, so the stack wants what the app holds, and records
  it as applied: drift is clear, and `apply` has nothing to do, except for a download
  client's category, which qBittorrent must then have: `apply` makes it first, and drift
  is clear after. For a resource deleted
  outside Mediaplane, or left in the app though the stack no longer wants it,
  `mediaplane keep <app>.<resource>` writes `<app>.<resource>: unmanaged`, and
  Mediaplane stops managing it.
- **Keep mine writes one line.** It adds the line under `overrides:`, or replaces a value
  it wrote before, and changes nothing else in the file: comments, key order, quoting,
  spacing and line ends stay. The new file must parse to the same stack with that
  override, or nothing is written. It keeps the file's mode and group, not an ACL. It
  reads the file once, through one handle, and replaces only that file. It refuses a
  `stack.yaml` that is a link, has other names, belongs to another user or to a group
  its user isn't in, or is managed by automation (`managed_by: external`, checked again
  in the file it writes), and one it fails to write, and gives the line to add by hand
  instead. It never writes a value with a control character, a line or paragraph
  separator, or one that turns the direction of text, which an editor could show as
  what the file doesn't hold.
- **Only managed fields can be kept.** Each resource declares them; a few are fixed: what
  the resource is known by (a root folder's path, a library's name), what its app can't
  change (what a library holds), what Mediaplane only checks (whether an arr reaches its
  root folder's folder), where an app sends a key (a host, a port, TLS, a URL, and the
  URL base an arr's download client holds, read as part of its host): the stack's keys
  go only to its own addresses, and every request that carries one is built from them,
  whatever an override or the app holds; and what `stack.yaml` sets for every app (the
  shared admin's user name, `admin.username`, and who may skip qBittorrent's login,
  `security.login_on_lan`). A field may also have a rule for its value, which an
  override and Keep mine must keep: a download client's category stays a folder in
  qBittorrent's downloads folder. A secret is never kept, nor a value that holds one.
  `plan` checks every override, whatever the stack runs, before it asks any app.
- **Drift keeps its marks few** (the owner's decisions of 2026-10-17):
  - a secret it finds refused isn't checked again, by drift or `plan`, until `apply`
    sets it, nor is what only the app can say asked of that resource (Seerr's test of
    an arr). That spares qBittorrent's sign-in ban, and leaves one failure in an app's
    status, and one line in Seerr's log, for each change. A check `apply` makes that
    passes takes the refusal out;
  - an app that refuses its own key isn't sent it again, by drift or `plan`, until
    `apply` checks it and the app takes it; nor are the resources that hold that key
    checked;
  - Jellyfin's admin password is checked by drift once a day at most, while it passes;
  - `plan` and drift leave an arr's download client key unchecked while qBittorrent
    lacks a category the client names, which the arr's own test would make;
  - Seerr's Jellyfin key, found refused, isn't checked again by the update that gives
    Seerr the stack's: one failed check, and one line in Seerr's log, per `apply`.

  To know what it found, drift keeps each check's verdict and time, by the secret's
  name, and each app found refusing its own key, by the key's name, in
  `state/resources.json`: its one write, besides its lock in `state/lock`.

- **Shared keys are reported, not repaired, in S8.** A key changed at its source, such
  as qBittorrent's made anew in its web UI, is drift on qBittorrent and on each resource
  that holds it. Putting the old key back at the source, or taking the new one and giving
  it to every consumer, needs the key read from the app's own files, which is key
  recovery: Slice 10 brings both. The wiring failed runbook gives the steps by hand.

## Consequences

- **A change by hand is never silently undone.** `plan` shows it as drift before
  `apply` puts it back, and `apply` asks first, unless you pass `--yes`; its plan still
  shows the drift.
- **`drift` writes `state/resources.json`,** never `stack.yaml` and never an app. A
  secret it found refused stays so for drift and `plan` until `apply` checks or sets it,
  even if you put it right in the app yourself. An app that refused its own key reads as
  not checked until `apply` checks it, so drift exits 2 until then.
- **An older Mediaplane can't read `state/resources.json` once drift has written it:**
  it refuses the checks drift keeps there. To go back to an older image, move the file
  aside first; the older `apply` finds what it made by name, and adopts it.
- **Drift can't tell a secret changed in the app from one you changed in the stack:**
  either way, the app refuses the secret the stack has. Its message says both.
- **A resource left in an app is reported, never removed.** Removing what Mediaplane made
  when its app leaves the stack needs a delete for every kind of resource: Slice 10.
- **After upgrading to Slice 8, `plan` adopts each root folder once,** changing nothing
  in the apps: it now also records whether the arr reaches the folder.
- **Drift runs only when you run it** in M1. M2 can run it on a schedule as it is: it
  takes the lock, and checks no more than it must.
