# Mediaplane

[![CI](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml/badge.svg)](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml)
[![Licence: GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)

**Describe your self-hosted media stack in one file. Mediaplane deploys it as plain Docker
Compose and wires the apps together for you.**

> **Status: pre-alpha, not ready for use yet.**
>
> - **Works today:** `mediaplane plan` checks a real host and shows exactly what it
>   would do. `mediaplane apply` then starts the stack, confirms that every app is
>   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin
>   and Seerr (`mediaplane credentials` shows it). It sets Jellyfin up before its web UI
>   is published, with its Movies and Shows libraries, when `apply` runs the stack (the
>   [threat model](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
>   says what voids that). It links Sonarr and Radarr to
>   qBittorrent: download clients, categories and root folders, and to Jellyfin, which
>   they tell of each import. It links Prowlarr to Sonarr and Radarr, so the indexers you
>   add in Prowlarr reach both, with Byparr as Prowlarr's proxy for indexers behind
>   Cloudflare. It signs Seerr in through Jellyfin, as the same admin, before Seerr's web
>   UI is published, again when `apply` runs the stack (the same
>   [threat model](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
>   entry says what voids that), and links Seerr to Jellyfin, with both libraries, and to
>   Sonarr and Radarr, with a quality profile, ready for requests. With Plex instead,
>   `mediaplane init` (or `plex-login`) signs you in to plex.tv and saves your Plex token; `apply`
>   claims Plex for your account before its web UI is published, names it, gives it
>   its Movies and TV Shows libraries, connects Sonarr and Radarr to it, and signs Seerr
>   in with your Plex account before Seerr is published, linked to Plex (when `apply`
>   runs the stack; the same threat model entry says what voids that).
>   `mediaplane vpn-check` confirms that qBittorrent reaches the internet only through
>   the VPN. Mediaplane runs in its own hardened container, behind a Docker socket
>   proxy, and reaches the apps over a private network with no route out.
> - **Next:** drift detection: `plan` will report what was changed by hand.
> - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
>   your LAN (`network.bind: lan`) or keep them on this machine (`localhost`).
>
> Watch the repo to follow along.

## Why

A media stack such as Sonarr, Radarr, Prowlarr, a download client, a media server and a
requests app is easy to _install_. Plenty of tools generate the containers. It is tedious
to _wire up_:

- every app makes its own API key, which you copy between web UIs by hand;
- you add the download clients, root folders and indexer links yourself;
- afterwards nothing tells you when something drifts or breaks.

Mediaplane does that part for you:

1. You describe the stack you want in `stack.yaml`.
2. Mediaplane deploys it as a **plain Docker Compose project**.
3. It generates every API key and password up front.
4. It connects the apps through their own APIs.
5. Later, it tells you when something was changed by hand, without overwriting it.

## What works so far

| Capability                                                                        | Status       |
| --------------------------------------------------------------------------------- | ------------ |
| Validate `stack.yaml`, with errors that say what to change                        | Done         |
| Render a readable Compose project with images pinned by tag and digest            | Done         |
| Check the host first: Docker versions, disk, data folder, ports, the VPN device   | Done         |
| Refuse to publish web UIs on a cloud VM's private address by mistake              | Done         |
| Predict exactly which containers will change, using Compose's own config hashes   | Done         |
| Generate keys and start the stack (`mediaplane apply`)                            | Done         |
| See each app's health and every past apply (`status`, `history`)                  | Done         |
| Write a starter `stack.yaml` (`init`)                                             | Done         |
| One admin login for qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr     | Done         |
| Reach the apps' APIs over a private network with no route out                     | Done         |
| A VPN kill switch, tested against a real WireGuard server, and `vpn-check`        | Done         |
| Run in a hardened container, behind a Docker socket proxy                         | Done         |
| Documentation generated from code: the `stack.yaml` and CLI references, app facts | Done         |
| Link Sonarr and Radarr to qBittorrent: download clients, categories, root folders | Done         |
| Link Prowlarr to Sonarr and Radarr, with Byparr or FlareSolverr as its proxy      | Done         |
| Set up Jellyfin before it is published, with its libraries and links              | Done         |
| Sign Seerr in through Jellyfin before it is published, and link it                | Done         |
| Sign in to Plex (`plex-login`), and claim Plex before it is published             | Done         |
| Plex's libraries and links, and Seerr signed in with your Plex account            | Done         |
| Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
| Web panel with a setup wizard                                                     | Planned (M2) |

## The stack

| Role         | App                                                 |
| ------------ | --------------------------------------------------- |
| Media server | Jellyfin **or** Plex                                |
| TV and films | Sonarr, Radarr                                      |
| Indexers     | Prowlarr, with Byparr (or FlareSolverr)             |
| Downloads    | qBittorrent, behind a Gluetun VPN that fails closed |
| Requests     | Seerr                                               |

Every app can be switched off in `stack.yaml`. Later milestones add SABnzbd,
Audiobookshelf, Bazarr, Recyclarr, Portainer and Homepage.

Mediaplane runs on an existing Linux host, amd64 or arm64.

## What a stack looks like

```yaml
version: 1
paths: { data: /srv/data }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
```

Secrets never go in `stack.yaml`: it only points to them, with `{ file: … }` or
`{ env: … }`. The generated `compose.yaml` never contains them either.

## How it works

Mediaplane works like `terraform plan` and `apply`. `plan` validates `stack.yaml`, checks
the host, renders the Compose project and diffs it against what is running. It shows you
the changes and touches nothing in your stack, apart from small marks that checking a key
or a password can leave in an app: a category in qBittorrent, a failure in an app's own
status of a client, link or connection, a sign-in in Jellyfin's activity log, a line in
Seerr's log (and an arr's) for a check of Seerr's that fails, and an arr listed among
Plex's devices by its first test of its connection to Plex. The
[threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
`apply` does the same, then makes those changes.

```text
stack.yaml + secrets/
  │
  ▼
mediaplane plan
  │  checks the host: Docker, disk,
  │  ports, the data folder
  │  compares with what is running,
  │  and asks the apps
  │  changes nothing in the stack,
  │  but for the small marks above
  ▼
mediaplane apply
  ├─ generates keys and the admin
  │  password (kept for good)
  ├─ writes compose.yaml, .env, and
  │  files apps read at first start
  ├─ pulls images, starts the apps
  │  (Jellyfin or Plex, and Seerr,
  │  with no port, until they are
  │  set up)
  ├─ waits until every app is healthy
  ├─ sets Jellyfin up, or has Plex
  │  claimed for you; signs Seerr
  │  in; then publishes them
  ├─ wires the apps through their
  │  APIs: the shared login, the
  │  download path, indexers, the
  │  media server and requests
  ├─ plans again: nothing left to do
  └─ records the change in history
```

A few principles hold throughout:

- **No forks.** Mediaplane runs the apps' own upstream images. Everything is configured
  through their environment variables, config files and APIs.
- **No lock-in.** The output is an ordinary Compose project. You can read it, manage it
  from other tools, or keep it running without Mediaplane. The generated file's header
  gives the exact `docker compose` command for that.
- **You stay in control.** Container-level changes go in your own
  `compose.override.yaml`, which Mediaplane never writes. Mediaplane will only manage
  what it created, and it reports manual changes instead of reverting them.
- **Safe by default.** On a cloud VM, a private address is often reachable from the
  internet. Mediaplane notices, and refuses to publish web UIs there unless you say so
  explicitly. qBittorrent has no network of its own outside the VPN. Mediaplane controls
  Docker, which means root on the host; [SECURITY.md](SECURITY.md) explains the
  boundaries.
- **Built for automation.** `plan` has meaningful exit codes and versioned `--json`
  output, so scripts and configuration-management tools can drive it.

## What it looks like

Most of this is real output from a run on an arm64 VM, trimmed where marked. The wiring
lines, the first-run setup's and the last apply's came later, from a run of the same
stack with Slice 6. The stack is
the example above without the VPN, which is why `plan` warns about qBittorrent, and with
`network.bind: localhost`.

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

## Run it in a container

Mediaplane runs as its own container next to a Docker socket proxy, in a Compose
project of its own. No image is published yet (that comes in Slice 9), so install it from
a checkout, as your normal user:

```bash
git clone https://github.com/cyclopsgd/Mediaplane.git
cd Mediaplane
./deploy/install.sh
```

The installer checks Docker, builds the image, starts Mediaplane and installs the
`mediaplane` command, then offers to run `mediaplane init`. That asks a few questions,
including your own admin password if you'd rather type one, and with Plex signs you in.
[`deploy/README.md`](deploy/README.md) has the details, and the same steps by hand.

## Try it (from source)

`mediaplane plan` already checks a real host and shows exactly what `apply` would do:

- the Compose file it would write;
- the containers it would create, recreate, start, restart or remove (`restart` is for
  qBittorrent when Gluetun starts again on its own);
- the secrets it would generate;
- the first-run setups it would finish, under `First-run setup:`: Jellyfin's, and
  Seerr's first sign-in through it, or with Plex, Plex's claim, and Seerr's first
  sign-in with your Plex token, each with no port published until it is done, when
  `apply` runs the stack
  ([what voids that](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup));
- the wiring it would do in the apps, under `Wiring:`, such as setting the admin login or
  adding a download client. qBittorrent's login and settings show as `adopt` on a first
  `apply`: its file from before its first start set them already, as Jellyfin's
  first-run setup sets its admin.

It changes nothing in your stack, apart from small marks that checking a key or a
password can leave in an app: a category in qBittorrent, a failure in an app's own
status of a client, link or connection, a sign-in in Jellyfin's activity log, a line in
Seerr's log (and an arr's) for a check of Seerr's that fails, and an arr listed among
Plex's devices by its first test of its connection to Plex. The
[threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
You need Docker (Engine 24 or newer, with the Compose plugin 2.24 or newer), Node 24 and
pnpm.

```bash
corepack enable && pnpm install
mkdir -p .mediaplane-dev/data .mediaplane-dev/secrets
printf 'fake-wireguard-key\n' > .mediaplane-dev/secrets/wg.key
cat > .mediaplane-dev/stack.yaml <<EOF
version: 1
user: { uid: $(id -u), gid: $(id -g) }
paths: { data: $PWD/.mediaplane-dev/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
EOF
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane plan --home .mediaplane-dev
```

The `user:` line makes the apps run as you, so they can write to the data folder you
just created. `MEDIAPLANE_COMPOSE_PROJECT` gives this trial its own Compose project,
`mediaplane-dev`, so a real `mediaplane` stack on the same host is never touched.
`plan` exits with `0` when nothing would change, `2` when it would change something
(including when an app is still waiting for its health check), and `1` on errors. Add
`--json` for machine-readable output: its `wiring` lists each resource with its `action`
(`create`, `update`, `adopt`, `unchanged`, `after-start` or `unknown`), the `changes` that
differ, and a `reason` when it is `unknown`.

To actually start the stack, use a stack without the VPN. A fake WireGuard key can't
connect, so Gluetun would never become healthy. Change the qBittorrent line to
`qbittorrent: { vpn: false }`, delete the `vpn:` line, then run:

```bash
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane apply --home .mediaplane-dev --yes
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane status --home .mediaplane-dev
pnpm --silent mediaplane credentials --home .mediaplane-dev
```

This starts real containers on this machine, with the web UIs on `localhost`. The last
command shows the admin login, which qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin
use, and Seerr through Jellyfin, and each app's address.
The first `apply` downloads several GB of images, so it can take a while. To remove the
containers, run `docker compose -p mediaplane-dev down`, then
`sudo rm -rf .mediaplane-dev`. Seerr's folder belongs to uid 1000, which is why `sudo`
is needed.

To try Plex instead, set `media_server: plex` and add
`plex: { token: { file: secrets/plex-token } }`, then sign in to plex.tv once, before
the first `apply`:

```bash
pnpm --silent mediaplane plex-login --home .mediaplane-dev
```

It prints a link: open it in a browser and sign in to Plex. It then saves your Plex token
in `secrets/plex-token`, readable by you only, and never prints it. A saved token that
plex.tv still takes is kept, unless you add `--force`. One plex.tv refuses (HTTP 401) is
replaced. When plex.tv can't say whether it works (no answer, a 403, a 429, or an error of
its own), it keeps the saved token, says so, and `--force` signs in anyway. A token file
or `secrets/` folder it can't read stops it before it asks for a link. "Couldn't reach
plex.tv" means plex.tv didn't answer at all. `apply` then claims Plex for that account
before its web UI is published.

## Questions

### Why not just generate the keys in a pipeline (CI, Ansible, a script)?

You can, and that is the easy part. Any template can put a random API key in an
environment variable. What a one-shot pipeline doesn't do well is everything after that:

- **The wiring happens against running apps.** Sonarr learns about qBittorrent,
  Prowlarr pushes indexers to Sonarr and Radarr, and Seerr connects to Jellyfin through
  API calls. Those calls work only once the apps are up and healthy, they have to run in
  the right order, and they need retries while the apps start. Some credentials can't
  be chosen in advance at all. Jellyfin creates its own API key after its setup, and a
  Plex claim token expires after four minutes.
- **Re-runs have to be safe.** Run the pipeline again and it must not rotate the keys,
  because that breaks every connection, and it must not redo work. Mediaplane keeps the
  keys it generated and plans before it changes anything, so a second `apply` changes
  nothing.
- **Things change after deploy.** Someone edits a setting in a web UI, and a pipeline
  never knows. Mediaplane will compare what it set with what is there now, and tell you
  without overwriting your change.
- **The host gets checked first.** Mediaplane checks ports, free disk, the data folder,
  the VPN device, and whether this is a cloud VM. It refuses before touching anything.

So Mediaplane isn't instead of a pipeline. It is built to run inside one:

- your pipeline can template `stack.yaml`;
- secrets can come from files or environment variables;
- `plan` and `apply` run unattended, with exit codes and `--json` output.

The pipeline decides what the stack is, and Mediaplane does the stateful part. Today
that covers generating the keys, deploying, setting Jellyfin up and taking the key it
makes, or claiming Plex for your account, signing Seerr in, setting the shared login in
the apps, linking Sonarr and Radarr to qBittorrent and the media server, Prowlarr to
them, and Seerr to all three, and checking. Change detection is what is being built
next.

### Why not just write the Compose file myself?

You can, and Mediaplane's output is exactly that: a plain Compose project you can read
and keep. What it adds is everything around the file:

- images pinned by tag and digest;
- one user and one data folder, so downloads can be hardlinked into the library instead
  of copied;
- health checks that actually pass;
- qBittorrent routed through the VPN, so it has no network when the VPN is down, with
  an automated test of that and `mediaplane vpn-check` to confirm it on your host;
- keys that are generated once and kept;
- Sonarr and Radarr linked to qBittorrent, with its categories and their root folders;
- Prowlarr linked to Sonarr and Radarr, with a Cloudflare solver as its indexer proxy;
- Jellyfin set up by `apply` before its web UI is published on your network, with its
  libraries, and told of each import by Sonarr and Radarr;
- Seerr signed in through Jellyfin by `apply` before its web UI is published, and
  linked to Jellyfin, Sonarr and Radarr (both guarantees hold when `apply` runs the
  stack:
  [what voids them](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup));
- or Plex, claimed for your plex.tv account by `apply` before its web UI is published,
  with its libraries and the same links, and Seerr signed in with your Plex account
  (when `apply` runs the stack; the same threat model entry says what voids that).

### How is this different from Buildarr or Recyclarr?

Those tools configure apps you already run, and they are good at detailed tuning, such
as quality profiles. Mediaplane deploys the whole stack and makes it safe: generated
secrets, a socket proxy, a tested VPN kill switch, and a private wiring network. It wires
the apps to each other, with `plan` and `apply` and a history of what it did, and leaves
the rest of each app's settings to you. Today it sets the shared login, sets Jellyfin
(or Plex) and Seerr up, links Sonarr and Radarr to qBittorrent and the media server,
Prowlarr to them, and Seerr to all three.

They can be used together. Recyclarr is planned for M4.

### Can it take over my existing setup?

Not yet. Today it manages a stack it created itself. Adopting an existing install, and
finding the apps and keys you already have, is on the list.

### Is it safe to run?

It is pre-alpha, so treat it as something to try rather than to rely on.

Mediaplane controls Docker, and that is root-equivalent on the host. It keeps its
secrets private:

- they live in `state/secrets.json` and `generated/.env`, both mode 0600, and in the
  apps' own settings files;
- they never appear in `stack.yaml` or in `compose.yaml`;
- the only output that shows one is `mediaplane credentials`, which shows the admin
  login.

On a cloud VM it refuses to publish the web UIs on the private address unless you say
so. In its container, Mediaplane never touches the Docker socket. It goes through a
proxy that allows only the Docker calls it makes, which is defence in depth rather
than a boundary. Its container has no route out: it reaches the apps over a private
network. The [threat model](docs/security/threat-model.md) explains what that does and
doesn't protect, and [SECURITY.md](SECURITY.md) covers what is in scope.

### Do I have to keep using it?

No. The header of `generated/compose.yaml` gives the exact `docker compose` command that
runs the stack without Mediaplane.

### How is it built?

Mostly by AI coding agents (Claude Code), working under a maintainer who sets the
direction and makes the product decisions. Most of the process is checking: each slice
is built once against the real apps before its plan is final, every task is reviewed,
and the whole branch is reviewed again before it merges.
[How Mediaplane is built](docs/how-its-built.md) explains each stage and what it catches.

## Roadmap

| Milestone              | Delivers                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| **M1: engine and CLI** | `plan` and `apply`, key generation, wiring for the core stack, drift detection, change history |
| **M2: panel**          | A web wizard (including "Sign in with Plex"), dashboard and drift view                         |
| **M3: operations**     | Safe updates with rollback, scheduled backups and restore, alerts                              |
| **M4: more apps**      | SABnzbd, Audiobookshelf, Bazarr, Recyclarr, Portainer, Homepage                                |

M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it stands:

- **Merged:** S1 (the pure core), S2a (`plan` against a real host), S2b (`apply`), S2c
  (packaging), S3a (the shared admin and pre-start files), S3d (the VPN's kill-switch
  test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
  (indexers), S5 (Jellyfin), S6 (requests) and S7 (Plex).
- **Next:** S8 (drift detection).
- **After that:** S9: the release.

## Documentation

- **[Running in a container](deploy/README.md):** install, update, and run without the
  socket proxy.
- **[Architecture](docs/architecture.md):** how the pieces fit, as built so far.
- **[`stack.yaml` reference](docs/reference/stack-yaml.md):** every field, generated from
  the schema, with its [JSON Schema](docs/reference/stack.schema.json).
- **[CLI reference](docs/reference/cli.md):** every command, option and exit code,
  generated from the CLI.
- **The apps:** one README each, with what Mediaplane sets, how to change it, and known
  issues. See [Sonarr](catalog/sonarr/README.md), [Radarr](catalog/radarr/README.md),
  [Prowlarr](catalog/prowlarr/README.md), [qBittorrent](catalog/qbittorrent/README.md),
  [Gluetun](catalog/gluetun/README.md), [Jellyfin](catalog/jellyfin/README.md),
  [Plex](catalog/plex/README.md), [Seerr](catalog/seerr/README.md),
  [Byparr](catalog/byparr/README.md) and [FlareSolverr](catalog/flaresolverr/README.md).
- **[Runbook: an app won't start](docs/runbooks/app-wont-start.md):** symptoms, checks,
  fix and prevention.
- **[Runbook: the VPN is down](docs/runbooks/vpn-down.md):** what `vpn-check` found, and
  what to do about a VPN that is down or a leak.
- **[Runbook: wiring failed](docs/runbooks/wiring-failed.md):** an app refused Mediaplane's
  key or a change, Jellyfin's or Seerr's first-run setup failed or waits, an arr can't
  reach qBittorrent or Jellyfin, Seerr can't reach an arr, Prowlarr can't make its proxy,
  or Mediaplane can't reach an app.
- **[Threat model](docs/security/threat-model.md):** what is protected, how, and what
  isn't.
- **[Architecture decision records](docs/adr/):** why things are the way they are.
- **[How it's built](docs/how-its-built.md):** how each slice is planned, built,
  reviewed and tested.
- **[M1 design](docs/design/m1-engine-cli.md) and [roadmap](docs/plans/m1-roadmap.md):**
  the plan for all of M1, and where it stands.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
[SECURITY.md](SECURITY.md).

## Licence

[GPL-3.0](LICENSE)
