# M1 Slice 9: releases and safe updates — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mediaplane gets versioned releases, and can be updated without touching the
stack (the roadmap's S9). From the first release, merging release-please's pull request
publishes Mediaplane's image for amd64 and arm64 to `ghcr.io/cyclopsgd/mediaplane`, with
an SBOM and provenance, and gives the release its deploy files, which pin that image by
digest, and the app versions it was tested with. `install.sh` installs such a release by
pulling it. Updating Mediaplane, or going back, recreates only its own container, which
an end-to-end test proves. CI scans the catalog's images, watches Node's security
releases and Docker Engine 24, and Renovate keeps every pin current. `mediaplane migrate`
rewrites `stack.yaml` to the current schema version, keeping its comments.

**Architecture:**

- **Releases** (spec §8.2): release-please keeps a release pull request on `main`.
  `.github/workflows/release.yml` publishes only when that pull request is merged, and
  only once CI has passed on the release's commit. Each architecture's image is built
  natively by `scripts/ci/build-image.sh` (pinned BuildKit, SBOM, provenance, the commit's
  time in every timestamp, so one commit builds one image), scanned by Trivy, then pushed
  by digest and checked to be the image scanned; one index of both is then tagged and
  attested. CI's `image` job runs the same build on every pull request, and pushes
  nothing.
- **A release's deploy files** (`scripts/release/deploy-bundle.ts`, through
  `scripts/release/pin.ts`) are the repository's `deploy/`, with the image named by digest
  in `install.sh` and in `mediaplane.compose.yaml`'s default. `install.sh` pulls it before
  anything is recreated, and refuses any image that isn't pinned but the one a checkout
  builds. Updating is the next release's files, `pull`, then `up -d`.
- **CI** gains the catalog images' Trivy scan (with a reviewed list of findings only
  upstream can fix, each with a date), a check of Node's security releases, a smoke test
  of the image's Docker CLI and Compose on Docker Engine 24, actionlint and shellcheck, a
  test of the workflows' and pins' rules, an optional Docker Hub token, and a weekly run.
- **`mediaplane migrate`** (spec §5.2): versioned migrations that say what they change as
  data and as text edits; load reads an older `stack.yaml` through them in memory, with a
  warning, and refuses a newer one; `migrate` rewrites the file as Keep mine does. There
  is no migration yet: `stack.yaml` has only been version 1.
- **Tests:** unit tests for every script and rule, the installer's sandbox, and two
  end-to-end tests: an update and a rollback on real Docker with a local registry, and
  FlareSolverr's mounts.

**Tech Stack:** as Slice 8 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). New in CI only: release-please-action
5.0.0, attest-build-provenance 4.2.2, upload-artifact 7.0.2 and download-artifact 8.0.2,
pinned by commit; BuildKit 0.34.0, buildkit-syft-scanner 1.12.0, actionlint 1.7.12,
Docker 24.0.9 (Docker-in-Docker) and registry 3.1.2, pinned by digest. No new npm
dependency. The image's Node goes from 24.21.0 to 24.22.1, a security release.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3, criterion 7 ("Honest docs"), §2.1 (the multi-arch image, CI/CD);
- §3.3 (the `yaml` Document API for `migrate`), §4.2 (schema versions, externally managed
  mode), §4.3 (the tested set), §4.4 (Mediaplane's own deployment, and how it is updated);
- §5 step 2 (an old version migrated in memory), §5.2 (`migrate`);
- §7.2(2) (the socket proxy) and §7.2(7) (the supply chain), §8.2 (CI/CD: every PR,
  Renovate, releases), §9 (the docs), §11 (every slice's refinements).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S9 row and its list, "After
M1" ("Updates happen only when you run them"), "CI architecture coverage", and every item
in "S9 and S10 (before going public)" that its 2026-10-25 split note gives S9 (the licence,
`main`'s protection, Renovate and the pins outside the catalog, publishing the image, the
registry rate limits, Node's vulnerabilities and the Docker version CI tests), the owner's
decisions of 2026-10-17, and the two S8 items moved to S9 (FlareSolverr's anonymous volume,
and a wiring network whose settings change).

Revised after the controller's pre-flight scan of the first version of this plan, as its
rulings of 2026-10-26 say: I1 to I3 and M1 to M13, each a fix. I2 took the wording route
(the tag and the release page exist from the merge, with the way back), not draft
releases. The decisions and tasks a ruling changed say so in their words.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown. A shell script then gets
  `chmod +x`, as its step says.
- **A changed file is given as a `diff` block** (`Change`): the exact `git diff -U1`
  output, with one line of context. Save it to a file and run `git apply <file>` from the
  repo root, or make the same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact, a
  schema description or the CLI says to run `pnpm docs:generate`, and names what it
  rewrites.
- Every block was applied in order to a fresh worktree at `bcfb8f7`, and each task's tests
  failed before its implementation and passed after it (see the completion checklist).

## Global Constraints

Everything in the Slice 1 to 8 Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md` to `docs/plans/m1-s8-drift.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses, hostnames, tokens or ids in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-admin-password`; fake digests are `sha256:` and 64 repeated
  digits. Addresses come from the documentation ranges, private ranges or `fd00::/8`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps but for its documented marks;
- Docker is reached only through the `Runtime` (the end-to-end tests and the CI scripts
  may call `docker` themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`, and never reach a real app, registry or plex.tv;
- the runtime refuses any Compose project that is not `mediaplane` or
  `mediaplane-<name>`, and never accepts `mediaplane-system`;
- every image is pinned by digest, and every GitHub Action by commit SHA, with its version
  in a comment;
- end-to-end test files run one at a time; names in them start with `mediaplane-e2e-`;
  teardown never stops at the first failure;
- never prune images (`docker image prune`, `docker system prune`);
- temporary folders in unit tests come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing`, or are removed in `afterEach`;
- coverage thresholds are never lowered: `vitest.config.ts` keeps 90% lines, functions,
  branches and statements on `packages/engine/src`;
- never push, tag, release, or publish anything; never change the repository's settings.

The spec's exact values for this slice, verbatim:

- §2.3, criterion 7: "**Honest docs.** The `stack.yaml` and CLI references are generated
  from code, and CI fails if they are out of date."
- §3.3: "**YAML:** the `yaml` package's Document API, so that writes to `stack.yaml`
  (Keep mine, `migrate`) **preserve the user's comments and formatting**."
- §4.2: "**Externally managed mode.** With `managed_by: external`, Mediaplane never
  writes `stack.yaml`. `migrate` and Keep mine print the snippet to add instead."
- §4.3: "**The tested set.** Each Mediaplane release pins every app by tag and digest.
  Those exact versions have passed the end-to-end suite."
- §4.4: "**How it is updated:** by the user, with `docker compose pull && up -d` on
  `mediaplane-system`. Self-update is out of scope for M1, and M3 revisits it."
- §5 step 2: "An old schema version is migrated in memory with a warning. Only
  `mediaplane migrate` rewrites the file."
- §5.2: "`migrate` | Rewrite `stack.yaml` to the current schema version, preserving
  comments".
- §7.2(7): "Images are pinned by tag and digest, and Renovate bumps both."; "CI runs Trivy
  (failing on critical vulnerabilities that have a fix), gitleaks and `pnpm audit`."; "The
  Mediaplane image is published with an SBOM and build provenance."; "GitHub Actions are
  pinned by SHA."
- §8.2, every PR: "a multi-arch image build"; Renovate: "**What it bumps:** catalog image
  pins (through a custom manager), npm dependencies, and Actions SHAs."; "**What every
  app-pin bump runs:** the full end-to-end suite."; "**Merging:** app-pin bumps are never
  auto-merged."; releases: "release-please builds versions and the changelog from
  Conventional Commits."; "Multi-arch images go to `ghcr.io/cyclopsgd/mediaplane` with an
  SBOM and provenance. The repo is `cyclopsgd/Mediaplane`, but GHCR requires lowercase
  image names, so workflows lowercase the name."; "Release notes include a generated
  "tested app versions" table."

These are added or restated for this slice:

- **Nothing outward-facing is done by this plan.** It designs and tests the release
  workflow, Renovate and `main`'s protection; publishing, tagging, releasing, merging the
  release pull request, installing the Renovate app, adding secrets and changing
  settings are the owner's steps, in the completion checklist.
- **A merge to `main` never publishes by itself.** Only merging the release pull request
  does, and only after CI passed on that commit. A pull request builds the release's image
  on both architectures and pushes nothing. No secret reaches a fork's pull request, and
  no workflow runs a pull request's code with secrets (`pull_request_target`).
- **Updating Mediaplane never touches the stack:** no app container, network or volume of
  the managed project is recreated, restarted or pulled, and `generated/` and `state/` are
  unchanged.
- **No new socket-proxy permission.** The allow-list in `deploy/mediaplane.compose.yaml`
  doesn't change; `deploy/deploy.test.ts` only gains a test that it already allows a
  release's image.
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Docker CLI 29.8.1 and Compose 5.5.1. The dev
  box has no amd64 emulation, so the amd64 build is CI's to prove.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes a catalog fact, a schema description or the CLI runs `pnpm docs:generate`
  first, and commits the generated files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. A release, a
    published image or an attestation is described "from the first release", with the
    build-from-source path until then.
  - Short, plain sentences; lists rather than wide tables; no internal jargon.
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.


## Decisions taken in this plan

The spec, the roadmap and the reviews leave these open. Each is marked `Decision:` where
it is applied. The ones to look at first are marked **(check)**; those that need the owner
say **(owner)**. Every fact below about a tool, an image or Docker was probed while
writing this plan, on this aarch64 dev box (Docker 29.8, Compose 5.5.1), unless it says
it wasn't: nothing was pushed, published or sent to GitHub or plex.tv.

1. **(check) Only a release publishes, and only a commit CI passed** (Tasks 1 and 5;
   §8.2). `release.yml` runs on a push to `main`, and its release-please job alone runs
   on every such push, keeping the release pull request. Every other job needs
   release-please's `release_created`, so a push that doesn't merge the release pull
   request publishes nothing; and release-please runs in `cyclopsgd/Mediaplane` only, so a
   fork's `main` publishes nothing. Before building, the release waits until CI's last
   job, `All checks passed`, has passed on the release's commit
   (`scripts/release/ci-passed.sh`, up to 90 minutes, counting GitHub Actions' own check
   run only): the tested-set guarantee of §4.3 holds for the image too. Each job checks
   out the release's tag. The tag and the release page itself exist from the merge:
   release-please makes them before CI has passed. If CI then fails on that commit,
   nothing else is published, no image and no deploy files; `docs/releasing.md` says so,
   and gives the way back (`gh release delete v<version> --cleanup-tag`, fix, and let the
   next release pull request cut a new version). A draft release, published by the last
   job, would close that gap, but can't be probed without GitHub (the controller's
   ruling of 2026-10-26: say it, rather than build it).
2. **(check) Each architecture is built natively, scanned, then pushed by digest, and
   checked to be what was scanned** (Tasks 3 and 5; §2.1, §7.2(7), §8.2). The dev box has
   no amd64 emulation (`/proc/sys/fs/binfmt_misc` has no `qemu-x86_64`), and the roadmap's
   CI runs natively, so there is no QEMU build. `scripts/ci/build-image.sh <arch> <out>`
   builds with a `docker-container` builder of its own (BuildKit 0.34.0, pinned), an SBOM
   (buildkit-syft-scanner 1.12.0, pinned) and provenance (`mode=max`), with
   `SOURCE_DATE_EPOCH` from the commit and `rewrite-timestamp=true`, into an OCI layout
   that Trivy scans (`scripts/ci/scan-image.sh`). Probed: two builds of one commit, the
   second from a builder made afresh, gave the same image manifest digest (the
   attestation manifests differ: they hold the build's times); Trivy scans the OCI layout
   by platform; a push by digest to a local registry (`push-by-digest=true`) held that
   same manifest, and `docker buildx imagetools create` made a tag of it, whose SBOM and
   provenance `imagetools inspect` shows. `build-image.sh <arch> <out> --push <name>`
   refuses to run before a build, pushes from the builder's cache, and refuses an image
   other than the one scanned. `scripts/release/publish-image.sh` tags one index of both,
   and checks it holds one image of each architecture. On every pull request, CI's
   `image` job makes the same build on both runners and scans it, and pushes nothing:
   §8.2's "a multi-arch image build" for every PR is these two native builds. The amd64
   half is proven by CI only.
3. **(check) A release's deploy files pin its image by digest; the repository's don't**
   (Tasks 4 and 5; §4.4, roadmap "Publish the image"). A tagged commit can't hold its
   image's digest, which exists only once the image is built. So the repository's
   `install.sh` has `release_image=''` and its `mediaplane.compose.yaml` requires
   `MEDIAPLANE_IMAGE`, and the release workflow writes the release's copies
   (`pinnedInstaller`, `pinnedDeployment`), with the image named as
   `ghcr.io/cyclopsgd/mediaplane:<version>@sha256:<digest>`, into
   `mediaplane-deploy-<version>.tar.gz` (`deploy/`, and the licence), with `SHA256SUMS`, both
   attested. The archive is the same bytes for the same commit (fixed order, owner and
   time, gzip without a name). That is `MEDIAPLANE_IMAGE`'s pinned default: in the
   release's own file. Before the first release, the docs give the checkout path.
4. **(check) `install.sh` verifies the digest, and refuses an unpinned image** (Task 4).
   From a release's files it pulls the image by digest (`docker compose … pull`, the
   proxy's image too), so Docker checks every byte it pulls against the digest, before
   `up -d` recreates anything; a pull that fails leaves Mediaplane as it was. It refuses
   an image that isn't `<name>…@sha256:<64 hex>`, but for `mediaplane:local`, which it
   builds from a checkout, and refuses `mediaplane:local` where there is no checkout. A
   release's image goes unnamed in `deploy/.env`, so unpacking the next release over the
   folder and running its installer is the update; an image you name in `deploy/.env` is
   kept, with a note saying how to run the release's. It only ever runs Docker on
   `mediaplane.compose.yaml`: a sandbox test lists every call. Its Compose calls unset
   `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE` and `COMPOSE_PROFILES` too, which would move them
   to another project or file. Every installer test runs it in the sandbox, with stand-ins
   for `docker` and `sudo` first on `PATH`, so that a refusal that regressed would reach
   neither the real Docker nor `sudo`; the refusals check that no Docker call was made.
5. **(check) Updating is the next release's deploy files, then `pull` and `up -d`**
   (Tasks 4 and 5; §4.4). §4.4 says `docker compose pull && up -d` on
   `mediaplane-system`. With the image pinned by digest, `pull` with the same file
   changes nothing; with the next release's file it pulls that release. Going back is the
   same with an earlier release's files. `test/e2e/update.e2e.test.ts` proves it on real
   Docker: two builds of this checkout (told apart by a label) pushed to a registry of
   the test's own, deploy files made for each by `writeBundle`, Mediaplane deployed from
   the first with `pull` and `up -d --wait`, a stack applied, then the second release,
   `plan`, and the first again. Each time, every container of the stack has the same id,
   image, state, start time, restart count and mounts, the stack's networks are the same,
   and every file under `generated/` and `state/` (but `state/lock`) has the same digest;
   Docker's own events show that each deploy pulled only the release's image and the
   proxy's, and that `plan` pulled nothing; `plan` exits 0. The stack has no volumes of
   its own (every app's folders are bind mounts, which the mounts show), so none are
   compared. It took about 90 s on the dev box. This refines §4.4's wording, not its
   intent.
6. **(check) (owner) The catalog's images are scanned, and fail on what upstream can't
   fix only after a date** (Task 3; §7.2(7)). Probed: Trivy, from the registries, on all
   ten pinned images and both architectures, found critical vulnerabilities with a fix
   in five: FlareSolverr (Chromium, perl, certifi), Seerr (handlebars, next, tar,
   proxy-addr), Byparr (certifi), Prowlarr and Radarr (the ASP.NET Core runtime): 24
   ids. Only their upstreams can fix them (§1.4(1)), and Renovate already finds newer
   pins for four of the five. Failing every pull request on them would stop all work;
   not failing would drop §7.2(7)'s rule. So `scripts/ci/scan-catalog.sh` fails on any
   critical with a fix, but those listed in `scripts/ci/catalog-ignore.yaml`, each with
   the app it is in and an `expired_at` of 2026-11-24 (30 days); probed, an entry past its
   date fails again. Each entry has only an id, a statement and a date, never a path or
   package, so it can't hide a finding elsewhere by accident. Trivy exits 3 on a finding
   and 1 when it couldn't scan: a scan it couldn't make is tried twice more, after 15 and
   45 seconds, then fails CI as "couldn't be scanned" (the second replay of this plan met
   lscr.io's `TOOMANYREQUESTS` for three images; the retry was added then, and both of its
   outcomes probed: a pass, and every expired entry failing as a finding). The owner may
   prefer the scan to report only; that is one line in `ci.yml` (`continue-on-error`).
7. **Node's own vulnerabilities: CI checks Node's security releases** (Task 3; roadmap
   item). Node is a binary in the base, which neither Trivy nor `pnpm audit` sees.
   `scripts/ci/node-security.ts` fails while `https://nodejs.org/dist/index.json` lists a
   release of the image's major line, newer than the image's Node, marked `security`, and
   refuses an index that lists none of that line. Probed: it found 24.22.1 (2026-10-20, a
   security release) over the image's 24.21.0, so Task 3 bumps the pin (both `FROM`
   lines), and the image scans clean with it. It runs in the `check` job.
8. **The Docker version CI tests: Docker Engine 24, by a smoke test** (Task 3; roadmap
   item). The floor's risk is the API that the image's own Docker CLI 29.8.1 and Compose
   5.5.1 speak. Probed: against `docker:24.0.9-dind` (API 1.43), they ran every kind of
   call Mediaplane makes: `config --hash`, `config` with `!reset`, `up --wait` with a
   service in another's network and `depends_on.restart`, `ps --format json`,
   `run --rm --no-deps`, `run --pull never`, `network inspect`, `connect`, `disconnect`,
   `stop`, `down`. `scripts/ci/engine-floor.sh` runs that, in CI's `engine-floor` job
   (about a minute), with the CLI taken from the Dockerfile's `docker-cli` stage, so a
   Renovate bump of it is tested too, and Renovate keeps the Engine at 24. The full
   end-to-end suite stays on the runners' Docker: running it twice would double CI's
   longest job for a risk the smoke test covers.
9. **Registry rate limits: an optional Docker Hub token** (Task 3; roadmap item). The
   jobs that pull images run `./.github/actions/docker-hub-login` with the secrets
   `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`: with both, it logs in; without them, as in a
   fork's pull request, it says so and the pulls stay anonymous. The token reaches the
   action as inputs, and the shell through its environment. GHCR's and lscr.io's pulls
   stay anonymous, as they were, and apply's pull retries (S3a) stay. Trivy's catalog scan
   uses Docker's login when there is one.
10. **(check) Renovate** (Task 2; §7.2(7), §8.2, roadmap "Pins outside the catalog").
    `renovate.json`: a custom manager for the catalog's `image: { repo, tag, digest }`, one
    for `name:tag@sha256:…` in the workflows, the pre-commit hook, `scripts/ci/*.sh` and
    the end-to-end tests, and the docker-compose manager pointed at
    `mediaplane.compose.yaml`, whose name its defaults miss; the Dockerfile and the Actions
    are Renovate's own managers, with `helpers:pinGitHubActionDigests`. `ignorePaths` is
    `node_modules` only, because `config:recommended` ignores test folders. Each
    linuxserver.io tag gets a versioning rule (`<version>.<build>-ls<n>` and its
    variants). Node stays below 25 and Engine 24 at 24. Nothing merges itself; app pins
    are labelled `app-pin`, committed as `fix(catalog)`, and their pull request says to run
    `pnpm docs:generate`: hosted Renovate can't run commands, so CI's docs check fails the
    bump until it is run on the branch ("or CI tells it to"). Probed with Renovate 44.149.3:
    `renovate-config-validator --strict` passes, and Renovate's own extract finds every pin
    above; its lookup found newer versions for six catalog apps (such as Sonarr
    `4.0.20.3014-ls329`, qBittorrent `5.3.0_v2.1.2-ls485`), Node `24.22.1`, the Docker CLI,
    the proxy, Trivy, busybox and the WireGuard server, so each versioning rule parses its
    tags. `scripts/supply-chain.test.ts` checks the managers find every pin, and that a
    pinned image is never written where they don't look.
11. **(check) release-please** (Task 1; §8.2). One Node package at the root
    (`release-type: node`), tagged `v<version>` (`include-component-in-tag: false`), with
    the CLI's `package.json` and `VERSION` bumped as extra files, at release-please's
    markers (probed with release-please 17.11.2's own updaters, 0.0.0 to 0.1.0, and its
    schema). `bump-minor-pre-major`: before 1.0 a breaking change raises the minor
    number, a `feat:` the minor, a `fix:` the patch, so the first release is 0.1.0. No
    `bootstrap-sha`: the first changelog has every `feat:` and `fix:` since the start (311
    commits, under release-please's 500). `CHANGELOG.md` is left out of Prettier. The job
    uses `RELEASE_PLEASE_TOKEN` when set, so CI runs on the release pull request at once;
    with the default token, GitHub starts no workflow for it, so it is closed and
    reopened. Not probed: how release-please sees a release pull request merged by the
    owner's fast-forward push (`git push origin <sha>:main`) rather than GitHub's merge
    button. GitHub marks a pull request merged when its head lands on its base, which is
    what release-please looks for; if the first release shows otherwise, the owner merges
    the release pull request with GitHub's "Rebase and merge" instead.
12. **The licence: GPL-3.0-or-later** (Task 1; the owner's decision of 2026-10-17), as
    the SPDX `license` field of every `package.json`, the image's
    `org.opencontainers.image.licenses`, the README and the spec. `LICENSE` is the GPL v3
    text, which offers "any later version".
13. **(check) (owner) `main`'s protection: strict, recommended** (owner step; the owner's
    decision of 2026-10-17 left light or strict to S9). The owner merges by fast-forward
    push after a green pull request, so neither choice requires a pull request (that would
    refuse the push). Both require the one check `All checks passed`, from GitHub Actions
    (app id 15368), up to date (`strict: true`, which a fast-forward always is), linear
    history, and no force push or deletion.
    - **Light:** `enforce_admins: false`. The owner, an admin, is not held to it, so it
      stops only a force push or a deletion, and anyone else's push of an unchecked
      commit.
    - **Strict:** `enforce_admins: true`. The owner's own pushes need the check too: a
      fast-forward push of a pull request's green head passes; a push of a commit CI
      hasn't passed is refused. It turns "only a commit CI passed is published" from a
      habit into a rule, and is what the release workflow's `ci-passed` job relies on
      least. Recommended. Its cost: a release pull request needs CI first (the token, or
      close and reopen), and an urgent fix waits for CI, or the owner turns it off.
    - The exact `gh api` commands are in the completion checklist, as owner steps. Not
      probed (no settings were touched).
14. **(check) `mediaplane migrate`, with no migration yet** (Task 6; §3.3, §4.2, §5 step 2,
    §5.2). `stack.yaml` has only ever been version 1 (`z.literal(1)`), so no migration
    exists, and `migrate` says there is nothing to do. The machinery is real and tested
    with a made-up version 0 (`testing/migrations.ts`): a `Migration` says what it changes
    as data (`data`), for load, and as text edits (`text`), for `migrate`; `migrateSource`
    applies the edits and the version, and requires the new text to read as `data` says,
    or writes nothing. Load (`parseConfig`) reads an older version through the
    migrations, warning `config.old-version`; refuses a newer one (`config.newer-version`)
    and one with no path (`config.unknown-version`); `plan` shows the warning. `migrate`
    holds apply's lock, reads the file as Keep mine does (`readStackFile`: no link, no
    other names, its mode and group kept), writes it atomically in place of the file it
    read, and with `managed_by: external` writes nothing and gives the file as it should
    be, on standard output and as `text` in `mediaplane.migrate/v1` (§4.2's "print the
    snippet"). Textual edits, not a round trip through the Document API: S8 probed that a
    round trip moves comments. The docs say plainly there is nothing to migrate yet.
15. **(check) FlareSolverr's anonymous volume: a folder of its own** (Task 7; the S8
    item). Probed: the image runs as uid 1000 and declares `VOLUME /config`, which its code
    never reads or writes. Compose carries an anonymous volume over to a recreated
    container, so it is a removed container that leaves one behind (the S8 note said a
    recreate); and Compose keeps carrying it even past a `tmpfs` declared there (short
    and long syntax: the tmpfs is dropped), while a bind mount replaces it. So FlareSolverr
    gets `volumes: { appdata: '/config' }` and `runAs: 'fixed:1000'`, which apply's
    ownership step gives it. An existing install keeps its old anonymous volume once; the
    deploy guide says how to find it. That the bind mount takes the old volume's place on
    an existing install was probed (above), not tested: the indexers end-to-end test
    always starts FlareSolverr afresh, and a test of it would need a first deploy without
    the mount, then an `apply`.
16. **A wiring network whose settings change: never made anew by Mediaplane** (Task 7; the
    S8 item). Through the socket proxy Mediaplane can delete no network, and no
    permission is added. The render test already pins the network (`{ wiring: { internal:
    true } }`); `render/compose.ts` now says why it must stay, and that a release that had
    to change it would bring its own steps in its notes. The update test shows an update
    leaving the network (its id) as it is.
17. **Each job's token does only what the job does** (Tasks 2 and 5; §7.2(7)). Every
    workflow's top level is `{}` or `contents: read`; a test lists each job that asks for
    more, with exactly what. In `release.yml`: release-please writes contents, issues and
    pull requests; `ci-passed` reads checks; `image` writes packages; `publish` writes
    packages and signs (`id-token`, `attestations`); `assets`, the one job that installs
    npm packages, reads only and has no secret; `upload` writes contents and signs. The
    same test checks every Action is pinned by commit with its version, no
    `pull_request_target`, `workflow_run` or `issue_comment` trigger, no secret or event
    text pasted into a script (the repository's composite actions' scripts too, which get
    their inputs through env), `persist-credentials: false` on every checkout, and no
    `secrets.GITHUB_TOKEN`. `release.yml`'s permissions are written once, in
    `scripts/release/permissions.ts`, which both tests read. actionlint (with shellcheck) checks the workflows, and
    shellcheck the scripts, in CI.
18. **CI runs weekly too** (Task 3): a scan finds new vulnerabilities in pinned images, and
    Node publishes security releases, without a push. On a schedule there is no base
    commit, so every job runs.
19. **Release notes list the tested app versions, rather than a table** (Task 5; §8.2 says
    "table"). The owner reads on a phone: one item per app, its tag, then
    `repo@digest`, after Mediaplane's own image. This departs from §8.2's word, not its
    intent.
20. **No new Docker API call** (all tasks; §7.2(2), ADR 0008). The proxy's allow-list is
    unchanged; `deploy/deploy.test.ts` gains a case showing it already allows inspecting
    `ghcr.io/cyclopsgd/mediaplane:<version>@sha256:…`, the reference a release's
    deployment gives the host helper.
21. **The docs** (Task 8): the deploy guide (install from a release, verify, update, go
    back, move from a checkout, what an update never touches, what Slice 9 changes, and a
    line saying its links lead into the repository, since it also ships in a release's
    deploy files: the planner's choice, over rewriting each link to the tag), a new
    `docs/releasing.md` (the process, the tokens and secrets, a release that stops halfway,
    checking one), the root README, the architecture, the threat model (T7 rewritten, T18
    new), `CONTRIBUTING.md` (commits and pins), the FlareSolverr README, the wiring
    failed runbook, how it's built, the spec (§11 "Slice 9", its licence, and the earlier
    slices' "S9" promises) and the roadmap (S9 done, each item settled).
22. **S9 fits in eight tasks; no split.** S10 keeps what its list holds (the `--json`
    contract, the remaining docs, the test gaps, the README's wide table).


## File structure (new and changed in this slice)

The repository's root: `package.json` (`version`, `license`), `release-please-config.json`
and `.release-please-manifest.json` (new), `renovate.json` (new), `.prettierignore`, the
`Dockerfile` (the licence label, Node 24.22.1).

`.github/`:

- `workflows/release.yml` (new): release-please, then, for a release only: `ci-passed`,
  `image` (per architecture), `publish`, `assets`, `upload`.
- `workflows/ci.yml`: actionlint and shellcheck, Node's security releases, the release's
  own build in `image`, `catalog-images`, `engine-floor`, Docker Hub's login, a weekly
  run, and the gate over them.
- `actions/docker-hub-login/action.yml` (new).

`scripts/`:

- `supply-chain.test.ts` (new): the workflows' rules, every pin, and Renovate's managers.
- `ci/build-image.sh`, `ci/scan-image.sh`, `ci/scan-catalog.sh`, `ci/engine-floor.sh`
  (new); `ci/catalog-images.ts` (+test), `ci/node-security.ts` (+test),
  `ci/catalog-ignore.yaml` (new).
- `release/pin.ts` (+test), `release/deploy-bundle.ts` (+test),
  `release/tested-apps.ts` (+test), `release/ci-passed.sh` (+test),
  `release/publish-image.sh`, `release/workflow.test.ts`, `release/release.test.ts`
  (new).

`deploy/`: `install.sh` (a release's image, pinned, pulled; unpinned refused),
`mediaplane.compose.yaml` (one comment), `deploy.test.ts`.

`packages/engine/src/`: `config/migrations.ts` (+test), new: `STACK_VERSION`,
`Migration`, `Edit`, `MIGRATIONS`, `migrateData`, `migrateSource`; `config/load.ts`
(+test): versions; `config/schema.ts`: `version`'s description; `migrate.ts` (+test), new:
`migrate`, `MigrateResult`, `MigrateOptions`; `plan/plan.ts`: load's warning;
`testing/migrations.ts`, new: `RENAME_MEDIA`; `render/compose.ts`: one comment;
`index.ts`.

`packages/cli/src/`: `run.ts` (+test): `migrate`; `output.ts` (+test): `printMigrate`,
`mediaplane.migrate/v1`; `version.ts`: release-please's marker.

`catalog/`: `flaresolverr/app.ts`, `catalog.test.ts`, and the four `package.json`
licences.

`test/e2e/`: `update.e2e.test.ts` (new), `indexers.e2e.test.ts`, `helpers.ts`.

The docs: `docs/releasing.md` (new), and the generated references and app facts.

**Tasks:**

1. The licence, and versioned releases with release-please.
2. The supply chain's rules: Actions pinned, least-privilege tokens, every pin where
   Renovate finds it; and Renovate.
3. CI: the release's own build and Trivy on both architectures, the catalog's images,
   Node's security releases, Docker Engine 24, Docker Hub's login, and a weekly run.
4. `install.sh` installs a release, pinned by digest.
5. The release workflow: publish only a release, after CI, with the deploy files and the
   tested app versions; and updating Mediaplane end to end.
6. `mediaplane migrate`, and `stack.yaml`'s version on load.
7. FlareSolverr's folder, and the wiring network's settings.
8. Docs.

Each task's behaviour agrees with the decisions when it lands: nothing a task builds is
changed back by a later one (Task 5 adds `build-image.sh`'s push mode to Task 3's script).

**Out of scope here:**

- **Publishing anything, tagging, cutting a release, merging the release pull request,
  installing Renovate, adding secrets, changing settings:** the owner's steps.
- **Updating the media apps themselves** (`mediaplane update`, with a rollback): M2.
- **Mediaplane updating itself:** M3 revisits it (§4.4).
- **The `--json` contract, the remaining docs and test gaps, the README's wide table:**
  Slice 10.

---

### Task 1: The licence, and versioned releases with release-please

Everything later builds on a version that release-please can bump: the root and CLI
`package.json` files, the CLI's `VERSION`, and the manifest, kept in step by a test.

Decision: the licence is GPL-3.0-or-later, as SPDX, in every `package.json` and the image's label (decision 12).
Decision: one Node package at the root, tagged `v<version>`, with the CLI's `package.json` and `VERSION` as extra files at release-please's markers; a breaking change raises the minor number before 1.0; `CHANGELOG.md` is left to release-please (decision 11).

**Files:**
- Create: `.release-please-manifest.json`, `release-please-config.json`, `scripts/release/release.test.ts`
- Modify: `.prettierignore`, `Dockerfile`, `catalog/package.json`, `package.json`, `packages/cli/package.json`, `packages/cli/src/version.ts`, `packages/engine/package.json`

**Interfaces:**
- **Consumes:** the four `package.json` files, `packages/cli/src/version.ts` (`VERSION`), the `Dockerfile`'s labels.
- **Produces:** `release-please-config.json` and `.release-please-manifest.json` (`{ ".": "0.0.0" }`),
  which Task 5's workflow names; the root `package.json`'s `version`; the marker
  `// x-release-please-version` on `VERSION`'s line.

- [ ] **Step 1: Write the failing tests**

**Create** `scripts/release/release.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../packages/cli/src/version';
import { ROOT } from '../root';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const json = (path: string): unknown => JSON.parse(read(path));

/** Every package.json in the workspace: the root, the CLI, the engine and the catalog. */
const PACKAGES = [
  'package.json',
  'packages/cli/package.json',
  'packages/engine/package.json',
  'catalog/package.json',
];

interface ReleasePleaseConfig {
  'include-component-in-tag'?: boolean;
  'bump-minor-pre-major'?: boolean;
  'bump-patch-for-minor-pre-major'?: boolean;
  packages: Record<
    string,
    {
      'release-type': string;
      'package-name'?: string;
      'extra-files'?: (string | { type: string; path: string; jsonpath?: string })[];
    }
  >;
}

const config = json('release-please-config.json') as ReleasePleaseConfig;
const manifest = json('.release-please-manifest.json') as Record<string, string>;
const root = config.packages['.'];

describe('the licence (GPL-3.0-or-later, the owner decided on 2026-10-17)', () => {
  it.each(PACKAGES)('%s says so in its SPDX license field', (path) => {
    expect((json(path) as { license?: string }).license).toBe('GPL-3.0-or-later');
  });

  it('is the GPL version 3 text, which allows "or any later version"', () => {
    const text = read('LICENSE');
    expect(text).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(text).toContain('"or any later version"');
  });

  it("is the image's licence label", () => {
    expect(read('Dockerfile')).toContain(
      'org.opencontainers.image.licenses="GPL-3.0-or-later"',
    );
  });
});

describe('versioned releases (release-please, spec §8.2)', () => {
  it('releases the repository as one Node package, tagged v<version>', () => {
    expect(Object.keys(config.packages)).toEqual(['.']);
    expect(root).toMatchObject({ 'release-type': 'node', 'package-name': 'mediaplane' });
    expect(config['include-component-in-tag']).toBe(false);
  });

  it('bumps the minor version for a feature or a breaking change before 1.0', () => {
    expect(config['bump-minor-pre-major']).toBe(true);
    expect(config['bump-patch-for-minor-pre-major']).toBeUndefined();
  });

  it('keeps every version in step: the manifest, both package.json files, the CLI', () => {
    const version = manifest['.'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect((json('package.json') as { version?: string }).version).toBe(version);
    expect((json('packages/cli/package.json') as { version?: string }).version).toBe(
      version,
    );
    expect(VERSION).toBe(version);
  });

  it('bumps the CLI package and its VERSION too, at release-please markers', () => {
    expect(root?.['extra-files']).toEqual([
      { type: 'json', path: 'packages/cli/package.json', jsonpath: '$.version' },
      'packages/cli/src/version.ts',
    ]);
    // release-please's generic updater rewrites the version on a line with this marker.
    const marked = read('packages/cli/src/version.ts')
      .split('\n')
      .filter((line) => line.includes('x-release-please-version'));
    expect(marked).toEqual([
      `export const VERSION = '${VERSION}'; // x-release-please-version`,
    ]);
  });

  it("leaves the changelog it writes out of Prettier's check", () => {
    // release-please writes CHANGELOG.md in its own format, in the release pull request.
    expect(read('.prettierignore').split('\n')).toContain('CHANGELOG.md');
  });
});
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run scripts/release/release.test.ts`
Expected: FAIL, the file errors before any test runs:
`Error: ENOENT: no such file or directory, open '…/release-please-config.json'`.

- [ ] **Step 3: Write the implementation**

**Change** `.prettierignore`:

```diff
diff --git a/.prettierignore b/.prettierignore
index 7a7dfa0..c492326 100644
--- a/.prettierignore
+++ b/.prettierignore
@@ -6 +6,2 @@ docs/plans/
 LICENSE
