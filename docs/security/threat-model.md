# Threat model

This is the threat model for Mediaplane as built today: M1, up to and including Slice 3a,
and Slices 3d and 3b.
It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## The one thing to know

Mediaplane controls Docker, and controlling Docker is root-equivalent on the host. The
security of Mediaplane is therefore the security of the host. Every control below narrows
that power. None of them removes it.

## What it protects

| Asset                                        | Where                                                                 | Why it matters                                             |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| The host                                     | Everything                                                            | Docker access is root on the host                          |
| Generated API keys                           | `state/secrets.json`, `generated/.env` (both 0600) and `appdata/`     | They open the apps' APIs                                   |
| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr and Prowlarr          |
| Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                     |
| App data                                     | `appdata/<app>/`                                                      | The apps' databases and settings, some holding credentials |
| Your media                                   | The data folder                                                       | Your library                                               |

## What runs, and who can reach it

```text
LAN or internet
  │ web UIs only, as
  │ network.bind says
  ▼
mediaplane project: the apps
  (qBittorrent inside Gluetun,
  with a VPN)
  ▲
  │ wiring network:
  │ internal, no route out
  │
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
  - Its only mount is the home. It listens on nothing.
  - It is on two networks, both internal, so it has no route out: the proxy's, and the
    stack's wiring network, which it joins to call the apps' APIs (see T14 and
    [ADR 0011](../adr/0011-a-private-wiring-network.md)). It sets
    `net.ipv4.ip_forward: 0`, so it cannot route between them.
  - You reach it with `docker exec`, which already needs Docker access on the host.
- **The socket proxy.** It is the only container with the Docker socket. It forwards only
  the API calls Mediaplane makes, and only from the address the name `mediaplane` has on
  its network ([ADR 0008](../adr/0008-docker-socket-proxy-on-by-default.md)).
- **The host helper.** During `init`, `plan`, `apply` and `vpn-check`, Mediaplane
  starts a container of its own image on the host network, for a few seconds. It sees
  what the Mediaplane container cannot:
  - through the host network: the host's addresses and free ports, and for `vpn-check`,
    the address the host's own traffic leaves from (see T13);
  - through read-only bind mounts: the data folder, the home's `stack.yaml`, and `/dev`
    when the VPN needs `/dev/net/tun`.

  It runs as Mediaplane's user, with no capabilities, a read-only root and
  `no-new-privileges`. It never pulls an image, and is removed when it exits. Two limits
  to its read-only mounts:
  - before Docker 25, or on a kernel older than 5.12, they are not recursive, so mounts
    inside those folders stay writable: under `/dev`, such as `/dev/shm` and
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
- **The wiring.** `plan` and `apply` call the apps' APIs over the wiring network: from
  the Mediaplane container, or run from source, from the host. Each request goes
  straight to the app's container, through an HTTP agent of Mediaplane's own, so a proxy
  in the environment (`NODE_USE_ENV_PROXY`) never sees a key. It carries the app's key in
  a header (`X-Api-Key`, or a Bearer token for qBittorrent), never in the URL. Mediaplane
  signs in to Sonarr, Radarr and Prowlarr with the shared login, to check it.
- **vpn-check's probe.** `mediaplane vpn-check` runs
  `docker compose run --rm --no-deps -T --user 65534:65534 --entrypoint sh qbittorrent`
  with a short script: a throwaway container of qBittorrent's own image, as nobody, in
  Gluetun's network namespace, as qBittorrent is. It asks Gluetun's control server for
  the VPN's state, looks up the route out, and, unless `--no-egress` is given, asks an
  IP-echo service which address it comes from. It writes nothing, and is removed when it
  exits. Gluetun's key reaches it on its standard input, never on a command line or in
  its environment. Its curl reads no config file and no proxy setting. It uses the same
  Docker API calls as the ownership helper, so the proxy allows nothing new for it.
  Like the ownership helper, it gets the app's own settings from `compose.yaml` and
  `compose.override.yaml`, so it has qBittorrent's mounts (its appdata and the data
  folder) and environment. Its script writes nothing; see T4 for what a compromised image
  could do with them.
- **The apps.**
  - They are unmodified upstream images, pinned by digest, and never get the Docker
    socket.
  - Only their web UIs are published, bound as `network.bind` says. Everything else stays
    on the stack's own Docker network.
  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, and qBittorrent,
    through Gluetun with a VPN) are on the stack's wiring network too. It is internal:
    it gives them no way out, which they have on their own network.
  - Before an app's first start, Mediaplane writes the files it reads when it starts:
    Sonarr's, Radarr's and Prowlarr's `config.xml`, qBittorrent's `qBittorrent.conf` and
    Gluetun's `auth/config.toml`. Each is written 0600, and only if absent.
  - With a VPN, qBittorrent has no network of its own. It uses Gluetun's, so it has no
    route out when the VPN is down (see T12).
  - Gluetun's control server (port 8000) is never published. It answers only Mediaplane's
    key, on two read-only routes (see T11).

## Threats and controls

### T1. A bug in Mediaplane, a library or Compose is used to drive Docker

Controls today:

- No listener in M1, and the input is your own `stack.yaml`.
- The proxy refuses `exec`, file copy, builds, prunes, every delete except of containers,
  and the system, swarm, secret, config and plugin APIs.
- The runtime refuses any project but `mediaplane` or `mediaplane-<name>`. It connects
  only Mediaplane's own container, and only to its project's wiring network, which must
  be internal.

What remains:

- The proxy checks the method and the path, never the request body. Creating a
  privileged container, or one that mounts `/`, is allowed. See
  [What the proxy does not stop](#what-the-proxy-does-not-stop).

### T2. Someone on the LAN reaches an app

Controls today:

- Only web UIs are published: on the host's private addresses (`lan`), on localhost, or
  on every interface with a warning (`all`).
- qBittorrent asks for the shared admin login from its first start. Mediaplane writes
  the login into `qBittorrent.conf` before qBittorrent runs, so the image never starts
  with its temporary password. It asks on localhost too.
- Sonarr, Radarr and Prowlarr ask for the shared admin login, which `apply` sets through
  their API once they first start. They ask from the LAN too, by default
  (`security.login_on_lan`).
- With `login_on_lan: false`, qBittorrent lets only your LAN subnet skip its login, and
  only while the web UIs are on the LAN. That subnet is `network.lan_subnet`, or else the
  subnets of the host's private addresses. Sonarr, Radarr and Prowlarr let any local
  address in (see What remains), and take only the Host names Mediaplane lists: their
  own name, and the addresses their web UI is published on. That stops a web page from
  reaching them through a name it controls (DNS rebinding). `network.lan_subnet` must be
  private (RFC 1918): a public range, or `0.0.0.0/0`, is refused.

What remains:

- On a home network, `init` suggests `bind: lan`, which puts the web UIs on your LAN.
- Until the wiring lands (Slices 6 and 7), Jellyfin's wizard and Seerr's setup are open
  to whoever reaches them first. Complete them right after the first `apply`, or keep
  `bind: localhost` until you have.
- With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
  Prowlarr without a login. For them, "local" means any private address, not just your
  LAN subnet.
- Between an app's first start and the wiring step a moment later, Sonarr, Radarr and
  Prowlarr have no user: with `login_on_lan: true` nobody can sign in, and with `false`
  a local address gets in anyway.

### T3. A cloud VM's private address is reachable from the internet

Controls today:

- On a detected cloud VM, `init` suggests `bind: localhost`. With `lan`, it asks you to
  type the private network to publish on, and never offers one it detected. `plan`
  refuses `bind: lan` there unless `network.lan_subnet` is set (`network.cloud-lan`).
- On a cloud VM, Mediaplane trusts no LAN subnet unless `network.lan_subnet` names one:
  no login bypass, and no way in through Gluetun's firewall. When that keeps your LAN
  out of qBittorrent's web UI, or makes qBittorrent ask your LAN for a login, `plan`
  warns (`network.no-lan-subnet`).
- `bind: all` warns on every plan.

What remains:

- Detection relies on firmware strings. Use `bind: localhost`, with Tailscale or an SSH
  tunnel.

### T4. An app is compromised

Controls today:

- It has no Docker access, and no other app's appdata.
- With a VPN, qBittorrent sits in Gluetun's network namespace.
- vpn-check's probe runs qBittorrent's image as nobody, writes nothing, and is removed
  when it exits.
- Mediaplane writes an app's pre-start files only inside its `appdata/<app>` folder. It
  refuses a path that leaves the folder, and a link on the way that leads outside it.

- An app's answers to Mediaplane are read at most 5 MiB at a time, checked against what
  Mediaplane expects, and never run or shown whole: only the app's own message about a
  refusal is shown, cut to 200 characters, with every secret replaced.

What remains:

- vpn-check measures qBittorrent's side with qBittorrent's own image, so a compromised
  image, or files it writes in its own appdata, could make the check pass.
- A compromised app on the wiring network can reach Mediaplane's container's address
  there. Mediaplane listens on nothing in M1. The proxy is on another network, and
  answers only the address the name `mediaplane` has there.
- A compromised app can answer Mediaplane's calls with anything it likes, such as a
  setting that looks right but isn't.
- The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
  networks, with keys in them. An app with Docker's default capabilities could try to
  intercept another's traffic on a network they share.
- The apps that handle media share the data folder, which hardlinks need, so a
  compromised one can change your media.
- A running app could swap one of its folders for a link between Mediaplane's check and
  the write, because Node can't refuse links at each step of a path. The write never
  replaces a file, and the catalog fixes the file's name. A full fix would write from
  inside the app's own container.

### T5. Secrets leak

Controls today:

- Generated with `crypto.randomBytes`.
- Kept in 0600 files: `state/secrets.json`, inside a 0700 `state/`, and `generated/.env`.
- Never in `stack.yaml` or `compose.yaml`.
- Replaced with `***` in errors. Change records hold names, never values.
- `state/resources.json` (0600) holds, for each resource Mediaplane manages in an app,
  its id, name and managed fields, and the names of its secrets: never a value or a
  hash. Secrets are checked by using them, such as signing in, so none needs keeping.
- An app's error message, as Mediaplane shows it, has every key and password replaced
  with `***`, and never includes what was sent: a request body is never shown or kept.
- Given to Compose in its environment or in the 0600 `generated/.env`, never on its
  command line.
- Gluetun's control key reaches vpn-check's probe on its standard input, and the probe
  hands it to curl the same way. It is never on a command line, which every user on the
  host can list, nor in the container's settings, and it is replaced with `***` in what
  the probe prints.
- The files apps read at their first start are written 0600, never half-written, and
  never over an existing file. `plan` lists them without their content, and change
  records hold only their paths.
- `appdata/` holds credentials too: the apps' keys, and qBittorrent's password hash.
  The apps rewrite their own files readable by every user on the host (0644), so
  Mediaplane keeps `appdata/` itself private (0700), as it does `state/`.

What remains:

- Not encrypted at rest, so use full-disk encryption.
- Root, and anyone with Docker access, can still read `appdata/`. Treat it as
  sensitive in backups.

### T6. Another user on the host uses Mediaplane's Docker access

Controls today:

- The proxy publishes no port, and answers only the address the name `mediaplane` has on
  its internal network: even the host gets `403 Forbidden`.
- Using Mediaplane needs `docker exec`, which means Docker access already.

What remains:

- Anyone in the `docker` group is already root on the host.
- A container joined to the proxy's network with the alias `mediaplane` passes, but
  joining needs Docker access too.
- Anyone who can write `stack.yaml` or `compose.override.yaml` in the home controls what
  Docker runs at the next `apply`, so keep the home writable by its owner only.

### T7. A tampered image or dependency

Controls today:

- Every image is pinned by digest: the apps, the proxy, and Node and the Docker CLI in
  Mediaplane's image.
- npm packages come from the lockfile, and GitHub Actions are pinned by commit.
- CI runs two vulnerability scans that fail the build:
  - Trivy scans Mediaplane's image on amd64 and arm64: its Alpine packages, the Docker
    CLI's Go standard library and Compose's Go modules. It fails on a critical
    vulnerability that has a fix.
  - `pnpm audit` checks the CLI's production npm dependencies, which are bundled into one
    file where Trivy can't see them, and fails on a critical advisory.
- gitleaks scans the full history on every push to `main` and every pull request.

What remains:

- Neither scan sees Node itself, which is not an Alpine package, nor the Docker CLI's own
  code: they stay current only when their pinned images are bumped.
- The audit needs the npm registry at CI time.
- Nothing bumps pins or dependencies automatically yet (Renovate, Slice 8).
- The catalog images are not scanned yet, and there is no SBOM or provenance yet. Both
  arrive in Slice 8.

### T8. The home is mounted at another path, so Docker mounts the wrong folders

Controls today:

- `plan` checks that `stack.yaml` inside the container is the very file the host has at
  that path (`preflight.home-path`).

What remains:

- The check compares `stack.yaml` only, not every folder in the home.

### T9. The proxy is turned off

Controls today:

- Every `plan` and `apply` warns (`docker.no-proxy`).

What remains:

- Without it, a bug reaches the whole Docker API.

### T10. One password opens every app

Controls today:

- The shared admin password is generated with `crypto.randomBytes`: 24 letters and
  digits, about 143 bits. It is kept in `state/secrets.json` (0600).
- A password of your own (`admin.password`) must be at least 12 characters.
- `mediaplane credentials` shows a generated password. It shows your own only with
  `--reveal`, and its `--json` output leaves either out unless you add `--reveal`.
  `plan`, `apply`, errors and change records never show it.
- qBittorrent keeps only a hash of it: PBKDF2-HMAC-SHA512, 100 000 rounds, with a
  random salt.

What remains:

- One password opens every app that uses it: qBittorrent, Sonarr, Radarr and Prowlarr
  today, and Jellyfin from Slice 6. A leak from one is a leak for all.
- Sonarr, Radarr and Prowlarr give their password hash to anyone who holds their API
  key. Prowlarr holds Sonarr's and Radarr's keys from Slice 5.
- Changing `admin.username`, `admin.password`, `login_on_lan`, `network.bind` or
  `network.lan_subnet` after qBittorrent's first start doesn't reach qBittorrent, whose
  file is written only once. `mediaplane credentials` shows the new login all the same.
  Change it in qBittorrent's web UI too, until Slice 3c manages those settings through
  its API.
- There is no way yet to rotate the generated password (Slice 4).

### T11. Something on the stack's network uses Gluetun's control server

Controls today:

- Its port, 8000, is never published.
- Before Gluetun's first start, Mediaplane writes `appdata/gluetun/auth/config.toml`. It
  gives a generated key two read-only routes, `GET /v1/vpn/status` and
  `GET /v1/publicip/ip`, and nothing else. Requests without the key are refused, and so
  are other routes with it: the kill-switch test checks both. Without that file, Gluetun
  v3.41 answers anyone on the stack's network.
- `mediaplane vpn-check` warns when the control server answers without the key.

What remains:

- A Gluetun that started before Slice 3a reads the file only when it next starts.
- The key is kept in `state/secrets.json` and in Gluetun's appdata, both 0600.

### T12. The VPN fails, and qBittorrent's traffic leaks

Controls today:

- qBittorrent uses Gluetun's network (`network_mode: service:gluetun`) and has none of its
  own, so when the tunnel is down it has no way out (fail-closed). Gluetun's firewall
  lets traffic out only through the tunnel, to the stack's own network, and to the LAN
  subnets in `FIREWALL_OUTBOUND_SUBNETS` while the web UIs are on the LAN.
- An end-to-end test, which CI runs on amd64 and arm64, checks it against a WireGuard
  server of its own: traffic leaves through the tunnel; with the server stopped,
  nothing gets out of qBittorrent's network while an ordinary container on the stack's
  network still does; with Gluetun stopped, qBittorrent has nothing but loopback.
- `mediaplane vpn-check` checks the same on your host: qBittorrent's network mode, that
  it joined the Gluetun now running, Gluetun's health and its own report, the route into
  the tunnel, and where qBittorrent's traffic leaves from, compared with the host's. It
  exits 1 on a leak or a VPN that is down.
- `plan` warns every time qBittorrent runs without the VPN
  (`apps.qbittorrent.vpn: false`).
- `apply`'s verify step runs vpn-check's checks, without the address comparison, after
  every apply that changes something: qBittorrent's network, Gluetun's health and its
  own report, and the route into the tunnel.
- When Gluetun starts again on its own, qBittorrent keeps the old, empty network until it
  restarts too. That fails closed, and vpn-check reports it. `apply` restarts
  qBittorrent then, and when it starts a stopped Gluetun.

What remains:

- vpn-check runs only when you run it, or `apply` does. Alerts come in M3.
- The address comparison asks one IP-echo service; one that answers wrongly could hide a
  leak. The checks before it don't depend on that service.
- vpn-check measures IPv4 only. An IPv6 egress check waits for Docker's IPv6 to be turned
  on; the roadmap lists it.
- "Nothing leaks (fail-closed)" in a `VPN down` result is an inference, with qBittorrent
  shown to be in Gluetun's network: Gluetun is stopped, or nothing answered while the
  route went into the tunnel or nowhere. A route into the tunnel can't get out around
  the VPN, so a service that stalls the TLS handshake can only make a working tunnel
  read as down there.
- With the route outside the tunnel and no answer, the result is `VPN down`, and never
  says that nothing leaks. Only Gluetun's firewall stands in the way then, and nothing
  measures it: the service may be one this network can't reach at all, or one that
  stalls the TLS handshake, so a leak to other destinations can read as `down`. A `LEAK`
  result is the one to act on first.

### T13. vpn-check tells an outside service your addresses

Controls today:

- Only when you run `mediaplane vpn-check`, and never with `--no-egress`.
- The default service is Cloudflare's trace, by IP address
  (`https://1.1.1.1/cdn-cgi/trace`), so no DNS query goes out. Cloudflare is already
  Gluetun's DNS-over-TLS resolver and one of the services it asks for its own address.
