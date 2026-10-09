# 0008. Docker socket proxy on by default

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Mediaplane drives Docker: it creates, recreates and removes the stack's containers, pulls
images, and runs short-lived helper containers. Whoever can do that controls the host,
because a container can be privileged or mount the host's root filesystem.

Mounting `/var/run/docker.sock` into the Mediaplane container would also give it every
other part of the Docker API:

- `exec` into any container on the host;
- reading any container's logs and files (through the proxy, both stay readable another
  way: see Consequences);
- building and pushing images;
- swarm, secrets, configs, plugins and system-wide settings.

M1 has no network listener. So the realistic way to misuse Mediaplane's Docker access is a
bug in Mediaplane itself, or in something it runs, such as Compose.

## Decision

- **Mediaplane never mounts the Docker socket.** It reaches Docker through a proxy
  container, `wollomatic/socket-proxy` pinned by digest, in Mediaplane's own Compose
  project, `mediaplane-system` (spec §4.4).
- **The proxy forwards only what the engine calls.** Its allow-list is a regular
  expression per HTTP method, matched against the request's path. It was written from the
  calls the engine was seen to make:
  - pings and the Docker version;
  - containers: list, inspect, create, start, stop, rename, attach, wait, kill and delete;
  - images: inspect and pull;
  - networks: list, inspect and create;
  - volumes: list.

  Kill is there because `docker run` passes a signal it receives on to its container as a
  kill. That is how a host helper that times out is stopped.

  It also allows volume create and inspect, which Compose calls when a
  `compose.override.yaml` adds a named volume, and network connect and disconnect, which
  Compose can call when an override adds a network.

  Everything else is refused with `403 Forbidden`, including:
  - `exec`, logs, file copy, export, commit, build and `/session`;
  - restart, update, pause and unpause;
  - pushing, tagging, loading and saving images, and image history;
  - deleting images, networks or volumes, and every prune;
  - `/info`, `/system`, `/events` and `/auth`;
  - swarm, services, secrets, configs, plugins and distribution.

  socket-proxy anchors each pattern, so a longer path, such as `/versionx`, doesn't
  match. Each segment of an image name must start with a letter or a digit, so a path
  can't climb out of `images/` with `..`, written plainly or as `%2e%2e`.

  `deploy/deploy.test.ts` pins the captured calls as allowed, and a list of others as
  refused. Refusing logs does not hide them, because `attach` can read them too (see
  Consequences).

- **Only the name `mediaplane` is let in.** The proxy listens on an internal network that
  it shares with the Mediaplane container alone, and publishes no port. It answers only
  the address that the name `mediaplane` resolves to on that network
  (`-allowfrom=mediaplane`).
- **The proxy is locked down too.** It runs:
  - from a one-layer image that holds only its binary and its health check, as `nobody`
    in the socket's group;
  - with a read-only root, no capabilities and `no-new-privileges`;
  - with a 64 MB memory limit, and a health check.

  The socket is mounted `:ro`. That costs nothing, but it restricts nothing either: a
  read-only bind of a socket still lets the holder send any request.

- **It can be turned off**, by giving Mediaplane the socket with an extra Compose file.
  Every `plan` and `apply` then warns (`docker.no-proxy`).
- **The code keeps its own limit.** The runtime refuses any Compose project except
  `mediaplane` and `mediaplane-<name>`, and never manages `mediaplane-system` (spec
  §7.2(2)). The one container created outside the managed project is the unnamed, `--rm`
  host helper, labelled `io.mediaplane.helper`.

## Consequences

- **This is defence in depth, not a boundary.** Creating containers stays allowed, and
  that alone can take over the host. The proxy narrows what a bug can reach by accident,
  and it logs every call it refuses. The threat model says so plainly.
- **The allow-list sees the method and the path, never the body or the query.** So:
  - `containers/create` takes any body. A privileged container, a bind of `/` or of the
    Docker socket, and `PidMode: host` all pass. A compromised Mediaplane is root on the
    host.
  - `attach` with `logs=1` returns a container's past output. Refusing `logs` does not
    keep any container's output from Mediaplane.
  - A container delete with `v=1` also removes that container's anonymous volumes.
  - `images/create` is the pull endpoint. With `fromSrc`, it imports an image from a URL
    that the Docker daemon fetches, with the host's network.
  - An allowed call works on every container on the host, not just the stack's. The
    runtime's project check is what keeps Mediaplane to its own project.
- **`-allowfrom` checks a name, not a container.** A container that joins the proxy's
  network with the alias `mediaplane` passes. Joining needs Docker access already, so
  this gives nothing to anyone who doesn't have it.
- **Overrides that need more of the API fail loudly.** Some overrides ask for more: a
  `post_start` hook (which uses `exec`), or a change that makes Compose delete a network
  or volume. The proxy refuses them with `Forbidden`, and logs each one. Widening the
  list means capturing the new call, adding it to the test, and recording it here.
- **Bind-mount filtering is available, but off.** socket-proxy can refuse bind mounts
  outside listed folders (`-allowbindmountfrom`). It is off by default, because the data
  folder is chosen in `stack.yaml` and an override may add mounts. The threat model shows
  how to turn it on.
- **There is one more pinned image to keep current, and one more setting:** `DOCKER_GID`,
  the group that owns the socket.
- **Rootful Docker only.** The deploy file expects the socket at `/var/run/docker.sock`.
