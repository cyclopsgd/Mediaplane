# Threat model

This is the threat model for Mediaplane as built in M1.
It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## The one thing to know

Mediaplane controls Docker, and controlling Docker is root-equivalent on the host. The
security of Mediaplane is therefore the security of the host. Every control below narrows
that power. None of them removes it.

## What it protects

Each asset, where it is, and why it matters:

- **The host:** everything. Docker access is root on the host.
- **Generated API keys:** `state/secrets.json`, `generated/.env` (both 0600) and
  `appdata/`. They open the apps' APIs.
- **qBittorrent's key, in Sonarr and Radarr:** their download client's settings, in
  `appdata/`. It opens qBittorrent's API.
- **Sonarr's and Radarr's keys, in Prowlarr:** its links' settings, in `appdata/`. They
  open Sonarr's and Radarr's APIs.
- **Jellyfin's key, which Jellyfin made:** `state/secrets.json` (0600), and Sonarr's and
  Radarr's connections. It opens Jellyfin's API, as its admin.
- **Keys in Seerr, the arrs' and one Jellyfin's:** Seerr's `settings.json`, in
  `appdata/`; Seerr shows them in clear. They open Sonarr, Radarr and Jellyfin, as their
  admin.
- **Seerr's session cookie, while it signs in:** Mediaplane's memory, for the moment of
  its first sign-in. It opens Seerr, as its admin, until signed out.
- **The shared admin password:** `state/secrets.json` (0600) or `admin.password`; a hash
  in `appdata/`. It opens every app with a login, Seerr through Jellyfin.
- **Your secrets (VPN key, Plex token, passwords):** `secrets/` (0700), or environment
  variables. They are your accounts.
- **Your Plex token, in Sonarr, Radarr and Seerr:** the arrs' Plex connections, and
  Seerr's database, in `appdata/`. It opens your plex.tv account, and every Plex it
  reaches.
- **Plex's own token, from its claim:** `appdata/plex`, in its `Preferences.xml` (0600).
  It opens your plex.tv account, as this Plex.
- **A claim token, as Plex first starts:** memory, Compose's environment, and Plex's,
  while it is unpublished. It claims a Plex for your account, once, for four minutes.
- **App data:** `appdata/<app>/`. The apps' databases and settings, some holding
  credentials.
- **Your media:** the data folder. Your library.

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

plex.tv helper: seconds, on
Docker's default bridge, no
mounts ──► plex.tv
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
    when an app needs a device: `/dev/net/tun` for the VPN, or `/dev/dri` for a media
    server's `hardware_transcoding`.

  It runs as Mediaplane's user, with no capabilities, a read-only root and
  `no-new-privileges`. It never pulls an image, and is removed when it exits. Two limits
  to its read-only mounts:
  - before Docker 25, or on a kernel older than 5.12, they are not recursive, so mounts
    inside those folders stay writable: under `/dev`, such as `/dev/shm` and
    `/dev/mqueue`;
  - on any version, read-only does not apply to device files, so those under `/dev` stay
    writable where Docker's device rules and their file modes allow.

- **The plex.tv helper.** Mediaplane's container has no route out, and plex.tv is the one
  outside service Mediaplane calls: for `mediaplane plex-login`, for the claim token Plex
  first starts with, and to ask whose a Plex or a Seerr is. So for each call it runs a
  container of its own image, `mediaplane plex-tv`, on Docker's default `bridge` network
  ([ADR 0012](../adr/0012-reach-plex-tv-through-a-short-lived-helper.md)).
  - What it can reach: the internet, through that network's route out, and, as any
    container there can, the host's published ports, your LAN, and other containers on
    the default bridge (T14 says why that is harmless, and what voids it).
  - What it can't: any app on the stack's wiring network or on the stack's own network.
    Docker keeps those apart from the default bridge, and a probe from it reached no
    container on either.

  The helper has no mount, no Docker socket and no other network, runs as Mediaplane's
  user, with no capabilities, a read-only root and `no-new-privileges`, never pulls an
  image, and is removed when it exits. Your Plex token reaches it on its standard input,
  never on a command line or in its environment, and it calls only plex.tv's own
  address. It uses the Docker API calls the host helper already makes, so the proxy
  allows nothing new for it. Run from source, the CLI calls plex.tv itself, from the
  host.

- **The appdata ownership helper.** During `apply`, when an app's `appdata/<app>` is not
  owned by the user the app runs as, Mediaplane runs
  `docker compose run --rm --no-deps -T --user 0:0 --entrypoint chown <app> -R <uid>:<gid> <path>`.
  That is a container of the app's own image, with the app's own settings from
  `compose.yaml` and `compose.override.yaml`, running `chown` as root on the appdata
  folder where the app mounts it. It belongs to the stack's project, and is removed when
  `chown` exits. Today only Seerr, which runs as uid 1000, needs it.
- **The folder helper.** During `apply`, before Mediaplane adds a root folder to Sonarr or
  Radarr, or makes a library in Jellyfin, it runs
  `docker compose run --rm --no-deps -T --user <uid>:<gid> --entrypoint mkdir <app> -p -- <path>`.
  A library's folder is made when the library is created, and again before each update
  of it. That is a container of the app's own image, with the app's own settings from
  `compose.yaml` and `compose.override.yaml`, running `mkdir` as the stack's `user:` to
  make the folder inside the data folder, where the app mounts it. It is removed when
  `mkdir` exits. It uses the Docker API calls that the ownership helper
  and Mediaplane's own join of the wiring network already make, so the proxy allows
  nothing new for it. T5 says what its environment holds.
- **The first-run setup.** An app whose setup anyone who reaches it could finish starts
  with no published port: Jellyfin, whose startup wizard is open; Plex, until it is
  claimed; and Seerr, before its first sign-in. `apply` gives Compose one more file, on
  its standard input, that takes every port off them, those of `compose.override.yaml`
  too. Mediaplane finishes Jellyfin's wizard over the wiring network, as the shared
  admin, makes Jellyfin's key and keeps it; then it signs Seerr in through Jellyfin, as
  that admin, and signs out again. On a Plex stack, Plex's first start gets a claim token
  of your plex.tv account in `PLEX_CLAIM`, which that same file passes; Mediaplane waits
  until Plex has claimed itself, and asks plex.tv whether it is yours. Then it signs
  Seerr in with your Plex token, and signs out again. Only then does it start them again
  with their ports published (see T16). That uses the Docker API calls an `apply` that
  recreates an app already makes, so the proxy allows nothing new for it. `plan` never
  runs it, and never calls plex.tv.
