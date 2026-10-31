# M2 roadmap: backup, restore and adoption

**Status:** planned on 2026-10-31, from the owner's priorities. Nothing is built yet.

**Spec:** M2 has no spec of its own yet. Each slice adds its design to the spec
([`docs/design/`](../design/)), or a spec of its own there, when the slice is designed.
M1's spec, [`m1-engine-cli.md`](../design/m1-engine-cli.md), still describes the engine M2
builds on.

This replaces the plan after M1 that the owner made on 2026-10-25 (the everyday CLI, then
more apps). That plan's items aren't dropped: they are on the "Later" list in
[the M1 roadmap](m1-roadmap.md#after-m1), apart from the few this plan takes.

## The goal

You can run the media server you already have under Mediaplane. You can also back it up,
and restore it onto another host or onto the same host after a fresh install, either as
a drill or as a real switch.

An example, used through this plan:

- **`mediaserver`, the primary.** It runs a stack someone set up by hand with Docker
  Compose. Its media drive is mounted at `/srv/data`, and it has an Intel GPU at
  `/dev/dri`.
- **`standby`, a VM.** It has no GPU and no media drive, only a small test library on its
  own disk. It restores `mediaserver`'s backups as drills. It takes over when
  `mediaserver` is down or being rebuilt, and hands back afterwards.

## The slices, in order

The owner's order. Each slice is designed when the one before it has landed: questions,
then probes against the real apps, then a spec and a plan in `docs/plans/m2/`. Each one
apart from S0 then goes through the full process (subagent-driven, reviewed, end-to-end
tests against real containers).

```text
 S0  coded diagnostics (light route)
  |
 S1  backup and restore
  |
 S2  Audiobookshelf
  |
 S3  adopting an existing stack
  |
 S4  doctor and host checks
  |
 S5  scheduled drift, with alerts
```

- **S0: finish the coded diagnostics.** This is small, so it goes by the lighter route.
  Every error document gets a code, so a script tells them apart without reading the
  message. The list is the one from S10c's final review:
  - a usage error;
  - `apply.needs-yes`;
  - `status <app>` with no container;
  - `history.unreadable`, kept apart from "no such record";
  - `credentials <app>` of an unknown app;
  - `plex-login`'s timeout and its expired link;
  - `config.unreadable` for a `stack.yaml` that can't be read;
  - and `fileKind` keeps its "check that the user can read it" hint.

  It comes first because every new command in M2 reports errors the same way.
- **S1: backup and restore.** First, because it is the safety net for everything after
  it. Adopting a live server comes after a restore has been proven to work.
- **S2: Audiobookshelf.** It moves forward from the old M3. A stack being adopted can
  include it, so it comes before S3.
- **S3: adopting an existing stack.** The stack's apps, with Plex's watch history,
  libraries and claim kept.
- **S4: `doctor` and the host checks.**
- **S5: drift on a schedule, with alerts** to an Uptime Kuma push monitor or ntfy.

A real failover drill of an adopted server needs S1 and S3. Until S3 lands, S1 is proven
on stacks Mediaplane made.

## Rules for all of M2

- **The automation contract stays stable.** It is what automation (an Ansible role, a
  script) is written against:
  - The documents that exist only gain fields.
  - Every new command is non-interactive. It takes `--yes` where it changes something,
    `--json` with a versioned document and a published JSON Schema, coded diagnostics,
    and the exit codes `plan` and `apply` use.
- **No Ansible role or collection.** The automation guide's short example stays, as an
  example.
- **Mediaplane stays a standalone tool.** It never updates itself or an app on its own.
  Drift on a schedule only reads.
- **Containers that aren't Mediaplane's are left alone.** That covers a tunnel, Portainer,
  and anything not in the catalog: Mediaplane never stops, changes or backs them up. The
  one exception is the old containers `adopt` takes over (S3), which it stops but never
  removes.
- **No new Docker socket-proxy permission.** Host files outside the Mediaplane home are
  read and written through a short-lived helper container, as the host helper and the
  appdata ownership helper are today. The proxy already lets Mediaplane create one.
  - Today's host helper only reads, with read-only mounts, as Mediaplane's user. A helper
    that writes a backup folder, or reads files Mediaplane's user can't, needs a writable
    mount and may need root, as the ownership helper does.
  - The slice that adds one records it in the threat model. The threat model's hardening
    list (`-allowbindmountfrom`) gains the folders it mounts: the backup folder, and
    an adopted stack's appdata.
  - A slice that finds this can't work without a new permission goes back to the owner.
- **The repo is public.** Docs, tests and fixtures use generic examples: `/srv/data`,
  `mediaserver`, `192.0.2.10`, `example.com`. Never a real server's names or files.
  Fixtures are built from fresh containers of the real images.
- **Secrets never go in chat.** A backup holds every secret the stack has, so it is
  written for its owner only, and the docs say to keep it as safely as a password.

## S1: backup and restore

`mediaplane backup --to <folder>` and `mediaplane restore <backup>`.

**Decided:**

- **No prompts.** Both commands run without asking anything. They take `--json`, and exit
  0 only when every step worked.
- **The folder is yours.** Copying it elsewhere, such as to object storage, is yours too.
  Mediaplane writes only to the folder.
- **A real switch keeps each app's identity.** That is `restore --take-over`, onto
  another host or onto the same host after a fresh OS install. Plex keeps its server
  identity and its claim, so nobody has to add the server again.
- **The data folder can be somewhere else on the new host,** for example a drive now
  mounted at a fixed path through `/etc/fstab`. The apps still see it as `/data`, so no
  path inside an app changes.
- **Hardware differences are handled,** such as a host without `/dev/dri`.
- **A drill, by default.** `restore` runs side by side with the primary, which keeps
  running. The standby's Plex isn't signed in, and nothing downloads.
- **`--take-over` is for when the primary is down or being rebuilt.** Afterwards there is
  a way to hand back to the primary.
- **It builds on M1's recovery.** The keys are found again in the apps' own files, and
  what Mediaplane made in each app is found by name
  ([rebuilding a host](../runbooks/rebuilding-a-host.md)).

**To decide in the slice's design** (each with the recommendation):

- **What a backup holds.** Recommended:
  - `stack.yaml`, `compose.override.yaml`, `state/`, `appdata/`, and the secret files
    `stack.yaml` names, wherever they are;
  - never the media files;
  - a secret given as an environment variable can't be backed up, so `backup` warns;
  - leave out Plex's cache, transcode folder and logs, and keep its metadata, so the new
    host doesn't have to fetch every poster again.
- **The format.** Recommended: one archive per backup, with a manifest of versions and
  checksums. An archive keeps the files' owners and modes, which a folder copied to
  object storage loses.
- **Copying databases whole.**
  - Recommended: stop the apps for the copy, a minute or two, and start them again.
  - The other way is each app's own online backup, which not every app has.
- **Encryption.** Recommended: not in M2. The backup is written readable only by its
  owner, and the tool that copies it elsewhere encrypts it. Revisit it after M2.
- **Old backups.** Recommended: each run writes one dated backup, and removing old ones
  is yours.
- **Reading the app files and writing the backup.** They are owned by each app's user, so
  the copy needs a helper container with a writable mount, and probably root (see the
  rules above). Probe it.
- **What the drill does to Plex.**
  - Recommended: its sign-in is removed, and it gets a new identity. Otherwise a device
    on the same network could find two servers with the same identity.
  - Nothing on plex.tv changes.
- **What the drill does to downloads.**
  - Recommended: Gluetun and qBittorrent don't start, unless you give the drill a VPN key
    of its own.
  - Two hosts using one WireGuard key at once make the provider drop one of them, which
    could be the primary's.
  - The arrs and Prowlarr start, but have nothing to send downloads to.
- **Guarding `--take-over`.** Mediaplane can't see the other host.
  - Recommended: ask plex.tv whether the server is online elsewhere, and refuse while it
    is, unless `--force` is given.
  - The flag itself is your confirmation that the other host is off.
- **Handing back.** Recommended:
  1. run `backup` on the standby;
  2. stop the standby's stack, with a new `mediaplane down`, so only one Plex and one VPN
     connection are live;
  3. wait until plex.tv shows the server offline (or pass `--force`), then run
     `restore --take-over --replace` on the primary.

  The apps' state comes back: watch history, settings, the download queue. Files
  downloaded during the take-over don't, because a backup never holds media. A queue
  item for such a file fails until the file is copied back.
- **Files downloaded during a take-over.** Recommended: copying them back is yours, with
  a runbook that says how. A standby without the media drive keeps downloads off.
- **No `/dev/dri` on the new host.** Recommended:
  - a drill turns hardware transcoding off in the restored `stack.yaml`, with a warning;
  - `--take-over` refuses unless it is given `--no-hardware-transcoding`.
- **Networks an app joins that aren't Mediaplane's** (S2). Recommended: `restore` makes
  any that are missing, empty.
- **Versions.** Recommended:
  - `restore` refuses a backup from a newer Mediaplane, and migrates one from an older
    Mediaplane, as `migrate` does;
  - it restores only into an empty Mediaplane home, unless `--replace` is given.

**The drill, as recommended:**

```text
 mediaserver        standby
 (keeps running)    (drill)
 ---------------    ---------------
 backup --to F  --> restore F
                    Plex: new id,
                      not signed in
                    no VPN, no
                      downloads
```

## S2: Audiobookshelf

**Decided:**

- **It is a catalog app,** with its libraries on the data folder.
- **Its admin login is made before its port is published.** It works like Jellyfin's
  first-run setup: Audiobookshelf starts with no published port, Mediaplane makes the
  admin over the internal network, and only then publishes it.
- **It can be adopted (S3) when you reach it through a tunnel or a reverse proxy you run
  yourself.** That tunnel or proxy keeps working.

**To decide in the slice's design:**

- **Where the libraries go.** Recommended: `media/audiobooks`, which the M1 spec planned.
  `media/podcasts` is new, and only if podcasts are wanted.
- **Its first-run setup.** Probe Audiobookshelf's first-run API and its API token.
  Mediaplane keeps the token for drift, and finds it again in Audiobookshelf's files
  after a lost `state/`, as M1 does for the other apps' keys.
- **Its port inside the container.** Recommended: 13378, the same as the host port, so a
  tunnel's or proxy's route to `audiobookshelf:13378` keeps working.
- **Joining a network that isn't Mediaplane's, under a name.**
  - Recommended: a `stack.yaml` setting that any app can use, for example
    `networks: [{ name: proxy, alias: audiobookshelf }]`.
  - Mediaplane joins the network but never makes it, apart from S1's restore.
  - Mediaplane never sets a fixed container name. Docker's DNS gives an alias exactly
    as it gives a name, so a tunnel that reaches `audiobookshelf` by name still does.
- **What drift checks.** Recommended: the libraries, and the folders they point at.

## S3: adopting an existing stack

**Decided:**

- **The apps it adopts:** Plex, Sonarr, Radarr, Prowlarr, Byparr, Gluetun, qBittorrent
  (in Gluetun's network) and Audiobookshelf.
  - Jellyseerr's settings move to Seerr, the requests app Mediaplane runs.
  - Jellyfin isn't in M2's list. Adopting it stays on the "Later" list.
- **Plex keeps its watch history, its libraries and its claim.**
- **It leaves the other containers alone,** such as a tunnel and Portainer, and lists
  them.
- **Its VPN settings, Plex's hardware transcoding and the names other containers use**
  are carried over. The items below say how.
- **How it's tested.** It is built and tested against fake stacks made from fresh
  containers.
  - The first real trial is a dry run on the owner's server, which changes nothing.
  - Its report holds no secrets, but it does hold real names and paths. It is shared
    privately, never in the repo, an issue or a PR.

**To decide in the slice's design:**

- **How it reads the old stack.** Recommended: from the running containers, through
  Docker's read-only calls (image, mounts, environment, networks, devices). The Compose
  files are only a hint.
- **How it runs.** Recommended: a dry run by default. `mediaplane adopt` prints what it
  would do, and `--yes` does it. Both take `--json`. Whether a `--redact` for the report
  is worth it is decided here too.
- **Keeping the old stack.** Recommended: copy, never move or edit.
  - The old appdata is copied into Mediaplane's.
  - The old containers are stopped, not removed.
  - To go back, stop Mediaplane's stack and start the old one. A runbook says how.
  - Free disk space for the copy is checked first: Plex's appdata can be tens of GB.
- **Images from another publisher.** The catalog runs one image per app, such as
  linuxserver's for Plex and the arrs. An old stack may run another image of the same
  app, whose appdata layout, user and paths differ. Recommended: map the images known
  to differ only in layout, and refuse the rest with a clear diagnostic.
- **Paths.** Recommended: never rewrite a path inside an app's database in M2.
  - The mounts that share one top folder become the data root.
  - A mount that doesn't fit, such as an incomplete-downloads folder on another disk, or
    a subfolder mounted at an app's own path (`/audiobooks`), is kept at the same path
    in the container, as an extra mount.
- **Folder names.** Recommended: keep the root folders, categories and libraries as they
  are, recorded the way Keep mine records a value. Never move files.
- **Versions.** The old stack may run images tagged `latest`, and an app's database can't
  go back to an older version.
  - Recommended: when the release's pin is older than the running image, pin the running
    image by digest, with a warning. Keep it until a release's pin is newer.
  - Today's `version` setting takes only a tag of the catalog's image. It needs to take
    `<tag>@sha256:…` (an additive change to schema v1), or a new field takes the digest.
- **Logins.** Mediaplane's shared admin password would replace each app's own login.
  - Recommended: adopting keeps the logins people have. Mediaplane works through each
    app's API key, found again in its files.
  - The shared password is set only when you ask, with `--rotate admin.password`.
  - M1 finds the keys of Sonarr, Radarr, Prowlarr, qBittorrent, Gluetun, Seerr and
    Jellyfin. Plex's sign-in is your plex.tv token, and S2 adds Audiobookshelf's.
- **The VPN.** Recommended: Gluetun's provider settings and key are read from its
  container into secret files, never printed. `adopt` checks that the provider is one
  Mediaplane supports.
- **Plex's hardware transcoding.** Recommended: carried over when the old container has
  `/dev/dri` and Plex's transcoder uses it.
- **Jellyseerr to Seerr.** Recommended: its settings and database are copied into Seerr's
  appdata. Probe whether Seerr migrates them on first start.
- **Names other containers rely on.** Recommended: an app that other containers reach by
  name over a shared network keeps that name there, through S2's setting. An example is
  a tunnel that reaches Audiobookshelf.
- **Ports.** Recommended: keep the same host ports, published as `network.bind` says.
  - `lan` publishes on the host's private addresses only.
  - The docs say that Docker's published ports bypass a host firewall such as ufw.

**What `adopt` does, as recommended:**

```text
 old stack          Mediaplane
 ---------          ----------
 containers  read   stack.yaml
 appdata  -- copy ->  appdata
 (stopped,          containers
  kept)             (same ports,
                     same names)
 tunnel,
 others: untouched
```

## S4: `doctor` and the host checks

**Decided:**

- **`mediaplane doctor`** checks a running stack and says what to fix. It takes `--json`.
- **`apply` refuses when:**
  - `stack.yaml` names the data folder's mount, and the data folder isn't a mount, for
    example because the media drive is missing. Only when it's named: on for a primary
    with a media drive, off for a VM with its data on its own disk;
  - hardware transcoding is on and `/dev/dri` is missing. `apply` already checks this;
    `doctor` reports it too;
  - there isn't enough free memory or disk. `apply` already refuses under 2 GiB free
    disk and warns under 10 GiB. M2 adds the memory check, and sizes the disk check for
    a backup or an adopt's copy.

**To decide in the slice's design:**

- **The setting's name,** for example `paths: { data: /srv/data, data_is_mount: true }`.
- **The thresholds.** Recommended:
  - each catalog app states roughly the memory it needs;
  - disk needs a fixed minimum, plus room for a backup;
  - both thresholds can be changed.
- **What else `doctor` checks.** Recommended:
  - the host and the containers (running, healthy);
  - the checks `plan` already makes, such as keys accepted and the VPN check;
  - the M1 items left for it, under "M2 and later" in
    [the M1 roadmap's inputs](m1-roadmap.md#inputs-for-later-slices-from-the-reviews):
    Docker's default bridge network, which the plex.tv helper needs; the apps' appdata
    ownership; and an override that moves an app's appdata mount.

## S5: drift on a schedule, with alerts

**Decided:**

- **Drift runs on a schedule.** It only reads.
- **It alerts to an Uptime Kuma push monitor, or ntfy.**

**To decide in the slice's design:**

- **Where it runs.** Recommended: a scheduler inside the Mediaplane container, which
  already runs all the time.
  - It runs every 15 minutes by default, as the M1 spec planned.
  - `drift` already takes apply's lock, and checks no more than it must. The app checks
    that need it are already throttled (M1's Slice 8, and
    [the M1 roadmap's inputs](m1-roadmap.md#inputs-for-later-slices-from-the-reviews)).
- **Reaching the alert targets.** The Mediaplane container has no route out.
  - Recommended: a short-lived helper, like the one that reaches plex.tv (ADR 0012).
  - It gets an ADR of its own. The threat model's T14 (a way out of Mediaplane's
    container) is revised too. It calls the plex.tv helper harmless because that helper
    reaches only plex.tv, and this one calls a URL you give.
- **What is sent.** Recommended:
  - Uptime Kuma gets a heartbeat each run: up when all is well, down with a summary when
    there is drift or a check failed.
  - ntfy gets a message only when something changes: new drift, drift cleared, or a
    check that starts failing.
- **The targets' URLs and tokens are secrets,** kept in secret files (ADR 0009), never
  in `stack.yaml`.
- **What else alerts.** Recommended: a failing `vpn-check`. A backup that is getting old
  can come later.

## What the owner does along the way

- **Before S1's drill:** have a standby host with Mediaplane installed.
- **S3's trial:** run `mediaplane adopt` (the dry run) on the server, and share its
  report privately. It holds no secrets, but it does hold real names and paths.
- **Before S5:** put the alert targets' URLs and tokens in secret files.
- **Still left from M1, all optional:** the Renovate app, `PLEX_TOKEN` (the nightly Plex
  check) and a Docker Hub token. The release checklist is
  [releasing.md](../releasing.md).

## Later

The old M2 and M3 items are on the "Later" list in
[the M1 roadmap](m1-roadmap.md#after-m1). On 2026-10-31 the owner moved
Audiobookshelf into M2 and dropped Bookshelf.
