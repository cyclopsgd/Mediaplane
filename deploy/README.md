# Running Mediaplane in its container

Mediaplane runs as two containers in their own Compose project, `mediaplane-system`:

- **`mediaplane`**: the CLI. It idles until you run a command, and has no web interface
  yet (the panel arrives in M2).
- **`socket-proxy`**: the only container that talks to Docker. It passes on only the
  Docker API calls Mediaplane makes
  ([ADR 0008](../docs/adr/0008-docker-socket-proxy-on-by-default.md)).

The stack Mediaplane deploys is a separate Compose project, `mediaplane`, so `apply` can
never touch Mediaplane itself.

> Mediaplane is pre-alpha. The apps are not wired together yet (Slices 3b to 7 do that).
> On a home network, `init` suggests publishing their web UIs on your LAN. Until the
> wiring lands:
>
> - Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
>   complete them, so complete them first;
> - Sonarr, Radarr and Prowlarr ask for a login that has no user yet (Slice 3b creates
>   it).
>
> qBittorrent has the shared admin login from its first start: `mediaplane credentials`
> shows it. To keep the web UIs on this machine only, answer `localhost` when `init`
> asks (see [First run](#first-run)).

## What you need

- **Linux** on amd64 or arm64.
- **Docker Engine 24 or newer**, rootful, with its socket at `/var/run/docker.sock`, and
  the Compose plugin 2.24 or newer. Rootless Docker is not supported. Mediaplane checks
  for Engine 24. The container brings its own Docker CLI 29.8.1 and Compose 5.5.1, which
  have been tested only with Docker Engine 28 and 29 so far.
- **No SELinux in enforcing mode.** Such hosts aren't supported yet: neither
  Mediaplane's bind mounts nor the apps' carry a `:z` label.
- **A folder for the Mediaplane home,** on a local filesystem that supports hard links,
  such as ext4, XFS or Btrfs. Mediaplane creates its lock, `stack.yaml` and the files
  apps read at their first start with a hard link, so FAT, exFAT and some network shares
  won't work.
- **A data folder** for downloads and media.

## Install

No image is published yet: releases arrive in Slice 8. Build one from a checkout:

```bash
git clone https://github.com/cyclopsgd/Mediaplane.git
cd Mediaplane
docker build --tag mediaplane:local .
```

Mediaplane's container must not run as root. The commands below use your own ids, so run
them as a normal user. If `id -u` prints 0, as on a VPS or LXC container where you only
have root, create a normal user and use its ids in their place, in the `chown` and in
`deploy/.env`.

Create the home, owned by the user Mediaplane will run as. Here that is you:

```bash
sudo mkdir -p /opt/mediaplane
sudo chown "$(id -u):$(id -g)" /opt/mediaplane
```

Tell the deployment which image, user, Docker group and timezone to use, in
`deploy/.env`, then start it:

```bash
cat > deploy/.env <<EOF
MEDIAPLANE_IMAGE=mediaplane:local
MEDIAPLANE_UID=$(id -u)
MEDIAPLANE_GID=$(id -g)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
TZ=$(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)
EOF
docker compose -f deploy/mediaplane.compose.yaml up -d
```

`TZ` is the host's timezone, for `init`. The line asks systemd, or reads `/etc/timezone`
on a host without it. If it finds neither, `TZ` is empty and the container uses `UTC`.

For a home somewhere else, add `MEDIAPLANE_HOME=/srv/mediaplane` to `deploy/.env`. The
home is mounted at the same path inside the container, because the host's Docker resolves
every path in the stack's `compose.yaml`. `mediaplane plan` checks this for you.

### The `mediaplane` command

Commands run inside the container:

```bash
docker exec -it mediaplane mediaplane plan
```

The one-line shim shortens that to `mediaplane plan`:

```bash
sudo install -m 0755 deploy/mediaplane /usr/local/bin/mediaplane
```

It adds `-t` only on a terminal, so it works in scripts too.

## First run

```bash
mediaplane init         # asks a few questions, then writes /opt/mediaplane/stack.yaml
mediaplane plan         # checks the host and shows what apply would do
mediaplane apply        # asks before it changes anything; --yes skips the question
mediaplane status
mediaplane credentials  # the admin login, and where each app is
```

`init` checks the flags it can before its first question, and asks again when an answer
won't do. Ctrl-D or Ctrl-C at a question stops it, writing nothing.
Without a terminal it asks nothing: pass the flags in the
[CLI reference](../docs/reference/cli.md#mediaplane-init) instead.

- **`init`** writes the user it runs as into `stack.yaml`. Inside the container that is
  `MEDIAPLANE_UID`; run as root (`docker exec -u 0`), it writes 1000 instead. The apps
  that use the data folder run as that user, so it must be able to write there.
- **The timezone.** `init` writes the container's `TZ`: the host's zone from
  `deploy/.env`, or `UTC` when that is empty. Pass `--timezone Europe/London`, for
  example, or edit `timezone:` afterwards.
- **Who can reach the apps.** `init` asks whether to publish the web UIs on your LAN
  (`network.bind: lan`), so you can open them from your other devices, or to keep them
  on this machine (`localhost`, or `--bind localhost`). On a cloud VM it suggests
  `localhost`.
  - With `lan`, it offers the LAN subnet it sees, when it sees just one, or asks you to
    type one: a private range that holds one of this host's addresses. It writes it as
    `network.lan_subnet` (`--lan-subnet`). Left empty, `plan` detects it each time. On a
    cloud VM it offers none, and asks until you type one.
  - With `lan`, it also asks whether your own network must sign in too
    (`security.login_on_lan`; `--no-login-on-lan` says no).

  Until the wiring lands (Slices 3b to 7):
  - Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
    complete them. Complete them right after the first `apply`.
  - Sonarr, Radarr and Prowlarr ask for a login that has no user yet. Their READMEs,
    such as [Sonarr's](../catalog/sonarr/README.md), say how to create one.

- **The admin login.** `init` asks for its user name (`--admin-user`), and whether
  Mediaplane should generate its password or read yours from a file in the home
  (`--admin-password-file secrets/admin-password`, at least 12 characters). After
  `apply`, `mediaplane credentials` shows the login and each app's address. It shows a
  password of your own only with `--reveal`, and its `--json` output leaves out either
  unless you add `--reveal`. qBittorrent uses this login today; Sonarr, Radarr and
  Prowlarr follow in Slice 3b.
  - qBittorrent gets the login only at its first start, from a file Mediaplane never
    rewrites. So if you later change `admin.password`, or switch between yours and the
    generated one, `credentials` shows the new password but qBittorrent keeps the old
    one. Change it in qBittorrent's web UI too, until Slice 3c does that for you.
  - Removing your own `admin.password` brings back the password Mediaplane generated
    before, if it generated one. It keeps it, and never generates another.
- **The VPN address.** With a VPN provider, `init` asks for your WireGuard address
  (`--vpn-addresses`, which needs `--vpn-provider`). Providers such as Mullvad need it.
  It is the `Address` line in the WireGuard file your provider gives you.
- **File secrets.** A secret written as `{ file: secrets/… }` is read from the home.
  Mediaplane's container sees nothing outside the home, so keep secret files there.
- **Environment secrets.** A secret written as `{ env: NAME }` must be in the container's
  environment. Pass it with `docker exec -it -e NAME mediaplane mediaplane apply`, which
  the shim doesn't do, or add it to the `mediaplane` service.

## What runs where

```text
host
├─ mediaplane-system
│  ├─ mediaplane    the CLI, idle
│  └─ socket-proxy  Docker API, filtered
├─ mediaplane       your stack's apps
└─ host helper      seconds, during
                    init, plan and apply
```

- **The host helper.** From inside its container, Mediaplane can't see the host's
  network, ports, or folders outside its home. So during `init`, `plan` and `apply` it
  starts a throwaway container of its own image on the host network, and reads them
  there. That container:
  - gets read-only mounts of the data folder, `stack.yaml`, and `/dev` when the VPN needs
    `/dev/net/tun`;
  - runs as Mediaplane's user, with no capabilities and a read-only root;
  - never pulls an image, and is removed when it exits, a second or two later.

  Before Docker 25, or on a kernel older than 5.12, read-only mounts are not recursive: a
  mount inside one of those folders, such as `/dev/shm`, stays writable. On any version,
  device files under `/dev` stay writable where Docker's device rules and their file
  modes allow.

- **Mediaplane's network** is internal: the container reaches the proxy and nothing else.
  Image pulls happen in the Docker daemon, which has the host's network.

## Updating

Rebuild the image, then recreate the project:

```bash
git pull
docker build --tag mediaplane:local .
docker compose -f deploy/mediaplane.compose.yaml up -d
```

Once images are published (Slice 8), `docker compose -f deploy/mediaplane.compose.yaml pull`
replaces the build. Updating Mediaplane never restarts your stack.

An update can bring a new version of Compose inside the image. Compose versions can
compute a container's configuration hash differently
([ADR 0010](../docs/adr/0010-predict-container-changes-with-compose-hashes.md)). If that
happens, the next `mediaplane plan` shows most apps as `recreate`, and the next `apply`
recreates them once. Their data stays where it is.

## Running without the socket proxy

The proxy is on by default. It is defence in depth, not a boundary: anything that can
create containers can take over the host (see the
[threat model](../docs/security/threat-model.md)). To work without it, for example to
debug a call it refuses, give Mediaplane the socket with a Compose file of your own,
`deploy/no-proxy.yaml`:

```yaml
services:
  mediaplane:
    environment:
      DOCKER_HOST: unix:///var/run/docker.sock
    group_add: ['${DOCKER_GID}']
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Then start the project with both files:

```bash
docker compose -f deploy/mediaplane.compose.yaml -f deploy/no-proxy.yaml up -d
```

Mediaplane then uses the socket directly, and the proxy keeps running, unused. Every
`plan` and `apply` warns:
`Mediaplane is using the Docker socket directly, without the socket proxy`. To go back
to the proxy, run `up -d` again with `mediaplane.compose.yaml` alone.

## Troubleshooting

Each item is a message you may see, then what to do.

- `required variable … is missing a value`

  Create `deploy/.env`, as in [Install](#install).

- `bind source path does not exist: /opt/mediaplane`

  Create the home first, as in [Install](#install).

- `the Mediaplane home … is not the same folder on the Docker host`

  Set `MEDIAPLANE_HOME` in `deploy/.env` instead of editing the volume, so the paths
  match.

- `cannot create …: the Mediaplane home must be on a filesystem that supports hard links`

  Move the home to a local ext4, XFS or Btrfs filesystem.

- `EACCES` on a file in the home

  Give `state/` and `generated/` to `MEDIAPLANE_UID`, with all they hold, and
  `appdata/` itself, but not what is in it: some apps need their own owner. Use the
  ids in `deploy/.env`. For example:

  ```bash
  sudo chown -R 1000:1000 /opt/mediaplane/state /opt/mediaplane/generated
  sudo chown 1000:1000 /opt/mediaplane/appdata
  ```

  For `cannot create …/appdata/… (EACCES)`, see that item below: it names the one app
  folder to give back.

- `file … is missing, empty or unreadable`, for a secret file outside the home

  Move it into the home: the container sees nothing else.

- `… failed to connect to the docker API at tcp://socket-proxy:2375 …`

  The socket proxy is not running. Check it on the host, read its log, and start it
  again:

  ```bash
  docker compose -f deploy/mediaplane.compose.yaml ps
  docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy
  docker compose -f deploy/mediaplane.compose.yaml up -d
  ```

- `the host helper failed: … No such image`

  `MEDIAPLANE_IMAGE` must name an image on this host: check `docker image ls`.

- `the host helper did not finish within 60 s`

  Check that the data folder and the home are reachable on the host. A network share
  (NFS or SMB) that has stopped responding is the usual cause.

- `… was not written by Mediaplane, so it lacks the key Mediaplane gave …`

  The app first started before Mediaplane wrote its settings file. Its README, under
  "Set up before Slice 3a", shows how to replace the file.

- `cannot create …/appdata/… (EACCES)`

  Mediaplane's user can't write in the app's folder, usually because it belongs to the
  stack's `user:`, so apply can't write the app's settings file there. Its README, under
  "Set up before Slice 3a", says what to do.

- `cannot make …/appdata private (EPERM): it belongs to uid …, not to the user Mediaplane runs as (uid …)`

  Mediaplane keeps `appdata/` private (0700) on every apply, so it must own the folder.
  `plan` warns about it first (`appdata.not-owned`). Give the folder itself, not what
  is in it, to `MEDIAPLANE_UID`:

  ```bash
  sudo chown 1000:1000 /opt/mediaplane/appdata
  ```

- `the admin password has not been generated yet`

  `mediaplane credentials` needs an `apply` first: apply generates the password before
  it starts any app.

- `Error response from daemon: Forbidden`

  The proxy refused a call. Its log names it, as `blocked request`:

  ```bash
  docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy
  ```

## Removing Mediaplane

`docker compose -f deploy/mediaplane.compose.yaml down` removes Mediaplane and the proxy.
Your stack keeps running. The command in the header of
`/opt/mediaplane/generated/compose.yaml` manages it without Mediaplane.

That command uses your host's Compose. If it is not the version in Mediaplane's image
(5.5.1), its first `up -d` may recreate most apps once, for the reason in Updating.
Compose 2.38 does. Their data stays where it is. `docker compose version` shows yours.