- **The wiring.** `plan` and `apply` call the apps' APIs over the wiring network: from
  the Mediaplane container, or run from source, from the host. Each request goes
  straight to the app's container, through an HTTP agent of Mediaplane's own, so a proxy
  in the environment (`NODE_USE_ENV_PROXY`) never sees a key. It carries the app's key in
  a header (`X-Api-Key`, a Bearer token for qBittorrent, Jellyfin's
  `Authorization: MediaBrowser Token="…"`, or your Plex token in Plex's
  `X-Plex-Token`), never in the URL. Mediaplane signs in to
  qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin with the shared login, to check it;
  Jellyfin's sign-in is signed out of again, and its activity log records both, as it
  records any sign-in. It signs in to Seerr only once, for its first sign-in, and signs
  out at once: Seerr's own key works after that.
  `plan` checks a download client with the arr's own test, which would make in
  qBittorrent each category the client names that qBittorrent lacks: its own, or a
  post-import one you set in the arr (`tvImportedCategory`, `movieImportedCategory`). So
  `plan` asks qBittorrent first, and leaves the key unchecked while one is missing, or
  qBittorrent can't be asked; a category you kept is made by `apply` first, and one you
  no longer have Mediaplane manage is yours to make (see the
  [drift reported runbook](../runbooks/drift-reported.md)). It checks Prowlarr's links
  with Prowlarr's own test, which calls the arr
  with its key, and has the arr call Prowlarr back, and an arr's connection to Jellyfin
  with the arr's own test, which calls Jellyfin with its key. Each of those tests, when it
  fails, records a failure in that app's status of the client, link or connection, as a
  test from the app's web UI does; a later pass resets it. It checks Seerr's Sonarr and
  Radarr servers with Seerr's own test, and the key Seerr holds for Jellyfin with
  Seerr's list of Jellyfin's users. Those leave nothing in Seerr's settings, but each one
  that fails logs a line in Seerr's log, and a test with a key the arr refuses logs one
  in the arr's, as a test from Seerr's web UI does. It checks an arr's connection to Plex
  with the arr's own test, which calls Plex with your token: the first such test lists
  the arr among the devices of your Plex (Settings, Authorized Devices), as one from the
  arr's web UI does.
- **Drift and Keep mine.** `mediaplane drift` asks the apps what `plan` asks them, and
  changes nothing in them: its checks leave the marks above, fewer. A secret it found
  refused isn't checked again, by drift or `plan`, until `apply` sets it, nor is what
  only its app can say asked of that resource meanwhile (Seerr's test of an arr), so a
  key or password that changed costs one failed check, not one per run (qBittorrent
  bans an address after five); Jellyfin's admin password is checked once a day at most,
  while it passes. An app that refuses its own key isn't sent it again, by drift or
  `plan`, until `apply` checks it, nor are the secrets of what holds that key checked.
  Drift keeps what it found of each secret in `state/resources.json`: its name, `passed`
  or `refused`, and when; and each app found refusing its own key, by the key's name.
  It reads Prowlarr's own health check of its indexer proxy, and never tests the proxy.
  `mediaplane keep` checks that the app takes Mediaplane's key and reads the one
  resource it keeps, checking none of its secrets and running no test of the app's, and
  writes `stack.yaml`: one line under `overrides:`, the rest as it was, its mode and
  group kept (not an ACL), never a secret. It then records the value as applied in
  `state/resources.json`. It reads `stack.yaml` once, through one handle that doesn't
  follow a link, replaces only that file, and refuses one that is a link, not a regular
  file, has other names, belongs to another user or to a group its user isn't in, is
  written as one `{ … }` block, can't be parsed, is managed by automation (checked
  again in the file it writes), or that it fails to write, giving the line to add by
  hand. It never writes a value with a control character, a line or paragraph
  separator, or a bidirectional control, which an editor could show as what the file
  doesn't hold, nor one its field's rule refuses (a category that would take
  qBittorrent's downloads out of `/data/torrents`). Like `plan`, both join the wiring
  network in the image, and both run under apply's lock (`state/lock`), so none of the
  three runs while another does.
- **The Cloudflare solver.** Byparr, or FlareSolverr, runs a browser for Prowlarr on the
  stack's own network. Its port is never published, it has no login, and it isn't on
  the wiring network. Prowlarr sends it an indexer's request only for an indexer tagged
  `cloudflare`, and only when the site answers with a Cloudflare challenge; when
  Mediaplane adds the proxy, Prowlarr has it fetch a page of Prowlarr's own service, to
  test it (see T15).
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
  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, Jellyfin or Plex,
    Seerr, and qBittorrent, through Gluetun with a VPN) are on the stack's wiring network
    too. It is internal: it gives them no way out, which they have on their own network.
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
  with its temporary password. It asks on localhost too. After that, `apply` keeps its
  login, and who may skip it, as `stack.yaml` says, through its API.
- Sonarr, Radarr and Prowlarr ask for the shared admin login, which `apply` sets through
  their API once they first start. They ask from the LAN too, by default
  (`security.login_on_lan`).
- When the stack runs through `apply`, Jellyfin publishes no port while its startup
  wizard is open: Mediaplane finishes it as the shared admin first (T16 says what voids
  that). Jellyfin asks for a login from everywhere. So does Seerr, which publishes no
  port until Mediaplane has signed it in through Jellyfin, as that admin, or on a Plex
  stack, with your Plex token. Plex publishes no port until it is claimed for your
  plex.tv account, and then asks for a sign-in with a plex.tv account it knows from
  everywhere. Mediaplane sets nothing that may skip it, and before Plex's first publish
  it checks the settings that could: Plex's "List of IP addresses and networks that are
  allowed without auth" (`allowedNetworks`) empty, as by default, `enableLocalSecurity`
  at `-1`, its default, or `1`, and DLNA off (T16). What you change in Plex afterwards
  is yours: a network you allow later voids this for that network.
