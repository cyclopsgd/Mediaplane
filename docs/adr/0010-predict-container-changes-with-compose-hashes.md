# 0010. Predict container changes with Compose's own config hash

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

`plan` must say which containers `apply` will create, recreate, start or remove, without
changing anything. Compose decides whether to recreate a container by comparing a hash
of the service's resolved configuration with the `com.docker.compose.config-hash` label
on the running container. Re-implementing that hash ourselves would drift from Compose's
behaviour, which can change between releases.

## Decision

`plan` asks Compose for the hashes directly: it pipes the rendered, unwritten
`compose.yaml`, plus the user's `compose.override.yaml` if present, into
`docker compose -f - config --hash '*'`, passing secret values through the subprocess
environment so nothing is written to disk. It then compares each service's hash with the
label on the project's containers from `docker compose ps --all --format json`.

## Consequences

- Plans match what `docker compose up` will actually do, including the effect of the
  user's override file and of changed secret values.
- `plan` needs a reachable Docker daemon. Without one it fails with an actionable
  `docker.unavailable` diagnostic rather than guessing.
- Verified on Docker 29.8 / Compose 5.5.1: a hash from stdin plus environment equals the
  label on a container created from the same files. An end-to-end test keeps this honest
  across Compose upgrades.
