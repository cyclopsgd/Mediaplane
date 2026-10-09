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
label on the project's containers from `docker compose ps --all --no-trunc --format json`.

Guest services, which run in another service's network namespace
(`network_mode: service:<host>`, such as qBittorrent behind Gluetun), need one more step.
Before Compose computes a guest's label, it rewrites `service:<host>` to
`container:<the host's full container ID>`. `config --hash` doesn't do that rewrite, so
its hash for a guest never equals the label. `plan` therefore:

- recreates a guest when its host is created or recreated, or creates it when it doesn't
  exist yet: a new host container means a new network namespace, and Compose recreates
  the guest with it;
- otherwise (the host's container exists and stays), hashes a copy of the compose file
  with the guest's `network_mode` set to `container:<the host's full container ID>`, and
  compares that hash with the guest's label. This second `config --hash` call is made
  only when some guest needs it, and a failure is reported like the first call's.

That is why `ps` runs with `--no-trunc`: the rewrite needs the full 64-character ID, not
the 12-character short form.

## Consequences

- Plans match what `docker compose up` will actually do, including the effect of the
  user's override file and of changed secret values.
- `plan` needs a reachable Docker daemon. Without one it fails with an actionable
  `docker.unavailable` diagnostic rather than guessing.
- Verified on Docker 29.8 / Compose 5.5.1: a hash from stdin plus environment equals the
  label on a container created from the same files. An end-to-end test keeps this honest
  across Compose upgrades.
- A change of Compose version recreates containers once. Compose versions can hash the
  same `compose.yaml` differently: Compose 2.38 fills in each short-syntax bind volume
  with `create_host_path: true`, and Compose 5.5.1 leaves it out, so the hashes of every
  service with a bind mount differ. Every app except Byparr and FlareSolverr has one.
  - A `plan` from the version that didn't create the containers shows them as
    `recreate`.
  - The first `up` or `apply` with that version recreates them once, keeping the data in
    their bind mounts.
  - Two things change the version: ejecting with a host Compose that isn't the one in
    Mediaplane's image, and an image update that changes the Compose it bundles.
  - The deploy end-to-end test allows for the first. When the host's Compose differs
    from the image's, it checks that the same services end up running after the eject,
    not that nothing was recreated.
- Guest services depend on a Compose implementation detail (the `container:<ID>`
  rewrite). Verified on the same versions: with the host's full ID filled in, the hash
  equals the guest's label exactly; a second `up -d` changes nothing; and changing only
  the host makes Compose recreate the guest too. An end-to-end test covers this as well,
  so a Compose release that changes the rewrite fails the suite instead of producing
  wrong plans.
- The hash covers the image reference, not the image itself. Compose also recreates a
  container when the image behind its reference changes, for example after a pull moves
  a tag to a new digest. Catalog images are pinned by digest, so this doesn't arise for
  them. But a `version:` override that names a tag without a digest can make a plan
  under-predict: after a pull, `up` recreates containers that the plan showed as
  unchanged. This matters from Slice 2b, when `apply` pulls images.
