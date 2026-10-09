# Threat model

This is the threat model for Mediaplane as built today: M1, up to and including Slice 2c.
It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## The one thing to know

Mediaplane controls Docker, and controlling Docker is root-equivalent on the host. The
security of Mediaplane is therefore the security of the host. Every control below narrows
that power. None of them removes it.

## What it protects

| Asset                                        | Where                                                | Why it matters                                             |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| The host                                     | Everything                                           | Docker access is root on the host                          |
| Generated API keys                           | `state/secrets.json` and `generated/.env`, both 0600 | They open the apps' APIs                                   |
| Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables          | They are your accounts                                     |
| App data                                     | `appdata/<app>/`                                     | The apps' databases and settings, some holding credentials |
| Your media                                   | The data folder                                      | Your library                                               |

## What runs, and who can reach it

```text
LAN or internet
  │ web UIs only, as
  │ network.bind says
  ▼
mediaplane project: the apps
  (qBittorrent inside Gluetun,
  with a VPN)

mediaplane-system project
  mediaplane
    │ internal network
    ▼
  socket-proxy ──► Docker

host helper: seconds, on the
host network, read-only mounts
```

- **The Mediaplane container.**
  - It runs as a non-root user (`MEDIAPLANE_UID`), with a read-only root filesystem, no
    capabilities and `no-new-privileges`.
  - Its only mount is the home. Its only network is internal, and reaches the proxy and
    nothing else. It listens on nothing.
  - You reach it with `docker exec`, which already needs Docker access on the host.
- **The socket proxy.** It is the only container with the Docker socket. It forwards only
  the API calls Mediaplane makes, and only from the address the name `mediaplane` has on
  its network ([ADR 0008](../adr/0008-docker-socket-proxy-on-by-default.md)).
- **The host helper.** During `init`, `plan` and `apply`, Mediaplane starts a container
  of its own image on the host network, for a second or two. It sees what the Mediaplane
  container cannot:
  - through the host network: the host's addresses and free ports;
  - through read-only bind mounts: the data folder, the home's `stack.yaml`, and `/dev`
    when the VPN needs `/dev/net/tun`.

  It runs as Mediaplane's user, with no capabilities, a read-only root and
  `no-new-privileges`. It never pulls an image, and is removed when it exits. Two limits
  to its read-only mounts:
  - before Docker 25, or on a kernel older than 5.12, they are not recursive, so mounts
    inside those folders stay writable: under `/dev`, that means `/dev/shm` and
    `/dev/mqueue`;
  - on any version, read-only does not apply to device files, so those under `/dev` stay
    writable where Docker's device rules and their file modes allow.

- **The appdata ownership helper.** During `apply`, when an app's `appdata/<app>` is not
  owned by the user the app runs as, Mediaplane runs
  `docker compose run --rm --no-deps -T --user 0:0 --entrypoint chown <app> -R <uid>:<gid> <path>`.
  That is a container of the app's own image, with the app's own settings from
  `compose.yaml` and `compose.override.yaml`, running `chown` as root on the appdata
  folder where the app mounts it. It belongs to the stack's project, and is removed when
  `chown` exits. Today only Seerr, which runs as uid 1000, needs it.
- **The apps.**
  - They are unmodified upstream images, pinned by digest, and never get the Docker
    socket.
  - Only their web UIs are published, bound as `network.bind` says. Everything else stays
    on the stack's own Docker network.
  - With a VPN, qBittorrent has no network of its own. It uses Gluetun's, so it has no
    route out when the VPN is down. The automated test for that arrives in Slice 3.

## Threats and controls