- With `login_on_lan: false`, qBittorrent lets only your LAN subnet skip its login, and
  only while the web UIs are on the LAN. That subnet is `network.lan_subnet`, or else the
  subnets of the host's private addresses. Sonarr, Radarr and Prowlarr let any local
  address in (see What remains), and take only the Host names Mediaplane lists: their
  own name, and the addresses their web UI is published on. That stops a web page from
  reaching them through a name it controls (DNS rebinding). `network.lan_subnet` must be
  private (RFC 1918): a public range, or `0.0.0.0/0`, is refused.

What remains:

- On a home network, `init` suggests `bind: lan`, which puts the web UIs on your LAN.
- Mediaplane leaves Plex's remote access as Plex sets it: off, so Plex asks plex.tv for
  no port on your router. Plex's relay is on by default: through it, plex.tv lets the
  accounts that may use your Plex (yours, and those you share it with) reach it from
  outside when nothing else can. Turn it off in Plex (Settings, Network, "Enable Relay")
  if you don't want that.
- With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
  Prowlarr without a login. For them, "local" means any private address, not just your
  LAN subnet.
- Between an app's first start and the wiring step a moment later, Sonarr, Radarr and
  Prowlarr have no user: with `login_on_lan: true` nobody can sign in, and with `false`
  a local address gets in anyway.
- With `login_on_lan: false` and the web UIs published on the LAN, an address inside the
  subnet that skips qBittorrent's login can sign in with any password. So a
  `network.lan_subnet` that also covers a Docker
  network of the stack, such as a hand-typed `172.16.0.0/12`, which covers Docker's
  `172.17` to `172.31` networks, lets every container on those networks skip
  qBittorrent's login. It also hides from `plan` a password changed by hand in
  qBittorrent, since `plan` signs in from the wiring network. Set `network.lan_subnet` to
  your LAN itself, not a wider range.

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
- Mediaplane reads an app's key from its appdata when `state/secrets.json` lacks it, and
  to compare it with the stored one (a key to put back, or one `keep` is asked for). It
  never reads through a link, nor a file that leads out of the app's folder, nor one
  larger than 1 MiB: a compromised app could otherwise plant a link to another app's
  file, and have Mediaplane take that app's key as its own, and send it there. A key
  that is another app's is refused as the app's own. A key put back in an app's file is
  written only there, never through a link, nor over a file with other names, or of
  another user or group.
- Jellyfin's database is opened by Mediaplane, checked, and given to SQLite open, read
  only; never with a link in place of its write-ahead log or index (`-wal`, `-shm`),
  through which SQLite could write.

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
- A compromised Jellyfin can still make `plan`, `drift` or `keep` wait while they read
  its database's key, with a named pipe put at the database's own name in the instant
  between SQLite looking up the file Mediaplane holds open and opening it by that name:
  SQLite's open waits on a pipe (probed).
  - The read runs in a process of its own (Slice 10b): Node with an empty environment,
    the database handed to it open. Mediaplane stops it after 10 seconds. The read is
    then a key file that couldn't be read, never a key.
  - So is a process that fails to start, or answers with more than 64 KiB (counted in
    bytes). The read never throws.
  - A pipe put in place of its write-ahead log (`-wal`) after Mediaplane checked it makes
    SQLite refuse the read (`disk I/O error`, probed).

  It is never a read or a write through the pipe. Another file put at the database's
  name in that instant can be read instead, unless Mediaplane's check once the read has
  answered sees it, and then what was read is dropped; and a folder on the way swapped
  for a link and back as quickly can do the same. Such a read is bounded by the fixed
  `ApiKeys` query, and a key that is another app's is refused. Nothing is written either
  way. A file swapped in at the database's path at any other time is never what SQLite
  opens.

- Sonarr and Radarr hold qBittorrent's key, as their download client needs, so a
  compromised one can drive qBittorrent: add a torrent, or change its settings.
- Prowlarr holds Sonarr's and Radarr's keys, as its links need, so a compromised Prowlarr
  can drive both: change their settings, or read their password hash (see T10).
- Sonarr and Radarr hold Jellyfin's key, as their connection to it needs. A key is
  Jellyfin's admin, so a compromised arr can drive Jellyfin: change its settings, users
  and libraries.
- Seerr holds Sonarr's and Radarr's keys, and a key of Jellyfin's, as its links need,
  and shows them in clear to whoever holds its key or signs in as its admin. So a
  compromised Seerr can drive Sonarr, Radarr and Jellyfin, and so can whoever has
  Seerr's key or the shared admin login.
- On a Plex stack, Sonarr and Radarr hold your Plex token, as their connection to Plex
  needs, and Seerr holds it as its admin's, from its first sign-in. Plex's own token is
  in its appdata. Each opens your plex.tv account: a compromised arr, Seerr or Plex can
  reach every Plex your account reaches, those outside this stack too, and change your
  account. Use a plex.tv account of its own for the stack if that matters to you, and
  share your other servers with it as you need.
