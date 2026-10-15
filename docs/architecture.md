# Architecture

This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
covering what is built so far (Slices 1 to 5). The design describes the whole of M1;
this page describes what exists.

## The idea

You describe the stack you want in one file, `stack.yaml`. Mediaplane then works like
`terraform plan` and `apply`:

- `plan` works out what would change, and changes nothing in your stack (in the image,
  it joins the stack's wiring network, to ask the apps: see [The wiring](#the-wiring)).
  Checking a key or a password can leave small marks in an app: a post-import category
  made in qBittorrent, a failure recorded in an app's status of a client, link or
  connection, and a sign-in in Jellyfin's activity log. It never runs an app's first-run
  setup. The [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says
  more;
- `apply` makes those changes, then plans again to check that nothing is left.

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
└─ host helper        container
     throwaway, during init,
     plan, apply, vpn-check
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
- **Running from source** (`pnpm mediaplane`, for development), `MEDIAPLANE_IMAGE` is
  unset. There is no container and no host helper: the CLI runs under Node on the host,
  and looks at the host itself. It reaches the apps on the wiring network from the host,
  which reaches every container on a Docker bridge network. That is checked on Docker
  29.8; CI checks it on Docker 28.

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
  before its port is published (see [Bootstrap before publish](#bootstrap-before-publish)).
- **history** (`packages/engine/src/history`): writes a change record for every apply
  that runs its steps, failed ones included.
- **status** (`packages/engine/src/status.ts`): each app's container state and health,
  and the last apply.
- **credentials** (`packages/engine/src/credentials.ts`): the shared admin login, and
  where each app's web UI is.
- **http** (`packages/engine/src/http`): the client for the apps' APIs (see
  [The wiring](#the-wiring)).
- **integrations** (`packages/engine/src/integrations`, and `catalog/<app>/integration.ts`):
  what Mediaplane manages in each app, and how `plan` and `apply` wire it.
- **vpn** (`packages/engine/src/vpn`): `vpn-check`. It reads the containers, runs a probe
  inside qBittorrent's network, and compares where qBittorrent's traffic and the host's
  leave from (see [`vpn-check`](#vpn-check)).
- **CLI** (`packages/cli`): the commands, human and `--json` output, and exit codes
  ([reference](reference/cli.md)).

Not built yet:

- the rest of the links between the apps: the requests app (Slice 6) and Plex (Slice 7);
- drift detection, with Keep mine (Slice 8).

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
  │ keys to generate,
  │ apps not healthy yet,
  │ first-run setups
  ▼
ask the apps
  each resource: create,
  update, adopt, unchanged,
  or after the start
```

`plan` writes nothing. Its exit code is 0 when nothing would change, 2 when something
would (or an app is still waiting for its health check), and 1 on an error. In the
image, when an app is running and left as it is, it joins Mediaplane's container to the
stack's wiring network, to ask that app; that changes no app and no file. What it finds
shows under `Wiring:`, and as `wiring` in `--json` (see [The wiring](#the-wiring)).

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
 → generate keys
 → write files, and
   pre-start files
   if absent
 → pull images
 → set appdata owners
 → step off the wiring
   network; stop a
   stranded qBittorrent
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
- **Keys are saved before any container starts.**
- **Pre-start files are written once, before the first start.** Some apps read a file
  when they start: Sonarr's, Radarr's and Prowlarr's `config.xml`, qBittorrent's
  `qBittorrent.conf` and Gluetun's `auth/config.toml`. Apply writes each one only when
  it is absent, in the files step, 0600, and never changes it after that, because the
  apps rewrite them. `plan` lists them as `before first start`, without their content.
  A file that is there but lacks Mediaplane's key is from an install made before
  Slice 3a: `plan` stops with `<app>.not-seeded`.
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

## Bootstrap before publish

Jellyfin's startup wizard answers whoever reaches it, and whoever finishes it owns the
server. So `apply` does not publish it while it is open (see
[T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup) for what voids that):

```text
plan
  │ Jellyfin: no key stored,
  │ or its system.xml says the
  │ wizard isn't done
  ▼
up --wait
  │ Jellyfin with no port
  │ published: one more
  │ Compose file, on stdin,
  │ resets its ports
  ▼
first-run setup, over the
wiring network
  │ the wizard, as the shared
  │ admin; sign in; make the
  │ key, keep it; sign out
  ▼
up --wait again
  Jellyfin published
```

- **Which apps.** An app with a `bootstrap` in its catalog entry, whose key isn't stored,
  or whose appdata doesn't say its setup is done (Jellyfin's `system.xml`). It starts
  unpublished unless its appdata says the setup is done: then only its key is to make.
  `plan` lists it under `First-run setup:` (`bootstrap` in `--json`), shows its container
  recreated when it runs published, and checks its wiring after the start. It never
  runs the setup. A file Mediaplane can't read says nothing: with the key stored, the
  key decides, and `plan` warns (`bootstrap.unreadable`) that it can't tell. An app with
  a setup can't run inside another app's network, which would publish its ports: `plan`
  fails with `bootstrap.network-via`.
- **No port at all.** The file Compose gets on its standard input, after
  `compose.override.yaml`, sets the app's `ports` to `!reset []`, so the override's ports
  go too. `compose.yaml` itself always has the ports, so the stack runs as written
  without Mediaplane, and then Jellyfin starts published with its wizard open. The
  reset covers `ports` only: an override with `network_mode: host`, or a network shared
  with a service that publishes, voids the guarantee (see
  [T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)).
- **The setup** reaches the app on the wiring network without a key, finishes its
  wizard, and keeps the key it makes in `state/secrets.json` at once. Then Mediaplane
  steps off the wiring network, `up` runs again, without the extra file, and Compose
  recreates the app with its ports. Before that, the engine asks the app once more
  whether its setup is still open, and publishes it only if it is not. If it still looks
  open, or can't be asked, the step fails and that app is not published. An app
  whose setup failed while it is still open stays unpublished; one whose setup is done
  is published even when making its key failed.
- **No new Docker call:** the proxy allows nothing new.

## The wiring

Wiring is what Mediaplane does through each app's API once the apps run. Today that is
the shared admin login in Sonarr, Radarr, Prowlarr, qBittorrent and Jellyfin; the
download path: qBittorrent's settings and categories, and Sonarr's and Radarr's download
client and root folder; the indexers: Prowlarr's links to Sonarr and Radarr, and its
indexer proxy; and the media server: Jellyfin's libraries, and Sonarr's and Radarr's
connection to it.

```text
mediaplane-system
  mediaplane
    │ wiring network:
    │ internal, no way out
    ▼
mediaplane (the stack)
  sonarr, radarr, prowlarr,
  jellyfin
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
    proxy's host, timeout and tags on every run.
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
    `plan` leaves the connection's key for `apply` to check.

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
  Prowlarr, `/System/Info/Public` for Jellyfin), checks that its key still works, then
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

## Security

Controlling Docker is root on the host, so Mediaplane's security is the host's. The
[threat model](security/threat-model.md) lists what is protected, how, and what isn't.

## What comes next

The [roadmap](plans/m1-roadmap.md) has the order:

- the rest of the wiring, app by app: the requests app (Slice 6) and Plex (Slice 7);
- drift detection (Slice 8);
- releases (Slice 9);
- the web panel (M2).
