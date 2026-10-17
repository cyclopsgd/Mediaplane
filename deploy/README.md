# Running Mediaplane in its container

Mediaplane runs as two containers in their own Compose project, `mediaplane-system`:

- **`mediaplane`**: the CLI. It idles until you run a command, and has no web interface
  yet (the panel arrives in M2).
- **`socket-proxy`**: the only container that talks to Docker. It passes on only the
  Docker API calls Mediaplane makes
  ([ADR 0008](../docs/adr/0008-docker-socket-proxy-on-by-default.md)).

The stack Mediaplane deploys is a separate Compose project, `mediaplane`, so `apply` can
never touch Mediaplane itself.

> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent and the media
> server, Jellyfin or Plex, Prowlarr to them, and Seerr to all three. On a home network,
> `init` suggests publishing the web UIs on your LAN. When `apply` runs the stack,
> Jellyfin's startup wizard, an unclaimed Plex and Seerr's setup are not published while
> they are open: Mediaplane finishes them first. The threat model says what voids that:
> [T16](../docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
>
> qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin have the shared admin login, and
> Seerr through Jellyfin: `mediaplane credentials` shows it. With Plex, you sign in to
> Plex and Seerr with your own plex.tv account. To keep the web UIs on this machine only,
> answer `localhost` when `init` asks (see [First run](#first-run)).

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

No image is published yet: releases arrive in Slice 9. Build one from a checkout:

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
mediaplane init         # asks a few questions, writes /opt/mediaplane/stack.yaml,
                        # and with Plex offers to sign you in to plex.tv
mediaplane plex-login   # with Plex, if you said no: signs you in, saves your token
mediaplane plan         # checks the host and shows what apply would do
mediaplane apply        # asks before it changes anything; --yes skips the question
mediaplane status
mediaplane credentials  # the admin login, and where each app is
mediaplane vpn-check    # with a VPN: qBittorrent gets out only through it
```

`init` checks the flags it can before its first question, including that it can create
the home or write into it, and asks again when an answer won't do. A line or two before
each question says what it is for. Ctrl-D or Ctrl-C at a question stops it, writing
nothing, except at the last one with Plex, "Sign in to Plex now?", which comes once the
files are written: there it only skips the sign-in. Without a terminal it asks nothing: pass the flags in the
[CLI reference](../docs/reference/cli.md#mediaplane-init) instead.

- **The data folder.** Run from source, `init` creates it if it is missing and you may,
  as you, and changes no owner or mode. When it can't, such as for a folder under `/srv`
  that needs root, its next steps give the `sudo mkdir -p` and `sudo chown` commands.
  Inside the container it sees only the home, so for a folder outside it the next step
  says to create it.
- **The WireGuard key.** With a VPN provider, on a terminal, `init` asks you to paste
  your provider's private key (its `PrivateKey` line). Nothing shows as you paste. It
  keeps it in `secrets/wg.key`, readable by you only, and never overwrites one that is
  there. Press Enter to put it there yourself later; without a terminal, or with
  `--json`, it never asks.

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

- **Your Plex token.** With `media_server: plex`, on a terminal, `init` ends by asking
  "Sign in to Plex now?". Yes runs the same sign-in as `mediaplane plex-login`, there and
  then. No, a script, `--json`, or a sign-in that fails leaves it as a next step: run
  `mediaplane plex-login` before the first `apply`. It prints a link: open it in a
  browser, on any device, and sign in to Plex. It then saves your token where `plex.token` says (`secrets/plex-token`), readable
  by you only, and never prints it. It waits as long as the link lasts, 30 minutes, or
  `--timeout` seconds. A saved token that plex.tv still takes is kept, unless you add
  `--force`; one plex.tv refuses (HTTP 401) is replaced. When plex.tv can't say whether
  the saved token works (no answer, a 403, a 429, or an error of its own), it keeps the
  token and says so: run it again later, or add `--force` to sign in anyway. A token
  file or `secrets/` folder it can't read stops it before it asks plex.tv for a link.
  `apply` claims Plex for that account before its web UI is published, and signs Seerr
  in with it.

- **The admin login.** `init` asks for its user name (`--admin-user`), and whether
  Mediaplane should generate its password. Answer `n` and, on a terminal, it asks you to
  type your own twice, with nothing shown, and saves it in `secrets/admin-password`,
  readable by you only. It needs at least 12 characters, with no space at either end.
  Enter instead asks for a file in the home that you fill yourself, and a file already at
  `secrets/admin-password` is used as it is. Without a terminal, pass
  `--admin-password-file secrets/admin-password`. After `apply`, `mediaplane credentials` shows the login and each app's address. It shows a
  password of your own only with `--reveal`, and its `--json` output leaves out either
  unless you add `--reveal`. qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin use it,
  and Seerr through Jellyfin. qBittorrent gets it before its first start, Jellyfin in its
  first-run setup, and Seerr in its first sign-in. `apply` sets it in the first five
  through their API once they run, and sets it again whenever it changes; Seerr follows
  Jellyfin. With Plex, you sign in to Plex, and Seerr, with your own plex.tv account
  instead: `mediaplane credentials` says so.
  - Removing your own `admin.password` brings back the password Mediaplane generated
    before, if it generated one. It keeps it, and never generates another.
- **The VPN address.** With a VPN provider, `init` asks for your WireGuard address
  (`--vpn-addresses`, which needs `--vpn-provider`). Providers such as Mullvad need it.
  It is the `Address` line in the WireGuard file your provider gives you, such as
  `10.64.0.2/32`; several go comma-separated, without spaces.
- **Checking the VPN.** `mediaplane vpn-check` checks that qBittorrent has no network
  but Gluetun's, that the VPN is up, and that qBittorrent's traffic leaves from another
  address than this host's. For that last check it asks Cloudflare
  (`https://1.1.1.1/cdn-cgi/trace`) twice: once from qBittorrent's network, and once
  from the host, through the host helper. `--no-egress` asks no one, and
  `MEDIAPLANE_VPN_CHECK_URL` names another service. It exits 0 on a pass, and 1 on a
  leak or a VPN that is down: the [VPN down runbook](../docs/runbooks/vpn-down.md) says
  what to do.
  - It measures IPv4 only.
  - The shim doesn't pass environment variables. To name another service, run the
    command in the container yourself, as for an environment secret below (the address
    is a made-up example):

    ```bash
    docker exec -it -e MEDIAPLANE_VPN_CHECK_URL=https://203.0.113.5/ip \
      mediaplane mediaplane vpn-check
    ```

    The URL is not a secret: it goes on the host helper's command line, which every user
    on the host can read, so put no token in it.
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
├─ host helper      seconds, during
│                   init, plan, apply
│                   and vpn-check
└─ plex.tv helper   seconds, with
                    Plex: init,
                    plex-login, apply
```

- **The host helper.** From inside its container, Mediaplane can't see the host's
  network, ports, or folders outside its home. So during `init`, `plan`, `apply` and
  `vpn-check` it starts a throwaway container of its own image on the host network, and
  reads them there. That container:
  - gets read-only mounts of the data folder, `stack.yaml`, and `/dev` when the VPN needs
    `/dev/net/tun`;
  - runs as Mediaplane's user, with no capabilities and a read-only root;
  - never pulls an image, and is removed when it exits, a few seconds later.

  Before Docker 25, or on a kernel older than 5.12, read-only mounts are not recursive: a
  mount inside one of those folders, such as `/dev/shm`, stays writable. On any version,
  device files under `/dev` stay writable where Docker's device rules and their file
  modes allow.

- **The plex.tv helper.** Mediaplane's container has no route out, so for each call to
  plex.tv (`plex-login`, and with Plex, the claim token and the checks of whose a Plex or
  a Seerr is, in `apply`) it starts a throwaway container of its own image on Docker's
  default `bridge` network, which has a route out and reaches none of the stack's
  networks. Like any container there, it can reach the host's published ports, your
  LAN and other containers on that bridge, which is harmless while it runs only
  Mediaplane's own code against plex.tv's fixed address. Your token goes on its standard
  input, never on a command line. It has no
  mount, runs as Mediaplane's user, with no capabilities and a read-only root, never
  pulls an image, and is removed when it exits
  ([ADR 0012](../docs/adr/0012-reach-plex-tv-through-a-short-lived-helper.md)).
- **Mediaplane's networks** are internal: the proxy's, and the stack's wiring network
  ([How Mediaplane reaches the apps](#how-mediaplane-reaches-the-apps)). The container
  has no route out. Image pulls happen in the Docker daemon, which has the host's
  network.
- **vpn-check's probe** is a throwaway container of qBittorrent's image, in Gluetun's
  network, as qBittorrent is. That is how `vpn-check` reaches Gluetun and the internet
  from the VPN's side without a route of its own.

## Updating

Rebuild the image, then recreate the project:

```bash
git pull
docker build --tag mediaplane:local .
docker compose -f deploy/mediaplane.compose.yaml up -d
```

Once images are published (Slice 9), `docker compose -f deploy/mediaplane.compose.yaml pull`
replaces the build. Updating Mediaplane never restarts your stack.

An update can bring a new version of Compose inside the image. Compose versions can
compute a container's configuration hash differently
([ADR 0010](../docs/adr/0010-predict-container-changes-with-compose-hashes.md)). If that
happens, the next `mediaplane plan` shows most apps as `recreate`, and the next `apply`
recreates them once. Their data stays where it is.

An update that brings Seerr's wiring treats a Seerr you set up by hand before it as one
Mediaplane has no record of. The next `apply` recreates it once, unpublished, and checks
it with its key, never the password. If its admin (its first user) is the Jellyfin login
`admin.username` names and its Jellyfin is `jellyfin:8096`, with no URL base and no TLS,
Mediaplane records it and publishes it again; if not, it stays unpublished and `apply`
stops. The
[wiring failed runbook](../docs/runbooks/wiring-failed.md) has the ways out. What voids
the guarantee that Seerr is not published while its setup is open is in
[T16](../docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).

An update that brings Plex's wiring changes three things you may see:

- A Plex an older `apply` published unclaimed has no token of its claim in its
  `Preferences.xml`. The next `apply` recreates it unpublished, with a claim token of
  your account, so run `mediaplane plex-login` first. If it can't get a claim token, it
  starts nothing, stops that Plex, and says so.
- A Plex you claimed by hand has no record of Mediaplane's. The next `apply` recreates
  it once, unpublished, and publishes it again only once plex.tv says the token its
  claim gave it is your account's, and it lets no client in without a sign-in. If not,
  it stays unpublished, and the
  [wiring failed runbook](../docs/runbooks/wiring-failed.md) has the ways out, the
  ones that keep what Plex holds first.
- Sonarr's and Radarr's connection to Jellyfin: a TLS setting or a URL base you set in
  it by hand now reads as moved, and the next `apply` puts back `jellyfin:8096` without
  either, so Jellyfin's key goes only to the stack's own address.

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

- `the plex.tv helper failed: … network bridge not found`, or
  `the plex.tv helper did not finish within …`

  The plex.tv helper runs on Docker's default `bridge` network. Check that Docker has
  it (`docker network ls`; `"bridge": "none"` in `daemon.json` removes it), and that
  containers on it reach the internet.

- `nobody signed in within …; run plex-login again for a new link`, or
  `the link ran out before you signed in`

  From `mediaplane plex-login`. Run it again, and open the new link: each lasts 30
  minutes, and works once.

- `couldn't reach plex.tv: …`

  From `mediaplane plex-login`: plex.tv didn't answer at all (no connection, or not in
  time). In the image, check the plex.tv helper's network, above. When it was checking
  a saved token, the message adds that the token is kept.

- `plex.tv answered with HTTP …, so Mediaplane can't tell whether the Plex token in … still works. It is kept.`

  plex.tv answered, but with an error of its own, a 429 or a 403, which say nothing of
  the token. Run `plex-login` again later, or add `--force` to sign in anyway.

- `can't read the Plex token file … (…)`, or `can't make the folder … for the Plex token (…)`

  `plex-login` reads the saved token before it calls plex.tv, even with `--force`, and
  asks plex.tv for no link while it can't. Check who owns the file and `secrets/`
  (`ls -ln`): give them back to the user Mediaplane runs as (`MEDIAPLANE_UID`), then
  run it again.

- `plex.token: file secrets/plex-token is missing, empty or unreadable`

  From `plan`, or the plan `apply` makes first, on a Plex stack: run
  `mediaplane plex-login`.

- `plex.token is read from the environment variable …, where plex-login can't save it`

  `plex-login` saves your token in a file. Set
  `plex: { token: { file: secrets/plex-token } }` in `stack.yaml`, or put a token there
  yourself.

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

- `VPN down: qBittorrent can't reach the internet`, or
  `LEAK: qBittorrent's traffic does not go through the VPN`

  From `mediaplane vpn-check`. Follow the
  [VPN down runbook](../docs/runbooks/vpn-down.md), which goes by the line marked `DOWN`
  or `LEAK`.

- `the wiring failed for …`, `refusing to join mediaplane_wiring`, or an app's own
  message about its API, such as `refused Mediaplane's API key`

  From `mediaplane plan` or `apply`. Follow the
  [wiring failed runbook](../docs/runbooks/wiring-failed.md).

- `Resource is still in use`, from `docker compose -p mediaplane down`

  Mediaplane is still on the stack's wiring network. See
  [How Mediaplane reaches the apps](#how-mediaplane-reaches-the-apps).

- `Error response from daemon: Forbidden`

  The proxy refused a call. Its log names it, as `blocked request`:

  ```bash
  docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy
  ```

## How Mediaplane reaches the apps

The stack has a network of its own for Mediaplane, `mediaplane_wiring`, with no route
out ([ADR 0011](../docs/adr/0011-a-private-wiring-network.md)). The apps whose API
Mediaplane calls are on it, and so is Gluetun, for qBittorrent. `plan` and `apply` put
Mediaplane's container on it too, and it stays there; `apply` takes it off for `up`, and
back on after. So Mediaplane's container is on two networks, and neither has a route
out. After an update recreates the container, the next `plan` or `apply` puts it back.

While Mediaplane is on it, `docker compose -p mediaplane down` on the host leaves that
network behind ("Resource is still in use"). That holds after a plain `plan` too, not
only after `apply`, because `plan` joins the network to ask the apps. Bring
`mediaplane-system` down first, or take Mediaplane off:
`docker network disconnect mediaplane_wiring mediaplane`.

## Removing Mediaplane

`docker compose -f deploy/mediaplane.compose.yaml down` removes Mediaplane and the proxy,
and takes Mediaplane off the stack's wiring network. Your stack keeps running. The
command in the header of `/opt/mediaplane/generated/compose.yaml` manages it without
Mediaplane.

That command uses your host's Compose. If it is not the version in Mediaplane's image
(5.5.1), its first `up -d` may recreate most apps once, for the reason in Updating.
Compose 2.38 does. Their data stays where it is. `docker compose version` shows yours.
