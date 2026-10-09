# 0006. Seerr as the requests app

- **Status:** Accepted
- **Date:** 2026-10-09. Decided in the M1 design (2026-10-08), and recorded here.

## Context

A media stack needs somewhere for people to ask for films and series, and those requests
must reach Sonarr and Radarr. Two principles shape the choice:

- **Jellyfin and Plex are equal choices** (spec §1.3).
- **Mediaplane never forks an app.** It sets each one up through its environment, its
  config files and its API (spec §1.4,
  [ADR 0001](0001-dont-fork-upstream-apps.md)).

So the requests app must work with either media server, and be configurable end to end
through its API.

## Decision

Seerr, version 3.5 or later, is M1's requests app (spec §2.1, §6.1, §6.5):

- **It works with both media servers.** The wiring (Slice 7) will sign in to it as the
  Jellyfin admin Mediaplane created (`POST /api/v1/auth/jellyfin`), or with the user's
  Plex token (`POST /api/v1/auth/plex`).
- **Its settings API covers the wiring:**
  - the media server, and its libraries;
  - Sonarr and Radarr, each with a default profile and root folder;
  - `POST /api/v1/settings/initialize`, which finishes setup.
- **Its API key can be chosen in advance,** through `API_KEY`. Mediaplane already
  generates it once and passes it in.
- **One Seerr instance, bound to `media_server`.**

## Consequences

- **One kind of media server per instance** (spec §6.1). The design treats switching
  `media_server` later as setting Seerr up again (spec §10).
- **Pinned, with a version floor.** Seerr's settings and library API changed by 3.5, so
  it stays pinned at 3.5 or later, and every bump runs the end-to-end suite.
- **The key does nothing until a first user exists.** So the wiring (Slice 7) starts
  with that first sign-in. Until then, Seerr's setup page is open to whoever reaches it
  first (see [Seerr's README](../../catalog/seerr/README.md)).
- **A fixed uid.** Seerr's image runs as uid 1000, so Mediaplane gives its appdata folder
  to 1000:1000 before it starts (Slice 2b).
- **One API quirk to respect.** Once the media server is configured, the wiring must
  never send its `hostname` again, because Seerr answers 500 (spec §6.1).