- `MEDIAPLANE_VPN_CHECK_URL` names another service, which must be http or https.
- The host's request refuses a redirect, and a URL with a user name or password. Only an
  answer shaped like an address comes back, and at most 16 KiB of it is read.
- From source, behind a Node env proxy (`NODE_USE_ENV_PROXY`, or `--use-env-proxy` in
  `NODE_OPTIONS` or on `node`'s command line), the host side can't be measured, so
  `vpn-check` warns and compares nothing.
- From source, with `DOCKER_HOST` set to anything but a `unix://` socket (`tcp://`,
  `ssh://`), Docker may run on another host, whose address is the one a leak would
  show. So the host side isn't measured, and `vpn-check` warns and compares nothing. In
  the image, `DOCKER_HOST` is the socket proxy, and the host helper runs on Docker's
  host, so it is measured there.

What remains:

- The service learns the VPN's exit address and the host's own address, once per run.
  In the Mediaplane container, the host helper makes the host's request, from the host
  network.
- The URL is not a secret. It is shown in the output and in `egress.url`, and it goes on
  the host helper's command line, where every user on the host can see it with `ps`. So
  it must carry no token.
- An `http:` URL can be answered by anything on the path, so a forged answer could hide
  a leak or fake one.
- The helper sends a GET from the host network to whatever URL is set, local and
  metadata addresses included. Run from source, the CLI sends it, from the host.
- Run from source, only `DOCKER_HOST` is read. A Docker context chosen another way
  (`docker context use`, `DOCKER_CONTEXT`) that points at another host isn't noticed,
  and the host side is then this machine's.

### T14. Mediaplane's container gets a way out, or a way in

Controls today:

- The apps' APIs are reached over the stack's wiring network, which is internal
  ([ADR 0011](../adr/0011-a-private-wiring-network.md)). Mediaplane's container is on it
  and on the proxy's network, and on nothing else, so it has no route out: the
  end-to-end test checks that it has no default route.
- The runtime connects only Mediaplane's own container, only to the internal wiring
  network the managed project's Compose made, and never takes it off any other network.
  It reads the network first, strictly: it must be internal, a bridge, and carry this
  project's Compose labels for `wiring`. Joining and leaving then act on the ID it read,
  not on the name.
- Mediaplane's container has `net.ipv4.ip_forward: 0`, so it cannot pass packets between
  the proxy's network and the wiring network. Without it, a container on the wiring
  network that holds `NET_ADMIN` could route through Mediaplane's to the proxy. Only the
  IPv4 key is set: neither network has IPv6, and the IPv6 key stops a container starting
  on a host without IPv6.
- The apps keep their own network for their own traffic. Gluetun counts the wiring
  network as local, so its firewall lets Mediaplane reach qBittorrent's port, and its
  tunnel is unchanged: the kill-switch test checks both.
- Joining needs no Docker API call that the proxy didn't already allow.

What remains:

- The proxy still lets Mediaplane create containers with any network, so this is
  defence in depth, not a wall: a compromised Mediaplane can still reach anything the
  host can.
- Like any Docker network, the wiring network reaches the host at its gateway address,
  where the host's own services listen.
- "Offline" means no route of its own. Mediaplane holds the apps' keys, and the apps on
  the wiring network can fetch for it: qBittorrent's add-by-URL, the Servarr apps' test
  endpoints, and Gluetun's HTTP proxy or Shadowsocks, if `apps.gluetun.env` turns them
  on (they listen on every Gluetun interface).
- Docker answers a name from every network a container is on. Only your
  `compose.override.yaml` could put a container called `socket-proxy` on the wiring
  network; it would then compete with the proxy for that name.

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
  the host, not just the stack's, and network connect takes any container and any
  network. The runtime's checks are what keep Mediaplane to its own project, and to its
  own container on the wiring network.
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