+CHANGELOG.md
```

**Create** `.release-please-manifest.json`:

```json
{
  ".": "0.0.0"
}
```

**Change** `Dockerfile`:

```diff
diff --git a/Dockerfile b/Dockerfile
index 917efe1..6f50c8e 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -39,3 +39,3 @@ LABEL org.opencontainers.image.title="Mediaplane" \
       org.opencontainers.image.source="https://github.com/cyclopsgd/Mediaplane" \
-      org.opencontainers.image.licenses="GPL-3.0"
+      org.opencontainers.image.licenses="GPL-3.0-or-later"
 # The node user. mediaplane.compose.yaml runs it as the user that owns the home instead.
```

**Change** `catalog/package.json`:

```diff
diff --git a/catalog/package.json b/catalog/package.json
index 0ed7757..155e3e8 100644
--- a/catalog/package.json
+++ b/catalog/package.json
@@ -4,2 +4,3 @@
   "private": true,
+  "license": "GPL-3.0-or-later",
   "type": "module",
```

**Change** `package.json`:

```diff
diff --git a/package.json b/package.json
index 3ece96a..bc185d2 100644
--- a/package.json
+++ b/package.json
@@ -2,3 +2,5 @@
   "name": "mediaplane",
+  "version": "0.0.0",
   "private": true,
+  "license": "GPL-3.0-or-later",
   "type": "module",
```

**Change** `packages/cli/package.json`:

```diff
diff --git a/packages/cli/package.json b/packages/cli/package.json
index 2752ca4..ca28cbf 100644
--- a/packages/cli/package.json
+++ b/packages/cli/package.json
@@ -4,2 +4,3 @@
   "private": true,
+  "license": "GPL-3.0-or-later",
   "type": "module",
```

**Change** `packages/cli/src/version.ts`:

```diff
diff --git a/packages/cli/src/version.ts b/packages/cli/src/version.ts
index 354f056..b408b3c 100644
--- a/packages/cli/src/version.ts
+++ b/packages/cli/src/version.ts
@@ -1,2 +1,2 @@
-/** Kept in step with packages/cli/package.json (release tooling bumps both). */
-export const VERSION = '0.0.0';
+/** Kept in step with packages/cli/package.json: release-please bumps both, at its marker. */
+export const VERSION = '0.0.0'; // x-release-please-version
```

**Change** `packages/engine/package.json`:

```diff
diff --git a/packages/engine/package.json b/packages/engine/package.json
index 5f74275..517322e 100644
--- a/packages/engine/package.json
+++ b/packages/engine/package.json
@@ -4,2 +4,3 @@
   "private": true,
+  "license": "GPL-3.0-or-later",
   "type": "module",
```

**Create** `release-please-config.json`:

```json
{
  "include-component-in-tag": false,
  "bump-minor-pre-major": true,
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "mediaplane",
      "extra-files": [
        { "type": "json", "path": "packages/cli/package.json", "jsonpath": "$.version" },
        "packages/cli/src/version.ts"
      ]
    }
  }
}
```

- [ ] **Step 4: Run the tests, and see them pass**

Run: `pnpm vitest run scripts/release/release.test.ts packages/cli/src/version.test.ts`
Expected: PASS, 12 tests (11 and the existing version test).

- [ ] **Step 5: Check the config with release-please itself (optional, needs the npm registry)**

In a scratch folder outside the repo, install `release-please@17.11.2` and `ajv@8` with
`npm i --ignore-scripts`, then validate `release-please-config.json` against
`node_modules/release-please/schemas/config.json` with Ajv, and run its `Generic`,
`GenericJson('$.version', …)` and `node/PackageJson` updaters on `version.ts` and the two
`package.json` files for version 0.1.0.
Expected: the config is valid, and each updater changes only the version, to `0.1.0`
(probed while writing this plan).

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2128 tests in 94 files.

- [ ] **Step 7: Commit**

```bash
git add .prettierignore \
  .release-please-manifest.json \
  Dockerfile \
  catalog/package.json \
  package.json \
  packages/cli/package.json \
  packages/cli/src/version.ts \
  packages/engine/package.json \
  release-please-config.json \
  scripts/release/release.test.ts
git commit -m "feat: GPL-3.0-or-later in every package, and versioned releases with release-please" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The supply chain's rules: Actions pinned, least-privilege tokens, every pin where Renovate finds it; and Renovate

A test holds the workflows to the rules that keep a release safe, and checks that
Renovate finds every pin: the catalog's, and those outside it. CI lints the workflows and
the shell scripts.

Decision: Renovate's managers and versioning rules; nothing merges itself; app pins say to run `pnpm docs:generate` (decision 10).
Decision: every workflow's token read-only unless a job says more, listed exactly; no `pull_request_target`; nothing pasted into a script (decision 17).

**Files:**
- Create: `renovate.json`, `scripts/supply-chain.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- **Consumes:** the catalog (`@mediaplane/catalog`), `.github/workflows/*.yml`, the `Dockerfile`, `deploy/mediaplane.compose.yaml`, `.githooks/pre-commit`, `test/e2e/helpers.ts` and `test/e2e/wireguard.ts`.
- **Produces:** `renovate.json`; `scripts/supply-chain.test.ts`, whose `JOB_PERMISSIONS` lists every
  job that asks for more than the workflow's token (Task 5 adds `release.yml`'s), and whose
  pinned-manager test lists the images found outside the catalog (Task 3 adds
  `scripts/ci/*.sh`'s).

- [ ] **Step 1: Write the failing tests**

**Create** `scripts/supply-chain.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from './root';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const WORKFLOWS = readdirSync(join(ROOT, '.github/workflows'))
  .filter((name) => name.endsWith('.yml'))
  .sort()
  .map((name) => `.github/workflows/${name}`);

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  permissions?: unknown;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: unknown;
  jobs: Record<string, Job>;
}
const workflow = (path: string): Workflow => parse(read(path)) as Workflow;

/**
 * The jobs that ask for more than the workflow's read-only token, with exactly what they
 * ask for. Every other job inherits the workflow's `permissions`.
 */
const JOB_PERMISSIONS: Record<string, Record<string, unknown>> = {
  '.github/workflows/ci.yml': { gate: {} },
  '.github/workflows/plex.yml': {},
};

/** An image pinned by tag and digest, as every image outside the catalog is written. */
const PINNED = /[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}/g;

interface RegexManager {
  managerFilePatterns: string[];
  matchStrings: string[];
}
interface PackageRule {
  matchDepNames?: string[];
  matchFileNames?: string[];
  versioning?: string;
  automerge?: boolean;
  prBodyNotes?: string[];
}
const renovate = JSON.parse(read('renovate.json')) as {
  automerge?: boolean;
  ignorePaths?: string[];
  'docker-compose'?: { managerFilePatterns: string[] };
  customManagers: RegexManager[];
  packageRules: PackageRule[];
};
/** Renovate writes a regex pattern as "/…/"; anything else would be a glob. */
const pattern = (text: string): RegExp => {
  expect(text).toMatch(/^\/.*\/$/);
  return new RegExp(text.slice(1, -1));
};
const manager = (index: number): RegexManager => {
  const found = renovate.customManagers[index];
  if (found === undefined)
    throw new Error(`renovate.json has no custom manager ${String(index)}`);
  return found;
};
/** The catalog's pins, then those outside it. */
const catalogManager = manager(0);
const pinnedManager = manager(1);

/** Every file in the repository but those that aren't its own, with its path. */
function repoFiles(dir = ''): string[] {
  const skip = new Set([
    '.git',
    'node_modules',
    'dist',
    'coverage',
    '.claude',
    '.superpowers',
  ]);
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (skip.has(entry.name)) return [];
    return entry.isDirectory() ? repoFiles(path) : [path];
  });
}

describe('the workflows (spec §7.2(7))', () => {
  it.each(WORKFLOWS)('%s pins every Action by commit SHA, with its version', (path) => {
    const uses = read(path)
      .split('\n')
      .filter((line) => /^\s*(?:-\s+)?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(
        /uses: (?:\.\/\S+|[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+){0,2})$/,
      );
    }
  });

  it.each(WORKFLOWS)(
    '%s gives its jobs a read-only token unless one says more',
    (path) => {
      const { permissions, jobs } = workflow(path);
      expect([{}, { contents: 'read' }]).toContainEqual(permissions);
      const asked = Object.fromEntries(
        Object.entries(jobs)
          .filter(([, job]) => job.permissions !== undefined)
          .map(([name, job]) => [name, job.permissions]),
      );
      expect(asked).toEqual(JOB_PERMISSIONS[path]);
    },
  );

  it.each(WORKFLOWS)("%s never runs a pull request's code with secrets", (path) => {
    const { on } = workflow(path);
    for (const trigger of ['pull_request_target', 'workflow_run', 'issue_comment']) {
      expect(Object.keys(on)).not.toContain(trigger);
    }
  });

  it.each(WORKFLOWS)(
    '%s keeps secrets and event text out of its scripts, and credentials out of checkouts',
    (path) => {
      for (const job of Object.values(workflow(path).jobs)) {
        for (const step of job.steps ?? []) {
          // A script gets a secret, or text anyone can write, through env: never pasted
          // into its source, where a quote in it would run as code.
          expect(step.run ?? '').not.toMatch(
            /\$\{\{[^}]*\b(?:secrets|github\.event|github\.head_ref|inputs)\b/,
          );
          if (step.uses?.startsWith('actions/checkout@') === true) {
            expect(step.with?.['persist-credentials']).toBe(false);
          }
        }
      }
      expect(read(path)).not.toContain('secrets.GITHUB_TOKEN');
    },
  );
});

describe('every image is pinned by digest (spec §7.2(7))', () => {
  it('in the Dockerfile', () => {
    const from = read('Dockerfile')
      .split('\n')
      .filter((line) => line.startsWith('FROM '));
    expect(from.length).toBeGreaterThan(0);
    for (const line of from) expect(line).toMatch(/@sha256:[0-9a-f]{64}( AS \S+)?$/);
  });

  it("in Mediaplane's deployment, but for the image it is given", () => {
    const deployment = parse(read('deploy/mediaplane.compose.yaml')) as {
      services: Record<string, { image: string }>;
      'x-mediaplane-image': string;
    };
    for (const service of Object.values(deployment.services)) {
      if (service.image === deployment['x-mediaplane-image']) continue;
      expect(service.image).toMatch(/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/);
    }
  });

  it('in a file Renovate keeps current, wherever one is written', () => {
    const managed = [
      ...pinnedManager.managerFilePatterns.map(pattern),
      ...(renovate['docker-compose']?.managerFilePatterns ?? []).map(pattern),
      /^Dockerfile$/,
    ];
    // The catalog's pins are the catalog manager's; the app READMEs and the golden files
    // show them, and docs:generate and the tests rewrite those.
    const shown = (path: string) =>
      path.startsWith('docs/') ||
      /^catalog\/[^/]+\/README\.md$/.test(path) ||
      path.includes('/__golden__/');
    const pinned = repoFiles().filter(
      (path) => !shown(path) && [...read(path).matchAll(PINNED)].length > 0,
    );
    expect(pinned.length).toBeGreaterThan(0);
    for (const path of pinned) {
      expect(
        managed.some((re) => re.test(path)),
        path,
      ).toBe(true);
    }
  });
});

describe('Renovate (spec §8.2)', () => {
  it('reads every file it is given, tests included, and merges nothing itself', () => {
    // config:recommended ignores test folders, which hold the end-to-end tests' images.
    expect(renovate.ignorePaths).toEqual(['**/node_modules/**']);
    expect(renovate.automerge).toBe(false);
  });

  it.each(catalog.map((def) => [def.id, def] as const))(
    "finds %s's pin, tag and digest, in its app.ts",
    (id, def) => {
      expect(
        catalogManager.managerFilePatterns
          .map(pattern)
          .some((re) => re.test(`catalog/${id}/app.ts`)),
      ).toBe(true);
      const found = [
        ...read(`catalog/${id}/app.ts`).matchAll(
          new RegExp(catalogManager.matchStrings[0] ?? '', 'g'),
        ),
      ];
      expect(found.map((match) => match.groups)).toEqual([
        {
          depName: def.image.repo,
          currentValue: def.image.tag,
          currentDigest: def.image.digest,
        },
      ]);
    },
  );

  it('finds the images pinned outside the catalog, as the roadmap lists them', () => {
    const found = (path: string) =>
      [...read(path).matchAll(new RegExp(pinnedManager.matchStrings[0] ?? '', 'g'))].map(
        (match) => match.groups?.depName,
      );
    expect(found('.github/workflows/ci.yml')).toEqual(
      expect.arrayContaining(['aquasec/trivy', 'ghcr.io/gitleaks/gitleaks']),
    );
    expect(found('.githooks/pre-commit')).toEqual(['ghcr.io/gitleaks/gitleaks']);
    expect(found('test/e2e/helpers.ts')).toContain('busybox');
    expect(found('test/e2e/wireguard.ts')).toEqual(['lscr.io/linuxserver/wireguard']);
  });

  it('can read every pinned tag, so that it can find a newer one', () => {
    const tags = new Map<string, string>(
      catalog.map((def) => [def.image.repo, def.image.tag]),
    );
    const wireguard = /'lscr\.io\/linuxserver\/wireguard:([^@']+)@/.exec(
      read('test/e2e/wireguard.ts'),
    );
    tags.set('lscr.io/linuxserver/wireguard', wireguard?.[1] ?? '');
    const versioned = new Set<string>();
    for (const rule of renovate.packageRules) {
      if (rule.versioning?.startsWith('regex:') !== true) continue;
      const re = new RegExp(rule.versioning.slice('regex:'.length));
      for (const name of rule.matchDepNames ?? []) {
        expect(tags.get(name), name).toMatch(re);
        versioned.add(name);
      }
    }
    // The rest are plain versions, which Renovate's Docker versioning reads.
    for (const [name, tag] of tags) {
      if (!versioned.has(name)) expect(tag, name).toMatch(/^v?\d+\.\d+\.\d+$/);
    }
  });

  it('never merges an app pin by itself, and says to regenerate the docs', () => {
    const rule = renovate.packageRules.find((r) =>
      r.matchFileNames?.includes('catalog/*/app.ts'),
    );
    expect(rule?.automerge).toBe(false);
    expect(rule?.prBodyNotes?.join(' ')).toContain('pnpm docs:generate');
  });
});
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run scripts/supply-chain.test.ts`
Expected: FAIL, before any test runs: `Error: ENOENT: no such file or directory, open
'…/renovate.json'`.

- [ ] **Step 3: Write the implementation**

**Change** `.github/workflows/ci.yml`:

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index df3bf35..97cc4f7 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -25,2 +25,10 @@ jobs:
           persist-credentials: false
+      # actionlint checks the workflows, with shellcheck for their run steps; the same
+      # image's shellcheck checks the shell scripts.
+      - name: Lint the workflows and the shell scripts (actionlint, shellcheck)
+        run: |
+          image=rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
+          docker run --rm -v "$PWD:/repo:ro" -w /repo "$image" -color
+          git ls-files -z -- '*.sh' | xargs -0 docker run --rm -v "$PWD:/repo:ro" -w /repo \
+            --entrypoint shellcheck "$image" deploy/mediaplane .githooks/pre-commit
       - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
```

**Create** `renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "description": "Keeps every pin current: the catalog's app images, the images outside it, npm dependencies and the Actions' commit SHAs (spec §7.2(7), §8.2). Nothing merges itself.",
  "extends": ["config:recommended", "helpers:pinGitHubActionDigests"],
  "ignorePaths": ["**/node_modules/**"],
  "semanticCommits": "enabled",
  "automerge": false,
  "labels": ["dependencies"],
  "docker-compose": {
    "description": "Mediaplane's own deployment, whose name the default patterns miss",
    "managerFilePatterns": ["/(^|/)mediaplane\\.compose\\.yaml$/"]
  },
  "customManagers": [
    {
      "customType": "regex",
      "description": "The catalog's app images, pinned by tag and digest in catalog/<app>/app.ts",
      "managerFilePatterns": ["/^catalog/[^/]+/app\\.ts$/"],
      "matchStrings": [
        "image: \\{\\s*repo: '(?<depName>[^']+)',\\s*tag: '(?<currentValue>[^']+)',\\s*digest: '(?<currentDigest>sha256:[0-9a-f]{64})'"
      ],
      "datasourceTemplate": "docker"
    },
    {
      "customType": "regex",
      "description": "Images pinned by tag and digest in the workflows, the pre-commit hook, the CI scripts and the end-to-end tests",
      "managerFilePatterns": [
        "/^\\.github/workflows/[^/]+\\.yml$/",
        "/^\\.githooks/pre-commit$/",
        "/^scripts/ci/[^/]+\\.sh$/",
        "/^test/e2e/[^/]+\\.ts$/"
      ],
      "matchStrings": [
        "(?<depName>[a-z0-9][a-z0-9._/-]*):(?<currentValue>[A-Za-z0-9][A-Za-z0-9._-]*)@(?<currentDigest>sha256:[0-9a-f]{64})"
      ],
      "datasourceTemplate": "docker"
    }
  ],
  "packageRules": [
    {
      "description": "An app pin is the tested set (spec §4.3, §8.2): its bump runs the full end-to-end suite, and is never merged automatically",
      "matchFileNames": ["catalog/*/app.ts"],
      "automerge": false,
      "labels": ["app-pin"],
      "semanticCommitType": "fix",
      "semanticCommitScope": "catalog",
      "prBodyNotes": [
        "Each app's README shows its pin: run `pnpm docs:generate` on this branch and commit what it writes, or CI's docs check fails. CI runs the full end-to-end suite on amd64 and arm64 before this can merge."
      ]
    },
    {
      "description": "linuxserver.io's Servarr tags: <version>.<build>-ls<revision>",
      "matchDepNames": [
        "lscr.io/linuxserver/sonarr",
        "lscr.io/linuxserver/radarr",
        "lscr.io/linuxserver/prowlarr"
      ],
      "versioning": "regex:^(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)\\.(?<build>\\d+)-ls(?<revision>\\d+)$"
    },
    {
      "description": "linuxserver.io's Jellyfin tags: <version>ubu<release>-ls<revision>",
      "matchDepNames": ["lscr.io/linuxserver/jellyfin"],
      "versioning": "regex:^(?<major>\\d+)\\.(?<minor>\\d+)(?:\\.(?<patch>\\d+))?(?<compatibility>ubu\\d+)-ls(?<revision>\\d+)$"
    },
    {
      "description": "linuxserver.io's Plex tags: <version>.<build>-<commit>-ls<revision>",
      "matchDepNames": ["lscr.io/linuxserver/plex"],
      "versioning": "regex:^(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)\\.(?<build>\\d+)-[0-9a-f]+-ls(?<revision>\\d+)$"
    },
    {
      "description": "linuxserver.io's qBittorrent tags: <version>_v<libtorrent>-ls<revision>",
      "matchDepNames": ["lscr.io/linuxserver/qbittorrent"],
      "versioning": "regex:^(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)_v\\d+\\.\\d+\\.\\d+-ls(?<revision>\\d+)$"
    },
    {
      "description": "linuxserver.io's WireGuard tags (the kill-switch test's server): <version>-r<release>-ls<revision>",
      "matchDepNames": ["lscr.io/linuxserver/wireguard"],
      "versioning": "regex:^(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)-r(?<build>\\d+)-ls(?<revision>\\d+)$"
    },
    {
      "description": "Node stays on its 24 LTS line (spec §3.3); a bump of the image's Node is a fix, since it can close a vulnerability in Node itself",
      "matchDepNames": ["node"],
      "matchFileNames": ["Dockerfile"],
      "allowedVersions": "<25",
      "semanticCommitType": "fix",
      "semanticCommitScope": "image"
    },
    {
      "description": "The image's Docker CLI and Compose, and its socket proxy, are part of the image: a fix",
      "matchFileNames": ["Dockerfile", "deploy/mediaplane.compose.yaml"],
      "matchDepNames": ["docker", "wollomatic/socket-proxy"],
      "semanticCommitType": "fix",
      "semanticCommitScope": "image"
    },
    {
      "description": "Node's types follow the Node line the project runs",
      "matchPackageNames": ["@types/node"],
      "allowedVersions": "<25"
    },
    {
      "description": "The Docker Engine floor CI tests stays the floor (Engine 24)",
      "matchFileNames": ["scripts/ci/engine-floor.sh"],
      "matchDepNames": ["docker"],
      "allowedVersions": "<25"
    }
  ]
}
```

- [ ] **Step 4: Run the tests, and see them pass**

Run: `pnpm vitest run scripts/supply-chain.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Lint the workflows and scripts, and validate the Renovate config**

Run, from the repo root, as CI's new step does:

```bash
image=rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
docker run --rm -v "$PWD:/repo:ro" -w /repo "$image" -color
git ls-files -z -- '*.sh' | xargs -0 docker run --rm -v "$PWD:/repo:ro" -w /repo \
  --entrypoint shellcheck "$image" deploy/mediaplane .githooks/pre-commit
npx --yes renovate@44.149.3 renovate-config-validator --strict
```

Expected: actionlint and shellcheck print nothing and exit 0; the validator prints
`Config validated successfully against 1 file(s)`. (Renovate's own `--platform=local
--dry-run=extract`, run from a folder where `renovate.json` is committed or staged, finds
the ten catalog pins, the `Dockerfile`'s three, the proxy's, and those in `ci.yml`, the
pre-commit hook, `helpers.ts` and `wireguard.ts`: probed.)

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2153 tests in 95 files.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml \
  renovate.json \
  scripts/supply-chain.test.ts
git commit -m "ci: every Action pinned by SHA and each job's token read-only unless it says more, checked; Renovate keeps every pin current, the catalog's and the rest" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: CI: the release's own build and Trivy on both architectures, the catalog's images, Node's security releases, Docker Engine 24, Docker Hub's login, and a weekly run

CI makes, on every pull request, the build a release will push; scans the catalog's
images; checks Node and the Engine floor; and logs in to Docker Hub when it can. The
scripts run the same on the dev box.

Decision: each architecture built natively with pinned BuildKit, an SBOM and provenance, reproducible from the commit, into an OCI layout Trivy scans (decision 2).
Decision: the catalog's images fail on a critical with a fix, but those listed with their app and a date (decision 6, owner).
Decision: a check of Node's security releases, which bumps Node to 24.22.1 at once (decision 7).
Decision: Docker Engine 24 by a smoke test of the image's CLI and Compose (decision 8); an optional Docker Hub token (decision 9); a weekly run (decision 18).

**Files:**
- Create: `.github/actions/docker-hub-login/action.yml`, `scripts/ci/build-image.sh`, `scripts/ci/catalog-ignore.yaml`, `scripts/ci/catalog-images.test.ts`, `scripts/ci/catalog-images.ts`, `scripts/ci/engine-floor.sh`, `scripts/ci/node-security.test.ts`, `scripts/ci/node-security.ts`, `scripts/ci/scan-catalog.sh`, `scripts/ci/scan-image.sh`
- Modify: `.github/workflows/ci.yml`, `Dockerfile`
- Test: `scripts/supply-chain.test.ts`

**Interfaces:**
- **Consumes:** Task 2's `scripts/supply-chain.test.ts`; the catalog; the `Dockerfile`'s `docker-cli` stage.
- **Produces:** `scripts/ci/build-image.sh <amd64|arm64> <out-dir>`, writing `<out-dir>/oci` and
  `<out-dir>/digest` (Task 5 adds `--push <name>`); `scripts/ci/scan-image.sh <arch>
  <oci-dir>`; `scripts/ci/scan-catalog.sh <arch>`; `scripts/ci/engine-floor.sh`;
  `catalogImages(defs, arch): string[]` and `pinnedImage(def): string` in
  `scripts/ci/catalog-images.ts`; `imageNode(dockerfile): string` and
  `missedSecurityReleases(current, index): string[]` in `scripts/ci/node-security.ts`;
  the composite action `./.github/actions/docker-hub-login` (inputs `username`, `token`).

- [ ] **Step 1: Write the failing tests**

**Create** `scripts/ci/catalog-images.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import { catalogImages, pinnedImage } from './catalog-images';

describe('catalogImages', () => {
  it('lists every catalog image once, pinned by tag and digest, sorted', () => {
    const images = catalogImages(catalog, 'arm64');
    expect(images).toHaveLength(catalog.length);
    expect(new Set(images).size).toBe(images.length);
    expect(images).toEqual([...images].sort());
    for (const image of images) {
      expect(image).toMatch(/^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/);
    }
    expect(images).toContain(
      pinnedImage(catalog.find((def) => def.id === 'sonarr') as AppDefinition),
    );
  });

  it("leaves out an app that doesn't run on the architecture", () => {
    const sonarr = catalog.find((def) => def.id === 'sonarr') as AppDefinition;
    const amd64Only = {
      ...sonarr,
      id: 'amd64-only',
      image: { ...sonarr.image, repo: 'registry.test/amd64-only' },
      arch: ['amd64' as const],
    };
    expect(catalogImages([sonarr, amd64Only], 'arm64')).toEqual([pinnedImage(sonarr)]);
    expect(catalogImages([sonarr, amd64Only], 'amd64')).toHaveLength(2);
  });

  it('writes a pin as Docker takes it', () => {
    const def = {
      image: {
        repo: 'registry.test/app',
        tag: '1.0.0',
        digest: `sha256:${'0'.repeat(64)}`,
      },
    } as AppDefinition;
    expect(pinnedImage(def)).toBe(`registry.test/app:1.0.0@sha256:${'0'.repeat(64)}`);
  });
});

