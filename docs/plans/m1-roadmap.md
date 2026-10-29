# M1 roadmap: Engine + CLI in slices

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md)

M1 is too large for one implementation plan, so it is delivered in 17 vertical
slices: S1, S2 in three parts, S3 in four, S4 to S9, and S10 in three. Each slice:

- ends with working, tested software and a green CI;
- gets its **own detailed plan**, written when the previous slice has landed, so
  the plan builds on the real code rather than guesses.

The plan each slice was built from, kept in [`m1/`](m1/) as a record, with the code as it
was built then (the code on `main` is the truth):

- Slice 1: [`m1-s1-pure-core.md`](m1/m1-s1-pure-core.md) (done).
- Slice 2a: [`m1-s2a-plan-against-docker.md`](m1/m1-s2a-plan-against-docker.md) (done).
- Slice 2b: [`m1-s2b-apply.md`](m1/m1-s2b-apply.md) (done).
- Slice 2c: [`m1-s2c-packaging.md`](m1/m1-s2c-packaging.md) (done).
- Slice 3a: [`m1-s3a-admin-and-seed-files.md`](m1/m1-s3a-admin-and-seed-files.md) (done).
- Slice 3d: [`m1-s3d-vpn-check.md`](m1/m1-s3d-vpn-check.md) (done).
- Slice 3b: [`m1-s3b-wiring.md`](m1/m1-s3b-wiring.md) (done).
- Slice 3c: [`m1-s3c-download-path.md`](m1/m1-s3c-download-path.md) (done).
- Slice 4: [`m1-s4-indexers.md`](m1/m1-s4-indexers.md) (done).
- Slice 5: [`m1-s5-jellyfin.md`](m1/m1-s5-jellyfin.md) (done).
- Slice 6: [`m1-s6-requests.md`](m1/m1-s6-requests.md) (done).
- Slice 7: [`m1-s7-plex.md`](m1/m1-s7-plex.md) (done).
- Slice 8: [`m1-s8-drift.md`](m1/m1-s8-drift.md) (done).
- Slice 9: [`m1-s9-releases.md`](m1/m1-s9-releases.md) (done).
- Slice 10a: [`m1-s10a-recovery.md`](m1/m1-s10a-recovery.md) (done).
- Slice 10b: [`m1-s10b-automation.md`](m1/m1-s10b-automation.md) (done).
- Slice 10c: [`m1-s10c-contract.md`](m1/m1-s10c-contract.md) (done).

Where M1 stands:

- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8, S9, S10a, S10b
  and S10c.
- **Between S7 and S8 (2026-10-17), outside the slices** by the lighter route for small
  changes (test-first, one review, CI): `hardware_transcoding` for Plex and Jellyfin,
  `init` offering the Plex sign-in and asking for your own admin password, and
  `deploy/install.sh`.
