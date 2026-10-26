# Architecture

This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
covering what is built so far (Slices 1 to 9). The design describes the whole of M1;
this page describes what exists.

## The idea

You describe the stack you want in one file, `stack.yaml`. Mediaplane then works like
`terraform plan` and `apply`:

- `plan` works out what would change, and changes nothing in your stack (in the image,
  it joins the stack's wiring network, to ask the apps: see [The wiring](#the-wiring)).
  Checking a key or a password can leave small marks in an app: a failure recorded in an
  app's status of a client, link or connection, a sign-in in Jellyfin's activity log, a
  line in Seerr's log for each of its checks that fails (and one in the arr's, for a key
  the arr refuses), and an arr listed among Plex's devices, by the arr's first test of
  its connection to Plex. It never runs an app's first-run setup, nor finishes Seerr's,
  and never calls plex.tv. The
  [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more. It
  also says what changed in the apps outside Mediaplane since it applied them: drift;
- `apply` makes those changes, then plans again to check that nothing is left;
- `drift` reports only what changed outside Mediaplane, and `keep` keeps a change of
  yours (see [Drift and Keep mine](#drift-and-keep-mine)).

What it writes is an ordinary Docker Compose project, which runs without Mediaplane.

## What runs where

```text
host (Docker)
│
├─ mediaplane-system  Compose project
│  ├─ mediaplane      container
│  │    the CLI, idle until
│  │    you run a command
│  └─ socket-proxy    container
│       the only container
│       with Docker's socket
│
├─ mediaplane         Compose project
│    your stack: Sonarr,
│    Radarr, Jellyfin, …
│    and its wiring network,
│    which mediaplane joins
│
├─ host helper        container
│    throwaway, during init,
│    plan, apply, vpn-check
│
└─ plex.tv helper     container
     throwaway, one plex.tv
     call each, on Docker's
     default bridge network
```

- **`mediaplane-system`** is Mediaplane's own Compose project. Apply never manages it,
  and the runtime refuses to, but for one thing: it puts Mediaplane's own container on
  the stack's wiring network, and takes it off for `up` ([The wiring](#the-wiring)).
  [`deploy/README.md`](../deploy/README.md) shows how to start it.
- **The Mediaplane container** has a read-only root, no capabilities and
  `no-new-privileges`. It runs as the user who owns the home.
  - Its only mount is the home, at the same path as on the host, because the host's
    Docker resolves every path in `compose.yaml`. `plan` checks that the home's
    `stack.yaml` is the host's own file at that path (`preflight.home-path`).
  - Its networks are internal, so it has no route out. One reaches the socket proxy;
    the other, the stack's wiring network, reaches the apps whose API it calls
    ([ADR 0011](adr/0011-a-private-wiring-network.md)). Image pulls happen in the Docker
    daemon, which has the host's network.
  - It sets `net.ipv4.ip_forward: 0`, so it can't route between the two networks. Only
    the IPv4 key is set: the networks have no IPv6, and the IPv6 key fails on hosts
    without IPv6.
- **The socket proxy** is the only container with Docker's socket. It forwards only the
  kinds of Docker API call the engine makes, by method and path
  ([ADR 0008](adr/0008-docker-socket-proxy-on-by-default.md)). It is defence in depth,
  not a boundary: the [threat model](security/threat-model.md) says what it leaves open.
- **The host helper.** From inside its container, Mediaplane can't see the host's
  network, free ports, devices, or folders outside the home. So during `init`, `plan`,
  `apply` and `vpn-check`, it runs a throwaway container of its own image on the host
  network, which reports what it sees as JSON. That container:
  - gets read-only mounts of the data folder, the home's `stack.yaml`, and `/dev` when
    the VPN needs `/dev/net/tun`. Read-only has two limits
    ([threat model](security/threat-model.md)):
    - before Docker 25, or on a kernel older than 5.12, it is not recursive, so a mount
      inside one of those folders, such as `/dev/shm`, stays writable;
    - on any version, device files under `/dev` stay writable where Docker's device
      rules and their file modes allow;
  - runs as Mediaplane's user, with no capabilities and a read-only root;
  - never pulls an image, and is removed when it exits.
- **The plex.tv helper.** plex.tv is the one outside service Mediaplane calls: for
  `plex-login`, for Plex's claim token, and to ask whose a Plex or a Seerr is. Each call
  runs a throwaway container of its own image, `mediaplane plex-tv`, on Docker's default
  `bridge` network, which has a route out and reaches none of the stack's networks
  ([ADR 0012](adr/0012-reach-plex-tv-through-a-short-lived-helper.md)). It can reach
  what any container there can: the host's published ports, your LAN, and other
  containers on that bridge. That is harmless while its code is Mediaplane's own and it
  calls only plex.tv's fixed address. The request, your token in it, goes on its
  standard input, and the answer comes back as JSON on its standard output. It has no
  mount and no capabilities, a read-only root, and never pulls an image.
- **Running from source** (`pnpm mediaplane`, for development), `MEDIAPLANE_IMAGE` is
  unset. There is no container and no helper: the CLI runs under Node on the host, looks
  at the host itself, and calls plex.tv itself. It reaches the apps on the wiring network
  from the host, which reaches every container on a Docker bridge network. That is checked
  on Docker 29.8; CI checks it on Docker 28.

## The engine

Each part, and where its code is:

- **config** (`packages/engine/src/config`): loads `stack.yaml` and validates it with
  Zod. Secrets are references to files or environment variables, never values
  ([ADR 0009](adr/0009-no-secrets-in-stack-yaml.md)).
- **catalog** (`catalog/<app>/app.ts`): one typed definition per app, with its image
  pinned by tag and digest. The types are in `packages/engine/src/catalog`.
- **resolver** (`packages/engine/src/resolver`): turns the config and the catalog into
  the apps to run. It checks their dependencies and the host's architecture, and works
  out ports and bind addresses.
- **renderer** (`packages/engine/src/render`): renders `compose.yaml` and `.env`, the
  same bytes for the same input.
- **secrets** (`packages/engine/src/secrets`): generates each key once, and the shared
  admin password, and keeps them in `state/secrets.json`.
- **pre-start files** (`render/prestart.ts`, `plan/prestart.ts` and
  `apply/prestart.ts` in `packages/engine/src`): the files some apps read when they
  start, from each app's `configFiles` in the catalog.
- **runtime** (`packages/engine/src/runtime`): the only code that runs `docker`.
- **host and preflight** (`packages/engine/src/host`, `packages/engine/src/preflight`):
  read the host's facts, and check the host before anything changes. In the container,
  they ask the host helper.
- **planner** (`packages/engine/src/plan`): diffs the files, the containers and the keys,
  lists the apps that are not healthy yet, and asks the apps what the wiring would
  change.
- **apply** (`packages/engine/src/apply`, and the lock in `packages/engine/src/state`):
  runs the steps below, converging forward
  ([ADR 0004](adr/0004-converge-forward-apply.md)).
- **first-run setup** (`plan/bootstrap.ts` and `apply/bootstrap.ts` in
  `packages/engine/src`, and each app's `bootstrap` in the catalog, such as
  `catalog/jellyfin/bootstrap.ts`): an app whose setup anyone could finish is set up
  before its port is published, when `apply` runs the stack (see
  [Bootstrap before publish](#bootstrap-before-publish)).
- **history** (`packages/engine/src/history`): writes a change record for every apply
  that runs its steps, failed ones included.
- **status** (`packages/engine/src/status.ts`): each app's container state and health,
  and the last apply.
- **credentials** (`packages/engine/src/credentials.ts`): the shared admin login, and
  where each app's web UI is, with its web path (Plex's is `/web`).
- **plex.tv** (`packages/engine/src/plextv`): the client for plex.tv (its PIN sign-in, a
  claim token, and whose account a token is), and the helper that runs it in the image.
- **http** (`packages/engine/src/http`): the client for the apps' APIs (see
  [The wiring](#the-wiring)).
- **integrations** (`packages/engine/src/integrations`, and `catalog/<app>/integration.ts`):
  what Mediaplane manages in each app, and how `plan` and `apply` wire it.
- **vpn** (`packages/engine/src/vpn`): `vpn-check`. It reads the containers, runs a probe
  inside qBittorrent's network, and compares where qBittorrent's traffic and the host's
  leave from (see [`vpn-check`](#vpn-check)).
- **drift and keep** (`packages/engine/src/drift.ts`, `packages/engine/src/keep.ts`, the
  overrides in `packages/engine/src/integrations/overrides.ts`, and the writer of
  `stack.yaml` in `packages/engine/src/config/overrides-file.ts`): what changed in the
  apps outside Mediaplane, and Keep mine (see [Drift and Keep mine](#drift-and-keep-mine)).
- **CLI** (`packages/cli`): the commands, human and `--json` output, and exit codes
  ([reference](reference/cli.md)).

## `plan`

```text
stack.yaml + secrets/
  │ load, validate
  ▼
resolve
  │ catalog, host facts,
  │ ports, addresses
  ▼
ask Docker
  │ versions, what runs
  ▼
preflight
  │ disk, data folder,
  │ devices, ports, home
  ▼
render
  │ compose.yaml, .env,
  │ pre-start files
  ▼
diff
  │ files, containers,
  │ keys to recover from
  │ appdata, to generate,
  │ or to put back,
  │ apps not healthy yet,
  │ first-run setups
  ▼
ask the apps
  each resource: create,
  update, adopt, unchanged,
  or after the start; and
  what changed outside
  Mediaplane: drift
```

`plan` writes nothing. Its exit code is 0 when nothing would change, 2 when something
would (or an app is still waiting for its health check), and 1 on an error. In the
image, when an app is running and left as it is, it joins Mediaplane's container to the
stack's wiring network, to ask that app. The join changes no app and no file; the
questions can leave the marks named above. What it finds shows under `Wiring:`, and as
`wiring` in `--json` (see [The wiring](#the-wiring)).

**Which containers change** comes from Compose itself
([ADR 0010](adr/0010-predict-container-changes-with-compose-hashes.md)):

- `plan` pipes the unwritten `compose.yaml`, with your `compose.override.yaml`, into
  `docker compose config --hash`;
- it compares each service's hash with the label on its existing container.

Compose versions can hash the same file differently. So the first time a different
Compose version manages the stack, it recreates most containers once, keeping their
data. That happens when you eject with a host Compose of another version, or when an
update to Mediaplane's image brings a new one.

## `apply`

```text
lock
 → plan, then ask
 → save the keys found
   in appdata, generate
   the rest
 → write files, and
   pre-start files
   if absent
 → pull images
 → set appdata owners
 → step off the wiring
   network; stop a
   stranded qBittorrent,
   and an app whose key
   goes back in its file
   (then written)
 → up --wait, an app
   still to set up with
   no published port
 → set it up, keep its
   key, up --wait again
 → wire each app
 → plan again, and
   vpn-check's checks
 → write change record
 → unlock
```

- **Converge forward** ([ADR 0004](adr/0004-converge-forward-apply.md)). When a step
  fails, the later ones are skipped and nothing is rolled back. Running `apply` again
  plans afresh, and does only what is left.
- **Images are pulled before any container changes.** Nothing is stopped before the
  pull, so a network failure leaves the running stack alone.
- **Keys are saved before any container starts.** A key `state/secrets.json` lacks is
  first looked for in the app's own appdata, and only generated when the app holds none:
  see [Rebuilding a host](#rebuilding-a-host).
- **Pre-start files are written once, before the first start.** Some apps read a file
  when they start: Sonarr's, Radarr's and Prowlarr's `config.xml`, qBittorrent's
  `qBittorrent.conf` and Gluetun's `auth/config.toml`. Apply writes each one only when
  it is absent, in the files step, 0600, and never changes it after that, because the
  apps rewrite them. `plan` lists them as `before first start`, without their content.
  A file that is there but lacks Mediaplane's key is from an install made before
  Slice 3a: apply puts the key in it, the app stopped (see
  [Rebuilding a host](#rebuilding-a-host)).
- **Pulls are retried.** When a registry times out, drops the connection, answers with
  a 500, 502, 503 or 504 error, or rate-limits, apply pulls again, up to three times,
  after 5, 15 and 45 seconds. Other errors, such as a missing image or a refused login,
  fail at once.
- **`up --wait`** waits until every app is healthy. It fails as soon as an app is marked
  unhealthy, and gives up after 10 minutes.
- **First-run setup** comes between `up` and the wiring, for an app that `plan` lists
  under `First-run setup:`: see [Bootstrap before publish](#bootstrap-before-publish).
- **A stranded qBittorrent is restarted.** qBittorrent joins Gluetun's network when it
  starts. When Gluetun starts again on its own, or `apply` starts a stopped one, Compose
  leaves qBittorrent with the old network, which is gone. So `plan` lists qBittorrent as
  `restart` then, and apply stops it before `up`, which starts it again in Gluetun's new
  network.
- **Verify** plans again, and nothing may be left to do. With qBittorrent behind
  Gluetun, it also runs vpn-check's checks, without the address comparison.
- **The lock** records the process and the host name. That is why the Mediaplane
  container's host name is fixed: a recreated container can still clear a lock its
  predecessor left.

## The home

```text
/opt/mediaplane/
├─ stack.yaml        yours
├─ compose.override.yaml
│                    yours
├─ secrets/          yours
├─ generated/        rewritten
│  ├─ compose.yaml
│  ├─ compose.prev.yaml
│  └─ .env           0600
├─ state/            0700
│  ├─ secrets.json   0600
│  ├─ resources.json 0600
│  ├─ history/
│  └─ lock
└─ appdata/          0700
   └─ <app>/         the apps'
```

- **`stack.yaml`** is the only file you normally edit
  ([reference](reference/stack-yaml.md)). `init` writes a starter one. It sets `user:`
  to the user it runs as: in the container that is `MEDIAPLANE_UID`, or 1000 when run as
  root. It sets `timezone` to the zone it runs in, unless you pass `--timezone`. In the
  container that is `TZ`, which `deploy/.env` sets to the host's zone, or `UTC`.
- **`secrets/`** holds your secret files, such as the VPN key, which `stack.yaml` points
  to. In the container Mediaplane sees nothing outside the home, so keep them here.
- **`compose.override.yaml`** is yours. Mediaplane never writes it. Compose merges it
  over the generated file, and `plan` includes it.
- **`generated/`** is Mediaplane's: apply rewrites it, so never edit it. The header of
  `compose.yaml` gives the exact `docker compose` command that runs the stack without
  Mediaplane.
- **`appdata/<app>/`** is each app's. Mediaplane creates the folder, gives it to the
  app's user where the app needs that (Seerr), and writes its pre-start files once. The
  rest is the app's. It holds keys and qBittorrent's password hash, so treat it as
  sensitive. The apps rewrite their own files readable by all, so Mediaplane keeps
  `appdata/` itself private (0700), on every apply. Docker mounts each app's folder as
  root, so the apps don't need to pass through it. `plan` notes when `appdata/` isn't
  private yet, and warns when another user owns it, because apply can't change it then.
- **`state/`** is Mediaplane's own record, private to its owner (0700): the keys it
  generated (`secrets.json`), what it manages in each app (`resources.json`, which never
  holds a secret's value), the change records (`history/`) and the apply lock.
- **The home's filesystem must support hard links,** because the lock, `init`'s
  `stack.yaml` and the pre-start files are created with one.

The data folder (`paths.data`) is yours. The apps that handle media files (Sonarr,
Radarr, qBittorrent, and Jellyfin or Plex) mount it as `/data`. Keep downloads and media
inside it, on one filesystem, so moving a finished download into the library is an
instant hardlink. `plan` checks that `torrents/`, `usenet/` and `media/`, where they
exist, are on the same filesystem as the folder itself. qBittorrent saves into
`/data/torrents`, a folder per category, and Sonarr's and Radarr's libraries are
`/data/media/tv` and `/data/media/movies`, which `apply` makes, and which are Jellyfin's
Shows and Movies libraries.

## Rebuilding a host

A host is rebuilt from `stack.yaml`, `secrets/`, `compose.override.yaml`, `appdata/` and
the data folder. Mediaplane makes the rest again
([runbook](runbooks/rebuilding-a-host.md)):

```text
appdata/<app>/
  │ the app's own files
  ▼
keys state/secrets.json
lacks, read back
  │ never through a link
  │ out of the folder
  ▼
plan: secrets.recover
  ▼
apply's keys step
saves them
  ▼
the wiring: each
resource found by its
name, and adopted
```

- **Key recovery.** Each app says where it keeps its keys (`keyFiles` in the catalog):
  `config.xml` for Sonarr, Radarr and Prowlarr, `qBittorrent.conf`, Seerr's
  `settings.json`, Gluetun's `auth/config.toml`, and Jellyfin's database, opened
  read-only with Node's own SQLite. A key file that is there but can't be read stops
  `plan` (`keys.unrecoverable`): a new key would lock Mediaplane out of an app that still
  holds the old one.
- **The admin password can't be read back:** the apps keep a hash. When the one
  Mediaplane generated went with `state/`, apply generates another, and sets it in each
  app through the app's key. `apply --rotate admin.password` does the same on purpose.
  A secret apply generates is never checked by `plan`: no app holds it yet.
- **Re-adoption.** Every resource Mediaplane makes has a name of its own, by which it is
  found when `state/resources.json` lacks its id (`adopt`).
- **A key changed at its source.** An app that keeps its key in a file of its own
  (qBittorrent, whose web UI rotates it there, Gluetun, and the arrs' `config.xml`) gets
  the key Mediaplane holds back: `plan` lists it under
  `Keys to put back in their apps' own files`, the app as `restart`, and apply's start
  step stops the app, writes the file, as Keep mine writes `stack.yaml`, and `up` starts
  it again. `mediaplane keep <app>.<key>` keeps the app's own key instead, once the app
  takes it, and the next `apply` gives it to every resource that holds the old one.
  Jellyfin, which makes its own key, is signed in to again, while it stays published,
  and makes another.
- **A first-run setup that fails** fails its step, but the wiring still runs, skipping
  that app's resources and what requires them; verify doesn't run.

## Bootstrap before publish

Jellyfin's startup wizard answers whoever reaches it, and whoever finishes it owns the
server. An unclaimed Plex lets whoever reaches it claim it for their own plex.tv
account. So does Seerr's setup: until its first sign-in, anyone who reaches it can sign
in through a Jellyfin or a Plex account of their own, and be its admin. So `apply`
publishes none of them while it is open (see
[T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
for what voids that):

```text
plan
  │ Jellyfin: system.xml says
  │ the wizard isn't done;
  │ Plex: Preferences.xml
  │ holds no token;
  │ Seerr: settings.json names
  │ no media server; or
  │ Mediaplane has no record
  │ that it set Plex or Seerr
  │ up
  ▼
up --wait
  │ each with no port
  │ published: one more
  │ Compose file, on stdin,
  │ resets their ports (and
  │ gives Plex PLEX_CLAIM)
  ▼
first-run setup, over the
wiring network, in order
  │ Jellyfin: the wizard, as
  │ the shared admin; make
  │ the key, keep it
  │ Plex: wait for its claim;
  │ plex.tv must say it is
  │ yours
  │ Seerr: sign in through
  │ Jellyfin, as that admin,
  │ or with your Plex token;
  │ sign out
  ▼
up --wait again
  each published
```

- **Which apps.** An app with a `bootstrap` in its catalog entry, whose key isn't stored,
  or whose appdata doesn't say its setup is done (Jellyfin's `system.xml`). It starts
  unpublished unless its appdata says the setup is done: then only its key is to make.
  `plan` lists it under `First-run setup:` (`bootstrap` in `--json`), shows its container
  recreated when it runs published, and checks its wiring after the start. It never
  runs the setup. A file Mediaplane can't read says nothing: with the key stored, the
  key decides, and `plan` warns (`bootstrap.unreadable`) that it can't tell. Seerr's
  setup makes no key (Mediaplane makes Seerr's, in `API_KEY`), so it counts as done only
  when its `settings.json` says so and Mediaplane's record does: `setUp` in
  `state/secrets.json`, a list of app names and no secret. A Seerr with no record, as
  one set up by hand before this slice, or by someone else, starts unpublished once and
  is checked (below). The record is dropped when a pending setup runs, and made again
  only by a success. A file Mediaplane can't read has Seerr start unpublished, and set
  up again, on every `apply`, with that warning, and each such `apply` fails at verify
  (exit 1), until the file is readable. An app with a setup can't run inside another
  app's network, which would publish its ports: `plan` fails with
  `bootstrap.network-via`.
- **Plex** (spec §6.4). Its first start gets `PLEX_CLAIM`: a claim token of your plex.tv
  account, which `apply` fetches with your Plex token (`plex.token`) the moment before,
  through the plex.tv helper, since it lasts four minutes and works once. The extra file
  on Compose's standard input sets it, as `"${MP_START_PLEX_PLEX_CLAIM}"`, which Compose
  takes from its own environment, so it is in no file. The start step asks for it before
  it changes anything. Without one (no token, plex.tv refusing your token or not
  answering, or the helper failing), it fails, and stops every app that runs and isn't
  yet shown to be yours, Plex, and Seerr: a Plex an `apply` before this slice published
  unclaimed, say, or a Seerr set up by hand then. The
  image trades the claim token at plex.tv for a token of your account, which it saves in
  `Preferences.xml`. The setup waits, as long as `apply` waits for an app, until Plex
  says it is claimed, asking `/identity` without your token, then asks plex.tv whose
  account the token in Plex's `Preferences.xml` is: it must be yours. That is plex.tv's
  answer, which Plex's admin can't shape: they can change Plex's machine identifier
  (probed), but not give Plex a token of your account. Only a 401 from plex.tv counts as
  a refusal; a 403, a 429, a 5xx, no answer, a helper that fails or runs out of time, or
  Docker failing on the way is "couldn't tell". A helper answer Mediaplane doesn't
  understand is a protocol error, which refuses Plex (`rejected`). Each keeps Plex
  unpublished. Only then does Plex get
  your token, on one call: the read of its settings (`GET /:/prefs`). The setup checks
  that none lets a client in without a sign-in: `allowedNetworks` empty,
  `enableLocalSecurity` at `-1` (Plex's default) or `1`, and `DlnaEnabled` off. Anyone
  could set them while Plex was unclaimed, and they survive the claim. It checks them
  before Plex's first publish only, never on a later `apply`. Plex is set up when
  `Preferences.xml` holds a token and Mediaplane's record names it. Its setup makes no
  key: Plex's key is your token.
- **Seerr on a Plex stack** signs in with your Plex token (`POST /api/v1/auth/plex`),
  which makes your plex.tv account its admin, and Plex its media server type; then it
  signs out. A Seerr set up already is checked with its key: its admin's plex.tv account
  must be the one plex.tv says your token is, and its Plex unset or the stack's, without
  TLS. It is never signed in to, which would give your token to whoever set it up.
- **Seerr's first sign-in must be its admin's,** through Jellyfin or with your Plex
  token: Mediaplane asks the session it got whose it is (`GET /api/v1/auth/me`), and
  anything but Seerr's first user means someone signed in first. Mediaplane then signs
  out, and Seerr is treated as set up by someone else: it stays unpublished, and the
  error gives the safe ways out first.
- **In order.** The setups go in the order of the apps' integrations: Seerr comes after
  Jellyfin, or Plex. A setup that can't run yet waits: Seerr's, while Jellyfin refuses the
  shared admin's password, or after Jellyfin's or Plex's own setup failed. The app stays
  as it was, unpublished; the step warns (`bootstrap.waiting`), the wire step wires the
  rest and skips its resources, and verify fails with the setup left to do. The next
  `apply` sets it up, once the wire step has set Jellyfin's admin. Mediaplane asks the app
  once more after it waits: if someone else finished its setup meanwhile, the step fails
  as for a claimed setup (below), and the app stays unpublished.
- **No port at all.** The file Compose gets on its standard input, after
  `compose.override.yaml`, sets the app's `ports` to `!reset []`, so the override's ports
  go too. `compose.yaml` itself always has the ports, so the stack runs as written
  without Mediaplane, and then Jellyfin, Plex and Seerr start published with their setup
  open.
  The reset covers `ports` only: an override with `network_mode: host`, or a network
  shared with a service that publishes, voids the guarantee (see
  [T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)).
- **The setup** reaches the app on the wiring network without a key. For Jellyfin, it
  finishes its wizard, and keeps the key it makes in `state/secrets.json` at once. For
  Seerr, it signs in through Jellyfin (`POST /api/v1/auth/jellyfin`, with Jellyfin's
  service and port), as the shared admin: that makes it Seerr's admin, and Jellyfin
  Seerr's media server. Seerr's key works from then on, so the session is signed out of
  at once. A Seerr that is set up already is checked with its key, never by sending the
  password, which it would pass to whatever Jellyfin it was set up with. That includes
  one with no record, and one found set up when the sign-in fails, since someone may have
  signed in first. It is Mediaplane's only when its admin (its first user) is the shared
  admin and its Jellyfin is the stack's, with no URL base and no TLS; a pass is recorded,
  and a failure of any kind, including a question Mediaplane couldn't get answered, keeps
  it unpublished. Then Mediaplane steps off the wiring network, `up` runs again, without
  the extra file, and Compose recreates the app with its ports. Before that, the engine
  asks the app once more whether its setup is still open, and publishes it only if it is
  not. If it still looks open, or can't be asked, the step fails and that app is not
  published. An app whose setup failed while it is still open stays unpublished; one whose
  setup is done is published even when making its key failed. But an app the plan started
  unpublished, whose shared admin is then refused, stays unpublished whatever it says: its
  setup was finished with another login while Mediaplane set it up. For Jellyfin, its
  appdata, read again, tells that from a setup done by hand whose file Mediaplane can't
  read, and the error says which. Seerr has no key to tell by: one set up, but not shown
  to be Mediaplane's, stays unpublished on every `apply` until it is. A setup that makes
  no key (Seerr's) that fails in any way never publishes its app, however set up it then
  looks.
- **No new Docker call:** the proxy allows nothing new.

## The wiring

Wiring is what Mediaplane does through each app's API once the apps run. Today that is
the shared admin login in Sonarr, Radarr, Prowlarr, qBittorrent and Jellyfin; the
download path: qBittorrent's settings and categories, and Sonarr's and Radarr's download
client and root folder; the indexers: Prowlarr's links to Sonarr and Radarr, and its
indexer proxy; the media server: Jellyfin's libraries, and Sonarr's and Radarr's
connection to it, or on a Plex stack, Plex's name and libraries, and Sonarr's and
Radarr's connection to it; and the requests app: Seerr's links to its media server,
Sonarr and Radarr.

```text
mediaplane-system
  mediaplane
    │ wiring network:
    │ internal, no way out
    ▼
mediaplane (the stack)
  sonarr, radarr, prowlarr,
  jellyfin, seerr
  gluetun ─ qbittorrent
  (each keeps its default
  network, for its own
  traffic)
```

- **The wiring network** is part of `compose.yaml`: `wiring`, with `internal: true`.
  Every app whose API Mediaplane calls is on it, and Gluetun is on it for qBittorrent.
  Gluetun counts it as local, so its firewall lets it through to qBittorrent's port. The
  apps are reached at their container's address on it, with
  `Host: <service>:<port>`, as the other apps reach them. In the image, `plan` and
  `apply` join Mediaplane's container to it, and it stays; `apply` steps off for `up`,
  so that Compose can make the network anew if it must (only without the proxy, which
  lets no one delete a network: [ADR 0011](adr/0011-a-private-wiring-network.md)).
- **Joining** reads the network strictly first: it must be internal, a bridge, and carry
  this project's Compose labels for `wiring`, or the runtime refuses it. It then joins by
  the ID it read. **Leaving** reads the network and takes Mediaplane off by that ID; it
  has no refusal of its own. Both touch Mediaplane's own container and that network,
  and nothing else.
- **Each app's integration** (`catalog/<app>/integration.ts`) lists the resources
  Mediaplane manages in it, such as `sonarr.admin`. For each, it says how to read it
  from the app, which of its fields are managed, which secrets it holds, and how to
  create or change it. The app's README lists them.
- **The download path:**

  ```text
  sonarr, radarr
    │ download client
    │ qBittorrent (Mediaplane):
    │ gluetun:<qBittorrent's
    │ port>, its key, category
    ▼
  gluetun ─ qbittorrent
    categories tv, movies:
    /data/torrents/<category>
  ```

  - qBittorrent comes first: its login, its settings (the save path `/data/torrents`,
    Automatic Torrent Management on, and who may skip the login) and a category for each
    arr in the stack.
  - Sonarr and Radarr come after it. Each gets `qBittorrent (Mediaplane)` as its download
    client, which needs qBittorrent's category for it: one that failed skips the
    client. They reach qBittorrent the way they reach any app: behind the VPN, as
    `gluetun`, whose network qBittorrent shares, at qBittorrent's own port.
  - Each arr's root folder, `/data/media/tv` or `/data/media/movies`, is made first in a
    throwaway container of the arr, as the stack's `user:`, then added to the arr.

- **The indexers:**

  ```text
  prowlarr
    │ link "<arr> (Mediaplane)":
    │ full sync, the arr's key
    ▼
  sonarr, radarr
    your indexers, synced:
    "<name> (Prowlarr)"

  prowlarr ─► byparr
    or flaresolverr: only for
    indexers tagged cloudflare
  ```

  - Prowlarr comes after Sonarr and Radarr. For each, Prowlarr gets a link with full
    sync: it reaches the arr at `http://<arr>:<port>`, and the arr reaches it back at
    `http://prowlarr:9696`. Each link needs the arr's admin in place first: while the arr
    isn't up, or its admin login is yet to be set, `plan` leaves the link's key for
    `apply` to check.
  - Prowlarr tests a link, and a proxy, as it saves a new one, and Mediaplane's check of
    a link's key is the same test: Prowlarr calls the arr with the key, and the arr calls
    Prowlarr back.
  - The indexer proxy is the stack's Cloudflare solver, Byparr or FlareSolverr, as a
    proxy of type FlareSolverr, tagged `cloudflare`. Prowlarr runs the test itself when
    it creates the proxy: it has the solver fetch a page of Prowlarr's own service on
    the internet, so that `apply` needs the internet. The proxy holds no secret, so
    Mediaplane never runs that test, and `plan` never sends it; `plan` does compare the
    proxy's host, timeout and tags on every run. `drift` reads what Prowlarr's own health
    check, which tests its proxies every six hours, last found.
  - The indexers are yours: you add them in Prowlarr, which syncs them to the arrs, and
    sends those tagged `cloudflare` through the solver when their site answers with a
    challenge.

- **The media server:**

  ```text
  sonarr, radarr
    │ connection "Jellyfin
    │ (Mediaplane)": update the
    │ library on import, with
    │ Jellyfin's key
    ▼
  jellyfin
    Movies: /data/media/movies
    Shows: /data/media/tv
  ```

  - Jellyfin comes first, once it is set up: its shared admin, and the Movies and Shows
    libraries, each in the folder its arr files into. Each folder is made first, in a
    throwaway Jellyfin container, as the arrs' root folders are.
  - Sonarr and Radarr come after it. Each gets `Jellyfin (Mediaplane)`, an Emby / Jellyfin
    connection that has Jellyfin update its library when a file is imported, upgraded,
    renamed or deleted. Its key is checked with the arr's own test, which calls Jellyfin
    with it. It needs Jellyfin's admin in place: while Jellyfin is still to be set up,
    `plan` leaves the connection's key for `apply` to check. A connection set by hand to
    TLS or a URL base reads as moved, and the next `apply` puts back `jellyfin:8096`
    without either, so the key goes only to the stack's own address.

- **The media server, on a Plex stack:**

  ```text
  sonarr, radarr
    │ "Plex (Mediaplane)":
    │ your Plex token, update
    │ the library on import
    ▼
  plex
    named "Mediaplane"
    Movies, TV Shows
  ```

  - Plex's name (`plex.server`) is `Mediaplane`, or `apps.plex.server_name`: a new Plex
    shows its container's random hostname, which could be taken for another Plex of
    yours. It is set with `PUT /:/prefs`, with your token.
  - Its libraries (`plex.library_movies`, `plex.library_tv`) are `Movies` and `TV Shows`,
    on `/data/media/movies` and `/data/media/tv`, with the agent and scanner Plex's web
    UI gives a new one (`tv.plex.agents.movie` and `Plex Movie`,
    `tv.plex.agents.series` and `Plex TV Series`), in English (`en-US`). A library is
    known by name; one that holds another kind is refused, since Plex can't change it.
  - Plex answers before it has started for good, and takes no change then (`400`, "the
    server is still starting up"). So the wire step waits until `/identity` no longer
    says `startState`.
  - Sonarr's and Radarr's connections to Plex (`<arr>.connection_plex`) reach it at
    `plex:32400`, without TLS or a URL base, with your Plex token, and have Plex update
    its library on each import. They share their code with the Jellyfin connections
    (`catalog/_shared/servarr-connection.ts`). The token is checked with the arr's own
    test, never compared, and an arr's test needs a Plex library of its kind, so each
    requires that library. A connection held with TLS or a URL base reads as moved, so
    the token is never sent to an address read from the arr.
  - Mediaplane never sets Plex's remote access, nor the settings that let a client in
    without a sign-in (`allowedNetworks`, `enableLocalSecurity`, `DlnaEnabled`): Plex's
    defaults stay. Its first-run setup checks the second three before Plex is first
    published (above).

- **The requests app:**

  ```text
  seerr
    │ media server: jellyfin,
    │ Movies and Shows enabled
    │ servers "<arr>
    │ (Mediaplane)": the arr's
    │ key, its root folder, a
    │ profile, the default
    ▼
  jellyfin, sonarr, radarr
  ```

  - Seerr comes last, after Jellyfin, Sonarr, Radarr and, when the stack has it,
    Prowlarr, once its first sign-in (above) has made its admin: its key works only from
    then on.
  - Its media server is Jellyfin, at `jellyfin:8096` with no URL base and no TLS (a URL
    base or TLS set in Seerr counts as Jellyfin moved, and is put back), with Mediaplane's
    Movies and Shows libraries enabled; a library you enable yourself stays yours. The key
    Seerr uses for Jellyfin is the one Seerr made itself as it signed in. It stays while
    it works, which Mediaplane checks with Seerr's list of Jellyfin's users. When Jellyfin
    refuses it, or Jellyfin moves, Mediaplane gives Seerr its own Jellyfin key; on a move,
    Seerr's libraries are synced again too, since another Jellyfin has other library ids.
    It needs Jellyfin's admin and libraries in place.
  - Its Sonarr and Radarr servers reach each arr at its service and port, with its key,
    file into its root folder, and are the default, so requests go there. The quality
    profile is the one `apps.seerr.sonarr_profile` (or `radarr_profile`) names, else
    `HD-1080p`, else `Any`, else the arr's first: only the arr knows which it has, so
    Mediaplane asks it through Seerr's own test. Seerr shows a server's key in clear;
    Mediaplane checks it with Seerr's test of the server it holds, at the arr's own
    address, never by comparing it. A server Seerr holds with TLS or a URL base reads
    as changed, and is put back. A new Sonarr server uses season folders, as Sonarr's own
    default; a Radarr one doesn't, since films have none. Each needs its arr's root folder
    in place.
  - An arr's key, and Jellyfin's, go only to that app's own address in the stack, with no
    URL base, never to a host, port or URL base read from Seerr: anyone with Seerr's admin
    can change those. Every key Mediaplane reads from Seerr is kept out of its output: the
    one Seerr made in Jellyfin, the arrs' keys that Seerr shows, and the keys in
    Jellyfin's list.
  - Last, Seerr's setup is finished (`initialize`), once its links are in place, so its
    web UI stops offering its admin the setup wizard.
  - A request goes from Seerr to the arr through TMDB, an outside service: the end-to-end
    tests stop at the links, and Seerr's own test of each.
  - On a Plex stack, its media server (`seerr.media_server_plex`) is Plex, at
    `plex:32400` without TLS (Seerr's Plex has no URL base), with the Movies and TV Shows
    libraries enabled. Seerr reaches Plex with its admin's token, yours, from its first
    sign-in: the link holds no secret of Mediaplane's.
  - Seerr keeps the address of Plex even when it couldn't save the link, but sets Plex's
    own id (`machineId`) only once it has. It sets Jellyfin's (`serverId`) at its first
    sign-in and on each link it saves. A link with an empty id reads as not linked, and
    `apply` links it again.

- **Each resource** is one of:
  - `create` or `update`: the app lacks it, or a managed field or a secret differs. A
    secret is checked by using it, never compared: signing in, or the app's own test, as
    Sonarr's test of its download client, or Prowlarr's of its link to Sonarr. While a
    field differs, the secrets aren't checked: the update sets them anyway. `plan` also
    leaves them unchecked until a resource they require is in place (`unchanged` or
    `adopt`) and checked, since the check could make what is missing, and `plan` changes
    nothing. `apply` doesn't check again a secret its own plan found refused: it sets it.
  - `adopt`: the app already holds it as wanted, but `state/resources.json` doesn't say
    so yet, such as after lost state.
  - `unchanged`.
  - `after start` (`after-start` in `--json`): its app isn't running yet, or apply will
    change its container.
  - `unknown`: Mediaplane couldn't ask the app, and a warning says why.
- **The wire step** waits until each app is ready (`/ping` for Sonarr, Radarr and
  Prowlarr, `/System/Info/Public` for Jellyfin, `/api/v1/settings/public` for Seerr),
  checks that its key still works, then
  makes each resource what the stack
  wants, in order: an app comes after the apps its integration names. A resource that
  fails doesn't stop the others, and one that needs it is skipped. Each result is kept at
  once in `state/resources.json`: each resource's id, name and managed fields, and the
  names of its secrets, never their values.
- **The client** (`http/client.ts`) goes straight to the container, through an HTTP
  agent of its own, never through a proxy from the environment. It sends the app's key in
  a header, never in the URL: Jellyfin's in its `Authorization: MediaBrowser` header,
  which names Mediaplane as its client on every call, as Jellyfin's sign-in needs. It
  tries a refused or cut connection, a timeout, or a 502,
  503 or 504 again, waiting longer each time, for up to two minutes in `apply` and 15
  seconds in `plan`; a create, and qBittorrent's sign-in (each failed one counts towards
  its ban), only when nothing reached the app. It reads at most 5 MiB of an answer,
  checks its shape, and shows only the app's own message about a refusal, with every
  secret replaced.

## Drift and Keep mine

```text
stack.yaml, overrides: (D)
  what the stack wants
state/resources.json (L)
  what was last applied
the app's API (O)
  what it holds now

D ≠ L: you changed stack.yaml
O ≠ L, O ≠ D: drift, changed
  in the app, outside
  Mediaplane
```

- **`mediaplane drift`** is `plan`, looking only (spec §6.3): no host checks, and every
  app that runs and is healthy is asked, even one `apply` would change. Like `plan`, it
  joins the wiring network in the image, and it runs under apply's lock
  (`state/lock`). It reports, for each resource Mediaplane recorded:
  - a managed field the app holds otherwise than it was applied, and than the stack wants
    now, with both values; one the app holds in a shape Mediaplane can't read is said to
    be, never read as empty (`unreadable`). A field the stack no longer sets isn't drift:
    `apply` doesn't set it;
  - a resource deleted outside Mediaplane;
  - a secret the app's own check refuses, by name only: secrets are checked by using
    them, never compared or shown;
  - an app that refuses the key Mediaplane holds for it, and each resource of another app
    that holds that key: a shared key changed at its source;
  - a resource Mediaplane made that the stack no longer wants, still in the app, looked
    up by its record; one whose app can't say, or stopped answering, counts as not looked
    at.

  What an app holds, and each reason it gives, is shown without any secret the run came
  to know of, redacted once at the end of the run.

  `plan` shows the same drift. What puts each right is said by its kind: `apply` puts
  back a field, a resource or a secret, and a key changed at its source where the app
  keeps it in a file of its own; what is left in an app is removed by hand, or kept,
  until Slice 10b. Its exit code is 0 when nothing changed and every resource and secret
  was checked, and 2 otherwise.

- **Its checks leave few marks** (the owner's decisions of 2026-10-17). A secret it finds
  refused isn't checked again, by drift or `plan`, until `apply` sets it, nor is what only
  the app can say asked of that resource meanwhile: qBittorrent bans an address after
  five failed sign-ins, and the arrs and Seerr record each failed test. An app that
  refuses its own key isn't sent it again until `apply` checks it, and its resources,
  and those of other apps that hold that key, go unchecked. A check `apply` makes that
  passes takes a refusal out.
  Jellyfin's admin password is checked once a day at most while it passes (a resource's
  `checkEvery`): each check is in Jellyfin's activity log. `plan` and drift leave an
  arr's download client key unchecked while qBittorrent lacks a category the client
  names, which the arr's own test would make. Drift keeps each check's verdict and time,
  by the secret's name, and each app found refusing its own key, in
  `state/resources.json`: its one write besides its lock. It reads an app's own
  health check where one tests a resource (Prowlarr's, of its indexer proxy), and warns
  of what it found.
- **Overrides** (`overrides:` in `stack.yaml`, spec §4.2) are part of what the stack
  wants: `<app>.<resource>.<field>: <value>` sets a managed field, and
  `<app>.<resource>: unmanaged` stops Mediaplane managing a resource. `plan` checks each,
  in every stack: a field that isn't managed, a secret, a fixed field, a value of another
  type, or one its field's own rule refuses (a resource's `refuses`: a download client's
  category stays a folder in qBittorrent's downloads folder) fails it, with the closest
  name. A few fields are fixed (a resource's `locked`): what it is known by, what its app
  can't change, what Mediaplane only checks, what `stack.yaml` sets for every app (the
  shared admin's user name, and who may skip qBittorrent's login), and every field that
  says where an app sends a key. Every request that carries a key is built from the
  stack's own address for the other app (a resource's `sendsTo`), never from a field an
  override could set or from what the app holds.
- **`mediaplane keep <app>.<resource>.<field>`** takes what the app holds, where drift
  found a change, as an override: it adds one line under `overrides:` in `stack.yaml`,
  changing nothing else in the file (its mode and group kept, not an ACL), and records
  the value as applied in `state/resources.json`, so drift is clear and `apply` has
  nothing to do for it. Like `plan`, it joins the wiring network in the image, and it
  holds the lock. It checks that the app takes Mediaplane's key and reads the one
  resource, and checks no secret. For a resource deleted, or left in the app,
  `mediaplane keep <app>.<resource>` writes `unmanaged`. It never writes a secret, nor a
  value that could make the file show what it doesn't hold, and refuses a `stack.yaml`
  it can't write safely, or fails to write, giving the line to add instead
  ([ADR 0003](adr/0003-drift-detect-and-warn-with-keep-mine.md)). Keeping a download
  client's category gives qBittorrent's category that name: `apply` makes it, and drift
  is clear once it has.
- **Keep mine of a key:** `mediaplane keep <app>.<key>` keeps an app's own key, changed
  at its source, as [Rebuilding a host](#rebuilding-a-host) says.
- **Not yet:** removing what Mediaplane made when its app leaves the stack (Slice 10b);
  drift on a schedule (M2).

## `vpn-check`

`mediaplane vpn-check` checks that qBittorrent reaches the internet only through the
VPN. It changes nothing.

```text
containers, through Docker
  │ qBittorrent in Gluetun's
  │ network, joined since
  │ Gluetun last started;
  │ Gluetun running, healthy
  ▼
probe, inside that network
  │ compose run of qbittorrent,
  │ as nobody, key on stdin:
  │ Gluetun's control server,
  │ the route into tun0, and
  │ the IP-echo service
  ▼
the host's own address
  │ the same service, from the
  │ host (the host helper in
  │ the image)
  ▼
pass, down or leak
```

- **The probe** is a `compose run` of the `qbittorrent` service, so it starts in
  Gluetun's network namespace, as qBittorrent does. It reaches Gluetun's control server
  on `127.0.0.1:8000` there. So `vpn-check` needs no network route from the Mediaplane
  container, and no Docker API call that `apply` doesn't already make.
- **The egress check** asks `https://1.1.1.1/cdn-cgi/trace`, or
  `MEDIAPLANE_VPN_CHECK_URL`, from both sides. A leak is the same address on both. No
  answer through the tunnel means the VPN is down. `--no-egress` skips it. It measures
  IPv4 only.
- **The verdict:** a leak beats down, and down beats a pass. Warnings, such as a control
  server that answers without a key, don't change it. The exit code is 0 only for a pass.
  The last line never claims more than the checks found: "nothing leaks" only when
  Gluetun is stopped, or nothing answered while the route went into the tunnel or
  nowhere, and "only through the VPN" only when the two addresses were compared and
  differed.
- **`--json`** is `mediaplane.vpn-check/v1`. Its `ok` says that the check ran, and
  `verdict` says what it found. `failClosed` is true only when qBittorrent was shown to
  be in Gluetun's network, and either Gluetun is stopped, or nothing answered while the
  route went into the tunnel or nowhere.
  The addresses were compared, and differed, when the check with the id `egress` has the
  status `ok`.

## Releases and updates

- **Versions.** release-please keeps a release pull request, with the next version and
  `CHANGELOG.md`, from the Conventional Commits on `main` (the first release is 0.1.0).
  Merging it tags the release.
  [Releasing](releasing.md) has the whole process.
- **The image.** From the first release, `ghcr.io/cyclopsgd/mediaplane:<version>` is
  one index of two images,
  amd64 and arm64, each built natively on its own runner, with an SBOM and build
  provenance attached, and a signed attestation of its provenance beside it. Its times
  come from the commit, so one commit builds the same image for an architecture each
  time; the index of both is not reproducible, as its digest covers the attestations,
  which hold the build's times. Each image is scanned by Trivy before it is pushed, and
  the release checks that it pushed the image it scanned. CI makes the same build on every
  pull request, and pushes nothing.
- **Deploy files.** A release's `install.sh` and `mediaplane.compose.yaml` name its
  image by digest. In the repository both leave it out, and a checkout builds its own.
  `install.sh` refuses an image that isn't pinned, but for the one it builds, and runs
  Compose only on Mediaplane's own project, with the image it checked.
- **Updating** is `pull`, then `up -d`, on Mediaplane's own project with the next
  release's files. Only that project is recreated: its container, and the socket proxy
  too when the release changed the proxy's pin:

```text
update
 ├─ mediaplane-system
 │  ├─ mediaplane: recreated
 │  └─ socket-proxy: recreated
 │     only if its pin changed
 └─ mediaplane (your stack)
    as it was: containers,
    networks, volumes and
    generated/
```

A later `apply` runs the image's own Compose, and Compose versions can differ in a
service's configuration: the first `apply` after an update that changed the bundled
Compose may recreate every app container (a restart, keeping their data).

- **`stack.yaml`'s version.** This Mediaplane reads version 1. One that changes the format
  will read an older file through a migration, in memory, with a warning, and
  `mediaplane migrate` will rewrite the file, keeping its comments; a newer file is
  refused. No migration exists yet, so `migrate` has nothing to do.
- **The wiring network's settings never change in an update.** Compose would have to
  make it anew, and through the socket proxy it can delete no network. A release that
  had to change them would bring its own steps, in its notes.
- **Every pin is kept current** by Renovate, once the Renovate app is installed (an
  owner's step): the catalog's apps (each bump runs the full end-to-end suite and is
  merged by hand), the images outside the catalog, npm packages and the Actions' commits.

## Security

Controlling Docker is root on the host, so Mediaplane's security is the host's. The
[threat model](security/threat-model.md) lists what is protected, how, and what isn't.

## What comes next

The [roadmap](plans/m1-roadmap.md) has the order:

- automation (Slice 10b): removing what Mediaplane made when its app leaves the stack,
  a new Plex token for the arrs and Seerr, the `--json` contract, and the docs that
  complete M1.
