# 0002. Compose-native control plane

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Mediaplane needs to create and update a set of containers. We considered three options:

1. Render a Docker Compose project and drive the `docker compose` CLI.
2. Call the Docker Engine API directly, the way Runtipi and CasaOS do.
3. Build on an existing tool's wiring code, such as LavX/arrstack or Configarr.

The project's principles include no lock-in, and the user keeps control through documented
override points.

## Decision

Mediaplane renders `stack.yaml` into a **plain Compose project** in `generated/`
(`compose.yaml` and `.env`) and applies it with the `docker compose` CLI. The user's own
`compose.override.yaml` is merged by Compose itself.

## Consequences

- **Ejectable.** The generated project runs with `docker compose up -d` without
  Mediaplane, and Portainer and other tools can manage it.
- **Container-level overrides are free.** They use Compose's own merge, with no custom
  override language.
- **Compose handles health-gated startup.** That includes
  `depends_on: service_healthy` and `network_mode: service:gluetun`, so Mediaplane doesn't
  reimplement it.
- **We depend on the Compose CLI's behaviour and output.** Only the runtime module (S2)
  talks to it, and the Compose version is pinned in the image.
- **Paths must be identical inside and outside the container.** The host's Docker daemon
  interprets bind-mount paths, so `MEDIAPLANE_HOME` must be mounted at the same absolute
  path in both places.