- A link Mediaplane made in Prowlarr, which holds an arr's key, is removed by the next
  `apply` once its arr leaves the stack, as is each server of Seerr's and each download
  client or connection an arr holds for an app that left (Slice 10b): only one its
  record says it made, held as it made it. One renamed in its app stays, as it may be
  yours, and keeps the key until you remove it; `mediaplane drift` reports it.
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
  So is every key Mediaplane reads in clear in an app's answer, from the moment it
  reads it: the keys Jellyfin lists, the key Seerr made itself in Jellyfin, and the
  arrs' keys that Seerr shows for its servers, one typed in Seerr by hand too.
  That holds for each form an app may echo a secret in: as it is, JSON-escaped,
  percent-encoded, form-encoded or HTML-escaped, and nested, such as a password
  JSON-escaped inside a form field (as qBittorrent's settings send it), or a JSON body
  quoted in an HTML page.
- qBittorrent's key goes to Sonarr and Radarr in their download client's settings,
  Sonarr's and Radarr's keys go to Prowlarr in its links' settings, and Jellyfin's key
  goes to Sonarr and Radarr in their connection's: request bodies, the only places one
  app's key goes to another. They show it masked (`********`) afterwards, and Mediaplane
  tests the masked client, link or connection, so the key isn't sent again for the
  check.
- Jellyfin's key is the one Jellyfin makes: Mediaplane reads it once from Jellyfin's list
  of keys, which shows them in full, and keeps it in `state/secrets.json` at once. The
  session it signs in for that is signed out of right after. The admin password goes to
  Jellyfin only in request bodies: its startup wizard, its sign-in, and a change of its
  password, sent with its key.
- Seerr's key is generated, and reaches Seerr in its environment (`API_KEY`), which it
  takes at every start; Seerr also writes it into its `settings.json`. Sonarr's and
  Radarr's keys go to Seerr in its servers' settings, request bodies again. Seerr shows
  them in clear afterwards: Mediaplane reads them back only to hand them to Seerr's own
  test of the server it holds, at the stack's address for the arr, and never compares,
  keeps or shows them. The key Seerr made itself in Jellyfin as it first signed in, which
  it also shows in clear, is replaced the first time Mediaplane records Seerr's link to
  Jellyfin: Mediaplane gives Seerr the Jellyfin key it holds itself, in a request body,
  as it gives the arrs. It then removes from Jellyfin the key Seerr held, but only one
  Jellyfin lists under the name Seerr gives its own (Slice 10b). So no second admin key
  of Jellyfin's lingers, unless its removal fails, which `apply` reports. Then remove it
  in Jellyfin's dashboard (API Keys). The one Seerr held is never kept, nor sent anywhere
  but in that removal to Jellyfin. It is replaced with `***` in every message once read.
  When Jellyfin refuses the key Seerr holds, or Jellyfin moves, Mediaplane gives it its
  own again.
- The admin password goes to Seerr only once, in its first sign-in's request body,
  which Seerr passes to Jellyfin to check. The session cookie it answers with stays in
  Mediaplane's memory, kept out of every message, for the one call that signs out at
  once. Mediaplane never signs in to a Seerr that is set up already: it would pass the
  password to whatever Jellyfin it was set up with.
- Mediaplane sends an arr's key, Jellyfin's key and Seerr's own key only to the stack's
  own address for that app, with no URL base, never to a host, port or URL base read
  from Seerr: anyone with Seerr's admin can change those, and would receive the key
  (Seerr adds the URL base after the port, so `@<host>` there is another host).
- The admin password goes to qBittorrent only in request bodies: its preferences, sent
  with its key, and the sign-in that checks it. The session cookie qBittorrent answers
  with is dropped. Its preferences hold its own key too: Mediaplane keeps only the
  fields it manages, and never shows them.
- The folders a root folder or a library needs are made with a command that holds only
  their paths. For Sonarr and Radarr, the throwaway container that runs it has the arr's
  own environment, its API key among it, which `docker inspect` shows while it runs, as
  it does for the arr's own container. Jellyfin's environment holds no key.
- Given to Compose in its environment or in the 0600 `generated/.env`, never on its
  command line.
- Your Plex token goes to Plex only in its `X-Plex-Token` header, over the wiring network,
  and to Sonarr, Radarr and Seerr only in request bodies: the arrs' Plex connections,
  which show it masked (`********`) afterwards and are tested masked, and Seerr's first
  sign-in, whose session cookie stays in Mediaplane's memory for the two calls that ask
  whose the session is and sign out. It goes to plex.tv itself only through the plex.tv
  helper's standard input, or from source, in the header plex.tv asks for. Mediaplane
  sends it only to the stack's own address for Plex, never to a host read from an app, and
  only once plex.tv says Plex is yours: Plex's setup asks Plex whether it is claimed
  without it. Of the secrets you give, only an app's key (your Plex token) reaches a setup
  or a resource; the others, such as the VPN key, are only redacted.
  `mediaplane plex-login`, or `init` when you say yes to its sign-in, which runs the
  same code, writes it to `plex.token`'s file, 0600, inside a 0700
  `secrets/`, never half-written, and prints only a link to sign in with, never the token.
- A claim token is fetched with your token by the `apply` that first starts Plex, the
  moment before. It goes to Compose through its environment, which the extra file on
  Compose's standard input names (`PLEX_CLAIM: "${…}"`), so it is in no file. Plex's
  first container holds it in its environment, which `docker inspect` shows, while it is
  unpublished: the image trades it at plex.tv within seconds, and a claim token works
  once, for four minutes. The container that publishes Plex is made without it, which the
  nightly end-to-end test checks. It is fetched before the start step changes anything:
  without one, the step fails, and stops every app that runs and isn't yet shown to be
  yours, Plex, and Seerr.
- A Plex signed out of your account while it ran is unclaimed, and stays published until
  the next `apply`: anyone who reaches it can claim it. `plan` and `drift` warn
  (`bootstrap.open-published`). Its image never claims it again with a claim token (its
  Preferences.xml keeps an empty `PlexOnlineToken`, probed), so the setup does, while
  Plex is unpublished: a second claim token, fetched by the setup with your token, sent
  to Plex in the query of `POST /myplex/claim` over the wiring network, replaced with
  `***` in every message, and never kept (Slice 10b). A reclaim still starts Plex once,
  unpublished, with a claim token its image ignores (it takes Plex for claimed); that
  token expires within 4 minutes.
- Plex's own token, which its claim makes, is in Plex's `Preferences.xml`, which Plex
  writes 0600. Mediaplane reads it there only to ask plex.tv whose account it is, once
  Plex is claimed, through the plex.tv helper's standard input (from source, in the
  header plex.tv asks for), and keeps nothing of it.
- Every value that comes from plex.tv, and your Plex token, is replaced with `***` in
  errors, and kept out of change records, `state/resources.json` and `plan`'s output.
- `drift` and `plan` show a managed field's values, what was applied and what the app
  holds, never a secret's: a value an app holds that contains one of the run's secrets is
  shown with `***`, and marked so. So are a check's reason and a change's, which can name
  what an app holds; all of it is redacted once, at the end of the run, with every secret
  the run came to know, a key read in a later app's answer too. `mediaplane keep` refuses
  to keep such a value, or a secret, so `stack.yaml` never holds one (ADR 0009). What
  drift keeps of a secret in `state/resources.json` is its name, a verdict and a time.
