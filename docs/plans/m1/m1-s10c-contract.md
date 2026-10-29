# M1 Slice 10c: the automation contract and the docs — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the last slice of M1: pin the contract a script reads (every `--json` document,
exit codes, commands that ask nothing without a terminal, a second `apply` that changes
nothing), generate it into the docs, settle every item the roadmap left for S10c, and
write the docs that complete M1. A playbook deploys a stack, removes an app from it, and
rebuilds the host, reading only the documented contract.

**Architecture:**

- **The contract** (spec §5.2, §9): each `--json` document is a Zod schema in
  `packages/cli/src/contract.ts`, built by a function per document (`planDocument`,
  `statusDocument`, …) that its printer prints. A type-level test checks that each
  function's result is exactly its schema's type; every document `run.test.ts` prints is
  checked against its schema, strictly. `docs/reference/json.md` and a JSON Schema per
  document in `docs/reference/json/` are generated from the schemas, and the playbook test
  checks real documents against those published files.
- **A script is asked nothing:** spawned tests pin it; every command that reads
  `stack.yaml` refuses a named pipe or a folder there, without waiting.
- **The docs check** (`pnpm docs:check`) also fails on a link, or a docs path named in
  code, that leads nowhere; help and hints give the published docs' address.
- **First-run setups are held in one pass,** whatever the catalog's order; a setup whose
  app isn't ready in time isn't asked again.
- **The end-to-end suite:** CI pulls its images first, with retries; what a file's tests
  leave in Docker is removed after it; the playbook test drives Mediaplane's container.
- **The installer** refuses a `DOCKER_HOST` or `DOCKER_CONTEXT` of another Docker;
  Renovate's pull request for the image's `docker` says what a change of Compose does.
- **The docs:** the full README, the guide to deploying with automation (a short Ansible
  example a test checks), the add-an-app guide, the spec's §11 and the roadmap; the
  slices' plans move to `docs/plans/m1/`.

**Tech Stack:** as Slice 10b (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4.6, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). Zod becomes a direct dependency of
the CLI package and a dev dependency of the root, at the version the engine already has:
no new package. No new image.

**Spec:** [`docs/design/m1-engine-cli.md`](/docs/design/m1-engine-cli.md), in particular:

- §1.6 (Ansible readiness), §2.3 (the success criteria, and "M1 is done when");
- §4.2 (externally managed mode), §4.4 (Mediaplane's own deployment);
- §5, §5.2 (the CLI contract: exit codes, `--json`);
- §6.4 (first-run setups before publish), §7.2(2) (the socket proxy);
- §8.1 (the test layers), §9 (the docs set), §11 (every slice's refinements, Slice 10b's
  and "CI: the catalog scan reports" included).

Slice context: [`docs/plans/m1-roadmap.md`](/docs/plans/m1-roadmap.md): the S10c bullet
(Delivers, "What the contract must pin from S10b", the nightly Plex job's items, Proves),
every item marked for S10c under "Inputs for later slices" and "S9 and S10 (before going
public)", and "After M1".

### S10c is one part (decision 1)

About eight tasks, as the brief asked: it fits, so S10c doesn't split again.

1. The `--json` contract in code: a schema per document, `ok` on each.
2. The generated reference, the docs link check, and help that names the published docs.
3. A script is asked nothing, and never waits on `stack.yaml`.
4. First-run setups held in one pass, and a never-ready setup asked once.
5. The end-to-end harness and CI: images pulled first, leftovers removed, the test gaps.
6. Supply chain and the installer: Renovate's tags and Compose note, `DOCKER_HOST`.
7. The proof: a playbook, on real Docker.
8. The docs that complete M1, and the plans moved to `docs/plans/m1/`.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`): the exact `git diff -U1`
  output, with one line of context. Save it to a file and run `git apply <file>` from the
  repo root, or make the same edit by hand. Apply a task's blocks in the order given.
- **Blocks are fenced with four backticks,** so that a Markdown file's own fences inside
  one stay as they are.
- **Generated files are never edited by hand.** A step that changes what they are made
  from says to run `pnpm docs:generate`, and names what it rewrites.
- **Links in this plan are from the repository's root** (`/docs/…`), so that moving it to
  `docs/plans/m1/` (Task 8) changes nothing in it.
- Every block was applied in order to a fresh worktree at `f2fdcd8`, and each task's tests
  failed before its implementation and passed after it (see the completion checklist).

## Global Constraints

Everything in the Slice 1 to 10b Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md` to `docs/plans/m1-s10b-automation.md`, in
`docs/plans/m1/` once Task 8 has moved them):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses, hostnames, tokens or ids in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-admin-password`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps but for its documented marks;
- Docker is reached only through the `Runtime` (the end-to-end tests and CI scripts may
  call `docker` themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`, and never reach a real app or plex.tv;
- the runtime refuses any Compose project that is not `mediaplane` or
  `mediaplane-<name>`, and never accepts `mediaplane-system`;
- every image is pinned by digest, and every GitHub Action by commit SHA;
- end-to-end test files run one at a time; names in them start with `mediaplane-e2e-`;
  teardown never stops at the first failure;
- never prune images (`docker image prune`, `docker system prune`);
- temporary folders in unit tests come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing`;
- coverage thresholds are never lowered: `vitest.config.ts` keeps 90% lines, functions,
  branches and statements on `packages/engine/src`;
- the integration contract and bootstrap before publish are unchanged but as decisions
  10 and 11 say; keys go only to the stack's own addresses;
- never push, tag, release, or publish anything; never change the repository's settings.

The spec's exact values for this slice, verbatim:

- §5.2: "**`plan`.** Exit 0 means no changes, 2 means changes are pending, 1 means an
  error (`--detailed-exitcode` semantics by default)."
- §5.2: "**`apply`.** Interactive by default: it shows the plan and asks for
  confirmation. `--yes` skips the prompt. Ctrl-D or Ctrl-C at the prompt answers no. Exit
  0 means success; the `--json` output includes `"changed": true|false`. Exit 1 means
  failed or partial."
- §5.2: "**`--json`.** Every command supports it. The JSON shapes are versioned and
  documented, because external automation depends on them."
- §2.3, criterion 3: "**Idempotent.** A second `apply` reports `No changes`, exits 0 and
  modifies nothing."
- §1.6: "Mediaplane will **not** ship an Ansible role or collection, only one short
  example in its docs (Slice 10). The project owner will write the Ansible deployment
  separately, later. Mediaplane stays a standalone tool: Ansible is one way to drive it,
  never a need."; and M1 must make that easy: "headless `plan` and `apply` with `--json`
  output and meaningful exit codes; secrets supplied as files or env vars; an "externally
  managed" mode in which Mediaplane never writes `stack.yaml`."
- §9: "**`README.md`**: the pitch and quick start; features; an honest comparison with
  alternatives (§1.3); an architecture diagram"; "**`docs/reference/`, generated from
  code:** … the `--json` output shapes"; "`CONTRIBUTING.md`, including a step-by-step
  "add an app" guide".
- §7.2(2): "Mediaplane never mounts the raw socket. A minimal proxy container allows only
  the endpoints Compose needs (containers, images, networks, volumes, and the reads used
  by `--wait`) and blocks `exec`, swarm, plugins, secrets, configs and system."

These are added or restated for this slice:

- **Secrets never appear** in output, `--json` (but `credentials --reveal`'s password),
  errors, change records, `state/resources.json`, logs, a command line, or end-to-end
  failure messages: each app's key, the admin password, the plex.tv token, a claim token,
  Seerr's Plex and Jellyfin credentials. End-to-end checks compare secrets as yes or no.
- **Contracts change only additively within v1:** pinning them documents and tests what
  exists. Fields gained (`ok`, `error.diagnostics`) are additive; nothing is renamed or
  removed.
- **Fail closed:** an app Mediaplane couldn't ask stays unpublished; a value a script
  doesn't know is one it stops at.
- **`plan` changes nothing.** Only `apply` writes.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` doesn't change, nor
  does the allow-list `deploy/deploy.test.ts` checks.
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. This slice adds no Compose
  flag.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes what the generated docs are made from runs `pnpm docs:generate` first, and
  commits the generated files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested; nothing about a
    release, a published image, Renovate or branch protection is described as live:
    those are the owner's steps, still to do.
  - Short, plain sentences; lists rather than wide tables; no internal jargon.
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.

## What was probed

On the dev box (aarch64, Docker 29.8, Compose 5.5.1), from source at `f2fdcd8` and then
with this plan's code, against the catalog's pinned images, in `mediaplane-e2e-*`
projects of its own:

1. **What every command prints under `--json` today, and exits with,** on an empty home
   and on a real stack:
   - `plan`, `drift`, `keep` and `migrate` print their own document with `ok`, also on an
     error (exit 1); `apply` too (`ok`, `changed`, `outcome`).
   - `status` (`mediaplane.status/v1`) and `history` (`mediaplane.history/v1`) print no
     `ok`; nor does `credentials` (`mediaplane.credentials/v1`), nor `history <id>`, which
     prints the record as it is.
   - `credentials` and `vpn-check` without a `stack.yaml`, `apply` without `--yes`,
     `init` without its flags, and `history <id>` of no record print
     `mediaplane.error/v1`, whose `error` holds only a `message`: the codes are lost.
   - A usage error (`plan --bogus --json`, `bogus --json`, `keep --json`) prints nothing
     on stdout, only Commander's line on stderr, and exits 1: a script reading `--json`
     finds no document.
   - The missing `stack.yaml` hint names `docs/design/m1-engine-cli.md §4.2`, a path in
     the repo; so do `plan --help` and `drift --help`, for the threat model.
2. **Which commands prompt without a terminal:** none. `main.ts` gives the CLI a prompt
   only when its standard input and output are both terminals; without one, `apply`
   without `--yes` exits 1 (`apply needs --yes when it cannot ask for confirmation`), and
   `init` without `--media-server` and `--data` exits 1 (`init needs --media-server and
   --data when it cannot ask`). `plex-login` asks nothing either: it prints a link and
   waits, up to its timeout, for you to sign in in a browser.
3. **A named pipe in place of `stack.yaml`** (S9's review): `plan`, `apply`, `drift` and
   `credentials` were all still waiting after 15 seconds; with this plan's code each exits
   1 at once with `config.not-a-file`. A folder there was an `EISDIR` thrown into the error
   envelope; it is now the same diagnostic.
4. **Zod 4.6.5's JSON Schema:** `z.toJSONSchema` of a `z.strictObject` gives
   `additionalProperties: false`, a literal gives `const`, a discriminated union `oneOf`,
   and `.describe()` a `description`; `z.fromJSONSchema` of the result accepts a document
   and refuses one with an extra field, a missing one, another `const` or a bad enum
   value. So the published files are checked with no new dependency.
5. **The type-level check catches a change:** with `expectTypeOf(...).toEqualTypeOf`,
   renaming a field in a document's schema, making an optional field required, dropping a
   value of an enum, or adding a field to a variant each fails `pnpm typecheck` (2, 3, 2
   and 1 errors). The credentials document needs `.branded`: the engine's `AppLogin` is
   an intersection, the schema a union.
6. **Compose's config hashes, across versions** (the roadmap's S10c item): `docker compose
   config --hash '*'` of every service of two rendered stacks (Jellyfin behind the VPN
   with Seerr, Prowlarr and Byparr; Plex with FlareSolverr), with eleven releases, each
   binary checked against its published sha256: 2.29.7, 2.33.1, 2.36.2, 2.38.2, 2.39.4 and
   2.40.3 give one hash per service; so do 5.0.2, 5.3.1, 5.5.1 and 5.6.1; a 2.x and a 5.x
   differ for every service but Byparr; 2.24.0 differs from the later 2.x for Gluetun and
   qBittorrent only.
