# Running Mediaplane in its container

Mediaplane runs as two containers in their own Compose project, `mediaplane-system`:

- **`mediaplane`**: the CLI. It idles until you run a command, and has no web interface
  yet (the panel arrives in M2).
- **`socket-proxy`**: the only container that talks to Docker. It passes on only the
  Docker API calls Mediaplane makes
  ([ADR 0008](../docs/adr/0008-docker-socket-proxy-on-by-default.md)).

The stack Mediaplane deploys is a separate Compose project, `mediaplane`, so `apply` can
never touch Mediaplane itself.

> Mediaplane is pre-alpha. The apps are not wired together yet (Slices 3 to 7 do that),
> and some of their first-run pages are open to anyone who can reach them. Keep
> `network.bind: localhost` while you try it.

## What you need

- **Linux** on amd64 or arm64.
- **Docker Engine 24 or newer**, rootful, with its socket at `/var/run/docker.sock`, and
  the Compose plugin 2.24 or newer. Rootless Docker is not supported. Mediaplane checks
  for Engine 24, and CI tests with the version GitHub's runners ship.
- **A folder for the Mediaplane home,** on a local filesystem that supports hard links,
  such as ext4, XFS or Btrfs. Mediaplane creates its lock and `stack.yaml` with a hard
  link, so FAT, exFAT and some network shares won't work.
- **A data folder** for downloads and media.

## Install

No image is published yet: releases arrive in Slice 8. Build one from a checkout:

```bash
git clone https://github.com/cyclopsgd/Mediaplane.git
cd Mediaplane
docker build --tag mediaplane:local .
```

Create the home, owned by the user Mediaplane will run as. Here that is you:

```bash
sudo mkdir -p /opt/mediaplane
sudo chown "$(id -u):$(id -g)" /opt/mediaplane
```

Tell the deployment which image, user and Docker group to use, in `deploy/.env`, then
start it:

```bash
cat > deploy/.env <<EOF
MEDIAPLANE_IMAGE=mediaplane:local
MEDIAPLANE_UID=$(id -u)
MEDIAPLANE_GID=$(id -g)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
EOF
docker compose -f deploy/mediaplane.compose.yaml up -d
```

These commands use your own ids. If `id -u` prints 0, as on a VPS or LXC container where
you only have root, use a normal user's ids in both places instead, and create that user
if there is none. Mediaplane's container must not run as root.

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
mediaplane init     # asks a few questions, then writes /opt/mediaplane/stack.yaml
mediaplane plan     # checks the host and shows what apply would do
mediaplane apply    # asks before it changes anything; --yes skips the question
mediaplane status
```

- **`init`** writes the user it runs as into `stack.yaml`. Inside the container that is
  `MEDIAPLANE_UID`; run as root (`docker exec -u 0`), it writes 1000 instead. The apps
  that use the data folder run as that user, so it must be able to write there.
- **The timezone.** The container doesn't know the host's timezone, so `init` writes
  `UTC`. Pass `--timezone Europe/London`, for example, or edit `timezone:` afterwards.
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

| You see                                                                                 | What to do                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required variable … is missing a value`                                                | Create `deploy/.env` (Install)                                                                                                                                                                              |
| `bind source path does not exist: /opt/mediaplane`                                      | Create the home first (Install)                                                                                                                                                                             |
| `the Mediaplane home … is not the same folder on the Docker host`                       | Set `MEDIAPLANE_HOME` instead of editing the volume, so the paths match                                                                                                                                     |
| `cannot create …: the Mediaplane home must be on a filesystem that supports hard links` | Move the home to a local ext4, XFS or Btrfs filesystem                                                                                                                                                      |
| `EACCES` on a file in the home                                                          | Give `state/` and `generated/` to `MEDIAPLANE_UID`, for example `sudo chown -R "$(id -u):$(id -g)" /opt/mediaplane/state /opt/mediaplane/generated`. Leave `appdata/` alone: some apps need their own owner |
| `file … is missing, empty or unreadable`, for a secret file outside the home            | Move it into the home: the container sees nothing else                                                                                                                                                      |
| `the host helper failed: … No such image`                                               | `MEDIAPLANE_IMAGE` must name an image on this host: check `docker image ls`                                                                                                                                 |
| `Error response from daemon: Forbidden`                                                 | The proxy refused a call. Its log names it, as `blocked request`: `docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy`                                                                      |

## Removing Mediaplane

`docker compose -f deploy/mediaplane.compose.yaml down` removes Mediaplane and the proxy.
Your stack keeps running. The command in the header of
`/opt/mediaplane/generated/compose.yaml` manages it without Mediaplane.

That command uses your host's Compose. If it is not the version in Mediaplane's image
(5.5.1), its first `up -d` may recreate most apps once, for the reason in Updating.
Compose 2.38 does. Their data stays where it is. `docker compose version` shows yours.
