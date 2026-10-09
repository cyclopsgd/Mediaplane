# Mediaplane

[![CI](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml/badge.svg)](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml)
[![Licence: GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)

**Describe your self-hosted media stack in one file. Mediaplane deploys it as plain Docker
Compose and wires the apps together for you.**

> **Status: pre-alpha, not ready for use yet.**
>
> - **Works today:** `mediaplane plan` checks a real host and shows exactly what it
>   would do. `mediaplane apply` then starts the stack and confirms that every app
>   is healthy. Mediaplane runs in its own hardened container, behind a Docker socket
>   proxy.
> - **Next:** wiring the apps together. Until that lands, each app still needs
>   setting up by hand, and the apps' first-run setup pages are open to anyone who
>   can reach them: Jellyfin's wizard, Seerr's setup, and Sonarr, Radarr and
>   Prowlarr until their login is configured. Keep `network.bind: localhost` when
>   you try it.
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

| Capability                                                                      | Status       |
| ------------------------------------------------------------------------------- | ------------ |
| Validate `stack.yaml`, with errors that say what to change                      | Done         |
| Render a readable Compose project with images pinned by tag and digest          | Done         |
| Check the host first: Docker versions, disk, data folder, ports, the VPN device | Done         |
| Refuse to publish web UIs on a cloud VM's private address by mistake            | Done         |
| Predict exactly which containers will change, using Compose's own config hashes | Done         |
| Generate keys and start the stack (`mediaplane apply`)                          | Done         |
| See each app's health and every past apply (`status`, `history`)                | Done         |
| Write a starter `stack.yaml` (`init`)                                           | Done         |
| Run in a hardened container, behind a Docker socket proxy                       | Done         |
| Wire the apps together (download clients, indexers, root folders, media server) | Planned      |
| Detect manual changes and offer Re-apply or "Keep mine"                         | Planned      |
| Web panel with a setup wizard                                                   | Planned (M2) |

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
the changes and touches nothing. `apply` does the same, then makes those changes.

```text
stack.yaml + secrets/
  │
  ▼
mediaplane plan
  │  checks the host: Docker, disk,
  │  ports, the data folder
  │  compares with what is running
  │  changes nothing
  ▼
mediaplane apply
  ├─ generates keys (kept for good)
  ├─ writes compose.yaml and .env
  ├─ pulls images, starts the apps
  ├─ waits until every app is healthy
  ├─ plans again: nothing left to do
  └─ records the change in history
```

Next, `apply` will also wire the apps together through their own APIs.

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

This is real output from a run on an arm64 VM, trimmed where marked. The stack is the
example above without the VPN, which is why `plan` warns about qBittorrent.

```console
$ mediaplane plan
warning: qBittorrent is running without a VPN (apps.qbittorrent.vpn: false)
  hint: peers will see your real IP address; add a vpn: block and remove vpn: false
+ generated/compose.yaml
  … the whole Compose file, as a diff …
+ generated/.env (secret values, not shown)

Containers:
  + create    byparr
  + create    jellyfin
  + create    prowlarr
  + create    qbittorrent
  + create    radarr
  + create    seerr
  + create    sonarr
Secrets to generate: prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey, seerr.apiKey, sonarr.apiKey
Plan: 2 files to write, 7 containers to change, 5 secrets to generate.

$ mediaplane apply --yes
  … the same plan …
  done    secrets: generated prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey, seerr.apiKey, sonarr.apiKey
  done    files: wrote generated/compose.yaml and generated/.env
Pulling images (the first time can take several minutes)…
  done    images: images present
  done    appdata ownership: seerr → 1000:1000
Starting containers and waiting until every app is healthy…
  done    containers: every app is running and healthy
  done    verify: no changes remain

Apply complete. Change record: 20261009T125331Z-16a818bc

$ mediaplane apply --yes
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
Last apply: 2026-10-09T12:53:31.563Z, success (20261009T125331Z-16a818bc)
```

## Run it in a container

Mediaplane runs as its own container next to a Docker socket proxy, in a Compose
project of its own. No image is published yet (that comes in Slice 8), so build one from
a checkout:

```bash
docker build --tag mediaplane:local .
```

Then follow [`deploy/README.md`](deploy/README.md) to start it and run
`mediaplane plan` inside it.

## Try it (from source)

`mediaplane plan` already checks a real host and shows exactly what `apply` would do:

- the Compose file it would write;
- the containers it would create, recreate, start or remove;
- the secrets it would generate.

It changes nothing. You need Docker (Engine 24 or newer, with the Compose plugin 2.24 or
newer), Node 24 and pnpm.

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
`--json` for machine-readable output.

To actually start the stack, use a stack without the VPN. A fake WireGuard key can't
connect, so Gluetun would never become healthy. Change the qBittorrent line to
`qbittorrent: { vpn: false }`, delete the `vpn:` line, then run:

```bash
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane apply --home .mediaplane-dev --yes
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane status --home .mediaplane-dev
```

This starts real containers on this machine, with the web UIs on `localhost`. The first
`apply` downloads several GB of images, so it can take a while. To remove the
containers, run `docker compose -p mediaplane-dev down`, then
`sudo rm -rf .mediaplane-dev`. Seerr's folder belongs to uid 1000, which is why `sudo`
is needed.

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
that covers generating the keys, deploying and checking. The app-to-app wiring and
change detection are what is being built next.

### Why not just write the Compose file myself?

You can, and Mediaplane's output is exactly that: a plain Compose project you can read
and keep. What it adds is everything around the file:

- images pinned by tag and digest;
- one user and one data folder, so downloads can be hardlinked into the library instead
  of copied;
- health checks that actually pass;
- qBittorrent routed through the VPN, so it has no network when the VPN is down;
- keys that are generated once and kept;
- next, the wiring between the apps.

### Can it take over my existing setup?

Not yet. Today it manages a stack it created itself. Adopting an existing install, and
finding the apps and keys you already have, is on the list.

### Is it safe to run?

It is pre-alpha, so treat it as something to try rather than to rely on.

Mediaplane controls Docker, and that is root-equivalent on the host. It keeps its
secrets private:

- they live in `state/secrets.json` and `generated/.env`, both mode 0600;
- they never appear in `stack.yaml`, in `compose.yaml` or in any output.

On a cloud VM it refuses to publish the web UIs on the private address unless you say
so. In its container, Mediaplane never touches the Docker socket. It goes through a
proxy that allows only the Docker calls it makes, which is defence in depth rather
than a boundary. The [threat model](docs/security/threat-model.md) explains what that
does and doesn't protect, and [SECURITY.md](SECURITY.md) covers what is in scope.

### Do I have to keep using it?

No. The header of `generated/compose.yaml` gives the exact `docker compose` command that
runs the stack without Mediaplane.

## Roadmap

| Milestone              | Delivers                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| **M1: engine and CLI** | `plan` and `apply`, key generation, wiring for the core stack, drift detection, change history |
| **M2: panel**          | A web wizard (including "Sign in with Plex"), dashboard and drift view                         |
| **M3: operations**     | Safe updates with rollback, scheduled backups and restore, alerts                              |
| **M4: more apps**      | SABnzbd, Audiobookshelf, Bazarr, Recyclarr, Portainer, Homepage                                |

M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it stands.

## Design

- [M1 design: engine and CLI](docs/design/m1-engine-cli.md)
- [Architecture decision records](docs/adr/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
[SECURITY.md](SECURITY.md).

## Licence

[GPL-3.0](LICENSE)