7. **First-run setups, in a future catalog** (the S10b final review's item): with the test
   catalog's Sonarr given a Seerr-like setup that signs in again when `admin.password` is
   rotated, `f2fdcd8`'s `plan` holds a setup found open twice, warning
   `bootstrap.needs-password` twice, and holds one through Jellyfin although Jellyfin's
   own open setup, in the same plan, makes the admin with the password first. With this
   plan's code, once each, and not at all.
8. **The pre-pull:** `pnpm exec tsx scripts/ci/pull-images.ts arm64` lists and pulls 16
   images: the catalog's for arm64, busybox, the WireGuard test server, the registry,
   Node, the Docker CLI and the socket proxy.
9. **A test that times out with a container up:** a throwaway test that starts one and
   sleeps past its 5-second timeout. Its own teardown never runs, so at `f2fdcd8` nothing
   would remove the container; with Task 5's setup the file fails with `the tests left
   these behind, now removed: mediaplane-e2e-<pid>-probe`, and nothing is left.
10. **The playbook, on real Docker** (Task 7): from the image, through `docker exec`, the
    Jellyfin stack without Seerr deploys, a second `apply` changes nothing, Radarr is taken
    out (its container, `prowlarr.application_radarr` and `qbittorrent.category_movies`
    go), and the host is rebuilt (`jellyfin`, `prowlarr`, `qbittorrent` and `sonarr`'s
    keys recovered, a new admin password, every resource adopted), drift then clear: every
    document passed its published JSON Schema. With `ok` taken out of
    `docs/reference/json/status.schema.json`, it fails at `status`.
11. **The claim tokens of a claim again** (the nightly Plex job's S10b item, which said 2):
    with the plex.tv test account, the claim of a signed-out Plex takes two claim tokens,
    so the run's count is 3 after it, not 2: one for the unpublished start's `PLEX_CLAIM`,
    which the image ignores while `Preferences.xml` keeps the attribute, and one that the
    claim through Plex's API posts. The test pins 3. The unused one expires in four
    minutes; not fetching it would need the setup to know, before the start, that Plex is
    signed out, so it is left as it is.

## Decisions taken in this plan

Each task names the decisions it applies. The ones to look at first are marked
**(check)**.

1. **S10c is one part, of eight tasks,** as "S10c is one part" says above: it fits.
2. **(check) The contract is the CLI's, as Zod schemas** (spec §5.2, §9), one per
   document, in `packages/cli/src/contract.ts`, beside the printers; each printer prints
   what a document function builds. It is pinned three ways: a type-level equality of
   each function's result with its schema's type (`pnpm typecheck`); a strict check of
   every document `run.test.ts` prints, after each test; and, end to end, real documents
   against the published JSON Schema files. Zod becomes a direct dependency of the CLI
   (and a dev dependency of the root, for the docs and the end-to-end tests): the
   engine's own Zod, no new package.
3. **(check) Every document has `schema` and `ok`** (the roadmap's S10c item):
   `credentials`, `status`, `history` and `history <id>` gain `ok: true`, additive within
   v1. `history <id>` prints the record as this release reads it, with `ok` beside its
   fields: so `mediaplane.change/v1`'s document is the record plus `ok`, and a test checks
   that the record's own fields are exactly what `state/history/` keeps
   (`changeRecordSchema`).
4. **The published schemas are exact** (`additionalProperties: false`), so they pin this
   release, and the end-to-end check catches a field the docs don't name. A script reads
   the fields it knows, ignores the rest, and stops at a value it doesn't know: within v1
   a document only grows (as §11, Slice 3a, says of change records), and the reference
   says so.
5. **A `--json` run always prints one document:** a usage error prints
   `mediaplane.error/v1` too (Commander still writes its line to stderr); the error
   document gains `diagnostics`, each with its code, when the failure came from them
   (additive). Only `--help` and `--version` print text.
6. **`history <id>`'s policy** (S10a's review): it prints the fields this release knows,
   with `ok`; a record that is there but can't be read is said to be so, never "no change
   record" (`hasRecordFile`).
7. **Diagnostic codes are an open set,** stable once given; a script switches on
   `severity`, and acts on the codes it knows. The reference lists those it most likely
   acts on, S10b's three new ones among them; a test checks that a test pins each
   (`rotate.no-plex` gains one).
8. **Help and hints name the published docs** (the roadmap's item): `docsUrl(path)` gives
   the GitHub address, as `runbookUrl` does. `docs:check` checks every Markdown link, every
   link to the repo's own files on GitHub, and every `docs/…` path named in code or prose,
   outside fenced code; the slices' plans are records, so their prose's paths aren't
   checked, but their links are.
9. **A script is asked nothing** (spec §5.2): this was already so (probe 2), so it is
   pinned by spawned tests, not changed. A named pipe or a folder in place of `stack.yaml`
   is refused by every command that reads it, never waited on (`config.not-a-file`), as
   `migrate` and `keep` already refused one (S9's review).
10. **(check) First-run setups are held in one pass** (the S10b final review's item, made
    order-independent rather than pinned by a test): the setups that sign in again with
    what is rotated and those set up again once asked are held, through an app that lacks
    the password, together with the plan's other setups, so an app whose own setup makes
    the admin first holds nothing, and each setup is held and warned of once. A failed
    hold that is an error (a rotation that would leave an app without the password) now
    stops the plan there, as the other holds do.
11. **A setup whose app isn't ready in time isn't asked again** (S5's item): asking would
    wait a second deadline. Unasked is open, so it stays unpublished (fail closed, and
    stricter than before for a setup that makes a key).
12. **(check) A Jellyfin `apply` started published, whose wizard still looks open, keeps
    its ports: moved to M2** (S5's item said "take the ports away"). Taking them away in
    that `apply` wouldn't last: `plan` goes by Jellyfin's own `system.xml`, which says the
    wizard is done, so the next `apply` publishes it again. The fix is for `plan` to ask
    Jellyfin itself, as S10b has it ask Seerr, a `doctor`-like check; meanwhile the error
    says it is published, and to stop it.
13. **CI pulls the suite's images first** (the roadmap's S10c item): every image the
    end-to-end suite runs, retried after a temporary registry error (apply's own rule,
    `isTransientPullError`) after 15 s, 30 s, 1, 2 and 4 minutes. `apply` pulls only
    what is missing (`--policy missing`), so it finds them present, and its own retries
    and reports are unchanged.
14. **The harness removes what a file's tests leave** (S6's item): `test/e2e/setup.ts`,
    after each file, removes every container, Compose project and network of this run's
    names (`mediaplane-e2e-<pid>`), Mediaplane's own projects first, and fails the file
    naming them. Per file, not per test: the deploy test shares one deployment across its
    tests.
15. **(check) `install.sh` refuses a `DOCKER_HOST` or `DOCKER_CONTEXT`** that points
    `docker` away from the socket it checks (S9's review: "unsetting them or refusing them
    is a choice to make"): refused, since whoever set one meant it, and the deployment
    mounts this host's socket whatever `docker` talks to. `unix://<that socket>` and the
    `default` context pass.
16. **Compose versions** (the roadmap's S10c item): probe 6's result goes into
    `docs/releasing.md` and `deploy/README.md`, and Renovate's pull request for a bump of
    the image's `docker` (which brings its Compose) says what to check. No code depends on
    it.
17. **Renovate can read every pinned tag** (S9's review), the catalog's and every other,
    found wherever it is written; a catalog tag must name a version, never one that moves.
18. **(check) The proof drives the image** (the roadmap's Proves): the playbook test runs
    every command as `docker exec <container> mediaplane … --json`, as the Ansible example
    does, with no terminal, reading only exit codes and documents, each checked against its
    published JSON Schema file. The Ansible example itself is checked by a unit test (its
    YAML parses; every command and option it runs is the CLI's; `apply` has `--yes`):
    `ansible-lint` would need Python and Ansible pinned in CI for twenty lines.
19. **The docs** (spec §9): the full README (status, a features list in place of the
    table, the §1.3 comparison as a list, no internal wording); `docs/automation.md`; the
    add-an-app guide in `CONTRIBUTING.md`; the two wide tables as lists; the spec's §11
    entry; the roadmap with every S10c item settled, M1 done, and what moved to M2 listed.
    The slices' plans move to `docs/plans/m1/` with `git mv` (the owner's request of
    2026-10-27), with a short README; only the two links each plan's prose has change.
20. **No new Docker API call** (§7.2(2)): the pre-pull and the harness are CI's and the
    tests' own `docker` calls; the engine's are unchanged.

## File structure (new and changed in this slice)

- `packages/cli/src/contract.ts` (new): the documents' schemas, `DOCUMENTS`, `CODES`,
  `checkDocument`, `documentsIn`.
- `packages/cli/src/{output,credentials,vpn-check,plex-login,init,run}.ts`: a document
  function per document, `ok`, the error document's `diagnostics`, usage errors.
- `packages/engine/src/history/records.ts`: `hasRecordFile`.
- `packages/engine/src/runbooks.ts`: `DOCS_URL`, `docsUrl`.
- `packages/engine/src/config/load.ts`, `util/fs.ts`, `drift.ts`, `apply/apply.ts`:
  `config.not-a-file`, reads that never wait.
- `packages/engine/src/plan/plan.ts`, `apply/bootstrap.ts`: setups held in one pass; a
  never-ready setup asked once.
- `scripts/docs.ts`, `scripts/docs/{json-reference,links}.ts` (new): the generated
  `--json` reference and JSON Schemas; the link check.
- `scripts/ci/pull-images.ts` (new), `.github/workflows/ci.yml`: the pre-pull.
- `test/e2e/setup.ts` (new), `test/e2e/helpers.ts`, `vitest.e2e.config.ts`,
  `vitest.config.ts`: leftovers removed after each file; the harness's own unit tests.
- `test/e2e/playbook.e2e.test.ts` (new); `test/e2e/{deploy,jellyfin,indexers,plex}.e2e.test.ts`,
  `test/e2e/wireguard.ts`: the test gaps.
- `deploy/install.sh`, `renovate.json`.
- Docs: `README.md`, `CONTRIBUTING.md`, `docs/automation.md` (new), `docs/architecture.md`,
  `docs/how-its-built.md`, `docs/releasing.md`, `deploy/README.md`,
  `docs/security/threat-model.md`, the spec, the roadmap, `docs/plans/m1/` (moved, with a
  README); generated: `docs/reference/cli.md`, `docs/reference/json.md` (new),
  `docs/reference/json/*.schema.json` (new).

### Task 1: The `--json` contract in code: a schema per document, and `ok` on each

Decisions 2, 3, 4, 5, 6.

**Files:**

- Create: `packages/cli/src/contract.ts`, `packages/cli/src/contract.test.ts`
- Change: `packages/cli/package.json`, `pnpm-lock.yaml` (Zod, a direct dependency now)
- Change: `packages/cli/src/output.ts`, `credentials.ts`, `vpn-check.ts`, `plex-login.ts`,
  `init.ts`, `run.ts`
- Change: `packages/engine/src/history/records.ts`
- Test: `packages/cli/src/run.test.ts`, `credentials.test.ts`, `vpn-check.test.ts`,
  `packages/engine/src/history/records.test.ts`

**Interfaces:**

- Consumes: the engine's result types (`PlanResult`, `ApplyResult`, `DriftResult`,
  `KeepResult`, `MigrateResult`, `StatusResult`, `ChangeRecord`, `CredentialsResult`,
  `VpnCheckResult`) and `changeRecordSchema`, as they are.
- Produces, in `packages/cli/src/contract.ts`: a Zod schema per document
  (`planDocumentJson`, `applyDocumentJson`, `driftDocumentJson`, `keepDocumentJson`,
  `migrateDocumentJson`, `statusDocumentJson`, `historyDocumentJson`,
  `changeDocumentJson`, `credentialsDocumentJson`, `vpnCheckDocumentJson`,
  `plexLoginDocumentJson`, `initDocumentJson`, `errorDocumentJson`, and
  `diagnosticJson`); `interface JsonDocument { schema: string; file: string; shape:
  z.ZodType }`; `DOCUMENTS: readonly JsonDocument[]`; `INTERNAL_SCHEMAS: readonly
  string[]`; `checkDocument(document: unknown): string` (throws naming the paths that
  don't fit); `documentsIn(stdout: string): unknown[]`.
- Produces, in `output.ts`: `printJson(document, io)`; `errorDocument(message,
  diagnostics?)`; `planDocument(result)`, `applyDocument`, `driftDocument`,
  `keepDocument`, `migrateDocument`, `statusDocument`, `historyDocument(list)`,
  `recordDocument(record)`; `printError(message, options, io, diagnostics?)`. In
  `credentials.ts`: `credentialsDocument(result, apps, reveal)`; `vpn-check.ts`:
  `vpnCheckDocument(result)`; `plex-login.ts`: `plexLoginDocument(result)`; `init.ts`:
  `initDocument(stackPath, next)`. Each `*_JSON_SCHEMA` constant is `as const`.
- Produces, in the engine: `hasRecordFile(home: string, id: string): Promise<boolean>`.

- [ ] **Step 1: Give the CLI Zod, and write the failing tests**

The tests import Zod, so the CLI names it first:

````diff
diff --git a/packages/cli/package.json b/packages/cli/package.json
index ca28cbf..51120aa 100644
--- a/packages/cli/package.json
+++ b/packages/cli/package.json
@@ -9,3 +9,4 @@
     "@mediaplane/engine": "workspace:*",
-    "commander": "^15.0.0"
+    "commander": "^15.0.0",
+    "zod": "^4.6.5"
   }
````

Run `pnpm install`. It adds these lines to `pnpm-lock.yaml`, shown here, with nothing to apply:

````diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 70f9f68..c93af0b 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -70,2 +70,5 @@ importers:
         version: 15.0.0
+      zod:
+        specifier: ^4.6.5
+        version: 4.6.5
 
````

Create `packages/cli/src/contract.test.ts`:

````ts
import { changeRecordSchema } from '@mediaplane/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  applyDocumentJson,
  changeDocumentJson,
  checkDocument,
  credentialsDocumentJson,
  documentsIn,
  DOCUMENTS,
  driftDocumentJson,
  errorDocumentJson,
  historyDocumentJson,
  initDocumentJson,
  keepDocumentJson,
  migrateDocumentJson,
  planDocumentJson,
  plexLoginDocumentJson,
  statusDocumentJson,
  vpnCheckDocumentJson,
} from './contract';
import { credentialsDocument } from './credentials';
import { initDocument } from './init';
import {
  applyDocument,
  driftDocument,
  errorDocument,
  historyDocument,
  keepDocument,
  migrateDocument,
  planDocument,
  recordDocument,
  statusDocument,
} from './output';
import { plexLoginDocument } from './plex-login';
import { vpnCheckDocument } from './vpn-check';

describe('the --json contract', () => {
  // Checked by `pnpm typecheck`: each printer prints exactly the documented fields, of the
  // documented types, so a field added to the engine's results fails here until the
  // contract, and so the generated reference, says what it is.
  it('is what each printer prints, field for field', () => {
    expectTypeOf<ReturnType<typeof planDocument>>().toEqualTypeOf<
      z.infer<typeof planDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof applyDocument>>().toEqualTypeOf<
      z.infer<typeof applyDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof driftDocument>>().toEqualTypeOf<
      z.infer<typeof driftDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof keepDocument>>().toEqualTypeOf<
      z.infer<typeof keepDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof migrateDocument>>().toEqualTypeOf<
      z.infer<typeof migrateDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof statusDocument>>().toEqualTypeOf<
      z.infer<typeof statusDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof historyDocument>>().toEqualTypeOf<
      z.infer<typeof historyDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof recordDocument>>().toEqualTypeOf<
      z.infer<typeof changeDocumentJson>
    >();
    // branded: an app's login is an intersection in the engine, a union here.
    expectTypeOf<ReturnType<typeof credentialsDocument>>().branded.toEqualTypeOf<
      z.infer<typeof credentialsDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof vpnCheckDocument>>().toEqualTypeOf<
      z.infer<typeof vpnCheckDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof plexLoginDocument>>().toEqualTypeOf<
      z.infer<typeof plexLoginDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof initDocument>>().toEqualTypeOf<
      z.infer<typeof initDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof errorDocument>>().toEqualTypeOf<
      z.infer<typeof errorDocumentJson>
    >();
  });

  it('documents the change record as state/history keeps it, with ok', () => {
    /** A JSON Schema without its descriptions: what it accepts, and nothing else. */
    const accepted = (schema: unknown): unknown =>
      JSON.parse(JSON.stringify(schema), (key, value: unknown) =>
        key === 'description' ? undefined : value,
      ) as unknown;
    const { ok: _, ...fields } = changeDocumentJson.shape;
    expect(accepted(z.toJSONSchema(z.strictObject(fields)))).toEqual(
      accepted(z.toJSONSchema(changeRecordSchema)),
    );
  });

  it('names each document once, by its schema, with a file of its own', () => {
    const schemas = DOCUMENTS.map((d) => d.schema);
    expect(new Set(schemas).size).toBe(schemas.length);
    for (const document of DOCUMENTS) {
      expect(document.schema).toMatch(/^mediaplane\.[a-z-]+\/v1$/);
      expect(document.file).toBe(
        `${document.schema.replace(/^mediaplane\./, '').replace(/\/v1$/, '')}.schema.json`,
      );
    }
  });

  it('checks a document by its schema, strictly, and refuses one it does not know', () => {
    const error = errorDocument('fake failure', [
      { severity: 'error', code: 'config.missing', message: 'fake failure' },
    ]);
    expect(checkDocument(error)).toBe('mediaplane.error/v1');
    expect(() => checkDocument({ ...error, extra: true })).toThrow(
      /mediaplane\.error\/v1 does not match its documented schema: .*extra/,
    );
    expect(() => checkDocument({ schema: 'mediaplane.unknown/v1' })).toThrow(
      'no documented --json schema "mediaplane.unknown/v1"',
    );
  });

  it('finds each document a capture printed, one after the other', () => {
    const one = `${JSON.stringify({ schema: 'a' }, null, 2)}\n`;
    const two = `${JSON.stringify({ schema: 'b', nested: { c: 1 } }, null, 2)}\n`;
    expect(documentsIn(one + two)).toEqual([
      { schema: 'a' },
      { schema: 'b', nested: { c: 1 } },
    ]);
    expect(documentsIn('Plan: 1 file to write.\n')).toEqual([]);
  });
});
````

Change `packages/cli/src/run.test.ts`: every document a test there prints is checked
against the contract after it; `ok` on `status`, `history` and `history <id>`; a record
there but unread; a usage error under `--json`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 2c8f940..2da2645 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -47,3 +47,4 @@ import {
 } from '@mediaplane/engine/testing';
-import { beforeEach, describe, expect, it, vi } from 'vitest';
+import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
+import { checkDocument, documentsIn, INTERNAL_SCHEMAS } from './contract';
 import { PromptCancelled } from './prompt';
@@ -339,4 +340,20 @@ function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
 
+/** What each test's captures printed on stdout: checked against the contract after it. */
+let printed: (() => string)[] = [];
+afterEach(() => {
+  const outputs = printed;
+  printed = [];
+  // Every --json document any test here printed is one the contract documents, exactly;
+  // but for the helpers' answers to Mediaplane itself.
+  for (const output of outputs) {
+    for (const doc of documentsIn(output())) {
+      const { schema } = doc as { schema?: string };
+      if (!INTERNAL_SCHEMAS.includes(schema ?? '')) checkDocument(doc);
+    }
+  }
+});
+
 function capture(env: NodeJS.ProcessEnv = {}, answers?: string[]) {
   const out: string[] = [];
+  printed.push(() => out.join(''));
   const err: string[] = [];
@@ -763,2 +780,28 @@ describe('mediaplane plan', () => {
 
+  it('answers a usage error with a JSON envelope too, with --json', async () => {
+    for (const argv of [
+      ['plan', '--bogus', '--json'],
+      ['bogus', '--json'],
+      ['keep', '--json'],
+    ]) {
+      const term = capture();
+      expect(await run(argv, term.io, deps())).toBe(1);
+      const said = /^error: (.*)\n/.exec(term.stderr())?.[1];
+      expect(said).toBeDefined();
+      expect(JSON.parse(term.stdout())).toEqual({
+        schema: 'mediaplane.error/v1',
+        ok: false,
+        error: { message: said },
+      });
+    }
+    // Without --json, only Commander's own words, on stderr.
+    const term = capture();
+    expect(await run(['plan', '--bogus'], term.io, deps())).toBe(1);
+    expect(term.stdout()).toBe('');
+    // --help and --version are no error, and print what they print.
+    const help = capture();
+    expect(await run(['plan', '--help', '--json'], help.io, deps())).toBe(0);
+    expect(help.stdout()).toContain('Usage: mediaplane plan');
+  });
+
   it('reports unexpected errors as a JSON envelope with --json', async () => {
@@ -1145,3 +1188,3 @@ describe('mediaplane apply', () => {
     expect(shown.stdout()).not.toContain(secretLike);
-    expect(JSON.parse(shown.stdout())).toEqual(record);
+    expect(JSON.parse(shown.stdout())).toEqual({ ...record, ok: true });
     expect(await readFile(path, 'utf8')).toContain(secretLike);
@@ -2461,3 +2504,7 @@ describe('mediaplane status', () => {
     };
-    expect(json).toMatchObject({ schema: 'mediaplane.status/v1', healthy: true });
+    expect(json).toMatchObject({
+      schema: 'mediaplane.status/v1',
+      ok: true,
+      healthy: true,
+    });
     expect(json).not.toHaveProperty('historyError');
@@ -2532,2 +2579,3 @@ describe('mediaplane history', () => {
       schema: 'mediaplane.history/v1',
+      ok: true,
       records: [{ outcome: 'success', changes: { files: 5, containers: 4, secrets: 4 } }],
@@ -2537,2 +2585,29 @@ describe('mediaplane history', () => {
 
+  it("says a record it can't read is there, unread, rather than missing", async () => {
+    const home = await makeHome();
+    const docker = fakeDocker(home);
+    await run(['apply', '--home', home, '--yes'], capture().io, deps(docker));
+    const [name = ''] = await readdir(join(home, 'state', 'history'));
+    const path = join(home, 'state', 'history', name);
+    // As a later release writes it: a value this one doesn't know.
+    const later = (await readFile(path, 'utf8')).replace(
+      '"outcome": "success"',
+      '"outcome": "partial"',
+    );
+    await writeFile(path, later);
+    const id = name.replace(/\.json$/, '');
+    const json = capture();
+    expect(
+      await run(['history', id, '--home', home, '--json'], json.io, deps(docker)),
+    ).toBe(1);
+    expect(JSON.parse(json.stdout())).toEqual({
+      schema: 'mediaplane.error/v1',
+      ok: false,
+      error: {
+        message: `change record "${id}" can't be read by this Mediaplane: a later release may have written it, or it is damaged; its file is left as it is`,
+      },
+    });
+    expect(await readFile(path, 'utf8')).toBe(later);
+  });
+
   it('fails for an unknown record, and says when there are none', async () => {
````

````diff
diff --git a/packages/cli/src/credentials.test.ts b/packages/cli/src/credentials.test.ts
index 1be9d8d..6e03e55 100644
--- a/packages/cli/src/credentials.test.ts
+++ b/packages/cli/src/credentials.test.ts
@@ -118,2 +118,3 @@ describe('mediaplane credentials', () => {
       schema: 'mediaplane.credentials/v1',
+      ok: true,
       username: 'admin',
@@ -295,3 +296,14 @@ describe('mediaplane credentials', () => {
       ok: false,
-      error: { message: 'the admin password has not been generated yet' },
+      error: {
+        message: 'the admin password has not been generated yet',
+        // Each with its code, for a script to act on.
+        diagnostics: [
+          {
+            severity: 'error',
+            code: 'credentials.not-yet',
+            message: 'the admin password has not been generated yet',
+            hint: 'run "mediaplane apply": it generates the password before it starts any app',
+          },
+        ],
+      },
     });
diff --git a/packages/cli/src/vpn-check.test.ts b/packages/cli/src/vpn-check.test.ts
index 28fba7e..70266ae 100644
--- a/packages/cli/src/vpn-check.test.ts
+++ b/packages/cli/src/vpn-check.test.ts
@@ -447,2 +447,11 @@ describe('mediaplane vpn-check', () => {
             "the egress check's URL must be an http or https URL with no user name or password",
+          diagnostics: [
+            {
+              severity: 'error',
+              code: 'vpn-check.bad-url',
+              message:
+                "the egress check's URL must be an http or https URL with no user name or password",
+              hint: 'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service such as https://1.1.1.1/cdn-cgi/trace, or unset it',
+            },
+          ],
         },
diff --git a/packages/engine/src/history/records.test.ts b/packages/engine/src/history/records.test.ts
index db69164..70de011 100644
--- a/packages/engine/src/history/records.test.ts
+++ b/packages/engine/src/history/records.test.ts
@@ -6,2 +6,3 @@ import {
   CHANGE_SCHEMA,
+  hasRecordFile,
   listRecords,
@@ -188,2 +189,18 @@ describe('history records', () => {
     expect(await readRecord(home, '20261009T094312Z-ffffffff')).toBeUndefined();
+    expect(await hasRecordFile(home, '20261009T094312Z-ffffffff')).toBe(false);
+  });
+
+  it("tells a record it can't read, which is there, from one that isn't", async () => {
+    const home = await tempDir('mediaplane-history-');
+    const id = '20261009T094312Z-00000006';
+    await mkdir(join(home, HISTORY_DIR), { recursive: true });
+    await writeFile(
+      join(home, HISTORY_DIR, `${id}.json`),
+      JSON.stringify({ ...record(id), outcome: 'partial' }),
+    );
+    expect(await readRecord(home, id)).toBeUndefined();
+    expect(await hasRecordFile(home, id)).toBe(true);
+    // Never a path out of the history folder, there or not.
+    await writeFile(join(home, STATE_DIR, 'stray.json'), '{}');
+    expect(await hasRecordFile(home, '../stray')).toBe(false);
   });
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm exec vitest run packages/cli/src/contract.test.ts packages/cli/src/run.test.ts packages/cli/src/credentials.test.ts packages/cli/src/vpn-check.test.ts packages/engine/src/history/records.test.ts`

Expected: FAIL. `contract.test.ts` and `run.test.ts` with `Cannot find module
'./contract'`; `credentials.test.ts` (no `ok`, no `diagnostics` in the error document) and
`vpn-check.test.ts` (no `diagnostics`) with `AssertionError: expected { … } to deeply
equal { … }`; `records.test.ts` with `TypeError: hasRecordFile is not a function`.
`pnpm typecheck` fails too (`Cannot find module './contract'`, and `has no exported member
'credentialsDocument'` and the like).

- [ ] **Step 3: Write the contract**

Create `packages/cli/src/contract.ts`:

````ts
import { z } from 'zod';

/**
 * The `--json` contract (spec §5.2, §9): each document the CLI prints, as a Zod schema.
 * The JSON Schemas in docs/reference/json/ and docs/reference/json.md are generated from
 * these (`pnpm docs:generate`), and contract.test.ts checks that each printer prints
 * exactly this, field for field. Within v1 a document only gains fields and values; a
 * field that changed meaning would be a v2.
 */

const text = (description: string) => z.string().describe(description);
const list = (description: string) => z.array(z.string()).describe(description);
const flag = (description: string) => z.boolean().describe(description);

/** A value of a managed field, as `stack.yaml`'s overrides hold it. */
const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const diagnosticJson = z
  .strictObject({
    severity: z
      .enum(['error', 'warning'])
      .describe('an error stopped the command; a warning did not'),
    code: text(
      'what it is, such as `config.unknown-key`: stable, for scripts to act on; the message is for people and may change',
    ),
    message: text('what is wrong, for people'),
    path: text('where in `stack.yaml`, such as `apps.qbittorrent.vpn`').optional(),
    hint: text('what to do about it').optional(),
  })
  .describe('a problem found');

const diagnostics = z
  .array(diagnosticJson)
  .describe('every error and warning, in the order found');

const fileJson = z.strictObject({
  path: text('relative to the Mediaplane home, such as `generated/compose.yaml`'),
  status: z.enum(['create', 'update', 'unchanged']),
  diff: text(
    'a unified diff from the file on disk; empty when the file is unchanged, or holds secrets',
  ),
  sensitive: flag(
    'it holds secrets: compared with the file on disk, never shown',
  ).optional(),
  prestart: flag(
    "written once, before the app's first start, and never updated",
  ).optional(),
});

const containerJson = z.strictObject({
  service: text('the Compose service, such as sonarr'),
  action: z.enum(['create', 'recreate', 'start', 'restart', 'remove', 'unchanged']),
});

const secretsJson = z
  .strictObject({
    generate: list('the secrets apply generates, by name, such as `sonarr.apiKey`'),
    recover: list(
      "the keys apply recovers from the apps' appdata, which `state/secrets.json` lacks",
    ),
    restore: list(
      "the keys apply puts back in their apps' own files, stopping each app first",
    ),
  })
  .describe('names only, never values');

const wiringJson = z.strictObject({
  resource: text(
    '`<app>.<resource>`, or `<app>` alone for an app Mediaplane only checks',
  ),
  action: z
    .enum(['create', 'update', 'adopt', 'unchanged', 'after-start', 'unknown', 'remove'])
    .describe(
      'adopt: the app holds it as wanted, and Mediaplane records it; after-start: checked once its app runs; unknown: Mediaplane could not ask the app (`reason` says why); remove: Mediaplane made it, and the stack no longer wants it',
    ),
  changes: list('the managed fields and secrets that differ, by name').optional(),
  reason: text('why it could not be checked').optional(),
});

const driftJson = z.strictObject({
  resource: text('`<app>.<resource>`, or `<app>` for an app that refuses its key'),
  kind: z
    .enum(['field', 'missing', 'secret', 'key', 'left'])
    .describe(
      "field: a managed field holds another value; missing: deleted in the app; secret: the app's own check refuses one of its secrets; key: an app refuses its own key, or a resource holds that key (`source`); left: Mediaplane made it, the stack no longer wants it, and the app still holds it",
    ),
  field: text('the managed field, for `field`').optional(),
  expected: scalar.describe('the value apply sets').optional(),
  applied: scalar
    .describe('the value Mediaplane applied, when `stack.yaml` has changed it since')
    .optional(),
  actual: scalar
    .nullable()
    .describe("what the app holds; null when Mediaplane can't read it (`unreadable`)")
    .optional(),
  unreadable: text("the shape Mediaplane can't read the value in").optional(),
  redacted: flag('`actual` or `unreadable` held a secret, shown as `***`').optional(),
  secret: text('the secret, or key, by name: never its value').optional(),
  since: text(
    'when drift found it, for a secret or key not checked again until apply sets it',
  ).optional(),
  source: text(
    'key: the app whose key the resource holds, which that app refuses',
  ).optional(),
  stays: text(
    'left: why apply leaves it in the app; without it, apply removes it',
  ).optional(),
});

const checkJson = z.strictObject({
  resource: text('`<app>.<resource>`'),
  secret: text('the secret, by name'),
  verdict: z.enum(['passed', 'refused', 'unchecked']),
  reason: text('why it was not checked').optional(),
  at: text(
    'when drift last checked it, for a verdict taken from then rather than checked again',
  ).optional(),
});

const bootstrapJson = z.strictObject({
  app: text('the app whose first-run setup apply finishes, such as jellyfin'),
  unpublished: flag('it starts with no published port until its setup is done'),
  again: flag(
    'present, and true, only when the setup signs in again with what you rotated (`--rotate plex.token`), published or not',
  ).optional(),
});

/** The plan, as `plan --json` prints it and apply's plan holds it. */
const planShape = {
  files: z.array(fileJson).describe('the files apply writes'),
  containers: z.array(containerJson).describe('what Compose does to each service'),
  secrets: secretsJson,
  unhealthy: list(
    'running apps whose health check has not passed yet, such as `sonarr (unhealthy)`: apply waits for them',
  ),
  wiring: z.array(wiringJson).describe('what apply does to each managed resource'),
  bootstrap: z.array(bootstrapJson).describe('the first-run setups apply finishes'),
};

export const planDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.plan/v1'),
    ok: flag('false when a diagnostic is an error: then nothing else is planned'),
    changed: flag('apply would change something; plan exits 2 then, and 0 when not'),
    ...planShape,
    drift: z
      .array(driftJson)
      .describe('what changed in the apps outside Mediaplane since it applied them'),
    checks: z
      .array(checkJson)
      .describe('how each secret of each resource was checked: names only'),
    diagnostics,
  })
  .describe('what apply would change: `mediaplane plan --json`');

const actionJson = z.strictObject({
  step: z.enum([
    'keys',
    'files',
    'pull',
    'ownership',
    'start',
    'bootstrap',
    'wire',
    'verify',
  ]),
  resource: text('the wire step names the resource, such as `sonarr.admin`').optional(),
  result: z.enum(['done', 'failed', 'skipped']),
  detail: text(
    'what it did, for people: a wire action says `created`, `updated`, `adopted`, `unchanged` or `removed`, and a skipped one why, such as why a planned removal stays; the first-run setup step says what it set up and published, and `signed in again to <app>`',
  ).optional(),
  error: text('why it failed').optional(),
});

export const applyDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.apply/v1'),
    ok: flag('the apply succeeded, or there was nothing to change; apply exits 0 then'),
    changed: flag('apply changed something on the host or in the apps'),
    outcome: z
      .enum(['success', 'failed', 'no-changes', 'cancelled', 'invalid'])
      .describe(
        'invalid: the plan failed, and nothing was changed; cancelled: nothing was changed',
      ),
    plan: z.strictObject(planShape).describe('the plan apply followed'),
    actions: z.array(actionJson).describe("each step's actions, in order"),
    recordId: z
      .string()
      .nullable()
      .describe('the change record written (`mediaplane history <id>`), or null'),
    diagnostics,
  })
  .describe('what apply did: `mediaplane apply --yes --json`');

export const driftDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.drift/v1'),
    ok: flag("false when drift couldn't look: an error diagnostic says why"),
    clear: flag(
      'nothing drifted, and every resource and secret was checked: drift exits 0 then, and 2 when not',
    ),
    drift: z.array(driftJson).describe('what changed in the apps outside Mediaplane'),
    checks: z.array(checkJson).describe('how each secret was checked: names only'),
    unchecked: z
      .array(
        z.strictObject({ resource: text('`<app>.<resource>`'), reason: text('why') }),
      )
      .describe("the resources drift couldn't look at"),
    diagnostics,
  })
  .describe('what changed in the apps outside Mediaplane: `mediaplane drift --json`');

export const keepDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.keep/v1'),
    ok: flag('something was kept; keep exits 0 then'),
    key: text('the override key, or the app key (`<app>.<key>`), as asked'),
    value: scalar
      .nullable()
      .describe(
        "the value kept, or `unmanaged` for a resource; null for an app's own key, which `state/secrets.json` keeps",
      ),
    holders: list(
      "an app's own key: the resources that hold the old one, which the next apply gives the kept one",
    ).optional(),
    line: text(
      'the line under `overrides:` that keeps it, as written, or for you to add: present once keep got as far as the line',
    ).optional(),
    written: flag(
      'keep wrote `line` into `stack.yaml`; false with `managed_by: external` (a `keep.external` warning), or when it could not',
    ).optional(),
    diagnostics,
  })
  .describe('what Keep mine kept: `mediaplane keep <path> --json`');

export const migrateDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.migrate/v1'),
    ok: flag('`stack.yaml` is now, or already was, the version this Mediaplane writes'),
    from: z
      .number()
      .describe('the version `stack.yaml` was, when it could be read')
      .optional(),
    to: z.number().describe('the version this Mediaplane writes'),
    changed: flag('`stack.yaml` was rewritten'),
    applied: list('what each migration step changed, in order'),
    text: text(
      'the file as it should be, when Mediaplane may not write it (`managed_by: external`)',
    ).optional(),
    diagnostics,
  })
  .describe('what migrate did: `mediaplane migrate --json`');

const summaryJson = z
  .strictObject({
    id: text('the change record, as `mediaplane history <id>` takes it'),
    startedAt: text('when the apply started, in ISO 8601'),
    durationMs: z.number().describe('how long it took'),
    outcome: z.enum(['success', 'failed']),
    changes: z
      .strictObject({
        files: z.number().describe('files written'),
        containers: z.number().describe('containers changed'),
        secrets: z.number().describe('secrets generated'),
        wiring: z.number().describe('resources the wire step changed in the apps'),
      })
      .describe('how much it changed'),
  })
  .describe('one apply, in short');

export const statusDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.status/v1'),
    ok: z.literal(true).describe('true: the containers were listed'),
    healthy: flag(
      'there are containers, and every one is running and passes its health check',
    ),
    containers: z
      .array(
        z.strictObject({
          service: text('the Compose service'),
          state: text('running, exited, created, …'),
          health: text('healthy, unhealthy, starting, or empty with no health check'),
          published: z
            .array(
              z.strictObject({
                address: text('the host address'),
                port: z.number(),
                protocol: z.enum(['tcp', 'udp']),
              }),
            )
            .describe('where its ports are published on the host'),
        }),
      )
      .describe("the stack's containers, sorted by service"),
    lastApply: summaryJson.nullable().describe('the last apply, or null if none has run'),
    historyError: text(
      "why the change history couldn't be read; the containers are listed all the same",
    ).optional(),
  })
  .describe("each app's container, and the last apply: `mediaplane status [app] --json`");

export const historyDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.history/v1'),
    ok: z.literal(true).describe('true: the records were listed'),
    records: z.array(summaryJson).describe('every change record, newest first'),
    unreadable: list(
      "the files in `state/history/` this Mediaplane can't read: a later release's, or damaged",
    ),
  })
  .describe('the change records: `mediaplane history --json`');

export const changeDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.change/v1'),
    id: z
      .string()
      .regex(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
      .describe('the record, such as `20261009T094312Z-a1b2c3d4`'),
    trigger: z.literal('cli'),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    durationMs: z.int().min(0),
    outcome: z.enum(['success', 'failed']),
    stackSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('the SHA-256 of `stack.yaml` as applied'),
    plan: z
      .strictObject({
        files: z.array(
          z.strictObject({
            path: text('relative to the Mediaplane home'),
            status: z.enum(['create', 'update', 'unchanged']),
          }),
        ),
        containers: z.array(containerJson),
        secrets: z
          .strictObject({
            generate: list('the secrets generated, by name'),
            recover: list("the keys recovered from the apps' appdata").optional(),
            restore: list("the keys put back in their apps' own files").optional(),
          })
          .describe('names only, never values'),
        wiring: z.array(wiringJson).optional(),
        bootstrap: z.array(bootstrapJson).optional(),
      })
      .describe('the plan the apply followed, without its diffs'),
    actions: z.array(actionJson),
    ok: z.literal(true).describe('true: the record was read'),
  })
  .describe(
    "one change record, as this release knows it: `mediaplane history <id> --json`. A later release's record shows only these fields; the rest stay in its file",
  );

/** What every app's login says: which app, and where its web UI is. */
const loginShape = {
  app: text('the app, such as sonarr'),
  name: text('its name, such as Sonarr'),
  urls: list('where its web UI is published: one URL per address'),
};

export const credentialsDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.credentials/v1'),
    ok: z.literal(true).describe('true: the login was found'),
    username: text('the shared admin user name'),
    password: z
      .string()
      .nullable()
      .describe('the shared admin password with `--reveal`; null without it'),
    passwordSource: z
      .enum(['generated', 'yours'])
      .describe("generated: Mediaplane's; yours: from `admin.password`"),
    apps: z
      .array(
        z.discriminatedUnion('login', [
          z.strictObject({
            ...loginShape,
            login: z.literal('shared').describe('signs in with the shared admin'),
          }),
          z.strictObject({
            ...loginShape,
            login: z.literal('own').describe('signs in with an account of its own'),
            account: text('whose account, such as Plex'),
          }),
          z.strictObject({
            ...loginShape,
            login: z.literal('not-yet').describe('its login is still to come'),
            comingIn: text('when it comes'),
          }),
        ]),
      )
      .describe('each app with a web login'),
  })
  .describe(
    "the shared admin login, and each app's web address: `mediaplane credentials [app] --json`",
  );

export const vpnCheckDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.vpn-check/v1'),
    ok: z.literal(true).describe('true: the check ran; verdict says what it found'),
    verdict: z
      .enum(['pass', 'leak', 'down'])
      .describe('pass exits 0; leak and down exit 1'),
    checks: z
      .array(
        z.strictObject({
          id: z.enum(['network', 'gluetun', 'control', 'control-key', 'route', 'egress']),
          status: z.enum(['ok', 'warning', 'down', 'leak']),
          message: text('what it found, for people'),
          hint: text('what to do about it').optional(),
        }),
      )
      .describe('each check, in order'),
    egress: z
      .strictObject({
        url: text('the IP-echo service asked'),
        vpn: z.string().nullable().describe("qBittorrent's address, or null"),
        host: z.string().nullable().describe("this host's address, or null"),
      })
      .nullable()
      .describe('the addresses compared; null with --no-egress'),
    gluetunPublicIp: z
      .string()
      .nullable()
      .describe('the address Gluetun reports for itself, or null'),
    failClosed: flag(
      "qBittorrent was shown to be in Gluetun's network, and nothing can get out around the VPN",
    ),
  })
  .describe(
    'whether qBittorrent reaches the internet only through the VPN: `mediaplane vpn-check --json`',
  );

export const plexLoginDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.plex-login/v1'),
    ok: z.literal(true).describe('true: a token that works is saved'),
    saved: text('the file the token is saved in: never the token'),
    signedIn: flag('you signed in now; false when the saved token works already'),
    replaced: flag('it replaced another token: run `apply --rotate plex.token` next'),
  })
  .describe('your Plex sign-in: `mediaplane plex-login --json`; the link goes to stderr');

export const initDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.init/v1'),
    ok: z.literal(true).describe('true: stack.yaml was written'),
    stackPath: text('the `stack.yaml` written'),
    next: list('what to do next, for people, in order'),
  })
  .describe('the starter `stack.yaml`: `mediaplane init --json`');

export const errorDocumentJson = z
  .strictObject({
    schema: z.literal('mediaplane.error/v1'),
    ok: z.literal(false),
    error: z.strictObject({
      message: text('what went wrong, for people'),
      diagnostics: z
        .array(diagnosticJson)
        .describe('the diagnostics that stopped the command, when it has them')
        .optional(),
    }),
  })
  .describe(
    'a command that stopped before it could print its own document: a usage error, a missing `stack.yaml` for credentials or vpn-check, Docker out of reach',
  );

/**
 * What the hidden commands print: the answers of Mediaplane's own helper containers to
 * Mediaplane (host-report, plex-tv), not for scripts, so not in the contract.
 */
export const INTERNAL_SCHEMAS: readonly string[] = [
  'mediaplane.host-report/v1',
  'mediaplane.plex-tv/v1',
];

/** One --json document: the schema it names, who prints it, and its shape. */
export interface JsonDocument {
  /** mediaplane.<name>/v1 */
  schema: string;
  /** Its file in docs/reference/json/. */
  file: string;
  shape: z.ZodType;
}

export const DOCUMENTS: readonly JsonDocument[] = [
  planDocumentJson,
  applyDocumentJson,
  driftDocumentJson,
  keepDocumentJson,
  migrateDocumentJson,
  statusDocumentJson,
  historyDocumentJson,
  changeDocumentJson,
  credentialsDocumentJson,
  vpnCheckDocumentJson,
  plexLoginDocumentJson,
  initDocumentJson,
  errorDocumentJson,
].map((shape) => {
  const schema = shape.shape.schema.value;
  const name = /^mediaplane\.([a-z-]+)\/v1$/.exec(schema)?.[1] ?? schema;
  return { schema, file: `${name}.schema.json`, shape };
});

/**
 * Check one printed document against the contract, by its `schema`, strictly: a field the
 * contract doesn't document fails, as one it documents of another type does. Returns its
 * schema; throws naming the paths that don't fit, never their values.
 */
export function checkDocument(document: unknown): string {
  const schema =
    typeof document === 'object' && document !== null && 'schema' in document
      ? String(document.schema)
      : '';
  const known = DOCUMENTS.find((d) => d.schema === schema);
  if (known === undefined) throw new Error(`no documented --json schema "${schema}"`);
  const checked = known.shape.safeParse(document);
  if (!checked.success) {
    const paths = checked.error.issues.map(
      (issue) =>
        `${issue.path.join('.') || '(document)'}${issue.code === 'unrecognized_keys' ? ` ${issue.keys.join(', ')}` : ''}: ${issue.code}`,
    );
    throw new Error(
      `${schema} does not match its documented schema: ${paths.join('; ')}`,
    );
  }
  return schema;
}

/** Each JSON document in what a command printed, in order: none in a human's output. */
export function documentsIn(stdout: string): unknown[] {
  if (!stdout.startsWith('{')) return [];
  return stdout
    .split(/(?<=^\}\n)/m)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => JSON.parse(chunk) as unknown);
}
````

- [ ] **Step 4: Build each document in one function, and print that**

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 6bf8e57..d7f2f43 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -24,10 +24,16 @@ import type { Io } from './run';
 
-export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';
-export const ERROR_JSON_SCHEMA = 'mediaplane.error/v1';
-export const APPLY_JSON_SCHEMA = 'mediaplane.apply/v1';
-export const STATUS_JSON_SCHEMA = 'mediaplane.status/v1';
-export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1';
-export const DRIFT_JSON_SCHEMA = 'mediaplane.drift/v1';
-export const KEEP_JSON_SCHEMA = 'mediaplane.keep/v1';
-export const MIGRATE_JSON_SCHEMA = 'mediaplane.migrate/v1';
+// `as const`, so that a document's `schema` keeps its literal type (contract.test.ts).
+export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1' as const;
+export const ERROR_JSON_SCHEMA = 'mediaplane.error/v1' as const;
+export const APPLY_JSON_SCHEMA = 'mediaplane.apply/v1' as const;
+export const STATUS_JSON_SCHEMA = 'mediaplane.status/v1' as const;
+export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1' as const;
+export const DRIFT_JSON_SCHEMA = 'mediaplane.drift/v1' as const;
+export const KEEP_JSON_SCHEMA = 'mediaplane.keep/v1' as const;
+export const MIGRATE_JSON_SCHEMA = 'mediaplane.migrate/v1' as const;
+
+/** One --json document, as the CLI prints it: indented, on one line of its own. */
+export function printJson(document: unknown, io: Io): void {
+  io.stdout(`${JSON.stringify(document, null, 2)}\n`);
+}
 
@@ -134,3 +140,3 @@ export function formatDiagnostic(diagnostic: Diagnostic): string {
  * Diagnostics that stopped a command: each as an error line with its hint, or, with
- * --json, one error envelope that joins their messages.
+ * --json, one error envelope that joins their messages, and holds each with its code.
  */
@@ -142,3 +148,3 @@ export function printDiagnostics(
   if (options.json) {
-    printError(diagnostics.map((d) => d.message).join('; '), options, io);
+    printError(diagnostics.map((d) => d.message).join('; '), options, io, diagnostics);
     return;
@@ -148,7 +154,22 @@ export function printDiagnostics(
 
-export function printError(message: string, options: { json: boolean }, io: Io): void {
+/** `mediaplane.error/v1`: why a command stopped, with the diagnostics that stopped it. */
+export function errorDocument(message: string, diagnostics?: readonly Diagnostic[]) {
+  return {
+    schema: ERROR_JSON_SCHEMA,
+    ok: false as const,
+    error: {
+      message,
+      ...(diagnostics === undefined ? {} : { diagnostics: [...diagnostics] }),
+    },
+  };
+}
+
+export function printError(
+  message: string,
+  options: { json: boolean },
+  io: Io,
+  diagnostics?: readonly Diagnostic[],
+): void {
   if (options.json) {
-    io.stdout(
-      `${JSON.stringify({ schema: ERROR_JSON_SCHEMA, ok: false, error: { message } }, null, 2)}\n`,
-    );
+    printJson(errorDocument(message, diagnostics), io);
     return;
@@ -158,8 +179,11 @@ export function printError(message: string, options: { json: boolean }, io: Io):
 
+/** `mediaplane.plan/v1`: the plan, without the files' contents. */
+export function planDocument(result: PlanResult) {
+  const files = result.files.map(({ content, ...file }) => file);
+  return { schema: PLAN_JSON_SCHEMA, ...result, files };
+}
+
 export function printPlan(result: PlanResult, options: { json: boolean }, io: Io): void {
   if (options.json) {
-    const files = result.files.map(({ content, ...file }) => file);
-    io.stdout(
-      `${JSON.stringify({ schema: PLAN_JSON_SCHEMA, ...result, files }, null, 2)}\n`,
-    );
+    printJson(planDocument(result), io);
     return;
@@ -244,2 +268,7 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
 
+/** `mediaplane.drift/v1`. */
+export function driftDocument(result: DriftResult) {
+  return { schema: DRIFT_JSON_SCHEMA, ...result };
+}
+
 /**
@@ -254,3 +283,3 @@ export function printDrift(
   if (options.json) {
-    io.stdout(`${JSON.stringify({ schema: DRIFT_JSON_SCHEMA, ...result }, null, 2)}\n`);
+    printJson(driftDocument(result), io);
     return;
@@ -311,2 +340,7 @@ export function printDrift(
 
+/** `mediaplane.keep/v1`: `value` is null where nothing was kept, or a key was. */
+export function keepDocument(result: KeepResult) {
+  return { schema: KEEP_JSON_SCHEMA, ...result, value: result.value ?? null };
+}
+
 /** What `mediaplane keep` kept, or why it kept nothing. */
@@ -314,5 +348,3 @@ export function printKeep(result: KeepResult, options: { json: boolean }, io: Io
   if (options.json) {
-    io.stdout(
-      `${JSON.stringify({ schema: KEEP_JSON_SCHEMA, ...result, value: result.value ?? null }, null, 2)}\n`,
-    );
+    printJson(keepDocument(result), io);
     return;
@@ -358,2 +390,7 @@ export function printKeep(result: KeepResult, options: { json: boolean }, io: Io
 
+/** `mediaplane.migrate/v1`. */
+export function migrateDocument(result: MigrateResult) {
+  return { schema: MIGRATE_JSON_SCHEMA, ...result };
+}
+
 /** What `mediaplane migrate` rewrote, or why it didn't, with the file as it should be. */
@@ -365,3 +402,3 @@ export function printMigrate(
   if (options.json) {
-    io.stdout(`${JSON.stringify({ schema: MIGRATE_JSON_SCHEMA, ...result }, null, 2)}\n`);
+    printJson(migrateDocument(result), io);
     return;
@@ -470,2 +507,24 @@ function changedSomething(action: ActionResult): boolean {
 
+/** `mediaplane.apply/v1`: the outcome, the plan it followed, and each action. */
+export function applyDocument(result: ApplyResult) {
+  const { files, containers, secrets, unhealthy, wiring, bootstrap } = result.plan;
+  return {
+    schema: APPLY_JSON_SCHEMA,
+    ok: result.outcome === 'success' || result.outcome === 'no-changes',
+    changed: result.actions.some(changedSomething),
+    outcome: result.outcome,
+    plan: {
+      files: files.map(({ content, ...file }) => file),
+      containers,
+      secrets,
+      unhealthy,
+      wiring,
+      bootstrap,
+    },
+    actions: result.actions,
+    recordId: result.recordId ?? null,
+    diagnostics: result.diagnostics,
+  };
+}
+
 export function printApply(
@@ -476,26 +535,3 @@ export function printApply(
   if (options.json) {
-    const { files, containers, secrets, unhealthy, wiring, bootstrap } = result.plan;
-    io.stdout(
-      `${JSON.stringify(
-        {
-          schema: APPLY_JSON_SCHEMA,
-          ok: result.outcome === 'success' || result.outcome === 'no-changes',
-          changed: result.actions.some(changedSomething),
-          outcome: result.outcome,
-          plan: {
-            files: files.map(({ content, ...file }) => file),
-            containers,
-            secrets,
-            unhealthy,
-            wiring,
-            bootstrap,
-          },
-          actions: result.actions,
-          recordId: result.recordId ?? null,
-          diagnostics: result.diagnostics,
-        },
-        null,
-        2,
-      )}\n`,
-    );
+    printJson(applyDocument(result), io);
     return;
@@ -569,2 +605,21 @@ function summary(record: ChangeRecord) {
 
+/** `mediaplane.status/v1`. */
+export function statusDocument(result: StatusResult) {
+  return {
+    schema: STATUS_JSON_SCHEMA,
+    ok: true as const,
+    healthy:
+      result.containers.length > 0 && unhealthyServices(result.containers).length === 0,
+    containers: result.containers.map(({ service, state, health, published }) => ({
+      service,
+      state,
+      health,
+      published,
+    })),
+    lastApply: result.lastApply === undefined ? null : summary(result.lastApply),
+    // Only present when state/history could not be read.
+    ...(result.historyError === undefined ? {} : { historyError: result.historyError }),
+  };
+}
+
 export function printStatus(
@@ -575,23 +630,3 @@ export function printStatus(
   if (options.json) {
-    io.stdout(
-      `${JSON.stringify(
-        {
-          schema: STATUS_JSON_SCHEMA,
-          healthy:
-            result.containers.length > 0 &&
-            unhealthyServices(result.containers).length === 0,
-          containers: result.containers.map(({ service, state, health, published }) => ({
-            service,
-            state,
-            health,
-            published,
-          })),
-          lastApply: result.lastApply === undefined ? null : summary(result.lastApply),
-          // Only present when state/history could not be read.
-          historyError: result.historyError,
-        },
-        null,
-        2,
-      )}\n`,
-    );
+    printJson(statusDocument(result), io);
     return;
@@ -626,2 +661,12 @@ export function printStatus(
 
+/** `mediaplane.history/v1`: each record, in short. */
+export function historyDocument(list: { records: ChangeRecord[]; unreadable: string[] }) {
+  return {
+    schema: HISTORY_JSON_SCHEMA,
+    ok: true as const,
+    records: list.records.map(summary),
+    unreadable: list.unreadable,
+  };
+}
+
 export function printHistory(
@@ -632,13 +677,3 @@ export function printHistory(
   if (options.json) {
-    io.stdout(
-      `${JSON.stringify(
-        {
-          schema: HISTORY_JSON_SCHEMA,
-          records: list.records.map(summary),
-          unreadable: list.unreadable,
-        },
-        null,
-        2,
-      )}\n`,
-    );
+    printJson(historyDocument(list), io);
     return;
@@ -665,2 +700,10 @@ export function printHistory(
 
+/**
+ * `mediaplane.change/v1`: the record as this release reads it, so a later release's shows
+ * only the fields this one knows; and `ok`, as every document has.
+ */
+export function recordDocument(record: ChangeRecord) {
+  return { ...record, ok: true as const };
+}
+
 export function printRecord(
@@ -671,3 +714,3 @@ export function printRecord(
   if (options.json) {
-    io.stdout(`${JSON.stringify(record, null, 2)}\n`);
+    printJson(recordDocument(record), io);
     return;
````

````diff
diff --git a/packages/cli/src/credentials.ts b/packages/cli/src/credentials.ts
index 7936134..0c59a4c 100644
--- a/packages/cli/src/credentials.ts
+++ b/packages/cli/src/credentials.ts
@@ -1,6 +1,25 @@
 import type { AppLogin, CredentialsResult } from '@mediaplane/engine';
-import { printDiagnostics, printError } from './output';
+import { printDiagnostics, printError, printJson } from './output';
 import type { Io } from './run';
 
-export const CREDENTIALS_JSON_SCHEMA = 'mediaplane.credentials/v1';
+export const CREDENTIALS_JSON_SCHEMA = 'mediaplane.credentials/v1' as const;
+
+/**
+ * `mediaplane.credentials/v1`: the shared login, its password only with `reveal`, and
+ * each app's login.
+ */
+export function credentialsDocument(
+  result: Extract<CredentialsResult, { ok: true }>,
+  apps: AppLogin[],
+  reveal: boolean,
+) {
+  return {
+    schema: CREDENTIALS_JSON_SCHEMA,
+    ok: true as const,
+    username: result.username,
+    password: reveal ? result.password : null,
+    passwordSource: result.source.kind,
+    apps,
+  };
+}
 
@@ -28,10 +47,3 @@ export function printCredentials(
   if (options.json) {
-    const shown = {
-      schema: CREDENTIALS_JSON_SCHEMA,
-      username: result.username,
-      password: options.reveal ? result.password : null,
-      passwordSource: result.source.kind,
-      apps,
-    };
-    io.stdout(`${JSON.stringify(shown, null, 2)}\n`);
+    printJson(credentialsDocument(result, apps, options.reveal), io);
     return 0;
diff --git a/packages/cli/src/init.ts b/packages/cli/src/init.ts
index 49ee9f9..48c34a2 100644
--- a/packages/cli/src/init.ts
+++ b/packages/cli/src/init.ts
@@ -20,3 +20,3 @@ import {
 import { dataSteps, exists, homeProblem, type DataFolder } from './folders';
-import { printDiagnostics, printError } from './output';
+import { printDiagnostics, printError, printJson } from './output';
 import { PromptCancelled } from './prompt';
@@ -24,3 +24,8 @@ import type { Io } from './run';
 
-export const INIT_JSON_SCHEMA = 'mediaplane.init/v1';
+export const INIT_JSON_SCHEMA = 'mediaplane.init/v1' as const;
+
+/** `mediaplane.init/v1`: the stack.yaml written, and what to do next. */
+export function initDocument(stackPath: string, next: string[]) {
+  return { schema: INIT_JSON_SCHEMA, ok: true as const, stackPath, next };
+}
 
@@ -134,5 +139,3 @@ export async function init(
   if (asJson) {
-    io.stdout(
-      `${JSON.stringify({ schema: INIT_JSON_SCHEMA, ok: true, stackPath, next: next('ask') }, null, 2)}\n`,
-    );
+    printJson(initDocument(stackPath, next('ask')), io);
     return 0;
diff --git a/packages/cli/src/plex-login.ts b/packages/cli/src/plex-login.ts
index c58e2c2..1148f7d 100644
--- a/packages/cli/src/plex-login.ts
+++ b/packages/cli/src/plex-login.ts
@@ -12,6 +12,6 @@ import {
 } from '@mediaplane/engine';
-import { printDiagnostics, printError } from './output';
+import { printDiagnostics, printError, printJson } from './output';
 import type { Io } from './run';
 
-export const PLEX_LOGIN_JSON_SCHEMA = 'mediaplane.plex-login/v1';
+export const PLEX_LOGIN_JSON_SCHEMA = 'mediaplane.plex-login/v1' as const;
 
@@ -235,2 +235,17 @@ function duration(seconds: number): string {
 
+/** `mediaplane.plex-login/v1`: where the token is saved, never the token. */
+export function plexLoginDocument(result: {
+  saved: string;
+  signedIn: boolean;
+  replaced: boolean;
+}) {
+  return {
+    schema: PLEX_LOGIN_JSON_SCHEMA,
+    ok: true as const,
+    saved: result.saved,
+    signedIn: result.signedIn,
+    replaced: result.replaced,
+  };
+}
+
 function report(
@@ -241,15 +256,3 @@ function report(
   if (options.json) {
-    io.stdout(
-      `${JSON.stringify(
-        {
-          schema: PLEX_LOGIN_JSON_SCHEMA,
-          ok: true,
-          saved: result.saved,
-          signedIn: result.signedIn,
-          replaced: result.replaced,
-        },
-        null,
-        2,
-      )}\n`,
-    );
+    printJson(plexLoginDocument(result), io);
     return;
diff --git a/packages/cli/src/vpn-check.ts b/packages/cli/src/vpn-check.ts
index 65b8519..9109bec 100644
--- a/packages/cli/src/vpn-check.ts
+++ b/packages/cli/src/vpn-check.ts
@@ -1,6 +1,19 @@
 import { VPN_RUNBOOK, type VpnCheckItem, type VpnCheckResult } from '@mediaplane/engine';
-import { printDiagnostics } from './output';
+import { printDiagnostics, printJson } from './output';
 import type { Io } from './run';
 
-export const VPN_CHECK_JSON_SCHEMA = 'mediaplane.vpn-check/v1';
+export const VPN_CHECK_JSON_SCHEMA = 'mediaplane.vpn-check/v1' as const;
+
+/** `mediaplane.vpn-check/v1`: what the check found, which ran. */
+export function vpnCheckDocument(result: Extract<VpnCheckResult, { ok: true }>) {
+  return {
+    schema: VPN_CHECK_JSON_SCHEMA,
+    ok: result.ok,
+    verdict: result.verdict,
+    checks: result.checks,
+    egress: result.egress,
+    gluetunPublicIp: result.gluetunPublicIp,
+    failClosed: result.failClosed,
+  };
+}
 
@@ -30,12 +43,3 @@ export function printVpnCheck(
   if (options.json) {
-    const shown = {
-      schema: VPN_CHECK_JSON_SCHEMA,
-      ok: result.ok,
-      verdict: result.verdict,
-      checks: result.checks,
-      egress: result.egress,
-      gluetunPublicIp: result.gluetunPublicIp,
-      failClosed: result.failClosed,
-    };
-    io.stdout(`${JSON.stringify(shown, null, 2)}\n`);
+    printJson(vpnCheckDocument(result), io);
     return code;
````

A usage error under `--json` prints the error document; a record there but unread says
so:

````diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index e81cdf0..0026b0f 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -13,2 +13,3 @@ import {
   fetchEgress,
+  hasRecordFile,
   helperEgress,
@@ -473,3 +474,5 @@ export function createProgram(
         printError(
-          `no change record "${id}"; run "mediaplane history" to list them`,
+          (await hasRecordFile(home, id))
+            ? `change record "${id}" can't be read by this Mediaplane: a later release may have written it, or it is damaged; its file is left as it is`
+            : `no change record "${id}"; run "mediaplane history" to list them`,
           { json: asJson },
@@ -687,3 +690,10 @@ export async function run(
   } catch (cause) {
-    if (cause instanceof CommanderError) return cause.exitCode;
+    if (cause instanceof CommanderError) {
+      // A usage error, such as an unknown option: Commander has said so on stderr. With
+      // --json, a script gets its document on stdout too, as from every other failure.
+      if (json && cause.exitCode !== 0) {
+        printError(cause.message.replace(/^error: /, ''), { json }, io);
+      }
+      return cause.exitCode;
+    }
     // Anything else (an unreadable stack.yaml, an unsupported CPU) is described, not crashed on.
````

````diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index 9cc2161..1bb62a4 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -7,3 +7,3 @@ import type { RandomBytes } from '../secrets/generate';
 import { ensureDir, writeFileAtomic } from '../util/atomic';
-import { readIfExists } from '../util/fs';
+import { fileKind, readIfExists } from '../util/fs';
 import { compare } from '../util/sort';
@@ -207,2 +207,12 @@ export async function readRecord(
 
+/**
+ * Whether state/history holds something for record `id`, read or not: readRecord gives
+ * undefined for a record this release can't read too, such as a later release's that
+ * holds a value this one doesn't know.
+ */
+export async function hasRecordFile(home: string, id: string): Promise<boolean> {
+  if (!RECORD_ID.test(id)) return false;
+  return (await fileKind(join(home, HISTORY_DIR, `${id}.json`))) !== 'missing';
+}
+
 /** The record in this file, or undefined if it can't be read (EACCES, EISDIR, gone) or parsed. */
````

- [ ] **Step 5: Run them, and see them pass**

Run the command of Step 2, then `pnpm typecheck`.

Expected: PASS, and no type error: each printer prints exactly its documented type.

- [ ] **Step 6: The full check, and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass (no generated doc changes yet).

```bash
git add -A
git commit -m "feat(cli): pin the --json contract: one documented shape per document, and ok on each" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The generated `--json` reference, the docs link check, and the published docs' address

Decisions 4, 7, 8.

**Files:**

- Create: `scripts/docs/json-reference.ts`, `scripts/docs/links.ts`, and their tests;
  `packages/engine/src/runbooks.test.ts`
- Change: `packages/cli/src/contract.ts` (`CODES`), `packages/engine/src/runbooks.ts`,
  `packages/engine/src/config/load.ts`, `packages/cli/src/run.ts`, `scripts/docs.ts`,
  `scripts/docs/cli-reference.ts`, `package.json` and `pnpm-lock.yaml` (Zod, for the
  docs and the end-to-end tests)
- Test: `packages/cli/src/contract.test.ts`, `packages/cli/src/run.test.ts`,
  `packages/engine/src/config/load.test.ts`, `scripts/docs/cli-reference.test.ts`
- Generated: `docs/reference/json.md`, `docs/reference/json/*.schema.json` (new),
  `docs/reference/cli.md`

**Interfaces:**

- Consumes: Task 1's `DOCUMENTS`, `JsonDocument`, `errorDocument`.
- Produces: `CODES: readonly { code: string; meaning: string }[]` (contract.ts);
  `DOCS_URL`, `docsUrl(path: string): string` (engine, `runbooks.ts`, exported from
  `@mediaplane/engine`); `JSON_SCHEMA_BASE`, `documentJsonSchema(document: JsonDocument):
  Record<string, unknown>`, `renderJsonReference(): string`
  (`scripts/docs/json-reference.ts`); `brokenLinks(root: string): Promise<string[]>`,
  `withoutCode(text: string, inline: boolean): string`, `linkTarget(root, file, target):
  string | undefined` (`scripts/docs/links.ts`).

- [ ] **Step 1: Give the root Zod, and write the failing tests**

The docs' and the end-to-end tests' JSON Schemas are read with Zod:

````diff
diff --git a/package.json b/package.json
index bc185d2..1e46ee6 100644
--- a/package.json
+++ b/package.json
@@ -36,3 +36,4 @@
     "vitest": "^4.1.11",
-    "yaml": "^2.9.1"
+    "yaml": "^2.9.1",
+    "zod": "^4.6.5"
   }
````

Run `pnpm install`. It adds these lines to `pnpm-lock.yaml`, shown here, with nothing to apply:

````diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index c93af0b..d47fa87 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -49,2 +49,5 @@ importers:
         version: 2.9.1
+      zod:
+        specifier: ^4.6.5
+        version: 4.6.5
 
````

````diff
diff --git a/packages/cli/src/contract.test.ts b/packages/cli/src/contract.test.ts
index 5b05df8..edfaa17 100644
--- a/packages/cli/src/contract.test.ts
+++ b/packages/cli/src/contract.test.ts
@@ -1 +1,4 @@
+import { readdir, readFile } from 'node:fs/promises';
+import { join } from 'node:path';
+import { fileURLToPath } from 'node:url';
 import { changeRecordSchema } from '@mediaplane/engine';
@@ -7,2 +10,3 @@ import {
   checkDocument,
+  CODES,
   credentialsDocumentJson,
@@ -120,2 +124,20 @@ describe('the --json contract', () => {
 
+  it('lists only diagnostic codes that a test pins in the code that gives them', async () => {
+    const root = fileURLToPath(new URL('../../..', import.meta.url));
+    const tests: string[] = [];
+    for (const dir of ['packages', 'catalog']) {
+      for (const entry of await readdir(join(root, dir), { recursive: true })) {
+        if (entry.endsWith('.test.ts') && !entry.includes('node_modules')) {
+          tests.push(await readFile(join(root, dir, entry), 'utf8'));
+        }
+      }
+    }
+    for (const { code } of CODES) {
+      expect(
+        tests.some((test) => test.includes(`'${code}'`)),
+        `no test pins ${code}`,
+      ).toBe(true);
+    }
+  });
+
   it('finds each document a capture printed, one after the other', () => {
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 2da2645..47becb0 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -2052,2 +2052,14 @@ apps:
     );
+    const json = capture();
+    expect(
+      await run(
+        ['plan', '--home', home, '--rotate', 'plex.token', '--json'],
+        json.io,
+        deps(fakeDocker(home)),
+      ),
+    ).toBe(1);
+    expect(JSON.parse(json.stdout())).toMatchObject({
+      ok: false,
+      diagnostics: [{ severity: 'error', code: 'rotate.no-plex' }],
+    });
   });
@@ -2714,3 +2726,3 @@ describe('--help', () => {
     expect(said).toContain(
-      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see docs/security/threat-model.md)",
+      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/security/threat-model.md)",
     );
@@ -2719,2 +2731,15 @@ describe('--help', () => {
 
+  // Someone running the image has no copy of the repo, so no path in it.
+  it('points plan and drift at the published threat model', async () => {
+    for (const command of ['plan', 'drift']) {
+      const term = capture();
+      expect(await run([command, '--help'], term.io)).toBe(0);
+      const said = term.stdout().replaceAll(/\s+/g, ' ');
+      expect(said).toContain(
+        '(see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/security/threat-model.md)',
+      );
+      expect(said).not.toContain('see docs/');
+    }
+  });
+
   it("lists each command's exit codes", async () => {
diff --git a/packages/engine/src/config/load.test.ts b/packages/engine/src/config/load.test.ts
index 8ab60ac..dfbcb3f 100644
--- a/packages/engine/src/config/load.test.ts
+++ b/packages/engine/src/config/load.test.ts
@@ -425,6 +425,13 @@ describe('parseConfig: versions (spec §5 step 2)', () => {
 describe('loadConfigFile', () => {
-  it('explains a missing file', async () => {
-    expect(await loadConfigFile('/nonexistent/mediaplane/stack.yaml')).toMatchObject({
+  it('explains a missing file, pointing at the published reference', async () => {
+    expect(await loadConfigFile('/nonexistent/mediaplane/stack.yaml')).toEqual({
       ok: false,
-      diagnostics: [{ code: 'config.missing' }],
+      diagnostics: [
+        {
+          severity: 'error',
+          code: 'config.missing',
+          message: 'no stack.yaml at /nonexistent/mediaplane/stack.yaml',
+          hint: 'run "mediaplane init" to write one, or pass --home with the Mediaplane home; its format: https://github.com/cyclopsgd/Mediaplane/blob/main/docs/reference/stack-yaml.md',
+        },
+      ],
     });
diff --git a/scripts/docs/cli-reference.test.ts b/scripts/docs/cli-reference.test.ts
index a6558e5..5a43ecb 100644
--- a/scripts/docs/cli-reference.test.ts
+++ b/scripts/docs/cli-reference.test.ts
@@ -26,2 +26,11 @@ describe('renderCliReference', () => {
 
+  // Someone running the image has no copy of the repo: help names the published docs.
+  it('names a doc by its published address, never by its path in the repo', () => {
+    expect(text).toContain(
+      'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/security/threat-model.md',
+    );
+    expect(text).not.toMatch(/(?<!blob\/main\/)docs\//);
+    expect(text).toContain('[`--json` reference](json.md)');
+  });
+
   it("leaves out the host helper's command, and nothing in it depends on this machine", () => {
````

Create `packages/engine/src/runbooks.test.ts`:

````ts
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { docsUrl, DOCS_URL, runbookUrl, type Runbook } from './runbooks';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

describe('docsUrl', () => {
  it("is the doc's address on GitHub, for a page that is in docs/", async () => {
    expect(docsUrl('reference/stack-yaml.md')).toBe(
      'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/reference/stack-yaml.md',
    );
    const runbooks: Runbook[] = [
      'app-wont-start',
      'drift-reported',
      'rebuilding-a-host',
      'vpn-down',
      'wiring-failed',
    ];
    for (const url of [
      ...runbooks.map(runbookUrl),
      docsUrl('reference/stack-yaml.md'),
      docsUrl('security/threat-model.md'),
    ]) {
      const path = url.replace(`${DOCS_URL}/`, 'docs/');
      expect((await stat(`${REPO}${path}`)).isFile(), path).toBe(true);
    }
  });
});
````

Create `scripts/docs/json-reference.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOCUMENTS } from '../../packages/cli/src/contract';
import { errorDocument } from '../../packages/cli/src/output';
import { documentJsonSchema, renderJsonReference } from './json-reference';

describe('renderJsonReference', () => {
  const text = renderJsonReference();

  it('documents every document, its fields and their types, nested', () => {
    for (const { schema, file } of DOCUMENTS) {
      expect(text).toContain(`## \`${schema}\``);
      expect(text).toContain(`[\`json/${file}\`](json/${file})`);
    }
    expect(text).toContain(
      '- `wiring` (list of objects): what apply does to each managed resource\n  - `resource` (string)',
    );
    expect(text).toContain('- `recordId` (string or null)');
    expect(text).toContain('- `startedAt` (string (an ISO 8601 date and time))');
    expect(text).toContain('- With `login` `"own"`:');
    expect(text).toContain('- `again` (boolean, optional)');
  });

  it('says how v1 grows, and which codes a script acts on', () => {
    expect(text).toContain('**Within v1 a shape only grows.**');
    expect(text).toContain('- `keep.record`:');
  });
});

describe('documentJsonSchema', () => {
  it('is published at its own address, and accepts exactly what the CLI prints', () => {
    const error = DOCUMENTS.find((d) => d.schema === 'mediaplane.error/v1');
    if (error === undefined) throw new Error('no mediaplane.error/v1');
    const published = documentJsonSchema(error);
    expect(published).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/json/error.schema.json',
      title: 'mediaplane.error/v1',
    });
    // As a script reads it: the file itself, in any JSON Schema validator.
    const validator = z.fromJSONSchema(
      JSON.parse(JSON.stringify(published)) as Parameters<typeof z.fromJSONSchema>[0],
    );
    const printed = errorDocument('fake failure');
    expect(validator.safeParse(printed).success).toBe(true);
    expect(validator.safeParse({ ...printed, extra: 1 }).success).toBe(false);
    expect(validator.safeParse({ ...printed, ok: true }).success).toBe(false);
  });
});
````

Create `scripts/docs/links.test.ts`:

````ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { brokenLinks, linkTarget, withoutCode } from './links';

/** A repository of `files`, by path, in a folder of its own. */
async function repo(files: Record<string, string>): Promise<string> {
  const root = await tempDir('mediaplane-links-');
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe('withoutCode', () => {
  it("drops fenced blocks, a longer fence's too, and with `inline` code spans", () => {
    const text = [
      'a [x](one.md) `[y](two.md)`',
      '```text',
      '[z](three.md)',
      '```',
      '````markdown',
      '```',
      '[w](four.md)',
      '````',
      'b',
    ].join('\n');
    expect(withoutCode(text, true)).toBe('a [x](one.md) \n\n\n\n\n\n\n\nb');
    expect(withoutCode(text, false)).toContain('`[y](two.md)`');
  });
});

describe('linkTarget', () => {
  it('resolves a link from its file, and a repo URL from the root; skips the rest', () => {
    expect(linkTarget('/r', 'docs/a/b.md', '../c.md#part')).toBe('docs/c.md');
    expect(linkTarget('/r', 'docs/a/b.md', '/README.md')).toBe('README.md');
    expect(
      linkTarget(
        '/r',
        'README.md',
        'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/x%20y.md',
      ),
    ).toBe('docs/x y.md');
    expect(linkTarget('/r', 'README.md', 'https://example.com/a.md')).toBeUndefined();
    expect(linkTarget('/r', 'README.md', '#anchor')).toBeUndefined();
    expect(linkTarget('/r', 'README.md', 'mailto:someone@example.com')).toBeUndefined();
  });
});

describe('brokenLinks', () => {
  it('finds each link and each docs/ path that leads nowhere, and nothing else', async () => {
    const root = await repo({
      'README.md': [
        '[ok](docs/a.md) [gone](docs/gone.md)',
        '[ref]: docs/also-gone.md',
        '[site](https://github.com/cyclopsgd/Mediaplane/blob/main/docs/missing.md)',
        'Named in prose: docs/a.md, and docs/prose-gone.md.',
        '```text',
        '[quoted](docs/quoted.md) docs/quoted.md',
        '```',
      ].join('\n'),
      'docs/a.md': '[up](../README.md)',
      'packages/x/src/y.ts':
        "// see docs/a.md and docs/code-gone.md\nconst z = 'docs/a.md';\n",
      // A plan is a record: its prose names files as they were, but its links lead on.
      'docs/plans/m1/m1-s1-x.md': 'docs/old.md [roadmap](../m1-roadmap.md)',
      'docs/plans/m1-roadmap.md': 'docs/roadmap-gone.md',
      'node_modules/z/README.md': '[none](nowhere.md)',
    });
    expect(await brokenLinks(root)).toEqual([
      'README.md: docs/gone.md',
      'README.md: docs/also-gone.md',
      'README.md: https://github.com/cyclopsgd/Mediaplane/blob/main/docs/missing.md',
      'README.md: docs/prose-gone.md',
      'docs/plans/m1-roadmap.md: docs/roadmap-gone.md',
      'packages/x/src/y.ts: docs/code-gone.md',
    ]);
  });
});
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm exec vitest run packages/cli/src/contract.test.ts packages/cli/src/run.test.ts packages/engine/src/config/load.test.ts packages/engine/src/runbooks.test.ts scripts/docs/cli-reference.test.ts scripts/docs/json-reference.test.ts scripts/docs/links.test.ts`

Expected: FAIL. `json-reference.test.ts` and `links.test.ts` with `Cannot find module`;
`contract.test.ts` with `TypeError: CODES is not iterable`; `runbooks.test.ts` with
`TypeError: docsUrl is not a function`; `load.test.ts`, `cli-reference.test.ts` and the
two `--help` tests in `run.test.ts` with `AssertionError` (the hint and the help still
name `docs/…` paths).

- [ ] **Step 3: The codes a script acts on**

````diff
diff --git a/packages/cli/src/contract.ts b/packages/cli/src/contract.ts
index 4eb2d02..823ccb7 100644
--- a/packages/cli/src/contract.ts
+++ b/packages/cli/src/contract.ts
@@ -472,2 +472,62 @@ export const errorDocumentJson = z
 
+/**
+ * The diagnostic codes a script is most likely to act on, as the reference lists them.
+ * Each is pinned by a test of the code that gives it (contract.test.ts checks).
+ */
+export const CODES: readonly { code: string; meaning: string }[] = [
+  { code: 'config.missing', meaning: 'the home has no `stack.yaml`' },
+  {
+    code: 'config.old-version',
+    meaning:
+      '`stack.yaml` is an older version, read in memory (a warning): `mediaplane migrate` rewrites it',
+  },
+  {
+    code: 'apply.locked',
+    meaning:
+      'another Mediaplane command holds `state/lock`; `drift.locked`, `keep.locked` and `migrate.locked` say the same of theirs. Run it again once the other is done',
+  },
+  {
+    code: 'apply.pull-failed',
+    meaning:
+      'an image could not be pulled, even after the retries, before anything was stopped: run apply again',
+  },
+  {
+    code: 'secrets.admin-password-lost',
+    meaning:
+      'the admin password Mediaplane generated went with `state/secrets.json` (a warning): apply generates another and sets it in each app',
+  },
+  {
+    code: 'bootstrap.needs-password',
+    meaning:
+      "an app's first-run setup is held, since the app has never had the admin password Mediaplane holds: the rebuilding a host runbook says what to do",
+  },
+  {
+    code: 'bootstrap.open-published',
+    meaning:
+      "an app runs published though its first-run setup isn't shown to be done (a warning): apply starts it again without its ports first",
+  },
+  {
+    code: 'rotate.no-plex',
+    meaning: '`--rotate plex.token` on a stack without Plex',
+  },
+  {
+    code: 'keep.external',
+    meaning:
+      'with `managed_by: external`, keep wrote nothing in `stack.yaml` (a warning): add its `line` there',
+  },
+  {
+    code: 'keep.record',
+    meaning:
+      "keep couldn't forget the record of a resource it keeps as unmanaged: run keep again before the next apply",
+  },
+  {
+    code: 'credentials.not-yet',
+    meaning: 'there is no admin password yet: run apply first',
+  },
+  {
+    code: 'vpn-check.not-applied',
+    meaning: "the stack hasn't been applied, so there is nothing to check yet",
+  },
+];
+
 /**
````

- [ ] **Step 4: The published docs' address, in help and hints**

````diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 0026b0f..97501f0 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -10,2 +10,3 @@ import {
   detectHostFacts,
+  docsUrl,
   drift,
@@ -283,3 +284,3 @@ export function createProgram(
     .description(
-      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see docs/security/threat-model.md)",
+      `Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see ${docsUrl('security/threat-model.md')})`,
     )
@@ -368,3 +369,3 @@ export function createProgram(
     .description(
-      'Report what changed in the apps outside Mediaplane since it applied them, without putting it back; it changes nothing in the apps but for the marks its checks leave (see docs/security/threat-model.md), and keeps what its checks found in state/resources.json, so it checks a secret it found refused no more until apply sets it',
+      `Report what changed in the apps outside Mediaplane since it applied them, without putting it back; it changes nothing in the apps but for the marks its checks leave (see ${docsUrl('security/threat-model.md')}), and keeps what its checks found in state/resources.json, so it checks a secret it found refused no more until apply sets it`,
     )
diff --git a/packages/engine/src/config/load.ts b/packages/engine/src/config/load.ts
index 6aff5a5..6e43c7b 100644
--- a/packages/engine/src/config/load.ts
+++ b/packages/engine/src/config/load.ts
@@ -3,2 +3,3 @@ import type { ZodError } from 'zod';
 import { error, warning, withHint, type Diagnostic } from '../diagnostics';
+import { docsUrl } from '../runbooks';
 import { didYouMean } from '../util/did-you-mean';
@@ -35,3 +36,3 @@ export async function loadConfigFile(
         error('config.missing', `no stack.yaml at ${path}`, {
-          hint: 'create one; the format is described in docs/design/m1-engine-cli.md §4.2',
+          hint: `run "mediaplane init" to write one, or pass --home with the Mediaplane home; its format: ${docsUrl('reference/stack-yaml.md')}`,
         }),
diff --git a/packages/engine/src/runbooks.ts b/packages/engine/src/runbooks.ts
index ede28c8..9b6447f 100644
--- a/packages/engine/src/runbooks.ts
+++ b/packages/engine/src/runbooks.ts
@@ -1,7 +1,14 @@
 /**
- * Where the runbooks are published. A hint gives this address, not a path in the repo:
- * someone running Mediaplane's image has no copy of the repo.
+ * Where the docs are published. Help and hints give this address, not a path in the
+ * repo: someone running Mediaplane's image has no copy of the repo.
  */
-export const RUNBOOKS_URL =
-  'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks';
+export const DOCS_URL = 'https://github.com/cyclopsgd/Mediaplane/blob/main/docs';
+
+/** A page of the docs, by its path in docs/ ("reference/stack-yaml.md"), on GitHub. */
+export function docsUrl(path: string): string {
+  return `${DOCS_URL}/${path}`;
+}
+
+/** Where the runbooks are published. */
+export const RUNBOOKS_URL = docsUrl('runbooks');
 
````

- [ ] **Step 5: Generate the reference, and check the links**

Create `scripts/docs/json-reference.ts`:

````ts
import { z } from 'zod';
import { CODES, DOCUMENTS, type JsonDocument } from '../../packages/cli/src/contract';

const GENERATED =
  '<!-- Generated by "pnpm docs:generate" from packages/cli/src/contract.ts. Do not edit. -->';

/** Where the JSON Schema files are published, beside this reference. */
export const JSON_SCHEMA_BASE =
  'https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/json';

/** The parts of a JSON Schema this reference reads. */
interface Schema {
  type?: string | string[];
  description?: string;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  oneOf?: Schema[];
  anyOf?: Schema[];
}

/** A document's published JSON Schema: this release's exact shape, by its file's URL. */
export function documentJsonSchema(document: JsonDocument): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(document.shape) as Record<string, unknown>;
  return {
    $schema,
    $id: `${JSON_SCHEMA_BASE}/${document.file}`,
    $comment:
      'Generated by "pnpm docs:generate" from packages/cli/src/contract.ts. Do not edit.',
    title: document.schema,
    ...rest,
  };
}

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} or ${items.at(-1) ?? ''}`;
}

/** A field's type, in words. */
function typeOf(schema: Schema): string {
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
  if (schema.enum !== undefined) {
    return `one of ${orList(schema.enum.map((value) => `\`${String(value)}\``))}`;
  }
  if (schema.anyOf !== undefined) return orList(schema.anyOf.map(typeOf));
  if (schema.oneOf !== undefined) return 'one of the objects below';
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? 'any'];
  if (types.length > 1) return orList(types);
  const type = types[0] ?? 'any';
  if (type === 'array') {
    const items = schema.items ?? {};
    return items.oneOf === undefined
      ? `list of ${typeOf(items)}s`
      : 'list of objects, each one of those below';
  }
  if (type === 'string' && schema.format === 'date-time') {
    return 'string (an ISO 8601 date and time)';
  }
  if (type === 'string' && schema.pattern !== undefined) {
    return `string matching \`${schema.pattern}\``;
  }
  return type;
}

/** What a field holds below it: an object's fields, or a list's items'. */
function inner(schema: Schema): Schema | undefined {
  if (schema.properties !== undefined || schema.oneOf !== undefined) return schema;
  if (schema.items !== undefined) return inner(schema.items);
  const nonNull = (schema.anyOf ?? []).filter((option) => option.type !== 'null');
  return nonNull.length === 1 && nonNull[0] !== undefined ? inner(nonNull[0]) : undefined;
}

/** An object's fields as a nested list, each with its type and what it means. */
function fieldLines(schema: Schema, indent: string): string[] {
  if (schema.oneOf !== undefined) {
    return schema.oneOf.flatMap((variant) => {
      const [tag, value] =
        Object.entries(variant.properties ?? {}).find(([, p]) => p.const !== undefined) ??
        [];
      return [
        `${indent}- With \`${tag ?? '?'}\` \`${JSON.stringify(value?.const)}\`:`,
        ...fieldLines(variant, `${indent}  `),
      ];
    });
  }
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
    const optional = required.has(name) ? '' : ', optional';
    const description = field.description === undefined ? '' : `: ${field.description}`;
    const below = inner(field);
    return [
      `${indent}- \`${name}\` (${typeOf(field)}${optional})${description}`,
      ...(below === undefined ? [] : fieldLines(below, `${indent}  `)),
    ];
  });
}

/** docs/reference/json.md (spec §5.2, §9): every --json document, from the contract. */
export function renderJsonReference(): string {
  const lines = [
    '# `--json` reference',
    '',
    GENERATED,
    '',
    "Every command takes `--json`. With it, a command prints one JSON document on standard output, and nothing else there, whatever happens: its own document, or `mediaplane.error/v1` when it stops before it can print its own, a usage error included. What is for people, such as `plex-login`'s link, goes to standard error. Only `--help` and `--version` print text.",
    '',
    "- **Every document names its shape** in `schema` (`mediaplane.<name>/v1`), and says in `ok` whether the command did what it was asked. Each command's exit code says the same: the [CLI reference](cli.md) lists them.",
    '- **The shapes below are generated from the code,** and a test checks that the CLI prints exactly them. Each has a JSON Schema in [`json/`](json/), one file per document.',
    "- **Within v1 a shape only grows.** A later release may add a field, or a value to a field's values (such as a new `wiring[].action`), and never changes what one means: that would be v2. So a script reads the fields it knows and ignores the others, and stops at a value it doesn't know, rather than guess what it means. The JSON Schema files describe this release's shapes exactly: validate against the files of the release you run.",
    '- **No secret is ever in a document,** but for the password `credentials --reveal` asks for.',
    "- **A diagnostic's `severity` says whether it stopped the command;** its `code` says what it is, and stays the same from release to release, while its message is for people and may change. Within v1 a release may add codes. These are the codes a script is most likely to act on:",
    '',
    ...CODES.map((code) => `  - \`${code.code}\`: ${code.meaning}`),
    '',
    '## Documents',
    '',
    ...DOCUMENTS.map(
      (document) =>
        `- [\`${document.schema}\`](#${document.schema.replace(/[^a-z0-9-]/g, '')})`,
    ),
    '',
  ];
  for (const document of DOCUMENTS) {
    const schema = documentJsonSchema(document) as Schema;
    lines.push(
      `## \`${document.schema}\``,
      '',
      `${capitalised(schema.description ?? '')}.`,
      '',
      `JSON Schema: [\`json/${document.file}\`](json/${document.file})`,
      '',
      ...fieldLines(schema, ''),
      '',
    );
  }
  return lines.join('\n');
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
````

Create `scripts/docs/links.ts`:

````ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/** This repository's own files on GitHub: such a link is checked as a path in it. */
const REPO_FILE =
  /^https:\/\/(?:github\.com\/cyclopsgd\/Mediaplane\/(?:blob|tree)\/main|raw\.githubusercontent\.com\/cyclopsgd\/Mediaplane\/main)\/([^#?]*)/;

/** Folders that hold no docs of the repository's own. */
const SKIPPED = new Set(['node_modules', '.git', 'coverage', 'dist', '.claude']);

/**
 * The kinds of file whose mentions of a doc are checked, besides Markdown's links: not a
 * test, whose fixtures may name docs that don't exist.
 */
const CODE = /(?<!\.test)\.(ts|sh|ya?ml|json)$|^Dockerfile$/;

/** A doc named by its path from the repository root, as code and prose name one. */
const DOC_PATH = /(?<![\w./-])docs\/[\w./-]+\.(?:md|json)\b/g;

/**
 * The slices' plans: records of what was built, whose prose names files as they were then.
 * Their links are checked; their mentions of a path are not.
 */
const RECORDS = /^docs\/plans\/(?!m1-roadmap\.md$)/;

/** Markdown's inline links and images, and its reference definitions. */
const LINK =
  /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm;

/** Every file under `root` but those in SKIPPED folders, by path from `root`. */
async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split('/').some((part) => SKIPPED.has(part)))
    .sort();
}

/**
 * A Markdown file's text without its fenced code blocks, which quote files (a plan's
 * diffs) rather than link to them; with `inline`, without its code spans too.
 */
export function withoutCode(text: string, inline: boolean): string {
  let fence: string | undefined;
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === undefined) {
        if (marker !== undefined) {
          fence = marker;
          return '';
        }
        return inline ? line.replace(/(`+)[^`]*?\1/g, '') : line;
      }
      const closes =
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker;
      if (closes) fence = undefined;
      return '';
    })
    .join('\n');
}

/**
 * Where a link in `file` leads, as a path from `root`; undefined for one that leaves the
 * repository, or stays on its own page (#anchor).
 */
export function linkTarget(
  root: string,
  file: string,
  target: string,
): string | undefined {
  const own = REPO_FILE.exec(target);
  if (own !== null) return decodeURIComponent(own[1] ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return undefined;
  const path = decodeURIComponent(target.replace(/[#?].*$/, ''));
  if (path === '') return undefined;
  const from = path.startsWith('/') ? root : dirname(join(root, file));
  return relative(root, resolve(from, path.replace(/^\//, '')));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every link in the repository's Markdown, and every doc its code or its prose names by
 * path (docs/…), that leads nowhere: as `<file>: <target>`, each once.
 */
export async function brokenLinks(root: string): Promise<string[]> {
  const broken = new Set<string>();
  for (const file of await filesUnder(root)) {
    const markdown = file.endsWith('.md');
    if (!markdown && !CODE.test(file.split('/').at(-1) ?? '')) continue;
    const text = await readFile(join(root, file), 'utf8');
    const targets = new Set<string>();
    if (markdown) {
      for (const match of withoutCode(text, true).matchAll(LINK)) {
        const target = match[1] ?? match[2] ?? '';
        const path = linkTarget(root, file, target);
        if (path !== undefined && !(await exists(join(root, path)))) {
          broken.add(`${file}: ${target}`);
        }
      }
    }
    if (!RECORDS.test(file)) {
      for (const match of (markdown ? withoutCode(text, false) : text).matchAll(
        DOC_PATH,
      )) {
        targets.add(match[0]);
      }
    }
    for (const path of targets) {
      if (!(await exists(join(root, path)))) broken.add(`${file}: ${path}`);
    }
  }
  return [...broken];
}
````

````diff
diff --git a/scripts/docs.ts b/scripts/docs.ts
index 73ff94e..b39547f 100644
--- a/scripts/docs.ts
+++ b/scripts/docs.ts
@@ -6,3 +6,6 @@ import { format, resolveConfig } from 'prettier';
 import { FACTS_END, FACTS_START, withFacts } from './docs/catalog-facts';
+import { DOCUMENTS } from '../packages/cli/src/contract';
 import { renderCliReference } from './docs/cli-reference';
+import { documentJsonSchema, renderJsonReference } from './docs/json-reference';
+import { brokenLinks } from './docs/links';
 import { renderStackReference } from './docs/stack-reference';
@@ -57,2 +60,7 @@ export async function generatedFiles(): Promise<{ path: string; content: string
     { path: 'docs/reference/cli.md', content: renderCliReference() },
+    { path: 'docs/reference/json.md', content: renderJsonReference() },
+    ...DOCUMENTS.map((document) => ({
+      path: `docs/reference/json/${document.file}`,
+      content: `${JSON.stringify(documentJsonSchema(document), null, 2)}\n`,
+    })),
   ];
@@ -90,7 +98,15 @@ async function main(check: boolean): Promise<number> {
   }
-  if (stale.length === 0) return 0;
-  console.error(
-    `These generated files are out of date:\n${stale.map((p) => `  ${p}\n`).join('')}Run "pnpm docs:generate" and commit the result.`,
-  );
-  return 1;
+  // Every link in the docs leads somewhere, a generated file's included.
+  const broken = await brokenLinks(ROOT);
+  if (broken.length > 0) {
+    console.error(
+      `These links lead nowhere:\n${broken.map((b) => `  ${b}\n`).join('')}Fix each, or the file it names.`,
+    );
+  }
+  if (stale.length > 0) {
+    console.error(
+      `These generated files are out of date:\n${stale.map((p) => `  ${p}\n`).join('')}Run "pnpm docs:generate" and commit the result.`,
+    );
+  }
+  return stale.length === 0 && broken.length === 0 ? 0 : 1;
 }
diff --git a/scripts/docs/cli-reference.ts b/scripts/docs/cli-reference.ts
index cebe5e0..d69b866 100644
--- a/scripts/docs/cli-reference.ts
+++ b/scripts/docs/cli-reference.ts
@@ -27,3 +27,3 @@ export function renderCliReference(cli: Program = program()): string {
     '',
-    'Every command takes `--json` for machine-readable output, and `--help` for this help. `mediaplane --version` prints the version.',
+    'Every command takes `--json` for machine-readable output, whose documents the [`--json` reference](json.md) describes, and `--help` for this help. `mediaplane --version` prints the version.',
     '',
````

- [ ] **Step 6: Run them, and see them pass**

Run the command of Step 2. Expected: PASS.

- [ ] **Step 7: Generate the docs, the full check, and commit**

Run: `pnpm docs:generate`. It writes `docs/reference/cli.md` (the plan and drift help, and
a link to the new reference), `docs/reference/json.md`, and the thirteen files of
`docs/reference/json/` (`apply`, `change`, `credentials`, `drift`, `error`, `history`,
`init`, `keep`, `migrate`, `plan`, `plex-login`, `status` and `vpn-check`, each
`.schema.json`). It finds no broken link.

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "docs(reference): generate the --json reference and its JSON Schemas, check every link, and point help at the published docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: A script is asked nothing, and never waits on `stack.yaml`

Decision 9.

**Files:**

- Change: `packages/engine/src/util/fs.ts`, `packages/engine/src/config/load.ts`,
  `packages/engine/src/drift.ts`, `packages/engine/src/apply/apply.ts`
- Test: `packages/cli/src/main.test.ts`, `packages/cli/src/run.test.ts`,
  `packages/engine/src/config/load.test.ts`, `packages/engine/src/drift.test.ts`,
  `packages/engine/src/apply/apply.test.ts`

**Interfaces:**

- Produces: `readIfExists(path: string, options?: { noWait?: boolean }): Promise<string |
  undefined>` (a file opened without waiting reads as empty, never hangs); the diagnostic
  `config.not-a-file`, from `loadConfigFile`, for anything but a regular file at
  `stack.yaml`.

- [ ] **Step 1: Write the failing tests**

`main.test.ts` runs the CLI as a script would, no terminal and an empty standard input,
with a time limit; the unexpected error that `run.test.ts` provokes is now an unreadable
`stack.yaml`, since a folder there becomes a plan error:

````diff
diff --git a/packages/cli/src/main.test.ts b/packages/cli/src/main.test.ts
index 280df73..719f883 100644
--- a/packages/cli/src/main.test.ts
+++ b/packages/cli/src/main.test.ts
@@ -1,2 +1,2 @@
-import { spawnSync } from 'node:child_process';
+import { execFileSync, spawnSync } from 'node:child_process';
 import { mkdirSync, writeFileSync } from 'node:fs';
@@ -72,2 +72,15 @@ function spawnMain(...args: string[]) {
 
+/**
+ * The CLI as a script runs it: no terminal, its standard input a pipe with nothing in
+ * it, and a time limit, so that a command that waits for an answer fails the test.
+ */
+function spawnScripted(...args: string[]) {
+  return spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], {
+    encoding: 'utf8',
+    env: ENV,
+    input: '',
+    timeout: 45_000,
+  });
+}
+
 async function freshHome(): Promise<string> {
@@ -104,2 +117,35 @@ describe('main', { timeout: 60_000 }, () => {
 
+  // spec §5.2: without a terminal, nothing is asked; what needs an answer says so, at once.
+  it('asks nothing when a script runs it: what needs an answer fails, saying which flag', () => {
+    const home = tempDirSync('mediaplane-main-');
+    const cases: [string[], string][] = [
+      [
+        ['apply', '--home', home],
+        'error: apply needs --yes when it cannot ask for confirmation (with --json, or when not run in a terminal)\n',
+      ],
+      [
+        ['init', '--home', join(home, 'new')],
+        'error: init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)\n',
+      ],
+    ];
+    for (const [args, said] of cases) {
+      const result = spawnScripted(...args);
+      expect(result.error, `${args[0] ?? ''} waited`).toBeUndefined();
+      expect([result.status, result.stderr]).toEqual([1, said]);
+      expect(result.stdout).toBe('');
+    }
+  });
+
+  it('never waits on a named pipe in place of stack.yaml', () => {
+    const home = tempDirSync('mediaplane-main-');
+    execFileSync('mkfifo', [join(home, 'stack.yaml')]);
+    for (const command of ['plan', 'apply', 'drift', 'credentials']) {
+      const args = command === 'apply' ? [command, '--yes'] : [command];
+      const result = spawnScripted(...args, '--home', home, '--json');
+      expect(result.error, `${command} waited`).toBeUndefined();
+      expect(result.status).toBe(1);
+      expect(result.stdout).toContain('config.not-a-file');
+    }
+  });
+
   it('keeps the plan exit code when stdout is closed early', async () => {
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 47becb0..3b394a6 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -673,3 +673,4 @@ describe('mediaplane plan', () => {
     const home = await tempDir('mediaplane-cli-');
-    await mkdir(join(home, 'stack.yaml'));
+    await writeFile(join(home, 'stack.yaml'), STACK);
+    await chmod(join(home, 'stack.yaml'), 0o000);
     const term = capture();
@@ -677,3 +678,3 @@ describe('mediaplane plan', () => {
     expect(term.stderr()).toBe(
-      `error: cannot read ${join(home, 'stack.yaml')} (EISDIR)\n`,
+      `error: cannot read ${join(home, 'stack.yaml')} (EACCES): check that the user running Mediaplane can read it\n`,
     );
@@ -808,3 +809,5 @@ describe('mediaplane plan', () => {
     const home = await tempDir('mediaplane-cli-');
-    await mkdir(join(home, 'stack.yaml'));
+    await writeFile(join(home, 'stack.yaml'), STACK);
+    // Unreadable, to the user running Mediaplane.
+    await chmod(join(home, 'stack.yaml'), 0o000);
     const term = capture();
@@ -814,3 +817,5 @@ describe('mediaplane plan', () => {
       ok: false,
-      error: { message: `cannot read ${join(home, 'stack.yaml')} (EISDIR)` },
+      error: {
+        message: `cannot read ${join(home, 'stack.yaml')} (EACCES): check that the user running Mediaplane can read it`,
+      },
     });
@@ -818,2 +823,14 @@ describe('mediaplane plan', () => {
   });
+
+  it('refuses a folder in place of stack.yaml as a plan error', async () => {
+    const home = await tempDir('mediaplane-cli-');
+    await mkdir(join(home, 'stack.yaml'));
+    const term = capture();
+    expect(await run(['plan', '--home', home, '--json'], term.io, deps())).toBe(1);
+    expect(JSON.parse(term.stdout())).toMatchObject({
+      schema: 'mediaplane.plan/v1',
+      ok: false,
+      diagnostics: [{ code: 'config.not-a-file' }],
+    });
+  });
 });
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 4e46bd2..767a359 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -12,2 +12,3 @@ import {
 import type * as FsPromises from 'node:fs/promises';
+import { execFileSync } from 'node:child_process';
 import { readFileSync } from 'node:fs';
@@ -564,2 +565,13 @@ describe('apply', () => {
 
+  it("doesn't create state/, or wait, where stack.yaml is a named pipe", async () => {
+    const home = await tempDir('mediaplane-apply-');
+    execFileSync('mkfifo', [join(home, 'stack.yaml')]);
+    const result = await apply(options(home, fakeDocker(home)));
+    expect(result.outcome).toBe('invalid');
+    expect(result.diagnostics).toContainEqual(
+      expect.objectContaining({ code: 'config.not-a-file' }),
+    );
+    await expect(stat(join(home, 'state'))).rejects.toThrow();
+  });
+
   it('stops at a failed pull, skips the rest and records the failure', async () => {
diff --git a/packages/engine/src/config/load.test.ts b/packages/engine/src/config/load.test.ts
index dfbcb3f..52d940d 100644
--- a/packages/engine/src/config/load.test.ts
+++ b/packages/engine/src/config/load.test.ts
@@ -1,2 +1,3 @@
-import { writeFile } from 'node:fs/promises';
+import { execFileSync } from 'node:child_process';
+import { mkdir, writeFile } from 'node:fs/promises';
 import { join } from 'node:path';
@@ -439,2 +440,24 @@ describe('loadConfigFile', () => {
 
+  // A named pipe would make a read wait for a writer: a script running Mediaplane hangs.
+  it('refuses a named pipe or a folder in place of stack.yaml, without waiting', async () => {
+    const fifo = await tempDir('mediaplane-config-');
+    execFileSync('mkfifo', [join(fifo, 'stack.yaml')]);
+    const folder = await tempDir('mediaplane-config-');
+    await mkdir(join(folder, 'stack.yaml'));
+    for (const dir of [fifo, folder]) {
+      const path = join(dir, 'stack.yaml');
+      expect(await loadConfigFile(path)).toEqual({
+        ok: false,
+        diagnostics: [
+          {
+            severity: 'error',
+            code: 'config.not-a-file',
+            message: `${path} is not a regular file, such as a folder or a named pipe, so Mediaplane won't read it`,
+            hint: 'put your stack.yaml file there in its place',
+          },
+        ],
+      });
+    }
+  });
+
   it('reads and parses a file', async () => {
diff --git a/packages/engine/src/drift.test.ts b/packages/engine/src/drift.test.ts
index 83da438..7a95811 100644
--- a/packages/engine/src/drift.test.ts
+++ b/packages/engine/src/drift.test.ts
@@ -1 +1,2 @@
+import { execFileSync } from 'node:child_process';
 import { readdir, stat, writeFile } from 'node:fs/promises';
@@ -306,2 +307,13 @@ describe('drift', () => {
 
+  it('makes no state/ where stack.yaml is a named pipe, and never waits on it', async () => {
+    const dir = await tempDir('mediaplane-drift-');
+    execFileSync('mkfifo', [join(dir, 'stack.yaml')]);
+    const result = await driftOf(dir, await fakeSonarr({ key: KEY }));
+    expect(result).toMatchObject({
+      ok: false,
+      diagnostics: [expect.objectContaining({ code: 'config.not-a-file' })],
+    });
+    expect(await readdir(dir)).toEqual(['stack.yaml']);
+  });
+
   it('fails as plan fails, and warns when it cannot keep its checks', async () => {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm exec vitest run packages/cli/src/main.test.ts packages/cli/src/run.test.ts packages/engine/src/config/load.test.ts packages/engine/src/drift.test.ts packages/engine/src/apply/apply.test.ts`

Expected: FAIL. The pipe tests of `load.test.ts`, `drift.test.ts` and `apply.test.ts`
with `Error: Test timed out in 5000ms.` (the read waits for a writer); `main.test.ts`'s
`never waits on a named pipe in place of stack.yaml` with `plan waited: expected Error:
spawnSync … to be undefined`; `run.test.ts`'s `refuses a folder in place of stack.yaml as
a plan error` with `expected { schema: 'mediaplane.error/v1', … } to match object {
schema: 'mediaplane.plan/v1', … }`. The no-terminal test passes already: it pins what is.

- [ ] **Step 3: Look before reading, and never wait**

````diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index f36d8c3..26578a0 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -37,3 +37,3 @@ import { writeFileAtomic } from '../util/atomic';
 import { codeOf } from '../util/error-code';
-import { readIfExists } from '../util/fs';
+import { fileKind, readIfExists } from '../util/fs';
 import { foundSecrets, redact } from '../util/redact';
@@ -116,3 +116,3 @@ export async function apply(options: ApplyOptions): Promise<ApplyResult> {
   // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
-  if ((await readIfExists(join(home, STACK_PATH))) === undefined) {
+  if ((await fileKind(join(home, STACK_PATH))) !== 'file') {
     return stopped('invalid', await plan(options));
@@ -140,3 +140,4 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   const startedAt = now();
-  const stackSource = (await readIfExists(join(options.home, STACK_PATH))) ?? '';
+  const stackSource =
+    (await readIfExists(join(options.home, STACK_PATH), { noWait: true })) ?? '';
   const { result: shown, context } = await planStack(options);
diff --git a/packages/engine/src/config/load.ts b/packages/engine/src/config/load.ts
index 6e43c7b..b8a7c25 100644
--- a/packages/engine/src/config/load.ts
+++ b/packages/engine/src/config/load.ts
@@ -5,3 +5,3 @@ import { docsUrl } from '../runbooks';
 import { didYouMean } from '../util/did-you-mean';
-import { readIfExists } from '../util/fs';
+import { fileKind, readIfExists } from '../util/fs';
 import { MIGRATIONS, migrateData, STACK_VERSION, type Migration } from './migrations';
@@ -26,2 +26,8 @@ type Issue = ZodError['issues'][number];
 
+/**
+ * stack.yaml, read and validated. It is looked at before it is opened, and opened without
+ * waiting: a named pipe in its place would make a read wait for a writer, and a script
+ * running Mediaplane hang (spec §5.2). Anything but a regular file is refused, as
+ * `migrate` and `keep` refuse it.
+ */
 export async function loadConfigFile(
@@ -30,3 +36,17 @@ export async function loadConfigFile(
 ): Promise<LoadResult> {
-  const source = await readIfExists(path);
+  const kind = await fileKind(path);
+  if (kind === 'other') {
+    return {
+      ok: false,
+      diagnostics: [
+        error(
+          'config.not-a-file',
+          `${path} is not a regular file, such as a folder or a named pipe, so Mediaplane won't read it`,
+          { hint: 'put your stack.yaml file there in its place' },
+        ),
+      ],
+    };
+  }
+  const source =
+    kind === 'missing' ? undefined : await readIfExists(path, { noWait: true });
   if (source === undefined) {
diff --git a/packages/engine/src/drift.ts b/packages/engine/src/drift.ts
index a587dc2..a50a416 100644
--- a/packages/engine/src/drift.ts
+++ b/packages/engine/src/drift.ts
@@ -12,3 +12,3 @@ import { planStack, type PlanOptions } from './plan/plan';
 import { acquireLock, LockedError, type Lock } from './state/lock';
-import { readIfExists } from './util/fs';
+import { fileKind } from './util/fs';
 
@@ -53,3 +53,3 @@ export async function drift(options: DriftOptions): Promise<DriftResult> {
   // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
-  if ((await readIfExists(join(home, STACK_PATH))) === undefined) {
+  if ((await fileKind(join(home, STACK_PATH))) !== 'file') {
     return failedDrift((await planStack({ ...options, home })).result.diagnostics);
diff --git a/packages/engine/src/util/fs.ts b/packages/engine/src/util/fs.ts
index d00bae9..e1cb53e 100644
--- a/packages/engine/src/util/fs.ts
+++ b/packages/engine/src/util/fs.ts
@@ -6,7 +6,12 @@ import { codeOf } from './error-code';
  * The file's contents, or undefined if it does not exist. Any other failure is thrown
- * as an error that names the file, and for permission errors, what to check.
+ * as an error that names the file, and for permission errors, what to check. With
+ * `noWait`, it is opened without waiting, so a named pipe swapped in at `path` reads as
+ * empty rather than hang the read.
  */
-export async function readIfExists(path: string): Promise<string | undefined> {
+export async function readIfExists(
+  path: string,
+  { noWait = false }: { noWait?: boolean } = {},
+): Promise<string | undefined> {
   try {
-    return await readFile(path, 'utf8');
+    return noWait ? await readFileNoWait(path) : await readFile(path, 'utf8');
   } catch (cause) {
````

- [ ] **Step 4: Run them, and see them pass**

Run the command of Step 2. Expected: PASS, each pipe test in well under a second.

- [ ] **Step 5: The full check, and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "fix(engine): never wait on a named pipe in place of stack.yaml, and pin that a script is asked nothing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: First-run setups held in one pass, and a never-ready setup asked once

Decisions 10, 11. And the S3c test gap of the folder helper's last two guards.

**Files:**

- Change: `packages/engine/src/plan/plan.ts`, `packages/engine/src/apply/bootstrap.ts`
- Test: `packages/engine/src/apply/apply.test.ts`,
  `packages/engine/src/integrations/wire.test.ts`

**Interfaces:** none new. `heldThrough` and `withoutSignInsToCome`
(`plan/bootstrap.ts`) are called as they are, with the whole plan's setups.

- [ ] **Step 1: Write the failing tests**

In the test catalog, Sonarr's setup is Seerr's shape: it makes no key and signs in
through Jellyfin. Given `signsInWith: ['admin.password']`, it signs in again when that is
rotated, as Seerr does with `plex.token`: what a later catalog could have on a Jellyfin
stack. The never-ready test now checks that the setup isn't asked again. The folder
helper's last two guards get the tests S3c's review asked for:

````diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 767a359..6237cc0 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -3429,2 +3429,9 @@ describe('apply: a first-run setup that makes no key, after another', () => {
     expect(failed.diagnostics.at(-1)?.message).toContain('sonarr at http://sonarr:8989');
+    // Not asked again whether its setup is open, once it wasn't ready in time: that would
+    // only wait as long again before the failure is told.
+    expect(
+      setup.app.requests
+        .filter((r) => r.path.startsWith('/signed-in'))
+        .map((r) => r.path),
+    ).toEqual([]);
     // Jellyfin is published once set up; Sonarr stays without its ports in that up.
@@ -3619,2 +3626,73 @@ describe('apply: a first-run setup that makes no key, after another', () => {
 
+  /**
+   * SIGN_IN_CATALOG, with Sonarr's setup signing in again when admin.password is rotated,
+   * as Seerr's does with plex.token: what a later catalog could have on a Jellyfin stack.
+   */
+  const SIGNS_IN_AGAIN: Catalog = SIGN_IN_CATALOG.map((def) =>
+    def.id === 'sonarr' && def.bootstrap !== undefined
+      ? { ...def, bootstrap: { ...def.bootstrap, signsInWith: ['admin.password'] } }
+      : def,
+  );
+
+  /** Sonarr set up by Mediaplane, and asked itself from then on: its file can't be read. */
+  async function askedStack() {
+    const stack = await signInStack(SIGNS_IN_AGAIN);
+    stack.setup.signIn.done = true;
+    stack.setup.signIn.owner = 'admin';
+    await mkdir(join(stack.home, 'appdata', 'sonarr', 'signed-in.txt'), {
+      recursive: true,
+    });
+    expect((await stack.run()).outcome).toBe('success');
+    const rotated = () =>
+      plan(
+        options(
+          stack.home,
+          fakeDocker(stack.home, { addresses: stack.setup.addresses }),
+          {
+            catalog: SIGNS_IN_AGAIN,
+            wiring: stack.setup.seams,
+            rotate: ['admin.password'],
+          },
+        ),
+      );
+    return { ...stack, rotated };
+  }
+
+  it('holds once, with one warning, a setup found open that signs in with what is rotated, through an app without the password', async () => {
+    const { home, setup, rotated } = await askedStack();
+    const store = await readSecretStore(home);
+    await writeSecretStore(home, {
+      ...store,
+      shared: { ...store.shared, adminPasswordNotIn: ['jellyfin'] },
+    });
+    setup.signIn.done = false;
+    setup.signIn.owner = undefined;
+    const held = await rotated();
+    expect(held.bootstrap).toEqual([]);
+    expect(
+      held.diagnostics
+        .filter((d) => d.code === 'bootstrap.needs-password')
+        .map((d) => d.message),
+    ).toEqual([
+      "sonarr's first-run setup signs in through jellyfin, which doesn't have the admin password Mediaplane gives the apps yet: it is held, and waits until jellyfin has it",
+    ]);
+  });
+
+  it('sets up again a setup that signs in with what is rotated, through an app whose own setup makes the admin first', async () => {
+    const { home, setup, rotated } = await askedStack();
+    // Jellyfin's appdata was reset: its wizard is open, and makes the admin, with the
+    // rotated password, before Sonarr signs in through it. Sonarr, after it, can't be
+    // asked meanwhile, so it is set up again, unpublished (fail closed).
+    setup.state.done = false;
+    await rm(join(home, 'appdata', 'jellyfin', 'setup.txt'));
+    const planned = await rotated();
+    expect(planned.diagnostics.map((d) => d.code)).not.toContain(
+      'bootstrap.needs-password',
+    );
+    expect(planned.bootstrap).toEqual([
+      { app: 'jellyfin', unpublished: true },
+      { app: 'sonarr', unpublished: true, again: true },
+    ]);
+  });
+
   it('keeps unpublished, and fails, an app with a setup but no API to finish it through', async () => {
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index 042201c..819af78 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -849,2 +849,48 @@ describe('wire', () => {
 
+  it('says only how mkdir exited when it fails with nothing on stderr', async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const { run, actions } = await wireWith(sonarr, {
+      stack: needingFolders(['/data/media/tv']),
+      runtime: fakeRuntime({
+        containers: RUNNING,
+        addresses: sonarr.addresses,
+        run: () => ({ code: 1, stdout: '', stderr: '\n' }),
+      }),
+    });
+    await run.catch(() => undefined);
+    expect(actions).toEqual([
+      {
+        step: 'wire',
+        resource: 'sonarr.login',
+        result: 'failed',
+        error:
+          'could not make /data/media/tv for sonarr.login: mkdir in a throwaway sonarr container exited 1',
+      },
+    ]);
+  });
+
+  it("stops the step at an error that isn't Docker's, as a bug, not a failure to make the folders", async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const bug = new TypeError('fake bug');
+    const { run, actions } = await wireWith(sonarr, {
+      stack: needingFolders(['/data/media/tv']),
+      runtime: fakeRuntime({
+        containers: RUNNING,
+        addresses: sonarr.addresses,
+        run: () => {
+          throw bug;
+        },
+      }),
+    });
+    const failure = await run.catch((thrown: unknown) => thrown);
+    expect(failure).toBeInstanceOf(WiringFailed);
+    expect((failure as WiringFailed).message).toBe('fake bug');
+    // Not said to be Docker's: no wire.folders, which says to look at the stack's mounts.
+    expect((failure as WiringFailed).diagnostics).toEqual([]);
+    expect(actions).toEqual([
+      { step: 'wire', resource: 'sonarr.login', result: 'failed', error: 'fake bug' },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
+  });
+
   it("keeps every secret out of a failure's message, whoever wrote it", async () => {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm exec vitest run packages/engine/src/apply/apply.test.ts packages/engine/src/integrations/wire.test.ts`

Expected: FAIL, three tests: `holds once, with one warning, …` with `expected [ …(2) ] to
deeply equal [ Array(1) ]` (held, and warned of, twice); `sets up again a setup that
signs in with what is rotated, …` with `expected [ 'bootstrap.unreadable', …(2) ] to not
include 'bootstrap.needs-password'`; `keeps unpublished an app that is set up when its
API is not ready in time, …` with `expected [ '/signed-in' ] to deeply equal []`. The two
folder-helper tests pass already: they pin what is.

- [ ] **Step 3: Hold the later setups with the rest, and ask a never-ready app once**

````diff
diff --git a/packages/engine/src/apply/bootstrap.ts b/packages/engine/src/apply/bootstrap.ts
index 0e0cc10..3c4aae4 100644
--- a/packages/engine/src/apply/bootstrap.ts
+++ b/packages/engine/src/apply/bootstrap.ts
@@ -415,2 +415,9 @@ async function setUp(
     await client.api.ready(api.ready);
+  } catch (cause) {
+    // Not ready by the deadline: asking it whether its setup is open would only wait as
+    // long again. Unasked is open (fail closed), so it stays unpublished.
+    if (!(cause instanceof AppApiError)) throw cause;
+    return { failure: cause.message, open: true };
+  }
+  try {
     const key = await bootstrap.run(client.api, admin, started.stack, started.ctx);
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index c9a9d55..1214792 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -498,2 +498,7 @@ export async function planStack(
     );
+  // An app whose appdata can't say whether its setup is done, asked itself: set up again,
+  // unpublished, unless it said its setup is done (fail closed: one that couldn't be asked
+  // is too). Its wiring is then checked after the start, as for any app set up first.
+  const reopened = (setups.ask ?? []).filter((app) => open[app] !== false);
+  // One set up afresh signs in with what you rotate anyway: it is listed once, as reopened.
   const signingInAgain = stack.apps.filter(
@@ -501,26 +506,27 @@ export async function planStack(
       signsInAgain(app.def.id) &&
+      !reopened.includes(app.def.id) &&
       ![...bootstrap, ...held].some((b) => b.app === app.def.id),
   );
-  // Held like any other setup: one that signs in with what you rotate never signs in
-  // with a password apply is yet to generate (Seerr's Plex sign-in takes plex.token only).
-  const signing = await withoutSignInsToCome(
+  // Held like any other setup, in one pass with the rest, so that the order of the
+  // catalog never matters: one that signs in with what you rotate, or is set up afresh,
+  // never signs in with a password apply is yet to generate, nor through an app that
+  // lacks it, unless that app's own setup, in the plan too, makes the admin with it first.
+  const later = await withoutSignInsToCome(
     stack,
-    signingInAgain.map((app) => ({ app: app.def.id, unpublished: false })),
+    [
+      ...signingInAgain.map((app) => ({ app: app.def.id, unpublished: false })),
+      ...reopened.map((app) => ({ app, unpublished: true })),
+    ],
     toCome,
   );
-  const signingThrough = await heldThrough(
+  const through = await heldThrough(
     stack,
-    signing.changes,
-    [...held, ...signing.held],
+    [...bootstrap, ...later.changes],
+    [...held, ...later.held],
     toCome,
   );
-  bootstrap = [...bootstrap, ...signingThrough.changes];
-  held.push(...signing.held, ...signingThrough.held);
-  diagnostics.push(...signing.diagnostics, ...signingThrough.diagnostics);
-  // An app whose appdata can't say whether its setup is done, asked itself: set up again,
-  // unpublished, unless it said its setup is done (fail closed: one that couldn't be asked
-  // is too). Its wiring is then checked after the start, as for any app set up first. Held
-  // like any other setup, if it would sign in with a password never given, or through an
-  // app that lacks it.
-  const reopened = (setups.ask ?? []).filter((app) => open[app] !== false);
+  bootstrap = through.changes;
+  held.push(...later.held, ...through.held);
+  diagnostics.push(...later.diagnostics, ...through.diagnostics);
+  if (hasErrors(diagnostics)) return failed(diagnostics);
   if (reopened.length > 0) {
@@ -528,21 +534,2 @@ export async function planStack(
       reopened.some((app) => resource === app || resource.startsWith(`${app}.`));
-    const again = await withoutSignInsToCome(
-      stack,
-      reopened.map((app) => ({ app, unpublished: true })),
-      toCome,
-    );
-    const through = await heldThrough(
-      stack,
-      again.changes,
-      [...held, ...again.held],
-      toCome,
-    );
-    // Set up afresh, unpublished: Seerr, found set up when it is, signs in again.
-    bootstrap = [
-      ...bootstrap.filter((b) => !reopened.includes(b.app)),
-      ...through.changes,
-    ];
-    held.push(...again.held, ...through.held);
-    diagnostics.push(...again.diagnostics, ...through.diagnostics);
-    if (hasErrors(diagnostics)) return failed(diagnostics);
     containers = recreating(containers, new Set(reopened));
````

- [ ] **Step 4: Run them, and see them pass**

Run the command of Step 2. Expected: PASS.

- [ ] **Step 5: The full check, and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "fix(engine): hold each first-run setup once, whatever the catalog's order, and wait once for one never ready" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The end-to-end harness and CI: images pulled first, leftovers removed, and the test gaps

Decisions 13, 14. And the roadmap's test gaps: `servarrFailure` on one line, the deploy
test on `deployMediaplane()`, Jellyfin's claims split, FlareSolverr's appdata owner,
`wireguard.ts`'s flag, and the nightly Plex job's two items.

**Files:**

- Create: `scripts/ci/pull-images.ts` and its test, `test/e2e/setup.ts`,
  `test/e2e/helpers.unit.test.ts`
- Change: `.github/workflows/ci.yml`, `test/e2e/helpers.ts`, `test/e2e/wireguard.ts`,
  `vitest.config.ts`, `vitest.e2e.config.ts`
- Change (end-to-end): `test/e2e/deploy.e2e.test.ts`, `test/e2e/jellyfin.e2e.test.ts`,
  `test/e2e/indexers.e2e.test.ts`, `test/e2e/plex.e2e.test.ts`
- Test: `scripts/ci/ci-workflow.test.ts`

**Interfaces:**

- Consumes: `isTransientPullError` (`@mediaplane/engine`), `catalogImages`
  (`scripts/ci/catalog-images.ts`).
- Produces: `PRE_PULL_DELAYS_MS: readonly number[]`, `suiteFiles(root?): string[]`,
  `suiteImages(arch: Arch, root?): string[]`, `pullWithRetries(image: string, exec?:
  Exec, sleep?): Promise<{ ok: true; retries: number } | { ok: false; error: string }>`
  (`scripts/ci/pull-images.ts`); in `test/e2e/helpers.ts`: `SERVARR_FAILURE_MAX`,
  `WORKER_PREFIX` (`mediaplane-e2e-<pid>`), `ownName(name, prefix?)`, `leftovers(prefix?)`,
  `removeLeftovers(prefix?): Promise<string[]>`.

- [ ] **Step 1: Write the failing tests**

The harness's own unit tests run with `pnpm test`:

````diff
diff --git a/vitest.config.ts b/vitest.config.ts
index 8cff0c7..741b061 100644
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -9,2 +9,4 @@ export default defineConfig({
       'deploy/**/*.test.ts',
+      // The end-to-end harness's own unit tests; the suite itself is vitest.e2e.config.ts's.
+      'test/e2e/*.unit.test.ts',
     ],
````

Create `test/e2e/helpers.unit.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { ownName, SERVARR_FAILURE_MAX, servarrFailure } from './helpers';

const KEY = 'f'.repeat(32);

/** An arr's answer of validation errors, as Sonarr gives one. */
function refused(errors: { propertyName: string; errorMessage: string }[]): Response {
  return new Response(JSON.stringify(errors), { status: 400 });
}

describe('servarrFailure', () => {
  it("gives an arr's own words on one short line, with no secret", async () => {
    const said = await servarrFailure(
      refused([
        { propertyName: 'ApiKey', errorMessage: `Unable to connect\nwith ${KEY}` },
        { propertyName: 'Host', errorMessage: 'x'.repeat(400) },
      ]),
      [KEY],
    );
    expect(said).not.toContain(KEY);
    expect(said).not.toContain('\n');
    expect(
      said.startsWith('status 400: ApiKey: Unable to connect with ***; Host: x'),
    ).toBe(true);
    expect(said.length).toBe('status 400: '.length + SERVARR_FAILURE_MAX + 1);
    expect(said.endsWith('…')).toBe(true);
  });

  it('leaves a short answer whole', async () => {
    expect(
      await servarrFailure(
        refused([{ propertyName: 'Path', errorMessage: 'Invalid' }]),
        [],
      ),
    ).toBe('status 400: Path: Invalid');
  });
});

describe('ownName', () => {
  it("is this worker's project, its containers and networks, and no other worker's", () => {
    const prefix = 'mediaplane-e2e-123';
    for (const name of [
      prefix,
      `${prefix}-vpn`,
      `${prefix}_wiring`,
      `${prefix}-vpn-system`,
    ]) {
      expect(ownName(name, prefix), name).toBe(true);
    }
    for (const name of [
      'mediaplane-e2e-1234',
      'mediaplane',
      'other-mediaplane-e2e-123',
    ]) {
      expect(ownName(name, prefix), name).toBe(false);
    }
  });
});
````

Create `scripts/ci/pull-images.test.ts`:

````ts
import { catalog } from '@mediaplane/catalog';
import type { Exec } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { pinnedImage } from './catalog-images';
import { PRE_PULL_DELAYS_MS, pullWithRetries, suiteImages } from './pull-images';

describe('suiteImages', () => {
  it("lists the catalog's images for the architecture, and every image the suite pins", () => {
    const images = suiteImages('arm64');
    for (const def of catalog.filter((d) => d.arch.includes('arm64'))) {
      expect(images).toContain(pinnedImage(def));
    }
    for (const name of [
      'busybox:',
      'lscr.io/linuxserver/wireguard:',
      'registry:',
      'node:',
      'docker:',
      'wollomatic/socket-proxy:',
    ]) {
      expect(
        images.some((image) => image.startsWith(name)),
        name,
      ).toBe(true);
    }
    expect(images).toEqual([...new Set(images)].sort());
    for (const image of images) expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });
});

describe('pullWithRetries', () => {
  /** An exec whose docker pull answers each of `answers` in turn: an error, or success. */
  function pulls(answers: (string | undefined)[]) {
    const calls: string[][] = [];
    const exec: Exec = (command, args) => {
      calls.push([command, ...args]);
      const error = answers.shift();
      return Promise.resolve(
        error === undefined
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 1, stdout: '', stderr: error },
      );
    };
    const slept: number[] = [];
    const sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    return { exec, sleep, calls, slept };
  }

  const LIMITED = 'toomanyrequests: You have reached your pull rate limit.';

  it('pulls again after a temporary registry error, waiting longer than apply does', async () => {
    const { exec, sleep, calls, slept } = pulls([
      LIMITED,
      'net/http: TLS handshake timeout',
    ]);
    expect(await pullWithRetries('busybox:1@sha256:fake', exec, sleep)).toEqual({
      ok: true,
      retries: 2,
    });
    expect(calls[0]).toEqual(['docker', 'pull', '--quiet', 'busybox:1@sha256:fake']);
    expect(slept).toEqual([15_000, 30_000]);
  });

  it('fails at once for what waiting will not fix', async () => {
    const { exec, sleep, slept } = pulls(['manifest unknown: manifest unknown']);
    expect(await pullWithRetries('busybox:1@sha256:fake', exec, sleep)).toEqual({
      ok: false,
      error: 'manifest unknown: manifest unknown',
    });
    expect(slept).toEqual([]);
  });

  it('gives up after its last wait, with the last error', async () => {
    const { exec, sleep, calls, slept } = pulls(
      Array.from({ length: 10 }, () => LIMITED),
    );
    expect(await pullWithRetries('busybox:1@sha256:fake', exec, sleep)).toEqual({
      ok: false,
      error: LIMITED,
    });
    expect(slept).toEqual(PRE_PULL_DELAYS_MS);
    expect(calls).toHaveLength(PRE_PULL_DELAYS_MS.length + 1);
  });
});
````

````diff
diff --git a/scripts/ci/ci-workflow.test.ts b/scripts/ci/ci-workflow.test.ts
index be1c45a..280179b 100644
--- a/scripts/ci/ci-workflow.test.ts
+++ b/scripts/ci/ci-workflow.test.ts
@@ -8,3 +8,3 @@ interface Job {
   env?: Record<string, string>;
-  steps: { run?: string; env?: Record<string, string> }[];
+  steps: { run?: string; uses?: string; env?: Record<string, string> }[];
 }
@@ -16,2 +16,18 @@ const ci = parse(text) as {
 
+describe("the end-to-end job's images", () => {
+  it('pulls every image the suite runs first, with retries, once logged in to Docker Hub', () => {
+    const steps = ci.jobs.e2e?.steps ?? [];
+    const at = (find: (step: Job['steps'][number]) => boolean) => steps.findIndex(find);
+    const login = at((step) => step.uses === './.github/actions/docker-hub-login');
+    const pull = at(
+      (step) =>
+        step.run === 'pnpm exec tsx scripts/ci/pull-images.ts "${{ matrix.arch }}"',
+    );
+    const suite = at((step) => step.run === 'pnpm test:e2e');
+    expect(login).toBeGreaterThanOrEqual(0);
+    expect(pull).toBeGreaterThan(login);
+    expect(suite).toBeGreaterThan(pull);
+  });
+});
+
 describe('the catalog scan switch in ci.yml (spec §7.2(7))', () => {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm exec vitest run scripts/ci/pull-images.test.ts scripts/ci/ci-workflow.test.ts test/e2e/helpers.unit.test.ts`

Expected: FAIL. `pull-images.test.ts` with `Cannot find module './pull-images'`;
`ci-workflow.test.ts`'s new test with `expected -1 to be greater than 5` (no pull step);
`helpers.unit.test.ts` with `expected 'status 400: ApiKey: Unable to connect…' not to
contain '\n'` and `TypeError: ownName is not a function`.

- [ ] **Step 3: Pull the suite's images first, in CI**

Create `scripts/ci/pull-images.ts`:

````ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { catalog } from '@mediaplane/catalog';
import { isTransientPullError, nodeExec, type Arch, type Exec } from '@mediaplane/engine';
import { ranAsScript, ROOT } from '../root';
import { catalogImages } from './catalog-images';

/**
 * How long CI waits before each retry of an image pull that failed with a temporary
 * registry error: longer than apply's own (5, 15 and 45 seconds), which stays as it is.
 * CI's runners pull every image afresh, and a temporary registry error failed
 * end-to-end jobs that passed on a rerun (pull requests 17 to 19).
 */
export const PRE_PULL_DELAYS_MS: readonly number[] = [
  15_000, 30_000, 60_000, 120_000, 240_000,
];

/** An image pinned by tag and digest, as every image outside the catalog is written. */
const PINNED = /[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}/g;

/**
 * The files whose pinned images the end-to-end suite runs besides the catalog's: its own
 * test servers, Mediaplane's image's bases, and the socket proxy it deploys.
 */
export function suiteFiles(root = ROOT): string[] {
  const tests = readdirSync(join(root, 'test/e2e'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `test/e2e/${name}`);
  return [...tests.sort(), 'Dockerfile', 'deploy/mediaplane.compose.yaml'];
}

/** Every image the end-to-end suite runs on `arch`, once each, sorted. */
export function suiteImages(arch: Arch, root = ROOT): string[] {
  const pinned = suiteFiles(root).flatMap((path) => [
    ...readFileSync(join(root, path), 'utf8').matchAll(PINNED),
  ]);
  return [
    ...new Set([...catalogImages(catalog, arch), ...pinned.map((match) => match[0])]),
  ].sort();
}

/**
 * `docker pull <image>`, tried again after a temporary registry error, as apply decides
 * one (isTransientPullError), with CI's longer waits. Anything else fails at once.
 */
export async function pullWithRetries(
  image: string,
  exec: Exec = nodeExec,
  sleep: (ms: number) => Promise<unknown> = delay,
): Promise<{ ok: true; retries: number } | { ok: false; error: string }> {
  for (let retries = 0; ; retries++) {
    const pulled = await exec('docker', ['pull', '--quiet', image], {
      cwd: '/',
      timeoutMs: 1_800_000,
    });
    if (pulled.code === 0) return { ok: true, retries };
    const error = pulled.stderr.trim();
    const wait = PRE_PULL_DELAYS_MS[retries];
    if (!isTransientPullError(error) || wait === undefined) return { ok: false, error };
    await sleep(wait);
  }
}

async function main(arch: string | undefined): Promise<number> {
  if (arch !== 'amd64' && arch !== 'arm64') {
    console.error('usage: pull-images.ts <amd64|arm64>');
    return 1;
  }
  for (const image of suiteImages(arch)) {
    const pulled = await pullWithRetries(image);
    if (!pulled.ok) {
      console.error(`error: could not pull ${image}: ${pulled.error}`);
      return 1;
    }
    console.log(
      `pulled ${image}${pulled.retries === 0 ? '' : `, after ${String(pulled.retries)} retries`}`,
    );
  }
  return 0;
}

if (ranAsScript(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv[2]);
}
````

````diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 0f82149..c965110 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -137,2 +137,7 @@ jobs:
       - run: docker version && docker compose version
+      # Every image the suite runs, pulled first with longer retries than apply's own, so
+      # that a temporary registry error doesn't fail the job. apply pulls only what is
+      # missing, so what it does and reports is unchanged.
+      - name: Pull the images the tests run
+        run: pnpm exec tsx scripts/ci/pull-images.ts "${{ matrix.arch }}"
       # The kill-switch test's WireGuard server needs the kernel module, and can't load it
````

- [ ] **Step 4: Remove what a file's tests leave, and close the helpers' gaps**

````diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index abb8d41..8485407 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -128,2 +128,66 @@ export async function expectWiringRemoved(project: string): Promise<void> {
 
+/** The names of this worker's Docker objects: every test's start with it. */
+export const WORKER_PREFIX = `mediaplane-e2e-${String(process.pid)}`;
+
+/** Whether `name` is one of this worker's (`<prefix>`, `<prefix>-…` or `<prefix>_…`). */
+export function ownName(name: string, prefix = WORKER_PREFIX): boolean {
+  return (
+    name === prefix || name.startsWith(`${prefix}-`) || name.startsWith(`${prefix}_`)
+  );
+}
+
+/**
+ * What this worker's tests left in Docker: the Compose projects, Mediaplane's own first
+ * (its container is on the stack's wiring network, which the stack's down can't remove
+ * while it is there), the other containers, and the networks.
+ */
+export async function leftovers(prefix = WORKER_PREFIX): Promise<{
+  projects: string[];
+  containers: string[];
+  networks: string[];
+}> {
+  const lines = async (...args: string[]) =>
+    (await docker(...args))
+      .split('\n')
+      .map((line) => line.trim())
+      .filter((line) => line !== '');
+  const all = await lines(
+    'ps',
+    '-a',
+    '--format',
+    '{{.Names}} {{.Label "com.docker.compose.project"}}',
+  );
+  const projects = [
+    ...new Set(
+      all.map((line) => line.split(' ')[1] ?? '').filter((p) => ownName(p, prefix)),
+    ),
+  ].sort((a, b) => Number(b.endsWith('-system')) - Number(a.endsWith('-system')));
+  const containers = all
+    .filter((line) => (line.split(' ')[1] ?? '') === '')
+    .map((line) => line.split(' ')[0] ?? '')
+    .filter((name) => ownName(name, prefix));
+  const networks = (await lines('network', 'ls', '--format', '{{.Name}}')).filter(
+    (name) => ownName(name, prefix),
+  );
+  return { projects, containers, networks };
+}
+
+/**
+ * Remove what this worker's tests left in Docker, and say what that was: a test that
+ * times out leaves its body running and skips the teardown at its end, so the suite's
+ * setup (test/e2e/setup.ts) runs this once each file is done.
+ */
+export async function removeLeftovers(prefix = WORKER_PREFIX): Promise<string[]> {
+  const left = await leftovers(prefix);
+  await runTeardown([
+    ...left.projects.map((project) => async () => {
+      const down = await composeDown(project);
+      if (down.code !== 0) throw new Error(`compose down ${project}: ${down.stderr}`);
+    }),
+    ...left.containers.map((name) => () => removeOrIgnoreMissing('rm', '-f', '-v', name)),
+    ...left.networks.map((name) => () => removeOrIgnoreMissing('network', 'rm', name)),
+  ]);
+  return [...left.projects, ...left.containers, ...left.networks];
+}
+
 /**
@@ -245,7 +309,11 @@ export async function jsonBody<T>(response: Response, what: string): Promise<T>
 
+/** The most of an arr's own words servarrFailure gives: one short line of CI's log. */
+export const SERVARR_FAILURE_MAX = 200;
+
 /**
  * Why an arr refused a request, safe for CI's public log: the status, and each validation
- * error's `propertyName: errorMessage`, with every one of `secrets` replaced. Never the
- * raw body, nor an error's `attemptedValue`, which can be the key under test. A body that
- * isn't such a list gives only its length.
+ * error's `propertyName: errorMessage`, with every one of `secrets` replaced, on one line
+ * cut to SERVARR_FAILURE_MAX characters. Never the raw body, nor an error's
+ * `attemptedValue`, which can be the key under test. A body that isn't such a list gives
+ * only its length.
  */
@@ -273,8 +341,11 @@ export async function servarrFailure(
   });
-  return secrets
+  // Each secret replaced before the line is cut, so that no part of one is left.
+  const line = secrets
     .filter((secret) => secret !== '')
-    .reduce(
-      (message, secret) => message.replaceAll(secret, '***'),
-      `${status}: ${said.join('; ')}`,
-    );
+    .reduce((message, secret) => message.replaceAll(secret, '***'), said.join('; '))
+    .replaceAll(/\s+/g, ' ')
+    .trim();
+  const cut =
+    line.length > SERVARR_FAILURE_MAX ? `${line.slice(0, SERVARR_FAILURE_MAX)}…` : line;
+  return `${status}: ${cut}`;
 }
diff --git a/test/e2e/wireguard.ts b/test/e2e/wireguard.ts
index 4eb21e1..ade322a 100644
--- a/test/e2e/wireguard.ts
+++ b/test/e2e/wireguard.ts
@@ -115,3 +115,2 @@ export async function startWireGuard(id: string): Promise<WireGuardServer> {
     if (removed) return;
-    removed = true;
     // Every removal runs, even when one before it fails; the failures are reported after.
@@ -136,2 +135,4 @@ export async function startWireGuard(id: string): Promise<WireGuardServer> {
     }
+    // Only once it is all gone: a removal that failed is tried again by the next call.
+    removed = true;
   };
````

Create `test/e2e/setup.ts`:

````ts
import { afterAll } from 'vitest';
import { removeLeftovers, TEARDOWN_MS } from './helpers';

// Every end-to-end file, once its tests are done: whatever they left in Docker is
// removed, and named, so a teardown that missed something fails the file. A test that
// times out leaves its body running, and its own teardown never runs.
afterAll(async () => {
  const left = await removeLeftovers();
  if (left.length > 0) {
    throw new Error(`the tests left these behind, now removed: ${left.join(', ')}`);
  }
}, 6 * TEARDOWN_MS);
````

````diff
diff --git a/vitest.e2e.config.ts b/vitest.e2e.config.ts
index dc3c132..db31890 100644
--- a/vitest.e2e.config.ts
+++ b/vitest.e2e.config.ts
@@ -5,2 +5,4 @@ export default defineConfig({
     include: ['test/e2e/**/*.e2e.test.ts'],
+    // After each file: what its tests left in Docker, removed.
+    setupFiles: ['test/e2e/setup.ts'],
     fileParallelism: false,
````

- [ ] **Step 5: Run them, and see them pass**

Run the command of Step 2. Expected: PASS.

- [ ] **Step 6: The end-to-end gaps**

The deploy test deploys with `deployMediaplane()`, whose container is
`<stack>-mediaplane` and project `<stack>-system`; Jellyfin's two claims are split;
FlareSolverr's appdata is its image user's; and the nightly Plex test checks the files
and `.env` after the claim again, and that it took two more claim tokens (probe 11):

````diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index 4d7b9e6..6b65836 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -3,3 +3,3 @@ import { createServer, type Server } from 'node:net';
 import { tmpdir } from 'node:os';
-import { dirname, join } from 'node:path';
+import { join } from 'node:path';
 import {
@@ -15,4 +15,4 @@ import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import {
-  buildImage,
   composeDown,
+  deployMediaplane,
   docker,
@@ -26,3 +26,3 @@ import {
   setServarrSetting,
-  TEARDOWN_MS,
+  type DeployedMediaplane,
 } from './helpers';
@@ -30,9 +30,6 @@ import {
 const ID = `mediaplane-e2e-${String(process.pid)}`;
-const TAG = `mediaplane-e2e:${String(process.pid)}-deploy`;
-/** Mediaplane's own project, deployed from mediaplane.compose.yaml. */
-const SYSTEM = `${ID}-system`;
 /** The stack Mediaplane manages from inside its container. */
 const STACK = `${ID}-stack`;
-const CONTAINER = `${ID}-mediaplane`;
-const DEPLOY = join(REPO, 'deploy', 'mediaplane.compose.yaml');
+/** Mediaplane's own container, as deployMediaplane names it. */
+const CONTAINER = `${STACK}-mediaplane`;
 const SHIM = join(REPO, 'deploy', 'mediaplane');
@@ -61,24 +58,4 @@ let home = '';
 let data = '';
-let override = '';
-let env: NodeJS.ProcessEnv = {};
-
-/** docker compose on Mediaplane's own project, as a user would run it. */
-function system(args: readonly string[], timeoutMs = 300_000): Promise<ExecResult> {
-  return nodeExec(
-    'docker',
-    [
-      'compose',
-      '-p',
-      SYSTEM,
-      '--env-file',
-      '/dev/null',
-      '-f',
-      DEPLOY,
-      '-f',
-      override,
-      ...args,
-    ],
-    { env, cwd: '/', timeoutMs },
-  );
-}
+/** Mediaplane, deployed as a user deploys it: undefined until it is. */
+let deployed: DeployedMediaplane | undefined;
 
@@ -183,3 +160,2 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
   beforeAll(async () => {
-    await buildImage(TAG);
     home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
@@ -187,27 +163,3 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     await writeFile(join(home, 'stack.yaml'), smallStack(data));
-    override = join(
-      await mkdtemp(join(tmpdir(), 'mediaplane-e2e-system-')),
-      'override.yaml',
-    );
-    await writeFile(
-      override,
-      [
-        'services:',
-        '  mediaplane:',
-        `    container_name: ${CONTAINER}`,
-        '    environment:',
-        `      MEDIAPLANE_COMPOSE_PROJECT: ${STACK}`,
-        '',
-      ].join('\n'),
-    );
-    env = {
-      ...process.env,
-      MEDIAPLANE_IMAGE: TAG,
-      MEDIAPLANE_HOME: home,
-      MEDIAPLANE_UID: UID,
-      MEDIAPLANE_GID: GID,
-      DOCKER_GID: String((await stat('/var/run/docker.sock')).gid),
-    };
-    const up = await system(['up', '--detach', '--wait']);
-    if (up.code !== 0) throw new Error(`mediaplane-system did not start:\n${up.stderr}`);
+    deployed = await deployMediaplane({ home, stack: STACK });
   }, 1_200_000);
@@ -230,22 +182,12 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     };
-    // The deployment first: while Mediaplane's container is on the stack's wiring
-    // network, the stack's down can't remove that network, and leaves it behind.
-    if (override !== '') {
-      await attempt(() => succeeds(system(['down', '--remove-orphans'], TEARDOWN_MS)));
-    }
+    // The deployment first, and its image: while Mediaplane's container is on the
+    // stack's wiring network, the stack's down can't remove that network.
+    const removing = deployed;
+    if (removing !== undefined) await attempt(() => removing.remove());
     await attempt(() => succeeds(composeDown(STACK)));
     await attempt(() => expectWiringRemoved(STACK));
-    if (override !== '') {
-      await attempt(() => rm(dirname(override), { recursive: true, force: true }));
-    }
     if (home !== '') await attempt(() => removeHome(home));
     if (data !== '') await attempt(() => removeAsRoot(data));
-    // Last, once no container uses the image.
-    await attempt(() =>
-      succeeds(
-        nodeExec('docker', ['image', 'rm', TAG], { cwd: '/', timeoutMs: TEARDOWN_MS }),
-      ),
-    );
     if (failures.length > 0) throw new AggregateError(failures, 'teardown failed');
-    // Above the sum of the six bounded commands (6 × TEARDOWN_MS, 720 s).
+    // Above the sum of the bounded commands (6 × TEARDOWN_MS, 720 s).
   }, 900_000);
@@ -493,4 +435,4 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     expect(await networksOf(CONTAINER)).toEqual([
+      `${STACK}-system_docker-api internal=true`,
       `${STACK}_wiring internal=true`,
-      `${SYSTEM}_docker-api internal=true`,
     ]);
diff --git a/test/e2e/indexers.e2e.test.ts b/test/e2e/indexers.e2e.test.ts
index 6a9dd32..ccd1175 100644
--- a/test/e2e/indexers.e2e.test.ts
+++ b/test/e2e/indexers.e2e.test.ts
@@ -1,2 +1,2 @@
-import { readFile, writeFile } from 'node:fs/promises';
+import { readFile, stat, writeFile } from 'node:fs/promises';
 import { join } from 'node:path';
@@ -404,2 +404,5 @@ describe('indexers, through Prowlarr', () => {
       );
+      // Owned by its image's user, 1000, whatever user the stack runs as (runAs fixed).
+      const owner = await stat(join(home, 'appdata', 'flaresolverr'));
+      expect([owner.uid, owner.gid]).toEqual([1000, 1000]);
       expect(await expectLinks(prowlarr, 'flaresolverr')).toBe(cloudflare);
diff --git a/test/e2e/jellyfin.e2e.test.ts b/test/e2e/jellyfin.e2e.test.ts
index 0424782..285ec97 100644
--- a/test/e2e/jellyfin.e2e.test.ts
+++ b/test/e2e/jellyfin.e2e.test.ts
@@ -194,5 +194,8 @@ describe('Jellyfin, set up before it is published', () => {
       expect(
-        [ids[0] !== '' && ids[1] === ids[0], ids[2] !== ids[1]],
-        "Jellyfin's containers: set up in the unpublished one, published in a new one",
-      ).toEqual([true, true]);
+        ids[0] !== '' && ids[1] === ids[0],
+        "Jellyfin's wizard was finished in the container that started unpublished",
+      ).toBe(true);
+      expect(ids[2] !== ids[1], 'the publishing up made Jellyfin a new container').toBe(
+        true,
+      );
       expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
diff --git a/test/e2e/plex.e2e.test.ts b/test/e2e/plex.e2e.test.ts
index b71bd49..524b77e 100644
--- a/test/e2e/plex.e2e.test.ts
+++ b/test/e2e/plex.e2e.test.ts
@@ -638,2 +638,19 @@ describe.skipIf(PLEX_TOKEN_FILE === undefined)(
         ]);
+        // Two claim tokens more: the unpublished start's PLEX_CLAIM, which the image
+        // ignores for a Plex signed out (its Preferences.xml keeps the attribute), and the
+        // one the claim through Plex's API posts. None of them, nor Plex's new token, is in
+        // the files it wrote, change record included, nor in .env.
+        expect(claims.length, 'two claim tokens more, for the start and the claim').toBe(
+          3,
+        );
+        const reclaimSecrets = [...plexSecrets, after.serverToken, ...claims];
+        expectNoSecret('what the claim wrote', await writtenFiles(home), [
+          ...secrets,
+          ...reclaimSecrets,
+        ]);
+        expectNoSecret(
+          '.env after the claim',
+          await writtenFiles(home, { env: true }),
+          reclaimSecrets,
+        );
         expect((await apply(options)).outcome).toBe('no-changes');
````

Run (Docker, about 6 minutes warm): `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/deploy.e2e.test.ts test/e2e/jellyfin.e2e.test.ts test/e2e/indexers.e2e.test.ts`.
Expected: PASS, 8 tests, and nothing left in Docker. The Plex test's change runs in the
nightly job, or in the full suite with a test account's token (completion checklist).

Run, on the dev box: `pnpm exec tsx scripts/ci/pull-images.ts arm64` (`amd64` on an
amd64 host). Expected: one `pulled <image>` line per image, 16 on arm64, and exit 0.

- [ ] **Step 7: The full check, and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "test(e2e): pull CI's images first with retries, remove what a timed-out test leaves, and close the harness's gaps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Supply chain and the installer: what Renovate reads and says, and `DOCKER_HOST`

Decisions 15, 16, 17.

**Files:**

- Change: `deploy/install.sh`, `renovate.json`, `deploy/README.md`, `docs/releasing.md`
- Test: `deploy/deploy.test.ts`, `scripts/supply-chain.test.ts`, `catalog/catalog.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests**

The sandbox gains its socket's path, and leaves the shell's own `DOCKER_HOST` and
`DOCKER_CONTEXT` out of every run; every pinned tag, wherever it is written, must be one
Renovate reads; a bump of the image's `docker` must say what a change of Compose does;
a catalog tag must name a version:

````diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index ff54cda..550ec5a 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -522,4 +522,7 @@ apps:
   describe.each(catalog.map((app) => [app.id, app] as const))('%s', (_id, app) => {
+    // A tag that names a version (2.6.5.5623-ls163, v3.41.3, 12.2ubu2604-ls53), never one
+    // that moves (latest, stable, develop, nightly) or a major alone (v3).
     it('is pinned by exact tag and multi-arch digest', () => {
-      expect(app.image.tag).not.toBe('latest');
+      expect(app.image.tag).toMatch(/^v?\d+\.\d+/);
+      expect(app.image.tag).not.toMatch(/latest|stable|develop|nightly|edge/i);
       expect(app.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
diff --git a/deploy/deploy.test.ts b/deploy/deploy.test.ts
index b256448..2fc89ea 100644
--- a/deploy/deploy.test.ts
+++ b/deploy/deploy.test.ts
@@ -446,3 +446,3 @@ exit 0
           !name.startsWith('COMPOSE_') &&
-          name !== 'DOCKER_GID',
+          !['DOCKER_GID', 'DOCKER_HOST', 'DOCKER_CONTEXT'].includes(name),
       ),
@@ -483,3 +483,3 @@ exit 0
     };
-    return { top, deploy, parent, home, commands, run, cleanup };
+    return { top, deploy, parent, home, commands, socket: socketPath, run, cleanup };
   }
@@ -645,2 +645,25 @@ exit 0
 
+  it.runIf(asYou)(
+    "refuses a DOCKER_HOST or DOCKER_CONTEXT that points docker away from this host's socket, before it changes anything",
+    () =>
+      inSandbox({}, (box) => {
+        for (const [extra, said] of [
+          [{ DOCKER_HOST: 'tcp://192.0.2.10:2376' }, 'DOCKER_HOST is set'],
+          [{ DOCKER_CONTEXT: 'elsewhere' }, 'DOCKER_CONTEXT is set'],
+        ] as const) {
+          const result = box.run(extra);
+          expect(result.code).toBe(1);
+          expect(result.err).toContain(said);
+          changedNothing(box, result.calls);
+          expect(result.calls).toEqual([]);
+        }
+        // This host's socket, named as such, and the default context, are this host's.
+        const same = box.run({
+          DOCKER_HOST: `unix://${box.socket}`,
+          DOCKER_CONTEXT: 'default',
+        });
+        expect(same.code, same.err).toBe(0);
+      }),
+  );
+
   it.runIf(asYou)(
diff --git a/scripts/supply-chain.test.ts b/scripts/supply-chain.test.ts
index 2a70c3b..1419d07 100644
--- a/scripts/supply-chain.test.ts
+++ b/scripts/supply-chain.test.ts
@@ -116,2 +116,12 @@ function repoFiles(): string[] {
 
+/**
+ * Files that show a pin rather than pin it: the app READMEs and the golden files show the
+ * catalog's, which docs:generate and the tests rewrite; a plan is the record of what was
+ * built, its pins as they were then.
+ */
+const showsPins = (path: string) =>
+  path.startsWith('docs/plans/') ||
+  /^catalog\/[^/]+\/README\.md$/.test(path) ||
+  path.includes('/__golden__/');
+
 describe('the workflows (spec §7.2(7))', () => {
@@ -211,11 +221,5 @@ describe('every image is pinned by digest (spec §7.2(7))', () => {
     ];
-    // The catalog's pins are the catalog manager's; the app READMEs and the golden files
-    // show them, and docs:generate and the tests rewrite those. A plan is the record of
-    // what was built, its pins as they were then.
-    const shown = (path: string) =>
-      path.startsWith('docs/plans/') ||
-      /^catalog\/[^/]+\/README\.md$/.test(path) ||
-      path.includes('/__golden__/');
+    // The catalog's pins are the catalog manager's.
     const pinned = repoFiles().filter(
-      (path) => !shown(path) && [...read(path).matchAll(PINNED)].length > 0,
+      (path) => !showsPins(path) && [...read(path).matchAll(PINNED)].length > 0,
     );
@@ -282,11 +286,20 @@ describe('Renovate (spec §8.2)', () => {
 
-  it('can read every pinned tag, so that it can find a newer one', () => {
-    const tags = new Map<string, string>(
-      catalog.map((def) => [def.image.repo, def.image.tag]),
-    );
-    const wireguard = /'lscr\.io\/linuxserver\/wireguard:([^@']+)@/.exec(
-      read('test/e2e/wireguard.ts'),
-    );
-    tags.set('lscr.io/linuxserver/wireguard', wireguard?.[1] ?? '');
-    const versioned = new Set<string>();
+  it("can read every pinned tag, the catalog's and every other, so that it can find a newer one", () => {
+    // Each image, as [name, tag]: the catalog's, and every image pinned outside it
+    // (busybox, Trivy, gitleaks, actionlint, Node, Docker, the socket proxy, BuildKit and
+    // its SBOM scanner, the registry, the WireGuard test server), wherever it is written.
+    const tags: [string, string][] = catalog.map((def) => [
+      def.image.repo,
+      def.image.tag,
+    ]);
+    for (const path of repoFiles().filter((p) => !showsPins(p))) {
+      for (const [image] of read(path).matchAll(PINNED)) {
+        const named = image.slice(0, image.indexOf('@'));
+        const colon = named.lastIndexOf(':');
+        tags.push([named.slice(0, colon), named.slice(colon + 1)]);
+      }
+    }
+    expect(tags.some(([name]) => name === 'wollomatic/socket-proxy')).toBe(true);
+    expect(tags.some(([name]) => name === 'moby/buildkit')).toBe(true);
+    const rules = new Map<string, RegExp>();
     for (const rule of renovate.packageRules) {
@@ -294,10 +307,9 @@ describe('Renovate (spec §8.2)', () => {
       const re = new RegExp(rule.versioning.slice('regex:'.length));
-      for (const name of rule.matchDepNames ?? []) {
-        expect(tags.get(name), name).toMatch(re);
-        versioned.add(name);
-      }
+      for (const name of rule.matchDepNames ?? []) rules.set(name, re);
     }
-    // The rest are plain versions, which Renovate's Docker versioning reads.
     for (const [name, tag] of tags) {
-      if (!versioned.has(name)) expect(tag, name).toMatch(/^v?\d+\.\d+\.\d+$/);
+      // Its own rule's, or Renovate's Docker versioning: a version of two to four
+      // numbers, and a suffix it keeps (-alpine3.24, -cli, -dind).
+      const readable = rules.get(name) ?? /^v?\d+(?:\.\d+){1,3}(?:-[a-z][a-z0-9.]*)?$/;
+      expect(tag, `${name}:${tag}`).toMatch(readable);
     }
@@ -305,2 +317,13 @@ describe('Renovate (spec §8.2)', () => {
 
+  it("says, on a bump of the image's Docker CLI, what a change of its Compose does", () => {
+    const rule = renovate.packageRules.find(
+      (r) =>
+        r.matchFileNames?.join() === 'Dockerfile' && r.matchDepNames?.join() === 'docker',
+    );
+    const notes = rule?.prBodyNotes?.join(' ') ?? '';
+    expect(notes).toContain('compose version');
+    expect(notes).toContain('recreate every app container');
+    expect(notes).toContain('docs/releasing.md');
+  });
+
   it('never merges an app pin by itself, and says to regenerate the docs', () => {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm exec vitest run deploy/deploy.test.ts scripts/supply-chain.test.ts catalog/catalog.test.ts`

Expected: FAIL, two tests: `refuses a DOCKER_HOST or DOCKER_CONTEXT …` with `expected +0
to be 1` (the installer went ahead), and `says, on a bump of the image's Docker CLI, what
a change of its Compose does` with `expected '' to contain 'compose version'`. The tags
test and the catalog's pass already: every tag today is one Renovate reads, and names a
version.

- [ ] **Step 3: Refuse another Docker, and say what a Compose bump does**

````diff
diff --git a/deploy/install.sh b/deploy/install.sh
index b32c7c9..9f6edaa 100755
--- a/deploy/install.sh
+++ b/deploy/install.sh
@@ -106,2 +106,10 @@ command -v docker >/dev/null 2>&1 ||
   fail "Docker isn't installed: install Docker Engine 24 or newer, with its Compose plugin, then run this again"
+# docker and Compose talk to the Docker that DOCKER_HOST or DOCKER_CONTEXT names, which may
+# be another host's; the installer checks this host's socket, which the deployment mounts.
+if [ -n "${DOCKER_HOST:-}" ] && [ "$DOCKER_HOST" != "unix://$socket" ]; then
+  fail "DOCKER_HOST is set, so docker would use another Docker than this host's, at $socket, which Mediaplane's container uses: unset DOCKER_HOST, then run this again"
+fi
+if [ -n "${DOCKER_CONTEXT:-}" ] && [ "$DOCKER_CONTEXT" != default ]; then
+  fail "DOCKER_CONTEXT is set, so docker would use another Docker than this host's, at $socket, which Mediaplane's container uses: unset DOCKER_CONTEXT, then run this again"
+fi
 docker info >/dev/null 2>&1 ||
diff --git a/renovate.json b/renovate.json
index d86e3a1..0b75de4 100644
--- a/renovate.json
+++ b/renovate.json
@@ -99,2 +99,10 @@
     },
+    {
+      "description": "The image's Docker CLI brings the Compose apply runs, and Compose versions can work out a service's configuration hash differently (docs/releasing.md)",
+      "matchFileNames": ["Dockerfile"],
+      "matchDepNames": ["docker"],
+      "prBodyNotes": [
+        "This bumps the Docker CLI in Mediaplane's image, and the Compose it brings. Check that Compose: `docker run --rm --entrypoint docker <the new docker image> compose version`. Compose 2.29 to 2.40 work out the stack's services alike, and so do 5.0 to 5.6, but 2.x and 5.x differ (probed 2026-10-29). If this bump moves Compose to another of those lines, or to one not probed yet, the first `apply` after the update may recreate every app container, and the release's notes must say so: see docs/releasing.md, \"When a release changes Compose\"."
+      ]
+    },
     {
````

````diff
diff --git a/deploy/README.md b/deploy/README.md
index 136b6a0..5f8f21f 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -121,2 +121,5 @@ you only a home it has just created, never a folder that was already there. With
   `deploy/.env`'s can move it to another project or file, and none can change the image.
+- **Only this host's Docker:** it refuses a `DOCKER_HOST` or `DOCKER_CONTEXT` that would
+  point `docker` at another Docker than the socket it checks, `/var/run/docker.sock`, which
+  Mediaplane's container uses. Unset them, then run it again.
   It pulls the image and the socket proxy's before it recreates anything; Docker checks
@@ -429,5 +432,7 @@ happens, the next `mediaplane plan` shows most apps as `recreate`, and the next
 recreates them once. Their data stays where it is. This has happened: Compose 5.5.1
-recreated containers that Compose 2.38.2 had made, from a file that had not changed. So
-the first `apply` after an update that changed the Compose in the image may recreate every
-app container, a restart that keeps their data and settings. The release's notes may
+recreated containers that Compose 2.38.2 had made, from a file that had not changed. What
+matters is Compose's line: 2.29 to 2.40 work out the stack's services alike, and so do 5.0
+to 5.6, but 2.x and 5.x differ ([Releasing](../docs/releasing.md) has the details). So the
+first `apply` after an update that moved the image's Compose to another line may recreate
+every app container, a restart that keeps their data and settings. The release's notes may
 say so, if whoever cut it added that ([Releasing](../docs/releasing.md) says how). To see
diff --git a/docs/releasing.md b/docs/releasing.md
index c4ef9b7..f2f89c5 100644
--- a/docs/releasing.md
+++ b/docs/releasing.md
@@ -88,2 +88,17 @@ keeps their data and settings.
 
+Which versions differ was probed on 2026-10-29, with `docker compose config --hash` on
+every service of two stacks Mediaplane renders (Jellyfin with the VPN, and Plex with
+FlareSolverr), for eleven releases of Compose:
+
+- 2.29.7, 2.33.1, 2.36.2, 2.38.2, 2.39.4 and 2.40.3 work out the same hash for every
+  service;
+- so do 5.0.2, 5.3.1, 5.5.1 and 5.6.1;
+- but a 2.x and a 5.x differ for every service but Byparr;
+- and 2.24.0, the oldest Compose Mediaplane takes, differs from the later 2.x for Gluetun
+  and qBittorrent.
+
+So what to check is whether the image's Compose moved to another of those lines, or to a
+version not probed yet. Renovate's pull request for a bump of the `docker` image in the
+`Dockerfile` says the same.
+
 Nothing writes this into a release's notes. The Compose is the one inside the `docker`
````

- [ ] **Step 4: Run them, and see them pass**

Run the command of Step 2. Expected: PASS.

- [ ] **Step 5: The full check, and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "fix(deploy): refuse a DOCKER_HOST or DOCKER_CONTEXT of another Docker, and pin what Renovate reads and says of a Compose bump" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The proof: a playbook, on real Docker

Decision 18. The roadmap's Proves line: "a playbook deploys a stack, removes an app from
it, and rebuilds the host, reading only the documented contract."

**Files:**

- Create: `test/e2e/playbook.e2e.test.ts`
- Change: `test/e2e/helpers.ts` (`deployMediaplane`'s commands wait as a script would)

**Interfaces:**

- Consumes: `deployMediaplane`, `makeHome`, `stackFor`, `composeDown`,
  `expectWiringRemoved`, `runTeardown` (`test/e2e/helpers.ts`); the published
  `docs/reference/json/<name>.schema.json` files (Task 2), read with `z.fromJSONSchema`.

- [ ] **Step 1: Write the test**

A first `apply` from the image waits for every app to be healthy, longer than the five
minutes `deployMediaplane`'s commands had:

````diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index 8485407..61cae9b 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -619,3 +619,4 @@ export async function deployMediaplane(options: {
         ],
-        { cwd: '/', timeoutMs: 300_000 },
+        // As long as a script would wait: a first apply waits for every app to be healthy.
+        { cwd: '/', timeoutMs: 1_200_000 },
       ),
````

Create `test/e2e/playbook.e2e.test.ts`:

````ts
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSecretStore } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  composeDown,
  deployMediaplane,
  expectWiringRemoved,
  makeHome,
  REPO,
  runTeardown,
  stackFor,
  type DeployedMediaplane,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-playbook`;

/**
 * Each documented --json shape, as a script reads it: the published JSON Schema file of
 * this release (docs/reference/json/), not the code it was generated from.
 */
async function publishedSchema(schema: string): Promise<z.ZodType> {
  const name = /^mediaplane\.([a-z-]+)\/v1$/.exec(schema)?.[1];
  if (name === undefined) throw new Error(`not a documented schema: ${schema}`);
  const file = join(REPO, 'docs', 'reference', 'json', `${name}.schema.json`);
  return z.fromJSONSchema(
    JSON.parse(await readFile(file, 'utf8')) as Parameters<typeof z.fromJSONSchema>[0],
  );
}

/** A document a command printed: its schema, `ok`, and the rest, as a script reads it. */
interface Document {
  schema: string;
  ok: boolean;
  [field: string]: unknown;
}

/** What each command's exit code is, by its document (docs/reference/cli.md). */
function documentedExit(command: string, doc: Document): number {
  if (!doc.ok) return 1;
  if (command === 'plan') return doc.changed === true ? 2 : 0;
  if (command === 'drift') return doc.clear === true ? 0 : 2;
  return 0;
}

/** Every secret the stack's state holds once apply has run: no document may hold one. */
let secrets: string[] = [];

/**
 * `mediaplane <command> … --json`, as a playbook runs it: `docker exec` with no terminal,
 * reading only its exit code and the one document it prints, which must be its documented
 * shape, exactly, and hold no secret. Its own text is never shown: it could hold what the
 * command printed of an app.
 */
async function run(
  mediaplane: DeployedMediaplane,
  command: string,
  ...args: string[]
): Promise<{ code: number; doc: Document }> {
  const result = await mediaplane.mediaplane([command, ...args, '--json']);
  let doc: Document;
  try {
    doc = JSON.parse(result.stdout) as Document;
  } catch {
    throw new Error(
      `mediaplane ${command} --json printed no single JSON document (exit ${String(result.code)}, ${String(result.stdout.length)} characters)`,
    );
  }
  const checked = (await publishedSchema(doc.schema)).safeParse(doc);
  expect(
    checked.success
      ? []
      : checked.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    `mediaplane ${command}'s ${doc.schema} against its published JSON Schema`,
  ).toEqual([]);
  expect(result.code, `mediaplane ${command}'s exit code, as documented`).toBe(
    documentedExit(command, doc),
  );
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(result.stdout.includes(secret), `mediaplane ${command} printed a secret`).toBe(
      false,
    );
  }
  return { code: result.code, doc };
}

/** The resources a plan or an apply names for an action, sorted. */
const named = (items: unknown, action: string, key = 'action'): string[] =>
  (items as Record<string, unknown>[])
    .filter((item) => item[key] === action)
    .map((item) => String(item.resource ?? item.service))
    .sort();

describe('a playbook, reading only the documented contract (the roadmap: S10c)', () => {
  it('deploys a stack, removes an app from it, and rebuilds the host', async () => {
    const home = await makeHome();
    const data = join(home, 'data');
    await writeFile(join(home, 'stack.yaml'), stackFor(data, { seerr: false }));
    let deployed: DeployedMediaplane | undefined;
    const removeAll = () =>
      runTeardown([
        async () => {
          await deployed?.remove();
        },
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      secrets = [];
      // Deployed as the playbook deploys it: mediaplane.compose.yaml, its image built here.
      deployed = await deployMediaplane({ home, stack: PROJECT });
      const planned = await run(deployed, 'plan');
      expect([planned.code, planned.doc.schema]).toEqual([2, 'mediaplane.plan/v1']);
      const applied = await run(deployed, 'apply', '--yes');
      expect(applied.doc).toMatchObject({ ok: true, changed: true, outcome: 'success' });
      const store = await readSecretStore(home);
      secrets = [
        ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
        store.shared?.adminPassword ?? '',
      ];
      // A second apply changes nothing (spec §2.3, criterion 3).
      const again = await run(deployed, 'apply', '--yes');
      expect(again.doc).toMatchObject({
        ok: true,
        changed: false,
        outcome: 'no-changes',
      });
      const status = await run(deployed, 'status');
      expect(status.doc).toMatchObject({ ok: true, healthy: true });
      // The login, without its password: that needs --reveal.
      const login = await run(deployed, 'credentials');
      expect(login.doc).toMatchObject({ ok: true, username: 'admin', password: null });
      // A usage error is a document too.
      const wrong = await run(deployed, 'plan', '--no-such-option');
      expect(wrong.doc.schema).toBe('mediaplane.error/v1');

      // Radarr taken out of the stack: its container goes, and what Mediaplane made for
      // it in the other apps; its appdata stays.
      await writeFile(
        join(home, 'stack.yaml'),
        stackFor(data, { seerr: false }).replace('  radarr: {}\n', ''),
      );
      const removal = await run(deployed, 'plan');
      expect(removal.code).toBe(2);
      expect(named(removal.doc.containers, 'remove')).toEqual(['radarr']);
      const toRemove = named(removal.doc.wiring, 'remove');
      expect(toRemove).toEqual([
        'prowlarr.application_radarr',
        'qbittorrent.category_movies',
      ]);
      const removed = await run(deployed, 'apply', '--yes');
      expect(removed.doc).toMatchObject({ ok: true, changed: true, outcome: 'success' });
      expect(named(removed.doc.actions, 'removed', 'detail')).toEqual(toRemove);
      const settled = await run(deployed, 'apply', '--yes');
      expect(settled.doc).toMatchObject({ changed: false, outcome: 'no-changes' });

      // The host is lost: the stack's containers, Mediaplane's deployment, its state/ and
      // generated/. What is left is what a rebuild starts from: stack.yaml, appdata/ and
      // the data folder. The playbook deploys Mediaplane again, and applies.
      await deployed.remove();
      deployed = undefined;
      const down = await composeDown(PROJECT);
      expect(down.code, down.stderr).toBe(0);
      await expectWiringRemoved(PROJECT);
      await rm(join(home, 'state'), { recursive: true });
      await rm(join(home, 'generated'), { recursive: true });
      deployed = await deployMediaplane({ home, stack: PROJECT });
      const rebuild = await run(deployed, 'plan');
      expect(rebuild.code).toBe(2);
      expect(rebuild.doc.secrets).toEqual({
        generate: ['admin.password'],
        recover: [
          'jellyfin.apiKey',
          'prowlarr.apiKey',
          'qbittorrent.apiKey',
          'sonarr.apiKey',
        ],
        restore: [],
      });
      expect(
        (rebuild.doc.diagnostics as { code: string }[]).map((d) => d.code),
      ).toContain('secrets.admin-password-lost');
      const rebuilt = await run(deployed, 'apply', '--yes');
      expect(rebuilt.doc).toMatchObject({ ok: true, changed: true, outcome: 'success' });
      // Every resource found by name, and adopted; the new password set through the keys.
      expect(named(rebuilt.doc.actions, 'created', 'detail')).toEqual([]);
      const after = await readSecretStore(home);
      secrets.push(after.shared?.adminPassword ?? '');
      const last = await run(deployed, 'apply', '--yes');
      expect(last.doc).toMatchObject({ changed: false, outcome: 'no-changes' });
      const drift = await run(deployed, 'drift');
      expect(drift.doc).toMatchObject({ ok: true, clear: true, drift: [] });
      // The rebuilt host's history, and its apply's record in full.
      const history = await run(deployed, 'history');
      const records = history.doc.records as { id: string; outcome: string }[];
      expect(records.map((r) => r.outcome)).toEqual(['success']);
      const record = await run(deployed, 'history', records[0]?.id ?? '');
      expect(record.doc).toMatchObject({
        schema: 'mediaplane.change/v1',
        ok: true,
        id: rebuilt.doc.recordId,
      });
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 2_400_000);
});
````

- [ ] **Step 2: See it catch a document its schema doesn't describe (RED)**

The contract it reads is built by Tasks 1 and 2, so the test passes once written; its RED
is shown by breaking the contract. Take `ok` out of the published status schema
(`properties.ok`, and `"ok"` from `required`, in `docs/reference/json/status.schema.json`),
then run: `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/playbook.e2e.test.ts`

Expected: FAIL, with `mediaplane status's mediaplane.status/v1 against its published JSON
Schema: expected [ ': unrecognized_keys' ] to deeply equal []`. Put the file back
(`git checkout -- docs/reference/json/status.schema.json`).

- [ ] **Step 3: Run it, and see it pass**

Run the same command. Expected: PASS (about 2 to 3 minutes warm), and nothing left in
Docker.

- [ ] **Step 4: The full check, and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "test(e2e): a playbook deploys a stack, takes an app out and rebuilds the host, reading only the documented contract" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The docs that complete M1, and the plans moved to `docs/plans/m1/`

Decision 19. Spec §9's docs set; the roadmap with every item settled; the owner's request
of 2026-10-27 to tidy `docs/plans/`.

**Files:**

- Create: `docs/automation.md`, `scripts/docs/automation.test.ts`,
  `docs/plans/m1/README.md`
- Change: `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/how-its-built.md`,
  `docs/security/threat-model.md`, `docs/design/m1-engine-cli.md` (§11, "Slice 10c"),
  `docs/plans/m1-roadmap.md`
- Move: every `docs/plans/m1-s*.md`, this plan included, to `docs/plans/m1/`; the roadmap
  stays where it is

**Interfaces:**

- Consumes: `createProgram`, `defaultDeps`, `EXIT_CODES` (`packages/cli/src/run.ts`), to
  check the guide's commands against the CLI.

- [ ] **Step 1: Write the failing test**

Create `scripts/docs/automation.test.ts`, which checks the guide's Ansible example and
every command it shows against the CLI itself:

````ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createProgram, defaultDeps, EXIT_CODES } from '../../packages/cli/src/run';
import { ROOT } from '../root';

/** docs/automation.md: the guide to deploying with automation. */
const guide = readFileSync(join(ROOT, 'docs', 'automation.md'), 'utf8');

/** The guide's fenced blocks of `language`, in order. */
function blocks(language: string): string[] {
  return [
    ...guide.matchAll(new RegExp(`^\`\`\`${language}\n([\\s\\S]*?)^\`\`\`$`, 'gm')),
  ].map((match) => match[1] ?? '');
}

interface Task {
  name?: unknown;
  'ansible.builtin.command'?: unknown;
}

/** The CLI as the guide's commands meet it. */
const cli = createProgram(
  { stdout: () => undefined, stderr: () => undefined, env: {} },
  defaultDeps({}),
  () => undefined,
);

describe('the automation guide (docs/automation.md)', () => {
  it('has one short Ansible play, in YAML, each task named', () => {
    const yaml = blocks('yaml');
    expect(yaml).toHaveLength(1);
    const plays = parse(yaml[0] ?? '') as { hosts?: unknown; tasks?: Task[] }[];
    expect(plays).toHaveLength(1);
    const tasks = plays[0]?.tasks ?? [];
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks)
      expect(typeof task.name, JSON.stringify(task)).toBe('string');
  });

  it('runs only commands and options the CLI has, as a script runs them', () => {
    const lines = [
      ...guide.matchAll(
        /docker exec (\S+ )*mediaplane mediaplane ([a-z-]+)((?: --[a-z-]+)*)/g,
      ),
    ];
    expect(lines.length).toBeGreaterThan(3);
    for (const [line, flags, name = '', options = ''] of lines) {
      // Without a terminal (no -t): a script's way, which asks nothing.
      expect(flags, line).toBeUndefined();
      const command = cli.commands.find((c) => c.name() === name);
      expect(command, line).toBeDefined();
      const given = options.split(' ').filter((option) => option !== '');
      for (const option of given) {
        expect(
          command?.options.some((o) => o.long === option),
          `${line}: ${option}`,
        ).toBe(true);
      }
      expect(given, line).toContain('--json');
      // Without a terminal, apply asks nothing only with --yes.
      if (name === 'apply') expect(given, line).toContain('--yes');
    }
  });

  it("takes plan's exit codes as the CLI says them: 0 and 2 succeed", () => {
    expect((EXIT_CODES.plan ?? []).map((code) => code.split(':')[0])).toEqual([
      '0',
      '2',
      '1',
    ]);
    expect(blocks('yaml')[0]).toContain('failed_when: plan.rc not in [0, 2]');
    expect(blocks('yaml')[0]).toContain(
      'changed_when: (applied.stdout | from_json).changed',
    );
  });
});
````

- [ ] **Step 2: Run it, and see it fail**

Run: `pnpm exec vitest run scripts/docs/automation.test.ts`

Expected: FAIL, with `Error: ENOENT: no such file or directory, open
'…/docs/automation.md'`.

- [ ] **Step 3: Write the guide to deploying with automation**

Create `docs/automation.md`:

````markdown
# Deploying with automation

Mediaplane works on its own: `install.sh`, then `init`, `plan` and `apply`, as the
[README](../README.md) shows. Automation such as Ansible, a CI job or a shell script runs
the same commands. This page is the contract such a script can rely on, and a short
Ansible example. Mediaplane ships no Ansible role or collection: the example is all
there is, and nothing in Mediaplane needs Ansible.

## What a script can rely on

- **The commands ask nothing without a terminal.** Run from a script, with no terminal
  on its standard input and output, a command that would need an answer fails at once
  and says which flag it needs: `apply` needs `--yes`, and `init` needs at least
  `--media-server` and `--data`. `docker exec` without `-t`, Ansible's `command` module,
  and a CI job all run without a terminal.
- **`--json` prints one document, and nothing else, on standard output:** the command's
  own, or `mediaplane.error/v1` when it stops before it can print its own, a mistyped
  option included. Each names its shape (`schema`) and says whether the command did what
  it was asked (`ok`). The [`--json` reference](reference/json.md) lists every field, and
  each document has a JSON Schema beside it, in [`reference/json/`](reference/json/).
- **The exit codes say what happened,** the same way every time. The
  [CLI reference](reference/cli.md) lists each command's. The ones a playbook uses:
  - `plan`: 0 when nothing would change, 2 when `apply` would change something (or an
    app is still waiting for its health check), 1 on an error.
  - `apply`: 0 when it applied, or had nothing to do; 1 when a step failed.
  - `drift`: 0 when nothing drifted and every resource and secret was checked, 2 when
    something drifted or couldn't be checked, 1 on an error.
  - `status`, `history`, `credentials`, `keep` and `migrate`: 0, or 1 on an error.
- **A second `apply` changes nothing.** With nothing to do, `apply --yes --json` exits 0
  with `"changed": false` and `"outcome": "no-changes"`, and writes no change record.
  That is a playbook's `changed_when`.
- **Within v1, a document only grows.** A later release may add a field, or a value to a
  field's values (S10b added `remove` to `wiring[].action`), but never changes what one
  means: that would be v2. So read the fields you know, ignore the others, and stop at a
  value you don't know rather than guess what it means.
- **A diagnostic's `code` is stable;** its `message` is for people, and may change. The
  [`--json` reference](reference/json.md) lists the codes a script is most likely to act
  on.
- **No secret is ever printed,** in `--json` or otherwise, but by `credentials`: the
  admin password, only with `--reveal` under `--json`. A key or password in a file you
  give (`{ file: … }` in `stack.yaml`) is read, never printed or logged.

What a script should not rely on:

- the human output (without `--json`): its words change;
- the files in `state/`: they are Mediaplane's. `state/resources.json`
  (`mediaplane.resources/v1`) records, for each resource Mediaplane made, its id in its
  app, its name, the managed fields as last applied, and the names of its secrets, of
  those Mediaplane gave the app in place of ones it made itself (`given`), and of their
  last checks (`checks`): never a value. `mediaplane history <id> --json` prints a change
  record, and is the way to read one;
- a change record of a later release: `history <id> --json` shows the fields this
  release knows, and the rest stay in its file. A record this release can't read at all,
  such as one with a value it doesn't know, is listed under `unreadable` by
  `history --json`, and `history <id>` exits 1, saying so.

## The commands, as a script runs them

Mediaplane runs in its own container, `mediaplane`, so a script runs each command with
`docker exec`, without `-t`:

```bash
docker exec mediaplane mediaplane plan --json
docker exec mediaplane mediaplane apply --yes --json
docker exec mediaplane mediaplane drift --json
```

From a checkout, `pnpm --silent mediaplane <command> --json` does the same, with
`--home` for the home.

- **`plan`, then `apply`.** `plan --json` exits 2 when there is something to do. `apply
--yes --json` then does it; its `actions` say what each step did, and its `recordId`
  names the change record.
- **Take an app out** by taking its line out of `stack.yaml`. `plan` lists its container
  as `remove`, and each resource Mediaplane made for it in the other apps as a wiring
  `remove`; `apply` removes them, and keeps the app's `appdata/`. What it leaves, such
  as a qBittorrent category that holds a torrent, `drift` reports as `left`, with `stays`
  saying why.
- **Rebuild a host** from `stack.yaml`, `secrets/`, `appdata/` and the data folder:
  install Mediaplane on the new host with the same home, then `plan` and `apply` as
  above. `plan` lists the keys it recovers from the apps' appdata
  (`secrets.recover`), and a new admin password to generate when the old one went with
  `state/` (the warning `secrets.admin-password-lost`); `apply` finds each resource it
  made by name. The [rebuilding a host](runbooks/rebuilding-a-host.md) runbook has the
  details.
- **Watch for drift** with `drift --json` on a schedule: exit 2 means look.

## When automation owns `stack.yaml`

A playbook that templates `stack.yaml` owns it: add `managed_by: external`, and
Mediaplane never writes the file.

- `mediaplane keep` (Keep mine) then writes nothing in `stack.yaml`, and gives the line
  to add instead: `line` in `mediaplane.keep/v1`, with `"written": false` and the warning
  `keep.external`. Add the line to your template. Until `stack.yaml` holds it, `apply`
  puts back what it applied.
- `mediaplane migrate` writes nothing either, and gives the file as it should be, as
  `text`.

## Secrets

`stack.yaml` never holds a secret: it names a file in the home (`{ file: secrets/… }`) or
an environment variable (`{ env: … }`). A playbook writes those files, mode 0600, owned
by the home's user, from its own vault; an environment variable must be set in
Mediaplane's container, which `deploy/mediaplane.compose.yaml` would need to pass on, so
a file is the simpler way. The keys and the admin password Mediaplane generates stay in
`state/secrets.json`, and it never makes new ones on its own: a new admin password is
`apply --rotate admin.password`.

## An example with Ansible

A short example, for one host where Mediaplane is installed already
([`deploy/README.md`](../deploy/README.md)), run as the user who owns the home. It
templates `stack.yaml`, asks `plan` whether there is anything to do, and applies only
then, reporting a change only when `apply` made one:

```yaml
- name: Deploy the media stack with Mediaplane
  hosts: media
  vars:
    mediaplane_home: /opt/mediaplane
  tasks:
    - name: Write stack.yaml, with managed_by external in it
      ansible.builtin.template:
        src: stack.yaml.j2
        dest: '{{ mediaplane_home }}/stack.yaml'
        mode: '0644'

    - name: See what apply would change
      ansible.builtin.command: docker exec mediaplane mediaplane plan --json
      register: plan
      changed_when: false
      failed_when: plan.rc not in [0, 2]

    - name: Apply it
      ansible.builtin.command: docker exec mediaplane mediaplane apply --yes --json
      register: applied
      when: plan.rc == 2
      changed_when: (applied.stdout | from_json).changed
```

Run it again and the second run reports nothing changed: `plan` exits 0, and `apply`
doesn't run. To rebuild a host, run the same play against the new host once its home
holds `stack.yaml`, `secrets/` and `appdata/`.

An end-to-end test (`test/e2e/playbook.e2e.test.ts`) runs this contract against real
Docker, as the example does: it deploys a stack, takes an app out, and rebuilds the host,
reading only the exit codes and the documents, each checked against its published JSON
Schema.
````

- [ ] **Step 4: Run it, and see it pass**

Run the command of Step 2. Expected: PASS, 3 tests.

- [ ] **Step 5: The full README, the add-an-app guide, and the other docs**

The README: its status, a features list in place of the table that scrolled sideways,
the stack as a list, the §1.3 comparison, no slice in it, and the new docs:

````diff
diff --git a/README.md b/README.md
index 422abaa..69949ac 100644
--- a/README.md
+++ b/README.md
@@ -8,51 +8,10 @@ Compose and wires the apps together for you.**
 
-> **Status: pre-alpha, not ready for use yet.**
+> **Status: M1 is complete. Pre-1.0, and no release yet.**
 >
-> - **Works today:** `mediaplane plan` checks a real host and shows exactly what it
->   would do. `mediaplane apply` then starts the stack, confirms that every app is
->   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin
->   and Seerr (`mediaplane credentials` shows it). It sets Jellyfin up before its web UI
->   is published, with its Movies and Shows libraries, when `apply` runs the stack (the
->   [threat model](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
->   says what voids that). It links Sonarr and Radarr to
->   qBittorrent: download clients, categories and root folders, and to Jellyfin, which
->   they tell of each import. It links Prowlarr to Sonarr and Radarr, so the indexers you
->   add in Prowlarr reach both, with Byparr as Prowlarr's proxy for indexers behind
->   Cloudflare. It signs Seerr in through Jellyfin, as the same admin, before Seerr's web
->   UI is published, again when `apply` runs the stack (the same
->   [threat model](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
->   entry says what voids that), and links Seerr to Jellyfin, with both libraries, and to
->   Sonarr and Radarr, with a quality profile, ready for requests. With Plex instead,
->   `mediaplane init` (or `plex-login`) signs you in to plex.tv and saves your Plex token; `apply`
->   claims Plex for your account before its web UI is published, names it, gives it
->   its Movies and TV Shows libraries, connects Sonarr and Radarr to it, and signs Seerr
->   in with your Plex account before Seerr is published, linked to Plex (when `apply`
->   runs the stack; the same threat model entry says what voids that).
->   `mediaplane vpn-check` confirms that qBittorrent reaches the internet only through
->   the VPN. `mediaplane drift` reports what was changed by hand in the apps, with what
->   Mediaplane set and what the app holds now; `apply` puts it back, and
->   `mediaplane keep` keeps it as yours instead, in `stack.yaml`. Mediaplane runs in its
->   own hardened container, behind a Docker socket proxy, and reaches the apps over a
->   private network with no route out.
-> - **Releases:** from the first one, each release publishes Mediaplane's image for amd64
->   and arm64, and deploy files that pin it by digest. Updating Mediaplane, or going
->   back, recreates only its own project (its container, and the socket proxy when the
->   release changed the proxy's pin), never the stack (though the first `apply` after an
->   update that changes the image's Compose may recreate the apps once, keeping their
->   data and settings: see [Updating](deploy/README.md#updating)). There has been no
->   release yet.
-> - **Rebuilding a host:** from `stack.yaml` and the apps' appdata, `apply` recovers each
->   key the apps hold, finds what it made in them by name, and sets a new admin password
->   through their keys if the generated one is lost. A key changed in an app is put back,
->   or kept with `mediaplane keep`.
-> - **Taking an app out:** remove it from `stack.yaml`, and `apply` removes its
->   container, and what Mediaplane made for it in the other apps (Prowlarr's link,
->   qBittorrent's category, Seerr's server), keeping its appdata and anything of yours.
->   A new Plex token reaches the arrs and Seerr with `apply --rotate plex.token`.
-> - **Next:** the contract for driving Mediaplane from automation, and the docs that
->   complete M1.
-> - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
->   your LAN (`network.bind: lan`) or keep them on this machine (`localhost`).
->
-> Watch the repo to follow along.
+> Mediaplane plans, applies and wires the core video stack on a real host, reports what
+> was changed by hand, rebuilds a host from its files, takes an app out cleanly, and can
+> be driven by a script or a playbook. Everything listed under [Features](#features) is
+> built and tested, most of it end to end against the real apps, on amd64 and arm64.
+> Expect changes before 1.0. There has been no release yet, so install it from a checkout
+> for now ([Run it in a container](#run-it-in-a-container)).
 
@@ -76,33 +35,42 @@ Mediaplane does that part for you:
 
-## What works so far
-
-| Capability                                                                        | Status  |
-| --------------------------------------------------------------------------------- | ------- |
-| Validate `stack.yaml`, with errors that say what to change                        | Done    |
-| Render a readable Compose project with images pinned by tag and digest            | Done    |
-| Check the host first: Docker versions, disk, data folder, ports, the VPN device   | Done    |
-| Refuse to publish web UIs on a cloud VM's private address by mistake              | Done    |
-| Predict exactly which containers will change, using Compose's own config hashes   | Done    |
-| Generate keys and start the stack (`mediaplane apply`)                            | Done    |
-| See each app's health and every past apply (`status`, `history`)                  | Done    |
-| Write a starter `stack.yaml` (`init`)                                             | Done    |
-| One admin login for qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr     | Done    |
-| Reach the apps' APIs over a private network with no route out                     | Done    |
-| A VPN kill switch, tested against a real WireGuard server, and `vpn-check`        | Done    |
-| Run in a hardened container, behind a Docker socket proxy                         | Done    |
-| Documentation generated from code: the `stack.yaml` and CLI references, app facts | Done    |
-| Link Sonarr and Radarr to qBittorrent: download clients, categories, root folders | Done    |
-| Link Prowlarr to Sonarr and Radarr, with Byparr or FlareSolverr as its proxy      | Done    |
-| Set up Jellyfin before it is published, with its libraries and links              | Done    |
-| Sign Seerr in through Jellyfin before it is published, and link it                | Done    |
-| Sign in to Plex (`plex-login`), and claim Plex before it is published             | Done    |
-| Plex's libraries and links, and Seerr signed in with your Plex account            | Done    |
-| Guided install: `install.sh`, then `init` asks for everything, Plex sign-in too   | Done    |
-| Hardware transcoding for Plex or Jellyfin (`hardware_transcoding`)                | Done    |
-| Detect manual changes and offer Re-apply or "Keep mine" (`drift`, `keep`)         | Done    |
-| Releases, and updating Mediaplane without touching the stack (none cut yet)       | Done    |
-| Rebuild a host from `stack.yaml` and its appdata                                  | Done    |
-| Take an app out, and what it had in the other apps goes with it                   | Done    |
-| A new Plex token for the arrs and Seerr (`apply --rotate plex.token`)             | Done    |
-| Deploy with automation such as Ansible                                            | Planned |
+## Features
+
+- **One file.** `stack.yaml` describes the stack, and a mistake in it gets an error that
+  says what to change. `mediaplane init` writes a starter one, asking for everything,
+  the Plex sign-in included.
+- **Plain Compose.** A readable Compose project, every image pinned by tag and digest,
+  which runs without Mediaplane: the header of `compose.yaml` gives the command.
+- **Plan, then apply.** `plan` checks the host first (Docker, disk, the data folder,
+  ports, the VPN device, and a cloud VM's private address) and predicts exactly which
+  containers change, from Compose's own config hashes. `apply` makes it so.
+- **Keys, and one admin login.** Every API key is generated up front and kept. One admin
+  login works in qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr
+  (`mediaplane credentials`).
+- **Wiring.** Sonarr and Radarr are linked to qBittorrent (download clients, categories
+  and root folders) and to the media server; Prowlarr to both, with Byparr or
+  FlareSolverr as its proxy; Seerr to the media server and both arrs.
+- **Jellyfin or Plex, set up before they are published.** Jellyfin's wizard is finished,
+  or Plex claimed for your plex.tv account (`plex-login`), before its web UI is
+  published, then given its libraries. Seerr is signed in the same way.
+- **A VPN that fails closed.** qBittorrent runs behind Gluetun, tested against a real
+  WireGuard server, and `mediaplane vpn-check` checks your host.
+- **Drift, reported and never reverted on its own.** `mediaplane drift` reports what was
+  changed by hand. `apply` puts it back, or `mediaplane keep` keeps yours.
+- **History.** `status` shows each app's health and the last apply, and `history` every
+  apply.
+- **Rebuilding a host** from `stack.yaml` and the apps' appdata: the keys are recovered
+  from the apps, and everything Mediaplane made is found by name.
+- **Taking an app out.** Its container goes, and what Mediaplane made for it in the other
+  apps; its appdata, and anything of yours, stay.
+- **Rotation.** A new admin password (`--rotate admin.password`) or Plex token
+  (`--rotate plex.token`) reaches every app that holds it.
+- **Hardware transcoding** for Plex or Jellyfin (`hardware_transcoding`).
+- **Built for automation.** The commands ask nothing when a script runs them, have exit
+  codes that mean something, and print versioned `--json` documents, each with a
+  published JSON Schema ([Deploying with automation](docs/automation.md)).
+- **Hardened by default.** Mediaplane runs in its own container, behind a Docker socket
+  proxy, and reaches the apps over a private network with no route out.
+- **Releases.** Each release will publish the image for amd64 and arm64, and deploy files
+  that pin it by digest; updating Mediaplane never restarts the stack
+  ([Updating](deploy/README.md#updating)). No release has been cut yet.
 
@@ -110,9 +78,7 @@ Mediaplane does that part for you:
 
-| Role         | App                                                 |
-| ------------ | --------------------------------------------------- |
-| Media server | Jellyfin **or** Plex                                |
-| TV and films | Sonarr, Radarr                                      |
-| Indexers     | Prowlarr, with Byparr (or FlareSolverr)             |
-| Downloads    | qBittorrent, behind a Gluetun VPN that fails closed |
-| Requests     | Seerr                                               |
+- **Media server:** Jellyfin **or** Plex.
+- **TV and films:** Sonarr and Radarr.
+- **Indexers:** Prowlarr, with Byparr (or FlareSolverr).
+- **Downloads:** qBittorrent, behind a Gluetun VPN that fails closed.
+- **Requests:** Seerr.
 
@@ -123,2 +89,21 @@ Mediaplane runs on an existing Linux host, amd64 or arm64.
 
+## Compared with other tools
+
+What else was there when Mediaplane was designed (October 2026):
+
+- **YAMS, Saltbox, DockSTARTer, Runtipi and CasaOS** install the apps, and leave the
+  wiring to you.
+- **arrstack (LavX)** wires everything, but runs only as a wizard in a terminal: it
+  doesn't keep watch afterwards, and has no Plex.
+- **SparkBox** has a wizard, wiring and a panel, but it is closed source, installed on the
+  host itself, Jellyfin only, and x86 first.
+- **Umbrel** wires some apps, but it is a whole operating system, under a non-commercial
+  licence, and leaves Seerr unwired.
+- **Buildarr and Flemmarr** are configuration as code for the apps, but are no longer
+  maintained.
+
+Mediaplane is all of it together: open source, one container on a host you already
+have, Plex and Jellyfin as equal choices, arm64 supported as fully as amd64, and drift
+reported, never reverted on its own.
+
 ## What a stack looks like
@@ -205,4 +190,6 @@ A few principles hold throughout:
   boundaries.
-- **Built for automation.** `plan` has meaningful exit codes and versioned `--json`
-  output, so scripts and configuration-management tools can drive it.
+- **Built for automation.** The commands ask nothing when a script runs them, have exit
+  codes that mean something, and print versioned `--json` documents, so scripts and
+  configuration-management tools can drive them
+  ([Deploying with automation](docs/automation.md)).
 
@@ -211,6 +198,5 @@ A few principles hold throughout:
 Most of this is real output from a run on an arm64 VM, trimmed where marked. The wiring
-lines, the first-run setup's and the last apply's came later, from a run of the same
-stack with Slice 6. The stack is
-the example above without the VPN, which is why `plan` warns about qBittorrent, and with
-`network.bind: localhost`.
+lines, the first-run setup's and the last apply's came from a later run of the same
+stack, once Seerr was wired. The stack is the example above without the VPN, which is
+why `plan` warns about qBittorrent, and with `network.bind: localhost`.
 
@@ -413,4 +399,5 @@ just created. `MEDIAPLANE_COMPOSE_PROJECT` gives this trial its own Compose proj
 `--json` for machine-readable output: its `wiring` lists each resource with its `action`
-(`create`, `update`, `adopt`, `unchanged`, `after-start` or `unknown`), the `changes` that
-differ, and a `reason` when it is `unknown`.
+(`create`, `update`, `adopt`, `unchanged`, `after-start`, `unknown` or `remove`), the
+`changes` that differ, and a `reason` when it is `unknown`. The
+[`--json` reference](docs/reference/json.md) lists every field of every command's.
 
@@ -495,3 +482,3 @@ environment variable. What a one-shot pipeline doesn't do well is everything aft
 - **Things change after deploy.** Someone edits a setting in a web UI, and a pipeline
-  never knows. Mediaplane will compare what it set with what is there now, and tell you
+  never knows. Mediaplane compares what it set with what is there now, and tells you
   without overwriting your change.
@@ -506,8 +493,9 @@ So Mediaplane isn't instead of a pipeline. It is built to run inside one:
 
-The pipeline decides what the stack is, and Mediaplane does the stateful part. Today
-that covers generating the keys, deploying, setting Jellyfin up and taking the key it
-makes, or claiming Plex for your account, signing Seerr in, setting the shared login in
-the apps, linking Sonarr and Radarr to qBittorrent and the media server, Prowlarr to
-them, and Seerr to all three, and checking. Change detection is what is being built
-next.
+The pipeline decides what the stack is, and Mediaplane does the stateful part:
+generating the keys, deploying, setting Jellyfin up and taking the key it makes, or
+claiming Plex for your account, signing Seerr in, setting the shared login in the apps,
+linking Sonarr and Radarr to qBittorrent and the media server, Prowlarr to them, and
+Seerr to all three, checking, and later reporting what was changed by hand.
+[Deploying with automation](docs/automation.md) has the contract a pipeline relies on,
+and a short Ansible example.
 
@@ -589,4 +577,5 @@ and the whole branch is reviewed again before it merges.
 
-- **M1: engine and CLI.** `plan` and `apply`, key generation, wiring for the core
-  stack, drift detection, change history, releases, and rebuilding a host.
+- **M1: engine and CLI (done).** `plan` and `apply`, key generation, wiring for the core
+  stack, drift detection, change history, releases, rebuilding a host, and the contract
+  automation relies on.
 - **M2: everyday CLI.** Safe app updates with rollback, backup and restore, `doctor`,
@@ -598,12 +587,5 @@ and automation such as Ansible can drive the same commands.
 
-M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it stands:
-
-- **Merged:** S1 (the pure core), S2a (`plan` against a real host), S2b (`apply`), S2c
-  (packaging), S3a (the shared admin and pre-start files), S3d (the VPN's kill-switch
-  test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
-  (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex), S8 (drift), S9 (releases and
-  safe updates), S10a (recovery) and S10b (removal and rotation). Between S7 and
-  S8, smaller changes added a guided install (`deploy/install.sh`, and `init` asking for
-  your own admin password and signing you in to Plex) and hardware transcoding.
-- **Next:** S10c (the automation contract and the docs), which completes M1.
+M1 was built in 17 slices, each from a plan of its own, kept as a record in
+[`docs/plans/m1/`](docs/plans/m1/). The [M1 roadmap](docs/plans/m1-roadmap.md) says what
+each slice delivered, and what moved to M2.
 
@@ -620,2 +602,6 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   generated from the CLI.
+- **[Deploying with automation](docs/automation.md):** what a script or a playbook can
+  rely on, and a short Ansible example.
+- **[`--json` reference](docs/reference/json.md):** every document the commands print
+  with `--json`, field by field, generated from the code, with a JSON Schema for each.
 - **The apps:** one README each, with what Mediaplane sets, how to change it, and known
@@ -646,3 +632,4 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **[M1 design](docs/design/m1-engine-cli.md) and [roadmap](docs/plans/m1-roadmap.md):**
-  the plan for all of M1, and where it stands.
+  the plan for all of M1, and what each slice delivered; each slice's own plan is in
+  [`docs/plans/m1/`](docs/plans/m1/).
 
@@ -650,3 +637,4 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 
-See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
+See [CONTRIBUTING.md](CONTRIBUTING.md), which also says how to
+[add an app](CONTRIBUTING.md#adding-an-app). To report a security issue, see
 [SECURITY.md](SECURITY.md).
````

`CONTRIBUTING.md`: the commands as a list, the contract and the harness, and the
add-an-app guide:

````diff
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
index b6632fb..bd44899 100644
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -14,15 +14,22 @@ pnpm install        # also points git at the repo's hooks in .githooks/
 
-| Command              | What it does                                                                |
-| -------------------- | --------------------------------------------------------------------------- |
-| `pnpm test`          | Unit tests (Vitest)                                                         |
-| `pnpm test:coverage` | Unit tests with coverage thresholds                                         |
-| `pnpm test:e2e`      | End-to-end tests against real Docker                                        |
-| `pnpm lint`          | ESLint and the Prettier check                                               |
-| `pnpm format`        | Rewrite files with Prettier                                                 |
-| `pnpm typecheck`     | Type-check the whole repo                                                   |
-| `pnpm docs:generate` | Rewrite the generated docs in `docs/reference/` (CI runs `pnpm docs:check`) |
+- `pnpm test`: unit tests (Vitest).
+- `pnpm test:coverage`: unit tests with coverage thresholds.
+- `pnpm test:e2e`: end-to-end tests against real Docker.
+- `pnpm lint`: ESLint and the Prettier check.
+- `pnpm format`: rewrite files with Prettier.
+- `pnpm typecheck`: type-check the whole repo.
+- `pnpm docs:generate`: rewrite the generated docs in `docs/reference/` and the apps'
+  READMEs. CI runs `pnpm docs:check`, which also fails on a link in the docs that leads
+  nowhere.
 
 After changing `packages/engine/src/config/schema.ts`, a command or option in
-`packages/cli/src/run.ts`, or an app in `catalog/`, run `pnpm docs:generate` and commit
-what it writes. CI fails while the generated docs are stale.
+`packages/cli/src/run.ts`, a `--json` document in `packages/cli/src/contract.ts`, or an
+app in `catalog/`, run `pnpm docs:generate` and commit what it writes. CI fails while the
+generated docs are stale.
+
+A field added to what a command prints with `--json` must be added to its document in
+`packages/cli/src/contract.ts` too, with what it means: until it is, `pnpm typecheck`
+fails (`contract.test.ts`), and so do the CLI tests that print it (`run.test.ts` checks
+every document it prints). Within v1 a
+document only gains fields and values; a field that changes meaning needs a v2.
 
@@ -42,3 +49,14 @@ The apply end-to-end test pulls the full app stack the first time, about 7 GB, a
 starts it, so allow several minutes. The test files run one at a time because they
-share host ports.
+share host ports. CI pulls every image the suite runs before it starts
+(`scripts/ci/pull-images.ts`), retrying a temporary registry error for longer than
+`apply` does, so a registry's bad minute doesn't fail the job. After each file,
+`test/e2e/setup.ts` removes whatever its tests left in Docker, by this run's names
+(`mediaplane-e2e-<pid>`), and fails the file naming it: a test that times out never
+reaches its own teardown. The harness's own unit tests are `test/e2e/*.unit.test.ts`,
+which `pnpm test` runs.
+
+The playbook test (`test/e2e/playbook.e2e.test.ts`) drives Mediaplane's container as a
+playbook would ([Deploying with automation](docs/automation.md)): no terminal, only exit
+codes and `--json` documents, each checked against its published JSON Schema in
+`docs/reference/json/`.
 
@@ -157,2 +175,47 @@ This repository is public, or will be. Anything in git history is permanent.
 
+## Adding an app
+
+An app is one folder in `catalog/`, and nothing else in the engine changes. Step by step:
+
+1. **Check that it fits.** Mediaplane runs the app's own upstream image, unmodified
+   ([ADR 0001](docs/adr/0001-dont-fork-upstream-apps.md)), configured through its
+   environment, its files and its API. The image must run on amd64 and arm64.
+2. **Write `catalog/<id>/app.ts`** with `defineApp({ … })`. `<id>` is the name
+   `stack.yaml` lists it by. Start from an app like it: `catalog/byparr/app.ts` for one
+   Mediaplane only runs, `catalog/sonarr/app.ts` for one it wires. Each field is
+   described in `packages/engine/src/catalog/types.ts`:
+   - `image`: its repository, an exact tag and the multi-arch digest, which
+     `docker buildx imagetools inspect <repo>:<tag>` shows;
+   - `ports`: name the web UI's `web`, as `mediaplane credentials` looks for it, and give
+     a port the LAN needs no access to `publish: false`;
+   - `volumes`, `runAs` (how the image picks its user), `health` (a check that passes
+     once the app answers), `secrets` and `credentials` (its keys, and how it is given
+     them), `provides` and `requires`, and `login`.
+3. **Add it to `catalog/index.ts`,** in order of id.
+4. **Write `catalog/<id>/README.md`:** what the app is for, then the two lines
+   `<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->` and
+   `<!-- END GENERATED -->`, where `pnpm docs:generate` writes its facts; then what
+   Mediaplane does in it, how to change that, and its known issues.
+5. **To wire it,** give it an `api` (its port, a path that answers once it is ready, its
+   key and how a request carries it) and an `integration.ts`: the apps it comes `after`,
+   and its resources, each with its managed fields and secrets, and how to read it, check
+   its secrets, create, update and remove it. `catalog/_shared/servarr*.ts` is the model
+   for Servarr apps, and `catalog/qbittorrent/` for one with a form API. A first-run
+   setup that anyone could finish goes in `bootstrap`, which runs before the app is
+   published (spec §6.4); files the app reads at its first start go in `configFiles`; and
+   where it keeps its own keys, for a rebuilt host to recover them, in `keyFiles`.
+6. **Test it.** Unit tests reach a fake of its API (`fakeHttpApp` in
+   `@mediaplane/engine/testing`), made no kinder than the app: ask the real app first,
+   and give the fake the same answers. `catalog/catalog.test.ts` checks every app's
+   definition by itself: its pin, its architectures, its ports, its resources' names.
+   Then add the app to an end-to-end test that applies it against real Docker, which CI
+   runs on both architectures.
+7. **Run `pnpm docs:generate`.** The `stack.yaml` reference, its JSON Schema and the
+   app's README facts now name it.
+8. **Its pin stays current by itself:** Renovate's catalog manager reads every
+   `catalog/*/app.ts`. A tag that isn't a plain version, such as linuxserver.io's
+   `-ls<revision>`, needs a versioning rule in `renovate.json`, which
+   `scripts/supply-chain.test.ts` checks.
+9. **Run the full check** (above), and `pnpm test:e2e`.
+
 ## Design decisions
````

The threat model's table of assets, as a list:

````diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 16ee623..f9e7df1 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -2,3 +2,3 @@
 
-This is the threat model for Mediaplane as built today: M1, up to and including Slice 8.
+This is the threat model for Mediaplane as built in M1.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -13,18 +13,32 @@ that power. None of them removes it.
 
-| Asset                                        | Where                                                                 | Why it matters                                             |
-| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
-| The host                                     | Everything                                                            | Docker access is root on the host                          |
-| Generated API keys                           | `state/secrets.json`, `generated/.env` (both 0600) and `appdata/`     | They open the apps' APIs                                   |
-| qBittorrent's key, in Sonarr and Radarr      | Their download client's settings, in `appdata/`                       | It opens qBittorrent's API                                 |
-| Sonarr's and Radarr's keys, in Prowlarr      | Its links' settings, in `appdata/`                                    | They open Sonarr's and Radarr's APIs                       |
-| Jellyfin's key, which Jellyfin made          | `state/secrets.json` (0600), and Sonarr's and Radarr's connections    | It opens Jellyfin's API, as its admin                      |
-| Keys in Seerr: the arrs', and one Jellyfin's | Seerr's `settings.json`, in `appdata/`; Seerr shows them in clear     | They open Sonarr, Radarr and Jellyfin, as their admin      |
-| Seerr's session cookie, while it signs in    | Mediaplane's memory, for the moment of its first sign-in              | It opens Seerr, as its admin, until signed out             |
-| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens every app with a login, Seerr through Jellyfin    |
-| Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                     |
-| Your Plex token, in Sonarr, Radarr and Seerr | The arrs' Plex connections, and Seerr's database, in `appdata/`       | It opens your plex.tv account, and every Plex it reaches   |
-| Plex's own token, from its claim             | `appdata/plex`, in its `Preferences.xml` (0600)                       | It opens your plex.tv account, as this Plex                |
-| A claim token, as Plex first starts          | Memory, Compose's environment, and Plex's, while it is unpublished    | It claims a Plex for your account, once, for four minutes  |
-| App data                                     | `appdata/<app>/`                                                      | The apps' databases and settings, some holding credentials |
-| Your media                                   | The data folder                                                       | Your library                                               |
+Each asset, where it is, and why it matters:
+
+- **The host:** everything. Docker access is root on the host.
+- **Generated API keys:** `state/secrets.json`, `generated/.env` (both 0600) and
+  `appdata/`. They open the apps' APIs.
+- **qBittorrent's key, in Sonarr and Radarr:** their download client's settings, in
+  `appdata/`. It opens qBittorrent's API.
+- **Sonarr's and Radarr's keys, in Prowlarr:** its links' settings, in `appdata/`. They
+  open Sonarr's and Radarr's APIs.
+- **Jellyfin's key, which Jellyfin made:** `state/secrets.json` (0600), and Sonarr's and
+  Radarr's connections. It opens Jellyfin's API, as its admin.
+- **Keys in Seerr, the arrs' and one Jellyfin's:** Seerr's `settings.json`, in
+  `appdata/`; Seerr shows them in clear. They open Sonarr, Radarr and Jellyfin, as their
+  admin.
+- **Seerr's session cookie, while it signs in:** Mediaplane's memory, for the moment of
+  its first sign-in. It opens Seerr, as its admin, until signed out.
+- **The shared admin password:** `state/secrets.json` (0600) or `admin.password`; a hash
+  in `appdata/`. It opens every app with a login, Seerr through Jellyfin.
+- **Your secrets (VPN key, Plex token, passwords):** `secrets/` (0700), or environment
+  variables. They are your accounts.
+- **Your Plex token, in Sonarr, Radarr and Seerr:** the arrs' Plex connections, and
+  Seerr's database, in `appdata/`. It opens your plex.tv account, and every Plex it
+  reaches.
+- **Plex's own token, from its claim:** `appdata/plex`, in its `Preferences.xml` (0600).
+  It opens your plex.tv account, as this Plex.
+- **A claim token, as Plex first starts:** memory, Compose's environment, and Plex's,
+  while it is unpublished. It claims a Plex for your account, once, for four minutes.
+- **App data:** `appdata/<app>/`. The apps' databases and settings, some holding
+  credentials.
+- **Your media:** the data folder. Your library.
 
````

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 75190b7..2c591a1 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -159,3 +159,6 @@ Each part, and where its code is:
 - **CLI** (`packages/cli`): the commands, human and `--json` output, and exit codes
-  ([reference](reference/cli.md)).
+  ([reference](reference/cli.md)). What each command prints with `--json` is a document
+  of `packages/cli/src/contract.ts`, from which the
+  [`--json` reference](reference/json.md) and its JSON Schemas are generated; a script
+  relies on those, as [Deploying with automation](automation.md) says.
 
@@ -1055,6 +1058,4 @@ Controlling Docker is root on the host, so Mediaplane's security is the host's.
 
-The [roadmap](plans/m1-roadmap.md) has the order:
-
-- the automation contract (Slice 10c): the `--json` shapes pinned and in the generated
-  docs, exit codes, the automation guide with a short Ansible example, and the docs that
-  complete M1.
+M1 is complete. The roadmap's [After M1](plans/m1-roadmap.md#after-m1) has what comes
+next: M2, the everyday CLI (safe app updates, backup and restore, `doctor`), then M3,
+more apps.
diff --git a/docs/how-its-built.md b/docs/how-its-built.md
index bf5d4f9..1061454 100644
--- a/docs/how-its-built.md
+++ b/docs/how-its-built.md
@@ -22,4 +22,5 @@ skills, with some rules of the project's own.
   later slices" list carries forward everything a review found but put off.
-- **One plan per slice**, in [`docs/plans/`](plans/), says exactly how the slice is
-  built, task by task.
+- **One plan per slice**, in [`docs/plans/m1/`](plans/m1/) for M1's, says exactly how
+  the slice is built, task by task. Once it is built, it is kept as a record, with the
+  code as it was then: the code on `main` is the truth.
 - **The ADRs**, in [`docs/adr/`](adr/), record the larger decisions and why they were
@@ -152,3 +153,3 @@ Some of what the reviews found in Slice 4 (indexers), all fixed before the merge
 
-- Each slice's plan is in [`docs/plans/`](plans/), with its probes and Decisions.
+- Each slice's plan is in [`docs/plans/m1/`](plans/m1/), with its probes and Decisions.
 - Each slice's pull request lists what changed and what the reviews found.
````

- [ ] **Step 6: The spec's §11, and the roadmap**

````diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 0d65ce2..915af9a 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -2418 +2418,69 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
     switch.
+
+### Slice 10c: the automation contract and the docs (2026-10-29)
+
+- **The `--json` contract is pinned** (§5.2: "The JSON shapes are versioned and
+  documented, because external automation depends on them"; §9). Each document the CLI
+  prints is a Zod schema in `packages/cli/src/contract.ts`. `docs/reference/json.md` and
+  one JSON Schema per document, in `docs/reference/json/`, are generated from them, and
+  `docs:check` fails while either is stale. A type-level test checks that each printer
+  prints exactly the documented fields, of the documented types, so a field added to the
+  engine's results fails the build until its document says what it is; every document
+  the CLI's tests print is checked against its schema, strictly; and an end-to-end test
+  checks real ones against the published files.
+  - **Every document carries `schema` and `ok`:** `credentials`, `status`, `history` and
+    `history <id>` gain `ok: true`, additive within v1. `history <id> --json` prints the
+    record as this release reads it (a later release's fields stay in its file), with
+    `ok`; one that is there but can't be read is said to be so, never "no change record".
+  - **`mediaplane.error/v1`'s `error` gains `diagnostics`** when the failure came from
+    them, each with its code (additive).
+  - **A usage error under `--json`** (an unknown option or command, a missing argument)
+    prints `mediaplane.error/v1` too, beside Commander's words on stderr, so a `--json`
+    run prints exactly one document. Only `--help` and `--version` print text.
+  - **Within v1 a document only grows:** a field, or a value of a field, may be added;
+    one never changes meaning (§11, Slice 3a's rule for change records, for every
+    document). A script ignores a field it doesn't know, and stops at a value it doesn't
+    know. The schema files describe this release exactly (`additionalProperties: false`).
+  - **The codes a script is most likely to act on** are listed in the reference, S10b's
+    `bootstrap.open-published`, `rotate.no-plex` and `keep.record` among them; a test
+    checks that a test pins each.
+  - The internal answers of Mediaplane's own helpers (`host-report`, `plex-tv`) are not
+    part of it.
+- **Help and hints name the published docs** (§9): `plan --help`, `drift --help` and the
+  hint of a missing `stack.yaml` give the docs' address on GitHub (`docsUrl`), never a
+  path in the repo, which the image doesn't hold. `docs:check` also fails on a link in the
+  docs, or a docs path named in code, that leads nowhere.
+- **A script is asked nothing** (§5.2): spawned tests with no terminal pin that `apply`
+  without `--yes`, and `init` without its flags, fail at once, naming the flag. Every
+  command that reads `stack.yaml` refuses a named pipe or a folder in its place, never
+  waiting on it (`config.not-a-file`; S9's review).
+- **First-run setups are held in one pass** (§6.4; §11, Slice 10a): a setup that signs in
+  again with what is rotated, and one set up again once asked, are held, through an app
+  that lacks the admin password, together with the plan's other setups, so the order of
+  the catalog never matters, and each is held, and warned of, once. A setup whose app
+  isn't ready in time isn't asked again whether it is open: it stays unpublished, and the
+  failure comes after one deadline, not two.
+- **The end-to-end suite** (§8.1): CI pulls every image the suite runs before it starts,
+  retrying a temporary registry error for longer than `apply` does, whose own pulls,
+  retries and reports are unchanged; after each file, whatever its tests left in Docker
+  is removed, and named, so a test that times out leaves no stack up. The playbook test
+  (`test/e2e/playbook.e2e.test.ts`) drives Mediaplane's container as a playbook does:
+  it deploys a stack, takes an app out, and rebuilds the host, reading only exit codes and
+  documents, each checked against its published JSON Schema.
+- **Compose versions** (§11, Slice 9): probed with eleven releases of Compose, the config
+  hash of every service of two stacks is the same within 2.29 to 2.40, and within 5.0 to
+  5.6, but differs between 2.x and 5.x for every service but Byparr; 2.24.0 differs from
+  later 2.x for Gluetun and qBittorrent. `docs/releasing.md` says so, and Renovate's pull
+  request for a bump of the image's `docker` says what to check.
+- **The installer refuses a `DOCKER_HOST` or `DOCKER_CONTEXT`** that points `docker` away
+  from the socket it checks, which Mediaplane's container mounts (§4.4; S9's review).
+- **The docs that complete M1** (§9): the full README, with the comparison of §1.3 as a
+  list; the guide to deploying with automation, with one short Ansible example, which a
+  test checks against the CLI (§1.6: Mediaplane ships no role or collection); the
+  add-an-app guide in `CONTRIBUTING.md`; and the slices' plans moved to
+  `docs/plans/m1/`, kept as the record of what each slice was built from.
+- **Moved to M2,** with the roadmap's reasons: taking the ports away from a Jellyfin
+  `apply` started published whose wizard still looks open, which the next `apply` would
+  undo while its own file says the wizard is done; `plan` checking Docker's default
+  bridge network on a Plex stack; reading plex.tv's `Retry-After`.
+- **No new Docker API call** (§7.2(2)): the socket proxy's allow-list is unchanged.
````

The roadmap: M1 done, every S10c item settled as it says, and what moved to M2; and its
links to the slices' plans, in `m1/` from Step 7:

````diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index c76b664..ec09dc3 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -11,20 +11,22 @@ slices: S1, S2 in three parts, S3 in four, S4 to S9, and S10 in three. Each slic
 
-Detailed plans so far:
-
-- Slice 1: [`m1-s1-pure-core.md`](m1-s1-pure-core.md) (done).
-- Slice 2a: [`m1-s2a-plan-against-docker.md`](m1-s2a-plan-against-docker.md) (done).
-- Slice 2b: [`m1-s2b-apply.md`](m1-s2b-apply.md) (done).
-- Slice 2c: [`m1-s2c-packaging.md`](m1-s2c-packaging.md) (done).
-- Slice 3a: [`m1-s3a-admin-and-seed-files.md`](m1-s3a-admin-and-seed-files.md) (done).
-- Slice 3d: [`m1-s3d-vpn-check.md`](m1-s3d-vpn-check.md) (done).
-- Slice 3b: [`m1-s3b-wiring.md`](m1-s3b-wiring.md) (done).
-- Slice 3c: [`m1-s3c-download-path.md`](m1-s3c-download-path.md) (done).
-- Slice 4: [`m1-s4-indexers.md`](m1-s4-indexers.md) (done).
-- Slice 5: [`m1-s5-jellyfin.md`](m1-s5-jellyfin.md) (done).
-- Slice 6: [`m1-s6-requests.md`](m1-s6-requests.md) (done).
-- Slice 7: [`m1-s7-plex.md`](m1-s7-plex.md) (done).
-- Slice 8: [`m1-s8-drift.md`](m1-s8-drift.md) (done).
-- Slice 9: [`m1-s9-releases.md`](m1-s9-releases.md) (done).
-- Slice 10a: [`m1-s10a-recovery.md`](m1-s10a-recovery.md) (done).
-- Slice 10b: [`m1-s10b-automation.md`](m1-s10b-automation.md) (done).
+The plan each slice was built from, kept in [`m1/`](m1/) as a record, with the code as it
+was built then (the code on `main` is the truth):
+
+- Slice 1: [`m1-s1-pure-core.md`](m1/m1-s1-pure-core.md) (done).
+- Slice 2a: [`m1-s2a-plan-against-docker.md`](m1/m1-s2a-plan-against-docker.md) (done).
+- Slice 2b: [`m1-s2b-apply.md`](m1/m1-s2b-apply.md) (done).
+- Slice 2c: [`m1-s2c-packaging.md`](m1/m1-s2c-packaging.md) (done).
+- Slice 3a: [`m1-s3a-admin-and-seed-files.md`](m1/m1-s3a-admin-and-seed-files.md) (done).
+- Slice 3d: [`m1-s3d-vpn-check.md`](m1/m1-s3d-vpn-check.md) (done).
+- Slice 3b: [`m1-s3b-wiring.md`](m1/m1-s3b-wiring.md) (done).
+- Slice 3c: [`m1-s3c-download-path.md`](m1/m1-s3c-download-path.md) (done).
+- Slice 4: [`m1-s4-indexers.md`](m1/m1-s4-indexers.md) (done).
+- Slice 5: [`m1-s5-jellyfin.md`](m1/m1-s5-jellyfin.md) (done).
+- Slice 6: [`m1-s6-requests.md`](m1/m1-s6-requests.md) (done).
+- Slice 7: [`m1-s7-plex.md`](m1/m1-s7-plex.md) (done).
+- Slice 8: [`m1-s8-drift.md`](m1/m1-s8-drift.md) (done).
+- Slice 9: [`m1-s9-releases.md`](m1/m1-s9-releases.md) (done).
+- Slice 10a: [`m1-s10a-recovery.md`](m1/m1-s10a-recovery.md) (done).
+- Slice 10b: [`m1-s10b-automation.md`](m1/m1-s10b-automation.md) (done).
+- Slice 10c: [`m1-s10c-contract.md`](m1/m1-s10c-contract.md) (done).
 
@@ -32,4 +34,4 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8, S9, S10a and
-  S10b.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8, S9, S10a, S10b
+  and S10c.
 - **Between S7 and S8 (2026-10-17), outside the slices** by the lighter route for small
@@ -38,3 +40,3 @@ Where M1 stands (the README shows the same):
   `deploy/install.sh`.
-- **Next:** S10c (the automation contract and the docs), which completes M1.
+- **M1 is done.** Every item below is settled: done, or moved to M2 with its reason.
   [After M1](#after-m1) has what comes next.
@@ -122,3 +124,3 @@ S10 was first planned as two parts, S10a and S10b; S10b was split again on 2026-
 
-- **S10a: recovery** ([plan](m1-s10a-recovery.md)).
+- **S10a: recovery** ([plan](m1/m1-s10a-recovery.md)).
   - Delivers: key recovery from appdata, Jellyfin's from its database; a key put back at
@@ -152,6 +154,6 @@ S10 was first planned as two parts, S10a and S10b; S10b was split again on 2026-
     reading only the documented contract.
-  - **Split again on 2026-10-26** ([plan](m1-s10b-automation.md), decision 1), by what
+  - **Split again on 2026-10-26** ([plan](m1/m1-s10b-automation.md), decision 1), by what
     each part changes: S10b, what the stack does when it changes (behaviour); S10c, the
     contract a script reads, and the docs that complete M1.
-- **S10b: removal and rotation** ([plan](m1-s10b-automation.md)).
+- **S10b: removal and rotation** ([plan](m1/m1-s10b-automation.md)).
   - Delivers: what an app leaving the stack had in the others removed (spec §8.1(3)
@@ -170,3 +172,3 @@ S10 was first planned as two parts, S10a and S10b; S10b was split again on 2026-
     nothing, on real Docker; the nightly Plex job rotates the token and claims Plex again.
-- **S10c: the automation contract and the docs.**
+- **S10c: the automation contract and the docs** ([plan](m1/m1-s10c-contract.md)).
   - Delivers: the `--json` shapes pinned and in the generated docs (`history <id>
@@ -197,4 +199,20 @@ S10 was first planned as two parts, S10a and S10b; S10b was split again on 2026-
     - `plex.e2e` pins the claim-token count (2) after the reclaim.
+    - **Done in S10c,** both. The count after the claim again is 3, not 2 (probed with
+      the test account): the unpublished start's `PLEX_CLAIM`, which the image ignores
+      for a signed-out Plex, takes one, and the claim through Plex's API another. An
+      unused claim token expires in four minutes, and a start that gets none would need
+      the setup to know the Plex is signed out first: left as it is.
   - Proves: a playbook deploys a stack, removes an app from it, and rebuilds the host,
     reading only the documented contract.
+  - **Done in S10c:** every `--json` document pinned in `packages/cli/src/contract.ts`,
+    with `ok` on each, and generated into `docs/reference/json.md` and a JSON Schema per
+    document; each item S10b left to pin is in it. A usage error under `--json` prints
+    the error document too, and the error document gives each diagnostic's code. Help and
+    hints name the published docs, and `docs:check` fails on a link that leads nowhere.
+    Spawned tests pin that a script is asked nothing, and no command waits on a named
+    pipe in place of `stack.yaml`. First-run setups are held in one pass, whatever the
+    catalog's order (the S10b final review's item). The guide to deploying with
+    automation, with a short Ansible example a test checks against the CLI; the full
+    README; the add-an-app guide. Every item below marked for S10c is settled, as each
+    says. `test/e2e/playbook.e2e.test.ts` proves it, on real Docker.
 
@@ -268,3 +286,4 @@ lighter route, or as a slice when it is big or touches security.
 
-- **M2: everyday CLI.**
+- **M2: everyday CLI.** It also takes the M1 items S10c moved there, listed under "M2
+  (everyday CLI)" in [Inputs for later slices](#inputs-for-later-slices-from-the-reviews).
   - Safe app updates: `mediaplane update`, with a backup first and a rollback.
@@ -958,2 +977,3 @@ password, which are S3c's (and listed again below).
     done in S10b, as its item says.
+  - **Settled in S10c,** each as its item says below.
 - **Decided by the owner on 2026-10-17:**
@@ -972,2 +992,6 @@ password, which are S3c's (and listed again below).
   account.
+  - **Settled in S10c: no sweep for now.** `pnpm exec tsx test/e2e/plex-cleanup.ts` with
+    the account's token removes the servers a run noted; one a killed run leaves is
+    removed by hand, in the account's settings. A sweep stays the owner's choice, listed
+    under M2.
 - **Keep `PLEX_TOKEN` in the `plex` environment, limited to `main`** (S7, owner). The
@@ -976,2 +1000,3 @@ password, which are S3c's (and listed again below).
   workflow from reading the secret, for whoever can push a branch.
+  - **Still the owner's step** (S10c's completion checklist lists it).
 - **A 429 from plex.tv counts as "couldn't tell"** (S7): it is retried after 5 and 15
@@ -980,2 +1005,4 @@ password, which are S3c's (and listed again below).
   if plex.tv's limits bite.
+  - **Settled in S10c: unchanged.** They haven't bitten in the nightly job; moved to M2,
+    to revisit if they do.
 - **Docker's default bridge network** (S7): the plex.tv helper needs it. A daemon set up
@@ -983,2 +1010,5 @@ password, which are S3c's (and listed again below).
   stack.
+  - **Settled in S10c: `plan` doesn't.** It is the host's set-up, not the stack's, and a
+    rare one; the helper's failure says what failed. Moved to M2, for `doctor`, which
+    checks a host.
 
@@ -988,7 +1018,13 @@ password, which are S3c's (and listed again below).
   - **Done in S9:** the SPDX field (GPL-3.0-or-later). Private vulnerability reporting
-    stays an owner's step: the S9 plan gives the command.
+    stays an owner's step: the S9 plan gives the command, and S10c's completion
+    checklist lists it.
 - **Docs:** make the `--json` contract explicit (pin its fields and document
   `mediaplane.plan/v1`). Drop the internal "Slice 1" wording from the README.
+  - **Done in S10c:** the [`--json` reference](../reference/json.md) and a JSON Schema per
+    document, generated from `packages/cli/src/contract.ts`, which a test checks every
+    printer against; the README names no slice.
 - **`plan --help` names `docs/security/threat-model.md` by its repo path** (S4). Someone
   running the published image can't open that. Point it at the published docs instead.
+  - **Done in S10c:** `plan --help`, `drift --help` and the hint of a missing
+    `stack.yaml` give the published docs' address (`docsUrl`).
 - **`credentials --json` has no `ok` field.** `init`, `plan`, `apply` and the error
@@ -996,2 +1032,4 @@ password, which are S3c's (and listed again below).
   Align it in the `--json` pass: adding `ok: true` is additive within v1.
+  - **Done in S10c:** `ok: true` on `credentials`, `status`, `history` and
+    `history <id>`, so every document has it.
 - **Tests:** tighten the catalog tag test, and add Renovate.
@@ -1001,2 +1039,4 @@ password, which are S3c's (and listed again below).
   `test/e2e/helpers.ts` (S3d), as the VPN test does.
+  - **Done in S10c:** a catalog tag must name a version (`^v?\d+\.\d+`), never a tag
+    that moves; the deploy test deploys with `deployMediaplane()`.
 - **Small test gaps from S3c and S4.** None hides a fault, and coverage holds without
@@ -1015,2 +1055,6 @@ password, which are S3c's (and listed again below).
     tried again. Nothing calls its `remove()` twice.
+  - **Settled in S10c:** the folder helper's two guards are tested; `servarrFailure`
+    gives one line of at most 200 characters, tested; `wireguard.ts` marks itself
+    removed only once it is. The shared teardown steps stay as they are (no third such
+    test came), and so does the echo server (sharing it isn't a plain move).
 - **A first-run setup that never gets ready waits twice its deadline** before it reports
@@ -1018,6 +1062,10 @@ password, which are S3c's (and listed again below).
   deadline.
+  - **Done in S10c:** a setup whose app isn't ready in time isn't asked again, so it fails
+    after one deadline; it stays unpublished (an app Mediaplane couldn't ask is open).
 - **The Jellyfin end-to-end test joins its container-ID claims** in one
   `toEqual([true, true])` (S5), so a failure doesn't say which claim broke. Split them.
+  - **Done in S10c.**
 - **The deploy end-to-end test restores the secret store after `plan`,** but not in a
   `finally` (S5). Move the restore into one.
+  - **Done before S10c:** the restore is in a `finally`.
 - **A test timeout skips `composeDown`** in the end-to-end files (S6): their teardown
@@ -1025,4 +1073,9 @@ password, which are S3c's (and listed again below).
   be left up. Fix it in the harness, for every file at once.
+  - **Done in S10c:** `test/e2e/setup.ts`, after each file, removes whatever its tests
+    left in Docker, by the run's names, and fails the file naming it. A test that times
+    out still leaves its body running until the file ends.
 - **Two wide tables** (S5): convert the README's capability table and the threat
   model's asset table to lists.
+  - **Done in S10c:** both are lists, and so are the README's table of the stack and
+    `CONTRIBUTING.md`'s of commands.
 - **A second app with a first-run setup** (S5): S6 brought it, Seerr. So a Jellyfin
@@ -1032,2 +1085,7 @@ password, which are S3c's (and listed again below).
   Take the ports away, and say so.
+  - **Moved to M2 in S10c.** Taking the ports away in that `apply` wouldn't last: Jellyfin's
+    own `system.xml` says its wizard is done, which is what `plan` goes by, so the next
+    `apply` would publish it again. The fix is for `plan` to ask Jellyfin itself, as it
+    asks Seerr when its file can't be read (S10b): a check of the kind `doctor` makes.
+    Until then the error says it is published, and to stop it.
 - **Pins outside the catalog.** Renovate must also bump the images pinned in:
@@ -1086,2 +1144,6 @@ password, which are S3c's (and listed again below).
   and say so in Renovate's pull request for a Compose bump.
+  - **Done in S10c,** probed with eleven releases of Compose: 2.29.7 to 2.40.3 agree, and
+    so do 5.0.2 to 5.6.1, but a 2.x and a 5.x differ for every service but Byparr, and
+    2.24.0 differs from later 2.x for Gluetun and qBittorrent. `docs/releasing.md` says
+    so, and Renovate's pull request for a bump of the image's `docker` says what to check.
 - **From S9's reviews, for S10c.** None hides a fault in S9's releases:
@@ -1100,2 +1162,8 @@ password, which are S3c's (and listed again below).
     the stack's user and group (1000), replayed on both Composes.
+  - **Done in S10c:** a test that Renovate can read every pinned tag, outside the catalog
+    too; `install.sh` refuses a `DOCKER_HOST` or `DOCKER_CONTEXT` that would point
+    `docker` away from the socket it checks (refused, not unset: whoever set one meant
+    it); every command that reads `stack.yaml` refuses a named pipe or a folder in its
+    place, without waiting (`config.not-a-file`); the indexers test checks that
+    `appdata/flaresolverr` is owned by 1000:1000, replayed on both Composes.
 - **From S10a's reviews:**
@@ -1112,2 +1180,4 @@ password, which are S3c's (and listed again below).
     the fields it doesn't know stay in the file. **For S10c.**
+    - **Done in S10c:** the reference says so: `history <id> --json` prints the fields
+      this release knows, with `ok`, and one it can't read is said to be there, unread.
 - **CI's end-to-end image pulls are flaky (for S10c, with the test gaps).** On
@@ -1118,2 +1188,5 @@ password, which are S3c's (and listed again below).
   the harness a longer retry budget than apply's.
+  - **Done in S10c:** the end-to-end job pulls every image the suite runs first
+    (`scripts/ci/pull-images.ts`), tried again after 15 s, 30 s, 1, 2 and 4 minutes on a
+    temporary registry error; `apply`'s own pulls, retries and reports are unchanged.
 - **Before the first real migration** of `stack.yaml` (none is planned, S10a to S10c
@@ -1123,2 +1196,3 @@ password, which are S3c's (and listed again below).
   first, rather than write overrides in the old version's shape.
+  - **Still open,** for whoever plans the first migration (none is planned yet).
 
@@ -1135,2 +1209,9 @@ password, which are S3c's (and listed again below).
 
+- **From S10c**, as their items above say:
+  - a Jellyfin `apply` started published whose wizard still looks open: have `plan` ask
+    Jellyfin itself, then take its ports away;
+  - `doctor`: Docker's default bridge network, which the plex.tv helper needs;
+  - plex.tv's `Retry-After`, and its 429s, if they bite;
+  - the owner's choice of a weekly sweep of the Plex test account's servers.
+
 - **From S8, for `doctor`:** appdata ownership, checked only when something else changes,
````

- [ ] **Step 7: Move the slices' plans to `docs/plans/m1/` (last)**

With `git mv`, so that each file's history follows it, this plan included:

```bash
mkdir -p docs/plans/m1
git mv docs/plans/m1-s1-pure-core.md docs/plans/m1-s2a-plan-against-docker.md \
  docs/plans/m1-s2b-apply.md docs/plans/m1-s2c-packaging.md \
  docs/plans/m1-s3a-admin-and-seed-files.md docs/plans/m1-s3d-vpn-check.md \
  docs/plans/m1-s3b-wiring.md docs/plans/m1-s3c-download-path.md \
  docs/plans/m1-s4-indexers.md docs/plans/m1-s5-jellyfin.md docs/plans/m1-s6-requests.md \
  docs/plans/m1-s7-plex.md docs/plans/m1-s8-drift.md docs/plans/m1-s9-releases.md \
  docs/plans/m1-s10a-recovery.md docs/plans/m1-s10b-automation.md \
  docs/plans/m1-s10c-contract.md docs/plans/m1/
```

Create `docs/plans/m1/README.md`:

````markdown
# M1's slice plans

These are the plans each slice of M1 was built from, one per slice, in the order the
[M1 roadmap](../m1-roadmap.md) lists them. Each says what was probed, what was decided
and why, and the code of each task as it was built then.

They are kept as a record, and are not kept up to date. The code on `main`, and the docs
beside it, are the truth: a plan's code, paths and values may have changed since it was
built. The [design spec](../../design/m1-engine-cli.md) is what they implement, and its
§11 records what each slice refined in it.
````

Each moved plan's prose links to the spec and the roadmap, one folder further up now.
Only those two links change in each, outside its code blocks, which quote files as they
were; this plan's links are from the root, so it doesn't change:

````diff
diff --git a/docs/plans/m1/m1-s1-pure-core.md b/docs/plans/m1/m1-s1-pure-core.md
index 4f0dfac..6cf7eff 100644
--- a/docs/plans/m1/m1-s1-pure-core.md
+++ b/docs/plans/m1/m1-s1-pure-core.md
@@ -25,3 +25,3 @@ The data flows like this:
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md). Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md).
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md). Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md).
 
diff --git a/docs/plans/m1/m1-s10a-recovery.md b/docs/plans/m1/m1-s10a-recovery.md
index a856b0a..0f8e081 100644
--- a/docs/plans/m1/m1-s10a-recovery.md
+++ b/docs/plans/m1/m1-s10a-recovery.md
@@ -43,3 +43,3 @@ bundles. No new dependency and no new image.
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -57,3 +57,3 @@ bundles. No new dependency and no new image.
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S10 row and its list, every
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S10 row and its list, every
 S8 item marked "Moved to S10", "S9 and S10 (before going public)", and "After M1".
diff --git a/docs/plans/m1/m1-s10b-automation.md b/docs/plans/m1/m1-s10b-automation.md
index 4ed207f..befe2d0 100644
--- a/docs/plans/m1/m1-s10b-automation.md
+++ b/docs/plans/m1/m1-s10b-automation.md
@@ -45,3 +45,3 @@ no new image.
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -56,3 +56,3 @@ no new image.
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S10 row and its list,
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S10 row and its list,
 every item marked "Moved to S10b", "S9 and S10 (before going public)", and "After M1".
diff --git a/docs/plans/m1/m1-s2a-plan-against-docker.md b/docs/plans/m1/m1-s2a-plan-against-docker.md
index 8a3541f..20df2da 100644
--- a/docs/plans/m1/m1-s2a-plan-against-docker.md
+++ b/docs/plans/m1/m1-s2a-plan-against-docker.md
@@ -39,5 +39,5 @@ jsdiff 9, Commander 15, Vitest 4), plus Node's `child_process`, `net`, `dgram` a
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular
 §4.1, §4.2, §5 (stages 3–5) and §7.2. Slice context:
-[`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially "Inputs for later slices", S2.
+[`docs/plans/m1-roadmap.md`](../m1-roadmap.md), especially "Inputs for later slices", S2.
 
diff --git a/docs/plans/m1/m1-s2b-apply.md b/docs/plans/m1/m1-s2b-apply.md
index e101120..0a29229 100644
--- a/docs/plans/m1/m1-s2b-apply.md
+++ b/docs/plans/m1/m1-s2b-apply.md
@@ -45,3 +45,3 @@ with `wx`, `rename`, `fsync`). No new npm dependencies.
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -54,3 +54,3 @@ with `wx`, `rename`, `fsync`). No new npm dependencies.
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially the S2b row of
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md), especially the S2b row of
 the S2 split, and the "S2b (blockers for `apply`)" list under "Inputs for later slices
diff --git a/docs/plans/m1/m1-s2c-packaging.md b/docs/plans/m1/m1-s2c-packaging.md
index 4e8c96c..eacc115 100644
--- a/docs/plans/m1/m1-s2c-packaging.md
+++ b/docs/plans/m1/m1-s2c-packaging.md
@@ -70,3 +70,3 @@ Each version was at least two weeks old on 2026-10-09: the newer `docker 29.8.2`
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -80,3 +80,3 @@ Each version was at least two weeks old on 2026-10-09: the newer `docker 29.8.2`
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially:
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md), especially:
 
diff --git a/docs/plans/m1/m1-s3a-admin-and-seed-files.md b/docs/plans/m1/m1-s3a-admin-and-seed-files.md
index b2999b5..61bf63a 100644
--- a/docs/plans/m1/m1-s3a-admin-and-seed-files.md
+++ b/docs/plans/m1/m1-s3a-admin-and-seed-files.md
@@ -48,3 +48,3 @@ PBKDF2 comes from `node:crypto`, and the end-to-end tests use only images alread
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -57,3 +57,3 @@ PBKDF2 comes from `node:crypto`, and the end-to-end tests use only images alread
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially the S3 row, the S3
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md), especially the S3 row, the S3
 list in "Inputs for later slices from the reviews", and "Every slice writes its own docs as
diff --git a/docs/plans/m1/m1-s3b-wiring.md b/docs/plans/m1/m1-s3b-wiring.md
index 10bf312..cd53136 100644
--- a/docs/plans/m1/m1-s3b-wiring.md
+++ b/docs/plans/m1/m1-s3b-wiring.md
@@ -34,3 +34,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -44,3 +44,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S3 split ("S3b: the
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S3 split ("S3b: the
 wiring framework"), the S3 items in "Inputs for later slices from the reviews", and the
diff --git a/docs/plans/m1/m1-s3c-download-path.md b/docs/plans/m1/m1-s3c-download-path.md
index 8a634ee..7bfbb0f 100644
--- a/docs/plans/m1/m1-s3c-download-path.md
+++ b/docs/plans/m1/m1-s3c-download-path.md
@@ -31,3 +31,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -43,3 +43,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S3 split ("S3c: the
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S3 split ("S3c: the
 download path"), the S3 items "qBittorrent's settings after its first start" and "The
diff --git a/docs/plans/m1/m1-s3d-vpn-check.md b/docs/plans/m1/m1-s3d-vpn-check.md
index 12fe292..4e78cdd 100644
--- a/docs/plans/m1/m1-s3d-vpn-check.md
+++ b/docs/plans/m1/m1-s3d-vpn-check.md
@@ -39,3 +39,3 @@ in the end-to-end tests only: `lscr.io/linuxserver/wireguard`, pinned by tag and
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -47,3 +47,3 @@ in the end-to-end tests only: `lscr.io/linuxserver/wireguard`, pinned by tag and
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially the S3 split
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md), especially the S3 split
 ("S3 is delivered in four parts"), the S3d list in "Inputs for later slices from the
diff --git a/docs/plans/m1/m1-s4-indexers.md b/docs/plans/m1/m1-s4-indexers.md
index b09f844..00dd4cf 100644
--- a/docs/plans/m1/m1-s4-indexers.md
+++ b/docs/plans/m1/m1-s4-indexers.md
@@ -31,3 +31,3 @@ the made-up indexer runs on the busybox the end-to-end helpers already pin.
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -45,3 +45,3 @@ the made-up indexer runs on the busybox the end-to-end helpers already pin.
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S4 row ("Indexers added
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S4 row ("Indexers added
 in Prowlarr reach both arrs, and proxied requests work"), the S4 list in "Inputs for later
diff --git a/docs/plans/m1/m1-s5-jellyfin.md b/docs/plans/m1/m1-s5-jellyfin.md
index c41ebc2..3dd3685 100644
--- a/docs/plans/m1/m1-s5-jellyfin.md
+++ b/docs/plans/m1/m1-s5-jellyfin.md
@@ -37,3 +37,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -52,3 +52,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S5 row ("Jellyfin
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S5 row ("Jellyfin
 bootstrap-before-publish, its API key and libraries, and the arr → Jellyfin connections";
diff --git a/docs/plans/m1/m1-s6-requests.md b/docs/plans/m1/m1-s6-requests.md
index be476cd..5544ae8 100644
--- a/docs/plans/m1/m1-s6-requests.md
+++ b/docs/plans/m1/m1-s6-requests.md
@@ -37,3 +37,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -50,3 +50,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S6 row ("The Seerr first
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S6 row ("The Seerr first
 sign-in through the Jellyfin admin, libraries, the Sonarr/Radarr servers, initialize, and
diff --git a/docs/plans/m1/m1-s7-plex.md b/docs/plans/m1/m1-s7-plex.md
index 0f6d449..9dc0b37 100644
--- a/docs/plans/m1/m1-s7-plex.md
+++ b/docs/plans/m1/m1-s7-plex.md
@@ -40,3 +40,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -51,3 +51,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S7 row ("`plex-login`
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S7 row ("`plex-login`
 (the plex.tv PIN flow), the Plex claim through a plex.tv helper, its libraries, the arr →
diff --git a/docs/plans/m1/m1-s8-drift.md b/docs/plans/m1/m1-s8-drift.md
index 40f9715..8cb2543 100644
--- a/docs/plans/m1/m1-s8-drift.md
+++ b/docs/plans/m1/m1-s8-drift.md
@@ -45,3 +45,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -56,3 +56,3 @@ Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no ne
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S8 row ("The three-way
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S8 row ("The three-way
 drift model, `drift`, `keep` (Keep mine), a comment-preserving override writer,
diff --git a/docs/plans/m1/m1-s9-releases.md b/docs/plans/m1/m1-s9-releases.md
index 9c5ec96..3f4f4fe 100644
--- a/docs/plans/m1/m1-s9-releases.md
+++ b/docs/plans/m1/m1-s9-releases.md
@@ -48,3 +48,3 @@ dependency. The image's Node goes from 24.21.0 to 24.22.1, a security release.
 
-**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:
+**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:
 
@@ -57,3 +57,3 @@ dependency. The image's Node goes from 24.21.0 to 24.22.1, a security release.
 
-Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S9 row and its list, "After
+Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S9 row and its list, "After
 M1" ("Updates happen only when you run them"), "CI architecture coverage", and every item
````

Run: `pnpm docs:check`. Expected: it passes, so every link leads somewhere. Before the
move, it would have named `README.md: docs/plans/m1/` and each roadmap link to a plan.

- [ ] **Step 8: The full check, and commit**

Run: `pnpm docs:generate` (it writes nothing: the reference is Task 2's), then
`pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
Expected: all pass.

```bash
git add -A
git commit -m "docs: deploying with automation, the full README and the add-an-app guide; M1 is done, and its slices' plans move to docs/plans/m1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git log --follow docs/plans/m1/m1-s1-pure-core.md` shows the plan's history from before
the move.

## Slice 10c completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 97.94% statements, 93.07% branches, 97.9% functions and 99.1% lines, with 2664 tests in 122 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too, and leaves no
  `mediaplane-e2e-*` container, network, volume or image, and no `mediaplane-e2e-*`
  folder. When this plan was replayed, alone on the dev box, warm, with a plex.tv test
  account's token (so the nightly test ran too, and removed the servers it claimed):
  - with Compose 5.5.1, 32 tests passed in 15 files, in 23 min 31 s (the playbook test,
    run alone, takes about 2 min 15 s);
  - with Compose 2.38.2, 32 passed in 15 files, in 24 min 32 s.

  No temporary registry error came up in either run. The first replay's 5.5.1 run found
  the claim count after the claim again is 3, not the 2 the roadmap's item said (probe
  11): Tasks 5 and 8 were corrected, replayed again from Task 5, and the runs above are of
  the corrected plan.

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] The playbook test (`test/e2e/playbook.e2e.test.ts`) passes on both Composes: a stack
  deployed from the image, an app taken out, and the host rebuilt, reading only exit codes
  and documents, each checked against its published JSON Schema.
- [ ] The nightly Plex test checks the files and `.env` after the claim again, and that it
  took two more claim tokens: run it with the test account's token
  (`MEDIAPLANE_E2E_PLEX_TOKEN_FILE`, and `pnpm exec tsx test/e2e/plex-cleanup.ts` after),
  or see the nightly job pass on `main` once this slice merges.
- [ ] The socket proxy's allow-list is unchanged:
  `git diff f2fdcd8 -- deploy/mediaplane.compose.yaml` prints nothing, and
  `deploy/deploy.test.ts`'s allow-list is as it was (only its installer sandbox changed).
  `f2fdcd8` is `main` before this slice.
- [ ] Every slice plan is in `docs/plans/m1/`, this one included, and only the roadmap is
  left in `docs/plans/`: `ls docs/plans` prints `m1` and `m1-roadmap.md`.
- [ ] No committed file contains a real path, user name, host name, address or token:
  `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing but the
  project's own names (its GitHub repo, its docs' and schemas' addresses, its GHCR image,
  the workflows' repository guards, the release notes' install commands) and the tests'
  fake `/srv/data/home` paths.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B f2fdcd8.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse: 2 (the
    contract as Zod schemas in the CLI, Zod a direct dependency), 3 (`ok` on every
    document, the change record's with it), 10 (setups held in one pass, rather than the
    order pinned by a test), 12 (published-open Jellyfin moved to M2, against the S5
    item's "take the ports away"), 15 (`install.sh` refuses `DOCKER_HOST` and
    `DOCKER_CONTEXT`, rather than unsetting them) and 18 (the proof from the image, and
    the Ansible example checked by a unit test, not `ansible-lint`);
  - that M1 is complete once this slice merges: the roadmap's "After M1" has M2.

The owner's steps, none of them new in this slice, and all still to do as far as the
repository shows (the roadmap and `docs/releasing.md` give each):

- keep `PLEX_TOKEN` in the `plex` environment, limited to `main`, so the nightly Plex job
  runs;
- enable GitHub's private vulnerability reporting, which `SECURITY.md` relies on;
- protect `main`, requiring `All checks passed`;
- install the Renovate app;
- cut the first release (merging release-please's pull request);
- the owner's choice whether a weekly sweep removes every server of the Plex test
  account (listed under M2).