- Gluetun's control key reaches vpn-check's probe on its standard input, and the probe
  hands it to curl the same way. It is never on a command line, which every user on the
  host can list, nor in the container's settings, and it is replaced with `***` in what
  the probe prints.
- The files apps read at their first start are written 0600, never half-written, and
  never over an existing file. `plan` lists them without their content, and change
  records hold only their paths.
- `appdata/` holds credentials too: the apps' keys, qBittorrent's password hash, and
  Seerr's `settings.json`, with Sonarr's, Radarr's and a Jellyfin key in clear.
  The apps rewrite their own files readable by every user on the host (0644), so
  Mediaplane keeps `appdata/` itself private (0700), as it does `state/`.
- Key recovery reads those keys back after a lost `state/`, Jellyfin's from its database,
  opened read-only. A key read so is a secret of the run from then on: kept out of every
  message, record and output, as the store's are.

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

- Every image is pinned by digest: the apps, the proxy, Node and the Docker CLI in
  Mediaplane's image, and the images CI and the tests run. A test fails when a pinned
  image is written where Renovate doesn't look.
- npm packages come from the lockfile, and GitHub Actions are pinned by commit, with
  their version beside it. A test checks each.
- Once the Renovate app is installed (an owner's step), Renovate opens a pull request
  for every newer pin: an app's runs the full end-to-end suite, and none is merged
  automatically.
- CI's checks, which fail the build (but for the catalog image scan, which reports), on
  every pull request and weekly:
  - Trivy scans Mediaplane's image on amd64 and arm64, built as a release builds it:
    its Alpine packages, the Docker CLI's Go standard library and Compose's Go modules.
    It fails on a critical vulnerability that has a fix.
  - Trivy scans every catalog image, on both architectures. Only upstream can fix a
    finding there, so since the owner's decision of 2026-10-27 CI reports it (a warning
    and the step summary) and does not fail. A scan that couldn't run still fails. To fail
    on a finding again, change `CATALOG_SCAN: report` to `CATALOG_SCAN: fail` on the
    `catalog-images` job in `.github/workflows/ci.yml`. A finding that
    `scripts/ci/catalog-ignore.yaml` lists, with the app it is in, is hidden until the
    date beside it; after that date it is reported again (or fails, in `fail` mode).
    Each image is scanned with only the entries whose statement names its app (the text
    after the statement's first " in " holds a catalog app's name), so an entry hides
    nothing in another app. One that names no catalog app hides nothing, and a unit
    test fails on it.
  - Node's own security releases: a check fails while Node has published one for the
    image's line that the image lacks. Neither scan sees Node, a binary in the base.
  - `pnpm audit` checks the CLI's production npm dependencies, which are bundled into one
    file where Trivy can't see them, and fails on a critical advisory.
  - actionlint and shellcheck check the workflows and the shell scripts.
- gitleaks scans the full history on every push to `main` and every pull request.
- From the first release, each image is published with an SBOM and build provenance,
  and a signed attestation of its provenance; the release's deploy files name it by
  digest, and they and `SHA256SUMS` are attested too. A release publishes its image and
  deploy files only for a commit CI passed.

What remains:

- The scans see known vulnerabilities only, and the catalog's listed findings run until
  upstream ships a fix and Renovate's bump of the pin is merged.
- The audit and the Node check need the npm registry and nodejs.org at CI time.
- If the owner adds one, a Docker Hub access token with the permission "Public Repo
  Read-only", in the repository's secrets, reaches every job that pulls images on the
  repository's own branches. It can read public images only. A revoked or wrong token
  fails those jobs; nothing falls back to anonymous pulls, and removing the secrets goes
  back to them.

### T18. The release workflow publishes something it shouldn't

Controls today:

- Only merging release-please's pull request cuts a release. Every other push to `main`,
  every pull request, and every fork publishes nothing.
- Each job's token may do only what that job does ([Releasing](../releasing.md) lists
  them). The one job that installs npm packages has a read-only token and no secret.
- No workflow runs a pull request's code with secrets: there is no `pull_request_target`,
  and no secret reaches a script but through its environment.
- A release publishes its image and deploy files only for a commit whose CI passed. CI
  runs for every commit on `main`, so the release's commit has a run of its own. Each job
  that checks out the tag, the one that waits for CI first, checks that it is that
  commit. The image pushed is the one Trivy scanned, checked by digest.

What remains:

