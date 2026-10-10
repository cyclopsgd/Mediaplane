# 0011. Reach the apps over a private wiring network

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Wiring means calling each app's HTTP API: Sonarr's, Radarr's and Prowlarr's from
Slice 3b, then qBittorrent's and the media servers'. Two places run those calls:

- **Mediaplane's container**, in `mediaplane-system`. Until Slice 3b its only network was
  internal, shared with the socket proxy alone, so it reached no app.
- **The CLI run from source**, on the host.

The container that can drive Docker should not also get a route out, nor share a
network with containers that have one. The owner chose how to reach the apps on
2026-10-10, from these options:

- **Join the stack's default network.** No new proxy call, but Mediaplane's container
  would get a route out, and every app could reach it.
- **A shared network declared `external` in both projects.** The stack would fail to
  start without `mediaplane-system`, so it would no longer run without Mediaplane (the
  "ejectable" success criterion in the [design](../design/m1-engine-cli.md)).
- **A helper container that runs the wiring.** Mediaplane's container never changes, but
  the whole engine would run behind a call into a container, with secrets passed in,
  and a container start for every `plan`.
- **A private wiring network** in the stack itself, with no route out.

## Decision

- **The stack's `compose.yaml` declares a network `wiring` with `internal: true`.**
  Compose names it `<project>_wiring` and creates it at `up`, like the default network.
  - Every app with an API in the catalog joins it, beside its default network, which
    still carries the app's own traffic, to the internet and to the other apps.
  - An app inside another app's network namespace is reached through that app, which
    joins for it: Gluetun, for qBittorrent. Gluetun counts every network it is on as
    local, so its firewall lets the wiring network reach qBittorrent's port, and its
    tunnel is unchanged.
  - Compose attaches the apps when it creates their containers. That needs no Docker
    API call the proxy didn't already allow.
- **Mediaplane's container joins it, and stays.** `plan` and `apply` join it when they
  need the apps, with `docker network connect`, which the proxy already allowed for an
  override's networks. Mediaplane finds its own container in `/proc/self/mountinfo`.
  Mediaplane's container is on two internal networks, and has no route out.
  - The runtime joins only its own project's wiring network. It reads the network first,
    strictly, and joins by the ID it read. It refuses the network unless it is internal,
    a plain bridge, and carries this project's Compose labels for `wiring`.
  - Leaving works the same way, and takes Mediaplane off that network only.
  - Mediaplane's container sets `net.ipv4.ip_forward: 0`, so it cannot route between the
    proxy's network and the wiring network. Only the IPv4 setting is made: neither network
    has IPv6, and the IPv6 setting stops a container starting on a host without IPv6.
- **Apply steps off before `up`, and back on after.** Compose can't recreate a network
  that another project's container is on. Through the proxy it can't delete one at all,
  so a wiring network whose settings change has to be removed by hand (see the
  [wiring failed runbook](../runbooks/wiring-failed.md)).
- **Run from source, nothing joins.** The host reaches every container on a bridge
  network at its address, internal ones too, as long as the bridge has an address on
  the host, which Docker gives it by default. The end-to-end tests check it on Docker
  29.8; CI confirms it on Docker 28 (the slice PR's first run).
- **The apps are reached at their container's address on the wiring network,** found
  with `docker container inspect`, from source and from the image alike. Each request
  carries `Host: <service>:<port>`, as the other apps' requests do, which Servarr's
  allowed hosts and qBittorrent's Host check accept.
- **The one change Mediaplane makes to `mediaplane-system`** is its own container's
  membership of this network. Spec §7.2(2) is refined to say so.

## Consequences

- **This is defence in depth, not a wall.** The proxy still lets Mediaplane create
  containers, with any network, so a compromised Mediaplane can still reach anything
  the host can ([ADR 0008](0008-docker-socket-proxy-on-by-default.md)). A later
  hardening could restrict what the proxy lets it create.
- **Mediaplane stays offline.** It needs no internet in M1 except plex.tv, in Slice 6,
  which a short-lived helper will reach for it. The apps' own internet traffic is
  unchanged.
- **The apps can reach Mediaplane's container on the wiring network.** It listens on
  nothing in M1. The socket proxy is on another network and answers only the address the
  name `mediaplane` has there.
- **Like any Docker network, the wiring network reaches the host** at its gateway
  address, where the host's own services listen.
- **`docker compose down` on the stack leaves the wiring network** while Mediaplane is on
  it ("Resource is still in use"). That holds after a plain `plan` too, because `plan`
  in the image joins the network. Bring `mediaplane-system` down first, or
  take Mediaplane off with `docker network disconnect <project>_wiring mediaplane`.
- **A Mediaplane update recreates its container,** which then is on the proxy's network
  only, until the next `plan` or `apply` joins the wiring network again.
- **The stack runs without Mediaplane as before.** The wiring network is part of
  `compose.yaml`, so the header's command still runs it without Mediaplane.