- **M1 is done.** Every item below is settled: done, or moved to M2 with its reason. One
  stays open, and isn't M1 work: "Before the first real migration" applies when a
  migration is first planned, and none is. The owner's steps (the Renovate app, branch
  protection, private vulnerability reporting, the first release) are listed in the
  completion checklist of [S10c's plan](m1/m1-s10c-contract.md). [After M1](#after-m1) has
  what comes next.

## Slices

> **Renumbered three times, by the owner's decisions.** A plan uses the numbers of its day.
>
> - **2026-10-11:** drift moved after requests, so that it is designed against every
>   app and a hands-off stack comes sooner. S4 indexers (was S5), S5 media servers (was
>   S6), S6 requests (was S7), S7 drift (was S4); S8 release unchanged.
> - **2026-10-15:** the media servers split, Jellyfin first. S5 Jellyfin and the arrs'
>   links to it (from S5), S6 requests (unchanged), S7 Plex (from S5), S8 drift (was
>   S7), S9 release (was S8).
> - **2026-10-25:** the rest of M1 split in three, so that a deployment can be updated
>   safely sooner. S8 drift (unchanged), S9 releases and safe updates (from S9), S10
>   recovery and automation (from S8 and S9).

| # | Slice | Delivers | Spec sections | Proves |
|---|---|---|---|---|
| S1 | **Pure core** | Repo scaffold, CI, secret scanning, OSS basics, the `stack.yaml` schema and loader, secret references, the catalog format with all M1 app definitions (pinned), the resolver, the Compose renderer, a file-level `plan`, and the CLI `plan` command | §2.1, §3, §4.1–4.3, §5.2 (plan) | `mediaplane plan` shows exactly the Compose project it would write, and rejects bad input with actionable errors. No Docker is needed |
| S2 | **Runtime and apply (containers)** | Key generation and persistence, `.env` rendering, the Compose driver, the lock, preflight checks (including the host helper and the same-filesystem check), the container diff, the apply stages (write, pull, start, record), change history, the `apply`, `status`, `history` and `init` commands, the Mediaplane image with `deploy/mediaplane.compose.yaml` and the socket proxy (`mediaplane-system`), and an end-to-end harness | §4.4, §5, §5.1, §7.2 (2–4) | Success criteria 3 (containers) and 6. Containers come up healthy on amd64 and arm64. A second apply reports no changes |
| S3 | **Wiring framework and the download path** | The integration contract, a typed HTTP client with retries, `resources.json`, pre-start config files (`config.xml`, `qBittorrent.conf` with PBKDF2), the shared admin credential and `credentials`, the Servarr admin bootstrap, Sonarr/Radarr wired to qBittorrent (download clients, root folders, categories), the verify stage, and `vpn-check`. Also a real VPN kill-switch test against a local WireGuard server | §6.1, §6.2 (download rows), §6.4, §8.1 (4) | Success criterion 5. Partly criterion 1 |
| S4 | **Indexers** | Prowlarr application links (fullSync), the Byparr/FlareSolverr indexer proxy and the `cloudflare` tag | §6.2 (Prowlarr rows) | Indexers added in Prowlarr reach both arrs, and proxied requests work |
| S5 | **Jellyfin** | Jellyfin bootstrap-before-publish, its API key and libraries, and the arr → Jellyfin connections | §6.1 (Jellyfin), §6.2 (media-server rows), §6.4 | Jellyfin is wired headlessly |
| S6 | **Requests** | The Seerr first sign-in through the Jellyfin admin, libraries, the Sonarr/Radarr servers, initialize, and the full-stack end-to-end test | §6.1 (Seerr), §6.2 (Seerr row) | Success criterion 1 |
| S7 | **Plex** | `plex-login` (the plex.tv PIN flow), the Plex claim through a plex.tv helper, its libraries, the arr → Plex connections, Seerr's sign-in with the Plex token, and a nightly Plex CI job | §6.1 (Plex, Seerr), §6.2 (media-server rows), §8.1 (Plex) | Success criterion 2: Plex is wired headlessly, except for the single Plex sign-in |
| S8 | **Drift** | The three-way drift model, `drift`, `keep` (Keep mine), a comment-preserving override writer, `unmanaged`, the "drift reported" runbook, and the S8 items below, with the owner's decisions of 2026-10-17 | §6.3 | Success criterion 4 |
| S9 | **Releases and safe updates** | Versioned, published releases, and updating Mediaplane without touching the stack (listed below) | §8.2, §9 | Success criterion 7 |
| S10 | **Recovery and automation**, in three parts: S10a, S10b and S10c | Rebuilding a host, and running Mediaplane from automation (listed below) | §6.1 (key recovery), §6.3, §9 | M1 is done |

**S9, releases and safe updates:**

- release-please and versioned releases;
- a multi-arch release workflow that publishes Mediaplane's image, with SBOM and
  provenance;
- Trivy for the catalog images;
- Renovate: a custom manager for catalog pins, the pins outside the catalog, and
  SHA-pinned Actions;
- `install.sh` installing a pinned release, which it pulls rather than builds;
- updating Mediaplane by running it again, which never restarts the stack;
- `migrate`;
- the licence's SPDX field, and `main` protected;
- from S8: FlareSolverr's anonymous volume, and a wiring network whose settings change
  with an update.

It proves that a release is green on both architectures, and that updating Mediaplane
leaves the stack running.

**S10, recovery and automation:**

- externally managed mode, name-based re-adoption, key recovery from appdata, and
  shared-key propagation, with restoring a key at its source (S8 reports a shared key
  changed at its source);
- removing what Mediaplane made when its app leaves the stack (S8 reports it), and
  signing a setup in again: Seerr with a new Plex token, or another Jellyfin key;
- each S8 item below marked "Moved to S10": restoring the keys of installs from before
  S3a, Jellyfin's key deleted by hand, rotating the admin password, every setup getting
  every stored key, the setups' contract leftovers, the fake Seerr's `/auth/me`, a failed
  first-run setup stopping all wiring, and asking Seerr rather than reading its
  `settings.json`; and the two S8 settled as S10's without that label: moving the arrs
  to a new Plex token (rotation), and claiming again a Plex unclaimed while it runs
  (recovery);
- in externally managed mode, `keep`'s line to add, as a field of `mediaplane.keep/v1`
  rather than only an error's hint (S8 gives it in the hint);
- `plan --help` and `drift --help` pointing at the published docs, not a repo path;
- a contract for automation: the `--json` output shapes pinned and in the generated
  docs, exit codes, commands that ask nothing when a script runs them, and a second
  `apply` that changes nothing;
- a "deploying with automation" guide, with a short Ansible example;
- the S10 items below: the full README, the add-an-app guide and the test gaps.

It proves that a host can be rebuilt from `stack.yaml` and its appdata, by hand or by a
playbook. That completes M1.

### S10 is delivered in three parts (decided 2026-10-26)

S10 is too large for one plan (about 16 tasks), so it ships as three parts, each ending
green, as a full slice does. The cut follows what each changes: S10a, what Mediaplane
holds on a host (its keys, and the setups that make or use them), so that a host is
rebuilt from its files; S10b, what the stack does when it changes (what is removed when
an app leaves, the Plex token's rotation, and a Plex signed out of its account); S10c,
what a script reads (the contract automation relies on), with the docs that complete M1.
S10 was first planned as two parts, S10a and S10b; S10b was split again on 2026-10-26.

- **S10a: recovery** ([plan](m1/m1-s10a-recovery.md)).
  - Delivers: key recovery from appdata, Jellyfin's from its database; a key put back at
    its source, installs from before S3a included; keep of an app's own key, given to
    every holder by the next `apply`; Jellyfin's key made again; a failed first-run setup
    no longer stopping the wiring; the setups' keys and contract leftovers; the admin
    password rotated (`--rotate admin.password`), and set anew through the keys after a
    lost `state/`; the "rebuilding a host" runbook.
  - Proves: a host rebuilt from `stack.yaml` and its appdata, on real Docker: every key
    recovered, every resource adopted by name, a new admin password set through the keys,
    and a second `apply` with no changes; qBittorrent's key changed in its web UI, put
    back by `apply`, then kept by `keep`.
  - Also (2026-10-26, the owner's request, light route): a short admin password of your
    own is allowed with warnings. Below 12 characters `plan` warns
    (`admin.password-short`) and stays ok, and `init` warns and asks "Use it anyway?";
    only an app's own minimum was an error (`adminPasswordMinLength`, a catalog fact:
    qBittorrent 6, probed; Sonarr, Radarr, Prowlarr and Jellyfin take 1 character), then
    a minimum of 6 for every stack (2026-10-26).
- **S10b: automation, as first planned.**
  - Delivers: removing what Mediaplane made when its app leaves the stack (§8.1(3) step
    4); a new Plex token for the arrs, and Seerr signed in again with it, a Plex
    unclaimed while it runs claimed again, Seerr's own Jellyfin key replaced, and Seerr
    asked rather than its `settings.json` read; externally managed mode finished, with
    `keep`'s line to add in `mediaplane.keep/v1`; the `--json` contract pinned and in the
    generated docs, exit codes, commands that ask nothing when a script runs them, and a
    second `apply` that changes nothing; `plan --help` and `drift --help` pointing at the
    published docs; the "deploying with automation" guide with a short Ansible example,
    the full README and the add-an-app guide; the test gaps and S9's review items below;
    and which Compose versions work out a service differently.
  - Proves: a playbook deploys a stack, removes an app from it, and rebuilds the host,
    reading only the documented contract.
  - **Split again on 2026-10-26** ([plan](m1/m1-s10b-automation.md), decision 1), by what
    each part changes: S10b, what the stack does when it changes (behaviour); S10c, the
    contract a script reads, and the docs that complete M1.
- **S10b: removal and rotation** ([plan](m1/m1-s10b-automation.md)).
  - Delivers: what an app leaving the stack had in the others removed (spec §8.1(3)
    step 4), but what is yours, or no longer as Mediaplane made it; Keep mine with
    `managed_by: external` giving the line to add in `mediaplane.keep/v1`; Jellyfin's
    database read in a process of its own, with a deadline; Seerr's own Jellyfin key
    replaced with Mediaplane's, and Seerr asked when its `settings.json` can't be read;
    a new Plex token for the arrs and Seerr (`--rotate plex.token`, Seerr signed in again,
    the fake Seerr's `/auth/me` answering each session as its own user); a Plex signed out
    of its account while it runs claimed again through its API, with a warning while it
    runs published.
  - Proves: a script, with no terminal and reading only `--json` and exit codes, deploys
    the Jellyfin stack, takes Radarr and the Cloudflare solver out, and `apply` removes
    their containers and what they had in the other apps, leaves a qBittorrent category
    that holds a torrent until the torrent moves, keeps Radarr's appdata, and then changes
    nothing, on real Docker; the nightly Plex job rotates the token and claims Plex again.
- **S10c: the automation contract and the docs** ([plan](m1/m1-s10c-contract.md)).
  - Delivers: the `--json` shapes pinned and in the generated docs (`history <id>
    --json` included, and `ok` on `credentials`, `status` and `history`), exit codes,
    commands that ask nothing when a script runs them, and a second `apply` that changes
    nothing; `plan --help` and `drift --help` pointing at the published docs; the
    "deploying with automation" guide with a short Ansible example, the full README and
    the add-an-app guide; the test gaps below, CI's end-to-end pulls made robust against a
    temporary registry error, S9's review items, which Compose versions work out a
    service differently, and the nightly Plex job's items.
  - What the contract must pin from S10b (all additive within v1, but a script with an
    exhaustive switch must know them):
    - `mediaplane.plan/v1` and `mediaplane.change/v1`: `wiring[].action` `remove`;
      `drift[].stays` (left entries only); `bootstrap[].again`, present only when true,
      published or not.
    - An older release lists a change record holding `remove` as one it can't read.
    - `mediaplane.apply/v1`: a wire action with `detail: 'removed'`; a `skipped` wire
      action whose `detail` says why a planned removal stays (only `detail` tells it
      from a held or waiting skip); the bootstrap detail `signed in again to <app>`.
    - `mediaplane.keep/v1`: `line` and `written`, only once keep reaches the line; with
      `managed_by: external`, exit 0 and the `keep.external` warning; the error
      `keep.record`.
    - The new diagnostic codes: `bootstrap.open-published`, `rotate.no-plex`,
      `keep.record`.
    - `given` (names only) in `state/resources.json` records.
  - The nightly Plex job's items from S10b:
    - `plex.e2e` checks `writtenFiles(home)` and `.env` after the reclaim.
    - `plex.e2e` pins the claim-token count (2) after the reclaim.
    - **Done in S10c,** both. The count after the claim again is 3, not 2 (probed with
      the test account): the unpublished start's `PLEX_CLAIM`, which the image ignores
      for a signed-out Plex, takes one, and the claim through Plex's API another. An
      unused claim token expires in four minutes, and a start that gets none would need
      the setup to know the Plex is signed out first: left as it is.
  - Proves: a playbook deploys a stack, removes an app from it, and rebuilds the host,
    reading only the documented contract.
  - **Done in S10c:** every `--json` document pinned in `packages/cli/src/contract.ts`,
    with `ok` on each, and generated into `docs/reference/json.md` and a JSON Schema per
    document; each item S10b left to pin is in it. A usage error under `--json` prints
    the error document too, and the error document gives each diagnostic's code. Help and
    hints name the published docs, and `docs:check` fails on a link that leads nowhere.
    Spawned tests pin that a script is asked nothing, and no command waits on a named
    pipe in place of `stack.yaml`. First-run setups are held in one pass, whatever the
    catalog's order (the S10b final review's item). The guide to deploying with
    automation, with a short Ansible example a test checks against the CLI; the full
    README; the add-an-app guide. Every item below marked for S10c is settled, as each
    says. `test/e2e/playbook.e2e.test.ts` proves it, on real Docker.

### S2 is delivered in three parts (decided 2026-10-09)

S2 is too large for one plan, so it ships as three sub-slices. Each one ends green,
just like a full slice.

| # | Delivers | Proves |
|---|---|---|
| S2a | **Plan against a real host.** The S2 items from the Slice 1 reviews, plus: cloud detection, the Docker runtime (versions, `config --hash`, `ps`), the secrets store (read-only), secret values, preflight checks, the container diff from Compose's own config hash (ADR 0010), the CLI showing containers and secrets, and the end-to-end harness with a CI job | `mediaplane plan` reports exactly what `apply` would do to files, containers and secrets, and still writes nothing |
| S2b | **Apply.** Key generation and persistence, `.env` rendering, atomic writes and the lock, the appdata ownership helper (Seerr runs as uid 1000), the apply stages (write, pull, `up --wait`, verify, record), change history, the `apply`, `status`, `history` and `init` commands, verified health checks, and ADR 0004 | Containers come up healthy on amd64 and arm64. A second apply reports no changes |
| S2c | **Packaging.** The Mediaplane image, `deploy/mediaplane.compose.yaml` with the socket proxy (`mediaplane-system`), host detection from inside the container (the host helper), the threat model and ADR 0008. Also, by the owner's decisions of 2026-10-09: Trivy for the Mediaplane image (moved here from S9); native arm64 CI (moved here from S9); and the docs so far, which are the generated `stack.yaml`, JSON Schema and CLI references with a CI freshness check (moved here from S9), `docs/architecture.md`, a README per app, the "app won't start" runbook and ADR 0006. And `pnpm audit` of the CLI's production dependencies in CI, which the image scan can't see because they are bundled (spec §7.2(7)) | Success criterion 6 |

### S3 is delivered in four parts (decided 2026-10-09)

S3 is too large for one plan, so it ships as four sub-slices, in the order below. Each
one ends green, just like a full slice.

- **S3a: shared admin and pre-start files.**
  - Delivers: the shared admin login, with a generated password, and
    `mediaplane credentials`; `init`'s questions for the admin, the LAN and the
    WireGuard address; files written before an app's first start, only if absent
    (`config.xml` for Sonarr, Radarr and Prowlarr, `qBittorrent.conf` with the shared
    login and its key, and Gluetun's control-server key); the S3 network inputs below;
    pull retries, and tests that clean up after themselves.
  - Proves: `config.xml` holds the generated key; qBittorrent takes the shared password
    from `credentials`, and its key; it prints no temporary password; a second apply
    changes nothing.
- **S3d: VPN.**
  - Delivers: the kill-switch test against a local WireGuard server, `vpn-check`, the
    CI `modprobe wireguard` step, and the "VPN down" runbook.
  - Proves: success criterion 5.
- **S3b: the wiring framework.**
  - Delivers: how the Mediaplane container reaches the apps (an owner's decision, then
    ADR 0011), the typed HTTP client, the integration contract, `resources.json`, the
    wiring steps, and the Servarr admin login as its first resource.
  - Proves: the shared login works in Sonarr, Radarr and Prowlarr, from source and from
    the image.
- **S3c: the download path.**
  - Delivers: qBittorrent's categories and settings through its API, and Sonarr's and
    Radarr's download clients and root folders, on the VPN topology.
  - Proves: part of success criterion 1.

S3d comes second because it is small, it settles early whether GitHub's runners can
load WireGuard, and it gives S3c a real Gluetun to wire through.

Every slice writes its own docs as it goes:

- **ADRs**, when a slice implements the decision:
  - 0001, 0002, 0005 and 0009 in S1;
  - 0010 in S2a, 0004 in S2b, and 0006 and 0008 in S2c;
  - 0003 in S8.
  - 0007 (books) belongs to M3.
- **Each app's `catalog/<app>/README.md`**, written in S2c, and updated when that
  app's integration lands.
- **Runbooks**, written with the feature they cover:
  - "VPN down" in S3d, and "wiring failed" in S3b;
  - "drift reported" in S8;
  - "app won't start" in S2c.
- **A docs task in every slice plan,** from S2c on (owner, 2026-10-09). It covers the
  spec §9 artefacts the slice touches: it runs `pnpm docs:generate` for the generated
  references, and updates each touched app's README, the runbooks and ADRs, and
  `docs/architecture.md`.

## After M1

Decided by the owner on 2026-10-25. The web panel is no longer the next milestone. The
CLI is refined instead, and the work after M1 is smaller: a feature at a time, by the
lighter route, or as a slice when it is big or touches security.

- **M2: everyday CLI.** It also takes the M1 items S10c moved there, listed under "M2
  (everyday CLI)" in [Inputs for later slices](#inputs-for-later-slices-from-the-reviews).
  - Safe app updates: `mediaplane update`, with a backup first and a rollback.
  - Backup and restore, including a restore onto a different host.
  - `mediaplane doctor`, which checks a running stack and says what to fix.
  - Quality presets for Sonarr and Radarr in `init` (see "Later ideas").
  - A media server you already run, used as it is (`external`).
  - Drift checked on a schedule, with alerts (optional).
  - Reads that can still wait: `stack.yaml` is guarded against a named pipe in its place,
    but other files a command reads (secret files, `state/*`, generated files) can still
    block on one. Guard them as `stack.yaml` is now.
  - Coded diagnostics for the error documents that have none, so a script tells them
    apart without reading the message (S10c's final review): a usage error,
    `apply.needs-yes`, `status <app>` with no container, `history.unreadable` apart from
    no such record, `credentials <app>` of an unknown app, `plex-login`'s timeout and its
    expired link, and `config.unreadable` for a `stack.yaml` that can't be read; and
    `fileKind` keeps its "check that the user can read it" hint.
  - A structured field on `apply`'s `actions[]` for what it did to each resource
    (`created`, `adopted`, …), which `change/v1` records gain too. Until then, a done
    wire action's `detail` is that word, stable within v1.
  - From S10c's reviews, by the lighter route: the docs link check's
    `decodeURIComponent` on a literal `%` in a link; the Renovate rule test catching a
    rule for an image no longer pinned; tests of the end-to-end harness's leftovers
    parsing; the migrate guide's regex test missing "it is 0 too".
  - `PINNED` (`scripts/ci/pull-images.ts`) learns a registry with a port, with the
    first pinned image that has one.
  - At each release: stamp the published JSON Schemas' `$id` with the release's tag, so
    a release's files don't share `main`'s `$id`.
- **M3: more apps.** SABnzbd, Audiobookshelf, Bookshelf (experimental), Bazarr,
  Recyclarr, Portainer and Homepage.
  - With a third app whose setup can be held: `heldThrough` takes the level and message
    from the first app it finds, so they could depend on the catalog's order.
- **Not scheduled:** the web panel (wizard, dashboard, drift view). Its items are kept
  below.

Two rules hold for all of it:

- **Mediaplane stays a standalone tool.** `install.sh` and the CLI are the way in.
  Automation such as Ansible runs the same commands, and S10 makes sure it can, but
  nothing in Mediaplane needs it.
- **Updates happen only when you run them.** Mediaplane never updates itself or an app
  on its own.

## CI architecture coverage

The dev box is aarch64. GitHub's hosted arm64 runners are free for public
repositories, and the repo is public, so from S2c (owner, 2026-10-09):

- the `image` and `e2e` jobs run as matrices on `ubuntu-24.04` (amd64) and
  `ubuntu-24.04-arm` (arm64), natively, with no emulation;
- on each runner, the `image` job builds that architecture's image and scans it with
  Trivy, and the `e2e` job runs every end-to-end test, including the ones that build
  the image and deploy it behind the socket proxy;
- a push that changes only docs skips both jobs. The last job, `All checks passed`,
  reports either way, so it is the one check branch protection should require;
- a multi-arch image manifest waits for publishing, in S9. **Done in S9:** the `image`
  job builds each architecture as a release does (SBOM, provenance, an OCI layout) and
  scans that; the release workflow pushes both and tags one index of them. The
  `engine-floor` job checks the image's Docker CLI and Compose against Docker Engine 24,
  and `catalog-images` scans the apps' images. It reports a finding rather than failing
  on it (the owner's decision of 2026-10-27; spec §11, "CI: the catalog scan
  reports"): to fail again, change `CATALOG_SCAN: report` to `fail` on that job.

Each slice that adds end-to-end tests still runs them locally on the aarch64 dev box
before merging.

## Things S1 encodes that later slices must verify against real containers

S1 renders these values but cannot run them. The slice named here confirms
each one, or corrects it in the catalog:

| Value | Verified in |
|---|---|
| Health-check commands for each image (`curl` in linuxserver images, `wget` in Seerr). The tools were confirmed present in every pinned image on 2026-10-09. **Verified on arm64 and amd64 on 2026-10-09** by S2b's end-to-end test, which applies the video stack and sees every app healthy: on the arm64 dev box, and on amd64 in CI at `ebd18fe` | S2b (done) |
| Gluetun's built-in health check with `depends_on: service_healthy`. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`, against a local WireGuard server: `apply` waits for Gluetun to be healthy, then starts qBittorrent, and both end healthy. It runs in CI from Slice 3d | S3d (done) |
| `FIREWALL_OUTBOUND_SUBNETS` accepting a comma-separated list. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: two subnets, given through `apps.gluetun.env`, are both routed in Gluetun's namespace. It runs in CI from Slice 3d | S3d (done) |
| qBittorrent `WEBUI_PORT` behaviour inside Gluetun's namespace. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: with `apps.qbittorrent.port: 8090` and `bind: localhost`, the web UI answers on `127.0.0.1:8090`. It runs in CI from Slice 3d | S3d (done) |
| The value format of Servarr `SERVER__TRUSTEDNETWORKS` (comma-separated CIDRs). Verified in S3b: see below | S3b (done) |
| Seerr running as uid 1000 with `init: true`. **Verified on 2026-10-09** by `test/e2e/apply.e2e.test.ts` and `test/e2e/deploy.e2e.test.ts`: Seerr, rendered with `init: true`, runs healthy after apply's ownership step gives its appdata to uid 1000 | S2b (done) |
| Jellyfin's health check. **Corrected in S5 (2026-10-15):** `/health` answers 200 `Degraded` in the first seconds of every start, while the rest answers 503, so the check now passes only on `Healthy`. `test/e2e/jellyfin.e2e.test.ts` sets Jellyfin up once it is healthy, over the wiring network | S5 (done) |

Verified in S3b (2026-10-10):

- **`SERVER__TRUSTEDNETWORKS`**: `test/e2e/apply.e2e.test.ts` gives two subnets through
  `apps.sonarr.env`, and Sonarr's own settings show them back as the same
  comma-separated list. That shows Sonarr reads the list as given; the tests don't show
  it splitting the list to match a client. It runs in CI from Slice 3b.

Verified in S3c (2026-10-11):

- **Sonarr and Radarr reach qBittorrent through Gluetun**, as `gluetun` at qBittorrent's
  `WEBUI_PORT`: `test/e2e/download.e2e.test.ts` sets `apps.qbittorrent.port: 8090`, and
  each arr's own test of its download client passes, from source and from the image. It
  runs in CI from Slice 3c.

Verified in S4 (2026-10-15):

- **Byparr answers Prowlarr as FlareSolverr does** (spec §10):
  `test/e2e/indexers.e2e.test.ts` has Prowlarr make its proxy of type FlareSolverr at
  Byparr, which passes Prowlarr's own test, then fetch a made-up indexer behind a
  stand-in Cloudflare challenge through Byparr's browser, and get its items. Then the same
  through FlareSolverr. Checked on the arm64 dev box; it runs in CI on both architectures
  from Slice 4.

## Inputs for later slices from the reviews

The Slice 1 final review (2026-10-08) approved the merge. It also raised the
design gaps below, which only matter once Mediaplane writes files or deploys.
The Slice 2a final review (2026-10-09) added the S2b list and two S3 items.
The Slice 2b final review (2026-10-09) added the S2c list, two S8 items and an
M2 item. Slice 2c (2026-10-09) added the last S3 item, the S5 item, the first S7 item
and the last four S9 items. Slice 3a (2026-10-10) added three S3 items, the S3d list,
three S8 items, two S7 items, an S9 item and an M2 item. Slice 3d (2026-10-10) added the
last S3 item, the unscheduled list and extended two S9 items. Slice 3b (2026-10-10) added
the S3c list, two S8 items and one unscheduled item. Slice 3c (2026-10-11) added the S4
item, five S8 items, an S9 item and an M2 item. Slice 4 (2026-10-15) added four S8 items,
and its final review an S5 item, two S8 items, a probe in two others, two S9 test gaps
and an S9 docs item. Slice 5 (2026-10-15) added an S6 item, six S8 items and an S9
item, and extended one, and its final review an S8 item and four S9 items. Slice 6
(2026-10-16) added an S7 item and changed one, added five S8 items and changed one, and
added an S9 item and changed one, and its final review an S8 item and an S9 item. Slice 7
(2026-10-16) marked the S7 items done, and added five S8 items and three S9 items, and
its conflict check an S9 item. Slice 8 (2026-10-25) settled each S8 item: built, decided,
or moved with its reason, as each says. Slice 9 (2026-10-26) settled each S9 item: built,
decided, or an owner's step, as each says. Each
slice plan must address the items for that slice.

**S2 (must land with `apply`):** all of these are in the S2a plan.

- **Cloud hosts and `bind: lan`.** On AWS, GCP, Azure and OCI the main
  network card has a private 10.x address that is NATed to a public IP, so it
  counts as "the LAN". The dev box is OCI, for example. Preflight must detect
  cloud platforms (DMI vendor or asset tag, metadata endpoint) and refuse or
  warn on `lan` unless `network.lan_subnet` is set explicitly. Bind addresses
  must also be restricted to an explicit `lan_subnet`.
- **Secrets in `apps.<id>.env`.** These values are plaintext today and end up
  in `compose.yaml`. Accept `{ file }` and `{ env }` references for env
  values, rendered as `${MP_<APP>_ENV_<NAME>}`, so values such as
  `WIREGUARD_PRESHARED_KEY` or `OPENVPN_PASSWORD` never land in the file.
- **Ejecting with the override file.** Compose only auto-merges a
  `compose.override.yaml` that sits next to the compose file. The runtime must
  pass both files with `-f`, and the generated file's header and the docs must
  give the exact `docker compose -f … -f …` command for ejecting.
- **Interface and namespace checks:**
  - Extend the virtual-interface deny-list (vmnet, vboxnet, zt, tap, ppp,
    nordlynx, cali, kube-, weave, cilium, utun), or check for a physical device
    under `/sys/class/net/<if>/device`.
  - Declare Gluetun's control port 8000 (unpublished), and check for container
    port clashes inside shared network namespaces.
- **Validation:**
  - Check that `version:` is a valid Docker tag, and pass the image reference
    through `literal()`.
  - Reject paths containing `:`.
  - `IPV4_CIDR` must reject octets above 255.
  - An empty `MEDIAPLANE_HOME` must fall back to the default.
- **Errors:**
  - Unexpected I/O errors must name the file and a next step. EACCES is
    likely, because the container runs as non-root.
  - `--json` must print a JSON error envelope when an exception is thrown.
  - An alias-bomb YAML file must produce a diagnostic, not an exception.
  - YAML syntax errors must not echo the offending source line once logs or
    history exist.
- **Tests:** a test that `plan()` writes nothing, alongside the new write code.

**S2b (blockers for `apply`):** all of these are in the S2b plan.

- **Own ports are matched by exact address.** Preflight treats a port as the
  stack's own only when a container publishes it on the same address. Changing
  `network.bind` while the containers run then gives a false
  `preflight.port-in-use`. Key own ports on protocol and port instead.
- **Runtime errors from `configHashes`.** A `RuntimeError` thrown by
  `configHashes` escapes `plan()` without the `docker.unavailable` handling
  that `versions()` and `containers()` get.
- **No timeout in `nodeExec`.** A hung `docker` call hangs `plan` and `apply`.
- **Malformed `ps` output.** A line that isn't JSON throws a `SyntaxError`. Make
  it a `RuntimeError`, and skip lines that aren't JSON objects.
- **Duplicate containers for one service.** When a service has more than one
  container, the last one wins. Handle it explicitly.
- **Validate `MEDIAPLANE_COMPOSE_PROJECT`** (`mediaplane` or `mediaplane-*`)
  before `apply` can act on it (spec §7.2(2)).
- **The test environment.** `main.test` needs ports 8989, 8080 and 8096 free,
  and `run.test` assumes `/opt/mediaplane` doesn't exist. So `pnpm test` fails
  on a host that runs a real stack.
- **Secret name collisions.** A catalog secret named `env<X>` would map to the
  same `MP_<APP>_ENV_<X>` variable as `apps.<id>.env.<X>`. Add a guard test with
  the next catalog secret.
- **The eject command in the docs.** ADR 0002 and spec §2.3 still say plain
  `docker compose up -d`. Update them to the exact command once `.env` exists.
  **Done in S2b:** both give the exact command from the generated header, and
  the end-to-end test runs that command.

**S2c:** all of these are in the S2c plan.

- **A stable hostname.** The lock records the host it was taken on, and only
  clears a stale lock from the same host. Give the Mediaplane container a fixed
  `hostname:`, so a recreated container can still clear its own stale lock.
- **Hard links in the home.** The lock (and `init`'s `stack.yaml`) is created
  with a hard link, so the Mediaplane home needs a filesystem that supports
  them. Document it.
- **`init` and uid 1000.** `init` tells the user to make the data folder
  writable by uid 1000. Consider the invoking user instead.
- **A different home.** Warn when the project's containers carry a
  `com.docker.compose.project.working_dir` from a different home, which means
  another home already manages a project with this name.

**S3:** S3a handles the first five, except Mediaplane's network in TRUSTEDNETWORKS,
which waits for the panel. S3b handles the rest, except qBittorrent's settings and admin
password, which are S3c's (and listed again below).

- Gluetun's `FIREWALL_OUTBOUND_SUBNETS` and Servarr's `TRUSTEDNETWORKS` should
  only be filled when ports are actually published on the LAN. Today they are
  also filled with `bind: localhost`.
- Warn when `lanSubnets` is empty but a feature needs it.
- Servarr `TRUSTEDNETWORKS` should add Mediaplane's Docker network once
  requests are proxied (ruling R12; spec §6.1).
- **`lanSubnets` on cloud hosts.** On a cloud VM without an explicit
  `lan_subnet`, leave `lanSubnets` empty.
- **Keep `lan_subnet` private.** Require `lan_subnet` to be inside RFC 1918, so
  a public or `0.0.0.0/0` subnet can't widen `TRUSTEDNETWORKS` or the
  authentication bypass.
- **The Mediaplane container can reach only the socket proxy.** Its network is
  internal (S2c). Wiring needs the apps' APIs, so attach the container to the
  stack's network, or find another route. Then update ADR 0008 and the threat model.
  **Decided by the owner on 2026-10-10, on how Mediaplane reaches the apps: a private
  wiring network.** A Docker network with `internal: true`, which
  Mediaplane's container, every wired app and Gluetun (for qBittorrent) join.
  - Mediaplane's container stays offline: that network has no route out.
  - The apps keep their normal network for their own internet traffic.
  - Gluetun's firewall must accept wiring traffic to qBittorrent's port, and S3b's
    end-to-end test proves it.
  - The plex.tv calls go through a short-lived helper in S7.
  - This is defence in depth, not a wall, because the proxy still lets Mediaplane
    create containers.
  - S3b writes ADR 0011 on it.
  - **Done in S3b:** as decided, with the end-to-end tests proving the login from source
    and from the image behind the real proxy, Gluetun letting the wiring network reach
    qBittorrent's port, and Mediaplane's container having no default route.
- **qBittorrent's settings after its first start.** `admin.username`,
  `admin.password`, `login_on_lan` and the LAN subnet reach qBittorrent only through
  its pre-start file (S3a). S3c manages them through its API. **Done in S3c:** the
  `qbittorrent.admin` and `qbittorrent.preferences` resources.
- **The shared admin password, through each app's API.** Apply it through every app's
  API, qBittorrent included, so that a change to `admin.password` reaches every app
  (S3b for Sonarr, Radarr and Prowlarr, S3c for qBittorrent). Today `credentials` shows
  the new password while qBittorrent keeps the one from its first start. **Done in S3b
  for Sonarr, Radarr and Prowlarr:** the `<app>.admin` resource. **Done in S3c for
  qBittorrent:** `qbittorrent.admin`, set through `setPreferences`.
- **Keys an app creates must fit the secrets store (S3b).** `state/secrets.json` takes
  only letters, digits and `_` in an app's key (`^[A-Za-z0-9_]+$`), because the keys go
  into the apps' files unescaped. A secret with `createdBy: 'app'` is kept in the same
  store, so its value must fit too, or the check must apply only to the keys Mediaplane
  generates. Otherwise the next `plan` can't read the store. **Done in S3b:** the rule
  stays for every key, and the store refuses to save one it couldn't read back, naming
  the key. Jellyfin's (S5) is 32 hex characters, which fits.
- **qBittorrent stranded by a Gluetun started again on its own (S3b).** When Gluetun
  restarts alone, by hand or after a crash, qBittorrent keeps the old, empty network
  namespace. Compose restarts qBittorrent only when it recreates Gluetun, not when it
  starts a stopped one (Compose 5.5.1), so `apply` leaves it stranded and its health
  check still passes on loopback. `vpn-check` reports it (S3d). Make the verify stage's
  VPN topology check (spec §6.4) catch it too, by reusing `vpnCheck` without the egress
  check, and have `apply` restart qBittorrent then. **Done in S3b:** `plan` lists such a
  qBittorrent as `restart`, also when apply starts a stopped Gluetun (the owner's trial),
  and verify runs vpn-check's checks without egress.

**S3c:** all of these are in the S3c plan.

- **qBittorrent through its API.** S3b reaches qBittorrent's API already, through Gluetun
  on the wiring network, and checks its key. Add its integration: the categories, the
  preferences, and `qbittorrent.admin`, whose password goes through `setPreferences`.
- **Download clients need their category.** Sonarr's and Radarr's `download_client`
  should `require` the qBittorrent category, so that a failed category skips it (S3b's
  contract has `requires`).
- **`after` for the arrs.** Sonarr and Radarr come after qBittorrent once they link to it.
- **Done in S3c:** all three, with the end-to-end test proving the download path through
  Gluetun from source and from the image behind the real proxy.

**S3d:** all of these are in the S3d plan.

- **Gluetun's control server refuses requests without the key.** S3a writes
  `auth/config.toml`, and this was checked only by hand on the pinned image. Check
  in the end-to-end test that `GET /v1/vpn/status` answers 401 without `X-API-Key`,
  and 200 with it.
- **qBittorrent's web UI on localhost, behind Gluetun.** Since S3a,
  `FIREWALL_OUTBOUND_SUBNETS` is set only while the web UIs are on the LAN. Check in
  the end-to-end test that with `bind: localhost` the web UI still answers on
  `127.0.0.1`, as a hand check found in S3a. If it doesn't, the cloud-VM default has
  regressed.
- **Validate `vpn.addresses`.** The schema takes any non-empty string today. Check it
  as comma-separated IPv4 or IPv6 CIDRs.
- **`vpn-check` and a Gluetun that wasn't restarted.** A Gluetun that started before
  Slice 3a, and hasn't been restarted since, has not read the key file Mediaplane
  wrote: it reads the file only when it starts (its README says to restart it once).
  Until then its control server still answers anyone, without the key, so `vpn-check`
  works but the server is open. Have `vpn-check` notice that (a request without the
  key that succeeds) and say so, with the fix: restart Gluetun, then qBittorrent.

**S4:**

- **The fakes of the arrs' download clients and root folders are kinder than the
  apps.** In `fakeStackApis` (S3c), Sonarr and Radarr take a root folder whose folder
  was never made, which the real arrs refuse; their test of a download client ignores its
  port and `useSsl`; and they save a new client without testing it, which the real
  arrs do. The end-to-end test shows the real behaviour. Make the fakes stricter when S4
  extends them.
- **Done in S4:** `fakeStackApis`' arrs refuse a root folder whose folder no `mkdir` made,
  fail a client's test at a port qBittorrent doesn't listen on, or over TLS, and test a
  new client as they save it; its new Prowlarr is as strict, with its links and its
  proxy.

**S5:** all of these are in the S5 plan.

- **Jellyfin's health check can pass early.** In its first seconds, Jellyfin's
  `/health` answers 200 with `Degraded` while the server still answers 503 to
  everything else (S2c). Look at a check that waits for the server itself. **Done in
  S5:** the check passes only on `Healthy`, at every start, not only the first.
- **Small gaps from S4, as S5 extends the fakes and providers** for Jellyfin's
  connections:
  - the fakes test a new provider sent without `enable` (`testedOnCreate`), which an
    app would take as `false`, and not test. Mediaplane always sends it;
  - the fake Prowlarr's test of a proxy adds an `apps` entry for the solver (`stateOf`),
    which a test of the whole map would see;
  - two small repeats between providers ("no apiKey to send", and a number read as 0):
    fold them into `servarr-provider.ts`;
  - one helper for service addresses: they are worked out three ways, and only the
    arr's allows a VPN container in front;
  - a CLI-level `apply` test with Prowlarr in the stack, without Docker: the links' and
    the proxy's create, record and idempotent re-plan, and a link skipped when its
    arr's admin fails.
  - **Done in S5:** all five. The fakes take a provider without `enable` as off, and their
    tests of another app read it without adding it; `secretOf` is defined in
    `catalog/_shared/secret.ts` and re-exported by `servarr-provider.ts`, and `numberOf`
    lives in `servarr-provider.ts`; `serviceAddress` gives every app's address; and
    `packages/cli/src/run.test.ts` applies a stack with Prowlarr.

**S6:**

- **Seerr signs in as Jellyfin's admin** (spec §6.1), which Jellyfin's first-run setup
  makes, and `jellyfin.admin` keeps as the shared admin (S5). Seerr's sign-in should
  `require` `jellyfin.admin`, and Seerr come `after` Jellyfin, so that a Jellyfin still to
  be set up, or one whose key is refused, skips it rather than fails it.
  - **Done in S6,** as a first-run setup: Seerr's setup is open to anyone on its port
    until its first sign-in, so the sign-in runs before Seerr is published, where no
    resource can be required. Setups run in the order of `after`, so Seerr's follows
    Jellyfin's; it waits (`bootstrap.waiting`), unpublished, without failing the step,
    while Jellyfin refuses the shared admin's password or after Jellyfin's setup failed,
    and the wire step skips Seerr's resources. `seerr.media_server` requires
    `jellyfin.admin`, so a Jellyfin that refuses its key skips it. Seerr's sign-in needs
    the password, not Jellyfin's key.

**S7:**

- **The Plex claim and `plex-login` need plex.tv.** The Mediaplane container has no
  route out today (S2c), and stays offline under S3b's decision above (a private wiring
  network). So make the plex.tv calls from a short-lived helper, and record that in the
  threat model.
  - **Done in S7:** each plex.tv call is a throwaway container of Mediaplane's image on
    Docker's default bridge network, which reaches none of the stack's networks, with
    the request on its standard input (ADR 0012, threat model T14). The proxy allows
    nothing new.
- **A login of your own for Plex, and for Seerr on Plex.** Plex's login is always
  your plex.tv account, never the shared admin (spec §6.1). With Plex, Seerr's
  first sign-in uses that account too. The catalog's `login` (S3a) is `'shared'`
  or the slice that brings it, so `credentials` says their login arrives in
  Slice 7. Give `login` a value for your own account, and use it for both. Since S6,
  Seerr's `login` was `'shared'` on a Jellyfin stack, and on a Plex stack the catalog
  dropped Seerr's API, integration and setup and made its login say Slice 7, to be
  removed once Seerr's Plex sign-in was built.
  - **Done in S7:** `login` may be `{ own: 'Plex' }`, or a function of the stack; Plex's
    is your own, and Seerr's is too on a Plex stack. S6's stand-in that dropped Seerr
    on a Plex stack is gone.
- **Seerr's Plex sign-in is open too** (S6, from Seerr 3.5's code). Before its first
  user, `POST /api/v1/auth/plex` makes whoever signs in with a plex.tv account Seerr's
  admin, as its Jellyfin sign-in does. Make it a first-run setup before Seerr is
  published, as S6 made the Jellyfin one, and give Seerr's resources a Plex media server.
  - **Done in S7:** Seerr signs in with your token before it is published, and
    `seerr.media_server_plex` links it to Plex.
- **Plex's web UI is at `/web`.** `credentials` prints `http://<address>:<port>`
  for every app, so give the catalog a per-app web path.
  - **Done in S7:** `webPath`, which `credentials` adds.

**S8:**

- **Moved to S10 on 2026-10-25:** the items here about recovery: restoring a key at
  its source (installs from before Slice 3a), Jellyfin's key deleted by hand, and
  rotating the admin password. S8 keeps drift and Keep mine.
  - **Done in S10a:** all three, as the items below say.
- **Decided by the owner on 2026-10-17,** for the items below:
  - **qBittorrent's post-import category:** `plan` skips the arr's download-client test
    while that category is missing.
  - **The "failing" mark a wrong key leaves:** drift skips a key test when it already
    knows the key is wrong.
  - **Jellyfin's sign-in activity entries:** drift checks the admin password less often.
  - **qBittorrent's sign-in ban:** drift stops checking a password it knows differs,
    until `apply` sets it.
  - **Seerr's key checked twice per apply:** check it once.
  - **Done in S8:** each of the five, as the items below say.
- **Seerr keeps the Plex token it signed in with** (S7). After `plex-login` saves a new
  token, Seerr still holds the old one, which it uses to reach Plex, and Mediaplane can't
  check it with Seerr's key. When the old one is revoked, Seerr's libraries stop
  syncing. Decide how drift finds it, and whether Mediaplane signs Seerr in again (which
  needs the setup's care: never to a Seerr that isn't Mediaplane's).
  - **Moved to S10:** giving Seerr a new token means signing Seerr in again, which needs
    the setup's care and plex.tv, with the recovery of a key that changed. Drift can't
    check that token with Seerr's key without a call that reaches plex.tv.
  - **Moved to S10b:** it needs plex.tv probes with a real account, and a test that only
    the nightly job can run; it rotates a token you give, which S10a's recovery of the
    keys Mediaplane holds doesn't touch.
  - **Done in S10b:** `apply --rotate plex.token` signs Seerr in again with your new
    token, once plex.tv says Seerr's admin is that token's account (probed: Seerr keeps
    it as its admin's); `plex-login` says to run it. A revoked token Seerr holds still
    can't be seen through Seerr's API (probed: it never shows it), so drift can't report
    it: the rotation is the way.
- **The arrs keep a Plex token while Plex takes it** (S7): a new token from `plex-login`
  reaches them only once the old one is refused. Decide whether drift moves them to it.
  - **Decided in S8:** no. Secrets are checked, never compared, and one that works is
    left; the new token reaches them once Plex refuses the old one. Moving them to it is
    rotation, with S10.
  - **Moved to S10b,** with Seerr's new token: both need to know the token changed,
    which Mediaplane can't tell by comparing secrets.
  - **Done in S10b:** you say so, with `--rotate plex.token`: each arr's connection is
    given the new token, unchecked, but for one Plex refuses (another account's).
- **Plex's libraries are known by name** (S7), as Jellyfin's are: one renamed by hand
  is left, and the next `apply` makes `Movies` or `TV Shows` again on the same folder.
  Decide whether drift reports the renamed one. A folder added by hand is put back:
  Keep mine must cover `location`.
  - **Done in S8:** found by Plex's key while `resources.json` has it, so a renamed
    one is drift on its name, which `apply` puts back; `location` can be kept; the name
    is fixed; and no library is made on a folder another of Plex's holds.
- **Plex's devices grow** (S7): each arr's first test of its connection to Plex lists
  it among Plex's devices, and a Plex made anew lists them again. Decide whether drift
  reports old ones.
  - **Decided in S8:** not reported. Plex's devices aren't Mediaplane's to manage, and
    an arr's later tests add none: only its first, or one after Plex is made anew.
- **A Plex claimed by another account stays unpublished on every `apply`** (S7), with
  its remedies in the error. Decide whether drift reports a Plex whose `PlexOnline`
  settings were removed by hand while it runs, which then looks unclaimed to it.
  - **Decided in S8:** drift reports what `plan` reports when Plex refuses your token
    (`key` drift); `plan` lists Plex's setup when its file holds no `PlexOnlineToken`.
    A Plex unclaimed while it runs was not probed in S8; claiming it again is recovery:
    S10.
  - **Moved to S10b,** with the Plex token's items: it needs a real claim, through
    plex.tv. A rebuilt host's Plex is checked again by S7's setup (S10a).
  - **Done in S10b,** probed with a real claim: Plex's sign-out unclaims it at once,
    leaving `PlexOnlineToken=""`, which its image takes for a claim, so `PLEX_CLAIM` goes
    unused. Plex's setup now claims it itself, through its API, to its address; `plan`
    and drift warn while it runs published (`bootstrap.open-published`). The nightly job
    signs it out and checks it is claimed again.
- **Every setup gets every stored key** (S7): `BootstrapContext.keys` holds each app's,
  but Plex's and Seerr's setups read only your Plex token. Narrow it, to the keys you
  give or to the Plex token alone, when S8 changes the setups for signing in again.
  - **Moved to S10:** S8 changes no setup; S10 signs setups in again.
  - **Done in S10a:** a setup gets only the keys you give that an app's API takes
    (`BootstrapContext.given`): your Plex token.
- **The setups' contract has leftovers** (S7): `Bootstrap.firstStart`'s `stack` is
  unused; `AppLoginKind`'s `{ own: string }` could be `{ own: 'Plex' }`; and no app uses
  `{ comingIn }` or the `login: 'not-yet'` of `credentials` any more. Keep `not-yet` while
  `mediaplane.credentials/v1` has it, but say it is for later slices.
  - **Moved to S10,** with the setups, for the same reason.
  - **Done in S10a:** `firstStart` takes no stack, and the own login is
    `{ own: 'Plex' }`; `{ comingIn }` and `not-yet` stay, for the apps to come.
- **The fake Seerr's `/auth/me` answers a session that isn't its admin's** with the
  admin's `plexId` and `jellyfinUsername` (S7). Nothing reads them from such a session
  yet. Fix the fake when signing Seerr in again reads sessions.
  - **Moved to S10,** with signing Seerr in again.
  - **Moved to S10b,** with signing Seerr in again.
  - **Done in S10b:** the fake answers a session as its own user, whose `plexId` and
    `jellyfinUsername` are that user's.

- Override field names are case-sensitive, so the managed-field comparison must
  match them exactly.
  - **Done in S8:** `plan` refuses a key that names no managed field, with the closest
    name, whatever its case.
- **A root folder whose path changes.** Sonarr and Radarr can't move a root folder, so a
  `root_folder.path` override would add a new one and leave the old, which may hold a
  library (S3c). Decide what drift and Keep mine do with the old one.
  - **Done in S8:** a root folder's path is fixed: an override or Keep mine of it is
    refused, saying to move the library in the arr, then make the root folder
    `unmanaged`.
- **A root folder whose folder was deleted.** Mediaplane makes a root folder's folder
  only when it adds the root folder (S3c). Deleted later, the arr shows the root folder
  as inaccessible, but Mediaplane finds it as wanted, and `plan` says `unchanged`: it
  doesn't read the arr's `accessible`. Decide whether drift reports it, and whether
  `apply` makes the folder again.
  - **Done in S8:** the new managed field `accessible`: drift reports it, and `apply`
    makes the folder again.
- **qBittorrent's sign-in ban.** qBittorrent bans an address from signing in for an hour
  after five failed sign-ins in a row, and Mediaplane checks its password by signing in
  (S3c). A changed `admin.password` costs one failure per `plan`, and one for the
  `apply` that sets it. When drift is checked on a schedule (M2), a changed password left
  unapplied would ban Mediaplane's address within the hour. Decide whether drift checks
  the password less often, or not at all while it differs.
  - **Done in S8,** as the owner decided: once drift finds the password refused,
    neither drift nor `plan` signs in again until `apply` sets it.
- **`plan` can make a post-import category in qBittorrent.** The arr's own test, which
  `plan` runs to check a download client's key, makes a missing post-import category
  (`tvImportedCategory`, `movieImportedCategory`). Mediaplane doesn't manage that
  setting, so this happens only if you set one yourself and later deleted it in
  qBittorrent (S3c, probed on the pinned images). That is a small exception to "`plan`
  changes nothing". `plan` already reads qBittorrent's categories, so it could skip the
  test while that category is missing.
  - **Done in S8,** as the owner decided, and for the client's own category too, once
    qBittorrent's is no longer managed and deleted: `plan` and drift leave the key
    unchecked while qBittorrent lacks one, and say what clears it. A category the client
    is kept with is qBittorrent's to have, so `apply` makes it.
- **Settings Mediaplane manages in qBittorrent are put back.** A whitelist, a save path
  or a category's path changed in qBittorrent's web UI is undone by the next `apply`
  (S3c). Keep mine must cover them, with the arrs' download clients and root folders.
  - **Done in S8:** drift reports each, and `mediaplane keep` keeps a whitelist, a save
    path, a category's path, and a download client's category, which qBittorrent's
    category then follows. A root folder's fields are fixed: one deleted is kept as
    `unmanaged`. A download client's host, port and TLS are fixed too: they say where its
    key goes.
- **Appdata ownership is checked only on change.** Apply checks it only when
  something else changes, and never re-checks it for apps that are running.
  - **Moved to M2 (`doctor`):** it is the host's state, not a change in an app.
- **An override can move an appdata mount.** When `compose.override.yaml`
  remaps an app's appdata mount, the ownership helper's chown runs on the
  override's host path, not on `appdata/<app>`. Pre-start files (S3a) are still
  written to `appdata/<app>`, so the app starts without them, and nothing reports
  it.
  - **Moved to M2 (`doctor`),** for the same reason.
- **Installs from before Slice 3a.** `plan` reports a `config.xml` without `ApiKey`,
  a `qBittorrent.conf` without `WebUI\APIKey`, or Gluetun's `auth/config.toml` without
  Mediaplane's role, as `<app>.not-seeded`, and the app READMEs give the manual fix.
  Automate it: stop the app, add the stored key to its file, and start it ("restore
  the key at the source", spec §6.3).
  - **Moved to S10 on 2026-10-25,** with restoring a key at its source.
  - **Done in S10a:** `apply` stops the app, puts the key in its file, and starts it
    again. A file Mediaplane can't write so is `keys.restore` (an error when the file
    holds no key, a warning when it holds another, and a warning when Mediaplane can't
    read the file, a link included, so can't tell); `not-seeded` remains only for a
    pre-start file whose app has no writable key file.
  - **Also in S10a:** a first-run setup that would sign in with an admin password its app
    has never had is held (`bootstrap.needs-password`), and `shared.adminPasswordNotIn`
    in `state/secrets.json` lists, by id, every app that lacks a newly generated
    password, from the write that saves it until the run gives it to the app. The
    state files keep the fields they don't know. The spec's §11 has the details.
- **FlareSolverr's anonymous volume.** Its image declares `VOLUME /config`, and the
  catalog mounts nothing there, so every container it creates leaves an anonymous
  volume behind. Mount a folder there, or document it. (The end-to-end helpers
  remove them with `down -v` since S3a.)
  - **Moved to S9:** each recreate leaves one, and recreates come with updates. Mounting
    a folder there needs the image's user probed first.
  - **Done in S9:** probed: the image runs as uid 1000 and keeps nothing in `/config`, and
    Compose carries an anonymous volume over to a recreated container (so it is a removed
    container that leaves one), even past a `tmpfs` there; only a bind mount replaces it.
    So `appdata/flaresolverr` is mounted there, owned by uid 1000.
- **Rotating the admin password.** There is no way to replace the generated password
  yet. Add one, which reaches every app through its API.
  - **Moved to S10 on 2026-10-25.**
  - **Done in S10a:** `apply --rotate admin.password`, and `plan` with it, set a new one
    through each app's key, as after a lost `state/`.
- **A wiring network whose settings change.** Compose must make it anew then, and
  through the socket proxy it can't delete a network (S3b). The wiring failed runbook
  gives the steps by hand. Decide whether Mediaplane should do them.
  - **Moved to S9:** its settings change only with Mediaplane's own updates.
  - **Decided in S9:** Mediaplane doesn't make it anew: through the socket proxy it can
    delete no network, and no proxy permission is added. No release changes its settings
    (the render test pins them); one that had to would bring its own steps in its notes.
    The update end-to-end test shows an update leaving it as it is.
- **The `partial` outcome.** Spec §5 step 12 names `success`, `partial` and `failed`.
  Apply records `failed` when part of the wiring failed (S3b). Decide whether drift's
  re-apply needs `partial`.
  - **Decided in S8:** not needed. Re-apply is `apply`, and `failed`, with each
    resource's result, says what is left; `partial` stays unused.
- **Links to an app that leaves the stack.** Remove Sonarr or Radarr from `stack.yaml`,
  and Prowlarr keeps its link to it (S4), as the arrs keep their download client when
  qBittorrent goes; so does Prowlarr's indexer proxy, when the stack drops its
  Cloudflare solver, and requests of indexers tagged `cloudflare` that meet a Cloudflare
  challenge then fail. Spec §8.1(3) step 4 asks that an app's links go with it. Decide
  whether `apply` removes what it made, or drift reports it.
  - **Done in S8:** drift reports each as still in the app, and `mediaplane keep
    <app>.<resource>` stops it. **Moved to S10:** removing them, which needs a delete
    for every kind of resource, and its own end-to-end test (spec §8.1(3) step 4).
    **Moved to S10b:** it changes what the stack holds, not what Mediaplane recovers.
  - **Done in S10b:** `apply` removes each, while its app holds it as Mediaplane made it,
    and nothing of yours is in it; drift says why it leaves one. The end-to-end test takes
    Radarr and the solver out of a running stack.
- **Settings Mediaplane manages in Prowlarr are put back.** A link's addresses, sync
  level or categories, or the proxy's host, timeout or tags, changed in Prowlarr's web
  UI, are undone by the next `apply` (S4). Keep mine must cover them.
  - **Done in S8:** Keep mine covers the sync level, categories, the proxy's timeout and
    tags. The links' addresses and the proxy's host are fixed: they say where a key, or
    your indexers' requests, go.
- **Mediaplane never tests the indexer proxy.** It holds no secret, so `plan` sends no
  test of it (S4). Prowlarr runs the test itself when it creates the proxy, by having the
  solver fetch a page of Prowlarr's own service on the internet, so that `apply` needs
  the internet. Decide whether drift tests it, and how often.
  - First, check whether Prowlarr's own health check tests the proxy, and use it: drift
    could read `GET /api/v1/health` instead of running a test.
  - **Done in S8:** Prowlarr's own health check does test it, every six hours (probed):
    drift reads it, and never tests the proxy.
- **`plan`'s key checks can record a failing status in the app; drift runs them on a
  schedule.** A failing test of a download client (S3c), a Prowlarr link (S4) or an
  arr's connection to Jellyfin (S5) records a failure in the app's status of it
  (`DownloadClientStatus`, `ApplicationStatus`, `NotificationStatus`), as a test from
  its web UI does, and a later pass resets it (S4's and S5's probes). Decide whether
  scheduled drift may do that.
  - First, probe the row under repeated failing checks. The apps may escalate it, and
    disable the client or link for growing periods, which could block Prowlarr's sync
    to that arr and raise a health warning. S4's probe saw only escalation 1.
  - **Done in S8:** probed: escalation stays at 1, and once the first failure is five
    minutes old, each failing test disables the client for a minute. Drift and `plan`
    test no more a secret drift found refused, as the owner decided.
- **The shared provider schema doesn't check `enable` is a boolean** (S4). A download
  client an arr gives back without it reads as disabled, and plans an `enable` update.
  Real arrs always send it. Check it with drift, which reports expected against actual
  for every managed field.
  - **Done in S8:** a field of another type is reported as one Mediaplane can't read.
- **Categories or tags in an unexpected shape read as empty** (S4, as S3c's code), so
  every `apply` plans an update, with no message. Decide how drift reports a value it
  can't read.
  - **Done in S8:** reported as a value Mediaplane can't read, never as empty.
- **Jellyfin's key, deleted by hand,** shuts Mediaplane out of Jellyfin (S5): `plan`
  warns, and the runbook has the key removed from `state/secrets.json` so that `apply`
  signs in as the admin and makes another. Automate it, with key recovery: a key
  Jellyfin refuses, while its wizard is done, is made anew, and the arrs' connections
  take it.
  - **Moved to S10 on 2026-10-25,** with key recovery. Drift reports it, as Jellyfin
    refusing its key.
  - **Done in S10a:** `plan` lists Jellyfin's setup again, published, while its wizard is
    done, and `apply` signs in, makes the key, and gives it to the connections.
- **Checking Jellyfin's admin password signs in** (S5), and Jellyfin's activity log keeps
  three lines for each check. Drift every 15 minutes (M2) would add about 300 a day.
  Decide whether drift checks it less often.
  - **Done in S8,** as the owner decided: drift checks it once a day at most, while it
    passes.
- **Jellyfin's libraries are known by name** (S5). A library renamed by hand is left
  as it is, and the next `apply` makes `Movies` or `Shows` again, on the same folder, so
  the folder is in two libraries. Decide whether drift reports the renamed one. A folder
  added to them by hand is put back: Keep mine must cover `paths`.
  - **Done in S8:** a renamed one is reported deleted; `apply` refuses to make it again
    on the folder the renamed one holds, saying what to do; `paths` can be kept.
- **The triggers of an arr's connection to Jellyfin are the user's** after it is made
  (S5): a connection whose triggers were all turned off by hand still passes its test,
  and tells Jellyfin of nothing. Decide whether drift reports it.
  - **Decided in S8:** not reported: they are yours (spec §6.2), and reporting them would
    be managing them.
- **A Jellyfin whose appdata Mediaplane can't read** (S5) is taken as set up when its key
  is stored, so an emptied appdata there would start it published. `plan` already warns
  (`bootstrap.unreadable`). Decide whether drift should also report it.
  - **Decided in S8:** drift runs `plan`'s checks of the setups, so it warns
    (`bootstrap.unreadable`) as `plan` does.
- **A failed first-run setup stops all wiring** (S5): the bootstrap step's failure skips
  the wire step, as a failed start does. Let the wire step run past a failed first-run
  setup, with that app's resources failed so `requires` skips them (spec §5.1). S6 did
  this for a setup that waits (Seerr's, while Jellyfin refuses the shared admin), whose
  app's resources are skipped; a failed one still stops the wiring.
  - **Moved to S10:** it changes apply's steps, not drift.
  - **Done in S10a:** the wire step runs past it, skipping that app's resources and what
    requires them; verify doesn't run.
- **Seerr's checks log a line when they fail** (S6, probed): Seerr's own test of a
  server, and its list of Jellyfin's users that checks its Jellyfin key, log an error in
  Seerr's log, and a refused key one in the arr's. Decide how often scheduled drift may
  run them.
  - **Done in S8:** probed again, one line each, with no throttling; drift checks no
    more a secret it found refused.
- **Seerr's Jellyfin key is checked twice in one `apply`** (S6): once as the
  resource's check, and again in the update that follows it, so a key Jellyfin refuses
  writes a second error line in Seerr's log. Check it once, with the item above.
  - **Done in S8,** as the owner decided: the update is told the key was refused, and
    doesn't check it again.
- **Seerr keeps its own Jellyfin key** (S6): the one its first sign-in made, named
  `Seerr` in Jellyfin, which Mediaplane checks by using and never keeps, so it can't be
  rotated; it is redacted only once Mediaplane has read it in that run. Mediaplane gives
  Seerr its own Jellyfin key only when Seerr's is refused, or Jellyfin moves. Decide
  whether drift should replace it, and remove the one Seerr made.
  - **Decided in S8:** drift never writes to an app. Replacing it is rotation: moved to
    S10.
  - **Moved to S10b,** with the other rotations of what Seerr holds.
  - **Done in S10b:** the first time Mediaplane records the link, it gives Seerr its own
    Jellyfin key, and has Jellyfin remove the one Seerr held, when Jellyfin lists it as
    Seerr's (`adoptSets`, the record's `given`): one key to rotate.
- **A Seerr whose `settings.json` Mediaplane can't read** is set up again, unpublished,
  on every `apply` (S6): two recreates each time, with a warning, and `apply` fails at
  verify (exit 1) each time, until the file is readable. Decide whether drift reports
  it, or asks Seerr over the wiring network instead.
  - **Decided in S8:** drift warns as `plan` does. Asking Seerr over the wiring network
    instead changes its setup: moved to S10.
  - **Moved to S10b,** with Seerr signed in again. S10a reads its key from that file
    too, and a file it can't read stops `plan` (`keys.unrecoverable`) when the store
    lacks the key.
  - **Done in S10b:** a Seerr Mediaplane set up is asked itself whether its setup is
    open (`Bootstrap.open`), and set up again only if it says so, or can't be asked.
- **Seerr's libraries are enabled by name, from Seerr's last sync** (S6). A library made
  anew in Jellyfin has a new id; `plan` reads Seerr's last sync, which `apply` refreshes
  only when the libraries differ. Decide whether drift syncs them, which writes to Seerr.
  - **Decided in S8:** drift doesn't sync them, which would write to Seerr; `apply` syncs
    them when the libraries differ, or Jellyfin moves.
- **Seerr's servers are its default** (S6): making `Sonarr (Mediaplane)` the default
  clears a default of yours of the same kind, and a profile changed in Seerr is put back.
  Keep mine must cover the servers' fields, and Seerr's libraries.
  - **Done in S8:** Keep mine covers the servers' profile, folder and `isDefault`, and
    Seerr's libraries. Their host and port are fixed: they say where a key goes.
- **A folder with a comma in its name, added by hand to a Jellyfin library** (S5), is
  never removed, because `paths` is joined with ",": `apply` tries to remove the
  pieces, which Jellyfin answers 404, so the library fails on every `apply`. Re-read
  `Locations` in `update`, with Keep mine's change to how `paths` is held.
  - **Done in S8:** the update reads Jellyfin's folders whole; drift reports such a
    folder as one it can't list, and Keep mine refuses it.

**S9 and S10 (before going public):**

- **Split on 2026-10-25.** S9 takes the release items: the licence, `main`'s
  protection, Renovate and the pins outside the catalog, publishing the image, the
  registry rate limits, Node's vulnerabilities and the Docker version CI tests. S10
  takes the rest: the docs, the `--json` contract, the Plex job's items and the test
  gaps.
  - **Settled in S9,** each as the item says below. `main`'s protection is the owner's
    to set: the S9 plan gives the settings for light and strict, and recommends strict.
  - **S10's are S10b's** (split on 2026-10-26): S10a settles none of the items below.
  - **S10b's are S10c's** (split again on 2026-10-26), but for Jellyfin's database read,
    done in S10b, as its item says.
  - **Settled in S10c,** each as its item says below.
- **Decided by the owner on 2026-10-17:**
  - the licence is GPL-3.0-or-later (**done in S9:** every `package.json`'s `license`,
    the image's label, the README and the spec);
  - no code of conduct, and no community-support material such as issue templates or
    CODEOWNERS: Mediaplane is one person's project, published so others can use it.
    Security reports keep GitHub's private reporting;
  - `main` is protected in S9, light or strict to be chosen then.
- **The nightly Plex job** (S7) needs the secret `PLEX_TOKEN` (owner): the token of a
  plex.tv account kept for tests, never your real one. Until it is set, the job does
  nothing. It claims a server each night on each architecture, one at a time, since
  both share the account, and each removes only the servers it noted, in its last
  step; a run killed before that step leaves one on the account, which the next run
  doesn't remove. Decide whether a weekly sweep removes every server of the test
  account.
  - **Settled in S10c: no sweep for now.** `pnpm exec tsx test/e2e/plex-cleanup.ts` with
    the account's token removes the servers a run noted; one a killed run leaves is
    removed by hand, in the account's settings. A sweep stays the owner's choice, listed
    under M2.
- **Keep `PLEX_TOKEN` in the `plex` environment, limited to `main`** (S7, owner). The
  job already names `environment: plex`, so this needs no workflow change. The job
  checks its branch, but only the environment's limit stops a branch's own copy of the
  workflow from reading the secret, for whoever can push a branch.
  - **Still the owner's step** (S10c's completion checklist lists it).
- **A 429 from plex.tv counts as "couldn't tell"** (S7): it is retried after 5 and 15
  seconds, and still fails closed, but its error says to run `apply` again rather than
  that plex.tv refused. Its `Retry-After` is not read: the waits are fixed. Revisit both
  if plex.tv's limits bite.
  - **Settled in S10c: unchanged.** They haven't bitten in the nightly job; moved to M2,
    to revisit if they do.
- **Docker's default bridge network** (S7): the plex.tv helper needs it. A daemon set up
  with `"bridge": "none"` fails the helper. Decide whether `plan` checks for it on a Plex
  stack.
  - **Settled in S10c: `plan` doesn't.** It is the host's set-up, not the stack's, and a
    rare one; the helper's failure says what failed. Moved to M2, for `doctor`, which
    checks a host.

- **Repo setup (owner):** enable GitHub private vulnerability reporting, which
  `SECURITY.md` relies on. Choose GPL-3.0-only or GPL-3.0-or-later and add the
  SPDX `license` field.
  - **Done in S9:** the SPDX field (GPL-3.0-or-later). Private vulnerability reporting
    stays an owner's step: the S9 plan gives the command, and S10c's completion
    checklist lists it.
- **Docs:** make the `--json` contract explicit (pin its fields and document
  `mediaplane.plan/v1`). Drop the internal "Slice 1" wording from the README.
  - **Done in S10c:** the [`--json` reference](../reference/json.md) and a JSON Schema per
    document, generated from `packages/cli/src/contract.ts`, which a test checks every
    printer against; the README names no slice.
- **`plan --help` names `docs/security/threat-model.md` by its repo path** (S4). Someone
  running the published image can't open that. Point it at the published docs instead.
  - **Done in S10c:** `plan --help`, `drift --help` and the hint of a missing
    `stack.yaml` give the published docs' address (`docsUrl`).
- **`credentials --json` has no `ok` field.** `init`, `plan`, `apply` and the error
  envelope all carry one, and the success output of `mediaplane.credentials/v1` doesn't.
  Align it in the `--json` pass: adding `ok: true` is additive within v1.
  - **Done in S10c:** `ok: true` on `credentials`, `status`, `history` and
    `history <id>`, so every document has it.
- **Tests:** tighten the catalog tag test, and add Renovate.
  - **Renovate done in S9;** `scripts/supply-chain.test.ts` also checks that Renovate can
    read each pinned tag. Tightening the catalog's own tag test stays S10's. Let
  `test/e2e/deploy.e2e.test.ts` deploy with `deployMediaplane()` from
  `test/e2e/helpers.ts` (S3d), as the VPN test does.
  - **Done in S10c:** a catalog tag must name a version (`^v?\d+\.\d+`), never a tag
    that moves; the deploy test deploys with `deployMediaplane()`.
- **Small test gaps from S3c and S4.** None hides a fault, and coverage holds without
  them:
  - the folder helper's last two guards have no test: an error from the runtime that
    isn't a `RuntimeError`, and a mkdir that fails with nothing on stderr;
  - `servarrFailure`, shared in `test/e2e/helpers.ts` since S4, doesn't cut an arr's
    message to one short line, so a failing run could print a long one in CI's log. It
    is redacted, and never reads an `attemptedValue`;
  - the VPN and download end-to-end tests each list the same four teardown steps.
    Sharing them needs the helpers to take a project name, so it is worth it only if a
    third such test comes;
  - the fake indexer's setup (`test/e2e/indexer.ts`, S4) repeats `wireguard.ts`'s
    echo-server setup. Sharing it isn't a plain move;
  - `wireguard.ts` sets its "removed" flag before removing, so a failed removal isn't
    tried again. Nothing calls its `remove()` twice.
  - **Settled in S10c:** the folder helper's two guards are tested; `servarrFailure`
    gives one line of at most 200 characters, tested; `wireguard.ts` marks itself
    removed only once it is. The shared teardown steps stay as they are (no third such
    test came), and so does the echo server (sharing it isn't a plain move).
- **A first-run setup that never gets ready waits twice its deadline** before it reports
  (S5): the `ready` wait, then the `open()` re-check. Give the re-check a short per-call
  deadline.
  - **Done in S10c:** a setup whose app isn't ready in time isn't asked again, so it fails
    after one deadline; it stays unpublished (an app Mediaplane couldn't ask is open).
- **The Jellyfin end-to-end test joins its container-ID claims** in one
  `toEqual([true, true])` (S5), so a failure doesn't say which claim broke. Split them.
  - **Done in S10c.**
- **The deploy end-to-end test restores the secret store after `plan`,** but not in a
  `finally` (S5). Move the restore into one.
  - **Done before S10c:** the restore is in a `finally`.
- **A test timeout skips `composeDown`** in the end-to-end files (S6): their teardown
  runs in the test body's `finally`, which a timeout doesn't wait for, so the stack can
  be left up. Fix it in the harness, for every file at once.
  - **Done in S10c:** `test/e2e/setup.ts`, after each file, removes whatever its tests
    left in Docker, by the run's names, and fails the file naming it. A test that times
    out still leaves its body running until the file ends.
- **Two wide tables** (S5): convert the README's capability table and the threat
  model's asset table to lists.
  - **Done in S10c:** both are lists, and so are the README's table of the stack and
    `CONTRIBUTING.md`'s of commands.
- **A second app with a first-run setup** (S5): S6 brought it, Seerr. So a Jellyfin
  `apply` started published, whose re-check still says its wizard is open, keeps its
  ports in the publishing `up` that Seerr's setup brings: its error says that it is
  published, and to stop it. Nothing new is exposed, since it was published already.
  Take the ports away, and say so.
  - **Moved to M2 in S10c.** Taking the ports away in that `apply` wouldn't last: Jellyfin's
    own `system.xml` says its wizard is done, which is what `plan` goes by, so the next
    `apply` would publish it again. The fix is for `plan` to ask Jellyfin itself, as it
    asks Seerr when its file can't be read (S10b): a check of the kind `doctor` makes.
    Until then the error says it is published, and to stop it.
- **Pins outside the catalog.** Renovate must also bump the images pinned in:
  - `Dockerfile` (`node`, `docker:*-cli`);
  - `deploy/mediaplane.compose.yaml` (`wollomatic/socket-proxy`);
  - `.github/workflows/ci.yml` (Trivy and gitleaks), `.githooks/pre-commit`
    (gitleaks), `test/e2e/helpers.ts` (busybox) and `test/e2e/wireguard.ts` (the
    `lscr.io/linuxserver/wireguard` test server, rebuilt weekly upstream).

  Every catalog pin bump must also run `pnpm docs:generate`, because each app
  README's facts block shows the pin.
  - **Done in S9:** Renovate's custom managers find each of these, and each catalog pin
    (tag and digest), with a versioning rule for each linuxserver.io tag (probed with
    Renovate's own lookup); a test fails when a pinned image is written anywhere else.
    The hosted Renovate can't run `pnpm docs:generate`, so CI's docs check fails the
    bump until it is run on the branch, and Renovate's pull request says so.
- **Node's own vulnerabilities.** Node comes with the image's `node` base as a
  binary, not an Alpine package, so neither Trivy nor `pnpm audit` sees it (S2c).
  It stays current only when Renovate bumps the `node` pin in the `Dockerfile`.
  Decide whether CI should also check Node's version against Node's security
  releases.
  - **Decided in S9: yes.** `scripts/ci/node-security.ts` fails CI, on every pull request
    and weekly, while Node's index lists a security release of the image's line newer
    than the image's Node. It found one at once (24.22.1, over 24.21.0), so S9 bumps the
    pin.
- **The Docker version CI tests.** The runners' Docker moves with GitHub's images,
  so the supported floor, Docker Engine 24, is not tested in CI (S2c). Decide
  whether to test it.
  - **Decided in S9:** the floor's risk is the API the image's own Docker CLI and Compose
    speak, so CI's `engine-floor` job runs them against Docker Engine 24 in Docker, with
    the calls Mediaplane makes (probed: they pass). The full end-to-end suite stays on
    the runners' Docker, which would take twice as long to run again on 24.
- **Publish the image,** and give `MEDIAPLANE_IMAGE` in
  `deploy/mediaplane.compose.yaml` a pinned default. Then the install guide can pull
  instead of build.
  - **Done in S9,** from the first release: a release's own deploy files pin its image
    by digest; the repository's leave it out, so a checkout builds. The first release is
    the owner's.
- **Registry rate limits in CI** (S6). S5's first arm64 run failed on
  `toomanyrequests` during `docker compose pull`, after apply's four tries: the runners
  pull every image afresh, anonymously. Pull with a read-only registry token kept as a
  secret (never given to fork PRs), or through a pull-through cache, for the e2e and
  image jobs. S6 adds no image: each e2e file pulls only what is missing.
  - **Done in S9:** with the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (the
    owner's, a "Public Repo Read-only" access token), the jobs that pull images log in to
    Docker Hub; without them, as in a fork's pull request, they pull anonymously. A
    revoked or wrong token fails the job, with no fallback; removing the secrets goes back
    to anonymous pulls, and with only one of the two a job warns and pulls anonymously.
    GHCR's and lscr.io's pulls stay anonymous, and apply's own pull retries stay.
- **Which Compose versions work out a service differently (open, for S10c).** Updating
  Mediaplane never touches the stack, but a later `apply` runs the image's own Docker
  Compose, and Compose 5.5.1 recreated containers made by 2.38.2 from an unchanged file.
  So the first `apply` after an update that changed the bundled Compose may recreate every
  app container (a restart, keeping their data). S9 says so in the deploy guide and in
  the guidance for a release's notes. S10: probe which pairs of Compose versions differ,
  and say so in Renovate's pull request for a Compose bump.
  - **Done in S10c,** probed with eleven releases of Compose: 2.29.7 to 2.40.3 agree, and
    so do 5.0.2 to 5.6.1, but a 2.x and a 5.x differ for every service but Byparr, and
    2.24.0 differs from later 2.x for Gluetun and qBittorrent. `docs/releasing.md` says
    so, and, once the Renovate app is installed (an owner's step), Renovate's pull request
    for a bump of the image's `docker` says what to check.
- **From S9's reviews, for S10c.** None hides a fault in S9's releases:
  - a test that Renovate can read the tag of each image pinned outside the catalog
    (busybox, Trivy, gitleaks, actionlint, Node, Docker, the socket proxy, BuildKit,
    BuildKit's SBOM scanner, the registry), as
    `scripts/supply-chain.test.ts` does for the catalog's and WireGuard's;
  - `install.sh` clears the shell's `COMPOSE_*` settings, but not `DOCKER_HOST` or
    `DOCKER_CONTEXT`, so a shell that sets one points Compose at another daemon than
    the socket the installer checked. Unsetting them or refusing them is a choice to
    make;
  - `plan`, `apply` and `drift` read `stack.yaml` with a plain read, so a named pipe in
    its place makes them wait. `migrate` refuses one, and its file check could serve
    them too;
  - the indexers end-to-end test could check that `appdata/flaresolverr` is owned by
    the stack's user and group (1000), replayed on both Composes.
  - **Done in S10c:** a test that Renovate can read every pinned tag, outside the catalog
    too; `install.sh` refuses a `DOCKER_HOST` or `DOCKER_CONTEXT` that would point
    `docker` away from the socket it checks (refused, not unset: whoever set one meant
    it); every command that reads `stack.yaml` refuses a named pipe or a folder in its
    place, without waiting (`config.not-a-file`; `keep.stack-file` and
    `migrate.stack-file` for `keep` and `migrate`); the indexers test checks that
    `appdata/flaresolverr` is owned by 1000:1000, replayed on both Composes.
- **From S10a's reviews:**
  - read Jellyfin's database in a process of its own, with a deadline, so that a pipe
    a compromised Jellyfin puts at the database or its `-wal` can't hang `plan` (threat
    model, T4). That is a new way for the engine to start a process, so it gets its own
    design;
    - **Done in S10b:** Node itself, with a fixed program, no shell, an empty
      environment and the database handed to it open, killed after 10 seconds. Probed: a
      pipe at the database's name hangs SQLite's open; one at the `-wal` makes it refuse
      the read;
  - the pinned `--json` contract says what `history <id> --json` prints of a later
    release's record. Until then it prints `mediaplane.change/v1`'s fields only, and
    the fields it doesn't know stay in the file. **For S10c.**
    - **Done in S10c:** the reference says so: `history <id> --json` prints the fields
      this release knows, with `ok`, and one it can't read is said to be there, unread.
- **CI's end-to-end image pulls are flaky (for S10c, with the test gaps).** On
  2026-10-26, `apply.pull-failed` (four tries, a temporary registry error) failed the
  end-to-end job twice, on amd64 and arm64, and a rerun passed each time. Make the
  end-to-end tests robust against it, without weakening what `apply` itself reports:
  pull the catalog's pinned images in the job first, with retries and a backoff, or give
  the harness a longer retry budget than apply's.
  - **Done in S10c:** the end-to-end job pulls every image the suite runs first
    (`scripts/ci/pull-images.ts`), tried again after 15 s, 30 s, 1, 2 and 4 minutes on a
    temporary registry error; `apply`'s own pulls, retries and reports are unchanged.
- **Before the first real migration** of `stack.yaml` (none is planned, S10a to S10c
  included; spec §11, Slice 9): make the commands that only read `stack.yaml`
  (`credentials`, `vpn-check`, `plex-login`) give the old-version warning, which they
  drop today; and make `keep` refuse an older-version file, saying to run `migrate`
  first, rather than write overrides in the old version's shape.
  - **Not M1 work, and still open.** It applies when the first migration is planned (none
    is planned yet): that slice's plan takes it up.

**The panel (not scheduled since 2026-10-25):**

- `trigger: 'cli'` is a literal in `mediaplane.change/v1`. Fields may be added
  within v1 when they are optional (spec §11, Slice 3a); decide whether a new
  trigger is one, or needs a v2, before the panel writes change records.
- **Servarr `TRUSTEDNETWORKS` and Mediaplane's network (ruling R12).** Once the panel
  proxies requests to the apps, add its network, so Sonarr believes the
  `X-Forwarded-For` header it sends (spec §11, Slice 3a).

**M2 (everyday CLI):**

- **From S10c**, as their items above say:
  - a Jellyfin `apply` started published whose wizard still looks open: have `plan` ask
    Jellyfin itself, then take its ports away;
  - `doctor`: Docker's default bridge network, which the plex.tv helper needs;
  - plex.tv's `Retry-After`, and its 429s, if they bite;
  - the owner's choice of a weekly sweep of the Plex test account's servers;
  - the other files a command reads (secret files, `state/*`, generated files), which can
    still block on a named pipe: guard them as `stack.yaml` is now.

- **From S8, for `doctor`:** appdata ownership, checked only when something else changes,
  and an override that moves an appdata mount, which leaves the pre-start files where the
  app doesn't look. Both are the host's state, not a change in an app.
- **Drift on a schedule** (spec §6.3): `drift` takes apply's lock and checks no more than
  it must (S8), so a schedule can call it as it is.

- **A `network.lan_subnet` that covers the stack's Docker networks.** With
  `security.login_on_lan: false` and the web UIs on the LAN, qBittorrent lets any
  sign-in from the LAN subnets through (S3c, threat model T2). A hand-typed subnet wide
  enough to cover a Docker network of the stack, such as `172.16.0.0/12`, lets every
  container there skip qBittorrent's login, and hides from `plan` a password changed by
  hand. Detected subnets leave Docker's own networks out. Warn in `plan` when
  `lan_subnet` overlaps the wiring network or the stack's own.

**Later ideas (M2 and after):**

- **Default quality settings for Sonarr and Radarr** (owner to discuss, 2026-10-17).
  Mediaplane leaves the arrs' quality profiles as they ship, and only picks Seerr's
  (`HD-1080p`, else `Any`). Decide the default (resolution, sources, size limits,
  language), and whether Mediaplane sets a profile of its own, offers presets in
  `init`, or leaves it to Recyclarr (M3); and how drift treats a profile changed by hand.
- **Use a media server you already run** (possible future feature, 2026-10-17). Two
  levels:
  - **Use it as it is:** an `external` media server, given by address and token.
    Mediaplane wires Sonarr, Radarr and Seerr to it, and never touches its container,
    data or claim. Integrations already reach the media server as an address and a
    credential, so this stays additive.
  - **Adopt it:** Mediaplane runs your existing Plex or Jellyfin, keeping its watch
    history, libraries and claim. That means starting from its appdata, mapping its
    media paths to `/data`, taking over its libraries by name rather than adding
    `Movies` and `TV Shows` beside them, an "adopted" mode for the open-settings check
    (allowed networks may be set on purpose), and the same for any existing Sonarr and
    Radarr. It builds on S10a's re-adoption by name and key recovery from appdata.
- **NVIDIA hardware transcoding.** `hardware_transcoding` gives the media server
  `/dev/dri`, which covers Intel Quick Sync and AMD. NVIDIA needs Docker's NVIDIA
  runtime instead: a later `gpu: nvidia` style option, tested on a host with the
  runtime.
- **Restrict what the proxy lets Mediaplane create.** The wiring network keeps
  Mediaplane's container offline, but the proxy still lets it create containers with any
  network, so that is defence in depth, not a wall (ADR 0011).

- **Windows and macOS through Docker Desktop or WSL2** (spec §1.5, later): a manual trial
  (2026-10-10) worked, but the port check can't see Docker Desktop's Windows-side ports.

- **An IPv6 egress check.** `vpn-check` measures IPv4 only (S3d): its route target is
  `1.1.1.1`, and its default URL is reached by an IPv4 address. When Docker's IPv6 is
  turned on for the stack, add an IPv6 egress check, so a leak over IPv6 shows.
- **A `leak` verdict on real Docker.** Unit tests cover every `leak` path of
  `vpn-check`, but no end-to-end test reaches one (S3d). Add one, for example a
  `network_mode` override for qBittorrent in the kill-switch test, so the leak path runs
  once against real Docker.

## Spec refinements made while planning (2026-10-08)

These were applied to the spec and keep its intent:

- **Compose version.** The bundled Compose CLI is v5.x. Preflight requires at
  least 2.24.
- **LAN binding.** `network.bind: lan` uses private IPv4 (RFC 1918) addresses in
  M1. IPv6 ULA comes later.
- **Secrets and seeding steps.** Catalog `secrets` are declared separately from
  `credentials` steps. "User-provided" is a secret source, not a step.
- **VPN address.** `vpn.addresses` is optional, for providers such as Mullvad.
  Other Gluetun settings go through `apps.gluetun.env`.
