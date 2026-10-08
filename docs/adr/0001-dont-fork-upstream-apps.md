# 0001. Don't fork upstream apps

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Mediaplane exists to make a self-hosted media stack easy to set up and keep wired
together. Forking Sonarr, Radarr, Prowlarr, Jellyfin and the others would let us change
their behaviour. But it would also make us responsible for merging roughly ten
fast-moving codebases forever. Everything we need is reachable from outside the apps:

- pre-set API keys, through env vars and config files;
- connections between apps, through their REST APIs;
- read-back for drift detection, also through their APIs.

## Decision

Mediaplane deploys **unmodified upstream images**. It configures them only through
documented environment variables, the config files they read, and their REST APIs.

## Consequences

- Upstream fixes and security patches reach users as soon as a pinned version is bumped.
- Users can follow upstream documentation, because each app behaves as it does upstream.
- We are limited to what upstream exposes. For example, Jellyfin's API key cannot be
  chosen, so Mediaplane creates it after first-run setup.
- Upstream API changes can break the wiring. Tested-set pinning and the end-to-end tests
  on every version bump guard against that.
