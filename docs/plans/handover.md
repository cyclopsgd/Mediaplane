# Handover

Where the work stands, for a fresh session to start from. Updated on 2026-10-31.

## Where M1 ended

- **M1 is done, and released as 0.1.0 on 2026-10-30** (tag `v0.1.0`). Its 17 slices are
  in [the M1 roadmap](m1-roadmap.md), and each slice's plan is kept in [`m1/`](m1/).
- **Nothing is in flight.** No other branch or PR is open, and nothing is built for M2.
- **The release process** is in [releasing.md](../releasing.md). release-please opens
  the release PR, and only the owner merges it.

## M2: the first step

M2 is backup, restore and adoption: [the M2 roadmap](m2-roadmap.md). It runs in this
order:

1. S0, the coded diagnostics;
2. S1, backup and restore;
3. S2, Audiobookshelf;
4. S3, adopting an existing stack;
5. S4, `doctor` and the host checks;
6. S5, drift on a schedule, with alerts.

**The first step is S0,** by the lighter route. Its list is in the roadmap. **Then
S1's design:**

- go through S1's open decisions with the owner, one question at a time;
- probe the real apps where the roadmap says to;
- write S1's design into the spec, and its plan into `docs/plans/m2/`;
- start building only when the owner says go.

## Open decisions

Each slice's "To decide in the slice's design" list in [the M2 roadmap](m2-roadmap.md)
gives a recommendation for each. Two are the owner's to confirm first:

- **S1's drill.** It is side by side by default (Plex not signed in, nothing
  downloading), with `--take-over` for a real switch. To confirm: what "nothing
  downloads" means for the VPN. The recommendation is that Gluetun and qBittorrent don't
  start, because one WireGuard key used on two hosts at once drops one of them.
- **S2's name for an app on a network that isn't Mediaplane's.** The recommendation is a
  network alias rather than a fixed container name.

Also open from before M2:

- **Default quality settings** for Sonarr and Radarr. They are on the "Later" list.

## The owner's steps left

All are optional:

- **The Renovate app.** It opens PRs that keep the pinned versions current.
- **`PLEX_TOKEN` in the `plex` environment.** It turns on the nightly Plex check, using
  a plex.tv **test** account.
- **A read-only Docker Hub token,** for CI's pull limits.

## How the work runs

- **Big or security-related work is a slice.** It goes:
  1. brainstorm;
  2. spec in `docs/design/`;
  3. plan in `docs/plans/`;
  4. subagent-driven build with a review per task;
  5. final review;
  6. PR.
- **Small changes take the lighter route:** test-first, the full check, the affected
  end-to-end tests, one review, then a PR with green CI.
- **The full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
- **Every slice updates its docs.**
  - Diagrams go in `text` blocks of at most 40 columns, never Mermaid.
  - Use lists rather than wide tables, because the owner reads on a phone.
- **`main` is protected.**
  - "All checks passed" must pass, and history stays linear.
  - Merging is a fast-forward of the PR's head.
  - Never force-push or rewrite pushed history.
- **The owner's own steps:** releases, tags, publishing to GHCR, repo settings, secrets
  and installing apps.
- **The repo is public:**
  - fake values only, and no personal details;
  - generic examples (`/srv/data`, `mediaserver`, `192.0.2.10`);
  - never paste a secret into chat.
- **The owner's own setup** (their hosts and their current stack) is kept in a private
  file outside the repo, on the development machine. Ask the owner for it if it isn't
  there. Never commit what it says.
