# M1 Slice 3c: the download path — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apply` links the download path through the apps' APIs, on the VPN topology:
qBittorrent takes the shared login, its settings and a category for each arr through
its API, and Sonarr and Radarr get qBittorrent as their download client, through
Gluetun, and their root folders, from source and from the image behind the socket
proxy.

**Architecture:**

- **qBittorrent's integration** (`catalog/qbittorrent/integration.ts`): four resources
  on S3b's contract, `qbittorrent.admin`, `qbittorrent.preferences`,
  `qbittorrent.category_tv` and `qbittorrent.category_movies`, all through its API with
  its Bearer key. Its password is checked by signing in.
- **Sonarr's and Radarr's download path** (`catalog/_shared/servarr-download.ts`):
  `<arr>.download_client`, which requires qBittorrent's category for that arr and is
  checked with the arr's own test, and `<arr>.root_folder`. The arrs come after
  qBittorrent.
- **Three small additions to the engine:** a resource's `desired` sees the stack's keys,
  and its `verify` what the app holds; the wire step makes a resource's folders first,
  in a throwaway container of the app; the HTTP client sends forms, runs an app's own
  test, and takes a sign-in's 401 as an answer. Two S3b leftovers fold in: no secret is
  checked while a field differs, and `plan` predicts `wire.secret-field`.

