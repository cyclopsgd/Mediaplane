# Mediaplane

[![CI](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml/badge.svg)](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cyclopsgd/Mediaplane?sort=semver)](https://github.com/cyclopsgd/Mediaplane/releases)
[![Licence: GPL-3.0-or-later](https://img.shields.io/badge/licence-GPL--3.0--or--later-blue)](LICENSE)

**Describe your self-hosted media stack in one file. Mediaplane deploys it as plain Docker
Compose and wires the apps together for you.**

> **Status:** 0.1.0 is the first release. Mediaplane is pre-1.0, so expect changes before
> 1.0. Everything under [What it does](#what-it-does) is built and tested, most of it end
> to end against the real apps, on amd64 and arm64.

## Why

Installing a media stack is easy: plenty of tools generate the containers for Sonarr,
Radarr, Prowlarr, a download client, a media server and a requests app. Wiring it up is
the tedious part. Every app makes its own API key, which you copy between web UIs by hand.
You add the download clients, root folders and indexer links yourself. Afterwards, nothing
tells you when something drifts or breaks.

Mediaplane does the wiring for you, and later tells you what was changed by hand.

## What it does

- **One file.** You describe your stack in [`stack.yaml`](docs/reference/stack-yaml.md),
  and `mediaplane init` writes a starter one from a few questions. A mistake in it gets
  an error that names the field.
- **Plan, then apply.** Like `terraform plan`, `plan` checks the host and shows exactly
  what would change, down to each container. `apply` makes it so.
- **No keys to copy.** Mediaplane creates every app's API key, and keeps it. One admin
  login opens qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr. With Plex, your
  own plex.tv account opens Plex and Seerr.
- **The apps wired together.** Sonarr and Radarr get qBittorrent as their download
  client, their root folders, and a link to your media server. Prowlarr is linked to both,
  so your indexers reach them. Seerr gets the media server, Sonarr and Radarr.
- **The media server, set up before it's published.** Mediaplane finishes Jellyfin's
  setup wizard, or claims Plex for your plex.tv account, before it publishes the web UI,
  then adds the libraries. Seerr is signed in the same way
  ([what can undo that](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)).
- **A VPN that fails closed.** qBittorrent has no network when the VPN is down. A test
  checks it with a real WireGuard server, and `mediaplane vpn-check` checks your host.
- **Drift reported, never reverted on its own.** `mediaplane drift` shows what was
  changed by hand. `apply` puts it back, or `mediaplane keep` keeps your change.
- **History.** `status` shows each app's health and the last apply. `history` lists every
  apply that had work to do, and what it did.
- **Rebuilding a host** from `stack.yaml`, your secrets and the apps' data: Mediaplane
  recovers the keys, and finds what it made in each app by name.
- **Taking an app out.** Remove it from `stack.yaml`, and `apply` removes its container
  and what Mediaplane made for it in the other apps. Its data stays.
- **Rotation.** `--rotate` sets a new admin password or Plex token in every app using it.
- **Hardware transcoding** for Jellyfin or Plex (`hardware_transcoding`).
- **Built for automation.** Commands ask nothing when a script runs them, their exit codes
  mean something, and `--json` prints versioned documents with published JSON Schemas
  ([Deploying with automation](docs/automation.md)).

## The stack

- **Media server:** [Jellyfin](catalog/jellyfin/README.md) or [Plex](catalog/plex/README.md).
- **TV and films:** [Sonarr](catalog/sonarr/README.md) and [Radarr](catalog/radarr/README.md).
- **Indexers:** [Prowlarr](catalog/prowlarr/README.md), with
  [Byparr](catalog/byparr/README.md) or [FlareSolverr](catalog/flaresolverr/README.md).
- **Downloads:** [qBittorrent](catalog/qbittorrent/README.md), behind a
  [Gluetun](catalog/gluetun/README.md) VPN.
- **Requests:** [Seerr](catalog/seerr/README.md).

Each app's README says what Mediaplane sets in it, and how to change that.

**Where it runs:** a Linux host you already have, amd64 or arm64, with Docker Engine 24 or
newer and its Compose plugin 2.24 or newer. Rootless Docker and SELinux in enforcing mode
aren't supported yet ([What you need](deploy/README.md#what-you-need)).

## What a stack looks like

```yaml
version: 1
paths: { data: /srv/data }
media_server: jellyfin
vpn:
  provider: mullvad
  private_key: { file: secrets/wg.key }
  addresses: 10.64.0.2/32
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
```

Secrets never go in `stack.yaml`, which only points to them with `{ file: … }` or
`{ env: … }`, and never in the `compose.yaml` that Mediaplane generates.

## Install

As your normal user, not root, download a release, check it, and run its installer. The
[releases page](https://github.com/cyclopsgd/Mediaplane/releases) lists every `version`:

```bash
version=0.1.0
base=https://github.com/cyclopsgd/Mediaplane/releases/download/v$version
curl -fLO "$base/mediaplane-deploy-$version.tar.gz"
curl -fLO "$base/SHA256SUMS"
sha256sum --check SHA256SUMS
tar -xzf "mediaplane-deploy-$version.tar.gz"
./mediaplane/deploy/install.sh
```

The installer checks Docker, pulls the release's image by its digest, starts Mediaplane
and installs the `mediaplane` command. Keep the `mediaplane` folder for updates. It then
offers to run `init`, which with Plex can also sign you in to plex.tv:

```bash
mediaplane init         # asks a few questions, writes stack.yaml
mediaplane plan         # checks the host, shows what apply would do
mediaplane apply        # asks first, then deploys and wires the stack
mediaplane credentials  # the admin login, and each app's address
```

[`deploy/README.md`](deploy/README.md) has the details: the same steps by hand,
[updating](deploy/README.md#updating) without stopping your apps, and installing
[from a checkout](deploy/README.md#from-a-checkout) to try `main`.

## How it works

```text
stack.yaml + secrets/
  │
  ▼
mediaplane plan
  │  checks the host and the apps,
  │  shows what apply would change
  ▼
mediaplane apply
  ├─ generates the keys, once
  ├─ writes compose.yaml and .env
  ├─ starts the apps, and sets up
  │  the media server and Seerr
  │  before publishing them
  ├─ wires the apps by their APIs
  ├─ plans again: nothing is left
  └─ records the change in history
```

`plan` changes nothing in your stack, though checking a key can leave a small mark in an
app, such as a sign-in in Jellyfin's activity log
([the full list](docs/security/threat-model.md#what-runs-and-who-can-reach-it)).

A few principles hold throughout:

- **No forks.** Mediaplane runs the apps' own upstream images, and configures them only
  through their environment, files and APIs.
- **No lock-in.** The output is a plain Compose project, every image pinned by digest.
  You can read it, manage it with other tools, or run it without Mediaplane.
- **You stay in control.** Your own container changes go in `compose.override.yaml`,
  which Mediaplane never writes. In the apps, it manages only what it created.
- **Safe by default.** On a cloud VM, where a private address is often reachable from the
  internet, Mediaplane won't publish the web UIs on it unless you say so. The apps ask
  for a login from your own network too, unless you turn that off.

## What it looks like

Trimmed from a real run of the example stack, without the VPN and on `localhost`.
[An example run](docs/example-run.md) has every line.

```console
$ mediaplane plan
  … a warning that this stack has no VPN, then the files, containers, secrets, setups and wiring …
Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 2 apps to set up, 23 wiring checks after the start.

$ mediaplane apply --yes
  … the same plan, and a progress line before each slow step …
  done    secrets: generated admin.password, prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey, seerr.apiKey, sonarr.apiKey
  done    files: wrote generated/compose.yaml and generated/.env; created …
  done    images: images present
  done    appdata ownership: seerr → 1000:1000
  done    containers: every app is running and healthy; started jellyfin, seerr without their ports, to set them up first
  done    first-run setup: set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr
  done    wiring jellyfin.admin: adopted
  … 22 more …
  done    wiring: jellyfin.admin adopted; jellyfin.library_movies created; … seerr.setup updated initialized
  done    verify: no changes remain

Apply complete. Change record: 20261016T030144Z-2bc6267e

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

## Questions

### How does it compare with other tools?

When Mediaplane was designed, in October 2026, these were the nearest:

- **YAMS, Saltbox, DockSTARTer, Runtipi and CasaOS** make installing the apps quick, and
  leave the wiring to you.
- **arrstack (LavX)** wires the whole stack from a one-time terminal wizard, without Plex.
- **SparkBox** has a wizard, wiring and a web panel. It is closed source, installs on the
  host itself, and is Jellyfin only and x86 first.
- **Umbrel** is a home-server OS that wires some apps, under a non-commercial licence.

Mediaplane brings these together: open source, one container on a host you already have,
Plex and Jellyfin as equal choices, arm64 as well supported as amd64, and drift detection.

### Why not just generate the keys in a pipeline?

You can, and that is the easy part. The wiring needs running apps, in the right order,
with retries while they start. Some keys can't be chosen in advance: Jellyfin's is made
only after its setup. A second `apply` changes nothing, and when someone later changes a
setting by hand, `drift` tells you. So Mediaplane runs inside your pipeline, not instead
of it. [Deploying with automation](docs/automation.md) has the contract a pipeline can
rely on, and a short Ansible example.

### Why not write the Compose file myself?

You can, and Mediaplane's output is exactly that: a plain Compose project. What it adds is
everything around the file: pinned images, health checks that pass, one data folder so
downloads are hardlinked rather than copied, and the keys, the setup and the wiring done
for you.

### How is it different from Buildarr or Recyclarr?

Buildarr, Flemmarr and Recyclarr configure apps you already run, as code, and they are
good at detailed tuning, such as quality profiles. Buildarr and Flemmarr were no longer
maintained in October 2026. Mediaplane deploys the stack and wires the apps, and leaves
the rest of each app's settings to you, or to a tool such as Recyclarr (planned for M3).

### Can it take over my existing setup?

Not yet: Mediaplane manages a stack it created itself. Using a media server you already
run is planned for M2, and adopting a whole existing install is an idea for later.

### Is it safe to run?

Mediaplane controls Docker, which is root-equivalent on the host, so it narrows that power
where it can. Its secrets are in files only you can read, and `mediaplane credentials` is
the only command that shows one: the admin login. It runs in its own container, with no
route out, and reaches Docker only through a socket proxy that allows the calls it makes:
defence in depth, not a boundary. The [threat model](docs/security/threat-model.md) says
what that does and doesn't protect, and [SECURITY.md](SECURITY.md) what is in scope.

### Do I have to keep using it?

No. The header of `generated/compose.yaml` gives the `docker compose` command that runs
your stack without Mediaplane ([the steps](deploy/README.md#removing-mediaplane)).

### How is it built?

Mostly by AI coding agents (Claude Code), working under a maintainer who sets the
direction and makes the product decisions. Most of the work is checking: each feature is
built once against the real apps before its plan is final, and every change is reviewed
before it merges. [How Mediaplane is built](docs/how-its-built.md) explains each stage.

## Roadmap

- **M1, the engine and CLI:** done, and released as 0.1.0.
- **M2, the everyday CLI:** safe app updates with rollback, backup and restore, `doctor`,
  quality presets, using a media server you already run, and optional alerts.
- **M3, more apps:** SABnzbd, Audiobookshelf, Bookshelf (experimental), Bazarr,
  Recyclarr, Portainer and Homepage.

A web panel isn't scheduled: the CLI comes first. The
[M1 roadmap](docs/plans/m1-roadmap.md) says what M1 delivered, and what moved to M2.

## Documentation

- **Using it:** [running Mediaplane](deploy/README.md) (install, update, move, remove,
  troubleshoot), [deploying with automation](docs/automation.md),
  [trying it from source](docs/try-from-source.md), [an example run](docs/example-run.md).
- **Reference,** generated from the code: [`stack.yaml`](docs/reference/stack-yaml.md)
  and its [JSON Schema](docs/reference/stack.schema.json), the
  [CLI](docs/reference/cli.md), and [`--json`](docs/reference/json.md).
- **Runbooks:** [an app won't start](docs/runbooks/app-wont-start.md),
  [VPN down](docs/runbooks/vpn-down.md), [wiring failed](docs/runbooks/wiring-failed.md),
  [drift reported](docs/runbooks/drift-reported.md) and
  [rebuilding a host](docs/runbooks/rebuilding-a-host.md).
- **Design and security:** [architecture](docs/architecture.md), the
  [threat model](docs/security/threat-model.md), the [decision records](docs/adr/),
  [releasing](docs/releasing.md), [how it's built](docs/how-its-built.md), and M1's
  [design](docs/design/m1-engine-cli.md) and [roadmap](docs/plans/m1-roadmap.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the checks to run, and how to
[add an app](CONTRIBUTING.md#adding-an-app). To report a vulnerability, please use
GitHub's private reporting, as [SECURITY.md](SECURITY.md) says.

## Licence

[GPL-3.0-or-later](LICENSE)