describe('catalog-ignore.yaml', () => {
  const { vulnerabilities } = parse(
    readFileSync(join(ROOT, 'scripts/ci/catalog-ignore.yaml'), 'utf8'),
  ) as { vulnerabilities: Record<string, unknown>[] };

  it('gives each finding it lets pass the app it is in, and a date it stops counting', () => {
    expect(vulnerabilities.length).toBeGreaterThan(0);
    for (const entry of vulnerabilities) {
      // Never paths or packages: Trivy would then ignore it in every image.
      expect(Object.keys(entry).sort()).toEqual(['expired_at', 'id', 'statement']);
      expect(entry.id).toMatch(/^(?:CVE-\d{4}-\d+|GHSA(?:-[0-9a-z]{4}){3})$/);
      expect(entry.statement).toMatch(/ in \S/);
      expect(entry.expired_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('lists each finding once', () => {
    const ids = vulnerabilities.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

**Create** `scripts/ci/node-security.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { imageNode, missedSecurityReleases, type NodeRelease } from './node-security';

const FROM = (version: string) => `node:${version}-alpine3.24@sha256:${'0'.repeat(64)}`;
const dockerfile = (...versions: string[]) =>
  versions
    .map(
      (v, i) =>
        `FROM ${i === 0 ? '--platform=$BUILDPLATFORM ' : ''}${FROM(v)}${i === 0 ? ' AS bundle' : ''}\n`,
    )
    .join('RUN true\n');

// Node's own release index, newest first, as https://nodejs.org/dist/index.json lists it.
const INDEX: NodeRelease[] = [
  { version: 'v25.1.0', security: true },
  { version: 'v24.22.1', security: true },
  { version: 'v24.22.0', security: false },
  { version: 'v24.21.0', security: false },
  { version: 'v24.18.1', security: true },
  { version: 'v22.30.0', security: true },
];

describe('imageNode', () => {
  it("reads the Node version of the image's base", () => {
    expect(imageNode(dockerfile('24.21.0', '24.21.0'))).toBe('24.21.0');
  });

  it('refuses a Dockerfile whose Node bases differ, or that has none', () => {
    expect(() => imageNode(dockerfile('24.21.0', '24.22.1'))).toThrow(
      'the Dockerfile builds on more than one Node: 24.21.0, 24.22.1',
    );
    expect(() => imageNode('FROM alpine:3.24\n')).toThrow('no node:<version> base');
  });
});

describe('missedSecurityReleases', () => {
  it('names the security releases of its line newer than the image has', () => {
    expect(missedSecurityReleases('24.21.0', INDEX)).toEqual(['24.22.1']);
  });

  it('is empty once the image has the newest one', () => {
    expect(missedSecurityReleases('24.22.1', INDEX)).toEqual([]);
  });

  it("doesn't count another major line, or a release that fixed nothing", () => {
    expect(missedSecurityReleases('24.22.0', INDEX)).toEqual(['24.22.1']);
    expect(missedSecurityReleases('22.30.0', INDEX)).toEqual([]);
  });

  it('refuses an index that lists none of its line: a check that saw nothing passes nothing', () => {
    expect(() =>
      missedSecurityReleases('24.21.0', [{ version: 'v22.30.0', security: true }]),
    ).toThrow("Node's release index lists no 24.x release");
  });
});
```

**Change** `scripts/supply-chain.test.ts`:

```diff
diff --git a/scripts/supply-chain.test.ts b/scripts/supply-chain.test.ts
index 8000b72..086de26 100644
--- a/scripts/supply-chain.test.ts
+++ b/scripts/supply-chain.test.ts
@@ -14,2 +14,10 @@ const WORKFLOWS = readdirSync(join(ROOT, '.github/workflows'))
 
+/** The repository's own composite actions, which workflows run as `./.github/actions/…`. */
+const ACTIONS = readdirSync(join(ROOT, '.github/actions'))
+  .sort()
+  .map((name) => `.github/actions/${name}/action.yml`);
+
+/** `${{ … }}` text a script must never hold: a secret, or what anyone can write. */
+const PASTED = /\$\{\{[^}]*\b(?:secrets|github\.event|github\.head_ref|inputs)\b/;
+
 interface Step {
@@ -133,5 +141,3 @@ describe('the workflows (spec §7.2(7))', () => {
           // into its source, where a quote in it would run as code.
-          expect(step.run ?? '').not.toMatch(
-            /\$\{\{[^}]*\b(?:secrets|github\.event|github\.head_ref|inputs)\b/,
-          );
+          expect(step.run ?? '').not.toMatch(PASTED);
           if (step.uses?.startsWith('actions/checkout@') === true) {
@@ -144,2 +150,12 @@ describe('the workflows (spec §7.2(7))', () => {
   );
+
+  it.each(ACTIONS)(
+    '%s, a composite action, keeps secrets and inputs out of its scripts',
+    (path) => {
+      const { runs } = parse(read(path)) as { runs: { steps: Step[] } };
+      expect(runs.steps.length).toBeGreaterThan(0);
+      // Its inputs reach a script through env, as a workflow's secrets do.
+      for (const step of runs.steps) expect(step.run ?? '').not.toMatch(PASTED);
+    },
+  );
 });
@@ -226,5 +242,13 @@ describe('Renovate (spec §8.2)', () => {
       );
-    expect(found('.github/workflows/ci.yml')).toEqual(
-      expect.arrayContaining(['aquasec/trivy', 'ghcr.io/gitleaks/gitleaks']),
-    );
+    expect(found('.github/workflows/ci.yml')).toEqual([
+      'rhysd/actionlint',
+      'ghcr.io/gitleaks/gitleaks',
+    ]);
+    expect(found('scripts/ci/scan-image.sh')).toEqual(['aquasec/trivy']);
+    expect(found('scripts/ci/scan-catalog.sh')).toEqual(['aquasec/trivy']);
+    expect(found('scripts/ci/build-image.sh')).toEqual([
+      'moby/buildkit',
+      'docker/buildkit-syft-scanner',
+    ]);
+    expect(found('scripts/ci/engine-floor.sh')).toEqual(['docker', 'busybox']);
     expect(found('.githooks/pre-commit')).toEqual(['ghcr.io/gitleaks/gitleaks']);
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run scripts/ci scripts/supply-chain.test.ts`
Expected: FAIL: `catalog-images.test.ts` and `node-security.test.ts` with
`Cannot find module './catalog-images'` and `'./node-security'`, and in
`supply-chain.test.ts` "finds the images pinned outside the catalog", since `ci.yml` still
runs Trivy itself (`expected [ 'rhysd/actionlint', …(2) ] to deeply equal
[ 'rhysd/actionlint', …(1) ]`).

- [ ] **Step 3: Write the implementation**

Apply the blocks below, but for the `Dockerfile`'s, which Step 5 applies, once the new
check has said why.

**Create** `.github/actions/docker-hub-login/action.yml`:

```yaml
name: Log in to Docker Hub, when there is a token
description: >-
  Pulls from Docker Hub with a read-only token, so they don't meet its limit for anonymous
  pulls. With no token, as in a fork's pull request, which never gets the repository's
  secrets, it logs in to nothing and the pulls stay anonymous.
inputs:
  username:
    description: The Docker Hub user the token is of.
    required: false
    default: ''
  token:
    description: A Docker Hub access token that may only read public images.
    required: false
    default: ''
runs:
  using: composite
  steps:
    - if: inputs.username != '' && inputs.token != ''
      shell: bash
      env:
        USERNAME: ${{ inputs.username }}
        TOKEN: ${{ inputs.token }}
      run: printf '%s' "$TOKEN" | docker login --username "$USERNAME" --password-stdin
    - if: inputs.username == '' || inputs.token == ''
      shell: bash
      run: echo "No Docker Hub token here, so images are pulled anonymously."
```

**Change** `.github/workflows/ci.yml`:

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 97cc4f7..41212c4 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -6,2 +6,6 @@ on:
   pull_request:
+  # Weekly too, so that a vulnerability found in an image, Node or a catalog app since
+  # the last push still fails a run that someone sees.
+  schedule:
+    - cron: '41 4 * * 1'
 
@@ -47,6 +51,11 @@ jobs:
         run: pnpm audit --prod --audit-level critical
+      # Node is a binary in the image's base, which neither Trivy nor pnpm audit sees. This
+      # needs nodejs.org.
+      - name: Does the image's Node have every security release of its line?
+        run: pnpm exec tsx scripts/ci/node-security.ts
 
-  # Decides whether the end-to-end and image jobs, which pull images, are needed. The
-  # decision is made inside the workflow, rather than with an `on:` path filter, so the
-  # workflow still runs on a docs-only push and `gate` (the last job) still reports.
+  # Decides whether the jobs that pull images (end-to-end, image, catalog images, the
+  # Engine floor) are needed. The decision is made inside the workflow, rather than with
+  # an `on:` path filter, so the workflow still runs on a docs-only push and `gate` (the
+  # last job) still reports.
   changes:
@@ -69,3 +78,3 @@ jobs:
           if [ -z "$BASE" ] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
-            echo "No usable base commit, so the end-to-end and image jobs run."
+            echo "No usable base commit, so every job that pulls images runs."
             echo "code=true" >> "$GITHUB_OUTPUT"
@@ -78,3 +87,3 @@ jobs:
           else
-            echo "Only docs changed, so the end-to-end and image jobs are skipped."
+            echo "Only docs changed, so the jobs that pull images are skipped."
             echo "code=false" >> "$GITHUB_OUTPUT"
@@ -112,2 +121,6 @@ jobs:
           persist-credentials: false
+      - uses: ./.github/actions/docker-hub-login
+        with:
+          username: ${{ secrets.DOCKERHUB_USERNAME }}
+          token: ${{ secrets.DOCKERHUB_TOKEN }}
       - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
@@ -130,3 +143,3 @@ jobs:
   image:
-    name: Image (${{ matrix.arch }}, Trivy)
+    name: Image (${{ matrix.arch }}, as a release builds it, Trivy)
     needs: changes
@@ -147,17 +160,14 @@ jobs:
           persist-credentials: false
-      # Native on each runner: no emulation. A multi-arch manifest comes with publishing (S9).
-      # The image scanned here and the one the e2e tests build are two builds of the same
-      # Dockerfile. They are the same image only because every input of the Dockerfile is
-      # pinned; an unpinned layer would let them differ.
-      - name: Build the image
-        run: docker build --tag mediaplane:ci .
-      # The tarball goes in its own folder, and only that folder is mounted, read-only.
+      - uses: ./.github/actions/docker-hub-login
+        with:
+          username: ${{ secrets.DOCKERHUB_USERNAME }}
+          token: ${{ secrets.DOCKERHUB_TOKEN }}
+      # Native on each runner: no emulation. This is the build the release workflow pushes,
+      # with its SBOM and provenance, so every pull request proves it on both
+      # architectures; it pushes nothing. The e2e tests build the same Dockerfile, whose
+      # every input is pinned.
+      - name: Build the image as a release does
+        run: scripts/ci/build-image.sh "${{ matrix.arch }}" "$RUNNER_TEMP/image"
       - name: Scan it with Trivy (fails on critical vulnerabilities that have a fix)
-        run: |
-          scan="$(mktemp -d -p "$RUNNER_TEMP")"
-          docker save mediaplane:ci --output "$scan/mediaplane.tar"
-          docker run --rm --volume "$scan:/scan:ro" \
-            aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
-            image --input /scan/mediaplane.tar --scanners vuln --severity CRITICAL \
-            --ignore-unfixed --exit-code 1 --no-progress
+        run: scripts/ci/scan-image.sh "${{ matrix.arch }}" "$RUNNER_TEMP/image/oci"
       - name: Disk space at the end
@@ -166,2 +176,49 @@ jobs:
 
+  # The apps' images, as the catalog pins them, from their registries: both architectures
+  # from one runner. Only upstream can fix what Trivy finds there, so a finding listed in
+  # scripts/ci/catalog-ignore.yaml passes until its date.
+  catalog-images:
+    name: Catalog images (Trivy)
+    needs: changes
+    if: needs.changes.outputs.code == 'true'
+    runs-on: ubuntu-24.04
+    timeout-minutes: 30
+    steps:
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
+        with:
+          persist-credentials: false
+      - uses: ./.github/actions/docker-hub-login
+        with:
+          username: ${{ secrets.DOCKERHUB_USERNAME }}
+          token: ${{ secrets.DOCKERHUB_TOKEN }}
+      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
+      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
+        with:
+          node-version-file: .nvmrc
+          cache: pnpm
+      - run: pnpm install --frozen-lockfile
+      - name: Scan the amd64 images
+        run: scripts/ci/scan-catalog.sh amd64
+      - name: Scan the arm64 images
+        if: ${{ !cancelled() }}
+        run: scripts/ci/scan-catalog.sh arm64
+
+  # The image's Docker CLI and Compose against Docker Engine 24, the oldest Mediaplane
+  # supports. The other jobs run the runners' own Docker.
+  engine-floor:
+    name: Docker Engine 24 (the floor)
+    needs: changes
+    if: needs.changes.outputs.code == 'true'
+    runs-on: ubuntu-24.04
+    timeout-minutes: 15
+    steps:
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
+        with:
+          persist-credentials: false
+      - uses: ./.github/actions/docker-hub-login
+        with:
+          username: ${{ secrets.DOCKERHUB_USERNAME }}
+          token: ${{ secrets.DOCKERHUB_TOKEN }}
+      - run: scripts/ci/engine-floor.sh
+
   secrets:
@@ -187,3 +244,3 @@ jobs:
     name: All checks passed
-    needs: [check, changes, e2e, image, secrets]
+    needs: [check, changes, e2e, image, catalog-images, engine-floor, secrets]
     if: always()
@@ -200,9 +257,12 @@ jobs:
           IMAGE: ${{ needs.image.result }}
+          CATALOG: ${{ needs.catalog-images.result }}
+          FLOOR: ${{ needs.engine-floor.result }}
           SECRETS: ${{ needs.secrets.result }}
         run: |
-          printf '%-8s %s\n' check "$CHECK" changes "$CHANGES" e2e "$E2E" \
-            image "$IMAGE" secrets "$SECRETS"
+          printf '%-14s %s\n' check "$CHECK" changes "$CHANGES" e2e "$E2E" \
+            image "$IMAGE" catalog-images "$CATALOG" engine-floor "$FLOOR" \
+            secrets "$SECRETS"
           echo "code changed: ${CODE:-unknown}"
           status=0
-          for result in "$CHECK" "$CHANGES" "$E2E" "$IMAGE" "$SECRETS"; do
+          for result in "$CHECK" "$CHANGES" "$E2E" "$IMAGE" "$CATALOG" "$FLOOR" "$SECRETS"; do
             case "$result" in
@@ -216,3 +276,4 @@ jobs:
           if [ "$CODE" = "true" ]; then
-            for job in e2e:"$E2E" image:"$IMAGE"; do
+            for job in e2e:"$E2E" image:"$IMAGE" catalog-images:"$CATALOG" \
+              engine-floor:"$FLOOR"; do
               if [ "${job#*:}" != "success" ]; then
```

**Change** `Dockerfile`:

```diff
diff --git a/Dockerfile b/Dockerfile
index 6f50c8e..cd2b023 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -5,3 +5,3 @@
 # architecture, for every image architecture.
-FROM --platform=$BUILDPLATFORM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS bundle
+FROM --platform=$BUILDPLATFORM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS bundle
 ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
@@ -24,3 +24,3 @@ FROM docker:29.8.1-cli@sha256:018edbc908e08fcc9dbf029c812c34251e9b4719e6f71ca0e5
 
-FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
+FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
 # Only Node is needed at run time: drop the Node package managers the base image ships.
```

**Create** `scripts/ci/build-image.sh`:

```sh
#!/bin/sh
# Mediaplane's image as a release builds it (spec §8.2), for one architecture, natively:
#
#   scripts/ci/build-image.sh <amd64|arm64> <out-dir>
#
# BuildKit is pinned, the image gets an SBOM and build provenance, and its times come
# from the commit, so the same commit builds the same image. It writes the image as an
# OCI layout in <out-dir>/oci, for Trivy, and its manifest's digest in <out-dir>/digest.
set -eu

BUILDKIT=moby/buildkit:v0.34.0@sha256:b059f8d7226d0b326bc871af489a5dddf65e36af4d20d14251b072974d9ee87c
SYFT=docker/buildkit-syft-scanner:1.12.0@sha256:ae4f3b554449e7e25548e7d8ccc029d17357348e30c6e3df01b92bc93654d6a9
BUILDER=mediaplane-release

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
[ $# -eq 2 ] || fail "usage: $0 <amd64|arm64> <out-dir>"
arch=$1
out=$2
case $arch in
  amd64 | arm64) ;;
  *) fail "the architecture is amd64 or arm64, not \"$arch\"" ;;
esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)

# A builder of its own, with the pinned BuildKit: Docker's own builder can't attach an
# SBOM or provenance to an image it keeps.
docker buildx inspect "$BUILDER" >/dev/null 2>&1 ||
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt "image=$BUILDKIT" --bootstrap >/dev/null
# The commit's time, for the image's creation time and its files' times.
SOURCE_DATE_EPOCH=$(git -C "$root" log -1 --format=%ct)
export SOURCE_DATE_EPOCH

# $1: where buildx writes what it made; $2: the output.
build() {
  docker buildx build --builder "$BUILDER" --platform "linux/$arch" \
    --attest "type=sbom,generator=$SYFT" --attest type=provenance,mode=max \
    --metadata-file "$1" --output "$2" "$root"
}
# The digest of the one linux/<arch> image in an index read from stdin.
image_in() {
  jq -er --arg arch "$arch" \
    '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == $arch)]
     | if length == 1 then .[0].digest else error("not one linux/\($arch) image") end'
}

mkdir -p "$out"
rm -rf "$out/oci" "$out/digest"
build "$out/oci.json" "type=oci,dest=$out/oci,tar=false,rewrite-timestamp=true"
index=$(jq -er '.manifests[0].digest' "$out/oci/index.json")
digest=$(image_in <"$out/oci/blobs/sha256/${index#sha256:}")
printf '%s\n' "$digest" >"$out/digest"
echo "Built linux/$arch: $digest"
```

**Create** `scripts/ci/catalog-ignore.yaml`:

```yaml
# The critical vulnerabilities with a fix that CI found in the catalog's pinned images,
# which only their upstream can fix, with the date by which each is looked at again
# (scripts/ci/scan-catalog.sh). Mediaplane never patches an app's image (spec §1.4):
# a fix arrives as Renovate's bump of the pin, once upstream ships it, and its entry
# goes then. An entry past its date no longer counts, so CI fails until the pin is
# bumped or the entry is renewed with a new date and the reason. Found on 2026-10-25.
vulnerabilities:
  - id: CVE-2026-106195
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-106237
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-106445
    statement: handlebars in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: CVE-2026-106446
    statement: handlebars in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: CVE-2026-13221
    statement: perl-base in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-33937
    statement: handlebars in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: CVE-2026-42496
    statement: perl-base in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-59873
    statement: tar in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: CVE-2026-70188
    statement: ASP.NET Core runtime in Prowlarr 2.6.5.5623-ls163 and Radarr 6.4.4.10685-ls319
    expired_at: 2026-11-24
  - id: CVE-2026-75604
    statement: next in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: CVE-2026-8376
    statement: perl-base in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-87500
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-87512
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-87534
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-87544
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-87621
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-87654
    statement: Chromium in FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: CVE-2026-88092
    statement: ASP.NET Core runtime in Prowlarr 2.6.5.5623-ls163 and Radarr 6.4.4.10685-ls319
    expired_at: 2026-11-24
  - id: CVE-2026-90711
    statement: proxy-addr in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: GHSA-2464-fhr4-w9xw
    statement: next in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: GHSA-2xp9-vwfh-vxw4
    statement: next in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: GHSA-673q-mjm6-r5xr
    statement: next in Seerr v3.5.0
    expired_at: 2026-11-24
  - id: GHSA-6q48-6c7w-9gw2
    statement: certifi in Byparr 3.0.4 and FlareSolverr v3.5.2
    expired_at: 2026-11-24
  - id: GHSA-vcvr-r3jv-pc5j
    statement: next in Seerr v3.5.0
    expired_at: 2026-11-24
```

**Create** `scripts/ci/catalog-images.ts`:

```ts
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition, Arch } from '@mediaplane/engine';
import { ranAsScript } from '../root';

/** An app's image as the catalog pins it, as Docker takes it: repo:tag@digest. */
export function pinnedImage(def: Pick<AppDefinition, 'image'>): string {
  return `${def.image.repo}:${def.image.tag}@${def.image.digest}`;
}

/** Every catalog image that runs on `arch`, once each, sorted: what CI scans. */
export function catalogImages(defs: readonly AppDefinition[], arch: Arch): string[] {
  const images = defs.filter((def) => def.arch.includes(arch)).map(pinnedImage);
  return [...new Set(images)].sort();
}

// pnpm tsx scripts/ci/catalog-images.ts <amd64|arm64>: one image a line.
if (ranAsScript(import.meta.url, process.argv[1])) {
  const arch = process.argv[2];
  if (arch !== 'amd64' && arch !== 'arm64') {
    console.error('usage: catalog-images.ts <amd64|arm64>');
    process.exitCode = 1;
  } else {
    for (const image of catalogImages(catalog, arch)) console.log(image);
  }
}
```

**Create** `scripts/ci/engine-floor.sh`:

```sh
#!/bin/sh
# The Docker CLI and Compose that Mediaplane's image bundles (the Dockerfile's docker-cli
# stage), against the oldest Docker Engine Mediaplane supports, 24, in a throwaway
# Docker-in-Docker. It makes the kinds of call Mediaplane makes: versions, config hashes,
# `up --wait` with a health check and a service in another's network, `!reset`, `run
# --rm`, joining and leaving an internal network, and `down`. CI's other jobs run the
# runners' Docker; this is the floor (spec §3.3, deploy/README.md).
#
#   scripts/ci/engine-floor.sh
set -eu

ENGINE=docker:24.0.9-dind@sha256:9b17a9f25adf17b88d0a013b4f00160754adf4b07ccbe9986664a49886c2c98e
BUSYBOX=busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
cli=$(sed -n 's/^FROM \(docker:[^ ]*-cli@sha256:[0-9a-f]\{64\}\) AS docker-cli$/\1/p' "$root/Dockerfile")
[ -n "$cli" ] || {
  echo "error: the Dockerfile has no docker-cli stage pinned by digest" >&2
  exit 1
}
name=mediaplane-floor-$$
project=$(mktemp -d)
cleanup() {
  # With its volumes: the engine keeps its data in an anonymous one.
  docker rm --force --volumes "$name" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$project"
}
trap cleanup EXIT
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

docker network create "$name" >/dev/null
docker run --detach --privileged --name "$name" --network "$name" \
  --env DOCKER_TLS_CERTDIR= "$ENGINE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" docker version >/dev/null 2>&1 && break
  sleep 1
done
engine=$(docker exec "$name" docker version --format '{{.Server.Version}}') ||
  fail "Docker Engine didn't start"
case $engine in 24.*) ;; *) fail "expected Docker Engine 24, got $engine" ;; esac

cat >"$project/compose.yaml" <<EOF
name: floor
services:
  app:
    image: $BUSYBOX
    command: ['sh', '-c', 'touch /tmp/ready; exec sleep 600']
    healthcheck: { test: ['CMD', 'test', '-f', '/tmp/ready'], interval: 1s, retries: 30 }
    ports: ['127.0.0.1:8080:80']
    networks: [default, wiring]
  guest:
    image: $BUSYBOX
    command: ['sleep', '600']
    network_mode: service:app
    depends_on: { app: { condition: service_healthy, restart: true } }
networks:
  wiring: { internal: true }
EOF
printf 'services:\n  app:\n    ports: !reset []\n' >"$project/unpublished.yaml"

# The bundled CLI, talking to Engine 24.
bundled() {
  docker run --rm --network "$name" --env "DOCKER_HOST=tcp://$name:2375" \
    --volume "$project:$project" --workdir "$project" "$cli" "$@"
}
step() {
  what=$1
  shift
  echo "--- $what"
  bundled "$@" || fail "$what"
}

step 'docker version' docker version --format 'CLI {{.Client.Version}}, Engine {{.Server.Version}}'
step 'compose version' docker compose version
step 'compose config --hash' docker compose config --hash '*'
step 'compose config, with !reset' docker compose -f compose.yaml -f unpublished.yaml config --quiet
step 'compose up --wait' docker compose -f compose.yaml -f unpublished.yaml up --detach --wait
step 'compose ps --format json' docker compose ps --all --format json
step 'compose run --rm --no-deps' docker compose run --rm --no-deps app true
step 'run --rm --pull never' docker run --rm --pull never "$BUSYBOX" true
step 'network inspect' docker network inspect floor_wiring --format '{{.Internal}}'
step 'compose up, publishing' docker compose up --detach --wait
step 'run a container to join the network' docker run --detach --name joiner "$BUSYBOX" sleep 600
step 'network connect' docker network connect floor_wiring joiner
step 'network disconnect' docker network disconnect floor_wiring joiner
step 'rm -f' docker rm --force joiner
step 'compose stop' docker compose stop guest
step 'compose down' docker compose down --timeout 1
echo "The image's Docker CLI and Compose work with Docker Engine $engine."
```

**Create** `scripts/ci/node-security.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ranAsScript, ROOT } from '../root';

/**
 * Node itself is a binary in the image's base, not an Alpine package, so neither Trivy
 * nor pnpm audit sees its vulnerabilities (spec §11, Slice 2c). This check does: it fails
 * while Node has published a security release of the image's line that the image lacks.
 */

/** One release in Node's index (https://nodejs.org/dist/index.json): what this reads. */
export interface NodeRelease {
  version: string;
  security: boolean;
}

export const NODE_INDEX = 'https://nodejs.org/dist/index.json';

/** The Node version of the Dockerfile's node:<version>-… bases, which must all agree. */
export function imageNode(dockerfile: string): string {
  const versions = new Set(
    [...dockerfile.matchAll(/^FROM (?:--platform=\S+ )?node:(\d+\.\d+\.\d+)-/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
  if (versions.size === 0) throw new Error('the Dockerfile has no node:<version> base');
  if (versions.size > 1) {
    throw new Error(
      `the Dockerfile builds on more than one Node: ${[...versions].sort().join(', ')}`,
    );
  }
  return [...versions][0] ?? '';
}

const parts = (version: string): number[] =>
  version.replace(/^v/, '').split('.').map(Number);

const newer = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};

/**
 * The security releases of `current`'s major line newer than `current`, oldest first.
 * An index that lists nothing of that line is refused: it can't show the image current.
 */
export function missedSecurityReleases(
  current: string,
  index: readonly NodeRelease[],
): string[] {
  const mine = parts(current);
  const line = index.filter((release) => parts(release.version)[0] === mine[0]);
  if (line.length === 0) {
    throw new Error(`Node's release index lists no ${String(mine[0])}.x release`);
  }
  return line
    .filter((release) => release.security && newer(parts(release.version), mine))
    .map((release) => release.version.replace(/^v/, ''))
    .sort((a, b) => (newer(parts(a), parts(b)) ? 1 : -1));
}

/** Node's index, tried three times, 5 and 15 seconds apart, 30 seconds each. */
async function fetchIndex(): Promise<NodeRelease[]> {
  let last: unknown;
  for (const wait of [0, 5_000, 15_000]) {
    await sleep(wait);
    try {
      const response = await fetch(NODE_INDEX, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return (await response.json()) as NodeRelease[];
    } catch (cause) {
      last = cause;
    }
  }
  throw new Error(
    `couldn't read ${NODE_INDEX}: ${last instanceof Error ? last.message : String(last)}`,
  );
}

async function main(): Promise<number> {
  const current = imageNode(await readFile(join(ROOT, 'Dockerfile'), 'utf8'));
  const missed = missedSecurityReleases(current, await fetchIndex());
  if (missed.length === 0) {
    console.log(`The image's Node, ${current}, has every security release of its line.`);
    return 0;
  }
  console.error(
    `The image's Node is ${current}, but Node has published security releases since: ${missed.join(', ')}. Bump the node pin in the Dockerfile (Renovate opens that pull request).`,
  );
  return 1;
}

if (ranAsScript(import.meta.url, process.argv[1])) {
  try {
    process.exitCode = await main();
  } catch (cause) {
    console.error(`error: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
```

**Create** `scripts/ci/scan-catalog.sh`:

```sh
#!/bin/sh
# Trivy on every image the catalog pins, from its registry, for one architecture (spec
# §7.2(7)). It fails on a critical vulnerability that has a fix, but for those listed in
# scripts/ci/catalog-ignore.yaml until each entry's date: only upstream can fix them.
#
#   scripts/ci/scan-catalog.sh <amd64|arm64>
set -eu

TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969

[ $# -eq 1 ] || {
  echo "usage: $0 <amd64|arm64>" >&2
  exit 1
}
arch=$1
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
images=$(cd "$root" && pnpm --silent exec tsx scripts/ci/catalog-images.ts "$arch")
[ -n "$images" ] || {
  echo "error: no catalog images for $arch" >&2
  exit 1
}
# One vulnerability database for every scan, in a folder of this run's own.
cache=$(mktemp -d)
trap 'rm -rf "$cache"' EXIT
# Pulled with Docker's login, when there is one (CI logs in to Docker Hub when it can).
set -- --rm --user "$(id -u):$(id -g)" --env HOME=/home/trivy \
  --volume "$cache:/cache" --volume "$root/scripts/ci/catalog-ignore.yaml:/ignore.yaml:ro"
if [ -f "$HOME/.docker/config.json" ]; then
  set -- "$@" --volume "$HOME/.docker/config.json:/home/trivy/.docker/config.json:ro"
fi
found=
unscanned=
for image in $images; do
  echo "--- $image (linux/$arch)"
  # Trivy exits 3 on a finding, and 1 when it couldn't scan, such as when the registry
  # asks it to slow down: that is tried again, after 15 and 45 seconds.
  for wait in 0 15 45; do
    sleep "$wait"
    code=0
    docker run "$@" "$TRIVY" image --cache-dir /cache --image-src remote \
      --platform "linux/$arch" --ignorefile /ignore.yaml --scanners vuln \
      --severity CRITICAL --ignore-unfixed --exit-code 3 --no-progress \
      --skip-version-check "$image" || code=$?
    [ "$code" -ne 0 ] && [ "$code" -ne 3 ] || break
  done
  case $code in
    0) ;;
    3) found="$found $image" ;;
    *) unscanned="$unscanned $image" ;;
  esac
done
if [ -n "$found" ]; then
  echo "These images have a critical vulnerability with a fix that scripts/ci/catalog-ignore.yaml doesn't list (linux/$arch):" >&2
  for image in $found; do echo "  $image" >&2; done
fi
if [ -n "$unscanned" ]; then
  echo "These images couldn't be scanned, three times (linux/$arch):" >&2
  for image in $unscanned; do echo "  $image" >&2; done
fi
[ -z "$found$unscanned" ] || exit 1
echo "No critical vulnerability with a fix in the catalog's images (linux/$arch), but those listed in scripts/ci/catalog-ignore.yaml."
```

**Create** `scripts/ci/scan-image.sh`:

```sh
#!/bin/sh
# Trivy on Mediaplane's image, as build-image.sh wrote it (an OCI layout), for one
# architecture. It fails on a critical vulnerability that has a fix (spec §7.2(7)).
#
#   scripts/ci/scan-image.sh <amd64|arm64> <oci-dir>
set -eu

TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969

[ $# -eq 2 ] || {
  echo "usage: $0 <amd64|arm64> <oci-dir>" >&2
  exit 1
}
arch=$1
oci=$(CDPATH='' cd -- "$2" && pwd)
# Only the image's folder is mounted, read-only.
docker run --rm --volume "$oci:/scan:ro" "$TRIVY" \
  image --input /scan --platform "linux/$arch" --scanners vuln --severity CRITICAL \
  --ignore-unfixed --exit-code 1 --no-progress --skip-version-check
```

Make the new scripts executable:

```bash
chmod +x scripts/ci/build-image.sh scripts/ci/scan-image.sh scripts/ci/scan-catalog.sh scripts/ci/engine-floor.sh
```

- [ ] **Step 4: Run the tests, and see them pass**

Run: `pnpm vitest run scripts/ci scripts/supply-chain.test.ts`
Expected: PASS, 37 tests.

- [ ] **Step 5: See Node's check fail on the image's Node, then bump it**

Run: `pnpm exec tsx scripts/ci/node-security.ts`
Expected, before the `Dockerfile`'s block: exit 1, `The image's Node is 24.21.0, but Node
has published security releases since: 24.22.1. Bump the node pin in the Dockerfile
(Renovate opens that pull request).` (A newer security release since 2026-10-25 would be
named too: bump to the newest, then, with its digest from
`docker buildx imagetools inspect node:<version>-alpine3.24`.)

Apply the `Dockerfile`'s block above, then run it again.
Expected: exit 0, `The image's Node, 24.22.1, has every security release of its line.`

- [ ] **Step 6: Run the CI scripts on the dev box**

Run, each from the repo root (the dev box is arm64; CI runs amd64 too):

```bash
out=$(mktemp -d)
scripts/ci/build-image.sh arm64 "$out"
scripts/ci/scan-image.sh arm64 "$out/oci"
scripts/ci/scan-catalog.sh arm64
scripts/ci/scan-catalog.sh amd64
scripts/ci/engine-floor.sh
rm -rf "$out"
docker buildx rm mediaplane-release
```

Expected: `Built linux/arm64: sha256:…`; Trivy's table with `0` for the image's Alpine
packages, `docker` and `docker-compose`, exit 0; each catalog scan ends `No critical
vulnerability with a fix in the catalog's images (linux/<arch>), but those listed in
scripts/ci/catalog-ignore.yaml.` (about two minutes each; a vulnerability published after
2026-10-25 may add a finding, which is the check working; a registry's `TOOMANYREQUESTS`
is tried twice more, then fails as "couldn't be scanned"); the floor ends `The image's
Docker CLI and Compose work with Docker Engine 24.0.9.` in about a minute, and leaves no
container, network or volume (`docker volume ls` lists what it did before). Then run actionlint and shellcheck as in Task 2.

- [ ] **Step 7: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2165 tests in 97 files.

- [ ] **Step 8: Commit**

```bash
git add .github/actions/docker-hub-login/action.yml \
  .github/workflows/ci.yml \
  Dockerfile \
  scripts/ci/build-image.sh \
  scripts/ci/catalog-ignore.yaml \
  scripts/ci/catalog-images.test.ts \
  scripts/ci/catalog-images.ts \
  scripts/ci/engine-floor.sh \
  scripts/ci/node-security.test.ts \
  scripts/ci/node-security.ts \
  scripts/ci/scan-catalog.sh \
  scripts/ci/scan-image.sh \
  scripts/supply-chain.test.ts
git commit -m "ci: the release's own image build and Trivy on both architectures, Trivy on the catalog's images, Node's security releases, Docker Engine 24, and Docker Hub pulls with a token when there is one" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: `install.sh` installs a release, pinned by digest

A release's own `install.sh` and `mediaplane.compose.yaml` name its image by digest;
`install.sh` pulls it before anything is recreated, refuses an image that isn't pinned,
and never touches the stack. `scripts/release/pin.ts` writes a release's copies; the
sandbox tests use it as the release workflow will.

Decision: a release's deploy files pin its image; the repository's leave it out (decision 3).
Decision: `install.sh` verifies the digest by pulling by it, refuses an unpinned image, and runs Docker on Mediaplane's own deployment only (decision 4).
Decision: no new proxy permission: a test shows the allow-list already lets the host helper inspect a release's image (decision 20).

**Files:**
- Create: `scripts/release/pin.test.ts`, `scripts/release/pin.ts`
- Modify: `deploy/install.sh`, `deploy/mediaplane.compose.yaml`
- Test: `deploy/deploy.test.ts`

**Interfaces:**
- **Consumes:** `deploy/install.sh`, `deploy/mediaplane.compose.yaml`, and `deploy/deploy.test.ts`'s sandbox.
- **Produces:** `pinnedInstaller(text: string, image: string): string` and
  `pinnedDeployment(text: string, image: string): string` in `scripts/release/pin.ts`, which
  Task 5's `bundleFiles` uses; the line `release_image=''` in `install.sh`.

- [ ] **Step 1: Write the failing tests**

**Change** `deploy/deploy.test.ts`:

```diff
diff --git a/deploy/deploy.test.ts b/deploy/deploy.test.ts
index c501eef..86b4479 100644
--- a/deploy/deploy.test.ts
+++ b/deploy/deploy.test.ts
@@ -19,2 +19,3 @@ import { afterAll, describe, expect, it } from 'vitest';
 import { parse } from 'yaml';
+import { pinnedDeployment, pinnedInstaller } from '../scripts/release/pin';
 
@@ -68,2 +69,4 @@ const allowed = (method: string, path: string): boolean =>
 const ID = 'f'.repeat(64);
+/** A release's image, as the release workflow pins it in that release's deploy files. */
+const RELEASE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;
 /** CI's Docker 28 speaks API 1.51; Docker 29.8 speaks 1.56. */
@@ -251,2 +254,4 @@ describe('the socket proxy allow-list', () => {
     `sha256:${ID}`,
+    // A release's image, as its own mediaplane.compose.yaml names it.
+    `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${ID}`,
   ])('allows inspecting the image %s', (reference) => {
@@ -341,2 +346,5 @@ describe('the installer', () => {
     buildFails?: boolean;
+    pullFails?: boolean;
+    /** A release's own deploy files (pinned to RELEASE), with no checkout around them. */
+    release?: boolean;
     /** deploy/.env's text, when one is already there. */
@@ -372,2 +380,15 @@ describe('the installer', () => {
     }
+    if (options.release === true) {
+      // As the release workflow writes them: its image, pinned, in both files.
+      writeFileSync(
+        join(deploy, 'install.sh'),
+        pinnedInstaller(readFileSync(INSTALL, 'utf8'), RELEASE),
+      );
+      writeFileSync(
+        join(deploy, 'mediaplane.compose.yaml'),
+        pinnedDeployment(readFileSync(FILE, 'utf8'), RELEASE),
+      );
+    } else {
+      writeFileSync(join(top, 'checkout', 'Dockerfile'), 'FROM scratch\n');
+    }
     chmodSync(join(deploy, 'install.sh'), 0o755);
@@ -391,2 +412,3 @@ case "$*" in
   build*) exit ${options.buildFails === true ? '1' : '0'} ;;
+  *' pull'*) exit ${options.pullFails === true ? '1' : '0'} ;;
 esac
@@ -418,3 +440,4 @@ exit 0
     const homeVar = options.homeVar === undefined ? home : options.homeVar;
-    const run = () => {
+    /** install.sh, with `extra` added to its environment, after the sandbox's own. */
+    const run = (extra: NodeJS.ProcessEnv = {}) => {
       const result = spawnSync(join(deploy, 'install.sh'), [], {
@@ -427,2 +450,3 @@ exit 0
           MEDIAPLANE_TEST_DOCKER_SOCKET: socketPath,
+          ...extra,
         },
@@ -456,3 +480,3 @@ exit 0
   const changedNothing = (box: Sandbox, calls: string[]) => {
-    expect(calls.some((call) => / build | up -d/.test(` ${call}`))).toBe(false);
+    expect(calls.some((call) => / build | pull| up -d/.test(` ${call}`))).toBe(false);
     expect(calls.some((call) => call.startsWith('sudo'))).toBe(false);
@@ -552,5 +576,8 @@ exit 0
 
-  it.runIf(asYou)('reads a deploy/.env home with Windows line ends as Compose does', () =>
+  it.runIf(asYou)('reads a deploy/.env with Windows line ends as Compose does', () =>
     inSandbox({ homeVar: null }, (box) => {
-      writeFileSync(join(box.deploy, '.env'), `MEDIAPLANE_HOME=${box.home}\r\n`);
+      writeFileSync(
+        join(box.deploy, '.env'),
+        `MEDIAPLANE_IMAGE=mediaplane:local\r\nMEDIAPLANE_HOME=${box.home}\r\n`,
+      );
       const result = box.run();
@@ -558,2 +585,5 @@ exit 0
       expect(statSync(box.home).isDirectory()).toBe(true);
+      expect(result.calls).toContain(
+        `docker build --tag mediaplane:local ${join(box.top, 'checkout')}`,
+      );
     }),
@@ -616,2 +646,162 @@ exit 0
 
+  it.runIf(asYou)(
+    'from a release: pulls its image, pinned by digest, before it starts it, and builds nothing',
+    () =>
+      inSandbox({ release: true }, (box) => {
+        const result = box.run();
+        expect(result.code, result.err).toBe(0);
+        const file = join(box.deploy, 'mediaplane.compose.yaml');
+        const pull = result.calls.indexOf(`docker compose -f ${file} pull`);
+        const up = result.calls.indexOf(`docker compose -f ${file} up -d`);
+        expect(pull).toBeGreaterThanOrEqual(0);
+        expect(up).toBeGreaterThan(pull);
+        expect(result.calls.some((call) => call.startsWith('docker build'))).toBe(false);
+        // mediaplane.compose.yaml names the release's image, so deploy/.env doesn't: the
+        // next release's file names the next one.
+        const env = readFileSync(join(box.deploy, '.env'), 'utf8');
+        expect(env).not.toContain('MEDIAPLANE_IMAGE');
+        expect(result.out).toContain(`Pulling ${RELEASE}`);
+      }),
+  );
+
+  it.runIf(asYou)(
+    'updates by running again: keeps deploy/.env, and pulls the new image before up',
+    () =>
+      inSandbox({ release: true, homeVar: null }, (box) => {
+        const kept = `MEDIAPLANE_UID=1000\nTZ=Etc/UTC\nMEDIAPLANE_HOME=${box.home}\n`;
+        writeFileSync(join(box.deploy, '.env'), kept);
+        mkdirSync(box.home);
+        writeFileSync(join(box.home, 'stack.yaml'), 'version: 1\n');
+        const result = box.run();
+        expect(result.code, result.err).toBe(0);
+        expect(readFileSync(join(box.deploy, '.env'), 'utf8')).toBe(kept);
+        const file = join(box.deploy, 'mediaplane.compose.yaml');
+        expect(result.calls.filter((call) => call.startsWith('docker compose'))).toEqual([
+          'docker compose version --short',
+          `docker compose -f ${file} pull`,
+          `docker compose -f ${file} up -d`,
+        ]);
+      }),
+  );
+
+  it.runIf(asYou)(
+    "never touches the stack: Docker is asked only about Mediaplane's own",
+    () =>
+      inSandbox({ release: true }, (box) => {
+        const result = box.run();
+        expect(result.code, result.err).toBe(0);
+        const file = join(box.deploy, 'mediaplane.compose.yaml');
+        for (const call of result.calls.filter((c) => c.startsWith('docker '))) {
+          expect(call).toMatch(
+            new RegExp(
+              `^docker (version --format \\S+|info( --format \\S+)?|compose version --short|compose -f ${file} (pull|up -d))$`,
+            ),
+          );
+        }
+      }),
+  );
+
+  it.runIf(asYou)(
+    "keeps an image deploy/.env names, and says how to run the release's instead",
+    () =>
+      inSandbox({ release: true, homeVar: null }, (box) => {
+        const own = `registry.example/team/mediaplane:0.0.9@sha256:${'2'.repeat(64)}`;
+        writeFileSync(
+          join(box.deploy, '.env'),
+          `MEDIAPLANE_IMAGE=${own}\nMEDIAPLANE_HOME=${box.home}\n`,
+        );
+        const result = box.run();
+        expect(result.code, result.err).toBe(0);
+        expect(result.out).toContain(`deploy/.env names MEDIAPLANE_IMAGE=${own}`);
+        expect(result.out).toContain('remove that line from deploy/.env');
+      }),
+  );
+
+  it.each([
+    [{ release: true }, 'registry.example/team/mediaplane:0.1.0'],
+    [{}, 'registry.example/team/mediaplane:0.1.0'],
+    [{}, `registry.example/team/mediaplane@sha256:${'2'.repeat(63)}`],
+  ] as const)(
+    'refuses an image not pinned by digest, before it changes anything: %o %s',
+    (options, image) =>
+      inSandbox(options, (box) => {
+        const result = box.run({ MEDIAPLANE_IMAGE: image });
+        expect(result.code).toBe(1);
+        expect(result.err).toContain(`MEDIAPLANE_IMAGE=${image} isn't pinned by digest`);
+        expect(result.err).toContain('@sha256:');
+        expect(result.calls).toEqual([]);
+      }),
+  );
+
+  it('refuses an unpinned image deploy/.env names', () =>
+    inSandbox(
+      {
+        env: 'MEDIAPLANE_IMAGE=registry.example/team/mediaplane:latest\n',
+        homeVar: null,
+      },
+      (box) => {
+        const result = box.run();
+        expect(result.code).toBe(1);
+        expect(result.err).toContain(
+          "MEDIAPLANE_IMAGE=registry.example/team/mediaplane:latest isn't pinned by digest",
+        );
+        expect(result.calls).toEqual([]);
+      },
+    ));
+
+  it.runIf(asYou)(
+    'pulls an image of your own pinned by digest, and keeps it in deploy/.env',
+    () =>
+      inSandbox({}, (box) => {
+        const own = `registry.example/team/mediaplane:0.1.0@sha256:${'2'.repeat(64)}`;
+        const result = box.run({ MEDIAPLANE_IMAGE: own });
+        expect(result.code, result.err).toBe(0);
+        expect(readFileSync(join(box.deploy, '.env'), 'utf8')).toContain(
+          `MEDIAPLANE_IMAGE=${own}\n`,
+        );
+        expect(result.calls).toContain(
+          `docker compose -f ${join(box.deploy, 'mediaplane.compose.yaml')} pull`,
+        );
+        expect(result.calls.some((call) => call.startsWith('docker build'))).toBe(false);
+      }),
+  );
+
+  it.runIf(asYou)('stops at a pull that fails, before the container', () =>
+    inSandbox({ release: true, pullFails: true }, (box) => {
+      const result = box.run();
+      expect(result.code).toBe(1);
+      expect(result.err).toContain(`couldn't pull Mediaplane's images`);
+      expect(result.calls.some((call) => call.includes('up -d'))).toBe(false);
+    }),
+  );
+
+  it('refuses a MEDIAPLANE_IMAGE that differs from the image deploy/.env keeps', () =>
+    inSandbox(
+      {
+        env: `MEDIAPLANE_IMAGE=mediaplane:local\nMEDIAPLANE_HOME=/srv/fake-x\n`,
+        homeVar: null,
+      },
+      (box) => {
+        const result = box.run({ MEDIAPLANE_IMAGE: RELEASE });
+        expect(result.code).toBe(1);
+        expect(result.err).toContain(
+          `deploy/.env says the image is mediaplane:local, but MEDIAPLANE_IMAGE says ${RELEASE}`,
+        );
+        expect(result.calls).toEqual([]);
+      },
+    ));
+
+  it('refuses to build mediaplane:local where there is no checkout to build', () =>
+    inSandbox(
+      { release: true, env: 'MEDIAPLANE_IMAGE=mediaplane:local\n', homeVar: null },
+      (box) => {
+        const result = box.run();
+        expect(result.code).toBe(1);
+        expect(result.err).toContain('mediaplane:local is built from a checkout');
+        expect(result.calls.some((call) => / build | up -d/.test(` ${call}`))).toBe(
+          false,
+        );
+      },
+    ));
+
   it.runIf(asYou)(
```

**Create** `scripts/release/pin.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import { pinnedDeployment, pinnedInstaller } from './pin';

const IMAGE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;
const INSTALL = readFileSync(join(ROOT, 'deploy/install.sh'), 'utf8');
const DEPLOYMENT = readFileSync(join(ROOT, 'deploy/mediaplane.compose.yaml'), 'utf8');

/** The lines of `after` that differ from `before`'s, side by side. */
const changed = (before: string, after: string) => {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b).toHaveLength(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]));
};

describe("a release's own deploy files", () => {
  it('name its image in install.sh, on one line, and change nothing else', () => {
    expect(changed(INSTALL, pinnedInstaller(INSTALL, IMAGE))).toEqual([
      ["release_image=''", `release_image='${IMAGE}'`],
    ]);
  });

  it("make its image mediaplane.compose.yaml's default, and change nothing else", () => {
    const pinned = pinnedDeployment(DEPLOYMENT, IMAGE);
    const lines = changed(DEPLOYMENT, pinned);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[1]).toBe(
      `x-mediaplane-image: &mediaplane-image '\${MEDIAPLANE_IMAGE:-${IMAGE}}'`,
    );
    const deployment = parse(pinned) as {
      services: { mediaplane: { image: string; environment: Record<string, string> } };
    };
    expect(deployment.services.mediaplane.image).toBe(`\${MEDIAPLANE_IMAGE:-${IMAGE}}`);
    expect(deployment.services.mediaplane.environment.MEDIAPLANE_IMAGE).toBe(
      `\${MEDIAPLANE_IMAGE:-${IMAGE}}`,
    );
  });

  it.each([
    ['ghcr.io/cyclopsgd/mediaplane:0.1.0', 'pinned by digest'],
    [`ghcr.io/cyclopsgd/mediaplane@sha256:${'1'.repeat(64)}`, 'pinned by digest'],
    [`ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(63)}`, 'pinned by digest'],
    [`ghcr.io/x/m:0.1.0'; rm -rf /;'@sha256:${'1'.repeat(64)}`, 'pinned by digest'],
  ])('refuse the image %s', (image, said) => {
    expect(() => pinnedInstaller(INSTALL, image)).toThrow(said);
    expect(() => pinnedDeployment(DEPLOYMENT, image)).toThrow(said);
  });

  it('refuse files that are not the ones they pin', () => {
    expect(() => pinnedInstaller('#!/bin/sh\n', IMAGE)).toThrow(
      "install.sh has no release_image='' line",
    );
    expect(() => pinnedInstaller(pinnedInstaller(INSTALL, IMAGE), IMAGE)).toThrow(
      "install.sh has no release_image='' line",
    );
    expect(() => pinnedDeployment('name: x\n', IMAGE)).toThrow(
      'mediaplane.compose.yaml has no required MEDIAPLANE_IMAGE',
    );
  });
});
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run deploy/deploy.test.ts scripts/release/pin.test.ts`
Expected: FAIL, both files before any test runs: `Cannot find module
'../scripts/release/pin'` and `Cannot find module './pin'`.

- [ ] **Step 3: Write the implementation**

**Change** `deploy/install.sh`:

```diff
diff --git a/deploy/install.sh b/deploy/install.sh
index 569df81..0701d89 100755
--- a/deploy/install.sh
+++ b/deploy/install.sh
@@ -1,9 +1,10 @@
 #!/bin/sh
-# Mediaplane's installer (deploy/README.md): from a checkout, run ./deploy/install.sh as
-# your normal user. It checks Docker, builds the image, makes the home, writes
+# Mediaplane's installer (deploy/README.md): run ./deploy/install.sh as your normal user.
+# From a release's own deploy files it pulls that release's image, pinned by digest;
+# from a checkout it builds the image. It checks Docker, makes the home, writes
 # deploy/.env, starts Mediaplane's container and installs the `mediaplane` command. It
 # uses sudo only for what it can't do as you: to create the home under a folder that
-# isn't yours, and to install the command in /usr/local/bin. Run it again after
-# `git pull` to update: it keeps your deploy/.env, home included, and never touches your
-# stack.
+# isn't yours, and to install the command in /usr/local/bin. Run it again to update, from
+# the next release's deploy files or after `git pull`: it keeps your deploy/.env, home
+# included, and never touches your stack.
 set -eu
@@ -17,2 +18,6 @@ bindir=${MEDIAPLANE_TEST_BIN_DIR:-/usr/local/bin}
 socket=${MEDIAPLANE_TEST_DOCKER_SOCKET:-/var/run/docker.sock}
+# The image a release runs, pinned by digest. A release's own copy of this file names it,
+# as its mediaplane.compose.yaml does (scripts/release/pin.ts writes both). A checkout's
+# is empty: the installer builds the image there instead.
+release_image=''
 
@@ -23,2 +28,9 @@ fail() {
 }
+# Whether image $1 is pinned by digest: <name>@sha256:<64 hex digits>.
+pinned() {
+  case $1 in *@sha256:*) ;; *) return 1 ;; esac
+  digest=${1##*@sha256:}
+  [ ${#digest} -eq 64 ] || return 1
+  case $digest in *[!0-9a-f]*) return 1 ;; esac
+}
 # Whether version $1 (such as 2.38.2 or v2.38.2) is at least major $2, minor $3.
@@ -63,4 +75,24 @@ case $home in
 esac
-image=$(from_env_file MEDIAPLANE_IMAGE)
-image=${image:-${MEDIAPLANE_IMAGE:-mediaplane:local}}
+# The image: the one deploy/.env names once it exists, so a re-run keeps yours; else a
+# release's own; else, in a checkout, the one it builds.
+kept_image=$(from_env_file MEDIAPLANE_IMAGE)
+if [ -e "$env_file" ]; then
+  image=${kept_image:-$release_image}
+  [ -n "$image" ] ||
+    fail "deploy/.env names no MEDIAPLANE_IMAGE: add MEDIAPLANE_IMAGE=mediaplane:local to it to build the image from this checkout, then run this again"
+  if [ -n "${MEDIAPLANE_IMAGE:-}" ] && [ "$MEDIAPLANE_IMAGE" != "$image" ]; then
+    fail "deploy/.env says the image is $image, but MEDIAPLANE_IMAGE says $MEDIAPLANE_IMAGE: unset MEDIAPLANE_IMAGE, or change deploy/.env, then run this again"
+  fi
+else
+  image=${MEDIAPLANE_IMAGE:-$release_image}
+  image=${image:-mediaplane:local}
+fi
+# Every run starts the image that was checked: one from a registry is pinned by digest,
+# which Docker verifies as it pulls it. mediaplane:local is built from the checkout.
+if [ "$image" != mediaplane:local ] && ! pinned "$image"; then
+  fail "MEDIAPLANE_IMAGE=$image isn't pinned by digest: name it as <name>:<tag>@sha256:<digest>, as a release's deploy files do (docker buildx imagetools inspect <name>:<tag> shows the digest), or as mediaplane:local to build it from a checkout"
+fi
+if [ "$image" = mediaplane:local ] && [ ! -f "$root/Dockerfile" ]; then
+  fail "mediaplane:local is built from a checkout, and $root isn't one: remove MEDIAPLANE_IMAGE from deploy/.env to run this release's image, then run this again"
+fi
 
@@ -113,3 +145,5 @@ else
   {
-    say "MEDIAPLANE_IMAGE=$image"
+    # A release's image goes unnamed: its mediaplane.compose.yaml names it, and the next
+    # release's names the next one.
+    if [ "$image" != "$release_image" ]; then say "MEDIAPLANE_IMAGE=$image"; fi
     say "MEDIAPLANE_UID=$(id -u)"
@@ -124,7 +158,22 @@ fi
 
-# deploy/.env decides: the same names exported in this shell would override it.
-(
-  unset MEDIAPLANE_IMAGE MEDIAPLANE_UID MEDIAPLANE_GID DOCKER_GID TZ MEDIAPLANE_HOME
-  docker compose -f "$here/mediaplane.compose.yaml" up -d
+if [ -n "$release_image" ] && [ "$image" != "$release_image" ]; then
+  say "Note: deploy/.env names MEDIAPLANE_IMAGE=$image, so this release's image, $release_image, isn't the one that runs: to run it, remove that line from deploy/.env, then run this again."
+fi
+
+# Mediaplane's own deployment, and nothing else: never the stack. deploy/.env decides:
+# the same names exported in this shell would override it. Compose's own would move it to
+# another project or file.
+system() (
+  unset MEDIAPLANE_IMAGE MEDIAPLANE_UID MEDIAPLANE_GID DOCKER_GID TZ MEDIAPLANE_HOME \
+    COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES
+  docker compose -f "$here/mediaplane.compose.yaml" "$@"
 )
+# Pulled before anything is recreated, so a pull that fails leaves Mediaplane as it was.
+if [ "$image" = mediaplane:local ]; then
+  system pull socket-proxy || fail "couldn't pull Mediaplane's images: the lines above say why"
+else
+  say "Pulling $image and the socket proxy..."
+  system pull || fail "couldn't pull Mediaplane's images: the lines above say why"
+fi
+system up -d
 
```

**Change** `deploy/mediaplane.compose.yaml`:

```diff
diff --git a/deploy/mediaplane.compose.yaml b/deploy/mediaplane.compose.yaml
index 31c017b..4dec738 100644
--- a/deploy/mediaplane.compose.yaml
+++ b/deploy/mediaplane.compose.yaml
@@ -5,3 +5,4 @@
 # Settings, from a .env file next to this one or from the environment:
-#   MEDIAPLANE_IMAGE  the Mediaplane image to run (required: none is published yet)
+#   MEDIAPLANE_IMAGE  the Mediaplane image to run: a release's own copy of this file runs
+#                     that release's, pinned by digest; from a checkout, set it
 #   DOCKER_GID        the group that owns the Docker socket: stat -L -c %g /var/run/docker.sock
```

**Create** `scripts/release/pin.ts`:

```ts
/**
 * A release's own copies of deploy/install.sh and deploy/mediaplane.compose.yaml name the
 * image that release runs, pinned by digest. In the repository both leave it out: a
 * checkout builds its own image, or is told one. The release workflow writes the copies
 * once the image is pushed and its digest known (spec §4.4, §8.2).
 */

/** An image name with its tag and digest, in characters safe in shell and YAML quotes. */
const PINNED =
  /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}@sha256:[0-9a-f]{64}$/;

function checked(image: string): string {
  if (!PINNED.test(image)) {
    throw new Error(
      `the release image must be pinned by digest, as name:tag@sha256:<digest>, not "${image}"`,
    );
  }
  return image;
}

/** `text`, with `from` (found exactly once) replaced by `to`, or why not. */
function once(text: string, from: string, to: string, missing: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(missing);
  return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
}

/** install.sh, naming `image` as the release's: it pulls that, and never builds. */
export function pinnedInstaller(text: string, image: string): string {
  const pinned = checked(image);
  return once(
    text,
    "\nrelease_image=''\n",
    `\nrelease_image='${pinned}'\n`,
    "install.sh has no release_image='' line to name the release's image on",
  );
}

/**
 * mediaplane.compose.yaml, with `image` as the default MEDIAPLANE_IMAGE: `up -d` runs it
 * unless deploy/.env names another.
 */
export function pinnedDeployment(text: string, image: string): string {
  const pinned = checked(image);
  const line =
    /^x-mediaplane-image: &mediaplane-image '\$\{MEDIAPLANE_IMAGE:\?[^'}]*\}'$/m;
  const found = line.exec(text);
  if (found === null) {
    throw new Error(
      'mediaplane.compose.yaml has no required MEDIAPLANE_IMAGE to give a default to',
    );
  }
  return once(
    text,
    found[0],
    `x-mediaplane-image: &mediaplane-image '\${MEDIAPLANE_IMAGE:-${pinned}}'`,
    'mediaplane.compose.yaml names MEDIAPLANE_IMAGE more than once',
  );
}
```

- [ ] **Step 4: Run the tests, and see them pass**

Run: `pnpm vitest run deploy/deploy.test.ts scripts/release/pin.test.ts`
Expected: PASS, 132 tests. Then shellcheck `deploy/install.sh` as in Task 2: no finding.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2185 tests in 98 files.

- [ ] **Step 6: Commit**

```bash
git add deploy/deploy.test.ts \
  deploy/install.sh \
  deploy/mediaplane.compose.yaml \
  scripts/release/pin.test.ts \
  scripts/release/pin.ts
git commit -m "feat(deploy): install.sh runs a release's own image, pinned by digest, pulled before anything is recreated; an image not pinned by digest is refused" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The release workflow: publish only a release, after CI, with the deploy files and the tested app versions; and an update end to end

`release.yml` publishes only what release-please cuts, once CI passed on it: the image,
pushed by digest as scanned, tagged for both architectures and attested; the deploy files
and `SHA256SUMS`, attested; the tested app versions in the notes. The end-to-end update
test uses the same deploy files, from a registry of its own.

Decision: only a release publishes, and only a commit CI passed (decision 1).
Decision: push by digest the image scanned, checked; one index of both, never `latest` (decision 2).
Decision: the deploy files: the repository's `deploy/`, pinned, the same bytes for the same commit (decision 3); tested app versions as a list (decision 19).
Decision: each job's token and secrets, exactly (decision 17); updating, and going back, proved on real Docker (decision 5).

**Files:**
- Create: `.github/workflows/release.yml`, `scripts/release/ci-passed.sh`, `scripts/release/ci-passed.test.ts`, `scripts/release/deploy-bundle.test.ts`, `scripts/release/deploy-bundle.ts`, `scripts/release/permissions.ts`, `scripts/release/publish-image.sh`, `scripts/release/tested-apps.test.ts`, `scripts/release/tested-apps.ts`, `scripts/release/workflow.test.ts`, `test/e2e/update.e2e.test.ts`
- Modify: `scripts/ci/build-image.sh`, `test/e2e/helpers.ts`
- Test: `scripts/supply-chain.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `release-please-config.json` and manifest; Task 3's `build-image.sh`,
  `scan-image.sh` and `docker-hub-login`; Task 4's `pinnedInstaller` and `pinnedDeployment`;
  `pinnedImage`'s idea of a pin; `test/e2e/helpers.ts`.
- **Produces:** `.github/workflows/release.yml`; `build-image.sh <arch> <out> --push <name>`, writing
  `<out>/pushed`; `scripts/release/publish-image.sh <name> <version> <out-file>
  <pushed-file>...`; `bundleFiles(read, image): BundleFile[]` and
  `writeBundle({ root, out, version, image, epoch }): Promise<{ archive; sha256 }>` in
  `scripts/release/deploy-bundle.ts`; `testedApps(defs, image): string` in
  `scripts/release/tested-apps.ts`; `scripts/release/ci-passed.sh <sha> [<minutes>]`;
  `RELEASE_JOB_PERMISSIONS` in `scripts/release/permissions.ts`; `buildImage(tag, args?)`
  in `test/e2e/helpers.ts`.

- [ ] **Step 1: Write the failing tests**

`scripts/release/permissions.ts` is what the tests expect of `release.yml`'s tokens, in
one place: `supply-chain.test.ts` and `workflow.test.ts` both import it.

**Create** `scripts/release/permissions.ts`:

```ts
/**
 * What each job of `.github/workflows/release.yml` may do with its token, and nothing
 * more: `scripts/supply-chain.test.ts` and `workflow.test.ts` both hold the workflow to it.
 */
export const RELEASE_JOB_PERMISSIONS: Record<string, Record<string, string>> = {
  'release-please': { contents: 'write', issues: 'write', 'pull-requests': 'write' },
  'ci-passed': { contents: 'read', checks: 'read' },
  image: { contents: 'read', packages: 'write' },
  publish: {
    contents: 'read',
    packages: 'write',
    'id-token': 'write',
    attestations: 'write',
  },
  assets: { contents: 'read' },
  upload: { contents: 'write', 'id-token': 'write', attestations: 'write' },
};
```

**Create** `scripts/release/ci-passed.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT } from '../root';

const SCRIPT = join(ROOT, 'scripts/release/ci-passed.sh');
const SHA = 'a'.repeat(40);
let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/**
 * ci-passed.sh with a stand-in for gh, first on PATH, that answers each call with the
 * next of `answers` (the check runs, as the script's --jq gives them), the last one again
 * after that, and logs its arguments.
 */
function run(answers: object[][], minutes = '1') {
  const dir = mkdtempSync(join(tmpdir(), 'mp-ci-passed-'));
  dirs.push(dir);
  answers.forEach((answer, i) => {
    writeFileSync(join(dir, `answer-${String(i)}`), JSON.stringify(answer));
  });
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/calls'
n=$(cat '${dir}/n' 2>/dev/null || echo 0)
[ -e "${dir}/answer-$n" ] || n=${String(answers.length - 1)}
echo $((n + 1)) > '${dir}/n'
cat "${dir}/answer-$n"
`,
    { mode: 0o755 },
  );
  const result = spawnSync(SCRIPT, [SHA, minutes], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      GITHUB_REPOSITORY: 'owner/repo',
      MEDIAPLANE_TEST_POLL_SECONDS: '0',
    },
  });
  const calls = readFileSync(join(dir, 'calls'), 'utf8').trimEnd().split('\n');
  return { code: result.status, out: result.stdout, err: result.stderr, calls };
}

const passed = { status: 'completed', conclusion: 'success' };
const failed = { status: 'completed', conclusion: 'failure' };
const running = { status: 'in_progress', conclusion: null };

describe('ci-passed.sh', () => {
  it("asks GitHub for CI's last job on the commit", () => {
    const result = run([[passed]]);
    expect(result.calls).toEqual([
      `api repos/owner/repo/commits/${SHA}/check-runs?check_name=All%20checks%20passed&app_id=15368&per_page=100 --jq [.check_runs[] | {status, conclusion}]`,
    ]);
  });

  it('passes once one run has passed, a failed one before it or not', () => {
    expect(run([[failed, passed]]).code).toBe(0);
  });

  it('waits while CI runs, then passes', () => {
    const result = run([[], [running], [running, passed]]);
    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(3);
    expect(result.out).toContain(`CI passed on ${SHA}.`);
  });

  it('fails at once when every run finished without passing', () => {
    const result = run([[failed, { status: 'completed', conclusion: 'cancelled' }]]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("didn't pass on");
    expect(result.calls).toHaveLength(1);
  });

  it('fails once its time is up, with none passed', () => {
    const result = run([[running]], '0');
    expect(result.code).toBe(1);
    expect(result.err).toContain('within 0 minutes, so nothing is published');
  });

  it('refuses what is not a commit sha, asking GitHub nothing', () => {
    // A stand-in gh first on PATH, which fails and logs: never the real one.
    const dir = mkdtempSync(join(tmpdir(), 'mp-ci-passed-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$*" >> '${dir}/calls'\nexit 1\n`, {
      mode: 0o755,
    });
    const result = spawnSync(SCRIPT, ['main'], {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, GITHUB_REPOSITORY: 'owner/repo' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"main" is not a commit sha');
    expect(existsSync(join(dir, 'calls'))).toBe(false);
  });
});
```

**Create** `scripts/release/deploy-bundle.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT } from '../root';
import { bundleFiles, writeBundle } from './deploy-bundle';
import { pinnedDeployment, pinnedInstaller } from './pin';

const IMAGE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
let dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-bundle-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('bundleFiles', () => {
  it("holds the deploy folder, with the release's image named in two of its files, and the licence", () => {
    expect(bundleFiles(read, IMAGE)).toEqual([
      { path: 'mediaplane/LICENSE', content: read('LICENSE'), mode: 0o644 },
      {
        path: 'mediaplane/deploy/README.md',
        content: read('deploy/README.md'),
        mode: 0o644,
      },
      {
        path: 'mediaplane/deploy/install.sh',
        content: pinnedInstaller(read('deploy/install.sh'), IMAGE),
        mode: 0o755,
      },
      {
        path: 'mediaplane/deploy/mediaplane',
        content: read('deploy/mediaplane'),
        mode: 0o755,
      },
      {
        path: 'mediaplane/deploy/mediaplane.compose.yaml',
        content: pinnedDeployment(read('deploy/mediaplane.compose.yaml'), IMAGE),
        mode: 0o644,
      },
    ]);
  });
});

describe('writeBundle', () => {
  it('writes mediaplane-deploy-<version>.tar.gz, and SHA256SUMS with its digest', async () => {
    const out = temp();
    const written = await writeBundle({
      root: ROOT,
      out,
      version: '0.1.0',
      image: IMAGE,
      epoch: 1_700_000_000,
    });
    const archive = join(out, 'mediaplane-deploy-0.1.0.tar.gz');
    expect(written).toEqual({
      archive,
      sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    });
    expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).toBe(
      `${written.sha256}  mediaplane-deploy-0.1.0.tar.gz\n`,
    );
    const listing = spawnSync(
      'tar',
      ['--list', '--verbose', '--numeric-owner', '--file', archive],
      {
        encoding: 'utf8',
      },
    ).stdout;
    expect(listing).toMatch(/^-rwxr-xr-x 0\/0 .* mediaplane\/deploy\/install\.sh$/m);
    expect(listing).toMatch(
      /^-rw-r--r-- 0\/0 .* mediaplane\/deploy\/mediaplane\.compose\.yaml$/m,
    );
    expect(listing).toMatch(/^drwxr-xr-x 0\/0 .* mediaplane\/$/m);
  });

  it('writes the same bytes from the same files and time', async () => {
    const a = await writeBundle({
      root: ROOT,
      out: temp(),
      version: '0.1.0',
      image: IMAGE,
      epoch: 1_700_000_000,
    });
    const b = await writeBundle({
      root: ROOT,
      out: temp(),
      version: '0.1.0',
      image: IMAGE,
      epoch: 1_700_000_000,
    });
    expect(a.sha256).toBe(b.sha256);
  });

  it("unpacks to an installer that runs, naming the release's image", async () => {
    const out = temp();
    const { archive } = await writeBundle({
      root: ROOT,
      out,
      version: '0.1.0',
      image: IMAGE,
      epoch: 0,
    });
    expect(
      spawnSync('tar', ['--extract', '--file', archive, '--directory', out]).status,
    ).toBe(0);
    const install = join(out, 'mediaplane/deploy/install.sh');
    expect(statSync(install).mode & 0o111).not.toBe(0);
    expect(spawnSync('sh', ['-n', install]).status).toBe(0);
    expect(readFileSync(install, 'utf8')).toContain(`release_image='${IMAGE}'`);
  });

  it.each([['v0.1.0'], ['0.1'], ['0.1.0; true']])(
    'refuses the version %s',
    async (version) => {
      await expect(
        writeBundle({ root: ROOT, out: temp(), version, image: IMAGE, epoch: 0 }),
      ).rejects.toThrow('the version is <major>.<minor>.<patch>');
    },
  );
});
```

**Create** `scripts/release/tested-apps.test.ts`:

```ts
import { catalog } from '@mediaplane/catalog';
import { describe, expect, it } from 'vitest';
import { testedApps } from './tested-apps';

const IMAGE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;

describe('testedApps', () => {
  const notes = testedApps(catalog, IMAGE);

  it("names Mediaplane's own image first, then every app's, as the catalog pins them", () => {
    const lines = notes.split('\n');
    expect(lines[0]).toBe('## Tested app versions');
    expect(notes).toContain(`- **Mediaplane** \`${IMAGE}\``);
    for (const def of catalog) {
      expect(notes).toContain(
        `- **${def.name}** ${def.image.tag}\n  \`${def.image.repo}@${def.image.digest}\``,
      );
    }
  });

  it('is a list, by name, never a wide table', () => {
    expect(notes).not.toContain('|');
    const names = [...notes.matchAll(/^- \*\*([^*]+)\*\* /gm)].map((m) => m[1] ?? '');
    expect(names[0]).toBe('Mediaplane');
    const apps = names.slice(1);
    expect(apps).toEqual([...apps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(apps).toHaveLength(catalog.length);
  });

  it('says what was tested, and how Plex is', () => {
    expect(notes).toContain('amd64 and arm64');
    expect(notes).toContain('Plex');
  });
});
```

**Create** `scripts/release/workflow.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import { RELEASE_JOB_PERMISSIONS } from './permissions';

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
}
const text = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
const release = parse(text) as {
  on: Record<string, unknown>;
  permissions: unknown;
  concurrency: { 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
const { jobs } = release;
const CREATED = "needs.release-please.outputs.created == 'true'";
const needs = (job: Job): string[] =>
  job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];

describe('the release workflow (spec §8.2)', () => {
  it('runs on a push to main, and never for a pull request', () => {
    expect(release.on).toEqual({ push: { branches: ['main'] } });
    expect(release.permissions).toEqual({});
    expect(release.concurrency['cancel-in-progress']).toBe(false);
  });

  it("lets release-please run in this repository only, a fork's main publishing nothing", () => {
    expect(jobs['release-please']?.if).toBe(
      "github.repository == 'cyclopsgd/Mediaplane'",
    );
    expect(jobs['release-please']?.steps[0]?.uses).toMatch(
      /^googleapis\/release-please-action@[0-9a-f]{40}$/,
    );
  });

  it('publishes only once release-please has cut a release, and only after CI passed on it', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'release-please') continue;
      expect(job.if, name).toBe(CREATED);
      expect(needs(job), name).toContain('release-please');
    }
    expect(needs(jobs.image ?? ({} as Job))).toContain('ci-passed');
    const wait = jobs['ci-passed']?.steps.find((step) =>
      step.run?.includes('ci-passed.sh'),
    );
    expect(wait?.env?.SHA).toBe('${{ needs.release-please.outputs.sha }}');
  });

  it("builds from the release's tag, never from main as it is later", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith('actions/checkout@') !== true) continue;
        expect(step.with?.ref, name).toBe('${{ needs.release-please.outputs.tag }}');
      }
    }
  });

  it('gives each job only what it needs', () => {
    expect(
      Object.fromEntries(
        Object.entries(jobs).map(([name, job]) => [name, job.permissions]),
      ),
    ).toEqual(RELEASE_JOB_PERMISSIONS);
  });

  it('keeps every secret out of the job that installs npm packages, and of the rest but two', () => {
    const secrets = (job: Job) =>
      [...JSON.stringify(job).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    expect(secrets(jobs['release-please'] ?? ({} as Job))).toEqual([
      'RELEASE_PLEASE_TOKEN',
    ]);
    expect(secrets(jobs.image ?? ({} as Job))).toEqual([
      'DOCKERHUB_USERNAME',
      'DOCKERHUB_TOKEN',
    ]);
    for (const name of ['ci-passed', 'publish', 'assets', 'upload']) {
      expect(secrets(jobs[name] ?? ({} as Job)), name).toEqual([]);
    }
  });

  it('scans each image before it pushes it, and pushes by digest, the name in lowercase', () => {
    const runs = (jobs.image?.steps ?? []).map((step) => step.run ?? '');
    const build = runs.findIndex((run) =>
      /build-image\.sh "\$\{\{ matrix\.arch \}\}" "\$RUNNER_TEMP\/image"$/.test(
        run.trim(),
      ),
    );
    const scan = runs.findIndex((run) => run.includes('scripts/ci/scan-image.sh'));
    const push = runs.findIndex((run) =>
      run.includes('--push "ghcr.io/${GITHUB_REPOSITORY,,}"'),
    );
    expect(build).toBeGreaterThanOrEqual(0);
    expect(scan).toBeGreaterThan(build);
    expect(push).toBeGreaterThan(scan);
    // GHCR takes lowercase names: the repository is cyclopsgd/Mediaplane.
    expect(text).not.toMatch(/ghcr\.io\/cyclopsgd\/Mediaplane/);
  });

  it('attests the image and the deploy files, and adds the tested app versions to the notes', () => {
    const attest = (job: string) =>
      (jobs[job]?.steps ?? []).filter((step) =>
        step.uses?.startsWith('actions/attest-build-provenance@'),
      );
    expect(attest('publish')[0]?.with).toMatchObject({ 'push-to-registry': true });
    const subjects = String(attest('upload')[0]?.with?.['subject-path'])
      .trim()
      .split('\n');
    expect(subjects.map((path) => path.replace(/^.*\//, ''))).toEqual([
      'mediaplane-deploy-*.tar.gz',
      'SHA256SUMS',
    ]);
    const runs = JSON.stringify(jobs.assets?.steps);
    expect(runs).toContain('scripts/release/deploy-bundle.ts');
    expect(runs).toContain('scripts/release/tested-apps.ts');
    const upload = JSON.stringify(jobs.upload?.steps);
    expect(upload).toContain('gh release edit');
    // A re-run replaces the section, rather than adding a second.
    expect(upload).toContain("sed -i '/^## Tested app versions$/,$d' body.md");
  });
});
```

**Change** `scripts/supply-chain.test.ts`:

```diff
diff --git a/scripts/supply-chain.test.ts b/scripts/supply-chain.test.ts
index 086de26..233301e 100644
--- a/scripts/supply-chain.test.ts
+++ b/scripts/supply-chain.test.ts
@@ -5,2 +5,3 @@ import { describe, expect, it } from 'vitest';
 import { parse } from 'yaml';
+import { RELEASE_JOB_PERMISSIONS } from './release/permissions';
 import { ROOT } from './root';
@@ -45,2 +46,3 @@ const JOB_PERMISSIONS: Record<string, Record<string, unknown>> = {
   '.github/workflows/plex.yml': {},
+  '.github/workflows/release.yml': RELEASE_JOB_PERMISSIONS,
 };
```

**Change** `test/e2e/helpers.ts`:

```diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index 6ee2839..abb8d41 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -20,5 +20,11 @@ export const REPO = fileURLToPath(new URL('../..', import.meta.url));
 
-/** Build the Mediaplane image from this checkout as `tag`. The first build takes minutes. */
-export async function buildImage(tag: string): Promise<void> {
-  const result = await nodeExec('docker', ['build', '--tag', tag, REPO], {
+/**
+ * Build the Mediaplane image from this checkout as `tag`, with `args` added to `docker
+ * build`'s (such as a label, for a second build to differ). The first build takes minutes.
+ */
+export async function buildImage(
+  tag: string,
+  args: readonly string[] = [],
+): Promise<void> {
+  const result = await nodeExec('docker', ['build', '--tag', tag, ...args, REPO], {
     cwd: '/',
```

**Create** `test/e2e/update.e2e.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec, type ExecResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { writeBundle } from '../../scripts/release/deploy-bundle';
import {
  buildImage,
  composeDown,
  docker,
  makeHome,
  publishedPort,
  removeOrIgnoreMissing,
  REPO,
  runTeardown,
  stackFor,
  TEARDOWN_MS,
} from './helpers';

/** A registry of the test's own, so that each release is pulled by digest, as from GHCR. */
const REGISTRY_IMAGE =
  'registry:3.1.2@sha256:01cd312e67026f06f5d89c3e133a4a9adc7cb9eeb9b1194e0b2954dfd770efd2';
const ID = `mediaplane-e2e-${String(process.pid)}-update`;
const STACK = ID;
const SYSTEM = `${ID}-system`;
const CONTAINER = `${ID}-mediaplane`;
const REGISTRY = `${ID}-registry`;
/** Two builds of this checkout, told apart by a label: two releases, A and B. */
const BUILDS = {
  a: `mediaplane-e2e:${String(process.pid)}-a`,
  b: `mediaplane-e2e:${String(process.pid)}-b`,
};

/**
 * What an update must leave as it is: each container of the stack (its id, image, state,
 * start time, restarts and mounts), its networks, and every file in `generated/` and
 * `state/`. The stack has no volumes of its own: every app's folders are bind mounts,
 * which each container's mounts show.
 */
interface Snapshot {
  containers: unknown[];
  networks: string[];
  files: Record<string, string>;
}

interface Inspected {
  Name: string;
  Id: string;
  Image: string;
  State: { Status: string; StartedAt: string };
  RestartCount: number;
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[];
}

/** Every file under `dir`, by its path from `home`, with its digest. */
async function digests(home: string, dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(home, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await digests(home, path));
    // The lock is taken and released by each command: it holds no state of the stack.
    else if (path !== 'state/lock') {
      files[path] = createHash('sha256')
        .update(await readFile(join(home, path)))
        .digest('hex');
    }
  }
  return files;
}

async function snapshot(home: string): Promise<Snapshot> {
  const label = `label=com.docker.compose.project=${STACK}`;
  const ids = (await docker('ps', '--all', '--quiet', '--filter', label))
    .split('\n')
    .filter(Boolean);
  const inspected =
    ids.length === 0 ? [] : (JSON.parse(await docker('inspect', ...ids)) as Inspected[]);
  const containers = inspected
    .map((c) => ({
      name: c.Name,
      id: c.Id,
      image: c.Image,
      status: c.State.Status,
      startedAt: c.State.StartedAt,
      restarts: c.RestartCount,
      mounts: c.Mounts.map(
        (m) => `${m.Type} ${m.Source} ${m.Destination} ${String(m.RW)}`,
      ).sort(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const networks = (
    await docker('network', 'ls', '--filter', label, '--format', '{{.Name}} {{.ID}}')
  ).split('\n');
  return {
    containers,
    networks: networks.sort(),
    files: { ...(await digests(home, 'generated')), ...(await digests(home, 'state')) },
  };
}

/** Now, in seconds with milliseconds, as `docker events` takes a time. */
const now = () => (Date.now() / 1000).toFixed(3);

/** The images Docker pulled between `since` and now, as `<name>@<digest>`, sorted. */
async function pulled(since: string): Promise<string[]> {
  const ids = await docker(
    'events',
    '--since',
    since,
    '--until',
    now(),
    '--filter',
    'type=image',
    '--filter',
    'event=pull',
    '--format',
    '{{.Actor.ID}}',
  );
  return [...new Set(ids.split('\n').filter(Boolean))].sort();
}

/** `name:tag@digest` as Docker names it when it pulls it: `name@digest`. */
const byDigest = (image: string) => image.replace(/:[^/:@]+@/, '@');

describe('updating Mediaplane (spec §4.4), the way deploy/README.md says', () => {
  it('pulls the next release and recreates only Mediaplane, never the stack; going back does the same', async () => {
    const home = await makeHome();
    await writeFile(
      join(home, 'stack.yaml'),
      stackFor(join(home, 'data'), { seerr: false, prowlarr: false }),
    );
    const dockerGid = String((await stat('/var/run/docker.sock')).gid);
    const bundles = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-bundles-'));
    const override = join(bundles, 'override.yaml');
    await writeFile(
      override,
      [
        'services:',
        '  mediaplane:',
        `    container_name: ${CONTAINER}`,
        '    environment:',
        `      MEDIAPLANE_COMPOSE_PROJECT: ${STACK}`,
        '',
      ].join('\n'),
    );
    // As a user deploys it: no MEDIAPLANE_IMAGE, since the release's file names its own.
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('MEDIAPLANE_')),
    );
    Object.assign(env, {
      MEDIAPLANE_HOME: home,
      MEDIAPLANE_UID: String(process.getuid?.() ?? 1000),
      MEDIAPLANE_GID: String(process.getgid?.() ?? 1000),
      DOCKER_GID: dockerGid,
    });
    const pushed: string[] = [];
    /** `docker compose pull` then `up -d`, with a release's own deploy files. */
    const system = async (
      release: string,
      args: readonly string[],
    ): Promise<ExecResult> =>
      nodeExec(
        'docker',
        [
          'compose',
          '-p',
          SYSTEM,
          '--env-file',
          '/dev/null',
          '-f',
          join(bundles, release, 'mediaplane', 'deploy', 'mediaplane.compose.yaml'),
          '-f',
          override,
          ...args,
        ],
        { env, cwd: '/', timeoutMs: 300_000 },
      );
    /** Pull, then up -d; Docker must pull only the release's image and the proxy's. */
    const deploy = async (release: string) => {
      const since = now();
      for (const args of [['pull'], ['up', '-d', '--wait']]) {
        const result = await system(release, args);
        expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0);
      }
      const file = join(
        bundles,
        release,
        'mediaplane',
        'deploy',
        'mediaplane.compose.yaml',
      );
      const services = (
        parse(await readFile(file, 'utf8')) as {
          services: Record<string, { image: string }>;
        }
      ).services;
      const proxy = services['socket-proxy']?.image ?? '';
      expect(await pulled(since)).toEqual(
        [byDigest(releases[release]?.image ?? ''), byDigest(proxy)].sort(),
      );
    };
    const mediaplane = (...args: string[]) =>
      nodeExec('docker', ['exec', CONTAINER, 'mediaplane', ...args], {
        cwd: '/',
        timeoutMs: 900_000,
      });
    const running = async () => docker('inspect', '--format', '{{.Image}}', CONTAINER);
    const releases: Record<string, { image: string; id: string }> = {};
    try {
      await docker(
        'run',
        '--detach',
        '--name',
        REGISTRY,
        '--label',
        'io.mediaplane.e2e=update',
        '--publish',
        '127.0.0.1::5000',
        REGISTRY_IMAGE,
      );
      const port = await publishedPort(REGISTRY, '5000/tcp');
      // Two releases, each pushed, and its deploy files pinned to its digest.
      for (const [name, tag] of Object.entries(BUILDS)) {
        await buildImage(tag, ['--label', `io.mediaplane.e2e.release=${name}`]);
        const remote = `127.0.0.1:${String(port)}/mediaplane-e2e:${String(process.pid)}-${name}`;
        await docker('tag', tag, remote);
        pushed.push(remote);
        await docker('push', '--quiet', remote);
        const digest =
          (
            await docker(
              'image',
              'inspect',
              '--format',
              '{{index .RepoDigests 0}}',
              remote,
            )
          ).split('@')[1] ?? '';
        const image = `${remote}@${digest}`;
        releases[name] = {
          image,
          id: await docker('image', 'inspect', '--format', '{{.Id}}', tag),
        };
        await writeBundle({
          root: REPO,
          out: join(bundles, name),
          version: name === 'a' ? '0.0.1' : '0.0.2',
          image,
          epoch: 0,
        });
        const tar = await nodeExec(
          'tar',
          [
            '--extract',
            '--file',
            join(
              bundles,
              name,
              `mediaplane-deploy-${name === 'a' ? '0.0.1' : '0.0.2'}.tar.gz`,
            ),
            '--directory',
            join(bundles, name),
          ],
          { cwd: '/' },
        );
        expect(tar.code, tar.stderr).toBe(0);
      }
      expect(releases.a?.id).not.toBe(releases.b?.id);

      // Release A, then the stack it applies.
      await deploy('a');
      expect(await running()).toBe(releases.a?.id);
      const applied = await mediaplane('apply', '--yes');
      expect(applied.code, applied.stderr).toBe(0);
      const before = await snapshot(home);
      expect(before.containers.length).toBeGreaterThan(0);
      expect(
        before.containers.every((c) => (c as { status: string }).status === 'running'),
      ).toBe(true);

      // The update: release B's deploy files, pull, up -d.
      await deploy('b');
      expect(await running()).toBe(releases.b?.id);
      expect(await snapshot(home)).toEqual(before);
      // Mediaplane B finds the stack as A left it, and pulls nothing to look.
      const looked = now();
      const planned = await mediaplane('plan');
      expect(planned.code, `${planned.stdout}${planned.stderr}`).toBe(0);
      expect(await pulled(looked)).toEqual([]);
      expect(await snapshot(home)).toEqual(before);

      // Going back to A is the same, with A's deploy files.
      await deploy('a');
      expect(await running()).toBe(releases.a?.id);
      expect(await snapshot(home)).toEqual(before);
      const again = await mediaplane('plan');
      expect(again.code, `${again.stdout}${again.stderr}`).toBe(0);
    } finally {
      await runTeardown([
        // Mediaplane's project first: it takes Mediaplane off the stack's network.
        async () => {
          const down = await nodeExec(
            'docker',
            ['compose', '-p', SYSTEM, 'down', '--remove-orphans'],
            { cwd: '/', timeoutMs: TEARDOWN_MS },
          );
          if (down.code !== 0) throw new Error(down.stderr);
        },
        async () => {
          const down = await composeDown(STACK);
          if (down.code !== 0) throw new Error(down.stderr);
        },
        () => removeOrIgnoreMissing('rm', '--force', '--volumes', REGISTRY),
        ...[...pushed, ...Object.values(BUILDS)].map(
          (image) => () => removeOrIgnoreMissing('image', 'rm', image),
        ),
        () => rm(bundles, { recursive: true, force: true }),
      ]);
    }
  }, 1_800_000);
});
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run scripts/release scripts/supply-chain.test.ts`
Expected: FAIL: `deploy-bundle.test.ts` and `tested-apps.test.ts` with `Cannot find
module`, `workflow.test.ts` with `ENOENT: … release.yml`, and each test of
`ci-passed.test.ts`, its script missing: the stand-in `gh` never runs (`ENOENT: … calls`),
and the refusal of a branch name gets no exit code (`expected null to be 1`).

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/update.e2e.test.ts`
Expected: FAIL at once: `Cannot find module '../../scripts/release/deploy-bundle'`.

- [ ] **Step 3: Write the implementation**

**Create** `.github/workflows/release.yml`:

```yaml
name: Release

# Every push to main updates release-please's release pull request, and publishes
# nothing else. Merging that pull request cuts a release (spec §8.2): release-please tags
# it and writes its GitHub release, with the changelog; then, in this same run, once CI
# has passed on that commit, Mediaplane's image goes to GHCR for amd64 and arm64, with
# its SBOM and provenance, and the release gets its deploy files and the app versions it
# was tested with.
on:
  push:
    branches: [main]

permissions: {}

# One release at a time, and never cancelled half-published.
concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release-please:
    name: Release pull request, or the release it cuts
    # This repository only: a fork's main publishes nothing.
    if: github.repository == 'cyclopsgd/Mediaplane'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: write # the tag, the release, and the release branch's commits
      issues: write # its labels on the release pull request
      pull-requests: write # the release pull request
    outputs:
      created: ${{ steps.release.outputs.release_created }}
      tag: ${{ steps.release.outputs.tag_name }}
      version: ${{ steps.release.outputs.version }}
      sha: ${{ steps.release.outputs.sha }}
    steps:
      # With the default token, GitHub starts no workflow for the pull request it opens,
      # so CI doesn't run on it until it is closed and reopened. RELEASE_PLEASE_TOKEN, a
      # token of the owner's, makes CI run on it at once.
      - id: release
        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN || github.token }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  # A release publishes only a commit whose CI passed: its last job, All checks passed.
  ci-passed:
    name: CI passed on the release's commit
    needs: release-please
    if: needs.release-please.outputs.created == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 100
    permissions:
      contents: read
      checks: read # CI's check runs on the commit
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag }}
          persist-credentials: false
      - name: Wait for All checks passed on it
        env:
          GH_TOKEN: ${{ github.token }}
          SHA: ${{ needs.release-please.outputs.sha }}
        run: scripts/release/ci-passed.sh "$SHA" 90

  image:
    name: Image (${{ matrix.arch }}), built, scanned, then pushed by digest
    needs: [release-please, ci-passed]
    if: needs.release-please.outputs.created == 'true'
    strategy:
      fail-fast: true
      matrix:
        include:
          - arch: amd64
            runner: ubuntu-24.04
          - arch: arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 30
    permissions:
      contents: read
      packages: write # push the image, by digest, with no tag yet
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag }}
          persist-credentials: false
      - uses: ./.github/actions/docker-hub-login
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          token: ${{ secrets.DOCKERHUB_TOKEN }}
      - name: Build the image
        run: scripts/ci/build-image.sh "${{ matrix.arch }}" "$RUNNER_TEMP/image"
      - name: Scan it with Trivy (fails on critical vulnerabilities that have a fix)
        run: scripts/ci/scan-image.sh "${{ matrix.arch }}" "$RUNNER_TEMP/image/oci"
      - name: Log in to GHCR
        env:
          TOKEN: ${{ github.token }}
          ACTOR: ${{ github.actor }}
        run: printf '%s' "$TOKEN" | docker login ghcr.io --username "$ACTOR" --password-stdin
      # GHCR takes lowercase names only: cyclopsgd/Mediaplane is ghcr.io/cyclopsgd/mediaplane.
      - name: Push the image scanned, by digest
        run: |
          scripts/ci/build-image.sh "${{ matrix.arch }}" "$RUNNER_TEMP/image" \
            --push "ghcr.io/${GITHUB_REPOSITORY,,}"
          mkdir -p "$RUNNER_TEMP/pushed"
          cp "$RUNNER_TEMP/image/pushed" "$RUNNER_TEMP/pushed/${{ matrix.arch }}"
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: pushed-${{ matrix.arch }}
          path: ${{ runner.temp }}/pushed/${{ matrix.arch }}
          if-no-files-found: error
          retention-days: 1

  publish:
    name: Tag the image, for both architectures, and attest it
    needs: [release-please, image]
    if: needs.release-please.outputs.created == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: read
      packages: write # the tag, and the attestation pushed beside the image
      id-token: write # sign the attestation (Sigstore)
      attestations: write # keep the attestation in the repository
    outputs:
      image: ${{ steps.tag.outputs.image }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag }}
          persist-credentials: false
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          pattern: pushed-*
          path: ${{ runner.temp }}/pushed
          merge-multiple: true
      - name: Log in to GHCR
        env:
          TOKEN: ${{ github.token }}
          ACTOR: ${{ github.actor }}
        run: printf '%s' "$TOKEN" | docker login ghcr.io --username "$ACTOR" --password-stdin
      - id: tag
        name: Tag ghcr.io/cyclopsgd/mediaplane:<version>, amd64 and arm64
        env:
          VERSION: ${{ needs.release-please.outputs.version }}
        run: |
          scripts/release/publish-image.sh "ghcr.io/${GITHUB_REPOSITORY,,}" "$VERSION" \
            "$RUNNER_TEMP/published" "$RUNNER_TEMP/pushed/amd64" "$RUNNER_TEMP/pushed/arm64"
          {
            echo "image=$(cat "$RUNNER_TEMP/published")"
            echo "digest=$(sed 's/.*@//' "$RUNNER_TEMP/published")"
            echo "name=ghcr.io/${GITHUB_REPOSITORY,,}"
          } >> "$GITHUB_OUTPUT"
      - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with:
          subject-name: ${{ steps.tag.outputs.name }}
          subject-digest: ${{ steps.tag.outputs.digest }}
          push-to-registry: true
          create-storage-record: false

  # The deploy files and the notes, made with the read-only token: this job installs the
  # npm dependencies, whose scripts run with the job's environment.
  assets:
    name: The release's deploy files and tested app versions
    needs: [release-please, publish]
    if: needs.release-please.outputs.created == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag }}
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Make them
        env:
          IMAGE: ${{ needs.publish.outputs.image }}
          VERSION: ${{ needs.release-please.outputs.version }}
        run: |
          SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
          export SOURCE_DATE_EPOCH
          pnpm exec tsx scripts/release/deploy-bundle.ts "$VERSION" "$IMAGE" "$RUNNER_TEMP/release"
          pnpm --silent exec tsx scripts/release/tested-apps.ts "$IMAGE" > "$RUNNER_TEMP/release/notes.md"
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: assets
          path: ${{ runner.temp }}/release
          if-no-files-found: error
          retention-days: 1

  upload:
    name: Attest the deploy files and add them to the release
    needs: [release-please, assets]
    if: needs.release-please.outputs.created == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: write # the release's files and notes
      id-token: write # sign the attestation (Sigstore)
      attestations: write # keep the attestation in the repository
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: assets
          path: ${{ runner.temp }}/release
      - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with:
          subject-path: |
            ${{ runner.temp }}/release/mediaplane-deploy-*.tar.gz
            ${{ runner.temp }}/release/SHA256SUMS
      - name: Add them, and the tested app versions, to the release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ needs.release-please.outputs.tag }}
        run: |
          cd "$RUNNER_TEMP/release"
          gh release upload "$TAG" mediaplane-deploy-*.tar.gz SHA256SUMS \
            --repo "$GITHUB_REPOSITORY" --clobber
          gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json body --jq .body > body.md
          # A re-run replaces the section it added before, rather than adding another.
          sed -i '/^## Tested app versions$/,$d' body.md
          printf '\n' >> body.md
          cat notes.md >> body.md
          gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --notes-file body.md
```

**Change** `scripts/ci/build-image.sh`:

```diff
diff --git a/scripts/ci/build-image.sh b/scripts/ci/build-image.sh
index b78d58e..ac4ed54 100755
--- a/scripts/ci/build-image.sh
+++ b/scripts/ci/build-image.sh
@@ -3,3 +3,3 @@
 #
-#   scripts/ci/build-image.sh <amd64|arm64> <out-dir>
+#   scripts/ci/build-image.sh <amd64|arm64> <out-dir> [--push <name>]
 #
@@ -8,2 +8,7 @@
 # OCI layout in <out-dir>/oci, for Trivy, and its manifest's digest in <out-dir>/digest.
+#
+# With --push and a name, such as ghcr.io/cyclopsgd/mediaplane, it pushes the image built
+# and scanned before in <out-dir>, by digest with no tag: it builds it again, from the
+# builder's cache, checks that the manifest it pushed is <out-dir>/digest's, and writes
+# what it pushed, an index of the image and its attestations, in <out-dir>/pushed.
 set -eu
@@ -18,5 +23,11 @@ fail() {
 }
-[ $# -eq 2 ] || fail "usage: $0 <amd64|arm64> <out-dir>"
+usage="usage: $0 <amd64|arm64> <out-dir> [--push <name>]"
+[ $# -eq 2 ] || [ $# -eq 4 ] || fail "$usage"
 arch=$1
 out=$2
+name=
+if [ $# -eq 4 ]; then
+  [ "$3" = --push ] || fail "$usage"
+  name=$4
+fi
 case $arch in
@@ -49,8 +60,23 @@ image_in() {
 
-mkdir -p "$out"
-rm -rf "$out/oci" "$out/digest"
-build "$out/oci.json" "type=oci,dest=$out/oci,tar=false,rewrite-timestamp=true"
-index=$(jq -er '.manifests[0].digest' "$out/oci/index.json")
-digest=$(image_in <"$out/oci/blobs/sha256/${index#sha256:}")
-printf '%s\n' "$digest" >"$out/digest"
-echo "Built linux/$arch: $digest"
+if [ -z "$name" ]; then
+  mkdir -p "$out"
+  rm -rf "$out/oci" "$out/digest"
+  build "$out/oci.json" "type=oci,dest=$out/oci,tar=false,rewrite-timestamp=true"
+  index=$(jq -er '.manifests[0].digest' "$out/oci/index.json")
+  digest=$(image_in <"$out/oci/blobs/sha256/${index#sha256:}")
+  printf '%s\n' "$digest" >"$out/digest"
+  echo "Built linux/$arch: $digest"
+  exit 0
+fi
+
+[ -s "$out/digest" ] || fail "nothing built in $out: build it and scan it first"
+digest=$(cat "$out/digest")
+rm -f "$out/pushed"
+build "$out/push.json" \
+  "type=image,name=$name,push-by-digest=true,name-canonical=true,push=true,rewrite-timestamp=true"
+pushed=$(jq -er '."containerimage.digest"' "$out/push.json")
+again=$(docker buildx imagetools inspect --builder "$BUILDER" --raw "$name@$pushed" | image_in)
+[ "$again" = "$digest" ] ||
+  fail "pushed linux/$arch as $again, not the image scanned, $digest: nothing is tagged"
+printf '%s\n' "$pushed" >"$out/pushed"
+echo "Pushed linux/$arch, $digest, as $name@$pushed"
```

**Create** `scripts/release/ci-passed.sh`:

```sh
#!/bin/sh
# Waits until CI's last job, "All checks passed", has passed on a commit: a release
# publishes only a commit CI passed. It fails at once when every such run finished
# without passing, and after <minutes> (90 by default) when none has passed yet.
#
#   scripts/release/ci-passed.sh <commit sha> [<minutes>]
#
# It asks GitHub with gh, as GH_TOKEN, about GITHUB_REPOSITORY, for the check run of
# GitHub Actions (app 15368) only, so that no other app's check of that name counts.
set -eu

[ $# -ge 1 ] && [ $# -le 2 ] || {
  echo "usage: $0 <commit sha> [<minutes>]" >&2
  exit 1
}
sha=$1
minutes=${2:-90}
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY names the repository}
case $sha in
  *[!0-9a-f]* | '')
    echo "error: \"$sha\" is not a commit sha" >&2
    exit 1
    ;;
esac
deadline=$(($(date +%s) + minutes * 60))
while :; do
  runs=$(gh api "repos/$repo/commits/$sha/check-runs?check_name=All%20checks%20passed&app_id=15368&per_page=100" \
    --jq '[.check_runs[] | {status, conclusion}]')
  if printf '%s' "$runs" | jq -e 'any(.[]; .status == "completed" and .conclusion == "success")' >/dev/null; then
    echo "CI passed on $sha."
    exit 0
  fi
  if printf '%s' "$runs" | jq -e 'length > 0 and all(.[]; .status == "completed")' >/dev/null; then
    echo "error: CI's \"All checks passed\" didn't pass on $sha, so nothing is published" >&2
    exit 1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "error: CI's \"All checks passed\" hasn't passed on $sha within $minutes minutes, so nothing is published" >&2
    exit 1
  fi
  echo "Waiting for CI on $sha..."
  sleep "${MEDIAPLANE_TEST_POLL_SECONDS:-60}"
done
```

**Create** `scripts/release/deploy-bundle.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ranAsScript, ROOT } from '../root';
import { pinnedDeployment, pinnedInstaller } from './pin';

/**
 * A release's deploy files (deploy/README.md): mediaplane-deploy-<version>.tar.gz, which
 * unpacks to mediaplane/deploy/, with the release's image named in install.sh and
 * mediaplane.compose.yaml, and SHA256SUMS beside it. The same files and time always make
 * the same bytes, so anyone can check a release's file against its source.
 */

export interface BundleFile {
  path: string;
  content: string;
  mode: number;
}

/** What the bundle holds, read from the repository with `read`, for `image`. */
export function bundleFiles(read: (path: string) => string, image: string): BundleFile[] {
  return [
    { path: 'mediaplane/LICENSE', content: read('LICENSE'), mode: 0o644 },
    {
      path: 'mediaplane/deploy/README.md',
      content: read('deploy/README.md'),
      mode: 0o644,
    },
    {
      path: 'mediaplane/deploy/install.sh',
      content: pinnedInstaller(read('deploy/install.sh'), image),
      mode: 0o755,
    },
    {
      path: 'mediaplane/deploy/mediaplane',
      content: read('deploy/mediaplane'),
      mode: 0o755,
    },
    {
      path: 'mediaplane/deploy/mediaplane.compose.yaml',
      content: pinnedDeployment(read('deploy/mediaplane.compose.yaml'), image),
      mode: 0o644,
    },
  ];
}

export interface BundleOptions {
  /** The repository to read the files from. */
  root: string;
  /** Where the archive and SHA256SUMS go. */
  out: string;
  version: string;
  image: string;
  /** Every file's time, in seconds: the release commit's. */
  epoch: number;
}

/** Writes the archive and SHA256SUMS into `out`: the archive's path and digest. */
export async function writeBundle(
  options: BundleOptions,
): Promise<{ archive: string; sha256: string }> {
  const { root, out, version, image, epoch } = options;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`the version is <major>.<minor>.<patch>, not "${version}"`);
  }
  // Each file bundleFiles names, read from the repository: one list, so none ships empty.
  const files = bundleFiles((path) => readFileSync(join(root, path), 'utf8'), image);
  const stage = await mkdtemp(join(tmpdir(), 'mediaplane-bundle-'));
  try {
    for (const file of files) {
      const target = join(stage, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
      await chmod(target, file.mode);
    }
    for (const dir of ['mediaplane/deploy', 'mediaplane']) {
      await chmod(join(stage, dir), 0o755);
    }
    for (const path of [...files.map((f) => f.path), 'mediaplane/deploy', 'mediaplane']) {
      await utimes(join(stage, path), epoch, epoch);
    }
    // GNU tar, in a fixed order, owner and time, then gzip without a name or a time.
    const tar = spawnSync(
      'tar',
      [
        '--create',
        '--format=gnu',
        '--sort=name',
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        `--mtime=@${String(epoch)}`,
        '--directory',
        stage,
        'mediaplane',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    if (tar.status !== 0) {
      throw new Error(`tar failed: ${tar.stderr.toString().trim()}`);
    }
    const archive = join(out, `mediaplane-deploy-${version}.tar.gz`);
    const bytes = gzipSync(tar.stdout, { level: 9 });
    await mkdir(out, { recursive: true });
    await writeFile(archive, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(
      join(out, 'SHA256SUMS'),
      `${sha256}  mediaplane-deploy-${version}.tar.gz\n`,
    );
    return { archive, sha256 };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

// pnpm exec tsx scripts/release/deploy-bundle.ts <version> <image> <out-dir>, with the
// files' time in SOURCE_DATE_EPOCH.
if (ranAsScript(import.meta.url, process.argv[1])) {
  const [version = '', image = '', out = ''] = process.argv.slice(2);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? '');
  try {
    if (out === '' || !Number.isInteger(epoch) || epoch < 0) {
      throw new Error(
        'usage: deploy-bundle.ts <version> <image> <out-dir>, with SOURCE_DATE_EPOCH set',
      );
    }
    const { archive, sha256 } = await writeBundle({
      root: ROOT,
      out,
      version,
      image,
      epoch,
    });
    console.log(`Wrote ${archive} (sha256 ${sha256})`);
  } catch (cause) {
    console.error(`error: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
```

**Create** `scripts/release/publish-image.sh`:

```sh
#!/bin/sh
# Tags a release's image: one index for every architecture, from the images that
# scripts/ci/build-image.sh pushed by digest, each of another architecture. It writes the
# image, as <name>:<version>@<digest>, to <out-file>.
#
#   scripts/release/publish-image.sh <name> <version> <out-file> <pushed-file>...
set -eu

BUILDER=mediaplane-release

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
[ $# -ge 4 ] || fail "usage: $0 <name> <version> <out-file> <pushed-file>..."
name=$1
version=$2
out=$3
shift 3
case $version in
  *[!0-9.]* | '' | .* | *. | *..*) fail "the version is <major>.<minor>.<patch>, not \"$version\"" ;;
esac
sources=
for file in "$@"; do
  sources="$sources $name@$(cat "$file")"
done
# build-image.sh's builder, where this machine has it, for its registry settings; else
# Docker's own, which pulls nothing to do it.
docker buildx inspect "$BUILDER" >/dev/null 2>&1 || BUILDER=default
# shellcheck disable=SC2086 # one argument per image, none with a space
docker buildx imagetools create --builder "$BUILDER" --tag "$name:$version" $sources
raw=$(docker buildx imagetools inspect --builder "$BUILDER" --raw "$name:$version")
# One image for each image pushed, each of another architecture.
images=$(printf '%s' "$raw" | jq -r '[.manifests[] | select(.platform.os == "linux") | .platform.architecture] | sort | join(" ")')
count=$(printf '%s' "$raw" | jq '[.manifests[] | select(.platform.os == "linux")] | length')
unique=$(printf '%s' "$raw" | jq '[.manifests[] | select(.platform.os == "linux") | .platform.architecture] | unique | length')
[ "$count" -eq $# ] && [ "$unique" -eq $# ] ||
  fail "$name:$version holds linux images for \"$images\", not one for each of the $# pushed"
digest=$(docker buildx imagetools inspect --builder "$BUILDER" "$name:$version" \
  --format '{{.Manifest.Digest}}')
case $digest in
  sha256:*) ;;
  *) fail "couldn't read the digest of $name:$version" ;;
esac
printf '%s:%s@%s\n' "$name" "$version" "$digest" >"$out"
echo "Published $name:$version@$digest, for $images"
```

**Create** `scripts/release/tested-apps.ts`:

```ts
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { ranAsScript } from '../root';

const byName = (a: AppDefinition, b: AppDefinition): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * The release notes' "tested app versions" (spec §8.2): Mediaplane's image, then each
 * app's, as the catalog pins it, one item each, so it reads on a phone too.
 */
export function testedApps(defs: readonly AppDefinition[], image: string): string {
  const apps = [...defs]
    .sort(byName)
    .flatMap((def) => [
      `- **${def.name}** ${def.image.tag}`,
      `  \`${def.image.repo}@${def.image.digest}\``,
    ]);
  return [
    '## Tested app versions',
    '',
    "This release runs these images, pinned by tag and digest. CI's end-to-end tests ran them on amd64 and arm64 for the commit this release was cut from. Plex's claim with a real plex.tv account runs in the nightly Plex test instead.",
    '',
    `- **Mediaplane** \`${image}\``,
    ...apps,
    '',
  ].join('\n');
}

// pnpm --silent exec tsx scripts/release/tested-apps.ts <Mediaplane's image>
if (ranAsScript(import.meta.url, process.argv[1])) {
  const image = process.argv[2];
  if (image === undefined || image === '') {
    console.error("usage: tested-apps.ts <Mediaplane's image>");
    process.exitCode = 1;
  } else {
    process.stdout.write(testedApps(catalog, image));
  }
}
```

Make the new scripts executable:

```bash
chmod +x scripts/release/ci-passed.sh scripts/release/publish-image.sh
```

- [ ] **Step 4: Run the tests, and see them pass**

Run: `pnpm vitest run scripts/release scripts/supply-chain.test.ts`
Expected: PASS, 72 tests. Then actionlint and shellcheck, as in Task 2: no finding.

- [ ] **Step 5: Update Mediaplane, and go back, on real Docker**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/update.e2e.test.ts`
Expected: PASS, 1 test, in about a minute and a half on the dev box once its images are
pulled: two releases built and pushed to a registry of the test's own, the stack applied
from the first, the second deployed with its deploy files, `plan` exiting 0, the first
deployed again; each time the stack's containers (their mounts too), networks and files
the same, and Docker pulling only the release's image and the proxy's (and nothing for
`plan`).
Then `docker ps -a`, `docker network ls` and `docker volume ls` show nothing named
`mediaplane-e2e-`.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2213 tests in 102 files.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml \
  scripts/ci/build-image.sh \
  scripts/release/ci-passed.sh \
  scripts/release/ci-passed.test.ts \
  scripts/release/deploy-bundle.test.ts \
  scripts/release/deploy-bundle.ts \
  scripts/release/permissions.ts \
  scripts/release/publish-image.sh \
  scripts/release/tested-apps.test.ts \
  scripts/release/tested-apps.ts \
  scripts/release/workflow.test.ts \
  scripts/supply-chain.test.ts \
  test/e2e/helpers.ts \
  test/e2e/update.e2e.test.ts
git commit -m "feat(release): a merged release pull request publishes the image for amd64 and arm64 to GHCR, scanned before it is pushed, with SBOM, provenance and attestations, once CI passed on it, and the release's pinned deploy files; an end-to-end test updates Mediaplane with them and goes back, the stack untouched" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: `mediaplane migrate`, and `stack.yaml`'s version on load

Versioned migrations, which load applies in memory with a warning and `migrate` writes
into the file, keeping it as it is but for each step's edits. No migration exists yet; a
made-up version 0 tests the machinery.

Decision: `stack.yaml` is version 1, with no migration; the machinery is real and tested with a made-up one (decision 14).
Decision: `migrate` writes as Keep mine does, under apply's lock, and with `managed_by: external` gives the file instead (decision 14; §4.2).

**Files:**
- Create: `packages/engine/src/config/migrations.test.ts`, `packages/engine/src/config/migrations.ts`, `packages/engine/src/migrate.test.ts`, `packages/engine/src/migrate.ts`, `packages/engine/src/testing/migrations.ts`
- Modify: `docs/reference/cli.md`, `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`, `packages/engine/src/config/load.ts`, `packages/engine/src/config/schema.ts`, `packages/engine/src/index.ts`, `packages/engine/src/plan/plan.ts`
- Test: `packages/cli/src/output.test.ts`, `packages/cli/src/run.test.ts`, `packages/engine/src/config/load.test.ts`, `packages/engine/src/testing/index.ts`
- Generated (`pnpm docs:generate`): `docs/reference/cli.md`, `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** Slice 8's `readStackFile`, `writeFileAtomic` (`group`, `replaces`), `acquireLock(home, now, command)`, `parseConfig`, `planStack`.
- **Produces:** in `config/migrations.ts`: `STACK_VERSION = 1`, `interface Edit { start; end; text }`,
  `interface Migration { from; summary; data(stack); text(source, doc): Edit[] }`,
  `MIGRATIONS: readonly Migration[]` (empty), `migrateData(data, migrations?, current?):
  Migrated`, `migrateSource(source, migrations?, current?): Rewritten`;
  `parseConfig(source, migrations?)`, whose ok result may carry `diagnostics` (warnings);
  in `migrate.ts`: `migrate(options: MigrateOptions): Promise<MigrateResult>`,
  `MigrateResult { ok; from?; to; changed; applied; text?; diagnostics }`; in the CLI:
  `mediaplane migrate [--home] [--json]`, `printMigrate`, `MIGRATE_JSON_SCHEMA =
  'mediaplane.migrate/v1'`; in `@mediaplane/engine/testing`: `RENAME_MEDIA`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index bec515e..30731a9 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -4,2 +4,3 @@ import type {
   DriftResult,
+  MigrateResult,
   PlanResult,
@@ -12,2 +13,3 @@ import {
   printHistory,
+  printMigrate,
   printPlan,
@@ -526 +528,81 @@ describe('the wire step, as apply shows it', () => {
 });
+
+describe('printMigrate', () => {
+  function both() {
+    const out: string[] = [];
+    const err: string[] = [];
+    const io: Io = {
+      stdout: (text) => {
+        out.push(text);
+      },
+      stderr: (text) => {
+        err.push(text);
+      },
+      env: {},
+    };
+    return { io, stdout: () => out.join(''), stderr: () => err.join('') };
+  }
+  const CHANGED: MigrateResult = {
+    ok: true,
+    from: 0,
+    to: 1,
+    changed: true,
+    applied: ['media is now media_server'],
+    diagnostics: [],
+  };
+
+  it('says what it rewrote, step by step', () => {
+    const term = both();
+    printMigrate(CHANGED, { json: false }, term.io);
+    expect(term.stdout()).toBe(
+      'Rewrote stack.yaml from version 0 to version 1, keeping its comments:\n  - media is now media_server\n',
+    );
+  });
+
+  it('says when there was nothing to do', () => {
+    const term = both();
+    printMigrate(
+      { ok: true, from: 1, to: 1, changed: false, applied: [], diagnostics: [] },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      'stack.yaml is version 1, the version this Mediaplane writes: nothing to migrate.\n',
+    );
+  });
+
+  it('gives the file as it should be when it may not write it, on stdout alone', () => {
+    const term = both();
+    printMigrate(
+      {
+        ...CHANGED,
+        ok: false,
+        changed: false,
+        text: 'version: 1\n',
+        diagnostics: [
+          {
+            severity: 'error',
+            code: 'migrate.external',
+            message: 'stack.yaml is managed outside Mediaplane',
+          },
+        ],
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe('version: 1\n');
+    expect(term.stderr()).toContain('error: stack.yaml is managed outside Mediaplane');
+    expect(term.stderr()).toContain(
+      'stack.yaml is as it was. As version 1, it reads as above, on standard output.\n',
+    );
+  });
+
+  it('prints mediaplane.migrate/v1 with --json', () => {
+    const term = both();
+    printMigrate(CHANGED, { json: true }, term.io);
+    expect(JSON.parse(term.stdout())).toEqual({
+      schema: 'mediaplane.migrate/v1',
+      ...CHANGED,
+    });
+  });
+});
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 314b1ec..0f6556f 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1956,2 +1956,26 @@ describe('mediaplane keep', () => {
 
+describe('mediaplane migrate', () => {
+  it('has nothing to do for version 1, the only version so far, and writes nothing', async () => {
+    const home = await makeHome();
+    const term = capture();
+    expect(await run(['migrate', '--home', home], term.io, deps())).toBe(0);
+    expect(term.stdout()).toBe(
+      'stack.yaml is version 1, the version this Mediaplane writes: nothing to migrate.\n',
+    );
+    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(STACK);
+  });
+
+  it('refuses a newer stack.yaml, exiting 1, in JSON too', async () => {
+    const home = await makeHome(STACK.replace('version: 1', 'version: 2'));
+    const term = capture();
+    expect(await run(['migrate', '--home', home, '--json'], term.io, deps())).toBe(1);
+    expect(JSON.parse(term.stdout())).toMatchObject({
+      schema: 'mediaplane.migrate/v1',
+      ok: false,
+      changed: false,
+      diagnostics: [{ code: 'config.newer-version' }],
+    });
+  });
+});
+
 describe('mediaplane status', () => {
```

**Change** `packages/engine/src/config/load.test.ts`:

```diff
diff --git a/packages/engine/src/config/load.test.ts b/packages/engine/src/config/load.test.ts
index 6a9b8ec..b6092b0 100644
--- a/packages/engine/src/config/load.test.ts
+++ b/packages/engine/src/config/load.test.ts
@@ -5,2 +5,3 @@ import type { Diagnostic } from '../diagnostics';
 import { loadConfigFile, parseConfig } from './load';
+import { RENAME_MEDIA } from '../testing/migrations';
 import { tempDir } from '../testing/temp';
@@ -369,2 +370,46 @@ describe('parseConfig', () => {
 
+describe('parseConfig: versions (spec §5 step 2)', () => {
+  it('refuses a stack.yaml newer than this Mediaplane, saying so', () => {
+    expect(diagnosticsOf(MINIMAL.replace('version: 1', 'version: 2'))).toEqual([
+      {
+        severity: 'error',
+        code: 'config.newer-version',
+        message:
+          'stack.yaml is version 2, newer than this Mediaplane reads (1): it was written for a later Mediaplane',
+        path: 'version',
+        hint: 'update Mediaplane to a release that reads it, or go back to the stack.yaml this one wrote',
+      },
+    ]);
+  });
+
+  it('refuses a version no Mediaplane wrote', () => {
+    expect(diagnosticsOf(MINIMAL.replace('version: 1', 'version: 0'))).toMatchObject([
+      { code: 'config.unknown-version', path: 'version' },
+    ]);
+  });
+
+  it('reads an older version in memory, with a warning, and leaves the file to migrate', () => {
+    const old =
+      'version: 0\npaths: { data: /srv/data }\nmedia: plex\nplex: { token: { file: secrets/plex-token } }\n';
+    const result = parseConfig(old, [RENAME_MEDIA]);
+    expect(result).toMatchObject({
+      ok: true,
+      config: { version: 1, media_server: 'plex' },
+      diagnostics: [
+        {
+          severity: 'warning',
+          code: 'config.old-version',
+          message:
+            'stack.yaml is version 0: Mediaplane reads it as version 1 (media is now media_server), and leaves the file as it is',
+          hint: 'run mediaplane migrate to rewrite it, keeping its comments',
+        },
+      ],
+    });
+  });
+
+  it('gives no warning for the current version', () => {
+    expect(parseConfig(MINIMAL)).not.toHaveProperty('diagnostics');
+  });
+});
+
 describe('loadConfigFile', () => {
```

**Create** `packages/engine/src/config/migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RENAME_MEDIA } from '../testing/migrations';
import {
  MIGRATIONS,
  migrateData,
  migrateSource,
  STACK_VERSION,
  type Migration,
} from './migrations';

/** A version 0 file, as someone wrote it: comments lined up, a blank line, CRLF. */
const OLD = [
  '# My media stack.',
  'version: 0          # the format',
  'paths: { data: /srv/data }',
  'media: jellyfin     # or plex',
  '',
  'apps:',
  '  sonarr: {}',
  '',
].join('\r\n');

describe('the stack.yaml versions Mediaplane has', () => {
  it('is version 1, the only one so far: no migration exists yet', () => {
    expect(STACK_VERSION).toBe(1);
    expect(MIGRATIONS).toEqual([]);
  });
});

describe('migrateData', () => {
  it('leaves the current version as it is', () => {
    expect(migrateData({ version: 1, a: 1 })).toEqual({
      ok: true,
      data: { version: 1, a: 1 },
      from: 1,
      applied: [],
    });
  });

  it('migrates an older version in memory, one step after another', () => {
    expect(migrateData({ version: 0, media: 'plex' }, [RENAME_MEDIA], 1)).toEqual({
      ok: true,
      data: { version: 1, media_server: 'plex' },
      from: 0,
      applied: ['media is now media_server'],
    });
  });

  it('refuses a version newer than this Mediaplane reads', () => {
    expect(migrateData({ version: 2 })).toEqual({
      ok: false,
      code: 'config.newer-version',
      message:
        'stack.yaml is version 2, newer than this Mediaplane reads (1): it was written for a later Mediaplane',
    });
  });

  it('refuses an older version it has no migration for', () => {
    expect(migrateData({ version: 0 })).toMatchObject({
      ok: false,
      code: 'config.unknown-version',
    });
  });

  it('leaves a version that is not a whole number to the schema to refuse', () => {
    expect(migrateData({ version: '1' })).toMatchObject({ ok: true, applied: [] });
  });
});

describe('migrateSource', () => {
  it('rewrites only what the migration changes, and the version', () => {
    const migrated = migrateSource(OLD, [RENAME_MEDIA], 1);
    expect(migrated).toEqual({
      ok: true,
      from: 0,
      to: 1,
      applied: ['media is now media_server'],
      text: [
        '# My media stack.',
        'version: 1          # the format',
        'paths: { data: /srv/data }',
        'media_server: jellyfin     # or plex',
        '',
        'apps:',
        '  sonarr: {}',
        '',
      ].join('\r\n'),
    });
  });

  it('changes nothing in a file at the current version', () => {
    const current = OLD.replace('version: 0', 'version: 1');
    expect(migrateSource(current, [RENAME_MEDIA], 1)).toEqual({
      ok: true,
      from: 1,
      to: 1,
      applied: [],
      text: current,
    });
  });

  it('refuses a rewrite that would not read as the migration says', () => {
    const wrong: Migration = { ...RENAME_MEDIA, text: () => [] };
    expect(migrateSource(OLD, [wrong], 1)).toEqual({
      ok: false,
      reason:
        "migrating it from version 0 (media is now media_server) would change more than the migration does, or less, so Mediaplane can't rewrite it",
    });
  });

  it('refuses edits that overlap the version', () => {
    const overlapping: Migration = {
      ...RENAME_MEDIA,
      text: (source) => [{ start: 0, end: source.length, text: 'version: 1\n' }],
    };
    expect(migrateSource(OLD, [overlapping], 1).ok).toBe(false);
  });

  it.each([
    ['not YAML', 'version: [0\n', 'it is not valid YAML'],
    ['no version', 'paths: {}\n', 'it has no version: line of its own'],
    [
      'a flow file',
      '{ version: 0, media: plex }\n',
      'not a YAML block of keys, one per line',
    ],
    ['a newer one', 'version: 2\n', 'newer than this Mediaplane reads'],
  ])('refuses %s', (_what, source, said) => {
    const migrated = migrateSource(source, [RENAME_MEDIA], 1);
    expect(migrated.ok).toBe(false);
    expect(migrated.ok ? '' : migrated.reason).toContain(said);
  });
});
```

**Create** `packages/engine/src/migrate.test.ts`:

```ts
import { chmod, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { LOCK_PATH } from './paths';
import { acquireLock } from './state/lock';
import { RENAME_MEDIA } from './testing/migrations';
import { tempDir } from './testing/temp';

/** A version 0 stack.yaml, as someone wrote it by hand: comments lined up, a blank line. */
const OLD = `# My media stack.
version: 0          # the format
paths: { data: /srv/data }
media: jellyfin     # or plex

apps:
  sonarr: {}
`;
const MIGRATED = OLD.replace('version: 0', 'version: 1').replace(
  'media: jellyfin',
  'media_server: jellyfin',
);
const AT = new Date('2026-10-25T08:00:00.000Z');

async function home(stack: string, mode = 0o640): Promise<string> {
  const dir = await tempDir('mediaplane-migrate-');
  await writeFile(join(dir, 'stack.yaml'), stack);
  await chmod(join(dir, 'stack.yaml'), mode);
  return dir;
}
const run = (dir: string, migrations = [RENAME_MEDIA]) =>
  migrate({ home: dir, migrations, now: () => AT });

describe('migrate (spec §5.2)', () => {
  it('rewrites an older stack.yaml to the current version, keeping all else, mode too', async () => {
    const dir = await home(OLD);
    expect(await run(dir)).toEqual({
      ok: true,
      from: 0,
      to: 1,
      changed: true,
      applied: ['media is now media_server'],
      diagnostics: [],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(MIGRATED);
    expect((await stat(join(dir, 'stack.yaml'))).mode & 0o777).toBe(0o640);
  });

  it('has nothing to do for the current version, and writes nothing', async () => {
    const dir = await home(MIGRATED);
    const before = await stat(join(dir, 'stack.yaml'));
    expect(await run(dir)).toEqual({
      ok: true,
      from: 1,
      to: 1,
      changed: false,
      applied: [],
      diagnostics: [],
    });
    expect((await stat(join(dir, 'stack.yaml'))).mtimeMs).toBe(before.mtimeMs);
  });

  it('has nothing to do with the migrations Mediaplane has: none yet', async () => {
    const dir = await home(MIGRATED);
    expect(await migrate({ home: dir })).toMatchObject({ ok: true, changed: false });
  });

  it('writes nothing with managed_by: external, and gives the file as it should be', async () => {
    const external = `${OLD}managed_by: external\n`;
    const dir = await home(external);
    const result = await run(dir);
    expect(result).toMatchObject({
      ok: false,
      from: 0,
      to: 1,
      changed: false,
      text: `${MIGRATED}managed_by: external\n`,
      diagnostics: [{ code: 'migrate.external' }],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(external);
  });

  it('refuses a stack.yaml it would replace a link with, giving the file as it should be', async () => {
    const dir = await home(OLD);
    await writeFile(join(dir, 'real.yaml'), OLD);
    const linked = await tempDir('mediaplane-migrate-link-');
    await symlink(join(dir, 'real.yaml'), join(linked, 'stack.yaml'));
    const result = await run(linked);
    expect(result).toMatchObject({
      ok: false,
      changed: false,
      text: MIGRATED,
      diagnostics: [{ code: 'migrate.stack-file' }],
    });
    expect(await readFile(join(dir, 'real.yaml'), 'utf8')).toBe(OLD);
  });

  it('refuses a stack.yaml newer than this Mediaplane', async () => {
    const dir = await home(MIGRATED.replace('version: 1', 'version: 2'));
    expect(await run(dir)).toMatchObject({
      ok: false,
      changed: false,
      diagnostics: [{ code: 'config.newer-version' }],
    });
  });

  it("refuses a rewrite that wouldn't be a valid stack.yaml, writing nothing", async () => {
    const dir = await home(OLD.replace('media: jellyfin', 'media: nonsense'));
    const result = await run(dir);
    expect(result).toMatchObject({ ok: false, changed: false });
    expect(result.diagnostics[0]?.code).toBe('config.invalid');
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toContain('version: 0');
  });

  it("refuses a file it can't rewrite line by line, such as one written as { … }", async () => {
    const dir = await home(
      '{ version: 0, paths: { data: /srv/data }, media: jellyfin }\n',
    );
    expect(await run(dir)).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'migrate.rewrite',
          message:
            "Mediaplane can't rewrite stack.yaml: its top level is not a YAML block of keys, one per line",
        },
      ],
    });
  });

  it.runIf(process.getuid?.() !== 0)(
    "says when it can't write the file, and gives the file as it should be",
    async () => {
      const dir = await home(OLD);
      await (await acquireLock(dir, () => AT, 'keep')).release();
      await chmod(dir, 0o555);
      try {
        expect(await run(dir)).toMatchObject({
          ok: false,
          text: MIGRATED,
          diagnostics: [{ code: 'migrate.stack-file' }],
        });
      } finally {
        await chmod(dir, 0o755);
      }
      expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(OLD);
    },
  );

  it('waits for nothing: another command holding the lock stops it', async () => {
    const dir = await home(OLD);
    const lock = await acquireLock(dir, () => AT, 'keep');
    try {
      expect(await run(dir)).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'migrate.locked' }],
      });
    } finally {
      await lock.release();
    }
    await expect(stat(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it("says there is no stack.yaml, and makes no state/ in a folder that isn't a home", async () => {
    const dir = await tempDir('mediaplane-migrate-none-');
    expect(await run(dir)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'config.missing' }],
    });
    await expect(stat(join(dir, 'state'))).rejects.toThrow();
  });
});
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 246ad10..202b3f3 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -7,2 +7,3 @@ export * from './http';
 export * from './jellyfin';
+export * from './migrations';
 export * from './plex';
```

**Create** `packages/engine/src/testing/migrations.ts`:

```ts
import { isMap, isScalar } from 'yaml';
import type { Migration } from '../config/migrations';

/**
 * A made-up migration, for the tests only: no stack.yaml was ever version 0. Version 0
 * called the media server `media`; version 1 calls it `media_server`.
 */
export const RENAME_MEDIA: Migration = {
  from: 0,
  summary: 'media is now media_server',
  data: ({ media, ...rest }) =>
    media === undefined ? rest : { ...rest, media_server: media },
  text: (_source, doc) => {
    const root = doc.contents;
    if (!isMap(root)) return [];
    const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'media');
    if (pair === undefined || !isScalar(pair.key)) return [];
    const [start, end] = pair.key.range;
    return [{ start, end, text: 'media_server' }];
  },
};
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/config packages/engine/src/migrate.test.ts packages/cli/src/output.test.ts packages/cli/src/run.test.ts`
Expected: FAIL, 9 tests and 2 files: `migrations.test.ts` and `migrate.test.ts` with
`Cannot find module`; three of `load.test.ts`'s version tests (a newer version is the
schema's error, and the migration is ignored: `expected { ok: false, … } to match object
{ ok: true, … }`); `output.test.ts`'s four `printMigrate` tests, `printMigrate` not being
there yet; `run.test.ts`'s two `migrate` tests, the command unknown (`expected 1 to be
+0`).

- [ ] **Step 3: Write the implementation**

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 77b1d4e..29151cd 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -14,2 +14,3 @@ import {
   type KeepResult,
+  type MigrateResult,
   type PlanResult,
@@ -29,2 +30,3 @@ export const DRIFT_JSON_SCHEMA = 'mediaplane.drift/v1';
 export const KEEP_JSON_SCHEMA = 'mediaplane.keep/v1';
+export const MIGRATE_JSON_SCHEMA = 'mediaplane.migrate/v1';
 
@@ -306,2 +308,34 @@ export function printKeep(result: KeepResult, options: { json: boolean }, io: Io
 
+/** What `mediaplane migrate` rewrote, or why it didn't, with the file as it should be. */
+export function printMigrate(
+  result: MigrateResult,
+  options: { json: boolean },
+  io: Io,
+): void {
+  if (options.json) {
+    io.stdout(`${JSON.stringify({ schema: MIGRATE_JSON_SCHEMA, ...result }, null, 2)}\n`);
+    return;
+  }
+  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
+  if (!result.ok) {
+    // The file alone on stdout, so that it can be saved as it is.
+    if (result.text !== undefined) io.stdout(result.text);
+    io.stderr(
+      result.text === undefined
+        ? '\nstack.yaml is as it was.\n'
+        : `\nstack.yaml is as it was. As version ${String(result.to)}, it reads as above, on standard output.\n`,
+    );
+    return;
+  }
+  if (!result.changed) {
+    io.stdout(
+      `stack.yaml is version ${String(result.to)}, the version this Mediaplane writes: nothing to migrate.\n`,
+    );
+    return;
+  }
+  io.stdout(
+    `Rewrote stack.yaml from version ${String(result.from)} to version ${String(result.to)}, keeping its comments:\n${result.applied.map((step) => `  - ${step}\n`).join('')}`,
+  );
+}
+
 function count(n: number, noun: string, verb: string): string | undefined {
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 18ae496..d569d49 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -21,2 +21,3 @@ import {
   listRecords,
+  migrate,
   nodeProbe,
@@ -48,2 +49,3 @@ import {
   printKeep,
+  printMigrate,
   printPlan,
@@ -119,2 +121,7 @@ export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
   ],
+  migrate: [
+    '0: stack.yaml is now the version this Mediaplane writes, or already was',
+    '1: nothing was rewritten: a newer or unknown version, or an error',
+    '1: a file Mediaplane may not write, such as one with managed_by: external',
+  ],
   history: ['0: the records were listed or shown', '1: an error, or no such record'],
@@ -393,2 +400,16 @@ export function createProgram(
 
+  program
+    .command('migrate')
+    .description(
+      'Rewrite stack.yaml to the version of its format this Mediaplane writes, keeping its comments and formatting; with managed_by: external, print the file as it should be instead. stack.yaml has only ever been version 1, so there is nothing to migrate yet',
+    )
+    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
+    .option('--json', 'print machine-readable JSON')
+    .addHelpText('after', exitCodesHelp('migrate'))
+    .action(async (options: { home: string; json?: boolean }) => {
+      const result = await migrate({ home: resolve(options.home) });
+      printMigrate(result, { json: options.json === true }, io);
+      setExitCode(result.ok ? 0 : 1);
+    });
+
   program
```

**Change** `packages/engine/src/config/load.ts`:

```diff
diff --git a/packages/engine/src/config/load.ts b/packages/engine/src/config/load.ts
index 45cfc73..d99afea 100644
--- a/packages/engine/src/config/load.ts
+++ b/packages/engine/src/config/load.ts
@@ -2,5 +2,6 @@ import { parseDocument } from 'yaml';
 import type { ZodError } from 'zod';
-import { error, withHint, type Diagnostic } from '../diagnostics';
+import { error, warning, withHint, type Diagnostic } from '../diagnostics';
 import { didYouMean } from '../util/did-you-mean';
 import { readIfExists } from '../util/fs';
+import { MIGRATIONS, migrateData, STACK_VERSION, type Migration } from './migrations';
 import { STACK_KEYS, stackConfigSchema, type StackConfig } from './schema';
@@ -8,3 +9,15 @@ import { STACK_KEYS, stackConfigSchema, type StackConfig } from './schema';
 export type LoadResult =
-  { ok: true; config: StackConfig } | { ok: false; diagnostics: Diagnostic[] };
+  | {
+      ok: true;
+      config: StackConfig;
+      /** Warnings, when there are some: an older version, read in memory. */
+      diagnostics?: Diagnostic[];
+    }
+  | { ok: false; diagnostics: Diagnostic[] };
+
+const VERSION_HINTS = {
+  'config.newer-version':
+    'update Mediaplane to a release that reads it, or go back to the stack.yaml this one wrote',
+  'config.unknown-version': `set version: ${String(STACK_VERSION)}, the version this Mediaplane writes, if the rest of the file is in its format`,
+} as const;
 
@@ -27,3 +40,10 @@ export async function loadConfigFile(path: string): Promise<LoadResult> {
 
-export function parseConfig(source: string): LoadResult {
+/**
+ * `source`, a stack.yaml, validated. An older version is migrated in memory, with a
+ * warning: only `mediaplane migrate` rewrites the file (spec §5 step 2).
+ */
+export function parseConfig(
+  source: string,
+  migrations: readonly Migration[] = MIGRATIONS,
+): LoadResult {
   const doc = parseDocument(source, { prettyErrors: true });
@@ -45,4 +65,35 @@ export function parseConfig(source: string): LoadResult {
   }
+  const warnings: Diagnostic[] = [];
+  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
+    const migrated = migrateData(data as Record<string, unknown>, migrations);
+    if (!migrated.ok) {
+      return {
+        ok: false,
+        diagnostics: [
+          error(migrated.code, migrated.message, {
+            path: 'version',
+            hint: VERSION_HINTS[migrated.code],
+          }),
+        ],
+      };
+    }
+    if (migrated.applied.length > 0) {
+      warnings.push(
+        warning(
+          'config.old-version',
+          `stack.yaml is version ${String(migrated.from)}: Mediaplane reads it as version ${String(STACK_VERSION)} (${migrated.applied.join('; ')}), and leaves the file as it is`,
+          { hint: 'run mediaplane migrate to rewrite it, keeping its comments' },
+        ),
+      );
+    }
+    data = migrated.data;
+  }
   const result = stackConfigSchema.safeParse(data);
-  if (result.success) return { ok: true, config: result.data };
+  if (result.success) {
+    return {
+      ok: true,
+      config: result.data,
+      ...(warnings.length === 0 ? {} : { diagnostics: warnings }),
+    };
+  }
   return { ok: false, diagnostics: result.error.issues.flatMap(toDiagnostics) };
```

**Create** `packages/engine/src/config/migrations.ts`:

```ts
import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, parseDocument, type Document } from 'yaml';

/**
 * The version of stack.yaml this Mediaplane reads and writes (spec §4.2). Load reads an
 * older one through the migrations below, in memory, with a warning; only
 * `mediaplane migrate` rewrites the file (spec §5 step 2).
 */
export const STACK_VERSION = 1;

/** One replacement of the text between two offsets. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** One step from a version of stack.yaml to the next. */
export interface Migration {
  /** The version it reads; it makes the next. */
  from: number;
  /** What it changes, in a few words: migrate's output, and load's warning. */
  summary: string;
  /** The change on the file as data, which is what Mediaplane reads in memory. */
  data(stack: Readonly<Record<string, unknown>>): Record<string, unknown>;
  /**
   * The same change as edits of the text, leaving everything else as it is: comments,
   * order, quoting, spacing and line ends (spec §3.3). The version is changed for it.
   */
  text(source: string, doc: Document.Parsed): Edit[];
}

/**
 * Every migration, in order. None yet: stack.yaml has only ever been version 1, so
 * `migrate` has nothing to do. The machinery is tested with a made-up one
 * (testing/migrations.ts).
 */
export const MIGRATIONS: readonly Migration[] = [];

export type Migrated =
  | { ok: true; data: Record<string, unknown>; from: number; applied: string[] }
  | {
      ok: false;
      code: 'config.newer-version' | 'config.unknown-version';
      message: string;
    };

/** The steps from `from` to `current`, or the first version none starts from. */
function steps(
  from: number,
  migrations: readonly Migration[],
  current: number,
): Migration[] | number {
  const path: Migration[] = [];
  for (let version = from; version < current; version++) {
    const step = migrations.find((m) => m.from === version);
    if (step === undefined) return version;
    path.push(step);
  }
  return path;
}

const newer = (version: number, current: number) =>
  `stack.yaml is version ${String(version)}, newer than this Mediaplane reads (${String(current)}): it was written for a later Mediaplane`;
const unknown = (version: number, current: number) =>
  `stack.yaml is version ${String(version)}, which no Mediaplane wrote: this one reads version ${String(current)}`;

/**
 * `data`, a parsed stack.yaml, as this Mediaplane reads it: an older version is migrated
 * one step after another. A version that isn't a whole number is left for the schema to
 * refuse.
 */
export function migrateData(
  data: Readonly<Record<string, unknown>>,
  migrations: readonly Migration[] = MIGRATIONS,
  current: number = STACK_VERSION,
): Migrated {
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: true, data: { ...data }, from: current, applied: [] };
  }
  if (version > current) {
    return { ok: false, code: 'config.newer-version', message: newer(version, current) };
  }
  const path = steps(version, migrations, current);
  if (typeof path === 'number') {
    return { ok: false, code: 'config.unknown-version', message: unknown(path, current) };
  }
  let migrated: Record<string, unknown> = { ...data };
  for (const step of path) {
    migrated = { ...step.data(migrated), version: step.from + 1 };
  }
  return { ok: true, data: migrated, from: version, applied: path.map((s) => s.summary) };
}

/** `edits` applied to `source`, or undefined if two overlap. */
function applyEdits(source: string, edits: readonly Edit[]): string | undefined {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let text = source;
  let limit = source.length;
  for (const edit of sorted) {
    if (edit.end > limit || edit.start > edit.end) return undefined;
    text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
    limit = edit.start;
  }
  return text;
}

export type Rewritten =
  | { ok: true; text: string; from: number; to: number; applied: string[] }
  | { ok: false; reason: string };

/**
 * `source`, a stack.yaml, rewritten to the current version, with nothing else changed.
 * Each step's edits, and its version, are checked: the text must then read as the step
 * says the data changes, or nothing is rewritten.
 */
export function migrateSource(
  source: string,
  migrations: readonly Migration[] = MIGRATIONS,
  current: number = STACK_VERSION,
): Rewritten {
  let text = source;
  let from: number | undefined;
  const applied: string[] = [];
  for (;;) {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return { ok: false, reason: 'it is not valid YAML' };
    const root = doc.contents;
    if (!isMap(root) || root.flow === true) {
      return {
        ok: false,
        reason: 'its top level is not a YAML block of keys, one per line',
      };
    }
    const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'version');
    const value = pair?.value;
    if (!isScalar(value) || typeof value.value !== 'number') {
      return { ok: false, reason: 'it has no version: line of its own' };
    }
    const version = value.value;
    from ??= version;
    if (version > current) return { ok: false, reason: newer(version, current) };
    if (version === current) return { ok: true, text, from, to: current, applied };
    const step = steps(version, migrations, current);
    if (typeof step === 'number' || step[0] === undefined) {
      return { ok: false, reason: unknown(version, current) };
    }
    const [next] = step;
    const [start, end] = value.range;
    const edited = applyEdits(text, [
      ...next.text(text, doc),
      { start, end, text: String(next.from + 1) },
    ]);
    const wanted = {
      ...next.data(doc.toJS() as Record<string, unknown>),
      version: next.from + 1,
    };
    const after = edited === undefined ? undefined : parseDocument(edited);
    if (
      edited === undefined ||
      after === undefined ||
      after.errors.length > 0 ||
      !isDeepStrictEqual(after.toJS(), wanted)
    ) {
      return {
        ok: false,
        reason: `migrating it from version ${String(version)} (${next.summary}) would change more than the migration does, or less, so Mediaplane can't rewrite it`,
      };
    }
    text = edited;
    applied.push(next.summary);
  }
}
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index 7bab44e..124e6ef 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -3,2 +3,3 @@ import { z } from 'zod';
 import { isPrivateSubnet } from '../host/facts';
+import { STACK_VERSION } from './migrations';
 import { compare } from '../util/sort';
@@ -139,3 +140,7 @@ export type AppSettings = z.infer<typeof appSettingsSchema>;
 const stackShape = {
-  version: z.literal(1).describe("The version of this file's format. Always 1."),
+  version: z
+    .literal(STACK_VERSION)
+    .describe(
+      "The version of this file's format: 1, the only one so far. When a later Mediaplane changes the format, it reads an older file as it is, and mediaplane migrate rewrites it.",
+    ),
   timezone: z
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 75091a4..c4f895f 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -10,2 +10,3 @@ export * from './config/json-schema';
 export * from './config/load';
+export * from './config/migrations';
 export * from './config/secrets';
@@ -54,2 +55,3 @@ export * from './drift';
 export * from './keep';
+export * from './migrate';
 export * from './config/overrides-file';
```

**Create** `packages/engine/src/migrate.ts`:

```ts
import { join, resolve } from 'node:path';
import { parseConfig } from './config/load';
import {
  MIGRATIONS,
  migrateSource,
  STACK_VERSION,
  type Migration,
} from './config/migrations';
import { readStackFile } from './config/overrides-file';
import { error, type Diagnostic } from './diagnostics';
import { STACK_PATH } from './paths';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { writeFileAtomic } from './util/atomic';
import { readIfExists } from './util/fs';

export interface MigrateOptions {
  home: string;
  now?: () => Date;
  /** For tests: the migrations to run instead of Mediaplane's own. */
  migrations?: readonly Migration[];
}

/** What `mediaplane migrate` did (spec §5.2). */
export interface MigrateResult {
  ok: boolean;
  /** The version stack.yaml was, when it could be read. */
  from?: number;
  /** The version this Mediaplane writes. */
  to: number;
  /** Whether stack.yaml was rewritten. */
  changed: boolean;
  /** What each step changed, in order. */
  applied: string[];
  /**
   * The file as it should be, when Mediaplane may not write it: one managed by
   * automation, or one it can't replace safely. stack.yaml holds no secret (ADR 0009).
   */
  text?: string;
  diagnostics: Diagnostic[];
}

/**
 * `mediaplane migrate`: rewrites stack.yaml to the version this Mediaplane writes,
 * keeping its comments and formatting (spec §3.3, §5.2), as Keep mine writes it: read
 * once through one handle, rewritten only where each step says, checked to read as the
 * step says, and written atomically in place of the file read, with its mode and group.
 * It runs under apply's lock. With `managed_by: external`, it writes nothing and gives
 * the file as it should be (spec §4.2).
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  const migrations = options.migrations ?? MIGRATIONS;
  const stackPath = join(home, STACK_PATH);
  const refused = (
    diagnostics: Diagnostic[],
    extra: Partial<MigrateResult> = {},
  ): MigrateResult => ({
    ok: false,
    to: STACK_VERSION,
    changed: false,
    applied: [],
    diagnostics,
    ...extra,
  });
  // Never create state/ in a folder that isn't a Mediaplane home.
  if ((await readIfExists(stackPath)) === undefined) {
    return refused([
      error('config.missing', `no stack.yaml at ${stackPath}`, {
        hint: 'run mediaplane init to write one, or pass --home with the Mediaplane home',
      }),
    ]);
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, now, 'migrate');
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return refused([
      error('migrate.locked', cause.message, {
        hint: 'wait for it to finish, then run migrate again; if nothing is running, delete state/lock',
      }),
    ]);
  }
  try {
    const read = await readStackFile(stackPath);
    // A file it won't write is still read, to give the file as it should be.
    const text = read.ok ? read.file.text : ((await readIfExists(stackPath)) ?? '');
    // Read as plan reads it: an older version migrated in memory, or why not.
    const before = parseConfig(text, migrations);
    if (!before.ok) return refused(before.diagnostics);
    const migrated = migrateSource(text, migrations);
    if (!migrated.ok) {
      return refused([
        error(
          'migrate.rewrite',
          `Mediaplane can't rewrite stack.yaml: ${migrated.reason}`,
          {
            hint: 'rewrite it yourself, as the stack.yaml reference describes the current version',
          },
        ),
      ]);
    }
    const { from, applied } = migrated;
    if (applied.length === 0) {
      return {
        ok: true,
        from,
        to: STACK_VERSION,
        changed: false,
        applied,
        diagnostics: [],
      };
    }
    const byHand =
      'rewrite stack.yaml yourself as migrate gives it (with --json, as its text)';
    const notWritten = (code: string, message: string, hint = byHand) =>
      refused([error(code, message, { hint })], { from, applied, text: migrated.text });
    if (before.config.managed_by === 'external') {
      return notWritten(
        'migrate.external',
        "stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane doesn't write it",
        `${byHand}, where it is kept, such as your playbook`,
      );
    }
    if (!read.ok) {
      return notWritten(
        'migrate.stack-file',
        `Mediaplane won't write stack.yaml: ${read.reason}`,
      );
    }
    try {
      await writeFileAtomic(stackPath, migrated.text, read.file.mode, {
        group: read.file.gid,
        replaces: { dev: read.file.dev, ino: read.file.ino },
      });
    } catch (cause) {
      return notWritten(
        'migrate.stack-file',
        `Mediaplane couldn't write stack.yaml: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return { ok: true, from, to: STACK_VERSION, changed: true, applied, diagnostics: [] };
  } finally {
    await lock.release();
  }
}
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 68c9b3c..ad77dc0 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -139,3 +139,7 @@ export async function planStack(
 
-  const diagnostics = await checkSecretRefs(loaded.config, home, options.env);
+  // An older stack.yaml's warning first: the plan reads it migrated, in memory.
+  const diagnostics = [
+    ...(loaded.diagnostics ?? []),
+    ...(await checkSecretRefs(loaded.config, home, options.env)),
+  ];
   diagnostics.push(...dockerAccessWarnings(options.env));
```

- [ ] **Step 4: Regenerate the docs**

Run: `pnpm docs:generate`

Expected: `wrote docs/reference/cli.md`, `wrote docs/reference/stack-yaml.md`, `wrote docs/reference/stack.schema.json`, and nothing else.

- [ ] **Step 5: Run the tests, and see them pass**

Run: `pnpm vitest run packages/engine/src/config packages/engine/src/migrate.test.ts packages/cli/src/output.test.ts packages/cli/src/run.test.ts`
Expected: PASS. Then `pnpm test:coverage`: the thresholds hold.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2248 tests in 104 files.

- [ ] **Step 7: Commit**

```bash
git add docs/reference/cli.md \
  docs/reference/stack-yaml.md \
  docs/reference/stack.schema.json \
  packages/cli/src/output.test.ts \
  packages/cli/src/output.ts \
  packages/cli/src/run.test.ts \
  packages/cli/src/run.ts \
  packages/engine/src/config/load.test.ts \
  packages/engine/src/config/load.ts \
  packages/engine/src/config/migrations.test.ts \
  packages/engine/src/config/migrations.ts \
  packages/engine/src/config/schema.ts \
  packages/engine/src/index.ts \
  packages/engine/src/migrate.test.ts \
  packages/engine/src/migrate.ts \
  packages/engine/src/plan/plan.ts \
  packages/engine/src/testing/index.ts \
  packages/engine/src/testing/migrations.ts
git commit -m "feat: mediaplane migrate rewrites stack.yaml to the current version, keeping comments and formatting; an older version is read in memory with a warning, and a newer one refused" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: FlareSolverr's folder, and the wiring network's settings

FlareSolverr's image declares a volume that nothing uses; a folder of its own takes its
place, so no FlareSolverr container leaves an anonymous volume. The wiring network's
render says why its settings never change in an update.

Decision: `appdata/flaresolverr` at `/config`, owned by uid 1000, the image's user (decision 15).
Decision: the wiring network is never made anew by Mediaplane; its settings stay as the render test pins them (decision 16).

**Files:**
- Modify: `catalog/flaresolverr/README.md`, `catalog/flaresolverr/app.ts`, `packages/engine/src/render/compose.ts`
- Test: `catalog/catalog.test.ts`, `test/e2e/indexers.e2e.test.ts`
- Generated (`pnpm docs:generate`): `catalog/flaresolverr/README.md`

**Interfaces:**
- **Consumes:** the catalog's `volumes` and `runAs: fixed:<uid>` (apply's ownership step, S2b); the indexers end-to-end test.
- **Produces:** no new interface.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 2c6f96d..9d07d44 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -363,2 +363,9 @@ apps:
 
+  it("mounts a folder of FlareSolverr's own where its image declares a volume, as the image's user", () => {
+    // Without it, every FlareSolverr container leaves an anonymous volume when removed.
+    const flaresolverr = catalog.find((app) => app.id === 'flaresolverr');
+    expect(flaresolverr?.volumes).toEqual({ appdata: '/config' });
+    expect(flaresolverr?.runAs).toBe('fixed:1000');
+  });
+
   it("gives each Cloudflare solver a health check, and its API on the port Prowlarr's proxy names", () => {
```

**Change** `test/e2e/indexers.e2e.test.ts`:

```diff
diff --git a/test/e2e/indexers.e2e.test.ts b/test/e2e/indexers.e2e.test.ts
index 006da80..6a9dd32 100644
--- a/test/e2e/indexers.e2e.test.ts
+++ b/test/e2e/indexers.e2e.test.ts
@@ -15,2 +15,3 @@ import {
   composeDown,
+  docker,
   expectWiringRemoved,
@@ -389,2 +390,16 @@ describe('indexers, through Prowlarr', () => {
       ).toEqual(['flaresolverr running healthy']);
+      // Its image declares a volume at /config: a folder of its own is mounted there, so
+      // no container of it leaves an anonymous volume behind.
+      const mounts = JSON.parse(
+        await docker(
+          'inspect',
+          '--format',
+          '{{json .Mounts}}',
+          `${PROJECT}-flaresolverr-1`,
+        ),
+      ) as { Type: string; Source: string; Destination: string }[];
+      expect(mounts.filter((m) => m.Type !== 'bind')).toEqual([]);
+      expect(mounts.find((m) => m.Destination === '/config')?.Source).toBe(
+        join(home, 'appdata', 'flaresolverr'),
+      );
       expect(await expectLinks(prowlarr, 'flaresolverr')).toBe(cloudflare);
```

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run catalog/catalog.test.ts`
Expected: FAIL, "mounts a folder of FlareSolverr's own…": `expected {} to deeply equal
{ appdata: '/config' }`.

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/indexers.e2e.test.ts`
Expected: FAIL, at the FlareSolverr check: its mounts hold a `volume` at `/config`
(`expected [ { Type: 'volume', …(7) } ] to deeply equal []`), after about a minute and a
half.

- [ ] **Step 3: Write the implementation**

**Change** `catalog/flaresolverr/app.ts`:

```diff
diff --git a/catalog/flaresolverr/app.ts b/catalog/flaresolverr/app.ts
index 19d503b..4348972 100644
--- a/catalog/flaresolverr/app.ts
+++ b/catalog/flaresolverr/app.ts
@@ -13,4 +13,8 @@ export default defineApp({
   ports: [{ name: 'api', container: 8191, publish: false }],
-  volumes: {},
-  runAs: 'image-default',
+  // Its image declares a volume at /config, and keeps nothing there (probed: its code
+  // never reads or writes it). A folder of its own is mounted there, so that no container
+  // of it leaves an anonymous volume behind when it is removed. The image runs as uid
+  // 1000, so the folder is that user's.
+  volumes: { appdata: '/config' },
+  runAs: 'fixed:1000',
   provides: ['cloudflare-solver'],
```

**Change** `packages/engine/src/render/compose.ts`:

```diff
diff --git a/packages/engine/src/render/compose.ts b/packages/engine/src/render/compose.ts
index 6b8c706..e7027c5 100644
--- a/packages/engine/src/render/compose.ts
+++ b/packages/engine/src/render/compose.ts
@@ -41,3 +41,5 @@ export const PROJECT_NAME = 'mediaplane';
  * whose API Mediaplane calls joins it, and so does Mediaplane's own container while it
- * wires them. Compose names it "<project>_wiring".
+ * wires them. Compose names it "<project>_wiring". Its settings never change in an
+ * update: Compose would have to make it anew, and through the socket proxy it can delete
+ * no network. A release that must change them brings its own step, in its notes.
  */
```

- [ ] **Step 4: Regenerate the docs**

Run: `pnpm docs:generate`

Expected: `wrote catalog/flaresolverr/README.md`, and nothing else.

- [ ] **Step 5: Run the tests, and see them pass**

Run: `pnpm vitest run catalog/catalog.test.ts`, then
`pnpm vitest run --config vitest.e2e.config.ts test/e2e/indexers.e2e.test.ts`
Expected: PASS: FlareSolverr's container has only bind mounts, `/config` being
`<home>/appdata/flaresolverr`, and Prowlarr reaches the indexer through it as before
(about two minutes on the dev box).

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2249 tests in 104 files.

- [ ] **Step 7: Commit**

```bash
git add catalog/catalog.test.ts \
  catalog/flaresolverr/README.md \
  catalog/flaresolverr/app.ts \
  packages/engine/src/render/compose.ts \
  test/e2e/indexers.e2e.test.ts
git commit -m "feat: FlareSolverr gets a folder of its own where its image declares a volume, so none of its containers leaves an anonymous one" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Docs

The §9 set for what Tasks 1 to 7 built (decision 21). The generated references were
regenerated in Tasks 6 and 7.


**Files:**
- Create: `docs/releasing.md`
- Modify: `CONTRIBUTING.md`, `README.md`, `catalog/flaresolverr/README.md`, `deploy/README.md`, `docs/architecture.md`, `docs/design/m1-engine-cli.md`, `docs/how-its-built.md`, `docs/plans/m1-roadmap.md`, `docs/runbooks/wiring-failed.md`, `docs/security/threat-model.md`

**Interfaces:**
- **Consumes:** Tasks 1 to 7.
- **Produces:** `docs/releasing.md`, linked from the README, the deploy guide, the architecture, the threat model and `CONTRIBUTING.md`.

- [ ] **Step 1: See the docs still promise Slice 9**

Run: `grep -rnE 'No image is published yet|releases arrive in Slice 9|Once images are published|Renovate, Slice 9|arrive in Slice 9|Next:\*\* S9|\(Slice 9\);' README.md deploy/README.md docs/architecture.md docs/security docs/plans/m1-roadmap.md`
Expected: 8 lines, such as `deploy/README.md:43:No image is published yet: releases arrive in Slice 9. So you install from a checkout,`.

- [ ] **Step 2: Write the docs**

**Change** `CONTRIBUTING.md`:

```diff
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
index 36784f7..e612ab3 100644
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -128,3 +128,14 @@ that needs a new one must add it there, to the proxy's allow-list, and to ADR 00
 Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
-`docs:`, `test:`, `refactor:`, `chore:` and `ci:`. Release notes are generated from them.
+`docs:`, `test:`, `refactor:`, `chore:` and `ci:`. release-please makes the versions and
+`CHANGELOG.md` from them: before 1.0, a `fix:` raises the patch number, and a `feat:` or a
+breaking change (`feat!:`) the minor one. [Releasing](docs/releasing.md) has the rest.
+
+## Pins
+
+Every image is pinned by tag and digest, and every Action by commit SHA with its
+version in a comment; `scripts/supply-chain.test.ts` checks both. Renovate keeps them
+current (`renovate.json`). A pinned image goes in a file Renovate reads: a catalog
+`app.ts`, the `Dockerfile`, `deploy/mediaplane.compose.yaml`, a workflow, the pre-commit
+hook, a script in `scripts/ci/` or an end-to-end test. A bump of an app's pin changes its
+README's facts: run `pnpm docs:generate` on its branch.
 
```

**Change** `README.md`:

```diff
diff --git a/README.md b/README.md
index 7bdfc3c..c08d015 100644
--- a/README.md
+++ b/README.md
@@ -3,3 +3,3 @@
 [![CI](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml/badge.svg)](https://github.com/cyclopsgd/Mediaplane/actions/workflows/ci.yml)
-[![Licence: GPL-3.0](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)
+[![Licence: GPL-3.0-or-later](https://img.shields.io/badge/licence-GPL--3.0--or--later-blue)](LICENSE)
 
@@ -36,3 +36,8 @@ Compose and wires the apps together for you.**
 >   private network with no route out.
-> - **Next:** releases, and updating Mediaplane without touching the stack.
+> - **Releases:** from the first one, each release publishes Mediaplane's image for amd64
+>   and arm64, and deploy files that pin it by digest. Updating Mediaplane, or going
+>   back, recreates only its own container, never the stack. There has been no release
+>   yet.
+> - **Next:** rebuilding a host from `stack.yaml` and its appdata, and driving
+>   Mediaplane from automation.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -86,3 +91,3 @@ Mediaplane does that part for you:
 | Detect manual changes and offer Re-apply or "Keep mine" (`drift`, `keep`)         | Done    |
-| Releases, and updating Mediaplane without touching the stack                      | Planned |
+| Releases, and updating Mediaplane without touching the stack                      | Done    |
 | Rebuild a host, or deploy with automation such as Ansible                         | Planned |
@@ -324,4 +329,5 @@ Sonarr       http://127.0.0.1:8989
 Mediaplane runs as its own container next to a Docker socket proxy, in a Compose
-project of its own. No image is published yet (that comes in Slice 9), so install it from
-a checkout, as your normal user:
+project of its own. From the first release, you install a release, whose image is
+pinned by digest (see [`deploy/README.md`](deploy/README.md)). There has been no release
+yet, so for now install it from a checkout, as your normal user:
 
@@ -333,5 +339,6 @@ cd Mediaplane
 
-The installer checks Docker, builds the image, starts Mediaplane and installs the
-`mediaplane` command, then offers to run `mediaplane init`. That asks a few questions,
-including your own admin password if you'd rather type one, and with Plex signs you in.
+The installer checks Docker, builds the image (or, from a release, pulls it), starts
+Mediaplane and installs the `mediaplane` command, then offers to run `mediaplane init`.
+That asks a few questions, including your own admin password if you'd rather type one,
+and with Plex signs you in.
 [`deploy/README.md`](deploy/README.md) has the details, and the same steps by hand.
@@ -582,7 +589,7 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
-  (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex) and S8 (drift). Between S7 and
+  (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex), S8 (drift) and S9 (releases and
+  safe updates). Between S7 and
   S8, smaller changes added a guided install (`deploy/install.sh`, and `init` asking for
   your own admin password and signing you in to Plex) and hardware transcoding.
-- **Next:** S9 (releases and safe updates).
-- **After that:** S10 (recovery and automation), which completes M1.
+- **Next:** S10 (recovery and automation), which completes M1.
 
@@ -593,2 +600,4 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **[Architecture](docs/architecture.md):** how the pieces fit, as built so far.
+- **[Releasing](docs/releasing.md):** how a release is cut, what it publishes, and how to
+  check one.
 - **[`stack.yaml` reference](docs/reference/stack-yaml.md):** every field, generated from
@@ -629,2 +638,2 @@ See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
 
-[GPL-3.0](LICENSE)
+[GPL-3.0-or-later](LICENSE)
```

**Change** `catalog/flaresolverr/README.md`:

```diff
diff --git a/catalog/flaresolverr/README.md b/catalog/flaresolverr/README.md
index ba4524d..09ddca7 100644
--- a/catalog/flaresolverr/README.md
+++ b/catalog/flaresolverr/README.md
@@ -30,2 +30,6 @@ Prowlarr's indexers. Mediaplane runs the upstream image, unmodified, when you li
 - **`LOG_LEVEL=info`.**
+- **A folder of its own at `/config`,** `appdata/flaresolverr`, owned by uid 1000, the
+  image's user. The image declares a volume there and keeps nothing in it; without the
+  folder, Docker makes an anonymous volume for each FlareSolverr container, left behind
+  when the container is removed.
 - **A health check of its own.** The image has none, so Mediaplane asks FlareSolverr's
```

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index be1a4fb..859737f 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -2,2 +2,5 @@
 
+In a release's deploy files, this guide's links lead into the repository: open them on
+GitHub, at github.com/cyclopsgd/Mediaplane, at the release's tag.
+
 Mediaplane runs as two containers in their own Compose project, `mediaplane-system`:
@@ -30,4 +33,5 @@ never touch Mediaplane itself.
   the Compose plugin 2.24 or newer. Rootless Docker is not supported. Mediaplane checks
-  for Engine 24. The container brings its own Docker CLI 29.8.1 and Compose 5.5.1, which
-  have been tested only with Docker Engine 28 and 29 so far.
+  for Engine 24. The container brings its own Docker CLI 29.8.1 and Compose 5.5.1. CI
+  runs the end-to-end tests on Docker Engine 28, and checks the calls Mediaplane makes
+  with that CLI and Compose against Engine 24, the oldest supported.
 - **No SELinux in enforcing mode.** Such hosts aren't supported yet: neither
@@ -42,4 +46,34 @@ never touch Mediaplane itself.
 
-No image is published yet: releases arrive in Slice 9. So you install from a checkout,
-as your normal user, not root:
+There are two ways in, both as your normal user, not root:
+
+- **From a release,** from the first one: its deploy files name its image,
+  `ghcr.io/cyclopsgd/mediaplane:<version>`, pinned by its digest, and `install.sh` pulls
+  it. There has been no release yet.
+- **From a checkout,** which builds the image here. Until the first release, this is
+  the way.
+
+### From a release
+
+With the version you want (`0.1.0` is an example):
+
+```bash
+version=0.1.0
+base=https://github.com/cyclopsgd/Mediaplane/releases/download/v$version
+curl -fLO "$base/mediaplane-deploy-$version.tar.gz"
+curl -fLO "$base/SHA256SUMS"
+sha256sum --check SHA256SUMS
+tar -xzf "mediaplane-deploy-$version.tar.gz"
+./mediaplane/deploy/install.sh
+```
+
+- `sha256sum --check` checks the file against the release's own list. With the GitHub
+  CLI you can also check that this repository's release workflow made it:
+  `gh attestation verify mediaplane-deploy-$version.tar.gz --repo cyclopsgd/Mediaplane`.
+- `install.sh` pulls the image by its digest, and Docker checks everything it pulls
+  against it: what runs is the image the release workflow built and scanned.
+  [Releasing](../docs/releasing.md) shows how to check the image itself.
+- Keep the `mediaplane` folder: its `deploy/.env` holds your settings, and updating
+  unpacks the next release over it.
+
+### From a checkout
 
@@ -51,3 +85,5 @@ cd Mediaplane
 
-`install.sh` does everything the next section does by hand:
+### What `install.sh` does
+
+It does everything [By hand](#by-hand) does:
 
@@ -56,4 +92,5 @@ cd Mediaplane
 - creates the home, `/opt/mediaplane` or `MEDIAPLANE_HOME`, owned by you;
-- builds the image, and writes `deploy/.env` with your ids, the Docker socket's group and
-  your timezone;
+- from a release, pulls its image and the socket proxy's; from a checkout, builds the
+  image;
+- writes `deploy/.env` with your ids, the Docker socket's group and your timezone;
 - starts Mediaplane's container, and installs the `mediaplane` command in
@@ -70,6 +107,11 @@ you only a home it has just created, never a folder that was already there. With
   different `MEDIAPLANE_HOME` is refused. To move the home, edit `deploy/.env`.
-- **Updating:** run it again after `git pull`. It rebuilds the image, keeps your
-  `deploy/.env` as it is, and never touches your stack.
-- **An image of your own:** set `MEDIAPLANE_IMAGE` for the first run and it builds
-  nothing. Later runs take the image from `deploy/.env`, so change it there.
+- **Updating:** run it again, from the next release's files or after `git pull` (see
+  [Updating](#updating)). It keeps your `deploy/.env` as it is, and never touches your
+  stack.
+- **An image of your own:** set `MEDIAPLANE_IMAGE` for the first run, pinned by digest
+  (`<name>:<tag>@sha256:<digest>`), and it pulls that and builds nothing. It refuses one
+  that isn't pinned, so that every run starts the image you checked;
+  `docker buildx imagetools inspect <name>:<tag>` shows the digest. Later runs take the
+  image from `deploy/.env`, so change it there. `mediaplane:local` is the one image it
+  takes unpinned: the one it builds from a checkout.
 - **If `mediaplane` then runs something else** in your shell, `type -a mediaplane` shows
@@ -79,3 +121,6 @@ you only a home it has just created, never a folder that was already there. With
 
-Build the image from a checkout:
+From a release, the image is named in its `mediaplane.compose.yaml`, so skip the build
+below, leave `MEDIAPLANE_IMAGE` out of `deploy/.env`, and run
+`docker compose -f deploy/mediaplane.compose.yaml pull` before `up -d`. From a checkout,
+build the image:
 
@@ -296,4 +341,41 @@ host
 
-Pull, then run the installer again. It rebuilds the image and recreates Mediaplane's
-container:
+Updating Mediaplane recreates Mediaplane's own container, and nothing else. It never
+restarts, recreates or pulls an app of your stack, and leaves the stack's networks, its
+volumes and `generated/` as they are: an end-to-end test checks each container's id,
+start time, restarts and mounts, every file in `generated/` and `state/`, and that Docker
+pulls only Mediaplane's image and the proxy's, across an update and back. Afterwards,
+`mediaplane plan` shows what the new version would change, if anything, and only `apply`
+changes it, when you run it.
+
+**From a release** (from the first one): unpack the next release's deploy files over the
+old ones, in the same folder, then run its installer. It keeps your `deploy/.env`, pulls
+the new image, then recreates Mediaplane's container:
+
+```bash
+version=0.2.0
+base=https://github.com/cyclopsgd/Mediaplane/releases/download/v$version
+curl -fLO "$base/mediaplane-deploy-$version.tar.gz"
+curl -fLO "$base/SHA256SUMS"
+sha256sum --check SHA256SUMS
+tar -xzf "mediaplane-deploy-$version.tar.gz"
+./mediaplane/deploy/install.sh
+```
+
+By hand, after unpacking, that is:
+
+```bash
+docker compose -f mediaplane/deploy/mediaplane.compose.yaml pull
+docker compose -f mediaplane/deploy/mediaplane.compose.yaml up -d
+```
+
+`pull` comes first, so a pull that fails leaves Mediaplane as it was. The file names its
+release's image by digest, so `pull` with the old file changes nothing: the next
+release's file is the update.
+
+**Going back to an earlier release** is the same, with that release's deploy files. It
+too leaves the stack as it is. One thing can stop it: an older Mediaplane refuses a
+`state/resources.json` that `drift` has written to (see the drift item below).
+
+**From a checkout:** pull, then run the installer again. It rebuilds the image and
+recreates Mediaplane's container:
 
@@ -312,4 +394,6 @@ docker compose -f deploy/mediaplane.compose.yaml up -d
 
-Once images are published (Slice 9), `docker compose -f deploy/mediaplane.compose.yaml pull`
-replaces the build. Updating Mediaplane never restarts your stack.
+**From a checkout to a release:** copy the checkout's `deploy/.env` into the release's
+`mediaplane/deploy/`, take out its `MEDIAPLANE_IMAGE=mediaplane:local` line, and run the
+release's `install.sh`. The installer refuses to build `mediaplane:local` where there is
+no checkout, and says so.
 
@@ -347,2 +431,13 @@ An update that brings Plex's wiring changes three things you may see:
 
+An update that brings releases (Slice 9) changes two things you may see:
+
+- **FlareSolverr gets a folder of its own,** `appdata/flaresolverr`, mounted where its
+  image declares a volume. The next `plan` shows its container recreated once. The
+  empty volume Docker made for its old container stays: `docker volume ls --filter
+dangling=true` lists such volumes, and `docker volume rm <name>` removes one you have
+  checked is that one.
+- **`stack.yaml` has a version check.** A `version:` newer than this Mediaplane reads is
+  refused, with what to do. `mediaplane migrate` rewrites an older one; there is none
+  yet, since `stack.yaml` has only ever been version 1.
+
 An update that brings drift (Slice 8) changes what you may see:
```

**Change** `docs/architecture.md`:

```diff
diff --git a/docs/architecture.md b/docs/architecture.md
index a818ba9..ae69855 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -3,3 +3,3 @@
 This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
-covering what is built so far (Slices 1 to 8). The design describes the whole of M1;
+covering what is built so far (Slices 1 to 9). The design describes the whole of M1;
 this page describes what exists.
@@ -851,2 +851,42 @@ pass, down or leak
 
+## Releases and updates
+
+- **Versions.** release-please keeps a release pull request, with the next version and
+  `CHANGELOG.md`, from the Conventional Commits on `main`. Merging it tags the release.
+  [Releasing](releasing.md) has the whole process.
+- **The image.** From the first release, `ghcr.io/cyclopsgd/mediaplane:<version>` is
+  one index of two images,
+  amd64 and arm64, each built natively on its own runner, with an SBOM and build
+  provenance attached, and a signed attestation of its provenance beside it. Its times
+  come from the commit, so one commit builds one image. Each image is scanned by Trivy
+  before it is pushed, and the release checks that it pushed the image it scanned. CI
+  makes the same build on every pull request, and pushes nothing.
+- **Deploy files.** A release's `install.sh` and `mediaplane.compose.yaml` name its
+  image by digest. In the repository both leave it out, and a checkout builds its own.
+  `install.sh` refuses an image that isn't pinned, but for the one it builds.
+- **Updating** is `pull`, then `up -d`, on Mediaplane's own project with the next
+  release's files. Only Mediaplane's container is recreated:
+
+```text
+update
+ ├─ mediaplane-system
+ │  ├─ mediaplane: recreated
+ │  └─ socket-proxy: as it was
+ └─ mediaplane (your stack)
+    as it was: containers,
+    networks, volumes and
+    generated/
+```
+
+- **`stack.yaml`'s version.** This Mediaplane reads version 1. One that changes the format
+  will read an older file through a migration, in memory, with a warning, and
+  `mediaplane migrate` will rewrite the file, keeping its comments; a newer file is
+  refused. No migration exists yet, so `migrate` has nothing to do.
+- **The wiring network's settings never change in an update.** Compose would have to
+  make it anew, and through the socket proxy it can delete no network. A release that
+  had to change them would bring its own steps, in its notes.
+- **Every pin is kept current** by Renovate, once the Renovate app is installed (an
+  owner's step): the catalog's apps (each bump runs the full end-to-end suite and is
+  merged by hand), the images outside the catalog, npm packages and the Actions' commits.
+
 ## Security
@@ -860,3 +900,2 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- releases and safe updates (Slice 9);
 - recovery and automation (Slice 10), which completes M1.
```

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 45bd6d7..3f43bc0 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -5,3 +5,3 @@
 - **Milestone:** M1 of 4 (Engine + CLI)
-- **Licence:** GPL-3.0
+- **Licence:** GPL-3.0-or-later (the owner's decision of 2026-10-17)
 
@@ -902,3 +902,3 @@ Documentation lives in the repo and is updated with the code.
   - `CHANGELOG.md`
-  - `LICENSE` (GPL-3.0)
+  - `LICENSE` (GPL-3.0-or-later)
 
@@ -949,4 +949,5 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
 - **Where the deployment lives.** It is `deploy/mediaplane.compose.yaml`,
-  started with `docker compose -f deploy/mediaplane.compose.yaml up -d`. Until
-  images are published (S9), it needs `MEDIAPLANE_IMAGE`, the image to run. It
+  started with `docker compose -f deploy/mediaplane.compose.yaml up -d`. A checkout's
+  copy needs `MEDIAPLANE_IMAGE`, the image to run; a release's names its own, pinned by
+  digest (Slice 9). It
   also needs `DOCKER_GID`, the group that owns the Docker socket.
@@ -970,3 +971,4 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   see because they are bundled. Neither sees Node itself. Scanning the catalog
-  images, the SBOM and provenance stay in S9.
+  images, the SBOM and provenance stay in S9 (built there, with a check of Node's
+  security releases).
 - **CI runs on arm64 from S2c** (§8.2), on GitHub's `ubuntu-24.04-arm` runners,
@@ -974,3 +976,3 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   tested end to end natively on each architecture. A multi-arch manifest comes
-  with publishing, in S9.
+  with publishing, in S9 (one index of both, made by the release workflow).
 - **Generated references from S2c.** The `stack.yaml` reference, its JSON Schema at
@@ -1970 +1972,85 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
 - **No new Docker API call:** drift and keep make the calls `plan` makes (§7.2(2)).
+
+### Slice 9: releases and safe updates (2026-10-25)
+
+- **The licence is GPL-3.0-or-later** (the owner's decision of 2026-10-17), in every
+  `package.json`'s SPDX `license` field and the image's label.
+- **Versions come from release-please** (§8.2): one Node package at the root, tagged
+  `v<version>`; it also bumps the CLI's `package.json` and `mediaplane --version`, at
+  its markers. Before 1.0 a breaking change raises the minor number. The first release's
+  changelog has every `feat:` and `fix:` since the repository began. `CHANGELOG.md` is
+  release-please's, and Prettier leaves it alone.
+- **Only a release publishes** (§8.2). The release workflow runs on a push to `main`;
+  only one that merges release-please's pull request cuts a release, and only in this
+  repository. release-please tags the commit and writes the release page at the merge;
+  the workflow then waits until CI's `All checks passed` has passed on the release's
+  commit, so the image and the deploy files are published only for a commit CI passed.
+  If CI fails there, the release page stays without them, and `docs/releasing.md` gives
+  the way back (`gh release delete v<version> --cleanup-tag`).
+- **The image** (§2.1, §7.2(7), §8.2). Each architecture is built natively on its own
+  runner, by `scripts/ci/build-image.sh`: BuildKit and its SBOM scanner pinned by digest,
+  an SBOM and provenance (`mode=max`, which holds no secret: the build is given none),
+  the commit's time as every time in it, so one commit builds one image (probed: two
+  builds, one from a cold builder, gave one digest). Trivy scans that image, as an OCI
+  layout, before anything is pushed; the push is of the same build, by digest with no
+  tag, and is checked to hold the image scanned. One index of both is then tagged
+  `ghcr.io/cyclopsgd/mediaplane:<version>` (lowercased from the repository's name), never
+  `latest`, with a signed provenance attestation beside it. A pull request makes the same
+  build on both architectures, and pushes nothing: the multi-arch build that §8.2 asks
+  of every pull request is the two native builds a release makes.
+- **A release's deploy files** (§4.4). `mediaplane-deploy-<version>.tar.gz` holds
+  `deploy/`, with `install.sh` and `mediaplane.compose.yaml` naming the release's image
+  by digest, the licence, and `SHA256SUMS` beside it; it is the same bytes for the same
+  commit, and attested. In the repository both files leave the image out: a checkout
+  builds its own.
+- **Release notes** add "Tested app versions" (§8.2): a list of each image, with its tag
+  and digest, rather than a table, so that it reads on a phone.
+- **`install.sh` installs a release** (§4.4). From a release's files it pulls the image by
+  digest, which Docker checks as it pulls, and the socket proxy's, before it recreates
+  anything, and builds nothing; from a checkout it builds `mediaplane:local`. It refuses
+  any other image not pinned by digest, and `mediaplane:local` where there is no
+  checkout. A release's image goes unnamed in `deploy/.env`, so the next release's file
+  names the next one.
+- **Updating** (§4.4) is `pull` then `up -d` on `mediaplane-system`, as §4.4 says, with the
+  next release's `mediaplane.compose.yaml`: its image is pinned, so the file is the update,
+  and `pull` with the old one changes nothing. `install.sh` does the same. It recreates
+  only Mediaplane's container: an end-to-end test checks every container of the stack
+  (its id, image, state, start time, restarts and mounts), its networks, and every file
+  in `generated/` and `state/`, and that Docker pulls only Mediaplane's image and the
+  proxy's, across an update, a `plan` (which pulls nothing), and going back.
+- **The wiring network's settings never change in an update** (§11, Slice 3b): Compose
+  would have to make it anew, and the socket proxy deletes no network. A release that
+  had to change them would bring its own steps in its notes.
+- **FlareSolverr gets `appdata/flaresolverr` at `/config`** (§4.3), owned by uid 1000, its
+  image's user (`runAs: fixed:1000`). Its image declares a volume there and keeps nothing
+  in it (probed). Compose carries an anonymous volume over to a recreated container, even
+  past a `tmpfs` there, and only a bind mount replaces it (probed), so the removed
+  container is what left one behind.
+- **`stack.yaml`'s version** (§4.2, §5 step 2, §5.2). This Mediaplane reads and writes
+  version 1, the only one so far. Load reads an older version through its migrations, in
+  memory, and warns (`config.old-version`), saying to run `migrate`; it refuses a newer
+  one (`config.newer-version`) and one no Mediaplane wrote (`config.unknown-version`).
+  Each migration says what it changes as data, and as edits of the text: `migrate`
+  applies the edits and the new version, and requires the result to read as the data
+  says, so comments, order, quoting, spacing and line ends stay (§3.3), as Keep mine
+  writes it (§11, Slice 8). `migrate` takes apply's lock, refuses what `keep` refuses, and
+  with `managed_by: external` writes nothing and gives the file as it should be, on
+  standard output and as `text` in `mediaplane.migrate/v1`. No migration exists yet, so
+  `migrate` has nothing to do; the machinery is tested with a made-up version 0.
+- **Renovate** (§7.2(7), §8.2) bumps each catalog pin, tag and digest, through a custom
+  manager, with a versioning rule for each linuxserver.io tag, and the images pinned
+  outside the catalog, npm packages and the Actions' commits. Nothing merges itself. The
+  hosted Renovate can't run `pnpm docs:generate`, so CI's docs check fails an app's bump
+  until it is run on the branch, as Renovate's pull request says.
+- **CI** (§7.2(7), §8.2) also, on every pull request that changes code and weekly: scans
+  every catalog image with Trivy on both architectures, failing on a critical finding
+  with a fix unless `scripts/ci/catalog-ignore.yaml` lists it, with the app it is in, and
+  its date has not passed (Mediaplane never patches an app's image, §1.4(1)); fails while
+  Node has published a security release of the image's line that the image lacks; and
+  runs the image's Docker CLI and Compose against Docker Engine 24, the oldest supported.
+  actionlint and shellcheck check the workflows and scripts, and a test checks that every
+  Action is pinned by commit, each job's token is read-only unless it says more, and no
+  workflow runs a pull request's code with secrets. With the secrets `DOCKERHUB_USERNAME`
+  and `DOCKERHUB_TOKEN`, the jobs that pull images log in to Docker Hub first.
+- **Node is 24.22.1**, a security release over 24.21.0, which the new check found.
+- **No new Docker API call:** the socket proxy's allow-list is unchanged (§7.2(2)).
```

**Change** `docs/how-its-built.md`:

```diff
diff --git a/docs/how-its-built.md b/docs/how-its-built.md
index 18317df..bf5d4f9 100644
--- a/docs/how-its-built.md
+++ b/docs/how-its-built.md
@@ -112,2 +112,5 @@ ones on `main`.
 
+A release is the same, for release-please's own pull request: once it is merged, the
+release workflow publishes the image and the deploy files ([Releasing](releasing.md)).
+
 ## What the maintainer decides
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index c167160..4b51a8f 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -26,2 +26,3 @@ Detailed plans so far:
 - Slice 8: [`m1-s8-drift.md`](m1-s8-drift.md) (done).
+- Slice 9: [`m1-s9-releases.md`](m1-s9-releases.md) (done).
 
@@ -29,3 +30,3 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7 and S8.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8 and S9.
 - **Between S7 and S8 (2026-10-17), outside the slices** by the lighter route for small
@@ -34,4 +35,3 @@ Where M1 stands (the README shows the same):
   `deploy/install.sh`.
-- **Next:** S9 (releases and safe updates).
-- **After that:** S10 (recovery and automation), which completes M1.
+- **Next:** S10 (recovery and automation), which completes M1.
   [After M1](#after-m1) has what comes next.
@@ -209,3 +209,7 @@ repositories, and the repo is public, so from S2c (owner, 2026-10-09):
   reports either way, so it is the one check branch protection should require;
-- a multi-arch image manifest waits for publishing, in S9.
+- a multi-arch image manifest waits for publishing, in S9. **Done in S9:** the `image`
+  job builds each architecture as a release does (SBOM, provenance, an OCI layout) and
+  scans that; the release workflow pushes both and tags one index of them. The
+  `engine-floor` job checks the image's Docker CLI and Compose against Docker Engine 24,
+  and `catalog-images` scans the apps' images.
 
@@ -271,3 +275,4 @@ added an S9 item and changed one, and its final review an S8 item and an S9 item
 its conflict check an S9 item. Slice 8 (2026-10-25) settled each S8 item: built, decided,
-or moved with its reason, as each says. Each
+or moved with its reason, as each says. Slice 9 (2026-10-26) settled each S9 item: built,
+decided, or an owner's step, as each says. Each
 slice plan must address the items for that slice.
@@ -653,2 +658,6 @@ password, which are S3c's (and listed again below).
     a folder there needs the image's user probed first.
+  - **Done in S9:** probed: the image runs as uid 1000 and keeps nothing in `/config`, and
+    Compose carries an anonymous volume over to a recreated container (so it is a removed
+    container that leaves one), even past a `tmpfs` there; only a bind mount replaces it.
+    So `appdata/flaresolverr` is mounted there, owned by uid 1000.
 - **Rotating the admin password.** There is no way to replace the generated password
@@ -660,2 +669,6 @@ password, which are S3c's (and listed again below).
   - **Moved to S9:** its settings change only with Mediaplane's own updates.
+  - **Decided in S9:** Mediaplane doesn't make it anew: through the socket proxy it can
+    delete no network, and no proxy permission is added. No release changes its settings
+    (the render test pins them); one that had to would bring its own steps in its notes.
+    The update end-to-end test shows an update leaving it as it is.
 - **The `partial` outcome.** Spec §5 step 12 names `success`, `partial` and `failed`.
@@ -791,4 +804,7 @@ password, which are S3c's (and listed again below).
   gaps.
+  - **Settled in S9,** each as the item says below. `main`'s protection is the owner's
+    to set: the S9 plan gives the settings for light and strict, and recommends strict.
 - **Decided by the owner on 2026-10-17:**
-  - the licence is GPL-3.0-or-later;
+  - the licence is GPL-3.0-or-later (**done in S9:** every `package.json`'s `license`,
+    the image's label, the README and the spec);
   - no code of conduct, and no community-support material such as issue templates or
@@ -819,2 +835,4 @@ password, which are S3c's (and listed again below).
   SPDX `license` field.
+  - **Done in S9:** the SPDX field (GPL-3.0-or-later). Private vulnerability reporting
+    stays an owner's step: the S9 plan gives the command.
 - **Docs:** make the `--json` contract explicit (pin its fields and document
@@ -826,3 +844,5 @@ password, which are S3c's (and listed again below).
   Align it in the `--json` pass: adding `ok: true` is additive within v1.
-- **Tests:** tighten the catalog tag test, and add Renovate. Let
+- **Tests:** tighten the catalog tag test, and add Renovate.
+  - **Renovate done in S9;** `scripts/supply-chain.test.ts` also checks that Renovate can
+    read each pinned tag. Tightening the catalog's own tag test stays S10's. Let
   `test/e2e/deploy.e2e.test.ts` deploy with `deployMediaplane()` from
@@ -869,2 +889,7 @@ password, which are S3c's (and listed again below).
   README's facts block shows the pin.
+  - **Done in S9:** Renovate's custom managers find each of these, and each catalog pin
+    (tag and digest), with a versioning rule for each linuxserver.io tag (probed with
+    Renovate's own lookup); a test fails when a pinned image is written anywhere else.
+    The hosted Renovate can't run `pnpm docs:generate`, so CI's docs check fails the
+    bump until it is run on the branch, and Renovate's pull request says so.
 - **Node's own vulnerabilities.** Node comes with the image's `node` base as a
@@ -874,2 +899,6 @@ password, which are S3c's (and listed again below).
   releases.
+  - **Decided in S9: yes.** `scripts/ci/node-security.ts` fails CI, on every pull request
+    and weekly, while Node's index lists a security release of the image's line newer
+    than the image's Node. It found one at once (24.22.1, over 24.21.0), so S9 bumps the
+    pin.
 - **The Docker version CI tests.** The runners' Docker moves with GitHub's images,
@@ -877,2 +906,6 @@ password, which are S3c's (and listed again below).
   whether to test it.
+  - **Decided in S9:** the floor's risk is the API the image's own Docker CLI and Compose
+    speak, so CI's `engine-floor` job runs them against Docker Engine 24 in Docker, with
+    the calls Mediaplane makes (probed: they pass). The full end-to-end suite stays on
+    the runners' Docker, which would take twice as long to run again on 24.
 - **Publish the image,** and give `MEDIAPLANE_IMAGE` in
@@ -880,2 +913,5 @@ password, which are S3c's (and listed again below).
   instead of build.
+  - **Done in S9,** from the first release: a release's own deploy files pin its image
+    by digest; the repository's leave it out, so a checkout builds. The first release is
+    the owner's.
 - **Registry rate limits in CI** (S6). S5's first arm64 run failed on
@@ -885,2 +921,6 @@ password, which are S3c's (and listed again below).
   image jobs. S6 adds no image: each e2e file pulls only what is missing.
+  - **Done in S9:** with the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (the
+    owner's, read-only), the jobs that pull images log in to Docker Hub; without them, as
+    in a fork's pull request, they pull anonymously. GHCR's and lscr.io's pulls stay
+    anonymous, and apply's own pull retries stay.
 
```

**Create** `docs/releasing.md`:

````markdown
# Releasing Mediaplane

Mediaplane's releases come from
[release-please](https://github.com/googleapis/release-please) and the release workflow,
`.github/workflows/release.yml` (spec §8.2). This page says
how a release is cut, what it publishes, and how to check one. There has been no
release yet: everything below happens from the first one.

## How a release is cut

```text
push to main
 └─ release-please
     ├─ updates its pull
     │  request: version,
     │  changelog
     └─ that pull request
        merged: tag, release
         └─ CI passed on it?
             ├─ image, amd64
             ├─ image, arm64
             ├─ one tag for both
             ├─ deploy files
             └─ tested versions
```

1. **Every push to `main`** has release-please update its release pull request,
   `chore(main): release <version>`. The version comes from the Conventional Commits
   since the last release: before 1.0, a `fix:` raises the patch number, and a `feat:`
   or a breaking change the minor one. The pull request also updates `CHANGELOG.md`,
   the version in both `package.json` files, and the CLI's `mediaplane --version`.
2. **CI runs on that pull request** at once when the repository has the
   `RELEASE_PLEASE_TOKEN` secret. With GitHub's own token, GitHub starts no workflow for
   it, so close the pull request and open it again: that starts CI.
3. **Merging it cuts the release.** release-please tags the commit `v<version>` and
   writes the GitHub release, with the changelog, at once: the tag and the release page
   exist from the merge, before CI has passed on it.
4. **In the same run, the release workflow publishes it,** once CI's last job,
   `All checks passed`, has passed on that commit (it waits up to 90 minutes):
   - on an amd64 runner and an arm64 runner, natively, it builds the image, with its
     SBOM and build provenance, scans it with Trivy, and pushes the image it scanned by
     digest, checking that what it pushed is what it scanned;
   - it tags `ghcr.io/cyclopsgd/mediaplane:<version>`, one index for both, and attests
     its provenance, signed, beside the image;
   - it makes the deploy files, `mediaplane-deploy-<version>.tar.gz`, whose `install.sh`
     and `mediaplane.compose.yaml` name that image by its digest, with `SHA256SUMS`,
     attests them too, adds them to the release, and adds the tested app versions to
     its notes.

## What never publishes

- A push to `main` that doesn't merge the release pull request publishes nothing.
- A pull request publishes nothing. CI builds the release's own image on both
  architectures, with the same script, and pushes nothing.
- A fork publishes nothing: release-please runs in `cyclopsgd/Mediaplane` only.
- No image is tagged `latest`. Each is named by its version, and a release's deploy files
  name it by its digest.

## Tokens and secrets

Every job starts with a token that may do nothing, and asks for what it needs:

- **release-please:** write the repository's contents, issues and pull requests, for its
  pull request, the tag and the release.
- **Waiting for CI:** read the repository and its checks.
- **The images:** read the repository, and write packages, to push by digest.
- **One tag for both:** write packages, and sign and keep an attestation.
- **The deploy files:** read the repository only. This is the one job that installs npm
  packages, whose scripts run with its environment: it has no secret.
- **Adding them to the release:** write the repository's contents, and sign and keep an
  attestation.

Secrets, each optional:

- `RELEASE_PLEASE_TOKEN`: a fine-grained token of the owner's, for this repository only,
  that may write contents, issues and pull requests. It only makes CI run on the release
  pull request at once.
- `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`: a Docker Hub token that may only read public
  images, so that CI's pulls don't meet Docker Hub's limit for anonymous ones.

GitHub gives no secret to a fork's pull request: there, CI pulls anonymously.

## If a release stops halfway

Re-run the failed jobs from the workflow run's page. Each step can run again:

- before the images are pushed, nothing is published but the tag and the release page,
  which release-please made at the merge;
- the wait for CI fails at once when every `All checks passed` run on the commit so far
  failed, such as the pull request's, before the run of the push to `main` has
  finished: re-run it once that run has passed;
- an image pushed by digest but not tagged is an untagged version in the package, which
  the next run tags or leaves;
- the deploy files are uploaded with `--clobber`, and the notes are written from the
  release's own, the tested app versions taking the place of those a run added before.

If CI fails on the release's commit, nothing else is published: no image and no deploy
files, so the release page has none, and the deploy guide's commands find nothing for
that version. Take the release and its tag away, fix the fault on `main`, and let the
next release pull request cut a new version, once release-please opens it:

```bash
gh release delete v0.1.0 --cleanup-tag --repo cyclopsgd/Mediaplane
```

(`0.1.0` is an example.)

## Checking a release

From the first release, with the version you got (`0.1.0` is an example):

```bash
sha256sum --check SHA256SUMS
gh attestation verify mediaplane-deploy-0.1.0.tar.gz --repo cyclopsgd/Mediaplane
gh attestation verify oci://ghcr.io/cyclopsgd/mediaplane:0.1.0 --repo cyclopsgd/Mediaplane
docker buildx imagetools inspect ghcr.io/cyclopsgd/mediaplane:0.1.0
```

The last shows the image's digest, which the release's `mediaplane.compose.yaml` names,
and its SBOM and provenance with `--format '{{json .SBOM}}'` and
`--format '{{json .Provenance}}'`.
````

**Change** `docs/runbooks/wiring-failed.md`:

```diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 83691ed..7b49c42 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -779,4 +779,6 @@ differ, and a `reason` when it is `unknown`.
 - **The wiring network must be made anew,** when its settings changed, or when
-  Mediaplane refused it (`wire.network`, above). When its settings changed, Compose has
-  to delete the network, and through the socket proxy it can't: `apply` then stops at
+  Mediaplane refused it (`wire.network`, above). No release of Mediaplane changes its
+  settings: one that had to would say so in its notes, with its own steps. When its
+  settings changed, Compose has to delete the network, and through the socket proxy it
+  can't: `apply` then stops at
   the containers step, with a message from Compose that names the network. The apps are
```

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 36874f2..a85900d 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -508,12 +508,27 @@ Controls today:
 
-- Every image is pinned by digest: the apps, the proxy, and Node and the Docker CLI in
-  Mediaplane's image.
-- npm packages come from the lockfile, and GitHub Actions are pinned by commit.
-- CI runs two vulnerability scans that fail the build:
-  - Trivy scans Mediaplane's image on amd64 and arm64: its Alpine packages, the Docker
-    CLI's Go standard library and Compose's Go modules. It fails on a critical
-    vulnerability that has a fix.
+- Every image is pinned by digest: the apps, the proxy, Node and the Docker CLI in
+  Mediaplane's image, and the images CI and the tests run. A test fails when a pinned
+  image is written where Renovate doesn't look.
+- npm packages come from the lockfile, and GitHub Actions are pinned by commit, with
+  their version beside it. A test checks each.
+- Once the Renovate app is installed (an owner's step), Renovate opens a pull request
+  for every newer pin: an app's runs the full end-to-end suite, and none is merged
+  automatically.
+- CI's checks that fail the build, on every pull request and weekly:
+  - Trivy scans Mediaplane's image on amd64 and arm64, built as a release builds it:
+    its Alpine packages, the Docker CLI's Go standard library and Compose's Go modules.
+    It fails on a critical vulnerability that has a fix.
+  - Trivy scans every catalog image, on both architectures. A finding that only upstream
+    can fix passes while `scripts/ci/catalog-ignore.yaml` lists it, with the app it is in,
+    until the date beside it; after that date it fails again.
+  - Node's own security releases: a check fails while Node has published one for the
+    image's line that the image lacks. Neither scan sees Node, a binary in the base.
   - `pnpm audit` checks the CLI's production npm dependencies, which are bundled into one
     file where Trivy can't see them, and fails on a critical advisory.
+  - actionlint and shellcheck check the workflows and the shell scripts.
 - gitleaks scans the full history on every push to `main` and every pull request.
+- From the first release, each image is published with an SBOM and build provenance,
+  and a signed attestation of its provenance; the release's deploy files name it by
+  digest, and they and `SHA256SUMS` are attested too. A release publishes its image and
+  deploy files only for a commit CI passed.
 
@@ -521,8 +536,31 @@ What remains:
 
-- Neither scan sees Node itself, which is not an Alpine package, nor the Docker CLI's own
-  code: they stay current only when their pinned images are bumped.
-- The audit needs the npm registry at CI time.
-- Nothing bumps pins or dependencies automatically yet (Renovate, Slice 9).
-- The catalog images are not scanned yet, and there is no SBOM or provenance yet. Both
-  arrive in Slice 9.
+- The scans see known vulnerabilities only, and the catalog's listed findings run until
+  upstream ships a fix and Renovate's bump of the pin is merged.
+- The audit and the Node check need the npm registry and nodejs.org at CI time.
+- A read-only Docker Hub token in the repository's secrets reaches every job that pulls
+  images on the repository's own branches. It can read public images only.
+
+### T18. The release workflow publishes something it shouldn't
+
+Controls today:
+
+- Only merging release-please's pull request cuts a release. Every other push to `main`,
+  every pull request, and every fork publishes nothing.
+- Each job's token may do only what that job does ([Releasing](../releasing.md) lists
+  them). The one job that installs npm packages has a read-only token and no secret.
+- No workflow runs a pull request's code with secrets: there is no `pull_request_target`,
+  and no secret reaches a script but through its environment.
+- A release publishes its image and deploy files only for a commit whose CI passed,
+  builds from its tag, and pushes the image Trivy scanned, checked by digest.
+
+What remains:
+
+- Whoever can push to `main`, or merge the release pull request, can publish a release.
+  Protecting `main` (an owner's step) narrows that.
+- The tag and the release page exist from the merge, before CI has passed: release-please
+  makes them. If CI then fails on that commit, nothing else is published, and the page
+  stays without files until it is deleted (`docs/releasing.md` gives the command).
+- `RELEASE_PLEASE_TOKEN`, when set, is a token of the owner's that may write this
+  repository's contents, issues and pull requests: the release-please job has it, and no
+  other.
 
```

- [ ] **Step 3: Run the tests, and see them pass**

Run the Step 1 command again.
Expected: no output. Every `text` block in `docs/releasing.md`, `docs/architecture.md` and
`deploy/README.md` is at most 40 columns wide.

- [ ] **Step 4: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: every step passes; `pnpm test` reports 2249 tests in 104 files.

- [ ] **Step 5: Commit**

```bash
git add CONTRIBUTING.md \
  README.md \
  catalog/flaresolverr/README.md \
  deploy/README.md \
  docs/architecture.md \
  docs/design/m1-engine-cli.md \
  docs/how-its-built.md \
  docs/plans/m1-roadmap.md \
  docs/releasing.md \
  docs/runbooks/wiring-failed.md \
  docs/security/threat-model.md
git commit -m "docs: installing and updating from a release, the release process, the supply chain and the release workflow in the threat model, and Slice 9 in the spec and the roadmap" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

## Slice 9 completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.18% statements, 93.18% branches, 98.28% functions and 99.32% lines, with 2249 tests in 104 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too, and leaves no
  `mediaplane-e2e-*` container, network, volume or image, and no `mediaplane-e2e-*`
  folder. When this plan was replayed, alone on the dev box, warm, without the plex.tv
  token (so the nightly test was skipped):
  - with Compose 5.5.1, 28 tests passed and 1 skipped in 12 files, in 15 min 46 s;
  - with Compose 2.38.2, 28 passed and 1 skipped, in 16 min 54 s.

  After the pre-flight rulings, the replay ran the one end-to-end file they touch,
  `test/e2e/update.e2e.test.ts` (no end-to-end test runs `install.sh`): it passed in 76 s
  with Compose 5.5.1 and in 75 s with 2.38.2. The rest is unchanged from the full run
  above.

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] Actionlint, shellcheck and `renovate-config-validator --strict` pass, as in Task 2;
  the CI scripts pass on the dev box, as in Task 3.
- [ ] Updating Mediaplane, and going back, leaves the stack as it was: the update test
  passes on both Composes.
- [ ] Nothing was published: no push, tag, release, package or setting. The workflows'
  rules hold (`scripts/supply-chain.test.ts`, `scripts/release/workflow.test.ts`).
- [ ] The socket proxy's allow-list is unchanged:
  `git diff bcfb8f7 -- deploy/mediaplane.compose.yaml | grep -E '^[-+] +- -allow'` prints
  nothing (decision 20). `bcfb8f7` is `main` before this slice.
- [ ] No committed file contains a real path, user name, host name, address or token:
  `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing but the
  project's own names (its GitHub repo and schema URL, its GHCR image, the workflows'
  repository guards, the release notes' install commands) and the tests' fake
  `/srv/data/home` paths.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B bcfb8f7.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 1 (only a release publishes, after CI), 2 (native builds, pushed by digest
    as scanned), 3 to 5 (a release's own deploy files, `install.sh`, and updating with the
    next release's file), 6 (the catalog's findings listed with a date: the owner's call),
    10 and 11 (Renovate, release-please), 13 (`main`'s protection: the owner's call), 14
    (`migrate` with no migration yet) and 15 (FlareSolverr's folder);
  - the owner's steps below.

### The owner's steps, in order

None of these is a task: each is the owner's, or the controller's with the owner's
say-so. `gh` runs as the owner, against `cyclopsgd/Mediaplane`.

1. **Protect `main`** (decision 13). Strict, recommended:

   ```bash
   gh api --method PUT repos/cyclopsgd/Mediaplane/branches/main/protection --input - <<'EOF'
   {
     "required_status_checks": {
       "strict": true,
       "checks": [{ "context": "All checks passed", "app_id": 15368 }]
     },
     "enforce_admins": true,
     "required_pull_request_reviews": null,
     "restrictions": null,
     "required_linear_history": true,
     "allow_force_pushes": false,
     "allow_deletions": false
   }
   EOF
   ```

   Light is the same with `"enforce_admins": false`. Either way, check it with
   `gh api repos/cyclopsgd/Mediaplane/branches/main/protection`. (15368 is GitHub
   Actions' app id, so that only CI's own job can pass the check; not probed: if GitHub
   refuses it, use `"contexts": ["All checks passed"]` in place of `"checks"`.)
2. **Let release-please open its pull request.** Either set `RELEASE_PLEASE_TOKEN`, a
   fine-grained token of yours for this repository only, with read and write access to
   contents, issues and pull requests (then CI runs on its pull request at once):

   ```bash
   gh secret set RELEASE_PLEASE_TOKEN --repo cyclopsgd/Mediaplane
   ```

   or let GitHub's own token open pull requests:

   ```bash
   gh api --method PUT repos/cyclopsgd/Mediaplane/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```

   and close and reopen each release pull request, to start its CI.
3. **Optionally, a Docker Hub token** that may only read public images (decision 9):

   ```bash
   gh secret set DOCKERHUB_USERNAME --repo cyclopsgd/Mediaplane --body "<your Docker Hub user>"
   gh secret set DOCKERHUB_TOKEN --repo cyclopsgd/Mediaplane
   ```
4. **Turn on private vulnerability reporting**, which `SECURITY.md` relies on:

   ```bash
   gh api --method PUT repos/cyclopsgd/Mediaplane/private-vulnerability-reporting
   ```
5. **Install the Renovate app** (github.com/apps/renovate) on this repository only. With
   `renovate.json` already there, it opens its Dependency Dashboard issue, then a pull
   request per pin. Merge an app pin's only after `pnpm docs:generate` on its branch and a
   green CI.
6. **The first release, when you choose.** Merge S9 first. release-please then opens
   `chore(main): release 0.1.0`. Once its CI is green, merge it as you merge any pull
   request:

   ```bash
   git fetch origin
   git push origin <the release pull request's head sha>:main
   ```

   Then watch the release workflow (`gh run watch`). If it doesn't publish because
   release-please didn't see the pull request as merged (decision 11), merge the next
   one with GitHub's "Rebase and merge" instead.
7. **Make the package public**, once the first image is published: on GitHub, Packages,
   `mediaplane`, Package settings, Change visibility, Public. Until then nobody can pull
   it, the install from a release fails, and the docs' "from the first release" still
   holds.
8. **Check the first release**, as `docs/releasing.md` says: `sha256sum --check`,
   `gh attestation verify` for the deploy files and the image, and
   `docker buildx imagetools inspect`; then install it on a host from its deploy files.
