# Mediaplane

[![CI](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml/badge.svg)](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml)
[![Licence: GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)

**Describe your self-hosted media stack in one file. Mediaplane deploys it as plain Docker
Compose and wires the apps together for you.**

> **Status: pre-alpha, not ready for use yet.**
>
> - **Works today:** `mediaplane plan` checks a real host and shows exactly what it would
>   deploy.
> - **Being built now:** `apply`, which actually starts the stack.
> - **Next:** wiring the apps together.
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

| Capability                                                                      | Status          |
| ------------------------------------------------------------------------------- | --------------- |
| Validate `stack.yaml`, with errors that say what to change                      | Done            |
| Render a readable Compose project with images pinned by tag and digest          | Done            |
| Check the host first: Docker versions, disk, data folder, ports, the VPN device | Done            |
| Refuse to publish web UIs on a cloud VM's private address by mistake            | Done            |
| Predict exactly which containers will change, using Compose's own config hashes | Done            |
| Generate keys and start the stack (`mediaplane apply`)                          | **In progress** |
| Wire the apps together (download clients, indexers, root folders, media server) | Planned         |
| Detect manual changes and offer Re-apply or "Keep mine"                         | Planned         |
| Web panel with a setup wizard                                                   | Planned (M2)    |

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
pnpm --silent mediaplane plan --home .mediaplane-dev
```

The `user:` line makes the apps run as you, so they can write to the data folder you
just created. `plan` exits with `0` when nothing would change, `2` when it would change
something, and `1` on errors. Add `--json` for machine-readable output.

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