| #   | Threat                                                                  | Controls today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | What remains                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A bug in Mediaplane, a library or Compose is used to drive Docker       | No listener in M1, and the input is your own `stack.yaml`. The proxy refuses `exec`, file copy, builds, every delete except of containers, and the system, swarm, secret, config and plugin APIs. The runtime refuses any project but `mediaplane` or `mediaplane-<name>`                                                                                                                                                                                                                                                                                                                                                                                         | The proxy checks the method and the path, never the request body. Creating a privileged container, or one that mounts `/`, is allowed. See [What the proxy does not stop](#what-the-proxy-does-not-stop)                                                                                                                                                                                |
| T2  | Someone on the LAN reaches an app                                       | Only web UIs are published: on the host's private addresses (`lan`), on localhost, or on every interface with a warning (`all`). Sonarr, Radarr and Prowlarr ask for a login from the LAN too, by default (`security.login_on_lan`)                                                                                                                                                                                                                                                                                                                                                                                                                               | Until the wiring lands (Slices 3 to 7), first-run setup pages are open to whoever reaches them first: Jellyfin's wizard, Seerr's setup, and the arrs' first login. Keep `bind: localhost`                                                                                                                                                                                               |
| T3  | A cloud VM's private address is reachable from the internet             | On a detected cloud VM, `bind: lan` is refused unless `network.lan_subnet` is set. `bind: all` warns on every plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Detection relies on firmware strings. Use `bind: localhost`, with Tailscale or an SSH tunnel                                                                                                                                                                                                                                                                                            |
| T4  | An app is compromised                                                   | It has no Docker access, and no other app's appdata. With a VPN, qBittorrent sits in Gluetun's network namespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The apps that handle media share the data folder, which hardlinks need, so a compromised one can change your media                                                                                                                                                                                                                                                                      |
| T5  | Secrets leak                                                            | Generated with `crypto.randomBytes`. Kept in 0600 files: `state/secrets.json`, inside a 0700 `state/`, and `generated/.env`. Never in `stack.yaml` or `compose.yaml`. Replaced with `***` in errors. Change records hold names, never values. Given to Compose in its environment or in the 0600 `generated/.env`, never on its command line                                                                                                                                                                                                                                                                                                                      | Not encrypted at rest, so use full-disk encryption. `appdata/` holds credentials too: treat it as sensitive                                                                                                                                                                                                                                                                             |
| T6  | Another user on the host uses Mediaplane's Docker access                | The proxy publishes no port, and answers only the address the name `mediaplane` has on its internal network: even the host gets `403 Forbidden`. Using Mediaplane needs `docker exec`, which means Docker access already                                                                                                                                                                                                                                                                                                                                                                                                                                          | Anyone in the `docker` group is already root on the host. A container joined to the proxy's network with the alias `mediaplane` passes, but joining needs Docker access too. Anyone who can write `stack.yaml` or `compose.override.yaml` in the home controls what Docker runs at the next `apply`, so keep the home writable by its owner only                                        |
| T7  | A tampered image or dependency                                          | Every image is pinned by digest: the apps, the proxy, and Node and the Docker CLI in Mediaplane's image. npm packages come from the lockfile, and GitHub Actions are pinned by commit. CI runs two scans that fail the build. Trivy scans Mediaplane's image on amd64 and arm64: its Alpine packages, the Docker CLI's Go standard library and Compose's Go modules. It fails on a critical vulnerability that has a fix. `pnpm audit` checks the CLI's production npm dependencies, which are bundled into one file where Trivy can't see them, and fails on a critical advisory. gitleaks scans the full history on every push to `main` and every pull request | Neither scan sees Node itself, which is not an Alpine package, nor the Docker CLI's own code: they stay current only when their pinned images are bumped. The audit needs the npm registry at CI time. Nothing bumps pins or dependencies automatically yet (Renovate, Slice 8). The catalog images are not scanned yet, and there is no SBOM or provenance yet. Both arrive in Slice 8 |
| T8  | The home is mounted at another path, so Docker mounts the wrong folders | `plan` checks that `stack.yaml` inside the container is the very file the host has at that path (`preflight.home-path`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The check compares `stack.yaml` only, not every folder in the home                                                                                                                                                                                                                                                                                                                      |
| T9  | The proxy is turned off                                                 | Every `plan` and `apply` warns (`docker.no-proxy`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Without it, a bug reaches the whole Docker API                                                                                                                                                                                                                                                                                                                                          |

## What the proxy does not stop

The proxy's allow-list matches the HTTP method and the path, never the request body or
the query. The bind-mount filter in [Hardening further](#hardening-further) is the one
exception: it reads bind mounts, and nothing else. So:

- **`containers/create` takes any body.** A privileged container, a bind of `/` or of the
  Docker socket, and `PidMode: host` all pass. A compromised Mediaplane is root on the
  host. That is by design, and it is why the proxy is defence in depth.
- **Refusing `logs` is not a confidentiality control.** `attach` is allowed, and `attach`
  with `logs=1` returns any container's past output.
- **A container delete can take its anonymous volumes.** `DELETE /containers/{id}?v=1`
  removes them with the container. Named volumes and bind mounts are not touched.
- **`images/create` can fetch a URL.** It is the pull endpoint, and with `fromSrc` it
  imports an image from a URL that the Docker daemon fetches, with the host's network.
- **An allowed call works on any container.** Stop and delete reach every container on
  the host, not just the stack's. The runtime's project check is what keeps Mediaplane to
  its own project.
- **`-allowfrom=mediaplane` checks a DNS name,** not a container identity.
- **The socket's `:ro` restricts nothing.** A read-only bind of a socket still lets the
  holder send any request. It is a habit that costs nothing.

## Hardening further

- **Restrict bind mounts at the proxy.** socket-proxy can refuse any bind mount outside
  the folders you list. Add a line at the end of the `socket-proxy` command in
  `deploy/mediaplane.compose.yaml`, listing:
  - your home;
  - your data folder;
  - `/dev`, which the host helper mounts.

  ```yaml
  socket-proxy:
    command:
      # … the existing lines, then:
      - -allowbindmountfrom=/opt/mediaplane,/srv/data,/dev
  ```

  Every extra mount in your `compose.override.yaml` must then be listed too, and
  `volumes_from` is refused. It still cannot stop a privileged container.

- **Use Docker 25 or newer, with a 5.12 or newer kernel,** so that mounts nested inside
  the host helper's read-only mounts are read-only too. Device files under `/dev` stay
  writable even then, as far as Docker's device rules and their modes allow.
- **Keep `network.bind: localhost`,** and reach the web UIs through Tailscale, WireGuard or
  an SSH tunnel.
- **Encrypt the disk** that holds the home.

## Out of scope

- **Vulnerabilities in the upstream apps.** Report them to those projects.
- **A host that is already compromised,** or a member of the `docker` group acting
  against the host. That is root access already.
- **Shared hosts where untrusted users have Docker access.**