- Whoever can push to `main`, or merge the release pull request, can publish a release.
  Protecting `main` (an owner's step) narrows that.
- `scripts/release/ci-passed.sh` accepts any GitHub Actions run of "All checks passed"
  on the release's commit: a pull request's run on the same tree too, whose `changes`
  job chose which jobs ran from the pull request's diff. It doesn't wait for the run on
  `main`.
- The tag and the release page exist from the merge, before CI has passed: release-please
  makes them. If CI then fails on that commit, nothing else is published, and the page
  stays without files until it is deleted (`docs/releasing.md` gives the command).
- `RELEASE_PLEASE_TOKEN`, when set, is a token of the owner's that may write this
  repository's contents, issues and pull requests: the release-please job has it, and no
  other.

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
- A password of your own (`admin.password`) takes 6 characters or more, and 12 or more
  is advised. From 6 to 11 is allowed, with a warning from `plan` and a "Use it anyway?"
  from `init`: the owner's choice for a stack that is reached only from the home network,
  decided 2026-10-26. An app's web page is reachable from wherever its port is published,
  so a short password is weak the moment a port is forwarded or `network.bind` is `lan`
  on a network that is not yours alone. Below 6 is an error, for every stack. That is
  qBittorrent's own minimum, so no app in the catalog takes fewer than Mediaplane does.
- `mediaplane credentials` shows a generated password. It shows your own only with
  `--reveal`, and its `--json` output leaves either out unless you add `--reveal`.
  `plan`, `apply`, errors and change records never show it.
- qBittorrent keeps only a hash of it: PBKDF2-HMAC-SHA512, 100 000 rounds, with a
  random salt.

What remains:

- One password opens every app that uses it: qBittorrent, Sonarr, Radarr, Prowlarr and
  Jellyfin, and Seerr, which asks Jellyfin. A leak from one is a leak for all.
- `plan` and `apply` check Jellyfin's password by signing in. Jellyfin doesn't lock its
  admin out after failed sign-ins (none after seven in a row, on Jellyfin 12.2), but its
  activity log records each one, right or wrong, so a `plan` adds three lines there.
- Sonarr, Radarr and Prowlarr give their password hash to anyone who holds their API
  key. Prowlarr holds Sonarr's and Radarr's keys, for its links.
- `apply` checks qBittorrent's password by signing in. qBittorrent bans an address from
  signing in for an hour after five failed sign-ins in a row. Mediaplane's sign-in fails
  only while qBittorrent's password differs from the stack's, such as after
  `admin.password` changed, once per `plan` and once per `apply`: Mediaplane doesn't send
  that sign-in again once it may have reached qBittorrent, such as after a timeout. So
  four `plan`s, or declined `apply`s, before the `apply` ban Mediaplane's address, never
  your browser's. Its key still works. The [runbook](../runbooks/wiring-failed.md) says
  what to do.
- `mediaplane apply --rotate admin.password` gives every app a new generated password,
  through each app's key. A password of your own is rotated in its file.
- A new Plex token, from `plex-login --force`, reaches the apps that hold the old one
  with `mediaplane apply --rotate plex.token`: the arrs' connections to Plex, and Seerr,
  which signs in again with it, once your account is shown to be Seerr's admin
  (Slice 10b). Only then can you sign the old one out at plex.tv without breaking them.
  A token of another account, which Plex refuses, is given to no app.

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

- vpn-check runs only when you run it, or `apply` does. Alerts may come in M2.
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
  To join, it reads the network first, strictly: it must be internal, a bridge, and
  carry this project's Compose labels for `wiring`. It then joins by the ID it read. To
  leave, it reads the network and takes Mediaplane off by that ID; leaving has no
  refusal of its own.
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
- The plex.tv helper has a route out, as any container on Docker's default bridge does,
  while it runs: seconds for a call, as long as the sign-in's wait for `plex-login`. From
  that bridge it can also reach the host's published ports, your LAN, and any other
  container on the default bridge. That is harmless while its code is Mediaplane's own,
  in Mediaplane's own image, and it calls only plex.tv's fixed address, which no request
  can change; a changed image or a compromised Mediaplane voids it (as T1 and T7 say). It
  has no network of the stack's
  ([ADR 0012](../adr/0012-reach-plex-tv-through-a-short-lived-helper.md)). Its answer
  can hold a token (`plex-login`'s, or a claim token), which `docker logs` shows while it
  runs, to whoever has Docker access.
- Like any Docker network, the wiring network reaches the host at its gateway address,
  where the host's own services listen.
- "Offline" means no route of its own. Mediaplane holds the apps' keys, and the apps on
  the wiring network can fetch for it: qBittorrent's add-by-URL, the test
  endpoints of Sonarr, Radarr and Prowlarr, and Gluetun's HTTP proxy or Shadowsocks, if
  `apps.gluetun.env` turns them on (they listen on every Gluetun interface).
- Docker answers a name from every network a container is on. Only your
  `compose.override.yaml` could put a container called `socket-proxy` on the wiring
  network; it would then compete with the proxy for that name.

### T15. The Cloudflare solver fetches for whoever asks

Controls today:

- Byparr's or FlareSolverr's port is never published, and they are on the stack's own
  network only, not the wiring network.
- Prowlarr sends a request through the solver only for an indexer you tagged
  `cloudflare`, and only when the site answers with a Cloudflare challenge.
- Mediaplane never calls the solver. Prowlarr tests the proxy when Mediaplane adds it,
  by having the solver fetch `https://prowlarr.servarr.com/v1/ping`; `plan` runs no such
  test.

What remains:

- The solver has no login: any container on the stack's network can have its browser
  load any address, your LAN included. qBittorrent behind the VPN reaches the stack's
  network too, so a compromised qBittorrent could load a page through the solver,
  outside the tunnel.
- An indexer's request goes to the solver whole, with the indexer's own API key in its
  address, and Byparr logs the addresses it fetches. Treat the solver's log like the
  indexer's key.
- The solver needs the internet: Byparr's health check loads a web page, and Prowlarr's
  test fetches one from Prowlarr's service.

### T16. Someone else finishes an app's first-run setup

Controls today:

- When the stack runs through `apply`, Jellyfin's startup wizard is not published while it
  is open. `apply` starts Jellyfin with no published port, its override's ports included,
  finishes the wizard over the wiring network, and only then publishes it. What voids
  this is under "What remains".
- The same holds for Seerr, on a Jellyfin stack: until its first sign-in, anyone who
  reaches it can sign in through a Jellyfin of their own and be its admin, as Seerr 3.5
  does. `apply` starts it unpublished and, once Jellyfin is set up, signs it in through
  Jellyfin as the shared admin, which makes that its admin and Jellyfin its media
  server; only then does it publish Seerr. Seerr's key is Mediaplane's own, so no key
  tells whose setup it is. Seerr counts as set up only when its `settings.json` says so
  and Mediaplane's record does: `setUp` in `state/secrets.json`, a list of app names.
  The record is made only by a setup that succeeds, or that shows Seerr is Mediaplane's.
  It is dropped as soon as a pending setup runs, and made again only by a success.
  A file Mediaplane can't read has Seerr start unpublished, and set up again, on every
  `apply`, and each such `apply` fails at verify (exit 1), until the file is readable.
- A Seerr that is set up when Mediaplane comes to it is checked with Seerr's key, and
  never by sending the password, which Seerr would pass to its Jellyfin. That covers a
  Seerr set up before this slice, or by hand, with no record; one whose file didn't say
  it was set up when `apply` started it; and one someone signed in to in the moment
  before Mediaplane's sign-in. It is Mediaplane's only when its admin (its first user)
  is the Jellyfin login `admin.username` names and its Jellyfin is `jellyfin:8096`,
  with no URL base and no TLS: Seerr adds its URL base after the port, so one such as
  `@198.51.100.7` takes it to another host, where anyone can make a user named as the
  shared admin. A pass is recorded. Any other, and one whose check failed in any way,
  stays unpublished, on every `apply` until Mediaplane can show that it is its own.
- A setup that makes no key (Seerr's, Plex's) that fails in any way never publishes its
  app, however set up the app then looks. One that waits (Jellyfin refuses the shared
  admin's password, say) is asked once more: if someone else finished it meanwhile, it
  fails as a claimed setup, and the app stays unpublished.
- Before an app starts, Mediaplane reads its appdata (Jellyfin's `system.xml`) to see
  whether its setup is done. A Jellyfin whose appdata was emptied starts its wizard
  again: it starts unpublished again, even with its key stored.
- Mediaplane signs in as the shared admin before it completes the wizard. If the first
  user isn't one the shared admin can sign in as, someone else set it, and Mediaplane
  leaves the wizard open, Jellyfin unpublished, and stops with what it found.
- If the wizard was open when `apply` started Jellyfin, and the shared admin's sign-in
  is then refused, someone else finished the wizard while Mediaplane set it up.
  Jellyfin stays unpublished, whatever it now says of its wizard, and `apply` stops
  with an error that says so.
- Before it publishes an app, Mediaplane asks the app once more whether its setup is
  still open. It publishes the app only if it is not. If the app still looks open, or
  can't be asked, the step fails and that app is not published. If `apply` started it
  published, the error says so, and to stop it.
- An app with a first-run setup can't run inside another app's network. That app would
  publish its ports, and Mediaplane could not hold them back, so `plan` fails with
  `bootstrap.network-via`. No app in the catalog does this today.
- An unclaimed Plex lets whoever reaches it at an address claim it for a plex.tv account
  of their own, with no sign-in (probed: Plex 1.43 answered `POST /myplex/claim` with
  200). So Plex starts unpublished until it is claimed, and is published only once
  plex.tv says the token Plex's claim gave it, in its `Preferences.xml`, is your
  account's. That is plex.tv's answer, not Plex's. Plex's admin can change what Plex says
  of itself, its machine identifier too (probed), so that can't decide; they can't give
  Plex a token of your account without one. A Plex claimed by another account stays
  unpublished, and `apply` stops. So does one plex.tv couldn't be asked about: only a
  401 from plex.tv is a refusal, and a 403, a 429, a 5xx, no answer, a plex.tv helper
  that fails or runs out of time, or Docker failing on the way counts as "couldn't
  tell". A helper answer Mediaplane doesn't understand is an error of its own, which
  refuses Plex (`rejected`). Either way, Plex stays unpublished. One that doesn't
  claim itself while `apply` waits for it (its claim token ran out, or it couldn't reach
  plex.tv) stays unpublished too.
- Plex's setup never holds your plex.tv token: it asks Plex whether it is claimed
  without it. The one call to Plex that carries it is the read of its settings, after
  plex.tv has said Plex is yours.
- When Mediaplane can't get a claim token at all (no token, plex.tv refusing it or not
  answering, the helper failing), the start step fails before it changes anything. It
  first stops every app that runs and isn't yet shown to be yours, Plex, and Seerr,
  published or not: a Plex that an `apply` before Slice 7 published unclaimed, say, or a
  Seerr set up by hand then. The error names each (or says that they couldn't be
  stopped, and to stop them yourself). Plex counts as set up only when its
  `Preferences.xml` holds a token (`PlexOnlineToken`) and Mediaplane's record names it.
- Before Plex's setup is done, so before Plex is first published, Mediaplane reads its
  settings and keeps it unpublished, with what to do, unless each of these is as Plex
  sets it, or stricter:
  - `allowedNetworks`, the networks let in without a sign-in: empty;
  - `enableLocalSecurity`: `-1`, Plex's default, or `1`. A probe of a claimed Plex at
    `-1` showed it refuses a client that hasn't signed in;
  - `DlnaEnabled`: off, since DLNA streams without a sign-in.

  Anyone who reached Plex while it was unclaimed could have set them, over
  `PUT /:/prefs` with no token, and they survive the claim (probed). The error names
  each setting, and the remedy: stop Plex, then in its `Preferences.xml` delete the
  attribute, or set its default as the file writes it (`allowedNetworks=""`,
  `enableLocalSecurity="-1"`, `DlnaEnabled="0"`), and run `apply`. They are checked
  only then, never on a later `apply`: a setting you change later, on purpose, is left
  alone, and voids this for what it opens.

- On a Plex stack, Seerr signs in with your Plex token, which makes your plex.tv account
  its admin. A Seerr set up already is checked with its key, never by signing in, which
  would give your token to whoever set it up: it is Mediaplane's only when its admin's
  plex.tv account is the one plex.tv says your token is, and its Plex is unset or the
  stack's, with no TLS. Only your account's token signs in as your account, so Seerr's
  admin can't shape that either. Anything else stays unpublished.
- Seerr's first sign-in, through Jellyfin or with your Plex token alike, must be its
  admin's: Mediaplane asks Seerr whose the new session is, and only its first user
  passes. Anyone else means someone signed in between Mediaplane's look and its
  sign-in: Mediaplane signs out, and Seerr is treated as set up by someone else. It stays
  unpublished, and the error gives the safe ways out first.

What remains:

- While Plex is unclaimed, for the seconds its claim takes, any container of the stack
  can reach it on the stack's networks, and could claim it first, as for Jellyfin's
  wizard below. Mediaplane then finds it claimed by another account, and it stays
  unpublished. The runbook's ways out come first, and keep what Plex holds: run
  `mediaplane plex-login --force` and sign in as that account, if it is yours (without
  `--force`, `plex-login` keeps a saved token that plex.tv still takes), or take Plex's
  `PlexOnline` settings out of its `Preferences.xml` so the next `apply` claims it
  again.
- In those seconds, such a container could also change Plex's settings without claiming
  it, through `PUT /:/prefs`, and they survive the claim. Mediaplane checks the three
  known to let a client in without a sign-in (above). Others, such as remote access,
  give no access without a sign-in, and are not checked: look over Plex's Network
  settings after the first `apply`.
- A Plex whose `Preferences.xml` keeps its token is taken as set up while Mediaplane's
  record names it, and starts published. One whose token was removed by hand is claimed
  again by the next `apply`, unpublished; run outside `apply`, it starts published and
  unclaimed.
- While the wizard is open, for the seconds Mediaplane takes, any container of the stack
  can reach Jellyfin on the stack's networks, and Seerr likewise until its first sign-in.
  A Seerr whose setup waits (Jellyfin refuses the shared admin's password) stays open
  there, unpublished, for longer: until the next `apply` that signs it in.
  A compromised app could claim either first.
  If it sets the first user and leaves the wizard open, Mediaplane's sign-in fails, and
  `apply` stops, completing no wizard for it. If it also completes the wizard, `apply`
  stops and keeps Jellyfin unpublished, but Jellyfin belongs to whoever finished it.
  Its wizard is then done, so the next `apply` would publish it: start Jellyfin afresh
  first, as the runbook says. When Mediaplane can't read Jellyfin's `system.xml`, the
  same refusal may come from a Jellyfin set up by hand, and the error says so instead,
  so that nobody starts afresh a Jellyfin they set up themselves. This needs a
  compromised container already inside the stack, which T4 and the other threats here
  already treat as serious.
- A Seerr claimed that way, before Mediaplane comes to it or between its look and its
  sign-in, has an admin that isn't the shared admin, or a Jellyfin that isn't the
  stack's, with no URL base and no TLS: it stays unpublished, and `apply` stops. One
  claimed through the stack's own Jellyfin, as its admin, needed the shared admin's
  password already.
- A Seerr set up by hand before Slice 6, as its README then advised, has no record. The
  first `apply` of this slice starts it unpublished and checks it once, with its key and
  never the password. It stays unpublished unless its admin (its first user) is the
  Jellyfin login `admin.username` names and its Jellyfin is `jellyfin:8096`, with no
  URL base and no TLS; otherwise `apply` stops, and the runbook has the ways out. Once
  it passes, it is recorded and published; the only cost is that one unpublished
  recreate.
- A wizard finished by hand before `apply` started Jellyfin (from before Slice 5, say)
  is done, so Jellyfin starts published, and nobody can claim it. If the shared admin
  can't sign in to it, `apply` stops, and Jellyfin stays published: it belongs to
  whoever finished its wizard. Mediaplane can't tell that from a wizard someone else
  finished before `apply` ran.
- An appdata Mediaplane can't read says nothing: with Jellyfin's key stored, Mediaplane
  takes the setup as done, and `plan` warns (`bootstrap.unreadable`) that it can't tell.
  Seerr has no key to decide: it starts unpublished and is set up again on every
  `apply`, which fails at verify. Fix the file's ownership, or the user Mediaplane runs
  as.
- `compose.override.yaml` can void the guarantee that Jellyfin, Plex and Seerr are set up
  before they are published. Mediaplane resets their `ports`, so ports the override adds
  to them are held back too. But `!reset` covers only `ports`. An override that gives
  either `network_mode: host`, or any network setting that publishes it through another
  service, publishes it while its setup is open. Keep such settings out of the override.
- Run outside Mediaplane (the ejectable command, or a restart of a published Jellyfin,
  Plex or Seerr whose appdata was emptied), the app starts published with its setup
  open: stop it before emptying its appdata, and set it up with `apply`.
- Seerr's appdata reset outside `apply`, and the app claimed on the LAN before the next
  `apply` runs: Mediaplane's record can't catch it. No key tells, since Seerr takes
  `API_KEY` at every start, so the next plan sees a done file and a record, and treats
  the claimed Seerr as its own. Inside `apply`, the record is dropped as soon as the
  file stops saying done. So stop Seerr before resetting its appdata.

### T17. A change made in an app by someone else is kept

Anyone with an app's admin login, or its key, can change what Mediaplane manages there:
point Sonarr's download client at another host, add a folder to a Jellyfin library, or
turn a library off in Seerr.

Controls today:

- `mediaplane drift` reports each change to a managed field, with what was applied and
  what the app holds, a resource deleted, and a secret the app refuses. `plan` shows the
  same, and `apply`, which asks first unless you pass `--yes` (its plan still shows the
  drift), puts each back.
- A change is never kept by itself: only `mediaplane keep`, run by you, makes it the
  stack's, one field at a time.
- Every field that says where an app sends a key is fixed, and can't be kept or
  overridden: the host, port and TLS of an arr's download client (a URL base held there
  reads as part of its host, so it is drift too) and of its connections to Jellyfin and
  Plex, the URLs of Prowlarr's links to the arrs (and its indexer
  proxy's, which your indexers' requests go through), and the host and port of Seerr's
  media server and of its Sonarr and Radarr servers. Drift still reports a change to
  one, and `apply` puts the stack's own address back.
- Every request that carries a key, Mediaplane's own and each test it has an app run
  with a key the app holds (an arr's test of its download client or connection,
  Prowlarr's of a link, Seerr's of a server), is built from the stack's own service
  address for the other app (`sendsTo`), never from a managed field an override could
  set, nor from what the app holds: a host, port, TLS or URL base changed in the app
  doesn't move where the key goes. Seerr's list of Jellyfin's users, which Seerr asks
  with the key it holds at the address it holds, is asked only while Seerr holds the
  stack's. Each catalog resource has a test of it. A key goes only to the stack's own
  address for an app (T5).
- While a managed field differs, `plan` checks none of the resource's secrets.
- What a resource is known by can't be kept: a root folder's path, a library's name and
  what it holds. Nor can what `stack.yaml` sets for every app: an app's admin user name,
  the shared login, and who may skip qBittorrent's login, a security setting. A kept
  download client's category must stay a folder in `/data/torrents`.
- `mediaplane keep` checks that the app takes Mediaplane's key and reads one resource;
  it checks no secret and runs no test of the app's, so it sends no key but Mediaplane's
  own, to the app's own address.

What remains:

- Keep only what you changed yourself. A kept value is what the app holds from then on:
  a category, a folder, a tag, a library left to you.
- An app's admin can still point the app itself somewhere else between two `apply`s:
  the app then uses the key it holds there, as it would without Mediaplane. Drift reports
  it, and only `apply` puts it back.
- Drift sees only what Mediaplane manages. A change to anything else in an app, its
  indexers, profiles or users, is yours, and never reported.
- Drift runs only when you run it, or `plan` or `apply` does. Running it on a schedule
  comes in M2.

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