**Tech Stack:** as Slice 3b (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3 (success criterion 1: "qBittorrent is registered in both arrs, with per-app
  categories; root folders exist");
- §6.1 (the shared admin, login on the LAN, qBittorrent's whitelist), §6.2 (the
  download rows: the download client, the root folder and qBittorrent's categories, and
  the ordering), §6.3 (secrets verified, never compared; identity and re-adoption),
  §6.4 (Gluetun dependants; after the first start the API is the only write path);
- §7.2(2) (the socket proxy), §7.2(4) (secrets), §7.2(5) (the arrs reach qBittorrent
  with its key), §8.1(2) and (3) (adapter tests against a fake server, end-to-end tests
  against real containers), §9 (the documentation set).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S3 split ("S3c: the
download path"), the S3 items "qBittorrent's settings after its first start" and "The
shared admin password, through each app's API", and the S3c list in "Inputs for later
slices from the reviews".

Decisions made for S3 before this plan (the controller's rulings, 2026-10-09):

- **D11: Automatic Torrent Management is on** (`autoTmm: true`, and the pre-start file's
  `Session\DisableAutoTMMByDefault=false`), so a torrent follows its category's save
  path under `/data/torrents/` (spec §6.2).
- **D3, D4, D8, D12 and D13 as the research recommends:** the contract and
  `resources.json` (S3b), the download clients saved with `forceSave` and checked with
  the arrs' own test, and the root folders' directories made by a `compose run` helper.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`), with one line of context. It
  is exact: save it to a file and run `git apply <file>` from the repo root, or make the
  same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact says
  to run `pnpm docs:generate`, and names what it rewrites.
- Every block was applied in order to a fresh worktree at `d401c2e`, and each task's
  tests failed before its implementation and passed after it (see the completion
  checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a, 3d and 3b Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`, `m1-s3d-vpn-check.md`,
`m1-s3b-wiring.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `'0'.repeat(32)`, `` `qbt_${'1'.repeat(28)}` `` or `fake-admin-password`. Addresses in
  tests and docs come from the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`,
  `203.0.113.0/24`), private ranges, or `fd00::/8`;
- neutral framing;
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and neither does `vpn-check`. `plan`'s one change to Docker is
  still joining the wiring network from the image (S3b decision 2);
- Docker is reached only through the `Runtime` (the end-to-end tests may call `docker`
  themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`, and never reach a real app: HTTP tests use
  `fakeHttpApp` or `fakeStackApis` on `127.0.0.1`;
- the runtime refuses any Compose project that is not `mediaplane` or
  `mediaplane-<name>`, and never accepts `mediaplane-system`;
- every image is pinned by digest, and every GitHub Action by commit SHA;
- end-to-end test files run one at a time; names in them start with `mediaplane-e2e-`;
  teardown never stops at the first failure, and brings the deployment (`-system`) down
  before the stack;
- never prune images (`docker image prune`, `docker system prune`);
- temporary folders in unit tests come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing`;
- coverage thresholds are never lowered: `vitest.config.ts` keeps 90% lines, functions,
  branches and statements on `packages/engine/src`;
- the integration contract: `observe`, `create`, `update`, `requires`, `after` and
  `verify`; resource records hold names only; a part-way failure is recorded as
  `failed`; a resource that requires a failed or skipped one is `skipped`;
- never push.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records,
  `state/resources.json`, logs, human or JSON output, command lines, container
  environments, `docker inspect` or the public CI log. That covers the apps' API keys,
  the admin password, qBittorrent's PBKDF2 hash, its session cookie and the WireGuard
  key. This slice adds:
  - **qBittorrent's key goes to Sonarr and Radarr** in a request body, their download
    client's settings: the one place one app's key goes to another. The arrs give it
    back masked (`********`), and their test is sent the masked client, by its id.
  - **The admin password goes to qBittorrent** in a request body only: its preferences
    (`setPreferences`, a form with the key), and the sign-in that checks it.
    qBittorrent's session cookie (`SID`) is dropped, as the client drops every cookie.
  - **qBittorrent's preferences hold its own key** (`web_ui_api_key`): they are read
    with `z.object`, which keeps only the fields Mediaplane manages, and are never
    printed.
  - **The folder helper** (`compose run … mkdir -p -- <path>`) carries only the
    catalog's container paths on its command line, and the stack's secret values only
    to be redacted from what it prints.
  - End-to-end assertions that see a key or the password say only whether they passed.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and
  `deploy/deploy.test.ts` don't change. Anything that would need a new Docker API call is
  a security-sensitive decision for the controller, not for an implementer (decision 6).
- **qBittorrent sits in Gluetun's network namespace.** Mediaplane reaches its API
  through Gluetun on the wiring network, as S3b does. The arrs reach it as `gluetun`, at
  qBittorrent's own web UI port, which Gluetun's firewall accepts (Task 6 shows it).
- **Paths follow spec §6.2:** category save paths `/data/torrents/<category>`, the
  default save path `/data/torrents`, root folders `/data/media/tv` and
  `/data/media/movies`, all under the one `/data` mount the apps share, so an import is
  a hard link. Automatic Torrent Management is on (D11).
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. The two Composes hash bind
  volumes differently, so an `apply` from the image after one from the host recreates
  the apps that have them (ADR 0010); the end-to-end tests allow for that. This slice
  adds no `docker` or Compose flag.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes a catalog fact runs `pnpm docs:generate` first and commits the generated
  files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it.
  - Short, plain sentences; lists rather than wide tables; no internal jargon (no
    "controller", "preflight", "ruling" or decision numbers in public docs).
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid,
    because Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.

## Decisions taken in this plan

The spec and the rulings leave these open. Each is marked `Decision:` where it is
applied. The ones the controller should look at first are marked **(check)**. Every
fact about an app below was checked on the pinned images on real Docker (Compose 5.5.1,
aarch64) while writing this plan, unless it says otherwise.

1. **(check) qBittorrent's four resources** (Task 4). All go through its API with the
   Bearer key, which needs no password and no restart:
   - `qbittorrent.admin`: field `username`, secret `password`. Read from
     `GET /api/v2/app/preferences` (`web_ui_username`), and set with
     `POST /api/v2/app/setPreferences` (`web_ui_username`, `web_ui_password`). The
     password is never readable. qBittorrent always has a user (its pre-start file sets
     the shared one), so `observe` always finds one.
   - `qbittorrent.preferences`: fields `savePath` (`/data/torrents`), `autoTmm`
     (`true`, D11), and the LAN that may skip the login, `authSubnetWhitelistEnabled`
     and `authSubnetWhitelist` (decision 11). Set with one `setPreferences`.
   - `qbittorrent.category_tv` and `qbittorrent.category_movies`: field `savePath`
     (`/data/torrents/tv`, `/data/torrents/movies`), each only while Sonarr or Radarr
     is in the stack. qBittorrent knows a category by its name (its id is the name), made
     with `torrents/createCategory` (409 when it exists) and moved with `editCategory`
     (404 when it doesn't).
   - `setPreferences` takes a form whose `json` field holds the values. It answers 200
     to JSON it can't parse and ignores it, and misreads a wrong type (a number for
     `save_path` became `/config/Downloads/5`), so each value is sent with qBittorrent's
     own type, and the next `plan` checks what it kept.
   - qBittorrent gives a path back without its trailing "/" (`/data/torrents/` reads
     `/data/torrents`), and the whitelist with one subnet per line, though it takes
     them comma-separated. `observe` reads both that way.
2. **(check) qBittorrent's password is checked by signing in, and qBittorrent's ban**
   (Tasks 3, 4).
   - `POST /api/v2/auth/login` answers 204 to the right login and 401 to a wrong user
     name or password. After five failures in a row from one address, it answers 403
     ("Your IP address has been banned after too many failed authentication attempts.")
     for an hour (its defaults, `web_ui_max_auth_fail_count: 5` and
     `web_ui_ban_duration: 3600`). A success resets the count. The ban stops sign-ins
     only: the Bearer key still works, and `setPreferences` too.
   - So `verify` takes 401 as an answer (`login(…, { answers: [401] })`), and lets the
     403 throw: `plan` shows `unknown` with qBittorrent's own words, and apply fails that
     resource. A ban is never read as a wrong password.
   - A sign-in fails only while qBittorrent's password differs from the stack's, and
     only while the user name matches (decision 8). A changed `admin.password` costs two
     failures (`plan`, then the wire step's look), and the check after the update signs
     in, which resets the count. Five `plan`s between changing the password and applying
     it would ban Mediaplane's address: from source the wiring network's gateway, from
     the image Mediaplane's own address there; never the browser's, which reaches the
     published port from another network. The runbook says what to do.
   - Rejected: reading the PBKDF2 hash from `qBittorrent.conf` (the file is the app's
     after its first start, and can lag what it holds: spec §6.4), and setting the
     password on every `apply` (a second `apply` would never say "No changes").
3. **(check) The download clients** (Task 5). `sonarr.download_client` and
   `radarr.download_client`, named `qBittorrent (Mediaplane)`, with fields `host`,
   `port`, `useSsl`, `category` and `enable`, and the secret `apiKey` (spec §6.2):
   - **host** is how the arr reaches qBittorrent: `gluetun` behind the VPN, the service
     whose network qBittorrent shares, which the arrs reach on the stack's network;
     otherwise `qbittorrent`. **port** is qBittorrent's own (`apps.qbittorrent.port`,
     8080 by default): its Host check needs the published and container ports equal.
     **category** is `tv` (Sonarr's `tvCategory`) or `movies` (Radarr's
     `movieCategory`).
   - **Made** from the arr's own template (`GET /api/v3/downloadclient/schema`, its
     `QBittorrent` entry, without its UI `presets`), and saved with `?forceSave=true`
     (D12), so it saves even while qBittorrent is down: the check says whether it works.
     **Updated** by PUTting the client back as the arr gave it, with the managed
     settings and the key replaced, so a setting Mediaplane doesn't manage, such as its
     priority, stays the user's.
   - **Found** by the id `resources.json` recorded, else by its name, among the arr's
     qBittorrent clients only. The arr refuses a second client of the same name ("Should
     be unique"), which the runbook covers.
   - **`requires: ['qbittorrent.category_<category>']`** (the roadmap's S3c item): the
     arr's own test makes a missing category with an empty save path (research F11,
     seen again), so a failed category skips the client. Sonarr and Radarr come
     `after: ['qbittorrent']`, so the category is in place first (spec §6.2).
   - A template without one of the settings Mediaplane sets (`host`, `port`, `useSsl`,
     `apiKey`, the category) fails with `wire.protocol`, naming it, rather than saving a
     client that can't work.
4. **(check) A download client's key is checked with the arr's own test** (Tasks 3, 5).
   `verify` reads the client as the arr holds it (its key masked) and POSTs it, with its
   id, to `/api/v3/downloadclient/test`:
   - a 2xx passes, and so does a 400 with only warnings (`isWarning: true`), as the
     arr's own UI says;
   - a 400 whose errors name `ApiKey` (or `Username` or `Password`) means the key it
     holds isn't qBittorrent's: `plan` says `update (apiKey)`, and the update sets it;
   - any other error, such as `Host: Unable to connect to qBittorrent`, is thrown with
     the arr's own words: `unknown` in `plan`, a failed resource in the wire step, and
     "changes remain" in verify. Re-applying can't fix a connection.
   - Without the id, the arr tests the client as a new one, and refuses it ("Should be
     unique"), so the test always carries it. The test runs in the arr's own container,
     so verify passing shows that the arr reaches qBittorrent through Gluetun's
     firewall: spec §6.2's secret check.
5. **(check) Root folders, and their folders** (Tasks 2, 5). `sonarr.root_folder`
   (`/data/media/tv`) and `radarr.root_folder` (`/data/media/movies`), field `path`:
   - the arrs give a root folder no name and can't change one (`PUT` answers 405), so it
     is known by its path, with or without a trailing "/", and a found one is always as
     wanted: its `update` does nothing;
   - `POST /api/v3/rootfolder` needs the folder to exist (F12). A resource's `desired`
     can name `folders`, and the wire step makes them before it creates the resource:
     `mkdir -p -- <path>` in a throwaway container of the arr's own service, as the
     stack's `user:` (`runtime.run`, the `compose run` vpn-check's probe uses: D13). The
     folder is then the data folder's as the apps see it, and the stack's user owns it;
     preflight already checks that user can write the data folder. A failure names the
     folder and mkdir's own last line (`wire.folders`), and sends nothing to the arr;
   - a path that changes (S4's overrides) would add a root folder and leave the old one,
     which may hold a library. The roadmap asks S4 to decide what to do with it.
6. **(check) No new Docker API call, and no proxy permission** (Task 6). The new calls
   are the apps' HTTP APIs over the wiring network, and the folder helper's `compose
   run`. That makes the Docker calls the ownership helper's `chown` and vpn-check's
   probe already make through the proxy (container create, attach, start, wait, delete).
   What is new is the service: Sonarr and Radarr are on two networks (`default` and
   `wiring`), where the ownership helper's Seerr and the probe's qBittorrent are not.
   Compose puts a one-off container on a service's networks either in the create call
   or with `POST /networks/{id}/connect`, and the allow-list allows both, for any
   network (S3b's join uses the second). `deploy/mediaplane.compose.yaml` and
   `deploy/deploy.test.ts` don't change. Task 6 runs the helper from the image behind
   the real proxy: the deploy test makes Sonarr's root folder, and the download test
   Radarr's again, and both pass with the image's Compose 5.5.1, so the proxy let
   through whatever it called.
7. **The contract grows, additively** (Tasks 1, 2): `WiringContext.keys` (the store's
   app keys, for a resource that holds another app's), `verify(api, desired, observed)`
   (for an app's own test of what it holds), and `DesiredResource.folders`. The Servarr
   admin's code doesn't change; its tests pass `verify` the third argument.
8. **(check) While a managed field differs, the secrets aren't checked** (Task 1; the
   S3b final review's minor 17). Update always sets the fields and the secrets together
   (the contract now says so), so checking them would change nothing, and it misled:
   the Servarr admin's sign-in, with a user name the app doesn't have yet, failed as if
   the password were wrong, and `plan` said `update (username, password)`. For
   qBittorrent it would also spend a sign-in towards the ban (decision 2). `plan` now
   names only the field, and apply's detail says `updated username`.
9. **`plan` predicts `wire.secret-field`** (Task 1; the S3b final review's minor 18). A
   resource whose managed field holds one of the stack's secrets is `unknown` in `plan`,
   with the same message as a warning, and nothing is asked of it; apply's wire step
   still refuses it. The check and its message move to `wiring.ts`, shared by both.
10. **The HTTP client gains three things** (Task 3):
    - `form(path, fields, { secrets })`: a POST of a form with the key (qBittorrent's
      API), tried again only when nothing reached the app, like `post`;
    - `test(path, body)`: an app's own test. A 2xx passes; a 400 returns the errors of
      Servarr's validation list, each `property` and `message (details)` made safe as
      `appMessage` makes a message (redacted, one line, at most 200 characters), never a
      warning or an `attemptedValue`. Any other answer, or a 400 that isn't such a list,
      throws as `post` would;
    - `login(path, fields, { answers })`: statuses that are the sign-in's answer, not a
      failure.

    A refused call that carried no key now says "refused the request", not "refused
    Mediaplane's API key": qBittorrent's ban is a 403 to a sign-in.
11. **(check) qBittorrent's whitelist after its first start** (Task 4). `preferences`
    manages it both ways, as the pre-start file sets it (spec §6.1): off and empty with
    `security.login_on_lan: true` or the web UI off the LAN; otherwise on, listing the
    LAN subnets (`lanClientSubnets`), comma-separated without spaces. So a change of
    `login_on_lan`, `network.bind` or `network.lan_subnet` now reaches qBittorrent, and a
    whitelist set in its web UI is put back by `apply` (S4's Keep mine will let you keep
    it).
12. **The end-to-end test** (Task 6). A new `test/e2e/download.e2e.test.ts` on the VPN
    topology, with S3d's WireGuard server and qBittorrent on port 8090 (the download
    clients must follow it):
    - from source, the first `apply` adopts qBittorrent's login and settings (its
      pre-start file made them) and creates the rest; the checks below pass; a password
      changed by hand in qBittorrent comes back with the next `apply`, which changes
      nothing else; and the one after that has no changes;
    - from the image, behind the real proxy, after Radarr's link is taken apart by hand
      (its client, its root folder and the folder itself, qBittorrent's `movies`
      category) and qBittorrent's password changed, `apply` makes each one again; the
      checks pass again; then the image's `plan` and a second `apply` have no changes;
    - the checks: qBittorrent takes the shared login (204), holds both categories with
      their save paths, saves under `/data/torrents` with Automatic Torrent Management
      on; each arr holds `qBittorrent (Mediaplane)` aimed at `gluetun:8090` with its
      category, and the arr's own test of it answers 200; each root folder exists and is
      accessible; and qBittorrent, Sonarr and Radarr mount one folder at `/data`.
    - It passes with Compose 5.5.1 and 2.38.2 as the host plugin: the image's `apply`
      may recreate the apps (the two hash bind volumes differently), and the test reads
      nothing that recreating changes. The apply, deploy and VPN tests change only their
      lists of what is wired.
13. **The docs** (Task 7): the wiring-failed runbook (the new messages, `wire.folders`,
    the ban), the architecture, the threat model (T2, T4, T5, T10), the README's status,
    capabilities and example, the three app READMEs and the deploy guide (the "until
    Slice 3c" notes go), the spec (a "Slice 3c" entry in §11) and the roadmap (S3c done,
    and what it leaves for S4).

## File structure (new and changed in this slice)

`packages/engine/src/`:

- `integrations/types.ts`: `WiringContext.keys`, `verify`'s `observed`,
  `DesiredResource.folders`, and the rule that `update` sets fields and secrets together.
- `integrations/wiring.ts` (+test): `examine` checks no secret while a field differs;
  `planWiring` gives each resource the keys, and predicts `wire.secret-field`, with
  `fieldHoldingSecret` and `secretFieldReason`, now shared.
- `integrations/wire.ts` (+test): the keys in each resource's context, and the folders a
  resource needs, made before it is created (`makeFolders`).
- `http/client.ts` (+test): `form`, `test` (`TestFailure`), `login`'s `answers`, and the
  wording of a refused call made without the key.
- `testing/wiring.ts`: `fakeStackApis` gains qBittorrent's preferences, categories and
  sign-in, and Sonarr's and Radarr's download clients and root folders;
  `freshAppState`, `FakeDownloadClient`.

`catalog/`:

- `qbittorrent/integration.ts` (+test), new: `qbittorrent.admin`,
  `qbittorrent.preferences`, `qbittorrent.category_tv`, `qbittorrent.category_movies`;
  `qbittorrent/app.ts` gains `integration`.
- `_shared/servarr-download.ts` (+test), new: `servarrDownloadClient`,
  `servarrRootFolder`, `DOWNLOAD_CLIENT_NAME`.
- `_shared/servarr.ts`: `servarrIntegration` takes the arr's other resources.
- `sonarr/integration.ts`, `radarr/integration.ts`: after qBittorrent, with the download
  client and the root folder.
- `catalog.test.ts`, and the generated facts in `qbittorrent`, `sonarr` and `radarr`'s
  READMEs.

Elsewhere:

- `packages/cli/src/run.test.ts`: the real catalog's new wiring, on `fakeStackApis`.
- `scripts/docs/catalog-facts.test.ts`: an app that manages nothing is now Jellyfin.
- `test/e2e/download.e2e.test.ts`, new; `test/e2e/wireguard.ts` (`gluetunEnv`,
  `envLines`); `apply.e2e.test.ts`, `deploy.e2e.test.ts`, `vpn.e2e.test.ts` (their
  wiring lists).
- docs: the wiring-failed runbook, the architecture, the threat model, the README, the
  qBittorrent, Sonarr, Radarr and Gluetun READMEs, the deploy guide, the spec and the
  roadmap.

**Tasks:**

1. The contract, for the download path: a resource's keys and what the app holds; no
   secret checked while a field differs; `plan` predicts `wire.secret-field`.
2. The wire step makes the folders a resource needs.
3. The HTTP client: forms, an app's own test, and a sign-in's own answers.
4. qBittorrent's integration: its login, its settings and its categories.
5. Sonarr's and Radarr's download client and root folder, after qBittorrent.
6. End-to-end: the download path behind the VPN, from source and from the image.
7. Docs: the runbook, the architecture, the threat model, the READMEs, the spec and the
   roadmap.

**Out of scope here:**

- **Keep mine and drift** for the new resources, and what to do with a root folder whose
  path changes: S4 (the roadmap's new S4 items).
- **Prowlarr's links, the media server, Seerr:** Slices 5 to 7.
- **A real grab through an indexer**, which would show that the arrs add torrents with
  their category and no save path (research R3): there is no indexer in the tests.
  Automatic Torrent Management is on, so qBittorrent files such a torrent under the
  category's path (research F20).

---

### Task 1: The contract, for the download path

A download client holds another app's key, and its check is the arr's own test of what
it holds: the contract gives a resource the stack's keys and gives `verify` what the app
holds. Two leftovers of the S3b final review fold in: no secret is checked while a
managed field differs (decision 8), and `plan` predicts `wire.secret-field` (decision 9).

Decision: `WiringContext.keys` is the store's `apps` (in `plan`, the preview with the
keys apply would generate), and `verify(api, desired, observed)`; both additive (decision
7).
Decision: `examine` calls `verify` only when every managed field matches; `update` sets
the fields and the secrets together, as every resource's already does (decision 8).
Decision: `planWiring` checks each wanted resource with the wire step's own
`fieldHoldingSecret` before it asks the app; such a resource is `unknown`, with the
warning `wire.secret-field` and the wire step's message (decision 9).

**Files:**
- Modify: `packages/engine/src/integrations/types.ts`,
  `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/integrations/wire.ts`
- Test: `packages/engine/src/integrations/wiring.test.ts`,
  `packages/engine/src/integrations/wire.test.ts`, `catalog/_shared/servarr.test.ts`

**Interfaces:**
- **Consumes:** S3b's contract (`ResourceSpec`, `WiringContext`, `examine`,
  `planWiring`, `wire`).
- **Produces:**
  - `WiringContext.keys: Readonly<Record<string, Readonly<Record<string, string>>>>`;
  - `ResourceSpec.verify?(api: AppApi, desired: DesiredResource, observed: ObservedResource): Promise<boolean>`;
  - `fieldHoldingSecret(spec: ResourceSpec, desired: DesiredResource, secrets: readonly string[]): string | undefined`
    and `secretFieldReason(address: string, field: string): string`, exported from
    `integrations/wiring.ts`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 0078b5b..86d5ec9 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -11,2 +11,3 @@ import {
   fakeSonarr,
+  WIRED_CATALOG,
   WIRING_RUNNING as RUNNING,
@@ -90,3 +91,3 @@ describe('planWiring', () => {
     expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
-      { resource: 'sonarr.login', action: 'update', changes: ['user', 'password'] },
+      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
     ]);
@@ -98,2 +99,65 @@ describe('planWiring', () => {
 
+  it('checks no secret while a field differs: the update sets them all the same', async () => {
+    // The password is right, but under another user name: a sign-in as the wanted user
+    // would fail, and name a password that is fine.
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
+  });
+
+  it("gives a resource the stack's keys, and its check what the app holds", async () => {
+    const seen: unknown[] = [];
+    const linked: ResourceSpec = {
+      ...FAKE_LOGIN,
+      desired: (ctx) => {
+        seen.push(ctx.keys);
+        return FAKE_LOGIN.desired(ctx);
+      },
+      verify: (api, desired, observed) => {
+        seen.push(observed);
+        return FAKE_LOGIN.verify?.(api, desired, observed) ?? Promise.resolve(false);
+      },
+    };
+    const stack = stackOf(
+      WIRED_CATALOG.map((def) =>
+        def.id === 'sonarr'
+          ? { ...def, integration: { after: [], resources: [linked] } }
+          : def,
+      ),
+    );
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const keys = { sonarr: { apiKey: KEY }, qbittorrent: { apiKey: 'fake-qbt-key' } };
+    await planWiring(options(sonarr, { stack, keys, known: RECORDED }));
+    expect(seen).toContainEqual(keys);
+    expect(seen).toContainEqual({ id: null, name: 'login', fields: { user: 'admin' } });
+  });
+
+  it('says a managed field that holds a secret is one apply would refuse, and asks nothing of it', async () => {
+    // The user name "admin" holds a value of the stack's secrets.
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, { secrets: [KEY, PASSWORD, 'dmi'] }),
+    );
+    const reason =
+      "sonarr.login.user holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value";
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'unknown', reason },
+    ]);
+    expect(planned.diagnostics).toEqual([
+      expect.objectContaining({
+        severity: 'warning',
+        code: 'wire.secret-field',
+        message: reason,
+        hint: `see ${WIRING_RUNBOOK}`,
+      }),
+    ]);
+    // Only the app's own check: the resource was neither looked at nor signed in to.
+    expect(sonarr.app.requests.map((r) => r.path)).toEqual([
+      '/ping',
+      '/api/v3/system/status',
+    ]);
+  });
+
   it('checks after the start an app whose container apply changes, or that is not ready', async () => {
```

**Change** `packages/engine/src/integrations/wire.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index 3ecdc37..1982192 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -100,3 +100,4 @@ describe('wire', () => {
     const updated = await wireWith(wrong, { known: RECORDED });
-    expect(await updated.run).toEqual(['sonarr.login updated user, password']);
+    // The user differs, so the update sets the password too, unchecked.
+    expect(await updated.run).toEqual(['sonarr.login updated user']);
     expect(wrong.state).toMatchObject({ user: 'admin', password: PASSWORD });
```

**Change** `catalog/_shared/servarr.test.ts`:

```diff
diff --git a/catalog/_shared/servarr.test.ts b/catalog/_shared/servarr.test.ts
index c822f43..de20ad9 100644
--- a/catalog/_shared/servarr.test.ts
+++ b/catalog/_shared/servarr.test.ts
@@ -1,2 +1,6 @@
-import { createAppApi, type DesiredResource } from '@mediaplane/engine';
+import {
+  createAppApi,
+  type DesiredResource,
+  type ObservedResource,
+} from '@mediaplane/engine';
 import { fakeHttpApp, type FakeRequest } from '@mediaplane/engine/testing';
@@ -34,2 +38,9 @@ const DESIRED: DesiredResource = {
 
+/** The admin the app holds, as observe finds it. */
+const OBSERVED: ObservedResource = {
+  id: null,
+  name: 'admin',
+  fields: { username: 'admin' },
+};
+
 /** A fake Sonarr whose host settings start as `host`, and whose login takes `password`. */
@@ -105,5 +116,5 @@ describe('servarrAdmin', () => {
     const { api, app } = await sonarr({ ...HOST, username: 'admin' });
-    expect(await admin.verify?.(api, DESIRED)).toBe(true);
+    expect(await admin.verify?.(api, DESIRED, OBSERVED)).toBe(true);
     expect(
-      await admin.verify?.(api, { ...DESIRED, secrets: { password: 'other' } }),
+      await admin.verify?.(api, { ...DESIRED, secrets: { password: 'other' } }, OBSERVED),
     ).toBe(false);
@@ -118,5 +129,5 @@ describe('servarrAdmin', () => {
     const { api } = await sonarr({ ...HOST, username: 'admin' });
-    expect(await admin.verify?.(api, { ...DESIRED, secrets: { password: 'Fail' } })).toBe(
-      false,
-    );
+    expect(
+      await admin.verify?.(api, { ...DESIRED, secrets: { password: 'Fail' } }, OBSERVED),
+    ).toBe(false);
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/integrations catalog/_shared`
Expected: FAIL, 5 tests: in `wiring.test.ts`, "would update a field that differs…"
(`['user', 'password']` for `['user']`), "checks no secret while a field differs…",
"gives a resource the stack's keys…" and "says a managed field that holds a secret…";
in `wire.test.ts`, "updates what differs, saying what…" (`updated user, password`).

- [ ] **Step 3: Write the implementation**

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index 39efd08..2916f69 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -34,2 +34,7 @@ export interface WiringContext {
   admin: { username: string; password: string };
+  /**
+   * The apps' keys from the secrets store, by app, then by name: what a resource holds of
+   * another app's, such as qBittorrent's key in Sonarr's download client.
+   */
+  keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
 }
@@ -61,9 +66,18 @@ export interface ResourceSpec {
   /**
-   * Whether the app takes the desired secrets: a sign-in, or the app's own test (spec
-   * §6.3, "secrets are verified, never compared"). Required when `secrets` isn't empty.
+   * Whether the app takes the desired secrets: a sign-in, or the app's own test of what it
+   * holds (`observed`) (spec §6.3, "secrets are verified, never compared"). Required when
+   * `secrets` isn't empty. Asked only while every managed field matches: update sets the
+   * secrets with the fields. Throws AppApiError when the app can't say.
    */
-  verify?(api: AppApi, desired: DesiredResource): Promise<boolean>;
+  verify?(
+    api: AppApi,
+    desired: DesiredResource,
+    observed: ObservedResource,
+  ): Promise<boolean>;
   /** Make it. The id the app gave it, or null for a singleton. */
   create(api: AppApi, desired: DesiredResource): Promise<{ id: string | number | null }>;
-  /** Make what the app holds match: the managed fields and the secrets. Idempotent. */
+  /**
+   * Make what the app holds match: the managed fields and the secrets, always both, since
+   * the secrets go unchecked when a field differs. Idempotent.
+   */
   update(
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index aa7e166..77a19af 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -257,4 +257,7 @@ export async function examine(
   );
-  if (spec.secrets.length > 0 && spec.verify !== undefined) {
-    if (!(await spec.verify(api, desired))) changes.push(...spec.secrets);
+  // A field that differs makes it an update, which sets the secrets too: checking them
+  // would change nothing, and could mislead. A sign-in with a user name the app doesn't
+  // have yet fails as if the password were wrong.
+  if (changes.length === 0 && spec.secrets.length > 0 && spec.verify !== undefined) {
+    if (!(await spec.verify(api, desired, observed))) changes.push(...spec.secrets);
   }
@@ -267,2 +270,25 @@ export async function examine(
 
+/**
+ * The first of the resource's managed fields whose value holds one of `secrets`, by name.
+ * resources.json keeps the managed fields and holds no secret, so such a resource is
+ * refused before anything is sent for it.
+ */
+export function fieldHoldingSecret(
+  spec: ResourceSpec,
+  desired: DesiredResource,
+  secrets: readonly string[],
+): string | undefined {
+  return spec.fields.find((field) => {
+    const value = desired.fields[field];
+    return (
+      value !== undefined && secrets.some((secret) => String(value).includes(secret))
+    );
+  });
+}
+
+/** Why a resource whose managed `field` holds a secret is refused. */
+export function secretFieldReason(address: string, field: string): string {
+  return `${address}.${field} holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value`;
+}
+
 /** The warning for an app Mediaplane couldn't ask, with what to do. */
@@ -345,3 +371,8 @@ export async function planWiring(
   for (const app of order) {
-    const ctx: WiringContext = { stack: options.stack, app, admin: options.admin };
+    const ctx: WiringContext = {
+      stack: options.stack,
+      app,
+      admin: options.admin,
+      keys: options.keys,
+    };
     // Only what the stack wants is listed: a resource it doesn't want isn't wiring.
@@ -383,2 +414,17 @@ export async function planWiring(
         const address = resourceAddress(app, spec);
+        // What the wire step would refuse, before anything is sent: plan says so first.
+        const desired = spec.desired(ctx);
+        const held =
+          desired === undefined
+            ? undefined
+            : fieldHoldingSecret(spec, desired, options.secrets);
+        if (held !== undefined) {
+          const reason = secretFieldReason(address, held);
+          diagnostics.push(
+            warning('wire.secret-field', reason, { hint: `see ${WIRING_RUNBOOK}` }),
+          );
+          changes.push({ resource: address, action: 'unknown', reason });
+          looked++;
+          continue;
+        }
         const result = await examine(spec, client.api, ctx, options.known[address]);
```

**Change** `packages/engine/src/integrations/wire.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 80a47dd..f5a69d8 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -14,2 +14,3 @@ import {
   examine,
+  fieldHoldingSecret,
   joinFailure,
@@ -20,2 +21,3 @@ import {
   resourcesInvalid,
+  secretFieldReason,
   wantedResources,
@@ -134,3 +136,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
   for (const app of order) {
-    const ctx: WiringContext = { stack, app, admin };
+    const ctx: WiringContext = { stack, app, admin, keys: options.store.apps };
     const targets = wiringTargets(ctx);
@@ -171,7 +173,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
       if (secretField !== undefined) {
-        fail(
-          address,
-          `${address}.${secretField} holds one of the stack's secrets, so Mediaplane won't keep it in state/resources.json; give it another value`,
-          'wire.secret-field',
-        );
+        fail(address, secretFieldReason(address, secretField), 'wire.secret-field');
         continue;
@@ -246,16 +244,2 @@ function failureMessage(failed: readonly string[], skipped: readonly string[]):
 
-/** The first of the managed fields whose value holds one of `secrets`, by name. */
-function fieldHoldingSecret(
-  spec: ResourceSpec,
-  desired: DesiredResource,
-  secrets: readonly string[],
-): string | undefined {
-  return spec.fields.find((field) => {
-    const value = desired.fields[field];
-    return (
-      value !== undefined && secrets.some((secret) => String(value).includes(secret))
-    );
-  });
-}
-
 /** The managed fields only: what resources.json keeps. */
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/engine/src/integrations catalog/_shared`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/integrations catalog/_shared/servarr.test.ts
git commit -m "feat(engine): give a resource the stack's keys and what the app holds, and check no secret while a field differs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The wire step makes the folders a resource needs

Sonarr and Radarr add a root folder only if the folder exists (decision 5). The
Mediaplane container sees only its home, and the host helper is read-only, so the wire
step makes the folders in a throwaway container of the app's own service, which mounts
the data folder as the app does.

Decision: `DesiredResource.folders` names container paths; before `create` only, the
wire step runs `runtime.run(app.def.id, { user: stack.config.user, entrypoint: 'mkdir',
args: ['-p', '--', ...folders], values })`. A non-zero exit fails the resource with
`wire.folders` and mkdir's last line, and sends nothing to the app. `plan` names no
folder: `create` covers it.

**Files:**
- Modify: `packages/engine/src/integrations/types.ts`,
  `packages/engine/src/integrations/wire.ts`
- Test: `packages/engine/src/integrations/wire.test.ts`

**Interfaces:**
- **Consumes:** `Runtime.run(service, OneOffCommand)` (S3d), `WireOptions.values`.
- **Produces:** `DesiredResource.folders?: readonly string[]`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/integrations/wire.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index 1982192..62f4970 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -8,3 +8,3 @@ import { RESOURCES_PATH, STATE_DIR } from '../paths';
 import { JoinFailed, OwnContainerUnknown, WiringRefused } from '../runtime/docker';
-import { RuntimeError } from '../runtime/types';
+import { RuntimeError, type OneOffCommand } from '../runtime/types';
 import { fakeRuntime, type FakeRuntimeOptions } from '../testing/fakes';
@@ -381,2 +381,91 @@ describe('wire', () => {
 
+  /** Sonarr with one resource that the app holds none of, and that needs `folders`. */
+  function needingFolders(folders: readonly string[]) {
+    const login: ResourceSpec = {
+      ...FAKE_LOGIN,
+      desired: (ctx) => {
+        const desired = FAKE_LOGIN.desired(ctx);
+        return desired && { ...desired, folders };
+      },
+    };
+    return stackOf(
+      WIRED_CATALOG.map((def) =>
+        def.id === 'sonarr'
+          ? { ...def, integration: { after: [], resources: [login] } }
+          : def,
+      ),
+    );
+  }
+
+  it("makes the folders a resource needs before it creates it, as the stack's user, in the app's own container", async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const calls: string[] = [];
+    const commands: OneOffCommand[] = [];
+    const { run } = await wireWith(sonarr, {
+      stack: needingFolders(['/data/media/tv']),
+      values: { MP_FAKE: 'fake-env-secret' },
+      runtime: fakeRuntime({
+        containers: RUNNING,
+        addresses: sonarr.addresses,
+        calls,
+        run: (_service, command) => {
+          commands.push(command);
+          return { code: 0, stdout: '', stderr: '' };
+        },
+      }),
+    });
+    expect(await run).toEqual(['sonarr.login created']);
+    // The fixture stack runs as the default user, 1000:1000.
+    expect(calls).toContain('run sonarr mkdir as 1000:1000');
+    expect(commands).toEqual([
+      {
+        user: { uid: 1000, gid: 1000 },
+        entrypoint: 'mkdir',
+        args: ['-p', '--', '/data/media/tv'],
+        values: { MP_FAKE: 'fake-env-secret' },
+      },
+    ]);
+    // Made first, then created.
+    expect(sonarr.state.user).toBe('admin');
+  });
+
+  it("fails a resource whose folders can't be made, saying why, and sends nothing for it", async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const { run, actions, home } = await wireWith(sonarr, {
+      stack: needingFolders(['/data/media/tv']),
+      runtime: fakeRuntime({
+        containers: RUNNING,
+        addresses: sonarr.addresses,
+        run: () => ({
+          code: 1,
+          stdout: '',
+          stderr:
+            " Container mediaplane-sonarr-run-0 Creating\nmkdir: can't create directory '/data/media/tv': Permission denied\n",
+        }),
+      }),
+    });
+    const failure = await run.catch((thrown: unknown) => thrown);
+    const said =
+      "could not make /data/media/tv for sonarr.login: mkdir in a throwaway sonarr container exited 1: mkdir: can't create directory '/data/media/tv': Permission denied";
+    expect((failure as WiringFailed).diagnostics).toEqual([
+      expect.objectContaining({ code: 'wire.folders', message: said }),
+    ]);
+    expect(actions).toEqual([
+      { step: 'wire', resource: 'sonarr.login', result: 'failed', error: said },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.method === 'PUT')).toBe(false);
+    await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
+  });
+
+  it('makes no folder for a resource the app already holds', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const calls: string[] = [];
+    const { run } = await wireWith(sonarr, {
+      stack: needingFolders(['/data/media/tv']),
+      runtime: fakeRuntime({ containers: RUNNING, addresses: sonarr.addresses, calls }),
+    });
+    expect(await run).toEqual(['sonarr.login adopted']);
+    expect(calls.some((call) => call.startsWith('run '))).toBe(false);
+  });
+
   it('keeps only the managed fields in resources.json', async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/integrations/wire.test.ts`
Expected: FAIL, 2 tests: "makes the folders a resource needs…" (no `run sonarr mkdir`)
and "fails a resource whose folders can't be made…". "makes no folder for a resource the
app already holds" passes already: it guards the next step.

- [ ] **Step 3: Write the implementation**

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index 2916f69..86b4759 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -18,2 +18,8 @@ export interface DesiredResource {
   secrets: Readonly<Record<string, string>>;
+  /**
+   * Folders, as the app's container sees them, that must exist before the app can make
+   * it, such as a root folder's (spec §6.2). The wire step makes them first, as the
+   * stack's user, in a throwaway container of the app's own service.
+   */
+  folders?: readonly string[];
 }
```

**Change** `packages/engine/src/integrations/wire.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index f5a69d8..e7c2b15 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -4,3 +4,3 @@ import type { ActionResult } from '../history/records';
 import { PROJECT_NAME, WIRING_NETWORK } from '../render/compose';
-import type { ResolvedStack } from '../resolver/resolve';
+import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
 import { RuntimeError, type Runtime } from '../runtime/types';
@@ -192,2 +192,7 @@ export async function wire(options: WireOptions): Promise<string[]> {
         if (result.action === 'create') {
+          const unmade = await makeFolders(options, app, address, result.desired);
+          if (unmade !== undefined) {
+            fail(address, unmade, 'wire.folders');
+            continue;
+          }
           ({ id } = await spec.create(client.api, result.desired));
@@ -235,2 +240,27 @@ export async function wire(options: WireOptions): Promise<string[]> {
 
+/**
+ * Make the folders `desired` needs, in a throwaway container of `app`'s own service (its
+ * image and its mounts), as the stack's user: the folders are then the data folder's, as
+ * the apps see it, and theirs. Undefined when there are none, or they are made; otherwise
+ * why not, from mkdir's own last line.
+ */
+async function makeFolders(
+  options: WireOptions,
+  app: ResolvedApp,
+  address: string,
+  desired: DesiredResource,
+): Promise<string | undefined> {
+  const folders = desired.folders ?? [];
+  if (folders.length === 0) return undefined;
+  const made = await options.runtime.run(app.def.id, {
+    user: options.stack.config.user,
+    entrypoint: 'mkdir',
+    args: ['-p', '--', ...folders],
+    values: { ...options.values },
+  });
+  if (made.code === 0) return undefined;
+  const said = made.stderr.trim().split('\n').at(-1)?.trim() ?? '';
+  return `could not make ${folders.join(', ')} for ${address}: mkdir in a throwaway ${app.def.name} container exited ${String(made.code)}${said === '' ? '' : `: ${said}`}`;
+}
+
 /** "the wiring failed for a; skipped b, which needs what failed". */
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/engine/src/integrations/wire.test.ts`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/integrations
git commit -m "feat(engine): make the folders a resource needs before the wire step creates it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The HTTP client: forms, an app's own test, and a sign-in's own answers

qBittorrent's API takes forms; the arrs' download client is checked with their own test,
whose verdict is a 400 with a validation list; and qBittorrent answers a wrong password
with 401 (decision 10).

Decision: `form` is retried only when nothing reached the app, like `post`. `test` takes
a 2xx or a 400 as the answer, and reads the 400 with `testFailures`, which shares
`appMessage`'s pipeline (`oneLine`: redact, one plain line, redact again, then cut).
`login`'s `answers` are added to the 2xx and 3xx it takes already. A 401 or 403 to a call
without the key says "refused the request".

**Files:**
- Modify: `packages/engine/src/http/client.ts`
- Test: `packages/engine/src/http/client.test.ts`

**Interfaces:**
- **Consumes:** `createAppApi`, `appMessage` (S3b).
- **Produces:**
  - `AppApi.form(path: string, fields: Readonly<Record<string, string>>, options?: { secrets?: readonly string[] }): Promise<void>`;
  - `AppApi.test(path: string, body: unknown): Promise<{ passed: boolean; failures: TestFailure[] }>`,
    with `TestFailure = { property: string; message: string }`;
  - `AppApi.login(path, fields, options?: { answers?: readonly number[] })`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/http/client.test.ts`:

```diff
diff --git a/packages/engine/src/http/client.test.ts b/packages/engine/src/http/client.test.ts
index 5b942a6..68a081c 100644
--- a/packages/engine/src/http/client.test.ts
+++ b/packages/engine/src/http/client.test.ts
@@ -740,2 +740,146 @@ describe('createAppApi', () => {
 
+  it('takes a status the caller names as the answer to a sign-in', async () => {
+    // qBittorrent answers a wrong password with 401, and a right one with 204.
+    const { api } = await sonarr(() => ({ status: 401, body: 'Unauthorized' }));
+    expect(
+      await api.login(
+        '/api/v2/auth/login',
+        { username: 'admin', password: PASSWORD },
+        { answers: [401] },
+      ),
+    ).toEqual({ status: 401, location: undefined });
+    expect(
+      await failure(api.login('/api/v2/auth/login', { password: PASSWORD })),
+    ).toMatchObject({ kind: 'auth', status: 401 });
+  });
+
+  it('says a request without the key was refused, not the key', async () => {
+    const { api } = await sonarr(() => ({
+      status: 403,
+      body: 'Your IP address has been banned after too many failed authentication attempts.',
+    }));
+    const error = await failure(
+      api.login('/api/v2/auth/login', { username: 'admin', password: PASSWORD }),
+    );
+    expect(error).toMatchObject({ kind: 'auth', status: 403 });
+    expect(error.message).toBe(
+      'Sonarr at http://sonarr:8989 (127.0.0.1) refused the request (HTTP 403): Your IP address has been banned after too many failed authentication attempts. (POST /api/v2/auth/login)',
+    );
+  });
+
+  it('POSTs a form with the key, and takes any 2xx as done', async () => {
+    const { api, app } = await sonarr(() => ({ status: 200 }), {
+      key: { scheme: 'bearer', value: KEY },
+    });
+    await api.form('/api/v2/torrents/createCategory', {
+      category: 'tv',
+      savePath: '/data/torrents/tv',
+    });
+    expect(app.requests[0]).toMatchObject({
+      method: 'POST',
+      path: '/api/v2/torrents/createCategory',
+      body: 'category=tv&savePath=%2Fdata%2Ftorrents%2Ftv',
+      headers: {
+        authorization: `Bearer ${KEY}`,
+        'content-type': 'application/x-www-form-urlencoded',
+      },
+    });
+    const refused = await sonarr(() => ({
+      status: 409,
+      body: 'Unable to create category',
+    }));
+    expect(
+      (await failure(refused.api.form('/api/v2/torrents/createCategory', {}))).message,
+    ).toContain(
+      'refused the request (HTTP 409): Unable to create category (POST /api/v2/torrents/createCategory)',
+    );
+  });
+
+  it('keeps a secret that a form sends out of what the app says, listed or not', async () => {
+    const { api } = await sonarr(
+      (request) => ({ status: 400, body: `Bad: ${decodeURIComponent(request.body)}` }),
+      { secrets: [] },
+    );
+    const error = await failure(
+      api.form(
+        '/api/v2/app/setPreferences',
+        { json: JSON.stringify({ web_ui_password: PASSWORD }) },
+        { secrets: [PASSWORD] },
+      ),
+    );
+    expect(error.message).toContain('Bad: json={"web_ui_password":"***"}');
+    expect(error.message).not.toContain(PASSWORD);
+  });
+
+  it("runs an app's own test: a 2xx passes, and a 400 says what failed, never a warning or a value", async () => {
+    const passing = await sonarr(() => ({ status: 200, body: {} }));
+    expect(
+      await passing.api.test('/api/v3/downloadclient/test', { name: 'qBittorrent' }),
+    ).toEqual({ passed: true, failures: [] });
+    expect(passing.app.requests[0]).toMatchObject({
+      method: 'POST',
+      body: '{"name":"qBittorrent"}',
+      headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
+    });
+    const failing = await sonarr(() => ({
+      status: 400,
+      body: [
+        {
+          propertyName: 'ApiKey',
+          errorMessage: 'Authentication Failure',
+          detailedDescription: 'Please verify your credentials.',
+          attemptedValue: `qbt_${'x'.repeat(28)}`,
+          isWarning: false,
+        },
+        {
+          propertyName: 'Host',
+          errorMessage: 'Unable to connect to qBittorrent',
+          detailedDescription: `Connection refused (gluetun:8080) ${KEY}`,
+        },
+        { propertyName: 'Category', errorMessage: 'Only a warning', isWarning: true },
+      ],
+    }));
+    const result = await failing.api.test('/api/v3/downloadclient/test', {});
+    expect(result).toEqual({
+      passed: false,
+      failures: [
+        {
+          property: 'ApiKey',
+          message: 'Authentication Failure (Please verify your credentials.)',
+        },
+        {
+          property: 'Host',
+          message:
+            'Unable to connect to qBittorrent (Connection refused (gluetun:8080) ***)',
+        },
+      ],
+    });
+    expect(JSON.stringify(result)).not.toContain('qbt_');
+    // Warnings alone pass, as the app's own UI says.
+    const warned = await sonarr(() => ({
+      status: 400,
+      body: [{ propertyName: '', errorMessage: 'Only a warning', isWarning: true }],
+    }));
+    expect(await warned.api.test('/api/v3/downloadclient/test', {})).toEqual({
+      passed: true,
+      failures: [],
+    });
+  });
+
+  it('refuses a test answer it cannot read as a verdict', async () => {
+    const { api } = await sonarr(() => ({
+      status: 400,
+      body: { title: 'One or more errors.', errors: { id: ['Bad id'] } },
+    }));
+    const error = await failure(api.test('/api/v3/downloadclient/test', {}));
+    expect(error).toMatchObject({ kind: 'rejected', status: 400 });
+    expect(error.message).toContain(
+      'refused the request (HTTP 400): One or more errors.; id: Bad id (POST /api/v3/downloadclient/test)',
+    );
+    const broken = await sonarr(() => ({ status: 500, body: 'Oops' }));
+    expect(
+      await failure(broken.api.test('/api/v3/downloadclient/test', {})),
+    ).toMatchObject({ kind: 'server', status: 500 });
+  });
+
   it('waits for the app to be ready, without the key', async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/http`
Expected: FAIL, 6 tests: the 401 sign-in answer, "says a request without the key was
refused…" (`refused Mediaplane's API key (HTTP 403)`), and the four on `form` and `test`
(`api.form is not a function`, `api.test is not a function`).

- [ ] **Step 3: Write the implementation**

**Change** `packages/engine/src/http/client.ts`:

```diff
diff --git a/packages/engine/src/http/client.ts b/packages/engine/src/http/client.ts
index 8eec330..bf5ca18 100644
--- a/packages/engine/src/http/client.ts
+++ b/packages/engine/src/http/client.ts
@@ -56,2 +56,10 @@ export class AppApiError extends Error {
 
+/** One thing an app's own test of a setting found wrong (Servarr's validation list). */
+export interface TestFailure {
+  /** The setting it is about, as the app names it ("ApiKey", "Host"), or "". */
+  property: string;
+  /** What the app said, and its details: redacted, on one line, at most 200 characters. */
+  message: string;
+}
+
 /** Where to connect: the container's address, and its port. */
@@ -105,5 +113,25 @@ export interface AppApi {
   post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
+  /**
+   * POST a form with the key, as qBittorrent's API takes one; any 2xx answer is success.
+   * `secrets` are values the form sends, kept out of every message, listed or not.
+   */
+  form(
+    path: string,
+    fields: Readonly<Record<string, string>>,
+    options?: { secrets?: readonly string[] },
+  ): Promise<void>;
+  /**
+   * POST a JSON body with the key to an app's own test of a setting (Servarr's
+   * `…/test`). A 2xx answer passes; a 400 is the app's verdict: the errors of its
+   * validation list, never a warning, nor the value it was given. Any other answer, or a
+   * 400 that isn't such a list, throws as `post` would.
+   */
+  test(
+    path: string,
+    body: unknown,
+  ): Promise<{ passed: boolean; failures: TestFailure[] }>;
   /**
    * POST a form, without the key and never following a redirect: an app's own sign-in
-   * page. Its status and Location; its cookies are dropped.
+   * page. Its status and Location; its cookies are dropped. A 2xx or 3xx answer is the
+   * answer, and so is any status in `answers` (qBittorrent's 401 for a wrong password).
    */
@@ -112,2 +140,3 @@ export interface AppApi {
     fields: Readonly<Record<string, string>>,
+    options?: { answers?: readonly number[] },
   ): Promise<{ status: number; location: string | undefined }>;
@@ -313,10 +342,8 @@ export function createAppApi(options: AppApiOptions): AppApi {
     if (status === 401 || status === 403) {
-      return failure(
-        call,
-        `refused Mediaplane's API key (HTTP ${String(status)})${message}`,
-        {
-          kind: 'auth',
-          status,
-        },
-      );
+      // Without the key, the key isn't what was refused: a sign-in, say.
+      const refused = call.anonymous ? 'the request' : "Mediaplane's API key";
+      return failure(call, `refused ${refused} (HTTP ${String(status)})${message}`, {
+        kind: 'auth',
+        status,
+      });
     }
@@ -441,3 +468,30 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
-    async login(path, fields) {
+    async form(path, fields, extra = {}) {
+      await send(
+        {
+          method: 'POST',
+          path,
+          ...(extra.secrets === undefined ? {} : { secrets: extra.secrets }),
+          body: {
+            type: 'application/x-www-form-urlencoded',
+            text: new URLSearchParams(fields).toString(),
+          },
+        },
+        false,
+      );
+    },
+    async test(path, body) {
+      const call: Call = { method: 'POST', path, body: json(body) };
+      const answer = await send(
+        call,
+        false,
+        (a) => (a.status >= 200 && a.status < 300) || a.status === 400,
+      );
+      if (answer.status !== 400) return { passed: true, failures: [] };
+      const failures = testFailures(answer.body, cleanFor(call));
+      if (failures === undefined) throw statusFailure(call, answer);
+      return { passed: failures.length === 0, failures };
+    },
+    async login(path, fields, extra = {}) {
+      const answers = extra.answers ?? [];
       const call: Call = {
@@ -454,3 +508,7 @@ export function createAppApi(options: AppApiOptions): AppApi {
       // A redirect is the answer: where it leads says whether the login worked.
-      const answer = await send(call, true, (a) => a.status >= 200 && a.status < 400);
+      const answer = await send(
+        call,
+        true,
+        (a) => (a.status >= 200 && a.status < 400) || answers.includes(a.status),
+      );
       return {
@@ -561,4 +619,12 @@ export function appMessage(
   if (said === undefined) return undefined;
+  const message = oneLine(said, clean);
+  return message === '' ? undefined : message;
+}
+
+/**
+ * What an app said, safe to show: redacted, on one plain line (redacted again, since
+ * collapsing it can put a secret together), and only then cut to MESSAGE_LIMIT.
+ */
+function oneLine(said: string, clean: (text: string) => string): string {
   const message = clean(plain(clean(said)));
-  if (message === '') return undefined;
   return message.length > MESSAGE_LIMIT
@@ -568,2 +634,34 @@ export function appMessage(
 
+/**
+ * The errors of Servarr's validation list, from a test's answer: each one's property, and
+ * its message with its details, made safe as appMessage makes a message. A warning is
+ * not an error, and an `attemptedValue` is never read. Undefined for an answer that
+ * isn't such a list.
+ */
+function testFailures(
+  body: string,
+  clean: (text: string) => string,
+): TestFailure[] | undefined {
+  const json = parseJson(body);
+  if (json === undefined || !Array.isArray(json.value)) return undefined;
+  return json.value.flatMap((item: unknown) => {
+    if (typeof item !== 'object' || item === null) return [];
+    const { propertyName, errorMessage, detailedDescription, isWarning } = item as Record<
+      string,
+      unknown
+    >;
+    if (isWarning === true || typeof errorMessage !== 'string') return [];
+    const details =
+      typeof detailedDescription === 'string' && detailedDescription !== ''
+        ? ` (${detailedDescription})`
+        : '';
+    return [
+      {
+        property: typeof propertyName === 'string' ? oneLine(propertyName, clean) : '',
+        message: oneLine(`${errorMessage}${details}`, clean),
+      },
+    ];
+  });
+}
+
 function parseJson(text: string): { value: unknown } | undefined {
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/engine/src/http`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/http
git commit -m "feat(engine): forms, an app's own test, and a sign-in's own answers in the HTTP client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: qBittorrent's integration: its login, its settings and its categories

qBittorrent's settings reach it only through its pre-start file today. After its first
start, the API is the only way in (spec §6.4): this task manages the shared login, its
settings and a category per arr there (decisions 1, 2, 11).

Decision: the four resources of decision 1, in that order, `after: []`. The preferences
are read with `z.object`, which drops every field Mediaplane doesn't manage, its API key
among them.
Decision: `admin.verify` signs in with `login(…, { answers: [401] })`: a 2xx is true, a
401 false, and a 403 (the ban) throws (decision 2).
Decision: `fakeStackApis` grows a qBittorrent that keeps its login, preferences and
categories (`freshAppState()`: the settings its pre-start file leaves, and no user until
a test or `apply` sets one), answers its sign-in with 204 or 401, and is the same app
whether reached as `qbittorrent` or through `gluetun`.
`run.test.ts`'s current home holds what the stack wants in qBittorrent too, and
`resources.json` records it.
Decision: the catalog-facts test's app with nothing managed becomes Jellyfin, since
qBittorrent now has an integration.

**Files:**
- Create: `catalog/qbittorrent/integration.ts`, `catalog/qbittorrent/integration.test.ts`
- Modify: `catalog/qbittorrent/app.ts`, `packages/engine/src/testing/wiring.ts`,
  `catalog/catalog.test.ts`, `scripts/docs/catalog-facts.test.ts`,
  `packages/cli/src/run.test.ts`
- Generated: `catalog/qbittorrent/README.md` (its facts block)

**Interfaces:**
- **Consumes:** `AppApi.form`, `AppApi.login`'s `answers` (Task 3);
  `WiringContext` (Task 1); `defineIntegration`.
- **Produces:**
  - `catalog/qbittorrent/integration.ts`: the default `Integration`, and
    `DEFAULT_SAVE_PATH = '/data/torrents'`,
    `CATEGORIES = [{ arr: 'sonarr', name: 'tv' }, { arr: 'radarr', name: 'movies' }]`;
  - resource addresses `qbittorrent.admin`, `qbittorrent.preferences`,
    `qbittorrent.category_tv` (which Task 5's Sonarr client requires) and
    `qbittorrent.category_movies` (Radarr's);
  - `FakeAppState` gains `preferences`, `categories` (and, in Task 5, more), and
    `freshAppState(): FakeAppState` in `@mediaplane/engine/testing`.

- [ ] **Step 1: Write the failing tests, and the fake qBittorrent they use**

**Create** `catalog/qbittorrent/integration.test.ts`:

```ts
import {
  AppApiError,
  createAppApi,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import { fakeHttpApp, wiringStack, type FakeRequest } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import integration from './integration';

const KEY = `qbt_${'0'.repeat(28)}`;
const PASSWORD = 'fake-admin-password';

/** A stack with Sonarr and qBittorrent behind the VPN, on the LAN, as `extra` says. */
function stack(extra = '', apps = '  sonarr: {}\n') {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: lan }
${extra}media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
${apps}  qbittorrent: {}
`,
  );
}

function contextOf(resolved = stack()): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'qbittorrent');
  if (app === undefined) throw new Error('no qBittorrent in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: PASSWORD },
    keys: { qbittorrent: { apiKey: KEY } },
  };
}

function resource(name: string): ResourceSpec {
  const found = integration.resources.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no ${name} resource`);
  return found;
}

/** What the fake qBittorrent holds, as its API names it. */
interface Held {
  user: string;
  password: string;
  preferences: Record<string, unknown>;
  categories: Record<string, { name: string; savePath: string }>;
}

/**
 * A fake qBittorrent 5.2 behind Gluetun: its preferences, categories and sign-in, with a
 * Bearer key. Its preferences answer the whitelist one subnet per line, and paths without
 * a trailing "/", as qBittorrent does.
 */
async function qbittorrent(held: Partial<Held> = {}) {
  const state: Held = {
    user: 'admin',
    password: PASSWORD,
    preferences: {
      save_path: '/data/torrents',
      auto_tmm_enabled: true,
      bypass_auth_subnet_whitelist_enabled: false,
      bypass_auth_subnet_whitelist: '',
      web_ui_api_key: KEY,
    },
    categories: {},
    ...held,
  };
  const app = await fakeHttpApp((request: FakeRequest) => {
    const form = new URLSearchParams(request.body);
    if (request.path === '/api/v2/auth/login') {
      if (request.headers.authorization !== undefined) return { status: 400 };
      return form.get('username') === state.user &&
        form.get('password') === state.password
        ? { status: 204, headers: { 'Set-Cookie': 'SID=fake-session' } }
        : { status: 401, body: 'Unauthorized' };
    }
    if (request.headers.authorization !== `Bearer ${KEY}`) return { status: 403 };
    if (request.path === '/api/v2/app/preferences') {
      return { status: 200, body: { ...state.preferences, web_ui_username: state.user } };
    }
    if (request.path === '/api/v2/app/setPreferences') {
      const sent = JSON.parse(form.get('json') ?? '{}') as Record<string, unknown>;
      const { web_ui_username: user, web_ui_password: password, ...rest } = sent;
      if (typeof user === 'string') state.user = user;
      if (typeof password === 'string') state.password = password;
      const list = rest.bypass_auth_subnet_whitelist;
      state.preferences = {
        ...state.preferences,
        ...rest,
        ...(typeof list === 'string'
          ? { bypass_auth_subnet_whitelist: list.split(',').join('\n') }
          : {}),
      };
      return { status: 200 };
    }
    if (request.path === '/api/v2/torrents/categories') {
      return { status: 200, body: state.categories };
    }
    const name = form.get('category') ?? '';
    const savePath = (form.get('savePath') ?? '').replace(/\/+$/, '');
    if (request.path === '/api/v2/torrents/createCategory') {
      if (name in state.categories)
        return { status: 409, body: 'Unable to create category' };
      state.categories[name] = { name, savePath };
      return { status: 200 };
    }
    if (request.path === '/api/v2/torrents/editCategory') {
      if (!(name in state.categories))
        return { status: 404, body: 'Category does not exist' };
      state.categories[name] = { name, savePath };
      return { status: 200 };
    }
    return { status: 404 };
  });
  const api = createAppApi({
    name: 'qBittorrent',
    service: 'gluetun',
    port: 8080,
    endpoint: { host: '127.0.0.1', port: app.port },
    key: { scheme: 'bearer', value: KEY },
    secrets: [KEY, PASSWORD],
    retry: { deadlineMs: 0 },
  });
  return { api, app, state };
}

describe("qBittorrent's integration", () => {
  it('manages the login, the settings, and a category for each arr, in that order', () => {
    expect(integration.after).toEqual([]);
    expect(integration.resources.map((r) => [r.name, r.fields, r.secrets])).toEqual([
      ['admin', ['username'], ['password']],
      [
        'preferences',
        ['savePath', 'autoTmm', 'authSubnetWhitelistEnabled', 'authSubnetWhitelist'],
        [],
      ],
      ['category_tv', ['savePath'], []],
      ['category_movies', ['savePath'], []],
    ]);
  });

  describe('admin', () => {
    const admin = resource('admin');
    const desired = admin.desired(contextOf());
    if (desired === undefined) throw new Error('the admin is always wanted');

    it('reads the user name from the preferences, and checks the password by signing in', async () => {
      const { api, app } = await qbittorrent();
      const observed = await admin.observe(api, undefined);
      expect(observed).toEqual({
        id: null,
        name: 'admin',
        fields: { username: 'admin' },
      });
      if (observed === undefined) throw new Error('no admin observed');
      expect(await admin.verify?.(api, desired, observed)).toBe(true);
      const login = app.requests.find((r) => r.path === '/api/v2/auth/login');
      // A sign-in carries no key.
      expect(login?.headers.authorization).toBeUndefined();
      expect(
        await admin.verify?.(
          api,
          { ...desired, secrets: { password: 'other-password' } },
          observed,
        ),
      ).toBe(false);
    });

    it('sets the user name and the password through the preferences, with the key', async () => {
      const { api, app, state } = await qbittorrent({
        user: 'someone',
        password: 'old-password',
      });
      const observed = await admin.observe(api, undefined);
      if (observed === undefined) throw new Error('no admin observed');
      await admin.update(api, desired, observed);
      expect(state).toMatchObject({ user: 'admin', password: PASSWORD });
      const set = app.requests.find((r) => r.path === '/api/v2/app/setPreferences');
      expect(set?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(JSON.parse(new URLSearchParams(set?.body).get('json') ?? '')).toEqual({
        web_ui_username: 'admin',
        web_ui_password: PASSWORD,
      });
    });

    it('says when qBittorrent has banned the address from signing in, never that the password is wrong', async () => {
      const { api } = await qbittorrent();
      const banned = await fakeHttpApp(() => ({
        status: 403,
        body: 'Your IP address has been banned after too many failed authentication attempts.',
      }));
      const bannedApi = createAppApi({
        name: 'qBittorrent',
        service: 'gluetun',
        port: 8080,
        endpoint: { host: '127.0.0.1', port: banned.port },
        key: { scheme: 'bearer', value: KEY },
        secrets: [KEY, PASSWORD],
        retry: { deadlineMs: 0 },
      });
      const observed = await admin.observe(api, undefined);
      if (observed === undefined) throw new Error('no admin observed');
      const failure = await admin
        .verify?.(bannedApi, desired, observed)
        .catch((thrown: unknown) => thrown);
      expect(failure).toBeInstanceOf(AppApiError);
      expect((failure as AppApiError).message).toContain(
        'refused the request (HTTP 403): Your IP address has been banned after too many failed authentication attempts.',
      );
    });
  });

  describe('preferences', () => {
    const settings = resource('preferences');

    it('wants the save path and Automatic Torrent Management, and no LAN without a login', () => {
      expect(settings.desired(contextOf())).toEqual({
        name: 'preferences',
        fields: {
          savePath: '/data/torrents',
          autoTmm: true,
          authSubnetWhitelistEnabled: false,
          authSubnetWhitelist: '',
        },
        secrets: {},
      });
    });

    it('lets the LAN skip the login only when the stack says so, on the LAN', () => {
      const lanless = 'security: { login_on_lan: false }\n';
      expect(settings.desired(contextOf(stack(lanless)))?.fields).toMatchObject({
        authSubnetWhitelistEnabled: true,
        authSubnetWhitelist: '192.168.1.0/24',
      });
      const local = wiringStack(
        catalog,
        `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
security: { login_on_lan: false }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`,
      );
      expect(settings.desired(contextOf(local))?.fields).toMatchObject({
        authSubnetWhitelistEnabled: false,
        authSubnetWhitelist: '',
      });
    });

    it("reads them as qBittorrent keeps them, and sets them with qBittorrent's own types", async () => {
      const { api, app, state } = await qbittorrent();
      state.preferences = {
        ...state.preferences,
        save_path: '/data/downloads/',
        auto_tmm_enabled: false,
        bypass_auth_subnet_whitelist_enabled: true,
        bypass_auth_subnet_whitelist: '10.10.0.0/16\n192.168.2.0/24',
      };
      const observed = await settings.observe(api, undefined);
      expect(observed?.fields).toEqual({
        savePath: '/data/downloads',
        autoTmm: false,
        authSubnetWhitelistEnabled: true,
        authSubnetWhitelist: '10.10.0.0/16,192.168.2.0/24',
      });
      if (observed === undefined) throw new Error('no preferences observed');
      const desired = settings.desired(
        contextOf(stack('security: { login_on_lan: false }\n')),
      );
      if (desired === undefined) throw new Error('the preferences are always wanted');
      await settings.update(api, desired, observed);
      const set = app.requests.find((r) => r.path === '/api/v2/app/setPreferences');
      expect(JSON.parse(new URLSearchParams(set?.body).get('json') ?? '')).toEqual({
        save_path: '/data/torrents',
        auto_tmm_enabled: true,
        bypass_auth_subnet_whitelist_enabled: true,
        bypass_auth_subnet_whitelist: '192.168.1.0/24',
      });
      expect((await settings.observe(api, undefined))?.fields).toEqual(desired.fields);
    });
  });

  describe('categories', () => {
    const tv = resource('category_tv');
    const movies = resource('category_movies');

    it("wants a category for each arr in the stack, under qBittorrent's save path", () => {
      expect(tv.desired(contextOf())).toEqual({
        name: 'tv',
        fields: { savePath: '/data/torrents/tv' },
        secrets: {},
      });
      expect(movies.desired(contextOf())).toBeUndefined();
      const both = stack('', '  sonarr: {}\n  radarr: {}\n');
      expect(movies.desired(contextOf(both))?.fields).toEqual({
        savePath: '/data/torrents/movies',
      });
    });

    it('finds a category by its name, makes it, and moves its save path', async () => {
      const { api, state } = await qbittorrent();
      expect(await tv.observe(api, undefined)).toBeUndefined();
      const desired = tv.desired(contextOf());
      if (desired === undefined) throw new Error('the tv category is wanted');
      expect(await tv.create(api, desired)).toEqual({ id: 'tv' });
      expect(state.categories).toEqual({
        tv: { name: 'tv', savePath: '/data/torrents/tv' },
      });
      state.categories.tv = { name: 'tv', savePath: '/data/elsewhere/' };
      const observed = await tv.observe(api, undefined);
      expect(observed).toEqual({
        id: 'tv',
        name: 'tv',
        fields: { savePath: '/data/elsewhere' },
      });
      if (observed === undefined) throw new Error('no category observed');
      await tv.update(api, desired, observed);
      expect(state.categories).toEqual({
        tv: { name: 'tv', savePath: '/data/torrents/tv' },
      });
    });

    it("says qBittorrent's own words when it refuses", async () => {
      const { api } = await qbittorrent({
        categories: { tv: { name: 'tv', savePath: '/data/torrents/tv' } },
      });
      const desired = tv.desired(contextOf());
      if (desired === undefined) throw new Error('the tv category is wanted');
      const failure = await tv.create(api, desired).catch((thrown: unknown) => thrown);
      expect((failure as AppApiError).message).toContain(
        'refused the request (HTTP 409): Unable to create category',
      );
    });
  });
});
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 2adced7..14a1273 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -57,3 +57,3 @@ describe('catalog', () => {
       catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
-    ).toEqual(['prowlarr', 'radarr', 'sonarr']);
+    ).toEqual(['prowlarr', 'qbittorrent', 'radarr', 'sonarr']);
   });
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 5e22ab2..7856d70 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -69,3 +69,3 @@ describe('renderFacts', () => {
     );
-    expect(renderFacts(app('qbittorrent'))).toContain(
+    expect(renderFacts(app('jellyfin'))).toContain(
       '- **Managed in the app:** nothing yet\n',
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index 560ac9f..c2ed925 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -7,3 +7,3 @@ import { fakeContainer } from './fakes';
 import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixtures';
-import { fakeHttpApp, type FakeApp } from './http';
+import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';
 
@@ -90,3 +90,3 @@ export const WIRED_CATALOG: Catalog = fixtureCatalog.map((def) =>
 export interface FakeAppState {
-  /** Its admin user name and password (Servarr); empty before there is one. */
+  /** Its admin user name and password; empty before there is one. */
   user: string;
@@ -95,2 +95,22 @@ export interface FakeAppState {
   up: boolean;
+  /** qBittorrent's preferences, as its API names them, but for the login above. */
+  preferences: Record<string, string | boolean>;
+  /** qBittorrent's categories: each one's save path, by name. */
+  categories: Record<string, string>;
+}
+
+/** A fake app as it first starts: qBittorrent's settings as its pre-start file sets them. */
+export function freshAppState(): FakeAppState {
+  return {
+    user: '',
+    password: '',
+    up: true,
+    preferences: {
+      save_path: '/data/torrents',
+      auto_tmm_enabled: true,
+      bypass_auth_subnet_whitelist_enabled: false,
+      bypass_auth_subnet_whitelist: '',
+    },
+    categories: {},
+  };
 }
@@ -101,3 +121,5 @@ export interface FakeAppState {
  * Radarr and Prowlarr have /ping, system/status, config/host and /login; qBittorrent has
- * / and app/version. Any key is taken. `seams` send every app's calls there.
+ * /, app/version, its sign-in, preferences and categories, and is `apps`' "qbittorrent"
+ * also when reached through Gluetun. Any key is taken. `seams` send every app's calls
+ * there.
  */
@@ -113,3 +135,3 @@ export async function fakeStackApis(): Promise<{
     if (known !== undefined) return known;
-    const fresh: FakeAppState = { user: '', password: '', up: true };
+    const fresh = freshAppState();
     apps.set(service, fresh);
@@ -119,3 +141,4 @@ export async function fakeStackApis(): Promise<{
     const { method, path, headers } = request;
-    const service = (headers.host ?? '').split(':')[0] ?? '';
+    const host = (headers.host ?? '').split(':')[0] ?? '';
+    const service = host === 'gluetun' ? 'qbittorrent' : host;
     const state = stateOf(service);
@@ -123,9 +146,3 @@ export async function fakeStackApis(): Promise<{
       headers['x-api-key'] !== undefined || headers.authorization !== undefined;
-    if (service === 'qbittorrent' || service === 'gluetun') {
-      if (path === '/') return { status: state.up ? 200 : 503, body: 'login page' };
-      if (path === '/api/v2/app/version') {
-        return keyed ? { status: 200, body: 'v5.2.4' } : { status: 403 };
-      }
-      return { status: 404 };
-    }
+    if (service === 'qbittorrent') return fakeQbittorrent(request, state, keyed);
     if (path === '/ping') return { status: state.up ? 200 : 503, body: { status: 'OK' } };
@@ -168,2 +185,57 @@ export async function fakeStackApis(): Promise<{
 
+/** qBittorrent's API, as fakeStackApis answers it, from `state`. */
+function fakeQbittorrent(
+  request: FakeRequest,
+  state: FakeAppState,
+  keyed: boolean,
+): FakeReply {
+  const { path } = request;
+  const form = new URLSearchParams(request.body);
+  if (path === '/') return { status: state.up ? 200 : 503, body: 'login page' };
+  if (path === '/api/v2/auth/login') {
+    const ok =
+      state.user !== '' &&
+      form.get('username') === state.user &&
+      form.get('password') === state.password;
+    return ok ? { status: 204 } : { status: 401, body: 'Unauthorized' };
+  }
+  if (!keyed) return { status: 403 };
+  if (path === '/api/v2/app/version') return { status: 200, body: 'v5.2.4' };
+  if (path === '/api/v2/app/preferences') {
+    return { status: 200, body: { ...state.preferences, web_ui_username: state.user } };
+  }
+  if (path === '/api/v2/app/setPreferences') {
+    const sent = JSON.parse(form.get('json') ?? '{}') as Record<string, string | boolean>;
+    const { web_ui_username: user, web_ui_password: password, ...rest } = sent;
+    if (typeof user === 'string') state.user = user;
+    if (typeof password === 'string') state.password = password;
+    Object.assign(state.preferences, rest);
+    return { status: 200 };
+  }
+  if (path === '/api/v2/torrents/categories') {
+    return {
+      status: 200,
+      body: Object.fromEntries(
+        Object.entries(state.categories).map(([name, savePath]) => [
+          name,
+          { name, savePath },
+        ]),
+      ),
+    };
+  }
+  const name = form.get('category') ?? '';
+  const known = Object.hasOwn(state.categories, name);
+  if (path === '/api/v2/torrents/createCategory') {
+    if (known) return { status: 409, body: 'Unable to create category' };
+    state.categories[name] = form.get('savePath') ?? '';
+    return { status: 200 };
+  }
+  if (path === '/api/v2/torrents/editCategory') {
+    if (!known) return { status: 404, body: 'Category does not exist' };
+    state.categories[name] = form.get('savePath') ?? '';
+    return { status: 200 };
+  }
+  return { status: 404 };
+}
+
 /** What the fake Sonarr holds; a test may change it between calls. */
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 7abd6bb..8c0ee15 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -21,2 +21,3 @@ import {
   type HostRequest,
+  type KnownResources,
   type Runtime,
@@ -29,2 +30,3 @@ import {
   fakeStackApis,
+  freshAppState,
   running,
@@ -58,2 +60,41 @@ async function makeHome(stack = STACK): Promise<string> {
 
+const AT = '2026-10-10T12:00:00.000Z';
+
+/** What resources.json records once the test stack is wired, as the fake apps hold it. */
+const WIRED: KnownResources = {
+  'qbittorrent.admin': {
+    id: null,
+    name: 'admin',
+    fields: { username: 'admin' },
+    secrets: ['password'],
+    appliedAt: AT,
+  },
+  'qbittorrent.category_tv': {
+    id: 'tv',
+    name: 'tv',
+    fields: { savePath: '/data/torrents/tv' },
+    secrets: [],
+    appliedAt: AT,
+  },
+  'qbittorrent.preferences': {
+    id: null,
+    name: 'preferences',
+    fields: {
+      savePath: '/data/torrents',
+      autoTmm: true,
+      authSubnetWhitelistEnabled: false,
+      authSubnetWhitelist: '',
+    },
+    secrets: [],
+    appliedAt: AT,
+  },
+  'sonarr.admin': {
+    id: null,
+    name: 'admin',
+    fields: { username: 'admin' },
+    secrets: ['password'],
+    appliedAt: AT,
+  },
+};
+
 /** All zeros: the keys currentHome stores are never printed, so their value is moot. */
@@ -89,14 +130,12 @@ async function currentHome(
   }
-  // Sonarr holds the shared login, as resources.json records.
+  // Sonarr and qBittorrent hold what the stack wants, as resources.json records.
   const password = store.shared?.adminPassword ?? '';
-  apis.apps.set('sonarr', { user: 'admin', password, up: true });
-  await writeResources(home, {
-    'sonarr.admin': {
-      id: null,
-      name: 'admin',
-      fields: { username: 'admin' },
-      secrets: ['password'],
-      appliedAt: '2026-10-10T12:00:00.000Z',
-    },
-  });
+  apis.apps.set('sonarr', { ...freshAppState(), user: 'admin', password });
+  apis.apps.set('qbittorrent', {
+    ...freshAppState(),
+    user: 'admin',
+    password,
+    categories: { tv: '/data/torrents/tv' },
+  });
+  await writeResources(home, WIRED);
   return home;
@@ -220,3 +259,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 2 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 4 wiring checks after the start.',
     );
@@ -478,3 +517,3 @@ describe('mediaplane apply', () => {
     expect(first.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 2 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 4 wiring checks after the start.',
     );
@@ -559,2 +598,5 @@ describe('mediaplane apply', () => {
       ['start', '', 'done'],
+      ['wire', 'qbittorrent.admin', 'done'],
+      ['wire', 'qbittorrent.preferences', 'done'],
+      ['wire', 'qbittorrent.category_tv', 'done'],
       ['wire', 'sonarr.admin', 'done'],
@@ -822,3 +864,3 @@ describe('mediaplane history', () => {
     expect(list.stdout()).toBe(
-      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 1 resource wired\n`,
+      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 4 resources wired\n`,
     );
@@ -831,2 +873,3 @@ describe('mediaplane history', () => {
     expect(one.stdout()).toContain('  done    wiring sonarr.admin: created\n');
+    expect(one.stdout()).toContain('  done    wiring qbittorrent.category_tv: created\n');
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog scripts packages/cli/src/run.test.ts`
Expected: FAIL: `catalog/qbittorrent/integration.test.ts` can't load `./integration`;
`catalog.test.ts`'s "gives an integration to the apps Mediaplane wires so far"; and four
`run.test.ts` tests that count or list the wiring: the fresh plan and the apply with
`--yes` ("4 wiring checks after the start"), the JSON actions, and the history ("4
resources wired").

- [ ] **Step 3: Write the implementation**

**Create** `catalog/qbittorrent/integration.ts`:

```ts
import {
  defineIntegration,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';

/** Where qBittorrent saves a torrent without a category (spec §6.2). */
export const DEFAULT_SAVE_PATH = '/data/torrents';

/**
 * The category each arr files its torrents under (spec §6.2), made while that arr is in
 * the stack. Its save path is DEFAULT_SAVE_PATH/<name>.
 */
export const CATEGORIES = [
  { arr: 'sonarr', name: 'tv' },
  { arr: 'radarr', name: 'movies' },
] as const;

const PREFERENCES = '/api/v2/app/preferences';
const SET_PREFERENCES = '/api/v2/app/setPreferences';
const CATEGORIES_PATH = '/api/v2/torrents/categories';

/**
 * What Mediaplane reads of qBittorrent's preferences. They hold its API key too: z.object
 * drops every other field, so nothing else is kept.
 */
const preferences = z.object({
  web_ui_username: z.string(),
  save_path: z.string(),
  auto_tmm_enabled: z.boolean(),
  bypass_auth_subnet_whitelist_enabled: z.boolean(),
  bypass_auth_subnet_whitelist: z.string(),
});

/** qBittorrent's categories, by name. */
const categories = z.record(z.string(), z.object({ savePath: z.string() }));

/** A path as qBittorrent gives it back: without a trailing "/". */
function asKept(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Subnets as one comma-separated list, with no space: qBittorrent answers with one per
 * line, and would keep a space as part of the next subnet.
 */
function subnetList(list: string): string {
  return list
    .split(/[\s,]+/)
    .filter((subnet) => subnet !== '')
    .join(',');
}

/** The secret `name` that `desired` holds; desired() always gives it. */
function secretOf(desired: DesiredResource, name: string): string {
  const value = desired.secrets[name];
  if (value === undefined) throw new Error(`${desired.name} has no ${name} to send`);
  return value;
}

/** Set qBittorrent's preferences: a JSON object in a form's `json` field, with the key. */
async function setPreferences(
  api: AppApi,
  values: Readonly<Record<string, unknown>>,
  secrets: readonly string[] = [],
): Promise<void> {
  await api.form(SET_PREFERENCES, { json: JSON.stringify(values) }, { secrets });
}

/**
 * The shared admin login (spec §6.1), after qBittorrent's first start: its user name is a
 * managed field and its password a secret, checked by signing in with it. Both are set
 * through its preferences with the key, which needs neither the old password nor a
 * restart.
 */
const admin: ResourceSpec = {
  name: 'admin',
  fields: ['username'],
  secrets: ['password'],
  desired: ({ admin: login }) => ({
    name: 'admin',
    fields: { username: login.username },
    secrets: { password: login.password },
  }),
  async observe(api) {
    const held = await api.get(PREFERENCES, preferences);
    return { id: null, name: 'admin', fields: { username: held.web_ui_username } };
  },
  async verify(api, desired) {
    // A 2xx signs in (204 in qBittorrent 5); 401 is a wrong user name or password. After
    // five of those in a row, qBittorrent bans this address from signing in (403), for an
    // hour by default, which the client throws: the ban says nothing of the password.
    const signedIn = await api.login(
      '/api/v2/auth/login',
      {
        username: String(desired.fields.username),
        password: secretOf(desired, 'password'),
      },
      { answers: [401] },
    );
    return signedIn.status >= 200 && signedIn.status < 300;
  },
  async create(api, desired) {
    await saveAdmin(api, desired);
    return { id: null };
  },
  update: (api, desired) => saveAdmin(api, desired),
};

async function saveAdmin(api: AppApi, desired: DesiredResource): Promise<void> {
  const password = secretOf(desired, 'password');
  await setPreferences(
    api,
    { web_ui_username: desired.fields.username, web_ui_password: password },
    [password],
  );
}

/**
 * The settings Mediaplane manages in qBittorrent (spec §6.1, §6.2): the default save path,
 * Automatic Torrent Management (so a torrent follows its category's save path), and who
 * may skip the login: the LAN subnets, only with `security.login_on_lan: false` and the
 * web UI published on the LAN, as the pre-start file sets them.
 */
const settings: ResourceSpec = {
  name: 'preferences',
  fields: ['savePath', 'autoTmm', 'authSubnetWhitelistEnabled', 'authSubnetWhitelist'],
  secrets: [],
  desired: ({ stack, app }) => {
    const whitelist = stack.config.security.login_on_lan
      ? []
      : app.context.lanClientSubnets;
    return {
      name: 'preferences',
      fields: {
        savePath: DEFAULT_SAVE_PATH,
        autoTmm: true,
        authSubnetWhitelistEnabled: whitelist.length > 0,
        authSubnetWhitelist: subnetList(whitelist.join(',')),
      },
      secrets: {},
    };
  },
  async observe(api) {
    const held = await api.get(PREFERENCES, preferences);
    return {
      id: null,
      name: 'preferences',
      fields: {
        savePath: asKept(held.save_path),
        autoTmm: held.auto_tmm_enabled,
        authSubnetWhitelistEnabled: held.bypass_auth_subnet_whitelist_enabled,
        authSubnetWhitelist: subnetList(held.bypass_auth_subnet_whitelist),
      },
    };
  },
  async create(api, desired) {
    await saveSettings(api, desired);
    return { id: null };
  },
  update: (api, desired) => saveSettings(api, desired),
};

/** Each value with the type qBittorrent expects: it ignores a wrong one, or misreads it. */
async function saveSettings(api: AppApi, desired: DesiredResource): Promise<void> {
  const { fields } = desired;
  await setPreferences(api, {
    save_path: String(fields.savePath),
    auto_tmm_enabled: fields.autoTmm === true,
    bypass_auth_subnet_whitelist_enabled: fields.authSubnetWhitelistEnabled === true,
    bypass_auth_subnet_whitelist: String(fields.authSubnetWhitelist),
  });
}

/**
 * The category `name` (spec §6.2), with its save path under DEFAULT_SAVE_PATH, while
 * `arr` is in the stack. qBittorrent knows a category by its name: it gives it no id.
 */
function category(arr: string, name: string): ResourceSpec {
  const save = (api: AppApi, path: string, desired: DesiredResource) =>
    api.form(path, { category: name, savePath: String(desired.fields.savePath) });
  return {
    name: `category_${name}`,
    fields: ['savePath'],
    secrets: [],
    desired: ({ stack }) =>
      stack.apps.some((app) => app.def.id === arr)
        ? { name, fields: { savePath: `${DEFAULT_SAVE_PATH}/${name}` }, secrets: {} }
        : undefined,
    async observe(api) {
      const held = (await api.get(CATEGORIES_PATH, categories))[name];
      return held === undefined
        ? undefined
        : { id: name, name, fields: { savePath: asKept(held.savePath) } };
    },
    async create(api, desired) {
      await save(api, '/api/v2/torrents/createCategory', desired);
      return { id: name };
    },
    async update(api, desired) {
      await save(api, '/api/v2/torrents/editCategory', desired);
    },
  };
}

/**
 * What Mediaplane wires in qBittorrent (spec §6.1, §6.2): the shared admin login, its
 * settings, and a category for each arr in the stack. Sonarr and Radarr come after it.
 */
export default defineIntegration({
  after: [],
  resources: [admin, settings, ...CATEGORIES.map(({ arr, name }) => category(arr, name))],
});
```

**Change** `catalog/qbittorrent/app.ts`:

```diff
diff --git a/catalog/qbittorrent/app.ts b/catalog/qbittorrent/app.ts
index 830e6bc..fc784e4 100644
--- a/catalog/qbittorrent/app.ts
+++ b/catalog/qbittorrent/app.ts
@@ -3,2 +3,3 @@ import { z } from 'zod';
 import { qbittorrentConf } from './conf';
+import integration from './integration';
 
@@ -32,2 +33,3 @@ export default defineApp({
   },
+  integration,
   options: z.strictObject({
```

Then run `pnpm docs:generate`. It rewrites the facts block of
`catalog/qbittorrent/README.md`: "Managed in the app" lists the four resources and their
fields.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run catalog scripts packages/cli/src/run.test.ts`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages/engine/src/testing/wiring.ts packages/cli/src/run.test.ts scripts/docs/catalog-facts.test.ts
git commit -m "feat(catalog): qBittorrent's login, settings and categories through its API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sonarr's and Radarr's download client and root folder, after qBittorrent

The link itself (decisions 3, 4, 5): each arr gets qBittorrent as its download client,
through Gluetun, filing under its category, and its root folder under `/data/media`.

Decision: `servarrDownloadClient({ category, setting })` and `servarrRootFolder(path)` in
`catalog/_shared/servarr-download.ts`, which both arrs share; `servarrIntegration` takes
them after the admin. Sonarr and Radarr come `after: ['qbittorrent']`.
Decision: the client's `verify` throws an `AppApiError` (`rejected`, 400) for a failure
that isn't the key's, naming the arr, where it was reached, the client, and each
`property: message` the arr gave.
Decision: `fakeStackApis`' Sonarr and Radarr keep download clients (their key in clear,
masked as `********` in what they answer, kept when a PUT sends it masked) and root
folders. Their test passes when the client names `gluetun` or `qbittorrent` and holds
qBittorrent's key (`FakeAppState.key`, any when empty), and fails as Sonarr's does
otherwise (`Host: Unable to connect to qBittorrent`, `ApiKey: Authentication Failure`).

**Files:**
- Create: `catalog/_shared/servarr-download.ts`, `catalog/_shared/servarr-download.test.ts`
- Modify: `catalog/_shared/servarr.ts`, `catalog/sonarr/integration.ts`,
  `catalog/radarr/integration.ts`, `packages/engine/src/testing/wiring.ts`,
  `packages/cli/src/run.test.ts`
- Generated: `catalog/sonarr/README.md`, `catalog/radarr/README.md` (their facts blocks)

**Interfaces:**
- **Consumes:** `AppApi.test` (Task 3); `WiringContext.keys`, `verify`'s `observed`
  (Task 1); `DesiredResource.folders` (Task 2); `qbittorrent.category_tv` and
  `qbittorrent.category_movies` (Task 4).
- **Produces:**
  - `servarrDownloadClient(link: DownloadLink): ResourceSpec`, with
    `DownloadLink = { category: 'tv' | 'movies'; setting: 'tvCategory' | 'movieCategory' }`;
  - `servarrRootFolder(path: string): ResourceSpec`;
  - `DOWNLOAD_CLIENT_NAME = 'qBittorrent (Mediaplane)'`;
  - `servarrIntegration(version, after = [], more: readonly ResourceSpec[] = [])`;
  - `FakeAppState` gains `key`, `downloadClients: FakeDownloadClient[]` and
    `rootFolders: { id: number; path: string }[]`.

- [ ] **Step 1: Write the failing tests, and the fake arrs they use**

**Create** `catalog/_shared/servarr-download.test.ts`:

```ts
import {
  AppApiError,
  createAppApi,
  type ResolvedStack,
  type WiringContext,
} from '@mediaplane/engine';
import { fakeStackApis, freshAppState, wiringStack } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import {
  DOWNLOAD_CLIENT_NAME,
  servarrDownloadClient,
  servarrRootFolder,
} from './servarr-download';

const SONARR_KEY = '0'.repeat(32);
const QBT_KEY = `qbt_${'1'.repeat(28)}`;

/** A stack with Sonarr and qBittorrent: behind the VPN unless `qbittorrent` says. */
function stack(qbittorrent = '{}', apps = '  sonarr: {}\n'): ResolvedStack {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
${apps}  qbittorrent: ${qbittorrent}
`,
  );
}

function contextOf(resolved: ResolvedStack = stack()): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'sonarr');
  if (app === undefined) throw new Error('no Sonarr in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys: { sonarr: { apiKey: SONARR_KEY }, qbittorrent: { apiKey: QBT_KEY } },
  };
}

const client = servarrDownloadClient({ category: 'tv', setting: 'tvCategory' });

/** Sonarr, faked as fakeStackApis fakes it, and a client for it; qBittorrent takes QBT_KEY. */
async function sonarr() {
  const apis = await fakeStackApis();
  const state = { ...freshAppState() };
  apis.apps.set('sonarr', state);
  apis.apps.set('qbittorrent', { ...freshAppState(), key: QBT_KEY });
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [SONARR_KEY, QBT_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, app: apis.app, state };
}

function wanted(ctx: WiringContext = contextOf()) {
  const desired = client.desired(ctx);
  if (desired === undefined) throw new Error('the download client is wanted');
  return desired;
}

describe('servarrDownloadClient', () => {
  it("links qBittorrent through Gluetun, at qBittorrent's own port, with its key, after its category", () => {
    expect(client).toMatchObject({
      name: 'download_client',
      fields: ['host', 'port', 'useSsl', 'category', 'enable'],
      secrets: ['apiKey'],
      requires: ['qbittorrent.category_tv'],
    });
    expect(wanted()).toEqual({
      name: DOWNLOAD_CLIENT_NAME,
      fields: {
        host: 'gluetun',
        port: 8080,
        useSsl: false,
        category: 'tv',
        enable: true,
      },
      secrets: { apiKey: QBT_KEY },
    });
    expect(wanted(contextOf(stack('{ port: 8090 }'))).fields.port).toBe(8090);
    expect(wanted(contextOf(stack('{ vpn: false }'))).fields.host).toBe('qbittorrent');
  });

  it('wants none while qBittorrent has no key to give it', () => {
    expect(client.desired({ ...contextOf(), keys: {} })).toBeUndefined();
  });

  it("makes it from the app's own template, saved even while qBittorrent is down, and finds it by name", async () => {
    const { api, app, state } = await sonarr();
    expect(await client.observe(api, undefined)).toBeUndefined();
    expect(await client.create(api, wanted())).toEqual({ id: 1 });
    const post = app.requests.find((r) => r.method === 'POST');
    expect(post?.path).toBe('/api/v3/downloadclient?forceSave=true');
    const sent = JSON.parse(post?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toMatchObject({
      name: DOWNLOAD_CLIENT_NAME,
      enable: true,
      implementation: 'QBittorrent',
    });
    expect(sent).not.toHaveProperty('presets');
    expect(state.downloadClients[0]?.fields).toEqual(
      expect.arrayContaining([
        { name: 'host', value: 'gluetun' },
        { name: 'port', value: 8080 },
        { name: 'useSsl', value: false },
        { name: 'apiKey', value: QBT_KEY },
        { name: 'tvCategory', value: 'tv' },
        // A setting Mediaplane doesn't manage keeps the template's value.
        { name: 'username' },
      ]),
    );
    expect(await client.observe(api, undefined)).toEqual({
      id: 1,
      name: DOWNLOAD_CLIENT_NAME,
      fields: {
        host: 'gluetun',
        port: 8080,
        useSsl: false,
        category: 'tv',
        enable: true,
      },
    });
  });

  it("checks the key with the app's own test of the client it holds: a refusal means update", async () => {
    const { api, app, state } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    expect(await client.verify?.(api, desired, observed)).toBe(true);
    // Tested as the app holds it: by its id, its key masked.
    const test = app.requests.find((r) => r.path === '/api/v3/downloadclient/test');
    expect(JSON.parse(test?.body ?? '{}')).toMatchObject({ id: 1 });
    expect(test?.body).not.toContain(QBT_KEY);
    const key = state.downloadClients[0]?.fields.find((f) => f.name === 'apiKey');
    if (key !== undefined) key.value = `qbt_${'9'.repeat(28)}`;
    expect(await client.verify?.(api, desired, observed)).toBe(false);
    await client.update(api, desired, observed);
    expect(await client.verify?.(api, desired, observed)).toBe(true);
  });

  it("says the app's own words when its test fails for another reason", async () => {
    const { api } = await sonarr();
    const desired = wanted();
    await client.create(api, {
      ...desired,
      fields: { ...desired.fields, host: 'nohost' },
    });
    const observed = await client.observe(api, undefined);
    if (observed === undefined) throw new Error('no client observed');
    const failure = await client
      .verify?.(api, desired, observed)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect((failure as AppApiError).message).toBe(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent (Name does not resolve (nohost:8080)) (POST /api/v3/downloadclient/test)',
    );
  });

  it('updates what differs, keeping the settings it does not manage', async () => {
    const { api, state } = await sonarr();
    const desired = wanted();
    await client.create(api, desired);
    const held = state.downloadClients[0];
    if (held === undefined) throw new Error('no client made');
    held.priority = 5;
    held.enable = false;
    held.fields = held.fields.map((f) =>
      f.name === 'host' ? { ...f, value: 'old' } : f,
    );
    const observed = await client.observe(api, {
      id: 1,
      name: 'renamed',
      fields: {},
      secrets: [],
      appliedAt: '2026-10-10T12:00:00.000Z',
    });
    expect(observed?.fields).toMatchObject({ host: 'old', enable: false });
    if (observed === undefined) throw new Error('no client observed');
    await client.update(api, desired, observed);
    expect(state.downloadClients[0]).toMatchObject({ priority: 5, enable: true });
    expect((await client.observe(api, undefined))?.fields).toEqual(desired.fields);
  });
});

describe('servarrRootFolder', () => {
  const folder = servarrRootFolder('/data/media/tv');

  it('needs its folder made first, and is known by its path', async () => {
    expect(folder.desired(contextOf())).toEqual({
      name: '/data/media/tv',
      fields: { path: '/data/media/tv' },
      secrets: {},
      folders: ['/data/media/tv'],
    });
    const { api, state } = await sonarr();
    expect(await folder.observe(api, undefined)).toBeUndefined();
    const desired = folder.desired(contextOf());
    if (desired === undefined) throw new Error('the root folder is wanted');
    expect(await folder.create(api, desired)).toEqual({ id: 1 });
    expect(state.rootFolders).toEqual([{ id: 1, path: '/data/media/tv' }]);
    // The app may give it back with a trailing "/".
    state.rootFolders = [{ id: 1, path: '/data/media/tv/' }];
    expect(await folder.observe(api, undefined)).toEqual({
      id: 1,
      name: '/data/media/tv',
      fields: { path: '/data/media/tv' },
    });
  });
});
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index c2ed925..b560779 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -99,2 +99,18 @@ export interface FakeAppState {
   categories: Record<string, string>;
+  /** qBittorrent's API key: the only one it takes, or any when empty. */
+  key: string;
+  /** Sonarr's or Radarr's download clients, their keys in clear. */
+  downloadClients: FakeDownloadClient[];
+  /** Sonarr's or Radarr's root folders. */
+  rootFolders: { id: number; path: string }[];
+}
+
+/** A download client, as Sonarr and Radarr keep one. */
+export interface FakeDownloadClient {
+  id: number;
+  name: string;
+  enable: boolean;
+  implementation: string;
+  priority: number;
+  fields: { name: string; value?: unknown }[];
 }
@@ -114,2 +130,39 @@ export function freshAppState(): FakeAppState {
     categories: {},
+    key: '',
+    downloadClients: [],
+    rootFolders: [],
+  };
+}
+
+/** Sonarr's or Radarr's template for a qBittorrent client, as `…/schema` gives it. */
+function qbittorrentTemplate(service: string): Omit<FakeDownloadClient, 'id'> & {
+  presets: unknown[];
+} {
+  const category = service === 'radarr' ? 'movieCategory' : 'tvCategory';
+  return {
+    name: '',
+    enable: false,
+    implementation: 'QBittorrent',
+    priority: 1,
+    presets: [],
+    fields: [
+      { name: 'host', value: 'localhost' },
+      { name: 'port', value: 8080 },
+      { name: 'useSsl', value: false },
+      { name: 'urlBase' },
+      { name: 'apiKey' },
+      { name: 'username' },
+      { name: 'password' },
+      { name: category, value: service === 'radarr' ? 'radarr' : 'tv-sonarr' },
+    ],
+  };
+}
+
+/** A download client as the app shows it: its key masked. */
+function masked(held: FakeDownloadClient): FakeDownloadClient {
+  return {
+    ...held,
+    fields: held.fields.map((f) =>
+      f.name === 'apiKey' && f.value !== undefined ? { ...f, value: '********' } : f,
+    ),
   };
@@ -117,2 +170,110 @@ export function freshAppState(): FakeAppState {
 
+/**
+ * Sonarr's and Radarr's download clients and root folders, as fakeStackApis answers them.
+ * A client's test passes when it names qBittorrent's service (gluetun or qbittorrent)
+ * and holds qBittorrent's key; otherwise it fails as Sonarr's does.
+ */
+function fakeServarrDownloads(
+  request: FakeRequest,
+  service: string,
+  state: FakeAppState,
+  qbittorrent: FakeAppState,
+): FakeReply | undefined {
+  const { method, path } = request;
+  const clients = '/api/v3/downloadclient';
+  if (path === `${clients}/schema`)
+    return { status: 200, body: [qbittorrentTemplate(service)] };
+  if (path === clients && method === 'GET') {
+    return { status: 200, body: state.downloadClients.map(masked) };
+  }
+  const one = new RegExp(`^${clients}/(\\d+)(\\?forceSave=true)?$`).exec(path);
+  const held = state.downloadClients.find((c) => c.id === Number(one?.[1]));
+  if (one !== null && method === 'GET') {
+    return held === undefined ? { status: 404 } : { status: 200, body: masked(held) };
+  }
+  if (path === `${clients}?forceSave=true` && method === 'POST') {
+    const sent = JSON.parse(request.body) as Omit<FakeDownloadClient, 'id'>;
+    if (state.downloadClients.some((c) => c.name === sent.name)) {
+      return {
+        status: 400,
+        body: [{ propertyName: 'Name', errorMessage: 'Should be unique' }],
+      };
+    }
+    const made = { ...sent, id: state.downloadClients.length + 1 };
+    state.downloadClients.push(made);
+    return { status: 201, body: masked(made) };
+  }
+  if (one?.[2] !== undefined && method === 'PUT' && held !== undefined) {
+    const sent = JSON.parse(request.body) as FakeDownloadClient;
+    // "********" keeps the key it holds.
+    const key = held.fields.find((f) => f.name === 'apiKey')?.value;
+    Object.assign(held, {
+      ...sent,
+      fields: sent.fields.map((f) =>
+        f.name === 'apiKey' && f.value === '********' ? { ...f, value: key } : f,
+      ),
+    });
+    return { status: 202, body: masked(held) };
+  }
+  if (path === `${clients}/test` && method === 'POST') {
+    const sent = JSON.parse(request.body) as FakeDownloadClient;
+    const value = (name: string) => sent.fields.find((f) => f.name === name)?.value;
+    const stored = state.downloadClients
+      .find((c) => c.id === sent.id)
+      ?.fields.find((f) => f.name === 'apiKey')?.value;
+    const key = value('apiKey') === '********' ? stored : value('apiKey');
+    const host = value('host');
+    if (host !== 'gluetun' && host !== 'qbittorrent') {
+      return {
+        status: 400,
+        body: [
+          {
+            propertyName: 'Host',
+            errorMessage: 'Unable to connect to qBittorrent',
+            detailedDescription: `Name does not resolve (${String(host)}:${String(value('port'))})`,
+            isWarning: false,
+          },
+        ],
+      };
+    }
+    const right =
+      typeof key === 'string' &&
+      key !== '' &&
+      (qbittorrent.key === '' || key === qbittorrent.key);
+    return right
+      ? { status: 200, body: {} }
+      : {
+          status: 400,
+          body: [
+            {
+              propertyName: 'ApiKey',
+              errorMessage: 'Authentication Failure',
+              detailedDescription: 'Please verify your credentials.',
+              isWarning: false,
+            },
+          ],
+        };
+  }
+  const folders = '/api/v3/rootfolder';
+  if (path === folders && method === 'GET') {
+    return {
+      status: 200,
+      body: state.rootFolders.map((f) => ({ ...f, accessible: true, freeSpace: 1 })),
+    };
+  }
+  if (path === folders && method === 'POST') {
+    const { path: wanted } = JSON.parse(request.body) as { path: string };
+    if (state.rootFolders.some((f) => f.path === wanted)) {
+      return {
+        status: 400,
+        body: [{ propertyName: 'Path', errorMessage: 'already configured' }],
+      };
+    }
+    const made = { id: state.rootFolders.length + 1, path: wanted };
+    state.rootFolders.push(made);
+    return { status: 201, body: { ...made, accessible: true } };
+  }
+  return undefined;
+}
+
 /**
@@ -120,6 +281,7 @@ export function freshAppState(): FakeAppState {
  * of 127.0.0.1: told apart by their Host header ("sonarr:8989", "gluetun:8080"). Sonarr,
- * Radarr and Prowlarr have /ping, system/status, config/host and /login; qBittorrent has
- * /, app/version, its sign-in, preferences and categories, and is `apps`' "qbittorrent"
- * also when reached through Gluetun. Any key is taken. `seams` send every app's calls
- * there.
+ * Radarr and Prowlarr have /ping, system/status, config/host and /login, and the arrs
+ * their download clients and root folders; qBittorrent has /, app/version, its sign-in,
+ * preferences and categories, and is `apps`' "qbittorrent" also when reached through
+ * Gluetun. Any key is taken, but qBittorrent's `key` when it is set. `seams` send every
+ * app's calls there.
  */
@@ -146,3 +308,7 @@ export async function fakeStackApis(): Promise<{
       headers['x-api-key'] !== undefined || headers.authorization !== undefined;
-    if (service === 'qbittorrent') return fakeQbittorrent(request, state, keyed);
+    if (service === 'qbittorrent') {
+      const bearer =
+        state.key === '' ? keyed : headers.authorization === `Bearer ${state.key}`;
+      return fakeQbittorrent(request, state, bearer);
+    }
     if (path === '/ping') return { status: state.up ? 200 : 503, body: { status: 'OK' } };
@@ -172,3 +338,7 @@ export async function fakeStackApis(): Promise<{
     }
-    return { status: 404 };
+    return (
+      fakeServarrDownloads(request, service, state, stateOf('qbittorrent')) ?? {
+        status: 404,
+      }
+    );
   });
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 8c0ee15..6a96eeb 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -97,2 +97,16 @@ const WIRED: KnownResources = {
   },
+  'sonarr.download_client': {
+    id: 1,
+    name: 'qBittorrent (Mediaplane)',
+    fields: { host: 'gluetun', port: 8080, useSsl: false, category: 'tv', enable: true },
+    secrets: ['apiKey'],
+    appliedAt: AT,
+  },
+  'sonarr.root_folder': {
+    id: 1,
+    name: '/data/media/tv',
+    fields: { path: '/data/media/tv' },
+    secrets: [],
+    appliedAt: AT,
+  },
 };
@@ -132,3 +146,24 @@ async function currentHome(
   const password = store.shared?.adminPassword ?? '';
-  apis.apps.set('sonarr', { ...freshAppState(), user: 'admin', password });
+  apis.apps.set('sonarr', {
+    ...freshAppState(),
+    user: 'admin',
+    password,
+    downloadClients: [
+      {
+        id: 1,
+        name: 'qBittorrent (Mediaplane)',
+        enable: true,
+        implementation: 'QBittorrent',
+        priority: 1,
+        fields: [
+          { name: 'host', value: 'gluetun' },
+          { name: 'port', value: 8080 },
+          { name: 'useSsl', value: false },
+          { name: 'apiKey', value: store.apps.qbittorrent?.apiKey },
+          { name: 'tvCategory', value: 'tv' },
+        ],
+      },
+    ],
+    rootFolders: [{ id: 1, path: '/data/media/tv' }],
+  });
   apis.apps.set('qbittorrent', {
@@ -259,3 +294,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 4 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 6 wiring checks after the start.',
     );
@@ -320,3 +355,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toBe(
-      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr.admin\nPlan: 1 app to wait for, 1 wiring check after the start.\n',
+      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr.admin\n  > after start sonarr.download_client\n  > after start sonarr.root_folder\nPlan: 1 app to wait for, 3 wiring checks after the start.\n',
     );
@@ -517,3 +552,3 @@ describe('mediaplane apply', () => {
     expect(first.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 4 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 6 wiring checks after the start.',
     );
@@ -602,2 +637,4 @@ describe('mediaplane apply', () => {
       ['wire', 'sonarr.admin', 'done'],
+      ['wire', 'sonarr.download_client', 'done'],
+      ['wire', 'sonarr.root_folder', 'done'],
       ['wire', '', 'done'],
@@ -864,3 +901,3 @@ describe('mediaplane history', () => {
     expect(list.stdout()).toBe(
-      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 4 resources wired\n`,
+      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 6 resources wired\n`,
     );
@@ -874,2 +911,3 @@ describe('mediaplane history', () => {
     expect(one.stdout()).toContain('  done    wiring qbittorrent.category_tv: created\n');
+    expect(one.stdout()).toContain('  done    wiring sonarr.download_client: created\n');
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog packages/cli/src/run.test.ts`
Expected: FAIL: `catalog/_shared/servarr-download.test.ts` can't load
`./servarr-download`, and five `run.test.ts` tests that count or list the wiring: the
fresh plan and the apply with `--yes` ("6 wiring checks after the start"), the plan that
waits for Sonarr (three `after start` lines), the JSON actions, and the history ("6
resources wired").

- [ ] **Step 3: Write the implementation**

**Create** `catalog/_shared/servarr-download.ts`:

```ts
import {
  AppApiError,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';

/** The name of the download client Mediaplane makes in Sonarr and Radarr (spec §6.2). */
export const DOWNLOAD_CLIENT_NAME = 'qBittorrent (Mediaplane)';

const CLIENTS = '/api/v3/downloadclient';
const ROOT_FOLDERS = '/api/v3/rootfolder';

/** The settings a refused sign-in names: Sonarr's key, or a user name or password, is wrong. */
const CREDENTIALS = new Set(['ApiKey', 'Username', 'Password']);

/** One setting of a Servarr provider; the rest of it goes back as it came. */
const setting = z.looseObject({ name: z.string(), value: z.unknown().optional() });

/**
 * A download client as Sonarr or Radarr gives it, its key masked as "********". The rest
 * of it goes back as it came, so a setting Mediaplane doesn't manage stays the user's.
 */
const client = z.looseObject({
  id: z.number(),
  name: z.string(),
  enable: z.boolean(),
  implementation: z.string(),
  fields: z.array(setting),
});

/** One of the app's templates for a new download client (`…/schema`). */
const template = z.looseObject({ implementation: z.string(), fields: z.array(setting) });

const created = z.looseObject({ id: z.number() });

/** How an arr files its downloads in qBittorrent. */
export interface DownloadLink {
  /** The qBittorrent category (spec §6.2), which `qbittorrent.category_<category>` makes. */
  category: 'tv' | 'movies';
  /** The arr's setting that holds it: Sonarr's tvCategory, Radarr's movieCategory. */
  setting: 'tvCategory' | 'movieCategory';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The managed fields of a download client, from the app's settings. */
function fieldsOf(held: z.infer<typeof client>, link: DownloadLink) {
  const value = (name: string) => held.fields.find((f) => f.name === name)?.value;
  const port = value('port');
  return {
    host: text(value('host')),
    port: typeof port === 'number' ? port : 0,
    useSsl: value('useSsl') === true,
    category: text(value(link.setting)),
    enable: held.enable,
  };
}

/**
 * `body` with the desired settings, and qBittorrent's key in clear: the one place one
 * app's key goes to another, in a request body. A setting the app doesn't have means a
 * version Mediaplane doesn't know: say so, rather than save a client that can't work.
 */
function withSettings<T extends { fields: z.infer<typeof setting>[] }>(
  api: AppApi,
  body: T,
  desired: DesiredResource,
  link: DownloadLink,
): T & { name: string; enable: boolean } {
  const key = desired.secrets.apiKey;
  if (key === undefined) throw new Error(`${desired.name} has no apiKey to send`);
  const values: Record<string, unknown> = {
    host: desired.fields.host,
    port: desired.fields.port,
    useSsl: desired.fields.useSsl,
    [link.setting]: desired.fields.category,
    apiKey: key,
  };
  const missing = Object.keys(values).filter(
    (name) => !body.fields.some((f) => f.name === name),
  );
  if (missing.length > 0) {
    throw new AppApiError(
      `${api.name} at ${api.where} has no ${missing.join(', ')} setting for qBittorrent, which Mediaplane needs (GET ${CLIENTS})`,
      { kind: 'protocol' },
    );
  }
  return {
    ...body,
    name: desired.name,
    enable: desired.fields.enable === true,
    fields: body.fields.map((f) =>
      Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f,
    ),
  };
}

/**
 * qBittorrent as the download client of Sonarr or Radarr (spec §6.2), named
 * DOWNLOAD_CLIENT_NAME, filing its downloads under `link.category`. It needs that category
 * in place first: Sonarr's own test makes a missing one, with no save path.
 * - Its host is how the arr reaches qBittorrent: through Gluetun when qBittorrent shares
 *   Gluetun's network, at qBittorrent's own port, which its Host check needs.
 * - Its key is checked with the app's own test of the client it holds, as it holds it
 *   (the key masked): a refused sign-in means the key differs, and an update sets it.
 *   Any other failure, such as qBittorrent out of the arr's reach, the app explains.
 * - It is saved with forceSave, so it is saved even while qBittorrent is down; the check
 *   says whether it works.
 */
export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
  return {
    name: 'download_client',
    fields: ['host', 'port', 'useSsl', 'category', 'enable'],
    secrets: ['apiKey'],
    requires: [`qbittorrent.category_${link.category}`],
    desired: ({ stack, keys }) => {
      const qbittorrent = stack.apps.find((app) => app.def.id === 'qbittorrent');
      const port = qbittorrent?.containerPorts.web;
      const key = keys.qbittorrent?.apiKey;
      if (qbittorrent === undefined || port === undefined || key === undefined) {
        return undefined;
      }
      return {
        name: DOWNLOAD_CLIENT_NAME,
        fields: {
          host: qbittorrent.networkVia ?? qbittorrent.def.id,
          port,
          useSsl: false,
          category: link.category,
          enable: true,
        },
        secrets: { apiKey: key },
      };
    },
    async observe(api, known) {
      const clients = (await api.get(CLIENTS, z.array(client))).filter(
        (c) => c.implementation === 'QBittorrent',
      );
      const held =
        clients.find((c) => known !== undefined && c.id === known.id) ??
        clients.find((c) => c.name === DOWNLOAD_CLIENT_NAME);
      return held === undefined
        ? undefined
        : { id: held.id, name: held.name, fields: fieldsOf(held, link) };
    },
    async verify(api, _desired, observed) {
      const held = await api.get(`${CLIENTS}/${String(observed.id)}`, client);
      const result = await api.test(`${CLIENTS}/test`, held);
      if (result.passed) return true;
      if (result.failures.some((f) => CREDENTIALS.has(f.property))) return false;
      const said = result.failures
        .map((f) => (f.property === '' ? f.message : `${f.property}: ${f.message}`))
        .join('; ');
      throw new AppApiError(
        `${api.name} at ${api.where} tested ${DOWNLOAD_CLIENT_NAME}, and it failed: ${said} (POST ${CLIENTS}/test)`,
        { kind: 'rejected', status: 400 },
      );
    },
    async create(api, desired) {
      const offered = (await api.get(`${CLIENTS}/schema`, z.array(template))).find(
        (t) => t.implementation === 'QBittorrent',
      );
      if (offered === undefined) {
        throw new AppApiError(
          `${api.name} at ${api.where} offers no qBittorrent download client (GET ${CLIENTS}/schema)`,
          { kind: 'protocol' },
        );
      }
      // Its presets are the UI's, not part of a client.
      const { presets, ...body } = offered;
      const made = await api.post(
        `${CLIENTS}?forceSave=true`,
        withSettings(api, body, desired, link),
        created,
      );
      return { id: made.id };
    },
    async update(api, desired, observed) {
      const path = `${CLIENTS}/${String(observed.id)}`;
      const held = await api.get(path, client);
      await api.put(`${path}?forceSave=true`, withSettings(api, held, desired, link));
    },
  };
}

const rootFolder = z.looseObject({ id: z.number(), path: z.string() });

/**
 * A root folder of Sonarr or Radarr (spec §6.2): where its library lives, under the data
 * folder, which the downloads share, so that an import is a hard link. The app needs the
 * folder to exist: the wire step makes it first. A root folder is known by its path, and
 * the app can't change one (a PUT answers 405), so a found one is always as wanted.
 */
export function servarrRootFolder(path: string): ResourceSpec {
  return {
    name: 'root_folder',
    fields: ['path'],
    secrets: [],
    desired: () => ({ name: path, fields: { path }, secrets: {}, folders: [path] }),
    async observe(api) {
      const held = (await api.get(ROOT_FOLDERS, z.array(rootFolder))).find(
        (folder) => folder.path.replace(/\/+$/, '') === path,
      );
      return held === undefined
        ? undefined
        : { id: held.id, name: path, fields: { path } };
    },
    async create(api) {
      const made = await api.post(ROOT_FOLDERS, { path }, created);
      return { id: made.id };
    },
    // Found by its path, it never differs from the one wanted: there is nothing to update.
    update: () => Promise.resolve(),
  };
}
```

**Change** `catalog/_shared/servarr.ts`:

```diff
diff --git a/catalog/_shared/servarr.ts b/catalog/_shared/servarr.ts
index 7da0caf..9f66ad3 100644
--- a/catalog/_shared/servarr.ts
+++ b/catalog/_shared/servarr.ts
@@ -120,3 +120,6 @@ export function servarrAdmin(version: 'v1' | 'v3'): ResourceSpec {
 
-/** How Mediaplane wires Sonarr, Radarr or Prowlarr, after the apps `after`. */
+/**
+ * How Mediaplane wires Sonarr, Radarr or Prowlarr, after the apps `after`: the shared
+ * admin, then `more`.
+ */
 export function servarrIntegration(
@@ -124,4 +127,5 @@ export function servarrIntegration(
   after: readonly string[] = [],
+  more: readonly ResourceSpec[] = [],
 ): Integration {
-  return defineIntegration({ after, resources: [servarrAdmin(version)] });
+  return defineIntegration({ after, resources: [servarrAdmin(version), ...more] });
 }
```

**Change** `catalog/sonarr/integration.ts`:

```diff
diff --git a/catalog/sonarr/integration.ts b/catalog/sonarr/integration.ts
index 5ce918d..cef2617 100644
--- a/catalog/sonarr/integration.ts
+++ b/catalog/sonarr/integration.ts
@@ -1,4 +1,16 @@
 import { servarrIntegration } from '../_shared/servarr';
+import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';
 
-/** What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, so far. */
-export default servarrIntegration('v3');
+/**
+ * What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, qBittorrent as its
+ * download client, filing under the `tv` category, and the root folder /data/media/tv.
+ * It comes after qBittorrent, whose category the download client needs.
+ */
+export default servarrIntegration(
+  'v3',
+  ['qbittorrent'],
+  [
+    servarrDownloadClient({ category: 'tv', setting: 'tvCategory' }),
+    servarrRootFolder('/data/media/tv'),
+  ],
+);
```

**Change** `catalog/radarr/integration.ts`:

```diff
diff --git a/catalog/radarr/integration.ts b/catalog/radarr/integration.ts
index e7705cf..b966550 100644
--- a/catalog/radarr/integration.ts
+++ b/catalog/radarr/integration.ts
@@ -1,4 +1,17 @@
 import { servarrIntegration } from '../_shared/servarr';
+import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';
 
-/** What Mediaplane wires in Radarr (spec §6.2): the shared admin login, so far. */
-export default servarrIntegration('v3');
+/**
+ * What Mediaplane wires in Radarr (spec §6.2): the shared admin login, qBittorrent as its
+ * download client, filing under the `movies` category, and the root folder
+ * /data/media/movies. It comes after qBittorrent, whose category the download client
+ * needs.
+ */
+export default servarrIntegration(
+  'v3',
+  ['qbittorrent'],
+  [
+    servarrDownloadClient({ category: 'movies', setting: 'movieCategory' }),
+    servarrRootFolder('/data/media/movies'),
+  ],
+);
```

Then run `pnpm docs:generate`. It rewrites the facts blocks of `catalog/sonarr/README.md`
and `catalog/radarr/README.md`: "Managed in the app" adds `download_client` and
`root_folder`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run catalog packages/cli/src/run.test.ts`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages/engine/src/testing/wiring.ts packages/cli/src/run.test.ts
git commit -m "feat(catalog): Sonarr's and Radarr's download client and root folder, after qBittorrent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end: the download path behind the VPN, from source and from the image

What S3c proves on real Docker (decision 12): success criterion 1's download part, on the
VPN topology, from source and from the image behind the real socket proxy. These tests
check Tasks 1 to 5, so they pass as soon as they are written; a failure is a bug in those
tasks, not in the test.

Decision: a new `test/e2e/download.e2e.test.ts`, with the WireGuard server of
`test/e2e/wireguard.ts`, Sonarr, Radarr, and qBittorrent behind Gluetun on port 8090. Its
Gluetun settings come from a helper the VPN test now shares (`gluetunEnv`, `envLines`).
Decision: the image's `apply` runs after Radarr's link is taken apart by hand (its
client, its root folder and the folder, qBittorrent's `movies` category) and
qBittorrent's password changed, so it makes each one again through the proxy: the folder
helper's `compose run` of Radarr, which is on two networks, among them (decision 6).
Decision: the apply, deploy and VPN tests change only what they list as wired. The apply
test also checks that `resources.json` holds no qBittorrent key, and the deploy test that
Sonarr's root folder was made, through the proxy.

**Files:**
- Create: `test/e2e/download.e2e.test.ts`
- Modify: `test/e2e/wireguard.ts`, `test/e2e/vpn.e2e.test.ts`,
  `test/e2e/apply.e2e.test.ts`, `test/e2e/deploy.e2e.test.ts`

**Interfaces:**
- **Consumes:** `apply`, `createDockerRuntime`, `readSecretStore` (engine);
  `deployMediaplane`, `makeHome`, `composeDown`, `expectWiringRemoved`, `parseRevealed`
  (`test/e2e/helpers.ts`); `startWireGuard`, `TUNNEL` (`test/e2e/wireguard.ts`).
- **Produces:** `gluetunEnv(wg: WireGuardServer): Record<string, string>` and
  `envLines(env: Record<string, string>, indent: string): string` in
  `test/e2e/wireguard.ts`.

- [ ] **Step 1: The shared Gluetun settings, and the VPN test that uses them**

**Change** `test/e2e/wireguard.ts`:

```diff
diff --git a/test/e2e/wireguard.ts b/test/e2e/wireguard.ts
index 6b50cb1..460634f 100644
--- a/test/e2e/wireguard.ts
+++ b/test/e2e/wireguard.ts
@@ -43,2 +43,27 @@ export interface WireGuardServer {
 
+/**
+ * Gluetun's settings for `wg`, as `apps.gluetun.env` takes them: the `custom` provider on
+ * the test's server, with Gluetun's health checks aimed at the echo server, and its own
+ * DNS, public-IP and version lookups off, so it needs no internet.
+ */
+export function gluetunEnv(wg: WireGuardServer): Record<string, string> {
+  return {
+    WIREGUARD_ENDPOINT_IP: wg.gateway,
+    WIREGUARD_ENDPOINT_PORT: String(wg.endpointPort),
+    WIREGUARD_PUBLIC_KEY: wg.serverPublicKey,
+    HEALTH_TARGET_ADDRESSES: `${wg.echo}:80`,
+    HEALTH_ICMP_TARGET_IPS: wg.echo,
+    DNS_SERVER: 'off',
+    PUBLICIP_ENABLED: 'off',
+    VERSION_INFORMATION: 'off',
+  };
+}
+
+/** `env` as the lines of a YAML mapping, each value a JSON string (valid YAML), indented. */
+export function envLines(env: Record<string, string>, indent: string): string {
+  return Object.entries(env)
+    .map(([name, value]) => `${indent}${name}: ${JSON.stringify(value)}`)
+    .join('\n');
+}
+
 /** An X25519 key pair in WireGuard's base64, from Node alone: no `wg` tool needed. */
```

**Change** `test/e2e/vpn.e2e.test.ts`:

```diff
diff --git a/test/e2e/vpn.e2e.test.ts b/test/e2e/vpn.e2e.test.ts
index 3a0070e..f1ba880 100644
--- a/test/e2e/vpn.e2e.test.ts
+++ b/test/e2e/vpn.e2e.test.ts
@@ -24,3 +24,9 @@ import {
 } from './helpers';
-import { startWireGuard, TUNNEL, type WireGuardServer } from './wireguard';
+import {
+  envLines,
+  gluetunEnv,
+  startWireGuard,
+  TUNNEL,
+  type WireGuardServer,
+} from './wireguard';
 
@@ -72,11 +78,3 @@ apps:
     env:
-      WIREGUARD_ENDPOINT_IP: ${q(wg.gateway)}
-      WIREGUARD_ENDPOINT_PORT: ${q(wg.endpointPort)}
-      WIREGUARD_PUBLIC_KEY: ${q(wg.serverPublicKey)}
-      HEALTH_TARGET_ADDRESSES: ${q(`${wg.echo}:80`)}
-      HEALTH_ICMP_TARGET_IPS: ${q(wg.echo)}
-      DNS_SERVER: "off"
-      PUBLICIP_ENABLED: "off"
-      VERSION_INFORMATION: "off"
-      FIREWALL_OUTBOUND_SUBNETS: ${q(OUTBOUND.join(','))}
+${envLines({ ...gluetunEnv(wg), FIREWALL_OUTBOUND_SUBNETS: OUTBOUND.join(',') }, '      ')}
 `;
@@ -437,3 +435,6 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
         changed: false,
-        wiring: [{ resource: 'qbittorrent', action: 'unchanged' }],
+        wiring: [
+          { resource: 'qbittorrent.admin', action: 'unchanged' },
+          { resource: 'qbittorrent.preferences', action: 'unchanged' },
+        ],
       });
```

- [ ] **Step 2: The download test**

**Create** `test/e2e/download.e2e.test.ts`:

```ts
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
  type ExecResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  composeDown,
  deployMediaplane,
  expectWiringRemoved,
  makeHome,
  parseRevealed,
  REPO,
  type DeployedMediaplane,
} from './helpers';
import {
  envLines,
  gluetunEnv,
  startWireGuard,
  TUNNEL,
  type WireGuardServer,
} from './wireguard';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-download`;
/** qBittorrent's web UI port, off the default: the download clients must follow it. */
const QBT_PORT = 8090;
/** Verify's detail when it ran vpn-check's checks and found the VPN up. */
const VPN_UP =
  "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up";
/** What the stack wires, in the order apply wires it: qBittorrent before the arrs. */
const WIRED = [
  'qbittorrent.admin',
  'qbittorrent.preferences',
  'qbittorrent.category_tv',
  'qbittorrent.category_movies',
  'radarr.admin',
  'radarr.download_client',
  'radarr.root_folder',
  'sonarr.admin',
  'sonarr.download_client',
  'sonarr.root_folder',
];
/** Each arr: its port, its category, the setting that holds it, and its root folder. */
const ARRS = [
  {
    app: 'sonarr',
    port: 8989,
    category: 'tv',
    setting: 'tvCategory',
    root: '/data/media/tv',
  },
  {
    app: 'radarr',
    port: 7878,
    category: 'movies',
    setting: 'movieCategory',
    root: '/data/media/movies',
  },
] as const;
/** A password that isn't the shared one: what a hand-made change leaves in qBittorrent. */
const OTHER_PASSWORD = 'fake-other-password-1';

const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

/** `mediaplane <args>`, run from source as a user would, for the test's project. */
function mediaplane(...args: string[]): Promise<ExecResult> {
  return nodeExec(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    cwd: REPO,
    env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT },
    timeoutMs: 120_000,
  });
}

/** Sonarr, Radarr, and qBittorrent behind Gluetun on the test's WireGuard server. */
function downloadStack(data: string, wg: WireGuardServer): string {
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${JSON.stringify(data)} }
network: { bind: localhost }
media_server: jellyfin
vpn:
  provider: custom
  private_key: { file: secrets/wg.key }
  addresses: ${JSON.stringify(TUNNEL.client)}
apps:
  sonarr: {}
  radarr: {}
  qbittorrent: { port: ${String(QBT_PORT)} }
  gluetun:
    env:
${envLines(gluetunEnv(wg), '      ')}
`;
}

/** A call to an app's API on its published port, with its key, as JSON. */
async function api(
  port: number,
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: string; type?: string } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...headers,
      ...(init.type === undefined ? {} : { 'Content-Type': init.type }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(60_000),
  });
}

interface Client {
  id: number;
  name: string;
  enable: boolean;
  fields: { name: string; value?: unknown }[];
}

/**
 * What success criterion 1 asks of the download path, read back from each app:
 * - qBittorrent takes the shared login, and keeps a category for each arr, saving under
 *   /data/torrents, with Automatic Torrent Management on;
 * - Sonarr and Radarr each hold "qBittorrent (Mediaplane)", aimed at Gluetun on
 *   qBittorrent's port, and their own test of it passes: through Gluetun's firewall;
 * - their root folders exist under /data/media, which shares one mount with the downloads.
 * Each assertion that could see a key or the password says only whether it passed.
 */
async function expectDownloadPath(home: string): Promise<void> {
  const store = await readSecretStore(home);
  const shown = await mediaplane('credentials', '--home', home, '--json', '--reveal');
  expect(shown.code, shown.stderr).toBe(0);
  const login = parseRevealed(shown.stdout);
  const signIn = await api(
    QBT_PORT,
    '/api/v2/auth/login',
    {},
    {
      method: 'POST',
      body: new URLSearchParams({
        username: login.username,
        password: login.password,
      }).toString(),
      type: 'application/x-www-form-urlencoded',
    },
  );
  expect(signIn.status, 'qBittorrent refused the shared login').toBe(204);
  const bearer = { Authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` };
  const categories = (await (
    await api(QBT_PORT, '/api/v2/torrents/categories', bearer)
  ).json()) as Record<string, { savePath: string }>;
  expect(
    Object.fromEntries(Object.entries(categories).map(([name, c]) => [name, c.savePath])),
  ).toEqual({ movies: '/data/torrents/movies', tv: '/data/torrents/tv' });
  const preferences = (await (
    await api(QBT_PORT, '/api/v2/app/preferences', bearer)
  ).json()) as { save_path: string; auto_tmm_enabled: boolean };
  // Only these two: the preferences hold qBittorrent's key too.
  expect([preferences.save_path, preferences.auto_tmm_enabled]).toEqual([
    '/data/torrents',
    true,
  ]);
  for (const arr of ARRS) {
    const keyed = { 'X-Api-Key': store.apps[arr.app]?.apiKey ?? '' };
    const clients = (await (
      await api(arr.port, '/api/v3/downloadclient', keyed)
    ).json()) as Client[];
    expect(
      clients.map((c) => c.name),
      `${arr.app}'s download clients`,
    ).toEqual(['qBittorrent (Mediaplane)']);
    const [held] = clients;
    if (held === undefined) throw new Error(`${arr.app} has no download client`);
    const value = (name: string) => held.fields.find((f) => f.name === name)?.value;
    expect(
      [held.enable, value('host'), value('port'), value('useSsl'), value(arr.setting)],
      `${arr.app}'s download client`,
    ).toEqual([true, 'gluetun', QBT_PORT, false, arr.category]);
    // The arr's own test: it signs in to qBittorrent with its key, through Gluetun.
    const tested = await api(arr.port, '/api/v3/downloadclient/test', keyed, {
      method: 'POST',
      body: JSON.stringify(held),
      type: 'application/json',
    });
    expect(
      tested.status,
      `${arr.app}'s test of qBittorrent: ${await tested.text()}`,
    ).toBe(200);
    const folders = (await (await api(arr.port, '/api/v3/rootfolder', keyed)).json()) as {
      path: string;
      accessible: boolean;
    }[];
    expect(
      folders.map((f) => [f.path, f.accessible]),
      `${arr.app}'s root folders`,
    ).toEqual([[arr.root, true]]);
    expect(
      (await stat(join(home, 'data', arr.root.slice('/data/'.length)))).isDirectory(),
    ).toBe(true);
  }
  // One mount for downloads and media: an import is a hard link.
  const sources = await Promise.all(
    ['qbittorrent', 'radarr', 'sonarr'].map(async (service) => {
      const inspect = await nodeExec(
        'docker',
        [
          'container',
          'inspect',
          '--format',
          '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}',
          `${PROJECT}-${service}-1`,
        ],
        { cwd: '/' },
      );
      expect(inspect.code, inspect.stderr).toBe(0);
      return inspect.stdout.trim();
    }),
  );
  expect(sources).toEqual([0, 1, 2].map(() => join(home, 'data')));
}

/** Set qBittorrent's preferences by hand, with its key, as its web UI would. */
async function setPreferences(home: string, values: Record<string, unknown>) {
  const store = await readSecretStore(home);
  const set = await api(
    QBT_PORT,
    '/api/v2/app/setPreferences',
    { Authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` },
    {
      method: 'POST',
      body: new URLSearchParams({ json: JSON.stringify(values) }).toString(),
      type: 'application/x-www-form-urlencoded',
    },
  );
  expect(set.status).toBe(200);
}

/**
 * Take Radarr's link apart by hand: its download client and root folder, the folder
 * itself, and qBittorrent's movies category. And change qBittorrent's password.
 */
async function undoRadarr(home: string): Promise<void> {
  const store = await readSecretStore(home);
  const keyed = { 'X-Api-Key': store.apps.radarr?.apiKey ?? '' };
  const clients = (await (
    await api(7878, '/api/v3/downloadclient', keyed)
  ).json()) as Client[];
  const folders = (await (await api(7878, '/api/v3/rootfolder', keyed)).json()) as {
    id: number;
  }[];
  for (const path of [
    ...clients.map((c) => `/api/v3/downloadclient/${String(c.id)}`),
    ...folders.map((f) => `/api/v3/rootfolder/${String(f.id)}`),
  ]) {
    expect((await api(7878, path, keyed, { method: 'DELETE' })).status, path).toBe(200);
  }
  await rm(join(home, 'data', 'media', 'movies'), { recursive: true });
  const removed = await api(
    QBT_PORT,
    '/api/v2/torrents/removeCategories',
    { Authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` },
    {
      method: 'POST',
      body: new URLSearchParams({ categories: 'movies' }).toString(),
      type: 'application/x-www-form-urlencoded',
    },
  );
  expect(removed.status).toBe(200);
  await setPreferences(home, { web_ui_password: OTHER_PASSWORD });
}

interface WireActions {
  outcome: string;
  actions: { step: string; resource?: string; detail?: string }[];
}

/** Each wired resource's detail, in order. */
function wired(actions: WireActions['actions']): string[][] {
  return actions
    .filter((a) => a.resource !== undefined)
    .map((a) => [a.resource ?? '', a.detail ?? '']);
}

describe('the download path, behind the VPN', () => {
  it('links Sonarr and Radarr to qBittorrent through Gluetun, from source and from the image', async () => {
    const home = await makeHome();
    const wg = await startWireGuard(PROJECT);
    let deployed: DeployedMediaplane | undefined;
    /**
     * Every removal, each whether or not the one before it worked; what failed. Each
     * command is bounded by TEARDOWN_MS (120 s): the test's timeout leaves room for them.
     */
    const removeAll = async (): Promise<unknown[]> => {
      const failures: unknown[] = [];
      const attempt = async (removal: () => Promise<unknown>) => {
        try {
          await removal();
        } catch (failure) {
          failures.push(failure);
        }
      };
      await attempt(() => deployed?.remove() ?? Promise.resolve());
      await attempt(async () => {
        const down = await composeDown(PROJECT);
        expect(down.code, down.stderr).toBe(0);
      });
      await attempt(() => expectWiringRemoved(PROJECT));
      await attempt(() => wg.remove());
      return failures;
    };
    try {
      await writeFile(join(home, 'stack.yaml'), downloadStack(join(home, 'data'), wg));
      await mkdir(join(home, 'secrets'), { mode: 0o700 });
      await writeFile(join(home, 'secrets', 'wg.key'), `${wg.clientPrivateKey}\n`, {
        mode: 0o600,
      });
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime: createDockerRuntime({ home, project: PROJECT }),
        probe: nodeProbe,
        project: PROJECT,
        confirm: () => Promise.resolve(true),
      };

      // From source: qBittorrent first, then the arrs, each linked through Gluetun.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      // qBittorrent's login and settings came with its pre-start file: they are adopted.
      expect(wired(first.actions)).toEqual([
        ['qbittorrent.admin', 'adopted'],
        ['qbittorrent.preferences', 'adopted'],
        ['qbittorrent.category_tv', 'created'],
        ['qbittorrent.category_movies', 'created'],
        ['radarr.admin', 'created'],
        ['radarr.download_client', 'created'],
        ['radarr.root_folder', 'created'],
        ['sonarr.admin', 'created'],
        ['sonarr.download_client', 'created'],
        ['sonarr.root_folder', 'created'],
      ]);
      // Verify tested both download clients through Gluetun, and ran vpn-check's checks.
      expect(first.actions.find((a) => a.step === 'verify')?.detail).toBe(VPN_UP);
      await expectDownloadPath(home);

      // qBittorrent takes the shared password through its API: changed by hand, it comes
      // back, and nothing else changes.
      await setPreferences(home, { web_ui_password: OTHER_PASSWORD });
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'qbittorrent.admin', action: 'update', changes: ['password'] },
      ]);
      expect(restored.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
      await expectDownloadPath(home);
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // From the image, behind the socket proxy. Radarr's link, taken apart by hand, is made
      // again through the proxy: its folder in a throwaway Radarr container, its root folder
      // and download client, qBittorrent's category, and the password. Where the host's
      // Compose isn't the image's (CI's is 2.38), it also recreates the apps with bind
      // volumes: the two hash them differently (ADR 0010).
      deployed = await deployMediaplane({ home, stack: PROJECT });
      await undoRadarr(home);
      const inImage = await deployed.mediaplane(['apply', '--yes', '--json']);
      expect(inImage.code, inImage.stdout + inImage.stderr).toBe(0);
      const appliedInImage = JSON.parse(inImage.stdout) as WireActions;
      expect(appliedInImage.outcome).toBe('success');
      expect(wired(appliedInImage.actions)).toEqual([
        ['qbittorrent.admin', 'updated password'],
        ['qbittorrent.preferences', 'unchanged'],
        ['qbittorrent.category_tv', 'unchanged'],
        ['qbittorrent.category_movies', 'created'],
        ['radarr.admin', 'unchanged'],
        ['radarr.download_client', 'created'],
        ['radarr.root_folder', 'created'],
        ['sonarr.admin', 'unchanged'],
        ['sonarr.download_client', 'unchanged'],
        ['sonarr.root_folder', 'unchanged'],
      ]);
      expect(appliedInImage.actions.find((a) => a.step === 'verify')?.detail).toBe(
        VPN_UP,
      );
      await expectDownloadPath(home);
      // The image's plan, and its second apply, find nothing to change.
      const planned = await deployed.mediaplane(['plan', '--json']);
      expect(planned.code, planned.stdout + planned.stderr).toBe(0);
      expect(JSON.parse(planned.stdout)).toMatchObject({
        changed: false,
        wiring: WIRED.map((resource) => ({ resource, action: 'unchanged' })),
      });
      const second = await deployed.mediaplane(['apply', '--yes', '--json']);
      expect(second.code, second.stdout + second.stderr).toBe(0);
      expect(JSON.parse(second.stdout)).toMatchObject({ outcome: 'no-changes' });
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is only logged.
      for (const removal of await removeAll())
        console.error('teardown failed too:', removal);
      throw failure;
    }
    const failures = await removeAll();
    if (failures.length > 0) throw new AggregateError(failures, 'teardown failed');
  }, 1_800_000);
});
```

- [ ] **Step 3: The apply and deploy tests' lists**

**Change** `test/e2e/apply.e2e.test.ts`:

```diff
diff --git a/test/e2e/apply.e2e.test.ts b/test/e2e/apply.e2e.test.ts
index ffb1b88..d1f32d4 100644
--- a/test/e2e/apply.e2e.test.ts
+++ b/test/e2e/apply.e2e.test.ts
@@ -41,4 +41,19 @@ function mediaplane(...args: string[]): Promise<ExecResult> {
 
-/** What the video stack wires, in the order apply wires it (Prowlarr after the arrs). */
-const WIRED = ['radarr.admin', 'sonarr.admin', 'prowlarr.admin', 'qbittorrent'];
+/**
+ * What the video stack wires, in the order apply wires it: qBittorrent, then the arrs,
+ * then Prowlarr.
+ */
+const WIRED = [
+  'qbittorrent.admin',
+  'qbittorrent.preferences',
+  'qbittorrent.category_tv',
+  'qbittorrent.category_movies',
+  'radarr.admin',
+  'radarr.download_client',
+  'radarr.root_folder',
+  'sonarr.admin',
+  'sonarr.download_client',
+  'sonarr.root_folder',
+  'prowlarr.admin',
+];
 
@@ -249,4 +264,12 @@ describe('apply against real Docker', () => {
       ).toEqual([
+        ['qbittorrent.admin', 'adopted'],
+        ['qbittorrent.preferences', 'adopted'],
+        ['qbittorrent.category_tv', 'created'],
+        ['qbittorrent.category_movies', 'created'],
         ['radarr.admin', 'created'],
+        ['radarr.download_client', 'created'],
+        ['radarr.root_folder', 'created'],
         ['sonarr.admin', 'created'],
+        ['sonarr.download_client', 'created'],
+        ['sonarr.root_folder', 'created'],
         ['prowlarr.admin', 'created'],
@@ -258,7 +281,5 @@ describe('apply against real Docker', () => {
       const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
-      expect(Object.keys((JSON.parse(resources) as Resources).resources)).toEqual([
-        'prowlarr.admin',
-        'radarr.admin',
-        'sonarr.admin',
-      ]);
+      expect(Object.keys((JSON.parse(resources) as Resources).resources)).toEqual(
+        [...WIRED].sort(),
+      );
       expect(
@@ -267,2 +288,6 @@ describe('apply against real Docker', () => {
       ).toBe(false);
+      expect(
+        resources.includes(store.apps.qbittorrent?.apiKey ?? 'no key'),
+        "resources.json holds qBittorrent's key",
+      ).toBe(false);
       // Lost state: apply adopts what the apps hold, by name, and changes none of it.
@@ -271,7 +296,5 @@ describe('apply against real Docker', () => {
       expect(adopted.outcome).toBe('success');
-      expect(adopted.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
-        { resource: 'radarr.admin', action: 'adopt' },
-        { resource: 'sonarr.admin', action: 'adopt' },
-        { resource: 'prowlarr.admin', action: 'adopt' },
-      ]);
+      expect(adopted.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual(
+        WIRED.map((resource) => ({ resource, action: 'adopt' })),
+      );
       expect(adopted.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
```

**Change** `test/e2e/deploy.e2e.test.ts`:

```diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index 89fbc73..b099bbf 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -357,3 +357,5 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     // the shared login in Sonarr, and checked qBittorrent's key there. Its container is
-    // on two networks, both internal, so it still has no route out.
+    // on two networks, both internal, so it still has no route out. Slice 3c: it linked
+    // Sonarr to qBittorrent, and made Sonarr's root folder in a throwaway Sonarr
+    // container, through the proxy.
     expect(
@@ -364,3 +366,11 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
         .map((a) => [a.resource, a.detail]),
-    ).toEqual([['sonarr.admin', 'created']]);
+    ).toEqual([
+      ['qbittorrent.admin', 'adopted'],
+      ['qbittorrent.preferences', 'adopted'],
+      ['qbittorrent.category_tv', 'created'],
+      ['sonarr.admin', 'created'],
+      ['sonarr.download_client', 'created'],
+      ['sonarr.root_folder', 'created'],
+    ]);
+    expect((await stat(join(data, 'media', 'tv'))).isDirectory()).toBe(true);
     const shown = await mediaplane('credentials', '--json', '--reveal');
```

- [ ] **Step 4: Run the end-to-end tests with both Composes**

The WireGuard module must be loaded (`test -d /sys/module/wireguard || sudo modprobe
wireguard`). First with the host's Compose (5.5.1 on the dev box):

```bash
docker compose version
pnpm test:e2e
```

Expected: PASS, 6 files. Then with Compose v2.38.2, CI's, as the host plugin: put its
binary (from the `docker/compose` v2.38.2 release for this architecture, checked against
its `.sha256`) at `<dir>/cli-plugins/docker-compose`, and run with `DOCKER_CONFIG=<dir>`:

```bash
DOCKER_CONFIG=<dir> docker compose version
DOCKER_CONFIG=<dir> pnpm test:e2e
```

Expected: `Docker Compose version v2.38.2`, then PASS, 6 files. Afterwards:

```bash
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e --format '{{.Name}}'
docker images --filter reference='mediaplane-e2e*' --format '{{.Repository}}:{{.Tag}}'
```

Expected: each prints nothing.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): the download path behind the VPN, from source and from the image" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs: the runbook, the architecture, the threat model, the READMEs, the spec, the roadmap

The §9 documentation set for what Tasks 1 to 6 built and tested, and nothing more. Every
diagram is a `text` block of at most 40 columns.

Decision: the wiring-failed runbook adds what S3c can say: a skipped download client and
its example, verify's failure for a download client, `wire.folders`, and four fixes
(qBittorrent's ban, an arr that can't reach qBittorrent, a root folder's folder that
can't be made, a client name taken). The example lines follow the format the CLI's tests
check.
Decision: the architecture adds the download path (a diagram and three points), the data
folder's layout, and secrets checked by the app's own test; "Not built yet" and "What
comes next" move on to Slices 5 to 7.
Decision: the threat model covers Slice 3c: qBittorrent's key held by the arrs (an asset,
T4 and T5), the admin password and qBittorrent's preferences in request bodies only, the
folder helper's command line (T5), qBittorrent's login kept through its API (T2), and the
ban in place of "until Slice 3c" (T10).
Decision: the README's status, capabilities, flow and questions say what works now; its
example's wiring lines are a real run of the same stack with this slice (the last
`wire` line trimmed, as marked).
Decision: the app READMEs and the deploy guide lose their "until Slice 3c" notes and say
what `apply` manages now; Gluetun's says how the arrs reach qBittorrent through it.
Decision: the spec gains a "Slice 3c" entry in §11, which records that §6.2's managed
fields for qBittorrent now include Automatic Torrent Management and the whitelist. The
roadmap marks S3c done, records the verified Gluetun path, and adds three S4 items: a
root folder whose path changes, qBittorrent's ban with drift checked on a schedule, and
Keep mine for what Mediaplane now puts back in qBittorrent.

**Files:**
- Modify: `docs/runbooks/wiring-failed.md`, `docs/architecture.md`,
  `docs/security/threat-model.md`, `README.md`, `catalog/qbittorrent/README.md`,
  `catalog/sonarr/README.md`, `catalog/radarr/README.md`, `catalog/gluetun/README.md`,
  `deploy/README.md`, `docs/design/m1-engine-cli.md`, `docs/plans/m1-roadmap.md`

**Interfaces:**
- **Consumes:** what Tasks 1 to 6 built, as their tests show it.
- **Produces:** nothing for other tasks.

- [ ] **Step 1: The runbook**

**Change** `docs/runbooks/wiring-failed.md`:

````diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 784311e..5284ca0 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -3,4 +3,6 @@
 Wiring is what `apply` does through each app's API once the apps run: today, the shared
-admin login in Sonarr, Radarr and Prowlarr, and a check that Mediaplane's key still
-opens qBittorrent. Later slices add the links between the apps.
+admin login in Sonarr, Radarr, Prowlarr and qBittorrent, qBittorrent's settings and its
+`tv` and `movies` categories, and in Sonarr and Radarr, qBittorrent as their download
+client and their root folders. Later slices add the indexers, the media server and the
+requests app.
 
@@ -24,5 +26,11 @@ opens qBittorrent. Later slices add the links between the apps.
 
-  An app that has no resources of its own, such as qBittorrent, fails as the app: for
-  example `failed  wiring qbittorrent: …`. Later slices add resources that need others.
-  One that needs a failed resource is `skipped`, and the others still run.
+  A resource that needs a failed one is `skipped`, and the others still run. Sonarr's
+  download client needs qBittorrent's `tv` category, and Radarr's its `movies` one. When
+  qBittorrent refuses Mediaplane's key, each of its resources fails, and the download
+  clients are skipped (trimmed):
+
+  ```console
+    failed  wiring qbittorrent.category_tv: qBittorrent at http://gluetun:8080 (172.20.0.4) refused Mediaplane's API key (HTTP 403) … (GET /api/v2/app/version)
+    skipped wiring sonarr.download_client: qbittorrent.category_tv failed
+  ```
 
@@ -41,3 +49,5 @@ opens qBittorrent. Later slices add the links between the apps.
 - **`apply` fails at verify** with `changes remain after apply: sonarr.admin (update)`:
-  the app took the change, then kept something else.
+  the app took the change, then kept something else. For a download client, verify runs
+  the arr's own test of it: a failure there is `sonarr.download_client (unknown: …)`,
+  with the arr's own words after `tested qBittorrent (Mediaplane), and it failed:`.
 - **`apply` stops at the containers step** with `could not leave the wiring network …`,
@@ -62,2 +72,3 @@ In `--json` output, each `diagnostics` entry has a `code`:
 - `wire.secret-field`: a managed field holds one of the stack's secrets.
+- `wire.folders`: a folder a resource needs, such as a root folder, couldn't be made.
 - `wire.network`: Mediaplane won't join the wiring network, or Docker refused the join.
@@ -100,2 +111,28 @@ differ, and a `reason` when it is `unknown`.
   - Slice 4 restores a key at its source for you.
+- **qBittorrent's `banned after too many failed authentication attempts`** (HTTP 403,
+  `wire.auth`). qBittorrent stops an address from signing in for an hour after five
+  failed sign-ins in a row. Mediaplane checks qBittorrent's password by
+  signing in, so this happens when `admin.password` changed and `plan` ran five times
+  before `apply`. Its key still works, and only Mediaplane's address is banned, not your
+  browser's. Wait an hour, or restart qBittorrent, which forgets the ban
+  (`docker restart mediaplane-qbittorrent-1`), then run `apply`, which sets the new
+  password.
+- **`tested qBittorrent (Mediaplane), and it failed`, with
+  `Host: Unable to connect to qBittorrent`.** Sonarr or Radarr can't reach qBittorrent.
+  Behind the VPN they reach it through Gluetun, as `gluetun`, at qBittorrent's port:
+  check that both run and are healthy (`mediaplane status`), and that the VPN is up
+  (`mediaplane vpn-check`). A `compose.override.yaml` that takes Sonarr, Radarr or
+  Gluetun off the stack's network breaks it too. Fix that, then run `apply` again. A
+  failure that names `ApiKey` is never this one: Mediaplane puts qBittorrent's key back
+  itself.
+- **`could not make /data/media/tv for sonarr.root_folder`** (`wire.folders`). Sonarr and
+  Radarr need their root folder to exist, so Mediaplane makes it first, as the stack's
+  `user:`, in a throwaway container of the app. mkdir's own message follows. Usually the
+  folder that holds it, such as `media/` in the data folder, belongs to another user:
+  give it to the stack's user, such as
+  `sudo chown <uid>:<gid> /srv/data/media` with the ids of `user:` in `stack.yaml`, then
+  run `apply` again.
+- **`refused the request (HTTP 400): Name: Should be unique`.** Sonarr or Radarr already
+  has a download client called `qBittorrent (Mediaplane)` that isn't a qBittorrent one.
+  Rename or remove it in the app's web UI, then run `apply` again.
 - **`could not be reached`, `cut the connection` or `did not answer within … s`.** The
````

- [ ] **Step 2: The architecture and the threat model**

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 2f24eaf..9475846 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -127,3 +127,4 @@ Not built yet:
 
-- the links between the apps, through their APIs (Slices 3c to 7);
+- the rest of the links between the apps: the indexers (Slice 5), the media server
+  (Slice 6) and the requests app (Slice 7);
 - drift detection, with Keep mine (Slice 4).
@@ -282,3 +283,5 @@ inside it, on one filesystem, so moving a finished download into the library is
 instant hardlink. `plan` checks that `torrents/`, `usenet/` and `media/`, where they
-exist, are on the same filesystem as the folder itself.
+exist, are on the same filesystem as the folder itself. qBittorrent saves into
+`/data/torrents`, a folder per category, and Sonarr's and Radarr's libraries are
+`/data/media/tv` and `/data/media/movies`, which `apply` makes.
 
@@ -287,4 +290,5 @@ exist, are on the same filesystem as the folder itself.
 Wiring is what Mediaplane does through each app's API once the apps run. Today that is
-the shared admin login in Sonarr, Radarr and Prowlarr, and a check that Mediaplane's key
-still opens qBittorrent.
+the shared admin login in Sonarr, Radarr, Prowlarr and qBittorrent, and the download
+path: qBittorrent's settings and categories, and Sonarr's and Radarr's download client
+and root folder.
 
@@ -321,5 +325,31 @@ mediaplane (the stack)
   create or change it. The app's README lists them.
+- **The download path:**
+
+  ```text
+  sonarr, radarr
+    │ download client
+    │ qBittorrent (Mediaplane):
+    │ gluetun:<qBittorrent's
+    │ port>, its key, category
+    ▼
+  gluetun ─ qbittorrent
+    categories tv, movies:
+    /data/torrents/<category>
+  ```
+
+  - qBittorrent comes first: its login, its settings (the save path `/data/torrents`,
+    Automatic Torrent Management on, and who may skip the login) and a category for each
+    arr in the stack.
+  - Sonarr and Radarr come after it. Each gets `qBittorrent (Mediaplane)` as its download
+    client, which needs qBittorrent's category for it: one that failed skips the
+    client. They reach qBittorrent the way they reach any app: behind the VPN, as
+    `gluetun`, whose network qBittorrent shares, at qBittorrent's own port.
+  - Each arr's root folder, `/data/media/tv` or `/data/media/movies`, is made first in a
+    throwaway container of the arr, as the stack's `user:`, then added to the arr.
+
 - **Each resource** is one of:
   - `create` or `update`: the app lacks it, or a managed field or a secret differs. A
-    secret is checked by using it, such as signing in, never compared.
+    secret is checked by using it, never compared: signing in, or the app's own test, as
+    Sonarr's test of its download client. While a field differs, the secrets aren't
+    checked: the update sets them anyway.
   - `adopt`: the app already holds it as wanted, but `state/resources.json` doesn't say
@@ -401,3 +431,3 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- the wiring, app by app (Slices 3c to 7);
+- the rest of the wiring, app by app (Slices 5 to 7);
 - drift detection (Slice 4);
````

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 87643f1..fd193e8 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -3,3 +3,3 @@
 This is the threat model for Mediaplane as built today: M1, up to and including Slice 3a,
-and Slices 3d and 3b.
+and Slices 3d, 3b and 3c.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -18,2 +18,3 @@ that power. None of them removes it.
 | Generated API keys                           | `state/secrets.json`, `generated/.env` (both 0600) and `appdata/`     | They open the apps' APIs                                   |
+| qBittorrent's key, in Sonarr and Radarr      | Their download client's settings, in `appdata/`                       | It opens qBittorrent's API                                 |
 | The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr and Prowlarr          |
@@ -145,3 +146,4 @@ Controls today:
   the login into `qBittorrent.conf` before qBittorrent runs, so the image never starts
-  with its temporary password. It asks on localhost too.
+  with its temporary password. It asks on localhost too. After that, `apply` keeps its
+  login, and who may skip it, as `stack.yaml` says, through its API.
 - Sonarr, Radarr and Prowlarr ask for the shared admin login, which `apply` sets through
@@ -212,2 +214,4 @@ What remains:
   setting that looks right but isn't.
+- Sonarr and Radarr hold qBittorrent's key, as their download client needs, so a
+  compromised one can drive qBittorrent: add a torrent, or change its settings.
 - The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
@@ -235,2 +239,11 @@ Controls today:
   with `***`, and never includes what was sent: a request body is never shown or kept.
+- qBittorrent's key goes to Sonarr and Radarr in their download client's settings, a
+  request body: the one place one app's key goes to another. They show it masked
+  (`********`) afterwards, and Mediaplane tests the masked client, so the key isn't sent
+  again for the check.
+- The admin password goes to qBittorrent only in request bodies: its preferences, sent
+  with its key, and the sign-in that checks it. The session cookie qBittorrent answers
+  with is dropped. Its preferences hold its own key too: Mediaplane keeps only the
+  fields it manages, and never shows them.
+- The folders a root folder needs are made with a command that holds only their paths.
 - Given to Compose in its environment or in the 0600 `generated/.env`, never on its
@@ -334,7 +347,8 @@ What remains:
   key. Prowlarr holds Sonarr's and Radarr's keys from Slice 5.
-- Changing `admin.username`, `admin.password`, `login_on_lan`, `network.bind` or
-  `network.lan_subnet` after qBittorrent's first start doesn't reach qBittorrent, whose
-  file is written only once. `mediaplane credentials` shows the new login all the same.
-  Change it in qBittorrent's web UI too, until Slice 3c manages those settings through
-  its API.
+- `apply` checks qBittorrent's password by signing in. qBittorrent bans an address from
+  signing in for an hour after five failed sign-ins in a row. Mediaplane's sign-in fails
+  only while qBittorrent's password differs from the stack's, such as after
+  `admin.password` changed, so running `plan` five times before `apply` bans
+  Mediaplane's address, never your browser's. Its key still works. The
+  [runbook](../runbooks/wiring-failed.md) says what to do.
 - There is no way yet to rotate the generated password (Slice 4).
```

- [ ] **Step 3: The README, the app READMEs and the deploy guide**

**Change** `README.md`:

```diff
diff --git a/README.md b/README.md
index 3cf4ec0..b432042 100644
--- a/README.md
+++ b/README.md
@@ -13,3 +13,4 @@ Compose and wires the apps together for you.**
 >   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr and Prowlarr
->   (`mediaplane credentials` shows it). `mediaplane vpn-check` confirms that
+>   (`mediaplane credentials` shows it). It links Sonarr and Radarr to qBittorrent:
+>   download clients, categories and root folders. `mediaplane vpn-check` confirms that
 >   qBittorrent reaches the internet only through the VPN. Mediaplane runs in its own
@@ -17,5 +18,6 @@ Compose and wires the apps together for you.**
 >   private network with no route out.
-> - **Next:** wiring the apps to each other. Until that lands, each app still needs
->   setting up by hand. Jellyfin's wizard and Seerr's setup are open to anyone who
->   can reach them until you complete them, so complete them first.
+> - **Next:** the rest of the wiring: Prowlarr's indexers, the media server and Seerr.
+>   Until that lands, those still need setting up by hand. Jellyfin's wizard and Seerr's
+>   setup are open to anyone who can reach them until you complete them, so complete
+>   them first.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -60,3 +62,4 @@ Mediaplane does that part for you:
 | Documentation generated from code: the `stack.yaml` and CLI references, app facts | Done         |
-| Wire the apps together (download clients, indexers, root folders, media server)   | Planned      |
+| Link Sonarr and Radarr to qBittorrent: download clients, categories, root folders | Done         |
+| Wire the rest together (indexers, media server, requests)                         | Planned      |
 | Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
@@ -123,3 +126,4 @@ mediaplane apply
   ├─ wires the apps through their
-  │  APIs (the shared login, so far)
+  │  APIs: the shared login, and
+  │  the download path, so far
   ├─ plans again: nothing left to do
@@ -128,3 +132,3 @@ mediaplane apply
 
-Next, `apply` will wire the apps to each other through the same APIs (Slices 3c to 7).
+Next, `apply` will wire the rest of the apps through the same APIs (Slices 5 to 7).
 
@@ -151,4 +155,3 @@ A few principles hold throughout:
 Most of this is real output from a run on an arm64 VM, trimmed where marked. The wiring
-lines came later, with Slice 3b. `plan`'s are from a fresh plan of the same stack.
-`apply`'s are not a capture: they follow the format the CLI's tests check. The stack is
+lines came later, from a run of the same stack with Slice 3c. The stack is
 the example above without the VPN, which is why `plan` warns about qBittorrent, and with
@@ -183,7 +186,14 @@ Secrets to generate: admin.password, prowlarr.apiKey, qbittorrent.apiKey, radarr
 Wiring:
+  > after start qbittorrent.admin
+  > after start qbittorrent.preferences
+  > after start qbittorrent.category_tv
+  > after start qbittorrent.category_movies
   > after start radarr.admin
+  > after start radarr.download_client
+  > after start radarr.root_folder
   > after start sonarr.admin
+  > after start sonarr.download_client
+  > after start sonarr.root_folder
   > after start prowlarr.admin
-  > after start qbittorrent
-Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 4 wiring checks after the start.
+Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 11 wiring checks after the start.
 
@@ -199,9 +209,17 @@ Starting containers and waiting until every app is healthy…
 Wiring the apps…
+  done    wiring qbittorrent.admin: adopted
+  done    wiring qbittorrent.preferences: adopted
+  done    wiring qbittorrent.category_tv: created
+  done    wiring qbittorrent.category_movies: created
   done    wiring radarr.admin: created
+  done    wiring radarr.download_client: created
+  done    wiring radarr.root_folder: created
   done    wiring sonarr.admin: created
+  done    wiring sonarr.download_client: created
+  done    wiring sonarr.root_folder: created
   done    wiring prowlarr.admin: created
-  done    wiring: radarr.admin created; sonarr.admin created; prowlarr.admin created
+  done    wiring: qbittorrent.admin adopted; qbittorrent.preferences adopted; … prowlarr.admin created
   done    verify: no changes remain
 
-Apply complete. Change record: 20261010T031836Z-17560c95
+Apply complete. Change record: 20261011T081852Z-a523d923
 
@@ -257,4 +275,5 @@ Then follow [`deploy/README.md`](deploy/README.md) to start it and run
 - the secrets it would generate;
-- the wiring it would do in the apps, under `Wiring:`, such as setting the admin login.
-  An app that Mediaplane only checks, such as qBittorrent, is listed by its name.
+- the wiring it would do in the apps, under `Wiring:`, such as setting the admin login or
+  adding a download client. qBittorrent's login and settings show as `adopt` on a first
+  `apply`: its file from before its first start set them already.
 
@@ -341,4 +360,5 @@ So Mediaplane isn't instead of a pipeline. It is built to run inside one:
 The pipeline decides what the stack is, and Mediaplane does the stateful part. Today
-that covers generating the keys, deploying, setting the shared login in the apps, and
-checking. The app-to-app wiring and change detection are what is being built next.
+that covers generating the keys, deploying, setting the shared login in the apps,
+linking Sonarr and Radarr to qBittorrent, and checking. The rest of the wiring and
+change detection are what is being built next.
 
@@ -356,3 +376,4 @@ and keep. What it adds is everything around the file:
 - keys that are generated once and kept;
-- next, the wiring between the apps.
+- Sonarr and Radarr linked to qBittorrent, with its categories and their root folders;
+- next, the rest of the wiring between the apps.
 
@@ -362,6 +383,7 @@ Those tools configure apps you already run, and they are good at detailed tuning
 as quality profiles. Mediaplane deploys the whole stack and makes it safe: generated
-secrets, a socket proxy, a tested VPN kill switch, and a private wiring network. It will
-wire the apps to each other (Slices 3c to 7), with `plan` and `apply` and a history of
-what it did, and leave the rest of each app's settings to you. Today it sets the shared
-login in Sonarr, Radarr and Prowlarr.
+secrets, a socket proxy, a tested VPN kill switch, and a private wiring network. It wires
+the apps to each other, with `plan` and `apply` and a history of what it did, and leaves
+the rest of each app's settings to you. Today it sets the shared login, and links Sonarr
+and Radarr to qBittorrent; the indexers, the media server and Seerr come in Slices 5
+to 7.
 
@@ -412,5 +434,5 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   (packaging), S3a (the shared admin and pre-start files), S3d (the VPN's kill-switch
-  test and `vpn-check`) and S3b (the wiring framework).
-- **Next:** S3c (the download path).
-- **After that:** S4 to S8.
+  test and `vpn-check`), S3b (the wiring framework) and S3c (the download path).
+- **Next:** S4 (drift).
+- **After that:** S5 to S8.
 
@@ -436,3 +458,3 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **[Runbook: wiring failed](docs/runbooks/wiring-failed.md):** an app refused Mediaplane's
-  key or a change, or Mediaplane can't reach it.
+  key or a change, an arr can't reach qBittorrent, or Mediaplane can't reach an app.
 - **[Threat model](docs/security/threat-model.md):** what is protected, how, and what
```

**Change** `catalog/qbittorrent/README.md`:

```diff
diff --git a/catalog/qbittorrent/README.md b/catalog/qbittorrent/README.md
index 5345ea9..2275876 100644
--- a/catalog/qbittorrent/README.md
+++ b/catalog/qbittorrent/README.md
@@ -44,3 +44,19 @@ unmodified, and by default puts it behind Gluetun's VPN.
   through Gluetun, which is on the stack's wiring network for it, at qBittorrent's own
-  port. Slice 3c manages its settings through that API.
+  port. Through that API, once qBittorrent runs, `apply` manages:
+  - **the shared admin login** (`qbittorrent.admin`): its user name, and its password,
+    checked by signing in, and set with the key when it differs. So a change of
+    `admin.username` or `admin.password` reaches qBittorrent, with no restart;
+  - **its settings** (`qbittorrent.preferences`): the default save path
+    `/data/torrents`, Automatic Torrent Management on, and who may skip the login: your
+    LAN subnets, only with `security.login_on_lan: false` and the web UI published on
+    your LAN, as the file below sets them;
+  - **a category for each arr in the stack** (`qbittorrent.category_tv` with Sonarr,
+    `qbittorrent.category_movies` with Radarr), saving to `/data/torrents/tv` and
+    `/data/torrents/movies`. With Automatic Torrent Management, a torrent goes to its
+    category's folder.
+- **Sonarr's and Radarr's download client.** Sonarr and Radarr reach qBittorrent as
+  `gluetun` behind the VPN (`qbittorrent` without it), at qBittorrent's own port, with
+  its key. Gluetun counts the stack's networks as local, so its firewall lets them in:
+  the end-to-end test runs their own test of it. See
+  [Sonarr's README](../sonarr/README.md).
 - **One port, inside and out.** qBittorrent checks the `Host` header, so the published
@@ -53,3 +69,3 @@ unmodified, and by default puts it behind Gluetun's VPN.
   - **its API key** (`WebUI\APIKey`), generated once and kept in `state/secrets.json`.
-    Sonarr and Radarr use it from Slice 3c;
+    Sonarr and Radarr use it too;
   - **the save path** `/data/torrents/`;
@@ -65,4 +81,5 @@ unmodified, and by default puts it behind Gluetun's VPN.
   qBittorrent keeps these and adds its own settings, and starts with no temporary
-  password. Mediaplane never changes the file after that: from then on, change settings
-  in qBittorrent's web UI.
+  password. Mediaplane never changes the file after that: from then on, it manages the
+  login and the settings above through qBittorrent's API, and the rest are yours to
+  change in qBittorrent's web UI.
 
@@ -70,6 +87,5 @@ unmodified, and by default puts it behind Gluetun's VPN.
 
-- **Slice 3c:** the `tv` and `movies` categories, with save paths under
-  `/data/torrents/`, and the settings above managed through qBittorrent's API.
-
-See the [roadmap](../../docs/plans/m1-roadmap.md).
+Nothing for qBittorrent itself. Keeping a setting of your own in place of one Mediaplane
+manages ("Keep mine") comes in Slice 4. See the
+[roadmap](../../docs/plans/m1-roadmap.md).
 
@@ -90,17 +106,14 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   see [Gluetun's README](../gluetun/README.md).
-- **`stack.yaml` reaches qBittorrent only at its first start.** Mediaplane never
-  rewrites `qBittorrent.conf`, so changing any of these afterwards doesn't change
-  qBittorrent: `admin.username`, `admin.password`, `security.login_on_lan`,
-  `network.bind` or `network.lan_subnet`.
-  - `mediaplane credentials` shows the new login all the same, so it and qBittorrent's
-    differ. Change the login in qBittorrent's web UI too, under Tools, Options, Web UI.
-  - The same goes for who may skip the login. After changing `security.login_on_lan`,
-    `network.bind` or `network.lan_subnet`, set "Bypass authentication for clients in
-    whitelisted IP subnets" there too. Mediaplane fills it with your LAN subnet only
-    while `login_on_lan` is `false` and the web UIs are on your LAN.
-  - Switching between a password of your own and the generated one is such a change too.
-    Removing `admin.password` brings back the password Mediaplane generated before, if
-    it generated one: it keeps it, and never generates another.
-  - From Slice 3c, `apply` manages these settings through qBittorrent's API, so a change
-    reaches it.
+- **A change made in qBittorrent's web UI to what Mediaplane manages is undone** by the
+  next `apply`: the login, the save path, Automatic Torrent Management, who may skip the
+  login, and the two categories' save paths. `plan` shows it first. Slice 4 adds "Keep
+  mine".
+- **Five failed sign-ins in a row ban an address for an hour.** Mediaplane checks the
+  password by signing in, so after you change `admin.password`, run `apply` soon: five
+  `plan`s before it ban Mediaplane's address (never your browser's), and `plan` then
+  says so. Restarting qBittorrent lifts the ban. See the
+  [wiring failed runbook](../../docs/runbooks/wiring-failed.md).
+- **Removing `admin.password`** brings back the password Mediaplane generated before, if
+  it generated one: it keeps it, and never generates another. `apply` then sets it in
+  qBittorrent.
 - **Set up before Slice 3a.** If qBittorrent first started before Mediaplane wrote its
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 311e71d..f60a604 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -52,2 +52,16 @@ LinuxServer.io image, unmodified.
   `qbittorrent` too, or `plan` reports an error.
+- **qBittorrent as its download client** (`sonarr.download_client`). Once qBittorrent's
+  `tv` category is in place, `apply` adds `qBittorrent (Mediaplane)` to Sonarr:
+  - its host is `gluetun` behind the VPN, whose network qBittorrent shares, or
+    `qbittorrent` without it, and its port is qBittorrent's own;
+  - it files downloads under the `tv` category (`tvCategory`), which saves to
+    `/data/torrents/tv`;
+  - its key is qBittorrent's, which Sonarr shows masked. `plan` and `apply` check it
+    with Sonarr's own test of the client: a refused key is set again, and any other
+    failure is Sonarr's own message, such as qBittorrent out of its reach;
+  - its other settings, such as its priority, are yours: `apply` leaves them as they
+    are.
+- **Its root folder** (`sonarr.root_folder`), `/data/media/tv`. `apply` makes the
+  folder first, as the stack's `user:`, in a throwaway Sonarr container, then adds it to
+  Sonarr. It is in the data folder, with the downloads, so an import is a hard link.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -57,6 +71,4 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 3c to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 5 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 3c:** qBittorrent as its download client, and the `/data/media/tv` root
-  folder.
 - **Slice 5:** Prowlarr's link to it.
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 65532d9..04c428b 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -52,2 +52,16 @@ LinuxServer.io image, unmodified.
   `qbittorrent` too, or `plan` reports an error.
+- **qBittorrent as its download client** (`radarr.download_client`). Once qBittorrent's
+  `movies` category is in place, `apply` adds `qBittorrent (Mediaplane)` to Radarr:
+  - its host is `gluetun` behind the VPN, whose network qBittorrent shares, or
+    `qbittorrent` without it, and its port is qBittorrent's own;
+  - it files downloads under the `movies` category (`movieCategory`), which saves to
+    `/data/torrents/movies`;
+  - its key is qBittorrent's, which Radarr shows masked. `plan` and `apply` check it
+    with Radarr's own test of the client: a refused key is set again, and any other
+    failure is Radarr's own message, such as qBittorrent out of its reach;
+  - its other settings, such as its priority, are yours: `apply` leaves them as they
+    are.
+- **Its root folder** (`radarr.root_folder`), `/data/media/movies`. `apply` makes the
+  folder first, as the stack's `user:`, in a throwaway Radarr container, then adds it to
+  Radarr. It is in the data folder, with the downloads, so an import is a hard link.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -57,6 +71,4 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 3c to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 5 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 3c:** qBittorrent as its download client, and the `/data/media/movies` root
-  folder.
 - **Slice 5:** Prowlarr's link to it.
```

**Change** `catalog/gluetun/README.md`:

```diff
diff --git a/catalog/gluetun/README.md b/catalog/gluetun/README.md
index 420b223..44585d5 100644
--- a/catalog/gluetun/README.md
+++ b/catalog/gluetun/README.md
@@ -43,2 +43,6 @@ upstream image, unmodified. It is turned on whenever qBittorrent runs behind the
   reports an error when `/dev/net/tun` is missing.
+- **The way in to qBittorrent.** Gluetun is on the stack's wiring network for
+  qBittorrent, whose network it shares. Mediaplane reaches qBittorrent's API through it,
+  and Sonarr and Radarr reach qBittorrent as `gluetun`, at qBittorrent's port: Gluetun
+  counts the stack's networks as local, so its firewall lets them in.
 - **Its control server** (port 8000) is never published. Apps in its network must not
```

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index f82ca43..81a65d0 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -13,6 +13,7 @@ never touch Mediaplane itself.
 
-> Mediaplane is pre-alpha. The apps are not wired to each other yet (Slices 3c to 7 do
-> that). On a home network, `init` suggests publishing their web UIs on your LAN. Until
-> the wiring lands, Jellyfin's setup wizard and Seerr's setup are open to anyone on your
-> LAN until you complete them, so complete them first.
+> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent, but the rest of
+> the apps are not wired to each other yet (Slices 5 to 7 do that). On a home network,
+> `init` suggests publishing their web UIs on your LAN. Until the wiring lands,
+> Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
+> complete them, so complete them first.
 >
@@ -150,9 +151,5 @@ nothing. Without a terminal it asks nothing: pass the flags in the
   password of your own only with `--reveal`, and its `--json` output leaves out either
-  unless you add `--reveal`. qBittorrent, Sonarr, Radarr and Prowlarr use it. `apply`
-  sets it in Sonarr, Radarr and Prowlarr through their API once they run, and sets it
-  again whenever it changes.
-  - qBittorrent gets the login only at its first start, from a file Mediaplane never
-    rewrites. So if you later change `admin.password`, or switch between yours and the
-    generated one, `credentials` shows the new password but qBittorrent keeps the old
-    one. Change it in qBittorrent's web UI too, until Slice 3c does that for you.
+  unless you add `--reveal`. qBittorrent, Sonarr, Radarr and Prowlarr use it.
+  qBittorrent gets it before its first start. `apply` sets it in all four through their
+  API once they run, and sets it again whenever it changes.
   - Removing your own `admin.password` brings back the password Mediaplane generated
```

- [ ] **Step 4: The spec and the roadmap**

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 7a9219f..112f326 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -1227 +1227,47 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
     `secrets/wg.key` (0600), never over an existing one.
+
+### Slice 3c: the download path (2026-10-11)
+
+- **qBittorrent through its API, after its first start** (§6.1, §6.2, §6.4). Four
+  resources, all set with its key:
+  - `qbittorrent.admin`: its user name, and its password, checked by signing in (204
+    means it works, 401 that it doesn't) and set through its preferences, which need
+    neither the old password nor a restart. A change of `admin.username` or
+    `admin.password` now reaches qBittorrent. qBittorrent stops an address from signing
+    in for an hour after five failed sign-ins in a row; that answer (403) is reported as
+    it is, never read as a wrong password.
+  - `qbittorrent.preferences`: the default save path `/data/torrents`, Automatic Torrent
+    Management on (§11, Slice 3a), and who may skip the login: the LAN subnets, only with
+    `security.login_on_lan: false` while the web UIs are on the LAN, as its pre-start file
+    sets them. A change of those settings now reaches qBittorrent. This adds
+    Automatic Torrent Management and the whitelist to §6.2's managed fields.
+  - `qbittorrent.category_tv` and `qbittorrent.category_movies`, saving to
+    `/data/torrents/tv` and `/data/torrents/movies`, each while Sonarr or Radarr is in the
+    stack. A category is known by its name.
+- **Sonarr's and Radarr's download client** (§6.2): `<arr>.download_client`, named
+  `qBittorrent (Mediaplane)`, with the fields §6.2 lists and qBittorrent's key as its
+  secret. Its host is how the arr reaches qBittorrent: `gluetun` behind the VPN, whose
+  network qBittorrent shares, or `qbittorrent`; its port is qBittorrent's own. It is made
+  from the arr's own template, saved with `forceSave` even while qBittorrent is down, and
+  updated by sending the client back as the arr gave it, so its other settings stay the
+  user's. Its key is checked with the arr's own test of the client it holds (the key
+  masked): a refused key is planned as an update; any other failure, such as qBittorrent
+  out of the arr's reach, is the arr's own message (`unknown` in `plan`, a failure in
+  apply and verify). It `requires` qBittorrent's category, because the arr's test makes a
+  missing one with no save path, and Sonarr and Radarr come `after` qBittorrent.
+- **Sonarr's and Radarr's root folder** (§6.2): `<arr>.root_folder`, `/data/media/tv` or
+  `/data/media/movies`, known by its path (the arrs can't change one). The arr needs the
+  folder to exist, so the wire step makes it first, with `mkdir -p` in a throwaway
+  container of the arr's own service (`compose run`), as the stack's `user:`. A changed
+  path would add a root folder, and leave the old one.
+- **The integration contract** (§3.2) grows: a resource's `desired` sees the stack's
+  keys, its `verify` what the app holds, and it may name `folders` to make first. While a
+  managed field differs, the secrets aren't checked, because the update sets them anyway.
+  `plan` reports a managed field that holds a secret (`wire.secret-field`), which apply
+  refuses.
+- **The typed HTTP client** (§3.2, §5.1) also sends a form with the key (qBittorrent's
+  API), runs an app's own test (a 2xx passes; a 400 gives the errors of Servarr's
+  validation list, never a warning or an `attemptedValue`), and takes a sign-in's 401 as
+  its answer. A refusal of a call made without the key no longer blames the key.
+- **No new Docker API call.** The folder helper is a `compose run`, as the ownership
+  helper and vpn-check's probe are; the socket proxy allows nothing new (§7.2(2)).
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index 2e24565..458dd0b 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -20,2 +20,3 @@ Detailed plans so far:
 - Slice 3b: [`m1-s3b-wiring.md`](m1-s3b-wiring.md) (done).
+- Slice 3c: [`m1-s3c-download-path.md`](m1-s3c-download-path.md) (done).
 
@@ -23,5 +24,5 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d and S3b.
-- **Next:** S3c.
-- **After that:** S4 to S8.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b and S3c.
+- **Next:** S4.
+- **After that:** S5 to S8.
 
@@ -140,2 +141,9 @@ Verified in S3b (2026-10-10):
 
+Verified in S3c (2026-10-11):
+
+- **Sonarr and Radarr reach qBittorrent through Gluetun**, as `gluetun` at qBittorrent's
+  `WEBUI_PORT`: `test/e2e/download.e2e.test.ts` sets `apps.qbittorrent.port: 8090`, and
+  each arr's own test of its download client passes, from source and from the image. It
+  runs in CI from Slice 3c.
+
 ## Inputs for later slices from the reviews
@@ -150,4 +158,4 @@ S4 items, two S6 items, an S8 item and an M2 item. Slice 3d (2026-10-10) added t
 S3 item, the unscheduled list and extended two S8 items. Slice 3b (2026-10-10) added the
-S3c list, two S4 items and one unscheduled item. Each slice plan must address the items
-for that slice.
+S3c list, two S4 items and one unscheduled item. Slice 3c (2026-10-11) added three S4
+items. Each slice plan must address the items for that slice.
 
@@ -265,3 +273,4 @@ password, which are S3c's (and listed again below).
   `admin.password`, `login_on_lan` and the LAN subnet reach qBittorrent only through
-  its pre-start file (S3a). S3c manages them through its API.
+  its pre-start file (S3a). S3c manages them through its API. **Done in S3c:** the
+  `qbittorrent.admin` and `qbittorrent.preferences` resources.
 - **The shared admin password, through each app's API.** Apply it through every app's
@@ -270,3 +279,4 @@ password, which are S3c's (and listed again below).
   the new password while qBittorrent keeps the one from its first start. **Done in S3b
-  for Sonarr, Radarr and Prowlarr:** the `<app>.admin` resource.
+  for Sonarr, Radarr and Prowlarr:** the `<app>.admin` resource. **Done in S3c for
+  qBittorrent:** `qbittorrent.admin`, set through `setPreferences`.
 - **Keys an app creates must fit the secrets store (S3b).** `state/secrets.json` takes
@@ -288,3 +298,3 @@ password, which are S3c's (and listed again below).
 
-**S3c:**
+**S3c:** all of these are in the S3c plan.
 
@@ -297,2 +307,4 @@ password, which are S3c's (and listed again below).
 - **`after` for the arrs.** Sonarr and Radarr come after qBittorrent once they link to it.
+- **Done in S3c:** all three, with the end-to-end test proving the download path through
+  Gluetun from source and from the image behind the real proxy.
 
@@ -322,2 +334,14 @@ password, which are S3c's (and listed again below).
   match them exactly.
+- **A root folder whose path changes.** Sonarr and Radarr can't move a root folder, so a
+  `root_folder.path` override would add a new one and leave the old, which may hold a
+  library (S3c). Decide what drift and Keep mine do with the old one.
+- **qBittorrent's sign-in ban.** qBittorrent bans an address from signing in for an hour
+  after five failed sign-ins in a row, and Mediaplane checks its password by signing in
+  (S3c). A changed `admin.password` costs two failures before apply sets it. When drift
+  is checked on a schedule (M2), a changed password left unapplied would ban
+  Mediaplane's address within the hour. Decide whether drift checks the password less
+  often, or not at all while it differs.
+- **Settings Mediaplane manages in qBittorrent are put back.** A whitelist, a save path
+  or a category's path changed in qBittorrent's web UI is undone by the next `apply`
+  (S3c). Keep mine must cover them, with the arrs' download clients and root folders.
 - **Appdata ownership is checked only on change.** Apply checks it only when
```

- [ ] **Step 5: Check the docs, and commit**

Every diagram must be at most 40 columns wide, and no public doc may name the planning
process (controller, preflight, ruling, decision numbers):

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git diff -U0 -- docs README.md catalog deploy | grep '^+' | grep -i -E 'controller|preflight|ruling|\bD[0-9]+\b'
```

Expected: the check passes, and the `grep` prints nothing.

```bash
git add docs README.md catalog deploy
git commit -m "docs: the download path (runbook, architecture, threat model, READMEs, spec, roadmap)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Slice 3c completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too (Task 6, Step 4),
  and leaves no `mediaplane-e2e-*` container, network or image, no host helper, and no
  new volume or `mediaplane-e2e-*` folder.
- [ ] The socket proxy's allow-list is unchanged: `git diff d401c2e --
  deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints nothing (decision 6).
  `d401c2e` is `main` after S3b.
- [ ] No secret shows: the tests that check it pass (the client's form and test
  redaction, the download client's masked test, the e2e checks that `resources.json`
  holds neither the password nor qBittorrent's key).
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  outside the GitHub URLs (`https://github.com/cyclopsgd/Mediaplane/…`).
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B d401c2e.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 2 (qBittorrent's password checked by signing in, and its ban), 5 (root
    folders known by their path, made by a `compose run` helper) and 11 (qBittorrent's
    whitelist managed both ways);
  - that the e2e tests on Compose v2.38.2 and Docker 28 are confirmed by the slice PR's
    first CI run, as they were locally with Compose 2.38.2;
  - for the owner's manual-steps list: after changing `admin.password`, run
    `mediaplane apply` soon, since five `plan`s before it ban Mediaplane from signing in
    to qBittorrent for an hour (a restart of qBittorrent lifts it); and settings changed
    in qBittorrent's web UI that Mediaplane manages (the save path, Automatic Torrent
    Management, the whitelist, the two categories' paths) are put back by the next
    `apply`.
