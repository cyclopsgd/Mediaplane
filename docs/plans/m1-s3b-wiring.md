# M1 Slice 3b: the wiring framework — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mediaplane wires the apps through their APIs: it reaches them over a private
network with no route out, plans and applies managed resources through a typed HTTP
client, records them in `state/resources.json`, and sets the shared admin login in
Sonarr, Radarr and Prowlarr, which works from source and from the image behind the
socket proxy.

**Architecture:**

- **A private wiring network** (the owner's decision A2, ADR 0011). `compose.yaml`
  declares `wiring` with `internal: true`. Every app with an `api` in the catalog joins
  it at create, beside its default network; Gluetun joins for qBittorrent. Mediaplane's
  container joins it with `docker network connect` during `plan` and `apply`, and stays
  (it steps off for `up`). Run from source, the host reaches the containers' addresses
  on it. Requests carry `Host: <service>:<port>`.
- **The typed HTTP client** (`http/client.ts`): `node:http` with an agent of its own,
  never an environment proxy; retries with backoff and jitter; a size cap; Zod; every
  message redacted.
- **The integration contract** (`integrations/types.ts`, `catalog/<app>/integration.ts`):
  resources named `<app>.<resource>`, with managed fields, secrets checked by use, and
  `after`/`requires`. The first resource is `<app>.admin` in the three Servarr apps.
- **Plan and apply.** `plan` asks each settled app (readiness, its key, each resource)
  and reports `create`, `update`, `adopt`, `unchanged`, `after-start` or `unknown`.
  `apply` gains a `wire` step after `start`, records each resource in `resources.json`
  at once, and its verify step also runs vpn-check's checks without egress. A qBittorrent
  stranded by a Gluetun started again is planned as `restart`, stopped before `up`, and
  started by it.

**Tech Stack:** as Slice 3d (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §3.2 (the integration contract), §4.1 (`state/resources.json`), §4.3 (the catalog);
- §5 (the apply flow: wire, verify, record), §5.1 (failure handling), §5.2 (`init`);
- §6.1 (the shared admin, login on the LAN), §6.2 (ordering, readiness), §6.3 (identity,
  secrets verified never compared), §6.4 (Gluetun dependants, settings that need a
  restart);
- §7.2(2) (the socket proxy), §7.2(4) (secrets), §7.2(6) (VPN), §8.1(2) (adapter tests
  against a fake HTTP server), §9 (the documentation set).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S3 split ("S3b: the
wiring framework"), the S3 items in "Inputs for later slices from the reviews", and the
`SERVER__TRUSTEDNETWORKS` row of "Things S1 encodes".

Decisions made for S3 before this plan (the controller's rulings, 2026-10-09; the owner's
D1 decision, 2026-10-10):

- **D1 (owner): A2, a private wiring network.** Apply creates a Docker network with
  `internal: true`, which Mediaplane's container, every wired app and Gluetun (for
  qBittorrent) join. Mediaplane's container stays offline. The apps keep their normal
  network. Gluetun's firewall must accept wiring traffic to qBittorrent's port (it does
  with no setting: Gluetun counts every network it is on as local, which Task 9 checks).
  ADR 0011 records it, and its limit: the proxy still lets Mediaplane create containers.
- **D2:** container addresses from `docker inspect`, the same resolver from source and
  in the image. **D3, D4, D5, D8, D12, D13, D16** as the research recommends (D12, D13
  are S3c's). **D15:** fields are additive and optional within `mediaplane.change/v1`.
- **The controller's later housekeeping items** (from the owner's trial), all in Task 1:
  `init` checks the home before its first question; creates the data folder; says what
  each question is for; takes the WireGuard key on a hidden prompt. Runbook hints give
  GitHub URLs. Apply writes `.env` only when it changed. And the stranded-qBittorrent
  e2e reproduces the trial: `docker stop` Gluetun, then `apply`.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`), with one line of context. It
  is exact: save it to a file and run `git apply <file>` from the repo root, or make the
  same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a schema
  description, a CLI option or a catalog fact says to run `pnpm docs:generate`, and
  names what it rewrites.
- Every block was applied in order to a fresh worktree at `4125ce1`, and each task's
  tests failed before its implementation and passed after it (see the completion
  checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a and 3d Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`, `m1-s3d-vpn-check.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-key-0123`; a test WireGuard key is `'A'.repeat(43) + '='`.
  Addresses in tests and docs come from the documentation ranges (`192.0.2.0/24`,
  `198.51.100.0/24`, `203.0.113.0/24`), private ranges, or `fd00::/8`;
- neutral framing;
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and neither does `vpn-check` (decision 2 says what `plan` does
  change);
- Docker is reached only through the `Runtime` (the end-to-end tests may call `docker`
  themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`;
- the runtime refuses any Compose project that is not `mediaplane` or
  `mediaplane-<name>`, and never accepts `mediaplane-system`;
- every image is pinned by digest, and every GitHub Action by commit SHA;
- end-to-end test files run one at a time;
- never prune images (`docker image prune`, `docker system prune`);
- temporary folders in unit tests come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing`;
- coverage thresholds are never lowered: `vitest.config.ts` keeps 90% lines, functions,
  branches and statements on `packages/engine/src`;
- never push.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records, logs, human or JSON
  output, command lines, container environments or `docker inspect`. That covers the
  apps' API keys, the admin password, a pasted WireGuard key, and session cookies.
  - No key ever goes in a URL (`?apikey=` ends up in the apps' logs). Mediaplane sends
    an app's key in a request header (`X-Api-Key`, or `Authorization: Bearer` for
    qBittorrent). The one body that holds a key is the Servarr host settings, which
    carry the app's own key back to that app as it gave it (decision 9). The admin
    password travels only in request bodies: those settings, and the sign-in form that
    checks it.
  - Every message the HTTP client makes is redacted with every secret the stack knows
    (`.env`'s values, the store's keys, the admin password), and names a path without
    its query. An app's own message is quoted, but never Servarr's `attemptedValue`. Its
    answer is redacted before anything collapses or cuts it, and again after (preflight
    B1): a secret split by the cut, or changed by the collapse, would otherwise escape.
  - `state/resources.json` and the change records hold secret *names*, never values.
    Secrets are verified by use (a sign-in), never stored or compared (spec §6.3).
  - The client runs in Mediaplane's own process. The Docker commands this slice adds
    carry only container IDs, network names and service names.
  - A sign-in's cookies are dropped, never kept.
  - End-to-end assertions that see a secret say only whether they passed.
- **No new socket-proxy permission.** The allow-list in `deploy/mediaplane.compose.yaml`
  doesn't change (a comment does). `deploy/deploy.test.ts` may list more calls only if
  the existing list already allows them. Anything that would need a new Docker API call
  is a security-sensitive decision for the controller, not for an implementer.
- **The wiring network is internal.** The runtime joins only a network that is
  `internal` and is the managed project's own `wiring` network (by its Compose labels),
  and only from Mediaplane's image. Nothing in this slice gives Mediaplane's container a
  route out.
- **The HTTP client never uses a proxy or a shared agent.** It uses `node:http` with an
  agent of its own and reads no `HTTP_PROXY`, `HTTPS_PROXY` or `NO_PROXY`. No new
  dependency.
- **Unit tests never reach a real app.** HTTP tests use `fakeHttpApp` on `127.0.0.1`.
  CLI tests pass `CliDeps.wiring`, from `fakeStackApis()`, so the real catalog's apps are
  asked on a fake server. The fake runtime puts no container on the wiring network unless
  a test says where (`fakeSonarr().addresses`, `fakeStackApis().addresses`), so a test
  that forgets its fake apps gets `wire.not-on-network`, never a request to a real app on
  the host.
- **Docker and Compose flags.** CI runs Docker 28 with Compose v2.38.2; the dev box runs
  Docker 29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. The runtime adds only
  `docker network inspect --format`, `docker network connect`, `docker network
  disconnect`, `docker container inspect --format` and `compose stop`, all without long
  flags.
- **Names in end-to-end tests** start with `mediaplane-e2e-`, as before. A stack's wiring
  network is `<project>_wiring`.
- **Teardown never stops at the first failure,** and the deployment (`-system`) goes down
  before the stack: while Mediaplane's container is on the stack's wiring network, the
  stack's `down` can't remove that network and leaves it behind.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes a schema description, a CLI option or a catalog fact runs
  `pnpm docs:generate` first and commits the generated files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it.
  - Short, plain sentences; lists rather than wide tables.
  - Diagrams are plain-text code blocks no wider than 40 columns, never Mermaid, because
    Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.

## Decisions taken in this plan

The spec, the rulings and D1 leave these open. Each is marked `Decision:` where it is
applied. The ones the controller should look at first are marked **(check)**.

1. **(check) The wiring network, and the exact Docker API calls.** `compose.yaml`
   declares `networks: { wiring: { internal: true } }`, and every service on it gets
   `networks: [default, wiring]` (listing a network replaces Compose's default, so the
   default is listed too, and the apps' own traffic stays on it). The calls:
   - **Compose** creates the network with `POST /networks/create`, and attaches the apps
     when it creates them, with `POST /containers/create`. Both are on the allow-list.
   - **Mediaplane's own container** (from its image only) reads the network with
     `docker network inspect --format …` (`GET /networks/mediaplane_wiring`), joins it
     with `docker network connect` (`POST /networks/mediaplane_wiring/connect`), and
     leaves it with `docker network disconnect`
     (`POST /networks/mediaplane_wiring/disconnect`).
   - **The apps' addresses** come from `docker container inspect --format …`
     (`GET /containers/{id}/json`), which vpn-check already uses.
   - **A stranded qBittorrent** is stopped with `compose stop qbittorrent`
     (`GET /containers/json`, `POST /containers/{id}/stop`), and `up` starts it.

   **No proxy permission changes.** The allow-list's regexes already allow network
   connect and disconnect for any network, for an override's networks. In
   `deploy/deploy.test.ts`, the three network calls join `ENGINE_CALLS` as the engine's
   own, and `OVERRIDE_CALLS` keeps all its lines, so what an override needs stays pinned
   (preflight M9). `deploy/mediaplane.compose.yaml` changes a comment only. The research
   recorded every call through a logging proxy. Task 9 runs the join and the leave through
   the real proxy, from the deployed image, and checks Docker's own events for the
   disconnect and the connect. The stranded qBittorrent's trial runs from source only:
   `compose stop` lists and stops containers, calls that `up` already makes through the
   proxy when it recreates one (preflight M8) (Tasks 2, 3, 9).
2. **(check) `plan` joins the wiring network.** "`plan` writes nothing" still holds for
   files. Joining is the one change to Docker's state that `plan` makes: without it,
   `plan` in the image can't ask the apps anything. It is idempotent ("already" when
   Mediaplane is on it), and it joins only an internal network whose Compose labels say
   it is this project's `wiring`; anything else is a `RuntimeError`, never a join. Run
   from source, there is nothing to join: the host reaches the containers' addresses
   itself (Tasks 3, 6).
3. **(check) Mediaplane steps off the network for `up`.** Compose can't recreate the
   wiring network, or remove it, while a container of another project is on it
   (checked on Compose 5.5.1). So apply's start step leaves, and the wire step joins
   again. Two limits, recorded in the roadmap and the runbook:
   - `docker compose -p mediaplane down` on the host, with Mediaplane on the network,
     leaves the network behind ("Resource is still in use"). The deploy guide says to
     bring `mediaplane-system` down first, or to disconnect Mediaplane.
   - If the network's own settings ever change, Compose must delete it, and the proxy
     doesn't allow `DELETE /networks` (none does today). The runbook gives the steps
     by hand; S4 decides whether Mediaplane should (Tasks 7, 10).
4. **(check) The HTTP client never goes through a proxy.** `node:http` with an agent of
   its own (`keepAlive: false`). Node's global agent sends requests to `HTTP_PROXY`
   when `NODE_USE_ENV_PROXY` is set, which would hand the proxy the key. A spawned test
   sets both, shows that a request through Node's own agent reaches the proxy, and that
   the client's doesn't (preflight M5). The rest:
   - retries with full jitter (500 ms, doubling, at most 10 s a wait) until a deadline:
     120 s in `apply` (`APP_DEADLINE_MS`), 15 s in `plan` (`PLAN_DEADLINE_MS`);
   - GET, PUT and the sign-in form (a POST that changes nothing) are retried on a
     refused connection, a timeout, 502, 503 or 504; any other POST only when nothing
     reached the app (a refused connection), so a create is never sent twice;
   - 30 s a request, at most 5 MiB of answer, every JSON answer checked with Zod;
   - messages are `<App> at http://<service>:<port> (<address>) <what> (<METHOD> <path>)`,
     redacted, with the app's own message from Servarr's validation errors
     (`errorMessage`, never `attemptedValue`), a ProblemDetails, `{ message }` or its text
     with the HTML taken out, at most 200 characters;
   - **(check) the order of the redaction** (preflight B1): `appMessage(body, clean)`
     redacts the raw body first, then, for JSON, the parsed message again (a secret with
     JSON escapes appears only once parsed), and only then collapses whitespace and cuts
     at 200 characters. The failure's message is redacted once more as a whole. Tests:
     the key at character 190 of a 300-character answer (no 8 characters of it remain),
     and a password with runs of spaces;
   - a size limit is named in the unit it is a whole number of: "answered more than
     1 KiB", never "0 MiB" (Task 4).
5. **Requests carry `Host: <service>:<port>`**, as the other apps of the stack send, which
   the Servarr apps' allowed hosts and qBittorrent's Host-header check accept. The TCP
   connection goes to the container's address on the wiring network (Task 4).
6. **(check) Secrets in and out of the wiring.** See the Global Constraints: keys in
   headers (and in the Servarr settings sent back to their own app), the password in
   request bodies only, redaction with every secret the stack
   knows (`knownSecrets`), cookies dropped. A resource's secrets are *verified* by use
   (Servarr: `POST /login` with the shared admin, where a 302 to anywhere but
   `…loginFailed…` means the login works), never compared or stored. The fake Sonarr
   repeats a key it refuses, as an app may, so the plan and wire tests fail if
   `knownSecrets` ever stops reaching the client (preflight M5) (Tasks 4 to 7).
7. **(check) `state/resources.json` holds no secret.** Schema `mediaplane.resources/v1`:
   `{ schema, resources: { "<app>.<resource>": { id, name, fields, secrets, appliedAt } } }`,
   where `fields` are the managed, non-secret values (`username`) and `secrets` are
   *names* (`["password"]`). Its addresses follow the contract's rule for a resource
   name (`<app>.` then `[a-z][a-z0-9_]*`: preflight M22). Written atomically, `0600` in
   `state/` (`0700`), at once after each resource. A file that doesn't parse is an error
   (`resources.invalid`), never overwritten. The change record's `wire` actions name the
   resource and what was done (`created`, `updated username`), never a value (Tasks 5,
   7).
8. **(check) Keys an app creates must fit the store, and the store refuses to save one
   that doesn't.** The roadmap item left two choices. The charset rule
   (`^[A-Za-z0-9_]+$`) stays for every key, because the keys go into the apps' files
   unescaped. `writeSecretStore` checks the store against the same schema
   `readSecretStore` uses before it writes: a key with other characters is refused,
   naming the key and never its value, and the store on disk stays as it was. So a key
   an app made can never lock `plan` out of the store. Jellyfin's (S6) is 32 hex
   characters, which fits (Task 1).
9. **The Servarr admin is a singleton resource, `<app>.admin`.** It replaces S3a's
   `bootstrap-api create-admin` placeholder steps. `observe` reads
   `GET /api/v{3|1}/config/host`, and a user name of `""` means none yet; `create` and
   `update` `PUT` the whole settings object back with the user name and the password
   (as the app's own UI does; that object holds the app's key and the old hash, and is
   never shown). That body is the one place a key travels outside a header: back to the
   app it belongs to (the Global Constraints). No restart needed (Tasks 5, 7).
10. **(check) Servarr's allowed hosts when the LAN needn't sign in.** With
    `security.login_on_lan: false`, Sonarr, Radarr and Prowlarr take only Host names on
    a list, and refuse to save their settings until they have one (found by the
    research). So `<PREFIX>__SERVER__ALLOWEDHOSTS` lists the service name and the web
    UI's addresses (`webAddresses`, without `127.0.0.1`, which always passes). Task 9
    checks that `sonarr:8989` and `127.0.0.1:8989` pass and another name gets 400 (DNS
    rebinding stays refused) (Tasks 2, 9).
11. **What `plan` reports for the wiring.** For each app with an API, in `after` order:
    whether it is settled (running, healthy, and left as it is by apply), then each
    resource. `create`, `update` (naming the fields and secrets that differ), `adopt`
    (the app holds it as wanted; `resources.json` doesn't say so yet), `unchanged`,
    `after-start` (its app isn't settled), or `unknown` (Mediaplane couldn't ask, with a
    warning saying why). A settled app with no address on the network is `unknown`, with
    `wire.not-on-network`. Any wiring other than `unchanged` makes `changed` true, and
    `apply`'s verify fails if any remains (Task 6).
12. **What `apply`'s wire step does.** After `start`: join; wait for each app's `ready`
    path; check its key; then, in order, each resource: create, update or adopt, and
    record it in `resources.json` at once. A resource whose `requires` failed is
    `skipped`; the others still go. Any failure fails the step with each app's own
    message, `wire.<kind>`, and the runbook's URL (Task 7).
13. **(check) A part-failed wiring is `failed`, not `partial`.** Spec §5 step 12 names a
    `partial` outcome; the change record keeps `failed`, as today, with each resource's
    own `done` or `failed` action. The roadmap asks S4 to decide whether drift's
    re-apply needs `partial` (Tasks 7, 10).
14. **(check) A stranded qBittorrent is restarted, and verify checks the VPN.**
    - `plan` lists qBittorrent as `restart` (a new container action) when it runs in
      Gluetun's namespace, is otherwise unchanged, and either apply will start a stopped
      Gluetun, or it started before Gluetun's current run (`startedBefore`, which
      vpn-check now shares).
    - `apply`'s start step stops it (decision 1) before `up`, and `up` starts it in
      Gluetun's current namespace: "every app is running and healthy; restarted
      qbittorrent".
    - Verify runs `vpnCheck` without the egress check (no request to the outside
      service) whenever qBittorrent is behind Gluetun. A `leak` or `down` fails verify,
      with the check's own hint.
    - Task 9 reproduces the owner's trial: `docker stop` Gluetun, then `mediaplane apply`
      (Tasks 8, 9).
15. **(check) `init` changes spec §5.2.** All in Task 1:
    - it checks it can create the home, or write into it, before the first question,
      with the `sudo mkdir -p … && sudo chown $USER: …` fix in the message;
    - it creates the data folder (`mkdir -p`, as you) when it is missing and it may, and
      never changes an owner or a mode. When it can't, `stack.yaml` is still written and
      the next step gives `sudo mkdir -p <path>` and `sudo chown <uid>:<gid> <path>`. In
      the image, a data folder outside the home is out of sight, and keeps today's step;
    - on a terminal, a line or two (at most 60 columns) before each question says what
      it is for. The question lines don't change, and `--json` and runs without a
      terminal are as before;
    - with a VPN provider and no `secrets/wg.key`, it asks for the WireGuard private key
      on a hidden prompt, checks it (44 characters of base64 that decode to 32 bytes),
      and writes it `0600` without overwriting. Enter skips it, and the next step stays.
      It never asks without a terminal or with `--json`. No `--vpn-key-file` flag: the
      key file is the flag's alternative.
16. **Runbook hints are URLs.** Someone running the image has no copy of the repo, so
    hints give `https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/<name>.md`
    (`runbookUrl`). Where the first action is plain, it comes first: Gluetun stopped
    says `run "mediaplane apply" to start Gluetun again, then see <url> if it stops
    again` (Task 1).
17. **`apply` writes `generated/.env` only when it differs,** as it already did for
    `compose.yaml`; an unchanged one is only made `0600` again. The files step then says
    "none needed". Where that `chmod` is refused (`EPERM`: another user's file, after a
    run with `sudo`), it rewrites the file as before and counts it written, so it is never
    worse than the atomic rewrite it replaces (preflight M18) (Task 1).
18. **Host reachability from source is assumed on Docker 28.** Run from source, the CLI
    reaches the containers' addresses on an internal network from the host. Verified on
    Docker 29.8; CI (Docker 28) confirms it on the slice PR's first run. If it doesn't
    hold there, the fix is a task on that PR, not a change of design.
19. **What the preflight scan changed** (B1, M1 to M22, the controller's rulings). Each is
    in the task that owns the code; the ones that change a decision are above (B1 in 4,
    M5 in 6, M8 and M9 in 1, M18 in 17, M19 in 9, M22 in 7).
    - Shared code instead of copies: `wiringTargets` and `notOnNetwork` in the wire step
      (M1); one `wiringLine` for `plan` and `history` (M2); the engine's `codeOf` in the
      client and in `folders.ts` (M3); `stoppedUntilUp`, the shared wiring fixture in
      `testing/wiring.ts`, and `wiringMembers` in the e2e helpers (M4).
    - Tests that can fail: the catalog's checks run only over the apps with an API or an
      integration, and list them (M5); the no-proxy test first shows Node's own agent
      does go through the proxy (M5); the deploy e2e checks Docker's events (M5).
    - The tests that need a folder this user can't write keep skipping as root, the
      existing pattern (M6, as ruled).
    - The deploy e2e's teardown runs every removal whatever the one before did (M7).
    - The fake runtime gives no address by default (M10).
    - The docs: the deploy guide's network line, the architecture's `mediaplane-system`
      and `plan` lines, the README's flow (the wire step), the spec's §5.2 `plan` row,
      its §11 entry (the runtime's new calls, the ports' source), T14's indirect egress,
      `CONTRIBUTING.md`, and claims cut back to what is checked (M11 to M14, M21); short
      table cells, the detail in lists (M15); and vpn-check's stranded hint, which puts
      `mediaplane apply` first (M20).
    - The completion checklist compares against `4125ce1` (M16).

## File structure (new and changed in this slice)

`packages/engine/src/`:

- `http/client.ts` (+test), new: `createAppApi`, `AppApiError`, `appMessage`.
- `integrations/types.ts`, new: the contract (`ResourceSpec`, `Integration`,
  `defineIntegration`).
- `integrations/resources.ts` (+test), new: `state/resources.json`.
- `integrations/wiring.ts` (+test), new: what `plan` asks the apps (`planWiring`) and the
  parts `apply` shares.
- `integrations/wire.ts` (+test), new: apply's wire step.
- `plan/stranded.ts` (+test), new: `strandedGuests`, `startedBefore`.
- `runbooks.ts`, new: `runbookUrl`.
- `util/redact.ts`, moved from `runtime/redact.ts`: the client uses it too.
- changed: `catalog/types.ts` (`ApiSpec`, `api`, `integration`, `webAddresses`),
  `render/compose.ts` (the wiring network), `resolver/resolve.ts` (`webAddresses`),
  `runtime/types.ts` and `runtime/docker.ts` (join, leave, addresses, stop),
  `plan/plan.ts`, `plan/containers.ts` (`restart`), `apply/apply.ts` (the wire step,
  verify, `.env`), `history/records.ts`, `secrets/store.ts`, `vpn/check.ts`,
  `credentials.ts`, `paths.ts`, `config/schema.ts` (a description), `index.ts` (which
  now exports `util/error-code.ts`'s `codeOf` too).
- tests' helpers: `testing/http.ts` (new: `fakeHttpApp`, `closedPort`),
  `testing/wiring.ts` (new: `fakeStackApis`, `fakeSonarr`, `WIRED_CATALOG`),
  `testing/fakes.ts`, `testing/fixtures.ts`, `testing/index.ts`.

`packages/cli/src/`:

- `folders.ts` (+test), new: `homeProblem`, `prepareDataFolder`, `dataSteps`.
- changed: `init.ts`, `prompt.ts` (`terminalAskSecret`), `main.ts`, `run.ts`,
  `output.ts` (the wiring section, `restart`).

`catalog/`:

- `_shared/servarr.ts` (+ new test): `servarrApi`, `servarrAdmin`, `servarrIntegration`,
  and the allowed hosts.
- `sonarr`, `radarr`, `prowlarr`: `integration.ts` (new), `app.ts` (`api`,
  `integration`, the placeholder steps gone).
- `qbittorrent/app.ts`: `api` only (its integration is S3c's).

Elsewhere:

- `deploy/deploy.test.ts` (the calls), `deploy/mediaplane.compose.yaml` (a comment).
- `scripts/docs/catalog-facts.ts` (+test): the "API" and "Managed in the app" facts.
- `test/e2e/apply.e2e.test.ts`, `deploy.e2e.test.ts`, `vpn.e2e.test.ts`, and
  `helpers.ts` (`wiringMembers`).
- docs: ADR 0011 (new), the "wiring failed" runbook (new), ADR 0008, the threat model,
  the architecture, the READMEs, the runbooks, `CONTRIBUTING.md`, the spec and the
  roadmap.

**Tasks:**

1. Housekeeping: the store's charset on write, `init`'s home, data folder, notes and
   WireGuard key, runbook URLs, and `.env` only when changed.
2. The wiring network in `compose.yaml`, the apps' API specs, and Servarr's allowed
   hosts.
3. The runtime: join and leave the wiring network, its addresses, and `stop`.
4. The typed HTTP client.
5. The integration contract, `state/resources.json`, and the Servarr admin resource.
6. `plan` asks the apps: the wiring in the plan.
7. `apply` wires the apps: the wire step.
8. A stranded qBittorrent: `restart`, and verify's VPN check.
9. End-to-end: the wiring on real Docker, from source and from the image.
10. Docs: ADR 0011, the runbook, ADR 0008, the threat model, the architecture, the
    READMEs, the spec and the roadmap.

**Out of scope here:**

- **qBittorrent's integration** (its categories, preferences and admin password through
  its API) and the download clients: S3c. S3b reaches qBittorrent's API through Gluetun
  and checks its key, and nothing more.
- **Restricting what the proxy lets Mediaplane create:** not scheduled (ADR 0011's
  limit).
- **Deleting a changed wiring network**, and the `partial` outcome: S4 decides
  (decisions 3, 13).

---

### Task 1: Housekeeping: the store's charset, runbook URLs, `.env`, and `init`

Small items that the wiring builds on, or that the owner's trial of S3d found. Each has
its own test cycle; they are committed together.

- **A. The store refuses to save what it couldn't read back** (decision 8), and `redact`
  moves to `util/`, since the HTTP client (Task 4) uses it as well as the runtime.
- **B. Runbook hints are URLs** (decision 16), and `apply` writes `.env` only when it
  differs (decision 17). The engine also exports `codeOf`, which C uses.
- **C. `init`** checks its home first, creates the data folder, says what each question
  is for, and takes the WireGuard key on a hidden prompt (decision 15).

Decision: an unchanged `.env` is only made `0600` again. Where that `chmod` is refused
with `EPERM` (another user's file, after a run with `sudo`), apply rewrites it, as it did
before, and counts it written (preflight M18). The test refuses the `chmod` with the
`refuseChmodOf` mock `apply.test.ts` already has; it passes before B's code too, since
that code rewrote `.env` every time: it pins that this is no worse.
Decision: the apply tests that stop Gluetun by hand share one wrapper,
`stoppedUntilUp(docker, service)` in `apply.test.ts`, which Task 8 uses again
(preflight M4).
Decision: `readFlags` becomes `async` and checks the home first, so a home init can't
write fails before any question, with the fix in the message. The check walks up to the
nearest folder that exists, as `mkdir -p` would, and asks for write and search access
there. It is a check, not a promise: `init` still reports a failed write.
Decision: the data folder is created by `prepareDataFolder`, a `CliDeps` seam, so
`init`'s tests never touch the real filesystem outside a temporary folder. From source it
may create any path; in the image (`MEDIAPLANE_IMAGE`), only one inside the home, which
is the only host folder the container sees. `folders.ts` reads a failure's code with the
engine's `codeOf`, not a copy of it (preflight M3).
Decision: the notes go to `io.stdout`, the stream the questions are on, and only when
`init` asks (`io.ask` is set): `--json` and runs without a terminal print exactly what
they did.
Decision: the hidden prompt is `terminalAskSecret`: readline on its own terminal (raw
mode, so the terminal doesn't echo) writing into a stream that drops everything. Only
the question and a final newline reach the output.
Decision: the tests that need a folder this user can't write (`0o555`) skip as root, as
the five such tests at `4125ce1` already do (preflight M6, ruled: the existing pattern).

**Files:**
- Create: `packages/engine/src/runbooks.ts`, `packages/cli/src/folders.ts`,
  `packages/cli/src/folders.test.ts`
- Move: `packages/engine/src/runtime/redact.ts` to `packages/engine/src/util/redact.ts`
- Modify: `packages/engine/src/secrets/store.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/vpn/probe.ts`, `packages/engine/src/vpn/check.ts`,
  `packages/engine/src/apply/apply.ts`, `packages/engine/src/index.ts`,
  `packages/cli/src/init.ts`, `packages/cli/src/prompt.ts`, `packages/cli/src/main.ts`,
  `packages/cli/src/run.ts`, `deploy/README.md`, `docs/runbooks/app-wont-start.md`,
  `docs/runbooks/vpn-down.md`
- Generated: `docs/reference/cli.md`
- Test: `packages/engine/src/secrets/store.test.ts`, `packages/cli/src/init.test.ts`,
  `packages/cli/src/prompt.test.ts`, `packages/cli/src/vpn-check.test.ts`,
  `packages/engine/src/vpn/check.test.ts`, `packages/engine/src/apply/apply.test.ts`

**Interfaces:**
- **Consumes:** `storeSchema` and `fault` inside `secrets/store.ts`; `codeOf` from
  `util/error-code.ts`; `writeFileExclusive`, `writeFileAtomic`, `starterStack` and
  `HostFacts` from the engine; `askUntil`, `readFlags` and `gatherAnswers` inside
  `init.ts`; `Io` and `CliDeps` from `run.ts`; `refuseChmodOf` inside `apply.test.ts`.
- **Produces:**
  - `writeSecretStore(home, store)` throws
    `Error('cannot save <home>/state/secrets.json: <faults>')`, naming keys, never values,
    for a store `readSecretStore` would refuse;
  - `redact` from `packages/engine/src/util/redact.ts` (same signature as before);
  - `RUNBOOKS_URL`, `type Runbook = 'app-wont-start' | 'vpn-down' | 'wiring-failed'` and
    `runbookUrl(name: Runbook): string` in `runbooks.ts`, exported from the engine;
    `VPN_RUNBOOK` is now `runbookUrl('vpn-down')`;
  - `codeOf(cause: unknown): string | undefined`, now exported from the engine;
  - in `apply.test.ts`: `stoppedUntilUp(docker: Runtime, service: string): Runtime`;
  - in `packages/cli/src/folders.ts`: `homeProblem(home: string): Promise<string | undefined>`;
    `type DataFolder = 'created' | 'ready' | 'check' | 'unseen' | { blocked: string }`;
    `prepareDataFolder(path, home, inImage: boolean, user: { uid; gid }): Promise<DataFolder>`;
    `dataSteps(path, folder: DataFolder, user): string[]`; `exists(path): Promise<boolean>`;
  - `terminalAskSecret(input, output, terminal?): (question: string) => Promise<string>`;
  - `Io.askSecret?: (question: string) => Promise<string>`;
  - `CliDeps.dataFolder: (path, home, user) => Promise<DataFolder>`;
  - `init(options, io, host, dataFolder)`, and `NOTES`, the lines before each question.

- [ ] **Step 1: A. Write the failing test for the store**

**Change** `packages/engine/src/secrets/store.test.ts`:

```diff
diff --git a/packages/engine/src/secrets/store.test.ts b/packages/engine/src/secrets/store.test.ts
index eb1b458..f6989ac 100644
--- a/packages/engine/src/secrets/store.test.ts
+++ b/packages/engine/src/secrets/store.test.ts
@@ -190,2 +190,23 @@ describe('writeSecretStore', () => {
   });
+
+  it('never saves a key it could not read back, and keeps the store it had', async () => {
+    // A key an app makes itself (createdBy: 'app') is kept as the app gives it: one with a
+    // quote or a dash would make the next plan unable to read the store at all.
+    const home = await tempDir('mediaplane-store-');
+    const before: SecretStore = {
+      version: 1,
+      apps: { sonarr: { apiKey: '0'.repeat(32) } },
+    };
+    await writeSecretStore(home, before);
+    const bad: SecretStore = {
+      version: 1,
+      apps: { ...before.apps, jellyfin: { apiKey: 'fake"app-key' } },
+    };
+    const failure = writeSecretStore(home, bad);
+    await expect(failure).rejects.toThrow(
+      `cannot save ${join(home, SECRETS_PATH)}: jellyfin.apiKey must be text of letters, digits and "_" only`,
+    );
+    await expect(failure).rejects.not.toThrow('fake"app-key');
+    expect(await readSecretStore(home)).toEqual(before);
+  });
 });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/engine/src/secrets/store.test.ts`

Expected: FAIL: the new test, "never saves a key it could not read back, and keeps the
store it had" ("promise resolved \"undefined\" instead of rejecting"); the 15 others pass.

- [ ] **Step 3: Check the store before saving it, and move `redact`**

**Change** `packages/engine/src/secrets/store.ts`:

```diff
diff --git a/packages/engine/src/secrets/store.ts b/packages/engine/src/secrets/store.ts
index 68c9e86..a9e9807 100644
--- a/packages/engine/src/secrets/store.ts
+++ b/packages/engine/src/secrets/store.ts
@@ -10,3 +10,5 @@ import { compare, unique } from '../util/sort';
  * qBittorrent.conf, Gluetun's config.toml), so a hand-edited one must not hold a quote, a
- * "<" or a newline. Everything Mediaplane generates fits: hex, base62 and "qbt_".
+ * "<" or a newline. Everything Mediaplane generates fits: hex, base62 and "qbt_". So must
+ * a key an app creates itself (Jellyfin's is 32 hex characters): writeSecretStore
+ * refuses to save one that doesn't.
  */
@@ -69,4 +71,16 @@ function fault(path: readonly PropertyKey[]): string[] {
 
-/** Save the store atomically, private to its owner: state/ 0700, the file 0600 (§7.2(4)). */
+/**
+ * Save the store atomically, private to its owner: state/ 0700, the file 0600 (§7.2(4)).
+ * A store that readSecretStore would refuse is never written, so a key an app made with
+ * other characters can't lock plan out of the store; the error names the key, never its
+ * value, and the store on disk stays as it was.
+ */
 export async function writeSecretStore(home: string, store: SecretStore): Promise<void> {
+  const checked = storeSchema.safeParse(store);
+  if (!checked.success) {
+    const faults = unique(checked.error.issues.flatMap((issue) => fault(issue.path)));
+    throw new Error(
+      `cannot save ${join(home, SECRETS_PATH)}${faults.length === 0 ? '' : `: ${faults.join('; ')}`}`,
+    );
+  }
   const sorted = <T>(record: Record<string, T>): Record<string, T> =>
```

**Move** `packages/engine/src/runtime/redact.ts` **to** `packages/engine/src/util/redact.ts`:

```bash
git mv packages/engine/src/runtime/redact.ts packages/engine/src/util/redact.ts
```

**Change** `packages/engine/src/runtime/docker.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.ts b/packages/engine/src/runtime/docker.ts
index 8224404..0f02ff1 100644
--- a/packages/engine/src/runtime/docker.ts
+++ b/packages/engine/src/runtime/docker.ts
@@ -5,3 +5,3 @@ import { COMPOSE_PATH, ENV_PATH, OVERRIDE_PATH } from '../paths';
 import { nodeExec, type Exec, type ExecResult } from './exec';
-import { redact } from './redact';
+import { redact } from '../util/redact';
 import {
```

**Change** `packages/engine/src/vpn/probe.ts`:

```diff
diff --git a/packages/engine/src/vpn/probe.ts b/packages/engine/src/vpn/probe.ts
index b88b849..d42b7eb 100644
--- a/packages/engine/src/vpn/probe.ts
+++ b/packages/engine/src/vpn/probe.ts
@@ -1,2 +1,2 @@
-import { redact } from '../runtime/redact';
+import { redact } from '../util/redact';
 import type { OneOffCommand } from '../runtime/types';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run packages/engine/src/secrets packages/engine/src/runtime packages/engine/src/vpn`

Expected: PASS.

- [ ] **Step 5: B. Write the failing tests for the hints and `.env`**

**Change** `packages/engine/src/vpn/check.test.ts`:

```diff
diff --git a/packages/engine/src/vpn/check.test.ts b/packages/engine/src/vpn/check.test.ts
index d0780dc..093bbd8 100644
--- a/packages/engine/src/vpn/check.test.ts
+++ b/packages/engine/src/vpn/check.test.ts
@@ -200,3 +200,3 @@ describe('vpnCheck', () => {
         "qBittorrent's traffic leaves from 203.0.113.7, which is this host's own address: it does not go through the VPN",
-      hint: 'see docs/runbooks/vpn-down.md',
+      hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
     });
@@ -247,3 +247,3 @@ describe('vpnCheck', () => {
       message: `qBittorrent's traffic got no answer from ${TRACE}: curl: (28) Connection timed out after 10002 milliseconds`,
-      hint: 'the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md',
+      hint: 'the VPN is down, and nothing gets out (fail-closed); see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
     });
@@ -291,3 +291,3 @@ describe('vpnCheck', () => {
       status: 'down',
-      hint: 'the VPN is down; see docs/runbooks/vpn-down.md',
+      hint: 'the VPN is down; see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
     });
@@ -316,3 +316,3 @@ describe('vpnCheck', () => {
       expect(result.ok && result.checks.at(-1)?.hint).toBe(
-        'the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md',
+        'the VPN is down, and nothing gets out (fail-closed); see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
       );
@@ -334,3 +334,3 @@ describe('vpnCheck', () => {
       message: "Mediaplane could not read qBittorrent's route: sh: ip: not found",
-      hint: 'see docs/runbooks/vpn-down.md',
+      hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
     });
@@ -545,3 +545,3 @@ describe('vpnCheck', () => {
       status: 'down',
-      hint: 'the VPN is down; see docs/runbooks/vpn-down.md',
+      hint: 'the VPN is down; see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
     });
@@ -630,2 +630,6 @@ describe('vpnCheck', () => {
       );
+      // The first thing to do is plain, and comes before the link.
+      expect(result.ok && result.checks[1]?.hint).toBe(
+        'run "mediaplane apply" to start Gluetun again, then see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md if it stops again',
+      );
       expect(calls).not.toContain('run qbittorrent sh as 65534:65534');
@@ -656,3 +660,3 @@ describe('vpnCheck', () => {
         message: `Gluetun is ${state}`,
-        hint: 'see docs/runbooks/vpn-down.md',
+        hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
       });
```

**Change** `packages/cli/src/vpn-check.test.ts`:

```diff
diff --git a/packages/cli/src/vpn-check.test.ts b/packages/cli/src/vpn-check.test.ts
index 418dbd9..c6d0d7d 100644
--- a/packages/cli/src/vpn-check.test.ts
+++ b/packages/cli/src/vpn-check.test.ts
@@ -34,3 +34,4 @@ const KEY = '0'.repeat(32);
 const TRACE = 'https://1.1.1.1/cdn-cgi/trace';
-const RUNBOOK = 'docs/runbooks/vpn-down.md';
+const RUNBOOK =
+  'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md';
 const COMPARED = 'Passed: qBittorrent reaches the internet only through the VPN.';
```

**Change** `packages/engine/src/apply/apply.test.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 15bb367..2e75828 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -129,2 +129,18 @@ function options(
 
+/** `docker`, with `service` stopped by hand until up starts it again. */
+function stoppedUntilUp(docker: Runtime, service: string): Runtime {
+  let started = false;
+  return {
+    ...docker,
+    containers: async () =>
+      (await docker.containers()).map((c) =>
+        !started && c.service === service ? { ...c, state: 'exited', health: '' } : c,
+      ),
+    up: (seconds, values) => {
+      started = true;
+      return docker.up(seconds, values);
+    },
+  };
+}
+
 describe('apply', () => {
@@ -255,4 +271,5 @@ describe('apply', () => {
     expect(result.plan.unhealthy).toEqual(['sonarr (starting)']);
-    // compose.yaml was already current, so only .env was written.
-    expect(result.actions[1]?.detail).toBe('wrote generated/.env');
+    // compose.yaml and .env were already current, as plan said: nothing was written.
+    expect(result.plan.files.filter((f) => f.status !== 'unchanged')).toEqual([]);
+    expect(result.actions[1]?.detail).toBe('none needed');
     expect(result.actions.map((a) => [a.step, a.result])).toEqual([
@@ -522,3 +539,3 @@ describe('apply', () => {
         message: 'docker compose up failed: fake: port is already allocated',
-        hint: 'run "mediaplane status" to see each app, fix the cause, then run apply again',
+        hint: 'run "mediaplane status" to see each app, fix the cause, then run apply again; see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/app-wont-start.md',
       },
@@ -640,2 +657,45 @@ describe('apply', () => {
 
+  it('writes no file on an apply that only starts a stopped app, as plan said', async () => {
+    const home = await makeHome();
+    const docker = fakeDocker(home);
+    expect((await apply(options(home, docker))).outcome).toBe('success');
+    const env = join(home, ENV_PATH);
+    const before = await stat(env);
+    // Plan's only change is to start Gluetun.
+    const result = await apply(options(home, stoppedUntilUp(docker, 'gluetun')));
+    expect(result.outcome).toBe('success');
+    expect(result.plan.containers).toContainEqual({
+      service: 'gluetun',
+      action: 'start',
+    });
+    expect(result.plan.files.filter((f) => f.status !== 'unchanged')).toEqual([]);
+    expect(result.actions[1]).toEqual({
+      step: 'files',
+      result: 'done',
+      detail: 'none needed',
+    });
+    const after = await stat(env);
+    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
+    expect(await modeOf(env)).toBe(0o600);
+  });
+
+  it("rewrites an unchanged .env it can't make private, as apply did before", async () => {
+    const home = await makeHome();
+    const docker = fakeDocker(home);
+    expect((await apply(options(home, docker))).outcome).toBe('success');
+    const env = join(home, ENV_PATH);
+    const before = await stat(env);
+    // Another user's file, as after a run with sudo: chmod() is refused, a rename isn't.
+    refuseChmodOf(env);
+    const result = await apply(options(home, stoppedUntilUp(docker, 'gluetun')));
+    expect(result.outcome).toBe('success');
+    expect(result.actions[1]).toEqual({
+      step: 'files',
+      result: 'done',
+      detail: 'wrote generated/.env',
+    });
+    expect((await stat(env)).ino).not.toBe(before.ino);
+    expect(await modeOf(env)).toBe(0o600);
+  });
+
   it('lets an unexpected error taking the lock through', async () => {
@@ -654,3 +714,4 @@ describe('apply', () => {
 
-    // Prowlarr brings Byparr, which has no appdata folder.
+    // Prowlarr brings Byparr, which has no appdata folder. Neither has a secret, so .env
+    // stays as it was.
     await writeFile(join(home, 'stack.yaml'), `${STACK}  prowlarr: {}\n`);
@@ -658,5 +719,3 @@ describe('apply', () => {
     expect(second.outcome).toBe('success');
-    expect(second.actions[1]?.detail).toBe(
-      'wrote generated/compose.yaml and generated/.env',
-    );
+    expect(second.actions[1]?.detail).toBe('wrote generated/compose.yaml');
     expect(await readFile(join(home, COMPOSE_PREV_PATH), 'utf8')).toBe(first);
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/vpn/check.test.ts packages/cli/src/vpn-check.test.ts packages/engine/src/apply/apply.test.ts`

Expected: FAIL: the tests that expect a hint to give the runbook's URL (`see
docs/runbooks/vpn-down.md` comes instead), Gluetun stopped to say `run "mediaplane apply"
…` first, and an apply that changes no file to write none (`wrote generated/.env` comes
instead of `none needed`). On the dev box: 3 files, 19 tests failed, 91 passed. The test
of an unchanged `.env` whose `chmod` is refused passes already: the code before B rewrote
`.env` every time.

- [ ] **Step 7: Runbook URLs, `.env` only when it changed, and `codeOf`**

**Create** `packages/engine/src/runbooks.ts`:

```ts
/**
 * Where the runbooks are published. A hint gives this address, not a path in the repo:
 * someone running Mediaplane's image has no copy of the repo.
 */
export const RUNBOOKS_URL =
  'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks';

/** The runbooks (docs/runbooks/<name>.md). */
export type Runbook = 'app-wont-start' | 'vpn-down' | 'wiring-failed';

/** A runbook's address on GitHub. */
export function runbookUrl(name: Runbook): string {
  return `${RUNBOOKS_URL}/${name}.md`;
}
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index d9dd223..829c69e 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -2,4 +2,6 @@ export * from './diagnostics';
 export * from './paths';
+export * from './runbooks';
 export * from './util/atomic';
 export * from './util/path';
+export * from './util/error-code';
 export * from './state/lock';
```

**Change** `packages/engine/src/vpn/check.ts`:

```diff
diff --git a/packages/engine/src/vpn/check.ts b/packages/engine/src/vpn/check.ts
index 4d57314..914b147 100644
--- a/packages/engine/src/vpn/check.ts
+++ b/packages/engine/src/vpn/check.ts
@@ -9,2 +9,3 @@ import { STACK_PATH } from '../paths';
 import { resolveStack, type ResolvedApp } from '../resolver/resolve';
+import { runbookUrl } from '../runbooks';
 import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
@@ -24,3 +25,3 @@ import {
 /** Where a failed check sends you. */
-export const VPN_RUNBOOK = 'docs/runbooks/vpn-down.md';
+export const VPN_RUNBOOK = runbookUrl('vpn-down');
 
@@ -354,3 +355,7 @@ function gluetunCheck(
         : `Gluetun ${state}`,
-      hint: `see ${VPN_RUNBOOK}`,
+      // A Gluetun with no process is started again by apply; a paused or restarting one
+      // needs looking at.
+      hint: gluetunStopped(gluetun)
+        ? `run "mediaplane apply" to start Gluetun again, then see ${VPN_RUNBOOK} if it stops again`
+        : `see ${VPN_RUNBOOK}`,
     };
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index c508447..13c4978 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -1 +1,2 @@
+import { chmod } from 'node:fs/promises';
 import { join, resolve } from 'node:path';
@@ -14,2 +15,3 @@ import { plan, planStack, type PlanOptions, type PlanResult } from '../plan/plan
 import { renderEnvFile } from '../render/env';
+import { runbookUrl } from '../runbooks';
 import { prestartFilesFor } from '../render/prestart';
@@ -22,2 +24,3 @@ import { acquireLock, LockedError, type Lock } from '../state/lock';
 import { writeFileAtomic } from '../util/atomic';
+import { codeOf } from '../util/error-code';
 import { readIfExists } from '../util/fs';
@@ -73,3 +76,3 @@ const STEP_HINTS: Record<ApplyStep, string> = {
   ownership: "the error comes from the app's own image; run apply again to retry",
-  start: 'run "mediaplane status" to see each app, fix the cause, then run apply again',
+  start: `run "mediaplane status" to see each app, fix the cause, then run apply again; see ${runbookUrl('app-wont-start')}`,
   verify: 'run "mediaplane plan" to see what is still different',
@@ -149,6 +152,7 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     );
-    return [
-      `wrote ${written.join(' and ')}`,
+    const done = [
+      ...(written.length === 0 ? [] : [`wrote ${written.join(' and ')}`]),
       ...(created.length === 0 ? [] : [`created ${created.join(', ')}`]),
-    ].join('; ');
+    ];
+    return done.length === 0 ? NONE_NEEDED : done.join('; ');
   });
@@ -288,4 +292,5 @@ async function startFailure(runtime: Runtime, composeError: string): Promise<str
 /**
- * compose.yaml when it changed, keeping the previous one as compose.prev.yaml (spec §5
- * step 6), and .env. Returns the paths it wrote, relative to the home.
+ * compose.yaml and .env, each only when it changed, as plan says, keeping the previous
+ * compose.yaml as compose.prev.yaml (spec §5 step 6). An unchanged .env is still made
+ * private again. Returns the paths it wrote, relative to the home.
  */
@@ -306,3 +311,7 @@ async function writeGenerated(
   }
-  await writeFileAtomic(join(home, ENV_PATH), env, 0o600);
+  const envPath = join(home, ENV_PATH);
+  if ((await readIfExists(envPath)) === env && (await madePrivate(envPath))) {
+    return written;
+  }
+  await writeFileAtomic(envPath, env, 0o600);
   written.push(ENV_PATH);
@@ -311,2 +320,16 @@ async function writeGenerated(
 
+/**
+ * chmod 0600, or false where only the owner may and this user isn't it (after a run with
+ * sudo): the rewrite, as before Slice 3b, makes it this user's and private.
+ */
+async function madePrivate(path: string): Promise<boolean> {
+  try {
+    await chmod(path, 0o600);
+    return true;
+  } catch (cause) {
+    if (codeOf(cause) === 'EPERM') return false;
+    throw cause;
+  }
+}
+
 function succeeded(result: CommandResult, prefix = ''): void {
```

**Change** `docs/runbooks/app-wont-start.md`:

```diff
diff --git a/docs/runbooks/app-wont-start.md b/docs/runbooks/app-wont-start.md
index 1fdae04..95d8e0c 100644
--- a/docs/runbooks/app-wont-start.md
+++ b/docs/runbooks/app-wont-start.md
@@ -11,3 +11,3 @@
   error: these apps did not start healthy: sonarr (unhealthy). Compose said: …
-    hint: run "mediaplane status" to see each app, fix the cause, then run apply again
+    hint: run "mediaplane status" to see each app, fix the cause, then run apply again; see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/app-wont-start.md
 
```

**Change** `docs/runbooks/vpn-down.md`:

````diff
diff --git a/docs/runbooks/vpn-down.md b/docs/runbooks/vpn-down.md
index 2be2648..dab2562 100644
--- a/docs/runbooks/vpn-down.md
+++ b/docs/runbooks/vpn-down.md
@@ -21,5 +21,5 @@ failure, and worse: see [A leak](#a-leak).
     DOWN  qBittorrent's traffic got no answer from https://1.1.1.1/cdn-cgi/trace: curl: (28) Connection timed out after 10002 milliseconds
-          hint: the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md
+          hint: the VPN is down, and nothing gets out (fail-closed); see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md
 
-  VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See docs/runbooks/vpn-down.md.
+  VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md.
   ```
@@ -30,3 +30,3 @@ failure, and worse: see [A leak](#a-leak).
   there was no route at all. Otherwise it says
-  `VPN down: the checks marked DOWN say what failed. See docs/runbooks/vpn-down.md.`
+  `VPN down: the checks marked DOWN say what failed.`, then gives this runbook's address.
 
````

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/vpn packages/engine/src/apply packages/cli`

Expected: PASS.

- [ ] **Step 9: C. Write the failing tests for `init`**

`folders.test.ts` covers the data folder. `init.test.ts` covers the home check, the
notes, the key and the data folder's next steps. `prompt.test.ts` covers the hidden
prompt. The test key is `'A'.repeat(43) + '='`, and the tests check it never shows in
the output.

**Create** `packages/cli/src/folders.test.ts`:

```ts
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { dataSteps, prepareDataFolder } from './folders';

const ME = { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 };

describe('prepareDataFolder', () => {
  it('creates a missing folder, with its parents', async () => {
    const data = join(await tempDir('mediaplane-data-'), 'srv', 'data');
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toBe('created');
    expect((await stat(data)).isDirectory()).toBe(true);
  });

  it('finds a folder this user can write to ready, and changes nothing about it', async () => {
    const data = await tempDir('mediaplane-data-');
    await chmod(data, 0o750);
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toBe('ready');
    expect((await stat(data)).mode & 0o777).toBe(0o750);
  });

  it('leaves the check to you when the apps run as someone else', async () => {
    const data = await tempDir('mediaplane-data-');
    const other = { uid: ME.uid + 1, gid: ME.gid };
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, other)).toBe('check');
  });

  it('refuses a file where the folder should be', async () => {
    const data = join(await tempDir('mediaplane-data-'), 'data');
    await writeFile(data, '');
    expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toEqual({
      blocked: 'it is not a folder',
    });
  });

  // root can write anywhere, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    'says why it could not create the folder',
    async () => {
      const parent = await tempDir('mediaplane-data-');
      await chmod(parent, 0o555);
      try {
        const data = join(parent, 'data');
        expect(await prepareDataFolder(data, '/opt/mediaplane', false, ME)).toEqual({
          blocked: 'permission denied',
        });
        await expect(stat(data)).rejects.toThrow();
      } finally {
        // So that the temporary folder can be removed.
        await chmod(parent, 0o755);
      }
    },
  );

  it("in the image, leaves a folder outside the home alone: it is the host's", async () => {
    const outside = join(await tempDir('mediaplane-data-'), 'data');
    expect(await prepareDataFolder(outside, '/opt/mediaplane', true, ME)).toBe('unseen');
    await expect(stat(outside)).rejects.toThrow();
    // Inside the home, the container sees the host's folder, so it can make it.
    const home = await tempDir('mediaplane-home-');
    await mkdir(join(home, 'media'));
    const inside = join(home, 'media', 'data');
    expect(await prepareDataFolder(inside, home, true, ME)).toBe('created');
  });
});

describe('dataSteps', () => {
  const who = `uid ${String(ME.uid)} (gid ${String(ME.gid)})`;
  const owner = `${String(ME.uid)}:${String(ME.gid)}`;

  it('needs no step for a folder that is ready, or that this user created', () => {
    expect(dataSteps('/srv/data', 'ready', ME)).toEqual([]);
    expect(dataSteps('/srv/data', 'created', ME)).toEqual([]);
  });

  it('gives the commands, quoted for the shell, for a folder it could not create', () => {
    expect(dataSteps('/srv/data', { blocked: 'permission denied' }, ME)).toEqual([
      `Create /srv/data (permission denied), for ${who}: sudo mkdir -p /srv/data && sudo chown ${owner} /srv/data`,
    ]);
    expect(dataSteps("/srv/my data's", { blocked: 'permission denied' }, ME)).toEqual([
      `Create /srv/my data's (permission denied), for ${who}: sudo mkdir -p '/srv/my data'\\''s' && sudo chown ${owner} '/srv/my data'\\''s'`,
    ]);
  });

  it("keeps today's step for a folder it can't see, and asks you to check one it found", () => {
    expect(dataSteps('/srv/data', 'unseen', ME)).toEqual([
      `Create /srv/data and make sure ${who} can write to it.`,
    ]);
    expect(dataSteps('/srv/data', 'check', ME)).toEqual([
      `Make sure ${who} can write to /srv/data.`,
    ]);
  });

  it('says to give away a folder it created as someone else, such as root', () => {
    const apps = { uid: ME.uid + 1, gid: ME.gid + 1 };
    expect(dataSteps('/srv/data', 'created', apps)).toEqual([
      `Give /srv/data to uid ${String(apps.uid)} (gid ${String(apps.gid)}), whom the apps run as: sudo chown ${String(apps.uid)}:${String(apps.gid)} /srv/data`,
    ]);
  });
});
```

**Change** `packages/cli/src/init.test.ts`:

```diff
diff --git a/packages/cli/src/init.test.ts b/packages/cli/src/init.test.ts
index aeeef7c..b86f1f1 100644
--- a/packages/cli/src/init.test.ts
+++ b/packages/cli/src/init.test.ts
@@ -1,2 +1,2 @@
-import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
+import { chmod, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
 import type * as FsPromises from 'node:fs/promises';
@@ -11,2 +11,4 @@ import {
 import { beforeEach, describe, expect, it, vi } from 'vitest';
+import type { DataFolder } from './folders';
+import { NOTES } from './init';
 import { PromptCancelled } from './prompt';
@@ -50,6 +52,13 @@ function fillDiskOnNextWrite(): void {
 
-function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
+/**
+ * A terminal that answers `answers` to its questions, in order, and `pasted` to its hidden
+ * ones; without `answers`, no terminal. `shown` is everything on the screen, in order:
+ * what init printed, and each question, with a hidden one's answer never in it.
+ */
+function capture(answers?: string[], env: NodeJS.ProcessEnv = {}, pasted: string[] = []) {
   const out: string[] = [];
   const err: string[] = [];
+  const shown: string[] = [];
   const questions: string[] = [];
+  const hidden: string[] = [];
   const io: Io = {
@@ -57,2 +66,3 @@ function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
       out.push(text);
+      shown.push(text);
     },
@@ -60,2 +70,3 @@ function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
       err.push(text);
+      shown.push(text);
     },
@@ -67,4 +78,10 @@ function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
             questions.push(question);
+            shown.push(question);
             return Promise.resolve(answers.shift() ?? '');
           },
+          askSecret: (question: string) => {
+            hidden.push(question);
+            shown.push(question);
+            return Promise.resolve(pasted.shift() ?? '');
+          },
         }),
@@ -74,4 +91,6 @@ function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
     questions,
+    hidden,
     stdout: () => out.join(''),
     stderr: () => err.join(''),
+    shown: () => shown.join(''),
   };
@@ -79,3 +98,7 @@ function capture(answers?: string[], env: NodeJS.ProcessEnv = {}) {
 
-const deps = (cloud?: string): Partial<CliDeps> => ({
+const deps = (
+  cloud?: string,
+  dataFolder: DataFolder = 'unseen',
+  folders: string[] = [],
+): Partial<CliDeps> => ({
   host: () =>
@@ -84,2 +107,7 @@ const deps = (cloud?: string): Partial<CliDeps> => ({
   probe: () => fakeProbe(),
+  // Never the host's own folders: /srv/data is only a name here.
+  dataFolder: (path) => {
+    folders.push(path);
+    return Promise.resolve(dataFolder);
+  },
 });
@@ -624,2 +652,60 @@ describe('mediaplane init', () => {
 
+  // root can write anywhere, so there is nothing to test when running as root.
+  it.skipIf(process.getuid?.() === 0)(
+    "says how to get a home it can't create, before it asks anything",
+    async () => {
+      const parent = await newHome();
+      await chmod(parent, 0o555);
+      try {
+        const home = join(parent, 'mediaplane');
+        const term = capture([]);
+        expect(await run(['init', '--home', home], term.io, deps())).toBe(1);
+        expect(term.questions).toEqual([]);
+        expect(term.stderr()).toBe(
+          `error: can't create ${home} (permission denied): pass --home <a folder of yours>, or create it first with "sudo mkdir -p ${home} && sudo chown $USER: ${home}"\n`,
+        );
+        // The same with flags only, and as JSON.
+        const json = capture();
+        const flags = ['--media-server', 'jellyfin', '--data', '/srv/data', '--json'];
+        expect(await run(['init', '--home', home, ...flags], json.io, deps())).toBe(1);
+        expect(JSON.parse(json.stdout())).toMatchObject({
+          ok: false,
+          error: { message: expect.stringContaining(`can't create ${home}`) as string },
+        });
+      } finally {
+        // So that the temporary folder can be removed.
+        await chmod(parent, 0o755);
+      }
+    },
+  );
+
+  it.skipIf(process.getuid?.() === 0)(
+    "says how to get a home it can't write into, before it asks anything",
+    async () => {
+      const home = await newHome();
+      await chmod(home, 0o555);
+      try {
+        const term = capture([]);
+        expect(await run(['init', '--home', home], term.io, deps())).toBe(1);
+        expect(term.questions).toEqual([]);
+        expect(term.stderr()).toBe(
+          `error: can't write into ${home} (permission denied): pass --home <a folder of yours>, or make it yours with "sudo chown $USER: ${home}"\n`,
+        );
+      } finally {
+        await chmod(home, 0o755);
+      }
+    },
+  );
+
+  it('refuses a home that is a file, before it asks anything', async () => {
+    const home = join(await newHome(), 'stack.yaml');
+    await writeFile(home, 'version: 1\n');
+    const term = capture([]);
+    expect(await run(['init', '--home', home], term.io, deps())).toBe(1);
+    expect(term.questions).toEqual([]);
+    expect(term.stderr()).toBe(
+      `error: ${home} is not a folder, so init can't put the Mediaplane home there: pass --home <a folder of yours>\n`,
+    );
+  });
+
   it('refuses --vpn-addresses without a provider as soon as the provider is answered', async () => {
@@ -857 +943,178 @@ describe('mediaplane init', () => {
 });
+
+describe('mediaplane init: what each question is for', () => {
+  /** Every answer for a VPN stack on the LAN, with your own password file. */
+  const EVERY_QUESTION = [
+    'plex',
+    '/srv/data',
+    'mullvad',
+    '',
+    'lan',
+    'y',
+    'y',
+    'admin',
+    'n',
+    '',
+  ];
+
+  it('says what each question is for, just before it, in lines of 60 columns at most', async () => {
+    const term = capture([...EVERY_QUESTION]);
+    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(0);
+    const shown = term.shown();
+    const before = (note: readonly string[], question: string) => {
+      expect(shown).toContain(`${note.join('\n')}\n${question}`);
+    };
+    before(NOTES.mediaServer, 'Media server, jellyfin or plex [jellyfin]: ');
+    before(NOTES.dataPath, 'Data folder for downloads and media [/srv/data]: ');
+    before(NOTES.vpnProvider, 'VPN provider for qBittorrent');
+    before(NOTES.vpnAddresses, "Your provider's WireGuard address");
+    before(NOTES.wireguardKey, 'Paste your WireGuard private key');
+    before(NOTES.bind, 'Publish the web UIs on your LAN');
+    before(NOTES.lanSubnet, 'Your LAN looks like 192.168.1.0/24. Use it? [Y/n] ');
+    before(NOTES.loginOnLan, 'Ask for a login from your own network too? [Y/n] ');
+    before(NOTES.adminUser, 'Admin user name for the apps [admin]: ');
+    before(NOTES.adminPassword, 'Generate the admin password? [Y/n] ');
+    before(NOTES.passwordFile, 'File holding your password, inside the Mediaplane home');
+    for (const line of Object.values(NOTES).flat()) {
+      expect(line.length, line).toBeLessThanOrEqual(60);
+    }
+  });
+
+  it('says it once, not again after an answer that will not do', async () => {
+    const term = capture(['emby', 'jellyfin', '/srv/data', '', 'localhost', '', '']);
+    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(0);
+    expect(term.shown().split(NOTES.mediaServer[0]).length - 1).toBe(1);
+    expect(term.questions.slice(0, 2)).toEqual([
+      'Media server, jellyfin or plex [jellyfin]: ',
+      'Media server, jellyfin or plex [jellyfin]: ',
+    ]);
+  });
+
+  it('says nothing about questions it does not ask: none without a terminal or with --json', async () => {
+    const flags = ['--media-server', 'jellyfin', '--data', '/srv/data'];
+    for (const extra of [[], ['--json']]) {
+      const term = capture(extra.length === 0 ? undefined : []);
+      const args = ['init', '--home', await newHome(), ...flags, ...extra];
+      expect(await run(args, term.io, deps())).toBe(0);
+      for (const line of Object.values(NOTES).flat()) {
+        expect(term.shown()).not.toContain(line);
+      }
+    }
+  });
+});
+
+describe('mediaplane init: the WireGuard key', () => {
+  const FAKE_KEY = `${'A'.repeat(43)}=`;
+  const PASTE =
+    'Paste your WireGuard private key (nothing shows as you paste; Enter to do it later): ';
+  /** Jellyfin, /srv/data, a provider, no address, localhost, the admin, generated. */
+  const VPN_ANSWERS = ['jellyfin', '/srv/data', 'mullvad', '', 'localhost', '', ''];
+
+  it('takes the key pasted on a hidden prompt, and keeps it in secrets/wg.key for you only', async () => {
+    const home = await newHome();
+    const term = capture([...VPN_ANSWERS], {}, [`  ${FAKE_KEY}  `]);
+    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
+    expect(term.hidden).toEqual([PASTE]);
+    const keyPath = join(home, 'secrets', 'wg.key');
+    expect(await readFile(keyPath, 'utf8')).toBe(`${FAKE_KEY}\n`);
+    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
+    expect((await stackIn(home)).vpn?.private_key).toEqual({ file: 'secrets/wg.key' });
+    expect(term.stdout()).toContain(`Saved your WireGuard private key in ${keyPath}.`);
+    expect(term.stdout()).not.toContain('Put your VPN');
+    expect(term.shown()).not.toContain(FAKE_KEY);
+  });
+
+  it('asks again for what is not a key, without repeating it', async () => {
+    const home = await newHome();
+    const notKeys = ['not-a-fake-key', `${'A'.repeat(42)}==`, 'A'.repeat(44)];
+    const term = capture([...VPN_ANSWERS], {}, [...notKeys, FAKE_KEY]);
+    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
+    expect(term.hidden).toEqual([PASTE, PASTE, PASTE, PASTE]);
+    expect(term.stderr()).toBe(
+      'That is not a WireGuard private key, which is 44 characters of base64 ending in "=". Paste it again, or press Enter to do it later.\n'.repeat(
+        3,
+      ),
+    );
+    for (const typed of notKeys) expect(term.shown()).not.toContain(typed);
+    expect(await readFile(join(home, 'secrets', 'wg.key'), 'utf8')).toBe(`${FAKE_KEY}\n`);
+  });
+
+  it('leaves it for later on Enter, as a next step', async () => {
+    const home = await newHome();
+    const term = capture([...VPN_ANSWERS], {}, ['']);
+    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
+    expect(term.hidden).toEqual([PASTE]);
+    await expect(stat(join(home, 'secrets', 'wg.key'))).rejects.toThrow();
+    expect(term.stdout()).toContain(
+      `Put your VPN's WireGuard private key in ${join(home, 'secrets', 'wg.key')}.`,
+    );
+  });
+
+  it('never asks for one you already have, and never overwrites it', async () => {
+    const home = await newHome();
+    await real.mkdir(join(home, 'secrets'));
+    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-key-of-yours\n');
+    const term = capture([...VPN_ANSWERS], {}, [FAKE_KEY]);
+    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
+    expect(term.hidden).toEqual([]);
+    expect(await readFile(join(home, 'secrets', 'wg.key'), 'utf8')).toBe(
+      'fake-key-of-yours\n',
+    );
+  });
+
+  it('never asks without a VPN, without a terminal, or with --json', async () => {
+    const none = capture(['jellyfin', '/srv/data', '', 'localhost', '', ''], {}, [
+      FAKE_KEY,
+    ]);
+    expect(await run(['init', '--home', await newHome()], none.io, deps())).toBe(0);
+    expect(none.hidden).toEqual([]);
+    const flags = ['--media-server', 'jellyfin', '--data', '/srv/data'];
+    const vpn = ['--vpn-provider', 'mullvad'];
+    const json = capture([], {}, [FAKE_KEY]);
+    const args = ['init', '--home', await newHome(), ...flags, ...vpn, '--json'];
+    expect(await run(args, json.io, deps())).toBe(0);
+    expect(json.hidden).toEqual([]);
+    const script = capture(undefined);
+    expect(
+      await run(['init', '--home', await newHome(), ...flags, ...vpn], script.io, deps()),
+    ).toBe(0);
+    expect(script.stdout()).toContain("Put your VPN's WireGuard private key in");
+  });
+});
+
+describe('mediaplane init: the data folder', () => {
+  const FLAGS = ['--media-server', 'jellyfin', '--data', '/srv/data'];
+  const { uid, gid } = invokingUser();
+  const who = `uid ${String(uid)} (gid ${String(gid)})`;
+
+  it('creates it when it can, and needs no step for it then', async () => {
+    const home = await newHome();
+    const folders: string[] = [];
+    const term = capture();
+    const args = ['init', '--home', home, ...FLAGS];
+    expect(await run(args, term.io, deps(undefined, 'created', folders))).toBe(0);
+    expect(folders).toEqual(['/srv/data']);
+    expect(term.stdout()).toContain('Created /srv/data for your downloads and media.');
+    expect(term.stdout()).not.toContain('/srv/data and make sure');
+  });
+
+  it("gives the commands to create it when it can't", async () => {
+    const term = capture();
+    const args = ['init', '--home', await newHome(), ...FLAGS];
+    const blocked = { blocked: 'permission denied' };
+    expect(await run(args, term.io, deps(undefined, blocked))).toBe(0);
+    expect(term.stdout()).toContain(
+      `Create /srv/data (permission denied), for ${who}: sudo mkdir -p /srv/data && sudo chown ${String(uid)}:${String(gid)} /srv/data`,
+    );
+  });
+
+  it('says to check a folder it found but can not vouch for, and nothing for a ready one', async () => {
+    const args = async () => ['init', '--home', await newHome(), ...FLAGS];
+    const check = capture();
+    expect(await run(await args(), check.io, deps(undefined, 'check'))).toBe(0);
+    expect(check.stdout()).toContain(`Make sure ${who} can write to /srv/data.`);
+    const ready = capture();
+    expect(await run(await args(), ready.io, deps(undefined, 'ready'))).toBe(0);
+    expect(ready.stdout()).not.toContain('/srv/data');
+  });
+});
```

**Change** `packages/cli/src/prompt.test.ts`:

```diff
diff --git a/packages/cli/src/prompt.test.ts b/packages/cli/src/prompt.test.ts
index 88aad73..53911be 100644
--- a/packages/cli/src/prompt.test.ts
+++ b/packages/cli/src/prompt.test.ts
@@ -2,3 +2,3 @@ import { PassThrough } from 'node:stream';
 import { describe, expect, it } from 'vitest';
-import { PromptCancelled, terminalAsk } from './prompt';
+import { PromptCancelled, terminalAsk, terminalAskSecret } from './prompt';
 
@@ -69 +69,24 @@ describe('terminalAsk', () => {
 });
+
+describe('terminalAskSecret', () => {
+  const FAKE_KEY = `${'A'.repeat(43)}=`;
+
+  it.each([false, true])(
+    'returns what was pasted, and never shows it (terminal: %s)',
+    async (isTerminal) => {
+      const { input, output, shown } = terminal();
+      const answer = terminalAskSecret(input, output, isTerminal)('Paste your key: ');
+      input.write(`${FAKE_KEY}\r\n`);
+      expect(await settled(answer)).toBe(`answered "${FAKE_KEY}"`);
+      expect(shown()).toBe('Paste your key: \n');
+    },
+  );
+
+  it('is cancelled by Ctrl-C, showing nothing it was given', async () => {
+    const { input, output, shown } = terminal();
+    const answer = terminalAskSecret(input, output, true)('Paste your key: ');
+    input.write('AAAA\x03');
+    expect(await settled(answer)).toBe('cancelled');
+    expect(shown()).not.toContain('AAAA');
+  });
+});
```

- [ ] **Step 10: Run them to verify they fail**

Run: `pnpm vitest run packages/cli/src/folders.test.ts packages/cli/src/init.test.ts packages/cli/src/prompt.test.ts`

Expected: FAIL: `folders.test.ts` can't load `./folders`; `prompt.test.ts`'s three
`terminalAskSecret` tests ("terminalAskSecret is not a function"); and `init.test.ts`'s
tests of the home, the notes, the key and the data folder. On the dev box, as a user that
isn't root: 3 files, 15 tests failed, 76 passed.

- [ ] **Step 11: The home check, the data folder, the notes and the key**

**Create** `packages/cli/src/folders.ts`:

```ts
import { access, constants, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { codeOf } from '@mediaplane/engine';

/** A failed filesystem call's code, in words. */
const REASONS: Readonly<Record<string, string>> = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EROFS: 'a read-only filesystem',
};

/** A failed filesystem call, in words. */
function reasonOf(cause: unknown): string {
  const code = codeOf(cause);
  return (code === undefined ? undefined : REASONS[code]) ?? code ?? 'an error';
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why init can't write the home, with what to do instead, or undefined. A home that
 * exists must be a folder this user can write into; a missing one, a folder whose
 * nearest existing parent lets this user create it, as `mkdir -p` would.
 */
export async function homeProblem(home: string): Promise<string | undefined> {
  let nearest = home;
  for (;;) {
    try {
      if (!(await stat(nearest)).isDirectory()) {
        return `${nearest} is not a folder, so init can't put the Mediaplane home there: pass --home <a folder of yours>`;
      }
      break;
    } catch (cause) {
      if (codeOf(cause) !== 'ENOENT' || dirname(nearest) === nearest) {
        return homeBlocked(home, false, cause);
      }
      nearest = dirname(nearest);
    }
  }
  try {
    await access(nearest, constants.W_OK | constants.X_OK);
    return undefined;
  } catch (cause) {
    return homeBlocked(home, nearest === home, cause);
  }
}

/** The message for a home this user can't create (`exists` false) or write into. */
function homeBlocked(home: string, exists: boolean, cause: unknown): string {
  const reason = reasonOf(cause);
  return exists
    ? `can't write into ${home} (${reason}): pass --home <a folder of yours>, or make it yours with "sudo chown $USER: ${home}"`
    : `can't create ${home} (${reason}): pass --home <a folder of yours>, or create it first with "sudo mkdir -p ${home} && sudo chown $USER: ${home}"`;
}

/**
 * The data folder, made ready where init can: `created` (mkdir -p, as this user), `ready`
 * (it exists, and this user, whom the apps run as, can write to it), `check` (it exists,
 * but init can't tell whether the apps' user can write to it), `unseen` (in Mediaplane's
 * image, a folder outside the home is the host's, out of the container's sight), or why
 * it couldn't be created.
 */
export type DataFolder = 'created' | 'ready' | 'check' | 'unseen' | { blocked: string };

/**
 * Make the data folder ready: create it, with its parents, when it is missing and this
 * user may. It never changes an owner or a mode. `inImage`: Mediaplane runs from its
 * image, which sees nothing of the host's folders but the home.
 */
export async function prepareDataFolder(
  path: string,
  home: string,
  inImage: boolean,
  user: { uid: number; gid: number },
): Promise<DataFolder> {
  if (inImage && path !== home && !path.startsWith(`${home}/`)) return 'unseen';
  let isFolder: boolean;
  try {
    isFolder = (await stat(path)).isDirectory();
  } catch (cause) {
    if (codeOf(cause) !== 'ENOENT') return { blocked: reasonOf(cause) };
    try {
      await mkdir(path, { recursive: true });
      return 'created';
    } catch (failure) {
      return { blocked: reasonOf(failure) };
    }
  }
  if (!isFolder) return { blocked: 'it is not a folder' };
  if (process.getuid?.() !== user.uid) return 'check';
  try {
    await access(path, constants.W_OK | constants.X_OK);
    return 'ready';
  } catch {
    return 'check';
  }
}

/** The next steps the data folder still needs, if any. */
export function dataSteps(
  path: string,
  folder: DataFolder,
  user: { uid: number; gid: number },
): string[] {
  const who = `uid ${String(user.uid)} (gid ${String(user.gid)})`;
  const owner = `${String(user.uid)}:${String(user.gid)}`;
  const quoted = shellQuote(path);
  if (folder === 'ready') return [];
  if (folder === 'created') {
    // Made as this user: only someone else, such as root, leaves it to give away.
    return process.getuid?.() === user.uid
      ? []
      : [`Give ${path} to ${who}, whom the apps run as: sudo chown ${owner} ${quoted}`];
  }
  if (folder === 'check') return [`Make sure ${who} can write to ${path}.`];
  if (folder === 'unseen') {
    return [`Create ${path} and make sure ${who} can write to it.`];
  }
  return [
    `Create ${path} (${folder.blocked}), for ${who}: sudo mkdir -p ${quoted} && sudo chown ${owner} ${quoted}`,
  ];
}

/** `path` as a shell word: as it is when that is safe, else in single quotes. */
function shellQuote(path: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
```

**Change** `packages/cli/src/init.ts`:

```diff
diff --git a/packages/cli/src/init.ts b/packages/cli/src/init.ts
index 7b92e32..d6b359d 100644
--- a/packages/cli/src/init.ts
+++ b/packages/cli/src/init.ts
@@ -14,2 +14,3 @@ import {
 } from '@mediaplane/engine';
+import { dataSteps, exists, homeProblem, type DataFolder } from './folders';
 import { printDiagnostics, printError } from './output';
@@ -43,2 +44,7 @@ export async function init(
   host: HostFacts,
+  dataFolder: (
+    path: string,
+    home: string,
+    user: { uid: number; gid: number },
+  ) => Promise<DataFolder>,
 ): Promise<number> {
@@ -47,3 +53,3 @@ export async function init(
   const stackPath = join(home, STACK_PATH);
-  const answers = await gatherAnswers(options, io, host).catch((cause: unknown) => {
+  const gathered = await gatherAnswers(options, io, host).catch((cause: unknown) => {
     if (cause instanceof PromptCancelled) {
@@ -53,6 +59,7 @@ export async function init(
   });
-  if (typeof answers === 'string') {
-    printError(answers, { json: asJson }, io);
+  if (typeof gathered === 'string') {
+    printError(gathered, { json: asJson }, io);
     return 1;
   }
+  const { starter: answers, wireguardKey } = gathered;
   const text = starterStack(answers);
@@ -76,7 +83,13 @@ export async function init(
   await chmod(secrets, 0o700);
+  const keyPath = join(home, WG_KEY_FILE);
+  // Only if absent too: a key file of yours that appeared meanwhile stays.
+  const savedKey =
+    wireguardKey !== undefined &&
+    (await writeFileExclusive(keyPath, `${wireguardKey}\n`, 0o600));
+  const data = await dataFolder(answers.dataPath, home, answers.user);
 
   const next = [
-    ...(answers.vpnProvider === undefined
+    ...(answers.vpnProvider === undefined || savedKey
       ? []
-      : [`Put your VPN's WireGuard private key in ${join(secrets, 'wg.key')}.`]),
+      : [`Put your VPN's WireGuard private key in ${keyPath}.`]),
     ...(answers.mediaServer === 'plex'
@@ -89,3 +102,3 @@ export async function init(
         ]),
-    `Create ${answers.dataPath} and make sure uid ${String(answers.user.uid)} (gid ${String(answers.user.gid)}) can write to it.`,
+    ...dataSteps(answers.dataPath, data, answers.user),
     'Run "mediaplane plan" to check everything, then "mediaplane apply".',
@@ -100,2 +113,6 @@ export async function init(
   io.stdout(`Wrote ${stackPath}.\n`);
+  if (savedKey) io.stdout(`Saved your WireGuard private key in ${keyPath}.\n`);
+  if (data === 'created') {
+    io.stdout(`Created ${answers.dataPath} for your downloads and media.\n`);
+  }
   if (host.cloud !== undefined && answers.bind === 'localhost') {
@@ -132,2 +149,9 @@ interface Flags {
 
+/** What init asks for: the starter's answers, and a WireGuard key pasted on a terminal. */
+interface Answers {
+  starter: StarterAnswers;
+  /** Held in memory until it is written to secrets/wg.key: never printed or logged. */
+  wireguardKey: string | undefined;
+}
+
 async function gatherAnswers(
@@ -136,7 +160,8 @@ async function gatherAnswers(
   host: HostFacts,
-): Promise<StarterAnswers | string> {
+): Promise<Answers | string> {
   const ask = options.json === true ? undefined : io.ask;
+  const askSecret = ask === undefined ? undefined : io.askSecret;
   const defaultBind: Bind = host.cloud === undefined ? 'lan' : 'localhost';
   // Every flag that needs no question is checked first, so a typo costs no answers.
-  const flags = readFlags(options, host, defaultBind, ask !== undefined);
+  const flags = await readFlags(options, host, defaultBind, ask !== undefined);
   if (typeof flags === 'string') return flags;
@@ -145,21 +170,30 @@ async function gatherAnswers(
   let loginOnLan = options.loginOnLan;
+  let wireguardKey: string | undefined;
   if (ask !== undefined) {
-    mediaServer ??= await askUntil(
-      ask,
-      io,
-      'Media server, jellyfin or plex [jellyfin]: ',
-      (answer) => {
-        const choice = answer.toLowerCase() || 'jellyfin';
-        return isMediaServer(choice)
-          ? { value: choice }
-          : { problem: 'Please answer jellyfin or plex.' };
-      },
-    );
-    dataPath ??= await askUntil(
-      ask,
-      io,
-      'Data folder for downloads and media [/srv/data]: ',
-      (answer) => schemaCheck({ dataPath: answer || '/srv/data' }, answer || '/srv/data'),
-    );
+    if (mediaServer === undefined) {
+      explain(io, NOTES.mediaServer);
+      mediaServer = await askUntil(
+        ask,
+        io,
+        'Media server, jellyfin or plex [jellyfin]: ',
+        (answer) => {
+          const choice = answer.toLowerCase() || 'jellyfin';
+          return isMediaServer(choice)
+            ? { value: choice }
+            : { problem: 'Please answer jellyfin or plex.' };
+        },
+      );
+    }
+    if (dataPath === undefined) {
+      explain(io, NOTES.dataPath);
+      dataPath = await askUntil(
+        ask,
+        io,
+        'Data folder for downloads and media [/srv/data]: ',
+        (answer) =>
+          schemaCheck({ dataPath: answer || '/srv/data' }, answer || '/srv/data'),
+      );
+    }
     if (vpnProvider === undefined) {
+      explain(io, NOTES.vpnProvider);
       const answer = (
@@ -173,2 +207,3 @@ async function gatherAnswers(
     if (vpnProvider !== undefined && vpnAddresses === undefined) {
+      explain(io, NOTES.vpnAddresses);
       vpnAddresses = await askUntil<string | undefined>(
@@ -180,14 +215,40 @@ async function gatherAnswers(
     }
-    bind ??= await askUntil(
-      ask,
-      io,
-      `Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [${defaultBind}]: `,
-      (answer) => {
-        const choice = answer.toLowerCase() || defaultBind;
-        return isBind(choice)
-          ? { value: choice }
-          : { problem: 'Please answer lan or localhost.' };
-      },
-    );
+    // Pasted, never shown: the key stays off the screen, the scrollback and the logs.
+    if (
+      vpnProvider !== undefined &&
+      askSecret !== undefined &&
+      !(await exists(join(resolve(options.home), WG_KEY_FILE)))
+    ) {
+      explain(io, NOTES.wireguardKey);
+      wireguardKey = await askUntil<string | undefined>(
+        askSecret,
+        io,
+        'Paste your WireGuard private key (nothing shows as you paste; Enter to do it later): ',
+        (answer) =>
+          answer === ''
+            ? { value: undefined }
+            : isWireguardKey(answer)
+              ? { value: answer }
+              : {
+                  problem:
+                    'That is not a WireGuard private key, which is 44 characters of base64 ending in "=". Paste it again, or press Enter to do it later.',
+                },
+      );
+    }
+    if (bind === undefined) {
+      explain(io, NOTES.bind);
+      bind = await askUntil(
+        ask,
+        io,
+        `Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [${defaultBind}]: `,
+        (answer) => {
+          const choice = answer.toLowerCase() || defaultBind;
+          return isBind(choice)
+            ? { value: choice }
+            : { problem: 'Please answer lan or localhost.' };
+        },
+      );
+    }
     if (bind === 'lan' && lanSubnet === undefined) {
+      explain(io, NOTES.lanSubnet);
       lanSubnet = await askLanSubnet(ask, io, host);
@@ -202,2 +263,3 @@ async function gatherAnswers(
     if (bind === 'lan' && loginOnLan) {
+      explain(io, NOTES.loginOnLan);
       loginOnLan = !/^n/i.test(
@@ -206,25 +268,29 @@ async function gatherAnswers(
     }
-    adminUser ??= await askUntil(
-      ask,
-      io,
-      'Admin user name for the apps [admin]: ',
-      (answer) => schemaCheck({ adminUser: answer || 'admin' }, answer || 'admin'),
-    );
-    if (
-      adminPasswordFile === undefined &&
-      /^n/i.test((await ask('Generate the admin password? [Y/n] ')).trim())
-    ) {
-      adminPasswordFile = await askUntil(
+    if (adminUser === undefined) {
+      explain(io, NOTES.adminUser);
+      adminUser = await askUntil(
         ask,
         io,
-        `File holding your password, inside the Mediaplane home [${DEFAULT_PASSWORD_FILE}]: `,
-        (answer) => {
-          const file = answer || DEFAULT_PASSWORD_FILE;
-          const problem = passwordFileProblem(file);
-          return problem === undefined
-            ? { value: file }
-            : { problem: `That ${problem}.` };
-        },
+        'Admin user name for the apps [admin]: ',
+        (answer) => schemaCheck({ adminUser: answer || 'admin' }, answer || 'admin'),
       );
     }
+    if (adminPasswordFile === undefined) {
+      explain(io, NOTES.adminPassword);
+      if (/^n/i.test((await ask('Generate the admin password? [Y/n] ')).trim())) {
+        explain(io, NOTES.passwordFile);
+        adminPasswordFile = await askUntil(
+          ask,
+          io,
+          `File holding your password, inside the Mediaplane home [${DEFAULT_PASSWORD_FILE}]: `,
+          (answer) => {
+            const file = answer || DEFAULT_PASSWORD_FILE;
+            const problem = passwordFileProblem(file);
+            return problem === undefined
+              ? { value: file }
+              : { problem: `That ${problem}.` };
+          },
+        );
+      }
+    }
   }
@@ -238,13 +304,16 @@ async function gatherAnswers(
   return {
-    mediaServer,
-    dataPath,
-    vpnProvider,
-    vpnAddresses,
-    loginOnLan,
-    timezone: options.timezone,
-    user: invokingUser(),
-    bind,
-    lanSubnet,
-    adminUser: adminUser ?? 'admin',
-    adminPasswordFile,
+    starter: {
+      mediaServer,
+      dataPath,
+      vpnProvider,
+      vpnAddresses,
+      loginOnLan,
+      timezone: options.timezone,
+      user: invokingUser(),
+      bind,
+      lanSubnet,
+      adminUser: adminUser ?? 'admin',
+      adminPasswordFile,
+    },
+    wireguardKey,
   };
@@ -252,7 +321,72 @@ async function gatherAnswers(
 
+/**
+ * What each question is for, shown on a terminal just before it is first asked, at most
+ * 60 columns a line. The question line itself, with its [default], follows.
+ */
+export const NOTES = {
+  mediaServer: [
+    'Media server: jellyfin needs no account. plex needs a Plex',
+    "account; Mediaplane can't claim it for you until Slice 6.",
+  ],
+  dataPath: [
+    'Data folder: one folder for downloads and your library,',
+    'so finished downloads move instantly.',
+  ],
+  vpnProvider: [
+    "VPN provider: Gluetun's name for yours, such as mullvad or",
+    'surfshark. Leave it empty for no VPN.',
+  ],
+  vpnAddresses: [
+    "WireGuard address: the Address line of your provider's",
+    'WireGuard config file, if it has one.',
+  ],
+  wireguardKey: [
+    'WireGuard key: the PrivateKey line of that same file.',
+    'Mediaplane keeps it in secrets/wg.key, for you only.',
+  ],
+  bind: [
+    'Web pages: lan reaches other devices on your home network;',
+    'localhost reaches only this machine.',
+  ],
+  lanSubnet: [
+    'Your LAN: the network your other devices are on, as a',
+    'subnet such as 192.168.1.0/24.',
+  ],
+  loginOnLan: [
+    'Login: answer n to let devices on your LAN open the apps',
+    'without signing in.',
+  ],
+  adminUser: ["Admin user: one login for every app's web page."],
+  adminPassword: [
+    'Admin password: Mediaplane can generate a strong one, or',
+    'use your own, from a file in the Mediaplane home.',
+  ],
+  passwordFile: [
+    'Your password file: at least 12 characters. Put it there',
+    'before you run plan.',
+  ],
+} as const satisfies Record<string, readonly string[]>;
+
+/** Say what a question is for, on the terminal, just before it is asked. */
+function explain(io: Io, lines: readonly string[]): void {
+  io.stdout(`${lines.join('\n')}\n`);
+}
+
+/** Where init saves a WireGuard key pasted on a terminal; stack.yaml's vpn.private_key. */
+const WG_KEY_FILE = 'secrets/wg.key';
+
+/** A WireGuard key as wg and providers write it: 32 bytes in base64, 44 characters. */
+function isWireguardKey(text: string): boolean {
+  return (
+    /^[A-Za-z0-9+/]{43}=$/.test(text) &&
+    Buffer.from(text, 'base64').toString('base64') === text
+  );
+}
+
 /**
  * The flags that need no question, checked before the first one is asked: what is wrong
- * with them, named by flag, or what they decide.
+ * with them, named by flag, or what they decide. The home (--home, or its default) is
+ * one of them: answers are no use if init can't write stack.yaml there.
  */
-function readFlags(
+async function readFlags(
   options: InitOptions,
@@ -261,3 +395,5 @@ function readFlags(
   canAsk: boolean,
-): Flags | string {
+): Promise<Flags | string> {
+  const unwritable = await homeProblem(resolve(options.home));
+  if (unwritable !== undefined) return unwritable;
   const mediaServer = options.mediaServer?.trim().toLowerCase();
```

**Change** `packages/cli/src/prompt.ts`:

```diff
diff --git a/packages/cli/src/prompt.ts b/packages/cli/src/prompt.ts
index 35148c2..5e511f9 100644
--- a/packages/cli/src/prompt.ts
+++ b/packages/cli/src/prompt.ts
@@ -1,3 +1,3 @@
 import { createInterface } from 'node:readline/promises';
-import type { Readable, Writable } from 'node:stream';
+import { Writable, type Readable } from 'node:stream';
 
@@ -23,27 +23,61 @@ export function terminalAsk(
 ): (question: string) => Promise<string> {
-  return (question: string) =>
-    new Promise<string>((resolve, reject) => {
-      const prompt = createInterface({
-        input,
-        output,
-        ...(terminal === undefined ? {} : { terminal }),
-      });
-      let answered = false;
-      const cancel = () => {
-        if (answered) return;
-        answered = true;
-        // Closing twice does nothing, so this is safe whichever way the input ended.
-        prompt.close();
-        // The cursor is still after the question: what comes next starts a line.
-        output.write('\n');
-        reject(new PromptCancelled());
-      };
-      prompt.once('close', cancel);
-      prompt.question(question).then((answer) => {
-        if (answered) return;
-        answered = true;
-        prompt.close();
-        resolve(answer);
-      }, cancel);
+  return (question: string) => askLine(input, output, output, question, terminal);
+}
+
+/**
+ * terminalAsk, for a secret: what is typed or pasted is never shown. The question goes to
+ * `output`, and readline echoes into a stream that drops everything. On a terminal it is
+ * still readline's own terminal (raw mode), so the terminal doesn't echo either.
+ */
+export function terminalAskSecret(
+  input: Readable,
+  output: Writable,
+  terminal: boolean = (output as { isTTY?: boolean }).isTTY === true,
+): (question: string) => Promise<string> {
+  return async (question: string) => {
+    const muted = new Writable({
+      write(_chunk, _encoding, done) {
+        done();
+      },
+    });
+    output.write(question);
+    const answer = await askLine(input, muted, output, '', terminal);
+    // Enter was never echoed: end the question's line.
+    output.write('\n');
+    return answer;
+  };
+}
+
+/** One question: readline writes to `echo`, and a cancel ends the line on `output`. */
+function askLine(
+  input: Readable,
+  echo: Writable,
+  output: Writable,
+  question: string,
+  terminal: boolean | undefined,
+): Promise<string> {
+  return new Promise<string>((resolve, reject) => {
+    const prompt = createInterface({
+      input,
+      output: echo,
+      ...(terminal === undefined ? {} : { terminal }),
     });
+    let answered = false;
+    const cancel = () => {
+      if (answered) return;
+      answered = true;
+      // Closing twice does nothing, so this is safe whichever way the input ended.
+      prompt.close();
+      // The cursor is still after the question: what comes next starts a line.
+      output.write('\n');
+      reject(new PromptCancelled());
+    };
+    prompt.once('close', cancel);
+    prompt.question(question).then((answer) => {
+      if (answered) return;
+      answered = true;
+      prompt.close();
+      resolve(answer);
+    }, cancel);
+  });
 }
```

**Change** `packages/cli/src/main.ts`:

```diff
diff --git a/packages/cli/src/main.ts b/packages/cli/src/main.ts
index 714ba1e..2f2fcf0 100644
--- a/packages/cli/src/main.ts
+++ b/packages/cli/src/main.ts
@@ -1,2 +1,2 @@
-import { terminalAsk } from './prompt';
+import { terminalAsk, terminalAskSecret } from './prompt';
 import { run } from './run';
@@ -19,3 +19,8 @@ process.exitCode = await run(process.argv.slice(2), {
   env: process.env,
-  ...(interactive ? { ask: terminalAsk(process.stdin, process.stdout) } : {}),
+  ...(interactive
+    ? {
+        ask: terminalAsk(process.stdin, process.stdout),
+        askSecret: terminalAskSecret(process.stdin, process.stdout),
+      }
+    : {}),
 });
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index fcdb17a..a271949 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -31,2 +31,3 @@ import { Command, CommanderError, Option } from 'commander';
 import { printCredentials } from './credentials';
+import { prepareDataFolder, type DataFolder } from './folders';
 import { init, type InitOptions } from './init';
@@ -55,2 +56,4 @@ export interface Io {
   ask?: (question: string) => Promise<string>;
+  /** ask, for a secret: what is typed or pasted never shows. Absent with ask. */
+  askSecret?: (question: string) => Promise<string>;
 }
@@ -66,2 +69,8 @@ export interface CliDeps {
   egress: (runtime: Runtime) => (url: string) => Promise<EgressResult>;
+  /** init's data folder: created where it can be (prepareDataFolder). */
+  dataFolder: (
+    path: string,
+    home: string,
+    user: { uid: number; gid: number },
+  ) => Promise<DataFolder>;
 }
@@ -177,2 +186,3 @@ export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
               }),
+      dataFolder: (path, home, user) => prepareDataFolder(path, home, false, user),
     };
@@ -186,2 +196,4 @@ export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
     egress: (docker) => (url) => helperEgress({ runtime: docker, image, user }, url),
+    // The container sees the host's folders only inside the home.
+    dataFolder: (path, home, owner) => prepareDataFolder(path, home, true, owner),
   };
@@ -407,3 +419,5 @@ export function createProgram(
     .command('init')
-    .description('Write a starter stack.yaml and a secrets/ folder (never overwrites)')
+    .description(
+      'Write a starter stack.yaml and a secrets/ folder, and create the data folder if it can (never overwrites)',
+    )
     .option('--home <dir>', 'Mediaplane home directory', defaultHome)
@@ -454,3 +468,3 @@ export function createProgram(
       }
-      setExitCode(await init(options, io, host.host));
+      setExitCode(await init(options, io, host.host, deps.dataFolder));
     });
```

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index 73709a8..2e200fb 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -111,7 +111,19 @@ mediaplane vpn-check    # with a VPN: qBittorrent gets out only through it
 
-`init` checks the flags it can before its first question, and asks again when an answer
-won't do. Ctrl-D or Ctrl-C at a question stops it, writing nothing.
-Without a terminal it asks nothing: pass the flags in the
+`init` checks the flags it can before its first question, including that it can create
+the home or write into it, and asks again when an answer won't do. A line or two before
+each question says what it is for. Ctrl-D or Ctrl-C at a question stops it, writing
+nothing. Without a terminal it asks nothing: pass the flags in the
 [CLI reference](../docs/reference/cli.md#mediaplane-init) instead.
 
+- **The data folder.** Run from source, `init` creates it if it is missing and you may,
+  as you, and changes no owner or mode. When it can't, such as for a folder under `/srv`
+  that needs root, its next steps give the `sudo mkdir -p` and `sudo chown` commands.
+  Inside the container it sees only the home, so for a folder outside it the next step
+  says to create it.
+- **The WireGuard key.** With a VPN provider, on a terminal, `init` asks you to paste
+  your provider's private key (its `PrivateKey` line). Nothing shows as you paste. It
+  keeps it in `secrets/wg.key`, readable by you only, and never overwrites one that is
+  there. Press Enter to put it there yourself later; without a terminal, or with
+  `--json`, it never asks.
+
 - **`init`** writes the user it runs as into `stack.yaml`. Inside the container that is
```

`init`'s description changed, so regenerate the CLI reference
(`docs/reference/cli.md`):

```bash
pnpm docs:generate
```

- [ ] **Step 12: Run them to verify they pass**

Run: `pnpm vitest run packages/cli`

Expected: PASS.

- [ ] **Step 13: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src packages/cli/src deploy/README.md docs/runbooks docs/reference/cli.md
git commit -m "feat(cli): init checks its home, creates the data folder and takes the WireGuard key; hints link the runbooks" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The wiring network in `compose.yaml`, the apps' API specs, and allowed hosts

What Docker must have before anything can call an app: a network with no route out
that the apps with an API are on (D1, decision 1), and, in the catalog, how each API is
reached. Nothing calls an app yet.

Decision: an app's `api` names its port by name (`web`), a `ready` path that answers 200
without a key, the secret that is its key and how it is carried, and a `check` path that
answers 200 only with the key. Sonarr and Radarr use `/api/v3`, Prowlarr `/api/v1`
(`servarrApi`), each with `X-Api-Key`. qBittorrent's key is a Bearer token (it answers
403 to `X-Api-Key` and `?apikey=`), its `ready` is `/`, and its `check` is
`/api/v2/app/version`.
Decision: the services on the network are the apps with an `api`, or, for one inside
another app's namespace, that app (`wiredServices`): Gluetun, for qBittorrent behind it.
A stack with none has no `networks:` at all, so every existing golden stays as it is: no
fixture app has an API (`FIXTURE_API` is for tests that give one to an app).
Decision: the catalog checks each API only for the apps that have one (a
`describe.each` over them, so the test names say which), and lists those apps in a test
of its own: no per-app test returns early for the eight that have none, asserting
nothing (preflight M5).
Decision: `webAddresses` moves from `credentials.ts` to the resolver, as
`ResolvedStack.webAddresses` and `AppContext.webAddresses`, because Servarr's allowed
hosts need it too (decision 10).

**Files:**
- Modify: `packages/engine/src/catalog/types.ts`, `packages/engine/src/resolver/resolve.ts`,
  `packages/engine/src/render/compose.ts`, `packages/engine/src/credentials.ts`,
  `catalog/_shared/servarr.ts`, `catalog/sonarr/app.ts`, `catalog/radarr/app.ts`,
  `catalog/prowlarr/app.ts`, `catalog/qbittorrent/app.ts`, `scripts/docs/catalog-facts.ts`
- Generated: every `catalog/*/README.md` (the facts get an "API" line)
- Test: `packages/engine/src/testing/fixtures.ts`, `packages/engine/src/render/compose.test.ts`,
  `packages/engine/src/resolver/resolve.test.ts`, `catalog/render.test.ts`,
  `catalog/catalog.test.ts`, `scripts/docs/catalog-facts.test.ts`

**Interfaces:**
- **Consumes:** `bindAddresses`, `HostFacts`, `compare`; `servarrEnv` inside
  `catalog/_shared/servarr.ts`.
- **Produces:**
  - `interface ApiSpec { port: string; ready: string; key: { secret: string; scheme: 'x-api-key' | 'bearer' }; check: string }`
    and `AppDefinition.api?: ApiSpec`;
  - `AppContext.webAddresses: string[]` and `ResolvedStack.webAddresses: string[]`;
    `webAddresses(bindAddresses: readonly string[], host: HostFacts): string[]`;
  - `WIRING_NETWORK = 'wiring'`, `wiredServices(stack: ResolvedStack): Set<string>`,
    `ComposeService.networks?: string[]`,
    `ComposeFile.networks?: Record<string, { internal: true }>`;
  - `servarrApi(version: 'v1' | 'v3'): ApiSpec`;
  - `FIXTURE_API: ApiSpec` from `@mediaplane/engine/testing`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/testing/fixtures.ts`:

```diff
diff --git a/packages/engine/src/testing/fixtures.ts b/packages/engine/src/testing/fixtures.ts
index 7f59caf..ed37fd3 100644
--- a/packages/engine/src/testing/fixtures.ts
+++ b/packages/engine/src/testing/fixtures.ts
@@ -1,3 +1,3 @@
 import { z } from 'zod';
-import type { AppDefinition, Catalog } from '../catalog/types';
+import type { ApiSpec, AppDefinition, Catalog } from '../catalog/types';
 import { parseConfig } from '../config/load';
@@ -19,2 +19,13 @@ export const FIXTURE_HOST: HostFacts = {
 
+/**
+ * An API shaped like the real Servarr apps'. No fixture app has one, so plan never calls
+ * an app in the tests that don't ask it to: give it to an app in a catalog of the test's.
+ */
+export const FIXTURE_API: ApiSpec = {
+  port: 'web',
+  ready: '/ping',
+  key: { secret: 'apiKey', scheme: 'x-api-key' },
+  check: '/api/v3/system/status',
+};
+
 export function fixtureApp<Options = Record<string, unknown>>(
```

**Change** `packages/engine/src/render/compose.test.ts`:

```diff
diff --git a/packages/engine/src/render/compose.test.ts b/packages/engine/src/render/compose.test.ts
index 7123e5d..11232f1 100644
--- a/packages/engine/src/render/compose.test.ts
+++ b/packages/engine/src/render/compose.test.ts
@@ -1,5 +1,11 @@
 import { describe, expect, it } from 'vitest';
+import type { Catalog } from '../catalog/types';
 import type { HostFacts } from '../host/facts';
 import { resolveStack, type ResolvedStack } from '../resolver/resolve';
-import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
+import {
+  FIXTURE_API,
+  FIXTURE_HOST,
+  fixtureCatalog,
+  fixtureConfig,
+} from '../testing/fixtures';
 import { appEnvSecretName, literal, renderCompose, secretEnvName } from './compose';
@@ -7,9 +13,8 @@ import { composeToYaml } from './yaml';
 
-function stackOf(source: string, host: HostFacts = FIXTURE_HOST): ResolvedStack {
-  const result = resolveStack(
-    fixtureConfig(source),
-    fixtureCatalog,
-    host,
-    '/opt/mediaplane',
-  );
+function stackOf(
+  source: string,
+  host: HostFacts = FIXTURE_HOST,
+  catalog: Catalog = fixtureCatalog,
+): ResolvedStack {
+  const result = resolveStack(fixtureConfig(source), catalog, host, '/opt/mediaplane');
   if (result.stack === undefined)
@@ -208 +213,40 @@ describe('secret env references', () => {
 });
+
+describe('the wiring network', () => {
+  /** The fixture catalog, with an API for Sonarr and qBittorrent. */
+  const WIRED: Catalog = fixtureCatalog.map((def) =>
+    def.id === 'sonarr' || def.id === 'qbittorrent' ? { ...def, api: FIXTURE_API } : def,
+  );
+
+  it('puts every app with an API on it, beside the default network, and makes it internal', () => {
+    const compose = renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST, FIXTURE_HOST, WIRED));
+    expect(compose.networks).toEqual({ wiring: { internal: true } });
+    expect(compose.services.sonarr?.networks).toEqual(['default', 'wiring']);
+    expect(compose.services.qbittorrent?.networks).toEqual(['default', 'wiring']);
+    expect(compose.services.plex?.networks).toBeUndefined();
+    expect(composeToYaml(compose)).toContain(
+      '    networks:\n      - default\n      - wiring\n',
+    );
+    expect(composeToYaml(compose)).toContain(
+      'networks:\n  wiring:\n    internal: true\n',
+    );
+  });
+
+  it('puts the app that hosts a guest with an API on it: Gluetun, for qBittorrent', () => {
+    const compose = renderCompose(stackOf(JELLYFIN_VPN_LAN, FIXTURE_HOST, WIRED));
+    expect(compose.services.gluetun?.networks).toEqual(['default', 'wiring']);
+    // In Gluetun's network namespace: no networks of its own.
+    expect(compose.services.qbittorrent?.networks).toBeUndefined();
+  });
+
+  it('has no wiring network when no app has an API', () => {
+    const compose = renderCompose(stackOf(JELLYFIN_VPN_LAN));
+    expect(compose.networks).toBeUndefined();
+    expect(Object.values(compose.services).map((s) => s.networks)).toEqual([
+      undefined,
+      undefined,
+      undefined,
+      undefined,
+    ]);
+  });
+});
```

**Change** `packages/engine/src/resolver/resolve.test.ts`:

```diff
diff --git a/packages/engine/src/resolver/resolve.test.ts b/packages/engine/src/resolver/resolve.test.ts
index 94a0ea0..479fd15 100644
--- a/packages/engine/src/resolver/resolve.test.ts
+++ b/packages/engine/src/resolver/resolve.test.ts
@@ -374,2 +374,14 @@ describe('resolveStack: binding', () => {
 
+  it('tells the apps where a browser reaches their web UIs', () => {
+    const webOf = (base: string) => {
+      const result = resolve('  sonarr: {}\n  qbittorrent: {}\n', { base });
+      return [result.stack?.webAddresses, app(result, 'sonarr')?.context.webAddresses];
+    };
+    expect(webOf(BASE)).toEqual([['127.0.0.1'], ['127.0.0.1']]);
+    expect(webOf(lan)).toEqual([['192.168.1.10'], ['192.168.1.10']]);
+    // bind: all publishes on every interface: a browser comes in on one of this host's own.
+    const all = ['127.0.0.1', '192.168.1.10'];
+    expect(webOf(BASE.replace('bind: localhost', 'bind: all'))).toEqual([all, all]);
+  });
+
   it('refuses "lan" on a host with no private address', () => {
```

**Change** `catalog/render.test.ts`:

```diff
diff --git a/catalog/render.test.ts b/catalog/render.test.ts
index 200c860..2fddec4 100644
--- a/catalog/render.test.ts
+++ b/catalog/render.test.ts
@@ -144,2 +144,43 @@ describe('the real catalog', () => {
 
+  it('names only itself and its web addresses as hosts when login on the LAN is off', () => {
+    // The apps refuse to save their settings without AllowedHosts in this mode.
+    const off = (bind: string) =>
+      SPEC_EXAMPLE.replace(
+        'network: { bind: lan }',
+        `network: { bind: ${bind} }\nsecurity: { login_on_lan: false }`,
+      );
+    expect(render(off('lan')).compose.services.radarr?.environment).toMatchObject({
+      RADARR__SERVER__ALLOWEDHOSTS: 'radarr,192.168.1.10',
+    });
+    // localhost and 127.0.0.1 always pass.
+    expect(render(off('localhost')).compose.services.prowlarr?.environment).toMatchObject(
+      { PROWLARR__SERVER__ALLOWEDHOSTS: 'prowlarr' },
+    );
+    expect(render(SPEC_EXAMPLE).compose.services.sonarr?.environment).not.toHaveProperty(
+      'SONARR__SERVER__ALLOWEDHOSTS',
+    );
+  });
+
+  it('puts the apps Mediaplane calls on the internal wiring network, Gluetun for qBittorrent', () => {
+    const { compose } = render(SPEC_EXAMPLE);
+    expect(compose.networks).toEqual({ wiring: { internal: true } });
+    const wired = Object.entries(compose.services)
+      .filter(([, service]) => service.networks !== undefined)
+      .map(([id, service]) => `${id} ${String(service.networks)}`);
+    expect(wired).toEqual([
+      'gluetun default,wiring',
+      'prowlarr default,wiring',
+      'radarr default,wiring',
+      'sonarr default,wiring',
+    ]);
+    const direct = SPEC_EXAMPLE.replace(
+      '  qbittorrent: {}',
+      '  qbittorrent: { vpn: false }',
+    );
+    expect(render(direct).compose.services.qbittorrent?.networks).toEqual([
+      'default',
+      'wiring',
+    ]);
+  });
+
   it("refuses a qBittorrent port that clashes with Gluetun's control server", () => {
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 98143d4..63b9c8a 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -23,2 +23,24 @@ describe('catalog', () => {
 
+  it('gives an API to the apps Mediaplane wires', () => {
+    expect(catalog.filter((app) => app.api !== undefined).map((app) => app.id)).toEqual([
+      'prowlarr',
+      'qbittorrent',
+      'radarr',
+      'sonarr',
+    ]);
+  });
+
+  describe.each(
+    catalog.flatMap((app) =>
+      app.api === undefined ? [] : [[app.id, app, app.api] as const],
+    ),
+  )("%s's API", (_id, app, api) => {
+    it('is served on a port it declares, with a key it declares', () => {
+      expect(app.ports.map((port) => port.name)).toContain(api.port);
+      expect(Object.keys(app.secrets)).toContain(api.key.secret);
+      expect(api.ready).toMatch(/^\//);
+      expect(api.check).toMatch(/^\/api\//);
+    });
+  });
+
   describe.each(catalog.map((app) => [app.id, app] as const))('%s', (_id, app) => {
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 3664b8d..00b9456 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -46,2 +46,14 @@ describe('renderFacts', () => {
 
+  it("says how Mediaplane reaches an app's API, or that it calls none", () => {
+    expect(renderFacts(app('sonarr'))).toContain(
+      "- **API:** on its `web` port, which Mediaplane reaches over the stack's wiring network, with `apiKey` in the `X-Api-Key` header\n",
+    );
+    expect(renderFacts(app('qbittorrent'))).toContain(
+      'with `apiKey` as a Bearer token\n',
+    );
+    expect(renderFacts(app('jellyfin'))).toContain(
+      '- **API:** none that Mediaplane calls\n',
+    );
+  });
+
   it('shows what an app turns on with its default settings', () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/render packages/engine/src/resolver catalog scripts/docs`

Expected: FAIL: 7 tests: no app has an `api` yet, no service is on a wiring network
(`expected undefined to deeply equal { wiring: { internal: true } }`), the contexts have
no `webAddresses`, Radarr's environment has no `RADARR__SERVER__ALLOWEDHOSTS`, and the
facts have no "API" line. 5 files failed, 8 passed.

- [ ] **Step 3: The network, the API specs, and the allowed hosts**

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index 5383516..eace16d 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -58,2 +58,7 @@ export interface AppContext<Options = Record<string, unknown>> {
   publishesOnLan: boolean;
+  /**
+   * Where a browser reaches the web UIs: the bind addresses, or with bind: all, 127.0.0.1
+   * and this host's private addresses.
+   */
+  webAddresses: string[];
   /**
@@ -94,2 +99,18 @@ export interface ConfigFileContext<
 
+/**
+ * How Mediaplane reaches an app's HTTP API (spec §6.1), over the stack's wiring network.
+ * An app with one joins that network. One that runs in another app's network namespace,
+ * as qBittorrent does behind Gluetun, is reached through that app, which joins for it.
+ */
+export interface ApiSpec {
+  /** The port, by name, that serves it: its container port, after apps.<id>.port. */
+  port: string;
+  /** A path that answers 200 without a key once the app is ready: /ping for the arrs. */
+  ready: string;
+  /** Which of the app's secrets is its API key, and how a request carries it. */
+  key: { secret: string; scheme: 'x-api-key' | 'bearer' };
+  /** A path that answers 200 only with the key: it shows the key still works. */
+  check: string;
+}
+
 export interface ServiceExtras {
@@ -119,2 +140,4 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   health: HealthCheck | 'image' | 'none';
+  /** Its HTTP API, when Mediaplane calls it. */
+  api?: ApiSpec;
   /** App-specific settings under apps.<id> in stack.yaml. */
```

**Change** `packages/engine/src/resolver/resolve.ts`:

```diff
diff --git a/packages/engine/src/resolver/resolve.ts b/packages/engine/src/resolver/resolve.ts
index a2d767a..c1c565a 100644
--- a/packages/engine/src/resolver/resolve.ts
+++ b/packages/engine/src/resolver/resolve.ts
@@ -37,2 +37,7 @@ export interface ResolvedStack {
   bindAddresses: string[];
+  /**
+   * Where a browser reaches the web UIs: bindAddresses, or with bind: all, 127.0.0.1 and
+   * this host's private addresses (`mediaplane credentials` lists these).
+   */
+  webAddresses: string[];
   lanSubnets: string[];
@@ -76,2 +81,4 @@ export function resolveStack(
   const lanClientSubnets = publishesOnLan ? lanSubnets : [];
+  const bind = bindAddresses(config, host);
+  const web = webAddresses(bind.addresses, host);
 
@@ -91,2 +98,3 @@ export function resolveStack(
       publishesOnLan,
+      webAddresses: web,
       lanClientSubnets,
@@ -114,3 +122,2 @@ export function resolveStack(
   );
-  const bind = bindAddresses(config, host);
   diagnostics.push(...bind.diagnostics);
@@ -119,3 +126,10 @@ export function resolveStack(
   return {
-    stack: { config, home, apps, bindAddresses: bind.addresses, lanSubnets },
+    stack: {
+      config,
+      home,
+      apps,
+      bindAddresses: bind.addresses,
+      webAddresses: web,
+      lanSubnets,
+    },
     diagnostics,
@@ -124,2 +138,14 @@ export function resolveStack(
 
+/**
+ * Where a browser reaches the web UIs. bind: all publishes on every interface, so name
+ * this host's own addresses rather than 0.0.0.0.
+ */
+export function webAddresses(
+  bindAddresses: readonly string[],
+  host: HostFacts,
+): string[] {
+  if (!bindAddresses.includes('0.0.0.0')) return [...bindAddresses];
+  return ['127.0.0.1', ...host.privateAddresses.map((a) => a.address).sort(compare)];
+}
+
 function checkListedApps(
```

**Change** `packages/engine/src/render/compose.ts`:

```diff
diff --git a/packages/engine/src/render/compose.ts b/packages/engine/src/render/compose.ts
index 4885fd7..9003111 100644
--- a/packages/engine/src/render/compose.ts
+++ b/packages/engine/src/render/compose.ts
@@ -21,2 +21,3 @@ export interface ComposeService {
   depends_on?: Record<string, { condition: 'service_healthy'; restart: boolean }>;
+  networks?: string[];
   environment?: Record<string, string>;
@@ -31,2 +32,3 @@ export interface ComposeFile {
   services: Record<string, ComposeService>;
+  networks?: Record<string, { internal: true }>;
 }
@@ -35,2 +37,9 @@ export const PROJECT_NAME = 'mediaplane';
 
+/**
+ * The stack's wiring network (ADR 0011): internal, so it has no route out. Every app
+ * whose API Mediaplane calls joins it, and so does Mediaplane's own container while it
+ * wires them. Compose names it "<project>_wiring".
+ */
+export const WIRING_NETWORK = 'wiring';
+
 /** Name of the .env variable carrying an app's secret, e.g. MP_SONARR_API_KEY. */
@@ -62,2 +71,3 @@ export function renderCompose(stack: ResolvedStack): ComposeFile {
   }
+  const wired = wiredServices(stack);
   const services: Record<string, ComposeService> = {};
@@ -68,5 +78,22 @@ export function renderCompose(stack: ResolvedStack): ComposeFile {
       portsByService.get(app.def.id) ?? [],
+      wired.has(app.def.id),
     );
   }
-  return { name: PROJECT_NAME, services };
+  return {
+    name: PROJECT_NAME,
+    services,
+    ...(wired.size === 0 ? {} : { networks: { [WIRING_NETWORK]: { internal: true } } }),
+  };
+}
+
+/**
+ * The services on the wiring network: every app with an API, or for one inside another
+ * app's network namespace, that app (Gluetun, for qBittorrent).
+ */
+export function wiredServices(stack: ResolvedStack): Set<string> {
+  return new Set(
+    stack.apps.flatMap((app) =>
+      app.def.api === undefined ? [] : [app.networkVia ?? app.def.id],
+    ),
+  );
 }
@@ -82,2 +109,3 @@ function renderService(
   ports: string[],
+  wired: boolean,
 ): ComposeService {
@@ -103,2 +131,5 @@ function renderService(
         }),
+    // Listing a network replaces Compose's default, so the default is listed too: the
+    // app's own traffic, to the internet and to the other apps, stays on it.
+    ...(wired ? { networks: ['default', WIRING_NETWORK] } : {}),
     ...(Object.keys(environment).length === 0 ? {} : { environment }),
```

**Change** `packages/engine/src/credentials.ts`:

```diff
diff --git a/packages/engine/src/credentials.ts b/packages/engine/src/credentials.ts
index 9f6087a..1b4242b 100644
--- a/packages/engine/src/credentials.ts
+++ b/packages/engine/src/credentials.ts
@@ -17,3 +17,2 @@ import {
 import { readSecretStore } from './secrets/store';
-import { compare } from './util/sort';
 
@@ -90,3 +89,3 @@ export async function credentials(
   const login = await adminLogin(config, home, store, options.env);
-  const addresses = webAddresses(resolved.stack.bindAddresses, host);
+  const addresses = resolved.stack.webAddresses;
   return {
@@ -107,11 +106,2 @@ function describeRef(ref: SecretRef): string {
 
-/**
- * Where a browser reaches the web UIs. bind: all publishes on every interface, so name
- * this host's own addresses rather than 0.0.0.0.
- */
-function webAddresses(bindAddresses: readonly string[], host: HostFacts): string[] {
-  if (!bindAddresses.includes('0.0.0.0')) return [...bindAddresses];
-  return ['127.0.0.1', ...host.privateAddresses.map((a) => a.address).sort(compare)];
-}
-
 function appLogin(app: ResolvedApp, addresses: readonly string[]): AppLogin[] {
```

**Change** `catalog/_shared/servarr.ts`:

```diff
diff --git a/catalog/_shared/servarr.ts b/catalog/_shared/servarr.ts
index 51295c4..375138c 100644
--- a/catalog/_shared/servarr.ts
+++ b/catalog/_shared/servarr.ts
@@ -1,2 +1,7 @@
-import type { AppContext, ConfigFile, ConfigFileContext } from '@mediaplane/engine';
+import type {
+  ApiSpec,
+  AppContext,
+  ConfigFile,
+  ConfigFileContext,
+} from '@mediaplane/engine';
 
@@ -20,2 +25,12 @@ export function servarrEnv(prefix: string, ctx: AppContext): Record<string, stri
   }
+  // Without a login for local addresses, the app takes only the Host names it is told
+  // of, and refuses to save its settings until it has some: its service name, which the
+  // other apps and Mediaplane use, and the addresses its web UI is published on.
+  // localhost and 127.0.0.1 always pass.
+  if (!ctx.config.security.login_on_lan) {
+    const hosts = [prefix.toLowerCase(), ...ctx.webAddresses];
+    env[`${prefix}__SERVER__ALLOWEDHOSTS`] = hosts
+      .filter((host) => host !== '127.0.0.1')
+      .join(',');
+  }
   return env;
@@ -23,2 +38,15 @@ export function servarrEnv(prefix: string, ctx: AppContext): Record<string, stri
 
+/**
+ * Sonarr's, Radarr's and Prowlarr's API: `/ping` without a key, then everything under
+ * /api/<version> with it, in `X-Api-Key` (never ?apikey=, which ends up in logs).
+ */
+export function servarrApi(version: 'v1' | 'v3'): ApiSpec {
+  return {
+    port: 'web',
+    ready: '/ping',
+    key: { secret: 'apiKey', scheme: 'x-api-key' },
+    check: `/api/${version}/system/status`,
+  };
+}
+
 /**
```

**Change** `catalog/sonarr/app.ts`:

```diff
diff --git a/catalog/sonarr/app.ts b/catalog/sonarr/app.ts
index 4b0698c..b37f4df 100644
--- a/catalog/sonarr/app.ts
+++ b/catalog/sonarr/app.ts
@@ -1,3 +1,3 @@
 import { defineApp } from '@mediaplane/engine';
-import { servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
 
@@ -24,2 +24,3 @@ export default defineApp({
   health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:8989/ping'] },
+  api: servarrApi('v3'),
   env: (ctx) => servarrEnv('SONARR', ctx),
```

**Change** `catalog/radarr/app.ts`:

```diff
diff --git a/catalog/radarr/app.ts b/catalog/radarr/app.ts
index 5d3e46b..c025914 100644
--- a/catalog/radarr/app.ts
+++ b/catalog/radarr/app.ts
@@ -1,3 +1,3 @@
 import { defineApp } from '@mediaplane/engine';
-import { servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
 
@@ -24,2 +24,3 @@ export default defineApp({
   health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:7878/ping'] },
+  api: servarrApi('v3'),
   env: (ctx) => servarrEnv('RADARR', ctx),
```

**Change** `catalog/prowlarr/app.ts`:

```diff
diff --git a/catalog/prowlarr/app.ts b/catalog/prowlarr/app.ts
index c450e0d..d4fea84 100644
--- a/catalog/prowlarr/app.ts
+++ b/catalog/prowlarr/app.ts
@@ -1,3 +1,3 @@
 import { defineApp } from '@mediaplane/engine';
-import { servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
 
@@ -24,2 +24,3 @@ export default defineApp({
   health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:9696/ping'] },
+  api: servarrApi('v1'),
   implies: () => ['byparr'],
```

**Change** `catalog/qbittorrent/app.ts`:

```diff
diff --git a/catalog/qbittorrent/app.ts b/catalog/qbittorrent/app.ts
index 8c75510..830e6bc 100644
--- a/catalog/qbittorrent/app.ts
+++ b/catalog/qbittorrent/app.ts
@@ -24,2 +24,10 @@ export default defineApp({
   },
+  // Its key goes as a Bearer token: X-Api-Key and ?apikey= get 403. Behind the VPN it is
+  // reached through Gluetun, on its own port inside Gluetun's network namespace.
+  api: {
+    port: 'web',
+    ready: '/',
+    key: { secret: 'apiKey', scheme: 'bearer' },
+    check: '/api/v2/app/version',
+  },
   options: z.strictObject({
```

**Change** `scripts/docs/catalog-facts.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.ts b/scripts/docs/catalog-facts.ts
index 27f6c5e..961a174 100644
--- a/scripts/docs/catalog-facts.ts
+++ b/scripts/docs/catalog-facts.ts
@@ -66,2 +66,10 @@ function health(def: AppDefinition): string {
 
+function api(def: AppDefinition): string {
+  if (def.api === undefined) return 'none that Mediaplane calls';
+  const { port, key } = def.api;
+  const carried =
+    key.scheme === 'bearer' ? 'as a Bearer token' : 'in the `X-Api-Key` header';
+  return `on its ${code(port)} port, which Mediaplane reaches over the stack's wiring network, with ${code(key.secret)} ${carried}`;
+}
+
 function secret(source: SecretSource): string {
@@ -102,2 +110,3 @@ export function renderFacts(def: AppDefinition): string {
     ['Secrets', secrets(def)],
+    ['API', api(def)],
     ['Needs', list(def.requires.map((r) => r.capability))],
```

The catalog facts changed, so regenerate the READMEs' facts (every
`catalog/*/README.md`):

```bash
pnpm docs:generate
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine catalog scripts/docs`

Expected: PASS, the goldens in `packages/engine/src/render/__golden__` unchanged.

- [ ] **Step 5: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src catalog scripts/docs
git commit -m "feat(engine): the stack's internal wiring network, the apps' API specs, and Servarr's allowed hosts" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The runtime: join and leave the wiring network, its addresses, and `stop`

What the engine needs from Docker for the wiring, all through the `Runtime`, with the
calls of decision 1 and nothing else.

Decision: Mediaplane finds its own container from `/proc/self/mountinfo`: Docker mounts
each container's `hostname` file from `…/containers/<id>/hostname`. That works in any
container without a new environment variable, and fails closed: no ID, no join (a
`RuntimeError` that says why).
Decision: `joinWiring` reads the network once (`docker network inspect --format`, its
`Internal` flag, its two Compose labels, and the IDs on it), and refuses one that isn't
internal, or isn't this project's `wiring` (decision 2). Run from source
(`MEDIAPLANE_IMAGE` unset), it returns `not-needed` and calls nothing; with no network
yet, `no-network`. `leaveWiring` disconnects only when Mediaplane is on it.
Decision: `wiringAddresses(ids)` is `inspect`'s sibling: one `docker container inspect
--format`, the IPv4 address on `<project>_wiring` (or `-`), and the project label, so a
container of another project is refused as in `inspect`. It never accepts anything but
full container IDs, so no name or option reaches the command line.
Decision: `stop(services, values)` is `compose stop <services>` on the written project,
with its output redacted like `up`'s; it accepts only service names.
Decision: the fake runtime puts no container on the wiring network unless the test says
where (`addresses`), so a test that forgets its fake apps gets `wire.not-on-network`,
never a request to a real app listening on this host (preflight M10). Task 6's fake apps
give the addresses to pass. It records each new call.
Decision: `OVERRIDE_CALLS` keeps every line it had, `proxy-net/disconnect` included, so
what an override needs stays pinned even if the engine's own calls change (preflight
M9). The comment above the lists says what each new call is for, and that `compose
stop` lists and stops containers, as `up` already does through the proxy when it
recreates one; the trial that stops one runs from source (preflight M8).

**Files:**
- Modify: `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/docker.ts`,
  `deploy/mediaplane.compose.yaml` (a comment only)
- Test: `packages/engine/src/runtime/docker.test.ts`, `packages/engine/src/testing/fakes.ts`,
  `deploy/deploy.test.ts`

**Interfaces:**
- **Consumes:** `WIRING_NETWORK` (Task 2); `docker`, `projectArgs`, `firstLine`,
  `commandResult` and `inImage` inside `runtime/docker.ts`.
- **Produces:**
  - `type WiringJoin = 'joined' | 'already' | 'not-needed' | 'no-network'`;
  - `Runtime.wiringAddresses(ids: readonly string[]): Promise<Record<string, string>>`
    (by ID; a container that isn't on the network is left out);
  - `Runtime.joinWiring(): Promise<WiringJoin>` and `Runtime.leaveWiring(): Promise<void>`
    (both throw `RuntimeError`);
  - `Runtime.stop(services: readonly string[], values: Record<string, string>): Promise<CommandResult>`;
  - `ownContainerId(read?: () => Promise<string>): Promise<string | undefined>` and
    `DockerRuntimeOptions.ownId?: () => Promise<string | undefined>`, for tests;
  - in the fakes: `FakeRuntimeOptions.addresses?: Record<string, string>` (by container
    ID; none by default, so no container is on the wiring network),
    `join?: WiringJoin | (() => WiringJoin | Promise<WiringJoin>)` (default
    `not-needed`), and `stop?: CommandResult` (default `{ ok: true }`), recorded as
    `wiring-addresses <ids…>`, `join-wiring`, `leave-wiring` and `stop <services…>`.

- [ ] **Step 1: Write the failing tests**

The calls also go into the allow-list test. They pass against today's allow-list, which
is the point: no permission changes (decision 1).

**Change** `packages/engine/src/runtime/docker.test.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.test.ts b/packages/engine/src/runtime/docker.test.ts
index 453e06a..d270755 100644
--- a/packages/engine/src/runtime/docker.test.ts
+++ b/packages/engine/src/runtime/docker.test.ts
@@ -8,2 +8,3 @@ import {
   isManagedProject,
+  ownContainerId,
   parseContainers,
@@ -766,2 +767,217 @@ describe('createDockerRuntime', () => {
 
+describe('the wiring network', () => {
+  const home = '/opt/mediaplane';
+  const SELF = 'c'.repeat(64);
+  const IN_IMAGE = { MEDIAPLANE_IMAGE: 'mediaplane:local' };
+  const network = (internal: string, project: string, ...members: string[]) =>
+    ok(`${[`${internal} ${project} wiring`, ...members].join(' ')}\n`);
+  const runtimeWith = (
+    respond: (args: readonly string[]) => ExecResult,
+    env: NodeJS.ProcessEnv = IN_IMAGE,
+  ) => {
+    const { exec, calls } = recorder(respond);
+    const runtime = createDockerRuntime({
+      home,
+      project: 'mediaplane',
+      exec,
+      env,
+      ownId: () => Promise.resolve(SELF),
+    });
+    return { runtime, calls };
+  };
+
+  it("reads each container's address on <project>_wiring, and leaves out one not on it", async () => {
+    const other = 'e'.repeat(64);
+    const { runtime, calls } = runtimeWith(() =>
+      ok(`${SONARR_ID} 172.20.0.3 mediaplane\n${other} - mediaplane\n`),
+    );
+    expect(await runtime.wiringAddresses([SONARR_ID, other])).toEqual({
+      [SONARR_ID]: '172.20.0.3',
+    });
+    expect(calls[0]?.args).toEqual([
+      'container',
+      'inspect',
+      '--format',
+      '{{.Id}} {{with index .NetworkSettings.Networks "mediaplane_wiring"}}{{if .IPAddress}}{{.IPAddress}}{{else}}-{{end}}{{else}}-{{end}} {{index .Config.Labels "com.docker.compose.project"}}',
+      SONARR_ID,
+      other,
+    ]);
+  });
+
+  it('refuses addresses of another project, an odd line, a name, or a missing answer', async () => {
+    const answers: [string, string][] = [
+      [`${SONARR_ID} 172.20.0.3 mediaplane-system\n`, 'is not in the Compose project'],
+      [`${SONARR_ID} 172.20.0.3 <no value>\n`, 'is not in the Compose project'],
+      [`${SONARR_ID} fe80::1 mediaplane\n`, 'a line that is not "<id> <wiring address>'],
+      ['', 'did not answer once for each of the 1 containers'],
+    ];
+    for (const [stdout, message] of answers) {
+      const { runtime } = runtimeWith(() => ok(stdout));
+      await expect(runtime.wiringAddresses([SONARR_ID])).rejects.toThrow(message);
+    }
+    const { runtime, calls } = runtimeWith(() => ok(''));
+    await expect(runtime.wiringAddresses(['sonarr'])).rejects.toThrow(
+      'not a container ID: "sonarr"',
+    );
+    expect(await runtime.wiringAddresses([])).toEqual({});
+    expect(calls).toEqual([]);
+  });
+
+  it('needs no join run from source, and asks Docker nothing', async () => {
+    const { runtime, calls } = runtimeWith(() => ok(''), {});
+    expect(await runtime.joinWiring()).toBe('not-needed');
+    await runtime.leaveWiring();
+    expect(calls).toEqual([]);
+  });
+
+  it('joins its own container to the internal wiring network of its project', async () => {
+    const { runtime, calls } = runtimeWith((args) =>
+      args[1] === 'inspect' ? network('true', 'mediaplane', SONARR_ID) : ok(''),
+    );
+    expect(await runtime.joinWiring()).toBe('joined');
+    expect(calls.map((call) => call.args)).toEqual([
+      [
+        'network',
+        'inspect',
+        '--format',
+        '{{.Internal}} {{index .Labels "com.docker.compose.project"}} {{index .Labels "com.docker.compose.network"}}{{range $id, $c := .Containers}} {{$id}}{{end}}',
+        'mediaplane_wiring',
+      ],
+      ['network', 'connect', 'mediaplane_wiring', SELF],
+    ]);
+  });
+
+  it('stays joined: a second join asks Docker to change nothing', async () => {
+    const { runtime, calls } = runtimeWith(() => network('true', 'mediaplane', SELF));
+    expect(await runtime.joinWiring()).toBe('already');
+    expect(calls.map((call) => call.args[1])).toEqual(['inspect']);
+  });
+
+  it('finds no network on a stack that was never applied with one', async () => {
+    const { runtime, calls } = runtimeWith(() => ({
+      code: 1,
+      stdout: '',
+      stderr: 'Error response from daemon: network mediaplane_wiring not found\n',
+    }));
+    expect(await runtime.joinWiring()).toBe('no-network');
+    await runtime.leaveWiring();
+    expect(calls.map((call) => call.args[1])).toEqual(['inspect', 'inspect']);
+  });
+
+  it("never joins a network with a route out, or another project's", async () => {
+    for (const [answer, message] of [
+      [network('false', 'mediaplane'), 'it is not internal'],
+      [network('true', 'mediaplane-other'), 'it is not the wiring network of'],
+      [network('true', '<no value>'), 'it is not the wiring network of'],
+    ] as const) {
+      const { runtime, calls } = runtimeWith(() => answer);
+      await expect(runtime.joinWiring()).rejects.toThrow(
+        `refusing to join mediaplane_wiring: ${message}`,
+      );
+      expect(calls.map((call) => call.args[1])).toEqual(['inspect']);
+    }
+  });
+
+  it("says so when it can't tell which container it runs in", async () => {
+    const { exec } = recorder(() => network('true', 'mediaplane'));
+    const runtime = createDockerRuntime({
+      home,
+      project: 'mediaplane',
+      exec,
+      env: IN_IMAGE,
+      ownId: () => Promise.resolve(undefined),
+    });
+    await expect(runtime.joinWiring()).rejects.toThrow(
+      "Mediaplane can't tell which container it runs in",
+    );
+  });
+
+  it('explains a join or a leave Docker refused', async () => {
+    const refused = (args: readonly string[]) =>
+      args[1] === 'inspect'
+        ? network('true', 'mediaplane')
+        : { code: 1, stdout: '', stderr: 'Error response from daemon: denied\n' };
+    const { runtime } = runtimeWith(refused);
+    await expect(runtime.joinWiring()).rejects.toThrow(
+      'could not join the wiring network mediaplane_wiring: Error response from daemon: denied',
+    );
+    const member = runtimeWith((args) =>
+      args[1] === 'inspect'
+        ? network('true', 'mediaplane', SELF)
+        : { code: 1, stdout: '', stderr: 'Error response from daemon: denied\n' },
+    );
+    await expect(member.runtime.leaveWiring()).rejects.toThrow(
+      'could not leave the wiring network mediaplane_wiring',
+    );
+  });
+
+  it('leaves the network only when it is on it', async () => {
+    const on = runtimeWith((args) =>
+      args[1] === 'inspect' ? network('true', 'mediaplane', SONARR_ID, SELF) : ok(''),
+    );
+    await on.runtime.leaveWiring();
+    expect(on.calls.at(-1)?.args).toEqual([
+      'network',
+      'disconnect',
+      'mediaplane_wiring',
+      SELF,
+    ]);
+    const off = runtimeWith(() => network('true', 'mediaplane', SONARR_ID));
+    await off.runtime.leaveWiring();
+    expect(off.calls.map((call) => call.args[1])).toEqual(['inspect']);
+  });
+});
+
+describe('ownContainerId', () => {
+  it("finds the ID in where the container's hostname file comes from", async () => {
+    const id = 'c'.repeat(64);
+    const mountinfo = [
+      '1 0 0:1 / / ro,relatime - overlay overlay rw',
+      `2 1 8:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/sda1 rw`,
+    ].join('\n');
+    expect(await ownContainerId(() => Promise.resolve(mountinfo))).toBe(id);
+  });
+
+  it('finds none outside a container, or when it cannot read the file', async () => {
+    expect(
+      await ownContainerId(() => Promise.resolve('1 0 0:1 / / rw - ext4 x rw')),
+    ).toBe(undefined);
+    expect(await ownContainerId(() => Promise.reject(new Error('ENOENT')))).toBe(
+      undefined,
+    );
+  });
+});
+
+describe('stop', () => {
+  it('stops the services on the written project, and reports a failure', async () => {
+    const dir = await tempDir('mediaplane-runtime-');
+    const { exec, calls } = recorder(() => ({
+      code: 1,
+      stdout: '',
+      stderr: 'fake-secret-value: no such service\n',
+    }));
+    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane', exec });
+    expect(await runtime.stop(['qbittorrent'], { MP_X: 'fake-secret-value' })).toEqual({
+      ok: false,
+      error: '***: no such service',
+    });
+    expect(calls[0]?.args.slice(-2)).toEqual(['stop', 'qbittorrent']);
+    expect(calls[0]?.args.slice(0, 3)).toEqual(['compose', '-p', 'mediaplane']);
+  });
+
+  it('stops nothing for no service, and refuses what is not a service name', async () => {
+    const { exec, calls } = recorder(() => ok(''));
+    const runtime = createDockerRuntime({
+      home: '/opt/mediaplane',
+      project: 'mediaplane',
+      exec,
+    });
+    expect(await runtime.stop([], {})).toEqual({ ok: true });
+    await expect(runtime.stop(['--all'], {})).rejects.toThrow(
+      'not a service name: "--all"',
+    );
+    expect(calls).toEqual([]);
+  });
+});
+
 describe('isManagedProject', () => {
```

**Change** `packages/engine/src/testing/fakes.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.ts b/packages/engine/src/testing/fakes.ts
index 1d23cd8..f191668 100644
--- a/packages/engine/src/testing/fakes.ts
+++ b/packages/engine/src/testing/fakes.ts
@@ -19,2 +19,3 @@ import {
   type Runtime,
+  type WiringJoin,
 } from '../runtime/types';
@@ -99,2 +100,13 @@ export interface FakeRuntimeOptions {
   details?: Record<string, Partial<Omit<ContainerDetails, 'id'>>>;
+  /**
+   * Each container's address on the wiring network, by ID; one left out isn't on it.
+   * None by default, so a test that forgets its fake apps gets wire.not-on-network, and
+   * never a request to a real app on this host: fakeSonarr() and fakeStackApis() give
+   * the addresses to pass.
+   */
+  addresses?: Record<string, string>;
+  /** What joinWiring answers; 'not-needed', as from source, unless the test says. */
+  join?: WiringJoin | (() => WiringJoin | Promise<WiringJoin>);
+  /** What stop answers. */
+  stop?: CommandResult;
   /** Answers the host helper, given the parsed request; without it, the helper fails. */
@@ -163,2 +175,27 @@ export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
     },
+    wiringAddresses: (ids) => {
+      record(`wiring-addresses ${ids.join(' ')}`);
+      return Promise.resolve(
+        Object.fromEntries(
+          ids.flatMap((id) => {
+            const address = options.addresses?.[id];
+            return address === undefined ? [] : [[id, address]];
+          }),
+        ),
+      );
+    },
+    // async: a throwing callback rejects like a failed docker call.
+    joinWiring: async () => {
+      record('join-wiring');
+      const join = options.join ?? 'not-needed';
+      return typeof join === 'function' ? await join() : join;
+    },
+    leaveWiring: () => {
+      record('leave-wiring');
+      return Promise.resolve();
+    },
+    stop: (services) => {
+      record(`stop ${services.join(' ')}`);
+      return Promise.resolve(options.stop ?? { ok: true });
+    },
     chown: (service, path, owner) => {
```

**Change** `deploy/deploy.test.ts`:

```diff
diff --git a/deploy/deploy.test.ts b/deploy/deploy.test.ts
index a020828..e29eaba 100644
--- a/deploy/deploy.test.ts
+++ b/deploy/deploy.test.ts
@@ -65,3 +65,8 @@ const V = '/v1.51';
  * helper, its `container inspect` is `GET containers/{id}/json`, and its host side is the
- * host helper.
+ * host helper. Slice 3b adds no permission either (ADR 0011): Compose attaches the apps to
+ * the wiring network when it creates them, Mediaplane joins and leaves it with the network
+ * connect and disconnect the list already allowed for an override's networks, and a
+ * stranded qBittorrent is stopped, then started by `up`: `compose stop` lists and stops
+ * containers, as `up` already does when it recreates one. test/e2e/deploy.e2e.test.ts
+ * runs the join and the leave through the real proxy.
  */
@@ -86,2 +91,6 @@ const ENGINE_CALLS: [string, string][] = [
   ['DELETE', `${V}/containers/${ID}`],
+  // Mediaplane's own container on the stack's wiring network (Slice 3b).
+  ['GET', `${V}/networks/mediaplane_wiring`],
+  ['POST', `${V}/networks/mediaplane_wiring/connect`],
+  ['POST', `${V}/networks/mediaplane_wiring/disconnect`],
 ];
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime deploy`

Expected: FAIL: the 14 new tests in `docker.test.ts` (`runtime.joinWiring is not a
function`, `ownContainerId is not a function`, and so on). `deploy/deploy.test.ts` passes
already: today's allow-list allows the new calls (decision 1). 1 file failed, 2 passed.

- [ ] **Step 3: Join, leave, addresses and stop**

**Change** `packages/engine/src/runtime/types.ts`:

```diff
diff --git a/packages/engine/src/runtime/types.ts b/packages/engine/src/runtime/types.ts
index db8e691..382f1b6 100644
--- a/packages/engine/src/runtime/types.ts
+++ b/packages/engine/src/runtime/types.ts
@@ -64,2 +64,9 @@ export interface OneOffCommand {
 
+/**
+ * What joinWiring did: joined the stack's wiring network now, found Mediaplane already
+ * on it, had nothing to do (run from source, the host reaches the network itself), or
+ * found no network yet (the stack has never been applied with one).
+ */
+export type WiringJoin = 'joined' | 'already' | 'not-needed' | 'no-network';
+
 /** The host helper's output, or why it failed; `missingSource` is a source the host lacks. */
@@ -103,2 +110,25 @@ export interface Runtime {
   inspect(ids: readonly string[]): Promise<ContainerDetails[]>;
+  /**
+   * The IPv4 address of each of the containers `ids` on the stack's wiring network
+   * (`<project>_wiring`), by ID; one that isn't on it is left out. The same refusals as
+   * `inspect`.
+   */
+  wiringAddresses(ids: readonly string[]): Promise<Record<string, string>>;
+  /**
+   * Make Mediaplane's own container a member of the stack's wiring network, when it runs
+   * from its image, and stay there. Throws a `RuntimeError` for a network that isn't
+   * internal, or isn't this project's wiring network (it never joins a network with a
+   * route out), or when it can't tell which container it runs in, or docker fails.
+   */
+  joinWiring(): Promise<WiringJoin>;
+  /**
+   * Take Mediaplane's own container off the wiring network, if it is on it, so `up` can
+   * recreate the network: Compose can't while another project's container is on it.
+   */
+  leaveWiring(): Promise<void>;
+  /** `compose stop <services>` on the written project. */
+  stop(
+    services: readonly string[],
+    values: Record<string, string>,
+  ): Promise<CommandResult>;
   /**
```

**Change** `packages/engine/src/runtime/docker.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.ts b/packages/engine/src/runtime/docker.ts
index 0f02ff1..9d53357 100644
--- a/packages/engine/src/runtime/docker.ts
+++ b/packages/engine/src/runtime/docker.ts
@@ -1,2 +1,2 @@
-import { access } from 'node:fs/promises';
+import { access, readFile } from 'node:fs/promises';
 import { join } from 'node:path';
@@ -4,2 +4,3 @@ import { warning, type Diagnostic } from '../diagnostics';
 import { COMPOSE_PATH, ENV_PATH, OVERRIDE_PATH } from '../paths';
+import { WIRING_NETWORK } from '../render/compose';
 import { nodeExec, type Exec, type ExecResult } from './exec';
@@ -17,2 +18,3 @@ import {
   type Runtime,
+  type WiringJoin,
 } from './types';
@@ -79,2 +81,21 @@ export interface DockerRuntimeOptions {
   env?: NodeJS.ProcessEnv;
+  /** The ID of the container Mediaplane runs in, from its image (ownContainerId). */
+  ownId?: () => Promise<string | undefined>;
+}
+
+/**
+ * The ID of the container this process runs in: Docker mounts the container's own
+ * hostname file from /var/lib/docker/containers/<id>/, and /proc/self/mountinfo shows
+ * where it came from. Undefined outside a Docker container.
+ */
+export async function ownContainerId(
+  read: () => Promise<string> = () => readFile('/proc/self/mountinfo', 'utf8'),
+): Promise<string | undefined> {
+  let mounts: string;
+  try {
+    mounts = await read();
+  } catch {
+    return undefined;
+  }
+  return /\/containers\/([0-9a-f]{64})\/hostname /.exec(mounts)?.[1];
 }
@@ -134,2 +155,46 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
 
+  /** The stack's wiring network, as Compose names it. */
+  const wiringNetwork = `${options.project}_${WIRING_NETWORK}`;
+  const findOwnId = options.ownId ?? (() => ownContainerId());
+
+  async function requireOwnId(): Promise<string> {
+    const id = await findOwnId();
+    if (id === undefined) {
+      throw new RuntimeError(
+        "Mediaplane can't tell which container it runs in (no container ID in /proc/self/mountinfo), so it can't join the stack's wiring network",
+      );
+    }
+    return id;
+  }
+
+  /**
+   * The wiring network: whether it is internal, whether this project's Compose made it
+   * as its wiring network, and the IDs of the containers on it. Undefined when there is
+   * none yet.
+   */
+  async function wiringState(): Promise<
+    { internal: boolean; ours: boolean; members: string[] } | undefined
+  > {
+    const result = await docker('network inspect', [
+      'network',
+      'inspect',
+      '--format',
+      '{{.Internal}} {{index .Labels "com.docker.compose.project"}} {{index .Labels "com.docker.compose.network"}}{{range $id, $c := .Containers}} {{$id}}{{end}}',
+      wiringNetwork,
+    ]);
+    if (result.code !== 0) {
+      // Docker 28 and 29 say "network … not found"; older ones "No such network".
+      if (/not found|No such network/i.test(result.stderr)) return undefined;
+      throw new RuntimeError(
+        `docker network inspect failed: ${firstLine(result.stderr)}`,
+      );
+    }
+    const [internal, project, key, ...members] = result.stdout.trim().split(' ');
+    return {
+      internal: internal === 'true',
+      ours: project === options.project && key === WIRING_NETWORK,
+      members,
+    };
+  }
+
   async function run(service: string, command: OneOffCommand): Promise<ExecResult> {
@@ -263,9 +328,3 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
     async inspect(ids) {
-      // Full IDs, never names or options: they come from containers(), and `{{.Id}}`
-      // prints all 64 characters, which is what callers match the answers by.
-      const bad = ids.find((id) => !/^[0-9a-f]{64}$/.test(id));
-      if (bad !== undefined) {
-        throw new RuntimeError(`not a container ID: ${JSON.stringify(bad)}`);
-      }
-      const asked = [...new Set(ids)];
+      const asked = fullIds(ids);
       if (asked.length === 0) return [];
@@ -296,2 +355,98 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
 
+    async wiringAddresses(ids) {
+      const asked = fullIds(ids);
+      if (asked.length === 0) return {};
+      // The network's name is the project's, which isManagedProject has checked: no quote
+      // can end the template's string early.
+      const result = await docker('container inspect', [
+        'container',
+        'inspect',
+        '--format',
+        `{{.Id}} {{with index .NetworkSettings.Networks "${wiringNetwork}"}}{{if .IPAddress}}{{.IPAddress}}{{else}}-{{end}}{{else}}-{{end}} {{index .Config.Labels "com.docker.compose.project"}}`,
+        ...asked,
+      ]);
+      if (result.code !== 0) {
+        throw new RuntimeError(
+          `docker container inspect failed: ${firstLine(result.stderr)}`,
+        );
+      }
+      const addresses = parseAddresses(result.stdout, options.project);
+      if (
+        addresses.length !== asked.length ||
+        !asked.every((id) => addresses.filter((answer) => answer.id === id).length === 1)
+      ) {
+        throw new RuntimeError(
+          `docker container inspect did not answer once for each of the ${String(asked.length)} containers asked about`,
+        );
+      }
+      return Object.fromEntries(
+        addresses.flatMap(({ id, address }) =>
+          address === undefined ? [] : [[id, address]],
+        ),
+      );
+    },
+
+    async joinWiring(): Promise<WiringJoin> {
+      // Run from source, the host reaches every container on the network already.
+      if (!inImage(baseEnv)) return 'not-needed';
+      const network = await wiringState();
+      if (network === undefined) return 'no-network';
+      // Never a network with a route out, nor one another project made: Mediaplane's
+      // own container would then have a way out, or a way into another stack.
+      if (!network.internal || !network.ours) {
+        throw new RuntimeError(
+          network.ours
+            ? `refusing to join ${wiringNetwork}: it is not internal, so Mediaplane's container would get a route out`
+            : `refusing to join ${wiringNetwork}: it is not the wiring network of the Compose project "${options.project}"`,
+        );
+      }
+      const self = await requireOwnId();
+      if (network.members.includes(self)) return 'already';
+      const joined = await docker('network connect', [
+        'network',
+        'connect',
+        wiringNetwork,
+        self,
+      ]);
+      if (joined.code !== 0) {
+        throw new RuntimeError(
+          `could not join the wiring network ${wiringNetwork}: ${firstLine(joined.stderr)}`,
+        );
+      }
+      return 'joined';
+    },
+
+    async leaveWiring() {
+      if (!inImage(baseEnv)) return;
+      const network = await wiringState();
+      if (network === undefined) return;
+      const self = await requireOwnId();
+      if (!network.members.includes(self)) return;
+      const left = await docker('network disconnect', [
+        'network',
+        'disconnect',
+        wiringNetwork,
+        self,
+      ]);
+      if (left.code !== 0) {
+        throw new RuntimeError(
+          `could not leave the wiring network ${wiringNetwork}: ${firstLine(left.stderr)}`,
+        );
+      }
+    },
+
+    async stop(services, values) {
+      const bad = services.find((service) => !/^[a-z0-9][a-z0-9_.-]*$/.test(service));
+      if (bad !== undefined) {
+        throw new RuntimeError(`not a service name: ${JSON.stringify(bad)}`);
+      }
+      if (services.length === 0) return { ok: true };
+      const result = await docker('compose stop', [
+        ...(await projectArgs()),
+        'stop',
+        ...services,
+      ]);
+      return commandResult(result, values);
+    },
+
     async chown(service, path, owner, values) {
@@ -448,2 +603,46 @@ export function parseDetails(stdout: string, project: string): ContainerDetails[
 
+/**
+ * `ids`, each once, after checking that every one is a full container ID: never a name or
+ * an option. They come from containers(), and `{{.Id}}` prints all 64 characters, which
+ * is what callers match the answers by.
+ */
+function fullIds(ids: readonly string[]): string[] {
+  const bad = ids.find((id) => !/^[0-9a-f]{64}$/.test(id));
+  if (bad !== undefined) {
+    throw new RuntimeError(`not a container ID: ${JSON.stringify(bad)}`);
+  }
+  return [...new Set(ids)];
+}
+
+/**
+ * `docker container inspect` lines of "<id> <wiring address or -> <project>", refused as
+ * parseDetails refuses them: a line of another shape, a container of another project or
+ * of none, and an address that isn't IPv4.
+ */
+export function parseAddresses(
+  stdout: string,
+  project: string,
+): { id: string; address: string | undefined }[] {
+  return stdout
+    .split('\n')
+    .filter((line) => line.trim() !== '')
+    .map((line) => {
+      const match = /^([0-9a-f]{64}) (\d{1,3}(?:\.\d{1,3}){3}|-) (<no value>|\S*)$/.exec(
+        line,
+      );
+      const [, id, address, owner] = match ?? [];
+      if (id === undefined || address === undefined || owner === undefined) {
+        throw new RuntimeError(
+          'docker container inspect printed a line that is not "<id> <wiring address> <project>"',
+        );
+      }
+      if (owner !== project) {
+        throw new RuntimeError(
+          `container ${id.slice(0, 12)} is not in the Compose project "${project}"`,
+        );
+      }
+      return { id, address: address === '-' ? undefined : address };
+    });
+}
+
 /** `docker compose config --hash` output: one "service hash" pair per line. */
```

**Change** `deploy/mediaplane.compose.yaml`:

```diff
diff --git a/deploy/mediaplane.compose.yaml b/deploy/mediaplane.compose.yaml
index ec52dbc..a959526 100644
--- a/deploy/mediaplane.compose.yaml
+++ b/deploy/mediaplane.compose.yaml
@@ -88,4 +88,5 @@ services:
 networks:
-  # These two containers only, and no route out: in M1, Mediaplane needs nothing but the
-  # proxy, because image pulls happen in the Docker daemon.
+  # These two containers only, and no route out: image pulls happen in the Docker daemon.
+  # To wire the apps, Mediaplane also joins the stack's own wiring network, which is
+  # internal too (ADR 0011), so it never gets a route out.
   docker-api:
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine deploy`

Expected: PASS.

- [ ] **Step 5: Check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git diff --stat -- deploy/mediaplane.compose.yaml
git add packages/engine/src/runtime packages/engine/src/testing/fakes.ts deploy
git commit -m "feat(engine): the runtime joins and leaves the wiring network, reads its addresses, and stops services" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `git diff --stat` shows `deploy/mediaplane.compose.yaml` with a comment
changed and nothing else: `git diff -- deploy/mediaplane.compose.yaml` touches only the
lines that start with `#`.

---

### Task 4: The typed HTTP client

How Mediaplane calls one app's API (spec §5.1, §6.1, §8.1(2)): decisions 4 to 6. Every
later task calls the apps through it, and its tests run against a fake HTTP server on
the loopback.

Decision: one client per app, made with where to connect (the container's address), the
`Host` it sends (`<service>:<port>`), the key and how it is carried, and every secret the
stack knows, for redaction. Its methods are what the Servarr and qBittorrent APIs need,
and no more: `get` (JSON, checked with Zod), `check` (any 2xx, body unread: qBittorrent's
`app/version` is plain text), `put`, `post`, `login` (a form, without the key, never
following a redirect, cookies dropped) and `ready` (a path without the key, until the
deadline).
Decision: an `AppApiError` says which app, where, what, the request's method and path
(never its query), and the app's own message; its `kind` (`unreachable`, `timeout`,
`auth`, `rejected`, `server`, `protocol`) becomes the diagnostic's code in Tasks 6 and 7
(`wire.<kind>`). `transient` and `reachedApp` drive the retries.
Decision: no redirect is followed with the key: a 3xx to a call with the key fails
("answered HTTP 302, not a success"), so the key never goes to another address.
Decision: an answer's message is redacted before anything changes it (preflight B1):
`appMessage(body, clean)` redacts the raw body, then the message parsed out of JSON (a
secret written with JSON escapes appears only once parsed), and only then collapses
whitespace and cuts at 200 characters; the whole failure message is redacted again.
Cut first, a key across the 200th character would keep its first part; collapsed
first, a password with runs of spaces would no longer match.
Decision: a size limit is named in the unit it is a whole number of (`1 KiB`, `5 MiB`),
never rounded to `0 MiB` (preflight M17).
Decision: the client reads a connection error's code with the engine's `codeOf`
(preflight M3).
Decision: the spawned test first sends a request through Node's own agent, which the
proxy must see: on a Node that ignored `NODE_USE_ENV_PROXY`, the test would otherwise
pass whatever the client did (preflight M5).
Decision: tests pass a clock, a sleep and a random source (`RetryOptions`), so the
backoff is checked exactly and no test waits for real.

**Files:**
- Create: `packages/engine/src/http/client.ts`, `packages/engine/src/http/client.test.ts`,
  `packages/engine/src/testing/http.ts`
- Modify: `packages/engine/src/index.ts`, `packages/engine/src/testing/index.ts`

**Interfaces:**
- **Consumes:** `redact` from `util/redact.ts` and `codeOf` from `util/error-code.ts`
  (Task 1); `z` from Zod.
- **Produces:**
  - `HTTP_TIMEOUT_MS = 30_000`, `HTTP_MAX_BYTES = 5 * 1024 * 1024`,
    `APP_DEADLINE_MS = 120_000`;
  - `type AppApiErrorKind = 'unreachable' | 'timeout' | 'auth' | 'rejected' | 'server' | 'protocol'`;
  - `class AppApiError extends Error { kind; status: number | undefined; transient: boolean; reachedApp: boolean }`;
  - `interface Endpoint { host: string; port: number }`;
  - `interface RetryOptions { deadlineMs: number; sleep: (ms: number) => Promise<unknown>; now: () => number; random: () => number }`;
  - `interface AppApiOptions { name; service; port; endpoint: Endpoint; key?: { scheme: 'x-api-key' | 'bearer'; value: string }; secrets: readonly string[]; timeoutMs?; maxBytes?; retry?: Partial<RetryOptions> }`;
  - `interface AppApi { name; where; get<T>(path, schema: z.ZodType<T>): Promise<T>; check(path): Promise<void>; put(path, body): Promise<void>; post<T>(path, body, schema): Promise<T>; login(path, fields): Promise<{ status: number; location: string | undefined }>; ready(path): Promise<void> }`;
  - `createAppApi(options: AppApiOptions): AppApi`;
  - `appMessage(body: string, clean?: (text: string) => string): string | undefined`,
    which redacts with `clean` before it collapses or cuts;
  - from `@mediaplane/engine/testing`:
    `fakeHttpApp(handler: FakeHandler): Promise<FakeApp>`, where a handler returns
    `{ status, body?, headers? }` or `'hang'`, and `FakeApp` has `port` and `requests`
    (closed when the test finishes); and `closedPort(): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/testing/http.ts`:

```ts
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { onTestFinished } from 'vitest';

/** A request the fake app received. */
export interface FakeRequest {
  method: string;
  /** With the query string. */
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** What the fake app answers: a status, a body (an object is sent as JSON), headers. */
export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Answers a request, or 'hang' to never answer it. */
export type FakeHandler = (
  request: FakeRequest,
) => FakeReply | 'hang' | Promise<FakeReply | 'hang'>;

/** A fake app, listening on 127.0.0.1. It stops when the test that made it finishes. */
export interface FakeApp {
  port: number;
  /** Every request, in order. */
  requests: FakeRequest[];
}

/**
 * Start a fake app on a free port of 127.0.0.1, answering with `handler`. Call it while a
 * test runs, from the test or a helper it calls.
 */
export async function fakeHttpApp(handler: FakeHandler): Promise<FakeApp> {
  const requests: FakeRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: FakeRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);
      void Promise.resolve(handler(request)).then((reply) => {
        if (reply === 'hang') return;
        const text =
          reply.body === undefined
            ? ''
            : typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body);
        res.writeHead(reply.status, {
          ...(typeof reply.body === 'object'
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...reply.headers,
        });
        res.end(text);
      });
    });
  });
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  onTestFinished(
    () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => {
          closed();
        });
      }),
  );
  return { port: (server.address() as AddressInfo).port, requests };
}

/** A port on 127.0.0.1 where nothing listens: connecting to it is refused. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((closed) => {
    server.close(() => {
      closed();
    });
  });
  return port;
}
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 93b8a8e..3dea8d5 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -3,2 +3,3 @@ export * from './fixtures';
 export * from './fakes';
+export * from './http';
 export * from './schema';
```

**Create** `packages/engine/src/http/client.test.ts`:

```ts
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { z } from 'zod';
import { closedPort, fakeHttpApp, type FakeHandler } from '../testing/http';
import {
  AppApiError,
  appMessage,
  createAppApi,
  type AppApiOptions,
  type RetryOptions,
} from './client';

const KEY = 'f'.repeat(32);
const PASSWORD = 'fake-admin-password';

/** A clock that only moves when the client sleeps; `slept` lists each wait. */
function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  const retry: RetryOptions = {
    deadlineMs: 120_000,
    now: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
    random: () => 1,
  };
  return { retry, slept };
}

async function sonarr(handler: FakeHandler, extra: Partial<AppApiOptions> = {}) {
  const app = await fakeHttpApp(handler);
  const clock = fakeClock();
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: app.port },
    key: { scheme: 'x-api-key', value: KEY },
    secrets: [KEY, PASSWORD],
    retry: clock.retry,
    ...extra,
  });
  return { api, app, slept: clock.slept };
}

/** What the call threw, as an AppApiError. */
async function failure(call: Promise<unknown>): Promise<AppApiError> {
  const thrown = await call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(thrown instanceof AppApiError))
    throw new Error(`expected an AppApiError, got ${String(thrown)}`);
  return thrown;
}

const STATUS = z.looseObject({ version: z.string() });

describe('createAppApi', () => {
  it('sends the key, the Host the stack uses, and reads the JSON it is given', async () => {
    const { api, app } = await sonarr(() => ({
      status: 200,
      body: { version: '4.0.20' },
    }));
    expect(await api.get('/api/v3/system/status', STATUS)).toEqual({ version: '4.0.20' });
    expect(app.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/v3/system/status',
      headers: { 'x-api-key': KEY, host: 'sonarr:8989', 'user-agent': 'Mediaplane' },
    });
    expect(api.where).toBe('http://sonarr:8989 (127.0.0.1)');
  });

  it('sends a Bearer key when the app takes one', async () => {
    const { api, app } = await sonarr(
      () => ({ status: 200, body: { version: 'v5.2.4' } }),
      {
        key: { scheme: 'bearer', value: KEY },
      },
    );
    await api.get('/api/v2/app/version', z.unknown());
    expect(app.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('checks a key with any 2xx answer, reading no JSON: qBittorrent answers plain text', async () => {
    const { api, app } = await sonarr(() => ({ status: 200, body: 'v5.2.4' }), {
      key: { scheme: 'bearer', value: KEY },
    });
    await api.check('/api/v2/app/version');
    expect(app.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    const refused = await sonarr(() => ({ status: 403, body: 'Forbidden' }));
    expect(await failure(refused.api.check('/api/v2/app/version'))).toMatchObject({
      kind: 'auth',
      status: 403,
    });
  });

  it('PUTs JSON, and takes any 2xx as done', async () => {
    const { api, app } = await sonarr(() => ({ status: 202, body: {} }));
    await api.put('/api/v3/config/host/1', { username: 'admin' });
    expect(app.requests[0]).toMatchObject({
      method: 'PUT',
      body: '{"username":"admin"}',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('says the key was refused, and never repeats a secret the app echoes', async () => {
    const { api } = await sonarr(() => ({ status: 401, body: `bad key ${KEY}` }));
    const error = await failure(api.get('/api/v3/system/status?apikey=x', STATUS));
    expect(error).toMatchObject({ kind: 'auth', status: 401, transient: false });
    expect(error.message).toBe(
      "Sonarr at http://sonarr:8989 (127.0.0.1) refused Mediaplane's API key (HTTP 401): bad key *** (GET /api/v3/system/status)",
    );
  });

  it('never shows part of a secret that the cut would split', async () => {
    // The key starts at character 190 of a 300-character answer, across the 200-character
    // cut: cut first, its first characters would stay.
    const body = `${'x'.repeat(190)}${KEY}${'y'.repeat(300 - 190 - KEY.length)}`;
    const { api } = await sonarr(() => ({ status: 400, body }));
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error.message).toContain('refused the request (HTTP 400): xxx');
    for (let i = 0; i + 8 <= KEY.length; i++) {
      expect(error.message).not.toContain(KEY.slice(i, i + 8));
    }
  });

  it('never shows a password with runs of spaces, which the collapse would change', async () => {
    const spaced = 'fake-one  fake-two   fake-three';
    const { api } = await sonarr(
      () => ({ status: 400, body: `the password ${spaced} is too weak` }),
      { secrets: [KEY, spaced] },
    );
    const error = await failure(api.put('/api/v3/config/host/1', { password: spaced }));
    expect(error.message).toContain(
      'refused the request (HTTP 400): the password *** is too weak',
    );
    expect(error.message).not.toMatch(/fake-(one|two|three)/);
  });

  it("gives Servarr's own validation message, and never the value it was given", async () => {
    const { api } = await sonarr(() => ({
      status: 400,
      body: [
        {
          propertyName: 'PasswordConfirmation',
          errorMessage: 'Must match Password',
          attemptedValue: 'not-the-password',
        },
      ],
    }));
    const error = await failure(api.put('/api/v3/config/host/1', { password: PASSWORD }));
    expect(error).toMatchObject({ kind: 'rejected', status: 400 });
    expect(error.message).toContain(
      'refused the request (HTTP 400): PasswordConfirmation: Must match Password (PUT /api/v3/config/host/1)',
    );
    expect(error.message).not.toContain('not-the-password');
  });

  it('reads the other shapes an app explains a refusal in', () => {
    expect(
      appMessage(
        JSON.stringify({ title: 'One or more errors.', errors: { id: ['Bad id'] } }),
      ),
    ).toBe('One or more errors.; id: Bad id');
    expect(appMessage(JSON.stringify({ message: 'Nope' }))).toBe('Nope');
    expect(appMessage('Category does not exist')).toBe('Category does not exist');
    expect(
      appMessage(
        '<!DOCTYPE HTML><html><head><title>Bad Request</title><style>h2{}</style></head><body><h2>Bad Request - Invalid Hostname</h2></body></html>',
      ),
    ).toBe('Bad Request Bad Request - Invalid Hostname');
    expect(appMessage('')).toBeUndefined();
    expect(appMessage('x'.repeat(500))).toHaveLength(200);
  });

  it('tries a GET again while the app is starting, waiting longer each time', async () => {
    const answers = [503, 502, 200];
    const { api, app, slept } = await sonarr(() => {
      const status = answers.shift() ?? 200;
      return { status, body: status === 200 ? { version: '4' } : 'starting' };
    });
    expect(await api.get('/api/v3/system/status', STATUS)).toEqual({ version: '4' });
    expect(app.requests).toHaveLength(3);
    expect(slept).toEqual([500, 1000]);
  });

  it('gives up on an app that keeps failing once the deadline passes, and says how long it tried', async () => {
    const { api, slept } = await sonarr(() => ({ status: 503, body: 'starting' }));
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error).toMatchObject({ kind: 'server', status: 503 });
    expect(error.message).toMatch(
      /failed \(HTTP 503\): starting \(GET \/api\/v3\/system\/status\), and still did after \d+ s$/,
    );
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(120_000);
    expect(Math.max(...slept)).toBe(10_000);
  });

  it('never tries a 500 again: the app failed, it is not starting', async () => {
    const { api, app } = await sonarr(() => ({ status: 500, body: 'boom' }));
    expect(await failure(api.get('/api/v3/x', STATUS))).toMatchObject({ kind: 'server' });
    expect(app.requests).toHaveLength(1);
  });

  it('tries a POST again only when nothing reached the app', async () => {
    const { api, app } = await sonarr(() => ({ status: 503, body: 'busy' }));
    expect(await failure(api.post('/api/v3/rootfolder', {}, z.unknown()))).toMatchObject({
      kind: 'server',
      status: 503,
    });
    expect(app.requests).toHaveLength(1);
    const clock = fakeClock();
    const refused = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port: await closedPort() },
      secrets: [],
      retry: clock.retry,
    });
    const error = await failure(refused.post('/api/v3/rootfolder', {}, z.unknown()));
    expect(error).toMatchObject({ kind: 'unreachable', reachedApp: false });
    expect(error.message).toContain('could not be reached (ECONNREFUSED)');
    expect(clock.slept.length).toBeGreaterThan(1);
  });

  it('gives up on an answer that never comes', async () => {
    const { api, app } = await sonarr(() => 'hang', {
      timeoutMs: 50,
      retry: { deadlineMs: 0 },
    });
    const error = await failure(api.get('/api/v3/system/status', STATUS));
    expect(error).toMatchObject({ kind: 'timeout', transient: true });
    expect(error.message).toContain('did not answer within 0.05 s');
    expect(app.requests).toHaveLength(1);
  });

  it('refuses an answer that is too big, not JSON, or not what was expected, showing no value', async () => {
    const big = await sonarr(() => ({ status: 200, body: 'x'.repeat(2048) }), {
      maxBytes: 1024,
    });
    expect((await failure(big.api.get('/x', STATUS))).message).toContain(
      'answered more than 1 KiB',
    );
    const text = await sonarr(() => ({ status: 200, body: 'not json' }));
    expect((await failure(text.api.get('/x', STATUS))).message).toContain(
      'answered with something that is not JSON',
    );
    const odd = await sonarr(() => ({
      status: 200,
      body: { version: KEY.length, apiKey: KEY },
    }));
    const error = await failure(odd.api.get('/x', STATUS));
    expect(error).toMatchObject({ kind: 'protocol' });
    expect(error.message).toContain(
      "answered something Mediaplane doesn't understand (at version)",
    );
    expect(error.message).not.toContain('32');
  });

  it('follows no redirect for a call with the key', async () => {
    const { api } = await sonarr(() => ({
      status: 302,
      headers: { Location: '/login' },
    }));
    expect((await failure(api.get('/x', STATUS))).message).toContain(
      'answered HTTP 302, not a success',
    );
  });

  it('signs in with a form, without the key, and gives back where it redirects', async () => {
    const { api, app } = await sonarr(() => ({
      status: 302,
      headers: { Location: '/', 'Set-Cookie': 'SonarrAuth=fake-cookie' },
    }));
    expect(await api.login('/login', { username: 'admin', password: PASSWORD })).toEqual({
      status: 302,
      location: '/',
    });
    expect(app.requests[0]).toMatchObject({
      method: 'POST',
      path: '/login',
      body: `username=admin&password=${PASSWORD}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('waits for the app to be ready, without the key', async () => {
    const answers = [503, 503, 200];
    const { api, app } = await sonarr(() => ({ status: answers.shift() ?? 200 }));
    await api.ready('/ping');
    expect(app.requests.map((r) => r.headers['x-api-key'])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('goes straight to the app, never through a proxy from the environment', async () => {
    // Node's global agent sends a request to HTTP_PROXY with NODE_USE_ENV_PROXY set: the
    // proxy would see the key. The child's first request, through that agent, shows the
    // proxy is used; the client's, which must not be, comes next.
    const seen: string[] = [];
    const proxy = createServer((req, res) => {
      seen.push(String(req.headers['x-api-key']));
      res.end('proxied');
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    onTestFinished(
      () =>
        new Promise<void>((done) => {
          proxy.close(() => {
            done();
          });
        }),
    );
    const app = await fakeHttpApp(() => ({ status: 200, body: { version: 'direct' } }));
    const client = fileURLToPath(new URL('./client.ts', import.meta.url));
    const script = `
      const { get } = await import('node:http');
      const control = await new Promise((done, fail) => {
        get('http://127.0.0.1:${String(app.port)}/control', { headers: { 'x-api-key': 'control' } },
          (res) => { res.resume(); res.on('end', () => done(res.statusCode)); }).on('error', fail);
      });
      const { createAppApi } = await import(${JSON.stringify(client)});
      const api = createAppApi({ name: 'Sonarr', service: 'sonarr', port: 8989,
        endpoint: { host: '127.0.0.1', port: ${String(app.port)} },
        key: { scheme: 'x-api-key', value: 'fake-key-0123' }, secrets: [] });
      const any = { safeParse: (data) => ({ success: true, data }) };
      console.log(JSON.stringify({ control, answer: await api.get('/status', any) }));`;
    const proxyUrl = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        {
          env: {
            PATH: process.env.PATH,
            NODE_USE_ENV_PROXY: '1',
            HTTP_PROXY: proxyUrl,
            http_proxy: proxyUrl,
          },
        },
      );
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.on('error', reject);
      child.on('close', () => {
        resolve(out.trim());
      });
    });
    expect(output).toBe('{"control":200,"answer":{"version":"direct"}}');
    // The global agent's request went to the proxy; the client's went straight to the app.
    expect(seen).toEqual(['control']);
    expect(app.requests.map((r) => r.path)).toEqual(['/status']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/http`

Expected: FAIL: `client.test.ts` can't load `./client` ("Cannot find module './client'"),
so no test runs.

- [ ] **Step 3: The client**

**Create** `packages/engine/src/http/client.ts`:

```ts
import { Agent, request } from 'node:http';
import type { z } from 'zod';
import { codeOf } from '../util/error-code';
import { redact } from '../util/redact';

/** How long one request may take, in ms. */
export const HTTP_TIMEOUT_MS = 30_000;

/** The most of an answer Mediaplane reads, in bytes. */
export const HTTP_MAX_BYTES = 5 * 1024 * 1024;

/** How long an app may keep failing transiently before Mediaplane gives up, in ms. */
export const APP_DEADLINE_MS = 120_000;

/**
 * Why an app's API call failed:
 * - `unreachable`: nothing answered (refused, no route, reset);
 * - `timeout`: no answer in time;
 * - `auth`: the app refused Mediaplane's key (401, 403);
 * - `rejected`: the app refused the request itself (another 4xx), with its message;
 * - `server`: the app failed (5xx);
 * - `protocol`: it answered, but not with something Mediaplane understands.
 */
export type AppApiErrorKind =
  'unreachable' | 'timeout' | 'auth' | 'rejected' | 'server' | 'protocol';

/**
 * An app's API call that failed, said for the user: which app, where, what, and the app's
 * own message. It never holds a secret, a request body or a query string.
 */
export class AppApiError extends Error {
  override readonly name = 'AppApiError';
  readonly kind: AppApiErrorKind;
  readonly status: number | undefined;
  /** Worth trying again: a refused connection, a timeout, 502, 503 or 504. */
  readonly transient: boolean;
  /** Whether the request may have reached the app: false only for a refused connection. */
  readonly reachedApp: boolean;

  constructor(
    message: string,
    details: {
      kind: AppApiErrorKind;
      status?: number;
      transient?: boolean;
      reachedApp?: boolean;
    },
  ) {
    super(message);
    this.kind = details.kind;
    this.status = details.status;
    this.transient = details.transient ?? false;
    this.reachedApp = details.reachedApp ?? true;
  }
}

/** Where to connect: the container's address, and its port. */
export interface Endpoint {
  host: string;
  port: number;
}

/** How a failing call is tried again; tests pass a clock and a sleep of their own. */
export interface RetryOptions {
  deadlineMs: number;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  /** A number in [0, 1): the jitter. */
  random: () => number;
}

export interface AppApiOptions {
  /** The app's name, for messages: "Sonarr". */
  name: string;
  /** Its Compose service: the Host header, and the address in messages. */
  service: string;
  /** Its container port: the Host header's port, which qBittorrent checks. */
  port: number;
  endpoint: Endpoint;
  key?: { scheme: 'x-api-key' | 'bearer'; value: string };
  /** Every secret value an answer could hold, replaced with *** in every message. */
  secrets: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  retry?: Partial<RetryOptions>;
}

/** One app's API, as Mediaplane calls it (spec §5.1, §6.1). */
export interface AppApi {
  /** "Sonarr". */
  readonly name: string;
  /** Where it was reached: "http://sonarr:8989 (172.20.0.3)". */
  readonly where: string;
  /** GET with the key, and the JSON answer, checked with `schema`. */
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  /** GET with the key, for a 2xx answer only: whatever its body, it isn't read. */
  check(path: string): Promise<void>;
  /** PUT a JSON body with the key; any 2xx answer is success. */
  put(path: string, body: unknown): Promise<void>;
  /** POST a JSON body with the key, and the JSON answer, checked with `schema`. */
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  /**
   * POST a form, without the key and never following a redirect: an app's own sign-in
   * page. Its status and Location; its cookies are dropped.
   */
  login(
    path: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<{ status: number; location: string | undefined }>;
  /** Wait, until the deadline, for `path` to answer 200 without the key. */
  ready(path: string): Promise<void>;
}

interface Call {
  method: 'GET' | 'PUT' | 'POST';
  path: string;
  body?: { type: string; text: string };
  /** Without the API key. */
  anonymous?: boolean;
}

interface Answer {
  status: number;
  location: string | undefined;
  body: string;
}

const TRANSIENT_STATUS = new Set([502, 503, 504]);

/** Connection errors that mean nothing reached the app. */
const NOT_SENT = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Connection errors after which the app may have seen the request. */
const CUT_OFF = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

/**
 * A client for one app's API. It goes straight to the container, through an agent of its
 * own: Node's global agent can send requests through a proxy from the environment
 * (NODE_USE_ENV_PROXY), which would hand the proxy the API key. It sends
 * `Host: <service>:<port>`, as the other apps of the stack do, which the apps' allowed
 * hosts and qBittorrent's Host check accept.
 */
export function createAppApi(options: AppApiOptions): AppApi {
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? HTTP_MAX_BYTES;
  const retry: RetryOptions = {
    deadlineMs: options.retry?.deadlineMs ?? APP_DEADLINE_MS,
    sleep:
      options.retry?.sleep ??
      ((ms) =>
        new Promise((done) => {
          setTimeout(done, ms);
        })),
    now: options.retry?.now ?? Date.now,
    random: options.retry?.random ?? Math.random,
  };
  const agent = new Agent({ keepAlive: false });
  const host = `${options.service}:${String(options.port)}`;
  const where = `http://${host} (${options.endpoint.host})`;
  const clean = (text: string) => redact(text, toValues(options.secrets));

  /** One attempt. Any status is an answer; a failed connection throws. */
  function attempt(call: Call): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      const headers: Record<string, string> = {
        Host: host,
        'User-Agent': 'Mediaplane',
        Accept: 'application/json',
      };
      if (!call.anonymous && options.key !== undefined) {
        if (options.key.scheme === 'bearer') {
          headers.Authorization = `Bearer ${options.key.value}`;
        } else {
          headers['X-Api-Key'] = options.key.value;
        }
      }
      if (call.body !== undefined) {
        headers['Content-Type'] = call.body.type;
        headers['Content-Length'] = String(Buffer.byteLength(call.body.text));
      }
      const req = request(
        {
          agent,
          host: options.endpoint.host,
          port: options.endpoint.port,
          method: call.method,
          path: call.path,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              reject(
                failure(call, `answered more than ${sizeOf(maxBytes)}`, {
                  kind: 'protocol',
                }),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', (cause) => {
            reject(connectionFailure(call, cause));
          });
        },
      );
      req.on('error', (cause) => {
        reject(connectionFailure(call, cause));
      });
      req.end(call.body?.text);
    });
  }

  /** `what` failed on this call: the message names the app, where, the method and path. */
  function failure(
    call: Call,
    what: string,
    details: ConstructorParameters<typeof AppApiError>[1],
  ): AppApiError {
    const path = call.path.split('?')[0] ?? call.path;
    return new AppApiError(
      clean(`${options.name} at ${where} ${what} (${call.method} ${path})`),
      details,
    );
  }

  function connectionFailure(call: Call, cause: unknown): AppApiError {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return failure(call, `did not answer within ${String(timeoutMs / 1000)} s`, {
        kind: 'timeout',
        transient: true,
      });
    }
    const code = codeOf(cause) ?? '';
    if (NOT_SENT.has(code)) {
      return failure(call, `could not be reached (${code})`, {
        kind: 'unreachable',
        transient: true,
        reachedApp: false,
      });
    }
    return failure(
      call,
      `cut the connection (${code === '' ? 'no reason given' : code})`,
      { kind: 'unreachable', transient: CUT_OFF.has(code) || code === '' },
    );
  }

  /** What a non-2xx answer means. */
  function statusFailure(call: Call, answer: Answer): AppApiError {
    const { status } = answer;
    const said = appMessage(answer.body, clean);
    const message = said === undefined ? '' : `: ${clean(said)}`;
    if (status === 401 || status === 403) {
      return failure(
        call,
        `refused Mediaplane's API key (HTTP ${String(status)})${message}`,
        {
          kind: 'auth',
          status,
        },
      );
    }
    if (status >= 500) {
      return failure(call, `failed (HTTP ${String(status)})${message}`, {
        kind: 'server',
        status,
        transient: TRANSIENT_STATUS.has(status),
      });
    }
    if (status >= 400) {
      return failure(call, `refused the request (HTTP ${String(status)})${message}`, {
        kind: 'rejected',
        status,
      });
    }
    return failure(call, `answered HTTP ${String(status)}, not a success`, {
      kind: 'protocol',
      status,
    });
  }

  /**
   * `call` until it succeeds, or until the deadline for a transient failure. Only an
   * idempotent call is tried again after the app may have seen it.
   */
  async function send(
    call: Call,
    idempotent: boolean,
    ok: (answer: Answer) => boolean = (answer) =>
      answer.status >= 200 && answer.status < 300,
  ): Promise<Answer> {
    const start = retry.now();
    for (let tries = 0; ; tries++) {
      let error: AppApiError;
      try {
        const answer = await attempt(call);
        if (ok(answer)) return answer;
        error = statusFailure(call, answer);
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw cause;
        error = cause;
      }
      const again = error.transient && (idempotent || !error.reachedApp);
      // Full jitter: a random wait up to an exponential cap, so apps that come back at
      // once aren't all asked at once.
      const delay = retry.random() * Math.min(10_000, 500 * 2 ** tries);
      if (!again || retry.now() + delay - start > retry.deadlineMs) {
        if (again) {
          throw new AppApiError(
            `${error.message}, and still did after ${String(Math.round((retry.now() - start) / 1000))} s`,
            {
              kind: error.kind,
              ...(error.status === undefined ? {} : { status: error.status }),
              transient: true,
              reachedApp: error.reachedApp,
            },
          );
        }
        throw error;
      }
      await retry.sleep(delay);
    }
  }

  function parsed<T>(call: Call, answer: Answer, schema: z.ZodType<T>): T {
    let data: unknown;
    try {
      data = JSON.parse(answer.body) as unknown;
    } catch {
      throw failure(call, 'answered with something that is not JSON', {
        kind: 'protocol',
      });
    }
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    // The paths only: a value could be a key, a password or its hash.
    const at = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join('.') || '(the answer)'),
      ),
    ];
    throw failure(
      call,
      `answered something Mediaplane doesn't understand (at ${at.join(', ')})`,
      { kind: 'protocol' },
    );
  }

  const json = (body: unknown) => ({
    type: 'application/json',
    text: JSON.stringify(body),
  });

  return {
    name: options.name,
    where,
    async get(path, schema) {
      const call: Call = { method: 'GET', path };
      return parsed(call, await send(call, true), schema);
    },
    async check(path) {
      await send({ method: 'GET', path }, true);
    },
    async put(path, body) {
      await send({ method: 'PUT', path, body: json(body) }, true);
    },
    async post(path, body, schema) {
      const call: Call = { method: 'POST', path, body: json(body) };
      return parsed(call, await send(call, false), schema);
    },
    async login(path, fields) {
      const call: Call = {
        method: 'POST',
        path,
        anonymous: true,
        body: {
          type: 'application/x-www-form-urlencoded',
          text: new URLSearchParams(fields).toString(),
        },
      };
      // A redirect is the answer: where it leads says whether the login worked.
      const answer = await send(call, true, (a) => a.status >= 200 && a.status < 400);
      return { status: answer.status, location: answer.location };
    },
    async ready(path) {
      // A starting app answers 503, or nothing: both are tried again until the deadline.
      await send(
        { method: 'GET', path, anonymous: true },
        true,
        (answer) => answer.status === 200,
      );
    },
  };
}

function toValues(secrets: readonly string[]): Record<string, string> {
  return Object.fromEntries(secrets.map((value, index) => [String(index), value]));
}

/** A size limit, in the largest unit it is a whole number of: MiB, KiB, or bytes. */
function sizeOf(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${String(bytes / 1024 / 1024)} MiB`;
  if (bytes % 1024 === 0) return `${String(bytes / 1024)} KiB`;
  return `${String(bytes)} bytes`;
}

/** At most this much of an app's own message is shown. */
const MESSAGE_LIMIT = 200;

/**
 * What an app said about a refused request, from its answer's body: Servarr's validation
 * list (`[{propertyName, errorMessage}]`), ASP.NET's problem details (`{title, errors}`),
 * a `{message}`, or plain text such as qBittorrent's or an HTML error page. Never an
 * `attemptedValue`, which can be the very password that was refused. `clean` takes the
 * secrets out before anything else changes the text: a secret that the whitespace
 * collapse changed, or the cut split, would no longer be found whole.
 */
export function appMessage(
  body: string,
  clean: (text: string) => string = (text) => text,
): string | undefined {
  const raw = clean(body);
  let message: string | undefined;
  try {
    const said = jsonMessage(JSON.parse(raw) as unknown);
    // A secret written with JSON escapes, such as \" or \u0020, appears only once parsed.
    message = said === undefined ? undefined : clean(said);
  } catch {
    message = raw
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (message === undefined || message === '') return undefined;
  return message.length > MESSAGE_LIMIT
    ? `${message.slice(0, MESSAGE_LIMIT - 1)}…`
    : message;
}

function jsonMessage(data: unknown): string | undefined {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  if (Array.isArray(data)) {
    const parts = data.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const { propertyName, errorMessage } = item as Record<string, unknown>;
      const said = text(errorMessage);
      if (said === undefined) return [];
      const field = text(propertyName);
      return [field === undefined || field === '' ? said : `${field}: ${said}`];
    });
    return parts.length === 0 ? undefined : parts.join('; ');
  }
  if (typeof data !== 'object' || data === null) return text(data);
  const { title, errors, message } = data as Record<string, unknown>;
  if (text(title) !== undefined) {
    const details =
      typeof errors === 'object' && errors !== null
        ? Object.entries(errors as Record<string, unknown>).flatMap(([field, said]) =>
            Array.isArray(said)
              ? said.flatMap((s: unknown) =>
                  text(s) === undefined ? [] : [`${field}: ${String(s)}`],
                )
              : [],
          )
        : [];
    return [text(title), ...details].join('; ');
  }
  return text(message);
}
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 829c69e..4730319 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -31,2 +31,3 @@ export * from './secrets/values';
 export * from './secrets/admin';
+export * from './http/client';
 export * from './runtime/types';
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/http`

Expected: PASS, 19 tests, the spawned proxy test and the two of the redaction's order
included.

- [ ] **Step 5: Check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/http packages/engine/src/testing packages/engine/src/index.ts
git commit -m "feat(engine): a typed HTTP client for the apps' APIs" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The integration contract, `state/resources.json`, and the Servarr admin

The shape every integration takes (spec §3.2), where Mediaplane remembers what it wired
(spec §4.1, decision 7), and the first resource: the shared admin login in Sonarr,
Radarr and Prowlarr (decision 9). Nothing runs them yet: the apps get their integration
in Task 7, once `apply` can wire it, so `plan` and `apply` stay as they are between the
tasks.

Decision: a resource spec is pure where it can be. `desired(ctx)` is the stack's wish
(fields, and secrets by name and value, which never leave the process). `observe(api,
known)` reads the app, by the id `resources.json` recorded or by the exact name.
`verify(api, desired)` checks the secrets by use, and is required when `secrets` isn't
empty. `create` and `update` change the app. `requires` names resources whose failure
skips this one. An integration's `after` names apps whose resources go first; others are
ignored.
Decision: an address is `<app>.<resource>`, as override keys start (spec §4.2), checked
by `RESOURCE_ADDRESS` in `resources.json` with the contract's own rule for a name,
`[a-z][a-z0-9_]*`, so a name the catalog refuses is refused there too (preflight M22).
Decision: the catalog checks each integration only for the apps that have one (a
`describe.each` over them), and a test lists those apps: none in this task, the three
Servarr apps from Task 7. No per-app test returns early asserting nothing (preflight
M5).
Decision: the placeholder `bootstrap-api create-admin` steps, which S3a added to say the
admin would come, leave the three apps' `credentials`: the resource replaces them.

**Files:**
- Create: `packages/engine/src/integrations/types.ts`,
  `packages/engine/src/integrations/resources.ts`,
  `packages/engine/src/integrations/resources.test.ts`, `catalog/_shared/servarr.test.ts`,
  `catalog/sonarr/integration.ts`, `catalog/radarr/integration.ts`,
  `catalog/prowlarr/integration.ts`
- Modify: `packages/engine/src/catalog/types.ts`, `packages/engine/src/paths.ts`,
  `packages/engine/src/index.ts`, `catalog/_shared/servarr.ts`, `catalog/sonarr/app.ts`,
  `catalog/radarr/app.ts`, `catalog/prowlarr/app.ts`, `scripts/docs/catalog-facts.ts`
- Generated: every `catalog/*/README.md` (a "Managed in the app" line)
- Test: `catalog/catalog.test.ts`, `scripts/docs/catalog-facts.test.ts`

**Interfaces:**
- **Consumes:** `AppApi` (Task 4); `ResolvedStack`, `ResolvedApp`; `writeFileAtomic`,
  `ensureDir`, `readIfExists`, `compare`; `fakeHttpApp` (Task 4) in the tests.
- **Produces:**
  - `type Scalar = string | number | boolean`, `type Fields = Readonly<Record<string, Scalar>>`;
  - `interface DesiredResource { name: string; fields: Fields; secrets: Readonly<Record<string, string>> }`;
  - `interface ObservedResource { id: string | number | null; name: string; fields: Fields }`;
  - `interface WiringContext { stack: ResolvedStack; app: ResolvedApp; admin: { username: string; password: string } }`;
  - `interface ResourceSpec { name; fields: readonly string[]; secrets: readonly string[]; requires?: readonly string[]; desired(ctx): DesiredResource | undefined; observe(api, known): Promise<ObservedResource | undefined>; verify?(api, desired): Promise<boolean>; create(api, desired): Promise<{ id: string | number | null }>; update(api, desired, observed): Promise<void> }`;
  - `interface Integration { after: readonly string[]; resources: readonly ResourceSpec[] }`
    and `defineIntegration(integration): Integration`; `AppDefinition.integration?`;
  - `RESOURCES_PATH = 'state/resources.json'`, `RESOURCES_SCHEMA = 'mediaplane.resources/v1'`,
    `RESOURCE_ADDRESS`, `type KnownResource = { id; name; fields; secrets: string[]; appliedAt: string }`,
    `type KnownResources = Record<string, KnownResource>`,
    `readResources(home): Promise<KnownResources>` (throws on a bad file),
    `writeResources(home, resources): Promise<void>`;
  - `servarrAdmin(version: 'v1' | 'v3'): ResourceSpec` and
    `servarrIntegration(version, after?: readonly string[]): Integration`;
  - `catalog/<app>/integration.ts`, each a default export: Sonarr and Radarr
    `servarrIntegration('v3')`, Prowlarr `servarrIntegration('v1', ['radarr', 'sonarr'])`.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/integrations/resources.test.ts`:

```ts
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESOURCES_PATH } from '../paths';
import { tempDir } from '../testing/temp';
import { readResources, writeResources, type KnownResources } from './resources';

const AT = '2026-10-10T12:00:00.000Z';
const ADMIN = {
  id: null,
  name: 'admin',
  fields: { username: 'admin' },
  secrets: ['password'],
  appliedAt: AT,
};

async function homeWith(content: string): Promise<string> {
  const home = await tempDir('mediaplane-resources-');
  await mkdir(join(home, 'state'));
  await writeFile(join(home, RESOURCES_PATH), content);
  return home;
}

describe('resources.json', () => {
  it('holds nothing before the first wiring', async () => {
    expect(await readResources(await tempDir('mediaplane-resources-'))).toEqual({});
  });

  it('keeps each resource by address, sorted, private, with no secret value', async () => {
    const home = await tempDir('mediaplane-resources-');
    const resources: KnownResources = {
      'sonarr.admin': ADMIN,
      'radarr.admin': { ...ADMIN, fields: { username: 'media-admin' } },
    };
    await writeResources(home, resources);
    expect(await readResources(home)).toEqual(resources);
    const text = await readFile(join(home, RESOURCES_PATH), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ schema: 'mediaplane.resources/v1' });
    expect(text.indexOf('radarr.admin')).toBeLessThan(text.indexOf('sonarr.admin'));
    expect((await stat(join(home, RESOURCES_PATH))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'state'))).mode & 0o777).toBe(0o700);
  });

  it('refuses a file of another schema or shape, saying where', async () => {
    const other = await homeWith(
      JSON.stringify({ schema: 'mediaplane.resources/v9', resources: {} }),
    );
    await expect(readResources(other)).rejects.toThrow(
      `${join(other, RESOURCES_PATH)} is not a Mediaplane resources file (mediaplane.resources/v1): schema:`,
    );
    const odd = await homeWith(
      JSON.stringify({ schema: 'mediaplane.resources/v1', resources: { sonarr: ADMIN } }),
    );
    await expect(readResources(odd)).rejects.toThrow('resources.sonarr:');
    // A name the contract refuses: lower case, as in ResourceSpec.name.
    const upper = await homeWith(
      JSON.stringify({
        schema: 'mediaplane.resources/v1',
        resources: { 'sonarr.Admin': ADMIN },
      }),
    );
    await expect(readResources(upper)).rejects.toThrow('resources.sonarr.Admin:');
    await expect(readResources(await homeWith('{'))).rejects.toThrow('is not valid JSON');
  });
});
```

**Create** `catalog/_shared/servarr.test.ts`:

```ts
import { createAppApi, type DesiredResource } from '@mediaplane/engine';
import { fakeHttpApp, type FakeRequest } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { servarrAdmin } from './servarr';

const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';

/**
 * Part of what Sonarr 4.0.20 answers to GET /api/v3/config/host, with fake values: the
 * key in clear, and the password as a hash once there is a user.
 */
const HOST = {
  id: 1,
  bindAddress: '*',
  port: 8989,
  urlBase: '',
  authenticationMethod: 'forms',
  authenticationRequired: 'enabled',
  analyticsEnabled: true,
  username: '',
  password: '',
  passwordConfirmation: '',
  apiKey: KEY,
  trustedNetworks: '',
  allowedHosts: '',
};

const DESIRED: DesiredResource = {
  name: 'admin',
  fields: { username: 'admin' },
  secrets: { password: PASSWORD },
};

/** A fake Sonarr whose host settings start as `host`, and whose login takes `password`. */
async function sonarr(host: Record<string, unknown> = HOST) {
  let settings = { ...host };
  const app = await fakeHttpApp((request: FakeRequest) => {
    if (request.path === '/api/v3/config/host' && request.method === 'GET') {
      return { status: 200, body: settings };
    }
    if (request.path === '/api/v3/config/host/1' && request.method === 'PUT') {
      const sent = JSON.parse(request.body) as Record<string, unknown>;
      settings = { ...sent, password: 'fake-hash==', passwordConfirmation: '' };
      return { status: 202, body: settings };
    }
    if (request.path === '/login' && request.method === 'POST') {
      const form = new URLSearchParams(request.body);
      const ok =
        form.get('username') === settings.username && form.get('password') === PASSWORD;
      return {
        status: 302,
        headers: { Location: ok ? '/' : '/login?returnUrl=&loginFailed=true' },
      };
    }
    return { status: 404 };
  });
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: app.port },
    key: { scheme: 'x-api-key', value: KEY },
    secrets: [KEY, PASSWORD],
    retry: { deadlineMs: 0 },
  });
  return { api, app };
}

describe('servarrAdmin', () => {
  const admin = servarrAdmin('v3');

  it('manages the user name, and keeps the password a secret', () => {
    expect(admin).toMatchObject({
      name: 'admin',
      fields: ['username'],
      secrets: ['password'],
    });
  });

  it('finds no admin while the app has no user', async () => {
    const { api } = await sonarr();
    expect(await admin.observe(api, undefined)).toBeUndefined();
  });

  it('sets the login through the host settings, sending the rest back as it came', async () => {
    const { api, app } = await sonarr();
    expect(await admin.create(api, DESIRED)).toEqual({ id: null });
    const put = app.requests.find((r) => r.method === 'PUT');
    expect(put?.path).toBe('/api/v3/config/host/1');
    expect(JSON.parse(put?.body ?? '{}')).toEqual({
      ...HOST,
      username: 'admin',
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    });
    expect(await admin.observe(api, undefined)).toEqual({
      id: null,
      name: 'admin',
      fields: { username: 'admin' },
    });
  });

  it('checks the password by signing in with it, without the API key', async () => {
    const { api, app } = await sonarr({ ...HOST, username: 'admin' });
    expect(await admin.verify?.(api, DESIRED)).toBe(true);
    expect(
      await admin.verify?.(api, { ...DESIRED, secrets: { password: 'other' } }),
    ).toBe(false);
    const login = app.requests.find((r) => r.path === '/login');
    expect(login?.headers['x-api-key']).toBeUndefined();
  });

  it('changes a user name that differs', async () => {
    const { api } = await sonarr({ ...HOST, username: 'someone' });
    const observed = await admin.observe(api, undefined);
    expect(observed?.fields).toEqual({ username: 'someone' });
    if (observed === undefined) throw new Error('no admin observed');
    await admin.update(api, DESIRED, observed);
    expect((await admin.observe(api, undefined))?.fields).toEqual({ username: 'admin' });
  });

  it("uses Prowlarr's /api/v1", async () => {
    const app = await fakeHttpApp((request) =>
      request.path === '/api/v1/config/host'
        ? { status: 200, body: { ...HOST, username: 'admin' } }
        : { status: 404 },
    );
    const api = createAppApi({
      name: 'Prowlarr',
      service: 'prowlarr',
      port: 9696,
      endpoint: { host: '127.0.0.1', port: app.port },
      key: { scheme: 'x-api-key', value: KEY },
      secrets: [KEY],
    });
    expect((await servarrAdmin('v1').observe(api, undefined))?.fields).toEqual({
      username: 'admin',
    });
  });

  it('wants the shared admin login', () => {
    expect(
      admin.desired({
        admin: { username: 'media-admin', password: PASSWORD },
      } as Parameters<typeof admin.desired>[0]),
    ).toEqual({
      name: 'admin',
      fields: { username: 'media-admin' },
      secrets: { password: PASSWORD },
    });
  });
});
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 63b9c8a..07f6dbc 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -45,2 +45,42 @@ describe('catalog', () => {
 
+  it('orders the integrations with no loop in their "after"', () => {
+    const after = new Map(catalog.map((app) => [app.id, app.integration?.after ?? []]));
+    const visit = (id: string, path: readonly string[]): void => {
+      expect(path, `a loop: ${[...path, id].join(' → ')}`).not.toContain(id);
+      for (const next of after.get(id) ?? []) visit(next, [...path, id]);
+    };
+    for (const app of catalog) visit(app.id, []);
+  });
+
+  it('gives an integration to the apps Mediaplane wires so far', () => {
+    expect(
+      catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
+    ).toEqual([]);
+  });
+
+  describe.each(
+    catalog.flatMap((app) =>
+      app.integration === undefined ? [] : [[app.id, app, app.integration] as const],
+    ),
+  )("%s's integration", (_id, app, integration) => {
+    it('wires itself only through an API, with resources named and checked as the contract says', () => {
+      expect(app.api).toBeDefined();
+      for (const other of integration.after) {
+        expect(catalog.map((def) => def.id)).toContain(other);
+      }
+      const addresses = catalog.flatMap((def) =>
+        (def.integration?.resources ?? []).map((r) => `${def.id}.${r.name}`),
+      );
+      for (const resource of integration.resources) {
+        expect(resource.name).toMatch(/^[a-z][a-z0-9_]*$/);
+        for (const field of resource.fields) expect(field).toMatch(/^[a-z][A-Za-z0-9]*$/);
+        // A secret is applied and checked, never compared: something must check it.
+        if (resource.secrets.length > 0) expect(typeof resource.verify).toBe('function');
+        for (const needed of resource.requires ?? []) expect(addresses).toContain(needed);
+      }
+      const names = integration.resources.map((r) => r.name);
+      expect(new Set(names).size).toBe(names.length);
+    });
+  });
+
   describe.each(catalog.map((app) => [app.id, app] as const))('%s', (_id, app) => {
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 00b9456..a112ce8 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -3,2 +3,3 @@ import type { AppDefinition } from '@mediaplane/engine';
 import { describe, expect, it } from 'vitest';
+import { servarrIntegration } from '../../catalog/_shared/servarr';
 import { FACTS_END, FACTS_START, renderFacts, withFacts } from './catalog-facts';
@@ -58,2 +59,12 @@ describe('renderFacts', () => {
 
+  it('lists what Mediaplane manages in an app, by override key', () => {
+    const wired = { ...app('prowlarr'), integration: servarrIntegration('v1') };
+    expect(renderFacts(wired)).toContain(
+      '- **Managed in the app:** `prowlarr.admin`: fields `prowlarr.admin.username`; the secret `password`, checked and never shown\n',
+    );
+    expect(renderFacts(app('qbittorrent'))).toContain(
+      '- **Managed in the app:** nothing yet\n',
+    );
+  });
+
   it('shows what an app turns on with its default settings', () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/integrations catalog scripts/docs`

Expected: FAIL: `resources.test.ts` can't load `./resources`, `servarr.test.ts` stops at
`servarrAdmin is not a function`, and the facts test of "Managed in the app" fails.
`catalog.test.ts`'s new checks pass: its list of the apps with an integration is empty
until Task 7, and so its check of each runs for none yet. 3 files failed, 7 passed.

- [ ] **Step 3: The contract, the file, and the admin resource**

**Create** `packages/engine/src/integrations/types.ts`:

```ts
import type { AppApi } from '../http/client';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import type { KnownResource } from './resources';

/** A managed field's value. */
export type Scalar = string | number | boolean;

/** Managed fields, by name. */
export type Fields = Readonly<Record<string, Scalar>>;

/** What Mediaplane wants a resource to be (spec §6.3: D). */
export interface DesiredResource {
  /** Its name in the app. */
  name: string;
  /** The managed fields: compared with the app's, and kept in resources.json. */
  fields: Fields;
  /** The secret values it holds: applied and verified, never compared, kept or shown. */
  secrets: Readonly<Record<string, string>>;
}

/** What the app holds now (spec §6.3: O): its id, its name and its managed fields. */
export interface ObservedResource {
  /** The app's id for it; null for a singleton, such as the app's own settings. */
  id: string | number | null;
  name: string;
  fields: Fields;
}

/** What a resource's desired() sees. It holds secrets: never log, print or keep it. */
export interface WiringContext {
  stack: ResolvedStack;
  app: ResolvedApp;
  /** The shared admin login (spec §6.1). */
  admin: { username: string; password: string };
}

/**
 * One resource Mediaplane manages in an app (spec §3.2, §6.2), such as Sonarr's admin
 * login or its download client. Its address is "<app>.<name>", and a managed field's is
 * "<app>.<name>.<field>", as override keys name them (spec §4.2).
 */
export interface ResourceSpec {
  /** One segment of lower-case letters, digits and "_": "admin", "download_client". */
  name: string;
  /** The managed fields: compared, kept, and listed in the app's README. */
  fields: readonly string[];
  /** The secrets it holds, by name: applied and checked with verify, never compared. */
  secrets: readonly string[];
  /** Resources ("<app>.<name>") that must be in place first: one that failed skips this. */
  requires?: readonly string[];
  /** What the stack wants, or undefined when it wants none. Pure. */
  desired(ctx: WiringContext): DesiredResource | undefined;
  /**
   * What the app holds: by the id resources.json recorded (`known`), else by the exact
   * name Mediaplane gives it (spec §6.3). Undefined when it holds none.
   */
  observe(
    api: AppApi,
    known: KnownResource | undefined,
  ): Promise<ObservedResource | undefined>;
  /**
   * Whether the app takes the desired secrets: a sign-in, or the app's own test (spec
   * §6.3, "secrets are verified, never compared"). Required when `secrets` isn't empty.
   */
  verify?(api: AppApi, desired: DesiredResource): Promise<boolean>;
  /** Make it. The id the app gave it, or null for a singleton. */
  create(api: AppApi, desired: DesiredResource): Promise<{ id: string | number | null }>;
  /** Make what the app holds match: the managed fields and the secrets. Idempotent. */
  update(
    api: AppApi,
    desired: DesiredResource,
    observed: ObservedResource,
  ): Promise<void>;
}

/** How Mediaplane wires one app (spec §3.2): its resources, after which apps. */
export interface Integration {
  /** Apps whose resources go first (spec §6.2, "Ordering"). Others are ignored. */
  after: readonly string[];
  resources: readonly ResourceSpec[];
}

/** Identity function that gives an integration full type inference. */
export function defineIntegration(integration: Integration): Integration {
  return integration;
}
```

**Create** `packages/engine/src/integrations/resources.ts`:

```ts
import { join } from 'node:path';
import { z } from 'zod';
import { RESOURCES_PATH, STATE_DIR } from '../paths';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';

export const RESOURCES_SCHEMA = 'mediaplane.resources/v1';

/**
 * "<app>.<resource>", as override keys start (spec §4.2): a resource's name is what the
 * contract allows (catalog.test.ts checks every one).
 */
export const RESOURCE_ADDRESS = /^[a-z0-9-]+\.[a-z][a-z0-9_]*$/;

const knownSchema = z.strictObject({
  /** The app's id for it; null for a singleton. */
  id: z.union([z.string(), z.number(), z.null()]),
  name: z.string(),
  /** The managed fields as last applied (spec §6.3: L). Never a secret. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** The names of the secrets it holds: never their values, nor a hash of them. */
  secrets: z.array(z.string()),
  appliedAt: z.iso.datetime(),
});

const fileSchema = z.strictObject({
  schema: z.literal(RESOURCES_SCHEMA),
  resources: z.record(z.string().regex(RESOURCE_ADDRESS), knownSchema),
});

/** What Mediaplane last applied to one resource, as state/resources.json keeps it. */
export type KnownResource = z.infer<typeof knownSchema>;

/** Every resource Mediaplane manages, by address. */
export type KnownResources = Record<string, KnownResource>;

/**
 * state/resources.json, or nothing when it doesn't exist yet. It holds no secret, so an
 * error may name what is wrong in it.
 */
export async function readResources(home: string): Promise<KnownResources> {
  const path = join(home, RESOURCES_PATH);
  const text = await readIfExists(path);
  if (text === undefined) return {};
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const parsed = fileSchema.safeParse(data);
  if (!parsed.success) {
    const faults = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(the file)'}: ${issue.message}`,
    );
    throw new Error(
      `${path} is not a Mediaplane resources file (${RESOURCES_SCHEMA}): ${faults.join('; ')}`,
    );
  }
  return parsed.data.resources;
}

/** Save it atomically, sorted, private to its owner: state/ 0700, the file 0600. */
export async function writeResources(
  home: string,
  resources: KnownResources,
): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(resources).sort(([a], [b]) => compare(a, b)),
  );
  const checked = fileSchema.parse({ schema: RESOURCES_SCHEMA, resources: sorted });
  await ensureDir(join(home, STATE_DIR), 0o700);
  await writeFileAtomic(
    join(home, RESOURCES_PATH),
    `${JSON.stringify(checked, null, 2)}\n`,
    0o600,
  );
}
```

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index eace16d..fc4d2a9 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -3,2 +3,3 @@ import type { AppSettings, StackConfig } from '../config/schema';
 import type { Diagnostic } from '../diagnostics';
+import type { Integration } from '../integrations/types';
 
@@ -142,2 +143,4 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   api?: ApiSpec;
+  /** What Mediaplane wires in it, through `api` (catalog/<app>/integration.ts). */
+  integration?: Integration;
   /** App-specific settings under apps.<id> in stack.yaml. */
```

**Change** `packages/engine/src/paths.ts`:

```diff
diff --git a/packages/engine/src/paths.ts b/packages/engine/src/paths.ts
index 62679f9..4da3923 100644
--- a/packages/engine/src/paths.ts
+++ b/packages/engine/src/paths.ts
@@ -8,2 +8,3 @@ export const STATE_DIR = 'state';
 export const SECRETS_PATH = 'state/secrets.json';
+export const RESOURCES_PATH = 'state/resources.json';
 export const LOCK_PATH = 'state/lock';
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 4730319..264837a 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -32,2 +32,4 @@ export * from './secrets/admin';
 export * from './http/client';
+export * from './integrations/types';
+export * from './integrations/resources';
 export * from './runtime/types';
```

**Change** `catalog/_shared/servarr.ts`:

```diff
diff --git a/catalog/_shared/servarr.ts b/catalog/_shared/servarr.ts
index 375138c..a578304 100644
--- a/catalog/_shared/servarr.ts
+++ b/catalog/_shared/servarr.ts
@@ -1,7 +1,13 @@
-import type {
-  ApiSpec,
-  AppContext,
-  ConfigFile,
-  ConfigFileContext,
+import {
+  defineIntegration,
+  type ApiSpec,
+  type AppApi,
+  type AppContext,
+  type ConfigFile,
+  type ConfigFileContext,
+  type DesiredResource,
+  type Integration,
+  type ResourceSpec,
 } from '@mediaplane/engine';
+import { z } from 'zod';
 
@@ -51,2 +57,70 @@ export function servarrApi(version: 'v1' | 'v3'): ApiSpec {
 
+/** What Mediaplane reads of the app's host settings; the rest goes back as it came. */
+const hostSettings = z.looseObject({ id: z.number(), username: z.string() });
+
+/**
+ * The shared admin login (spec §6.1) in Sonarr, Radarr or Prowlarr: the singleton
+ * resource `<app>.admin`, whose user name is a managed field and whose password is a
+ * secret, checked by signing in with it. The API is the only way in once the app has
+ * started (spec §6.4), and it needs no restart.
+ */
+export function servarrAdmin(version: 'v1' | 'v3'): ResourceSpec {
+  const path = `/api/${version}/config/host`;
+  // The whole settings object goes back, as the app's own UI sends it, with the login in
+  // it. It holds the app's key and the old password's hash: it is never shown.
+  const save = async (api: AppApi, desired: DesiredResource) => {
+    const current = await api.get(path, hostSettings);
+    const password = desired.secrets.password ?? '';
+    await api.put(`${path}/${String(current.id)}`, {
+      ...current,
+      username: desired.fields.username,
+      password,
+      passwordConfirmation: password,
+    });
+  };
+  return {
+    name: 'admin',
+    fields: ['username'],
+    secrets: ['password'],
+    desired: ({ admin }) => ({
+      name: 'admin',
+      fields: { username: admin.username },
+      secrets: { password: admin.password },
+    }),
+    async observe(api) {
+      const { username } = await api.get(path, hostSettings);
+      // No user yet: the app asks for a login that nobody can give.
+      return username === ''
+        ? undefined
+        : { id: null, name: 'admin', fields: { username } };
+    },
+    async verify(api, desired) {
+      const signedIn = await api.login('/login', {
+        username: String(desired.fields.username),
+        password: desired.secrets.password ?? '',
+      });
+      // It sends a login that works on to "/", and one that doesn't back to
+      // /login?…loginFailed=true.
+      return (
+        signedIn.status === 302 &&
+        signedIn.location !== undefined &&
+        !signedIn.location.includes('loginFailed')
+      );
+    },
+    async create(api, desired) {
+      await save(api, desired);
+      return { id: null };
+    },
+    update: (api, desired) => save(api, desired),
+  };
+}
+
+/** How Mediaplane wires Sonarr, Radarr or Prowlarr, after the apps `after`. */
+export function servarrIntegration(
+  version: 'v1' | 'v3',
+  after: readonly string[] = [],
+): Integration {
+  return defineIntegration({ after, resources: [servarrAdmin(version)] });
+}
+
 /**
```

**Create** `catalog/sonarr/integration.ts`:

```ts
import { servarrIntegration } from '../_shared/servarr';

/** What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, so far. */
export default servarrIntegration('v3');
```

**Create** `catalog/radarr/integration.ts`:

```ts
import { servarrIntegration } from '../_shared/servarr';

/** What Mediaplane wires in Radarr (spec §6.2): the shared admin login, so far. */
export default servarrIntegration('v3');
```

**Create** `catalog/prowlarr/integration.ts`:

```ts
import { servarrIntegration } from '../_shared/servarr';

/**
 * What Mediaplane wires in Prowlarr (spec §6.2): the shared admin login, so far. It comes
 * after Sonarr and Radarr, whose links it will test (Slice 5).
 */
export default servarrIntegration('v1', ['radarr', 'sonarr']);
```

**Change** `catalog/sonarr/app.ts`:

```diff
diff --git a/catalog/sonarr/app.ts b/catalog/sonarr/app.ts
index b37f4df..2c3e051 100644
--- a/catalog/sonarr/app.ts
+++ b/catalog/sonarr/app.ts
@@ -19,6 +19,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
-  credentials: [
-    { step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' },
-    { step: 'bootstrap-api', action: 'create-admin' },
-  ],
+  credentials: [{ step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' }],
   health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:8989/ping'] },
```

**Change** `catalog/radarr/app.ts`:

```diff
diff --git a/catalog/radarr/app.ts b/catalog/radarr/app.ts
index c025914..535e554 100644
--- a/catalog/radarr/app.ts
+++ b/catalog/radarr/app.ts
@@ -19,6 +19,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
-  credentials: [
-    { step: 'env', var: 'RADARR__AUTH__APIKEY', secret: 'apiKey' },
-    { step: 'bootstrap-api', action: 'create-admin' },
-  ],
+  credentials: [{ step: 'env', var: 'RADARR__AUTH__APIKEY', secret: 'apiKey' }],
   health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:7878/ping'] },
```

**Change** `catalog/prowlarr/app.ts`:

```diff
diff --git a/catalog/prowlarr/app.ts b/catalog/prowlarr/app.ts
index d4fea84..6b0e35f 100644
--- a/catalog/prowlarr/app.ts
+++ b/catalog/prowlarr/app.ts
@@ -19,6 +19,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
-  credentials: [
-    { step: 'env', var: 'PROWLARR__AUTH__APIKEY', secret: 'apiKey' },
-    { step: 'bootstrap-api', action: 'create-admin' },
-  ],
+  credentials: [{ step: 'env', var: 'PROWLARR__AUTH__APIKEY', secret: 'apiKey' }],
   health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:9696/ping'] },
```

**Change** `scripts/docs/catalog-facts.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.ts b/scripts/docs/catalog-facts.ts
index 961a174..f3813f1 100644
--- a/scripts/docs/catalog-facts.ts
+++ b/scripts/docs/catalog-facts.ts
@@ -74,2 +74,22 @@ function api(def: AppDefinition): string {
 
+/** What Mediaplane manages in the app, as override keys name it (spec §4.2, §6.3). */
+function managed(def: AppDefinition): string {
+  const resources = def.integration?.resources ?? [];
+  if (resources.length === 0) return 'nothing yet';
+  return resources
+    .map((resource) => {
+      const fields = resource.fields.map((field) =>
+        code(`${def.id}.${resource.name}.${field}`),
+      );
+      const secrets = resource.secrets.map(code);
+      return `${code(`${def.id}.${resource.name}`)}: ${[
+        ...(fields.length === 0 ? [] : [`fields ${fields.join(', ')}`]),
+        ...(secrets.length === 0
+          ? []
+          : [`the secret ${secrets.join(', ')}, checked and never shown`]),
+      ].join('; ')}`;
+    })
+    .join('. ');
+}
+
 function secret(source: SecretSource): string {
@@ -111,2 +131,3 @@ export function renderFacts(def: AppDefinition): string {
     ['API', api(def)],
+    ['Managed in the app', managed(def)],
     ['Needs', list(def.requires.map((r) => r.capability))],
```

Regenerate the READMEs' facts (every `catalog/*/README.md`):

```bash
pnpm docs:generate
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine catalog scripts/docs`

Expected: PASS.

- [ ] **Step 5: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src catalog scripts/docs
git commit -m "feat(engine): the integration contract, state/resources.json, and the Servarr admin resource" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `plan` asks the apps: the wiring in the plan

`plan` gains the wiring (spec §5 step 5, decision 11): for each app with an API, in
order, whether it takes Mediaplane's key, then what `apply` would do to each resource.
It asks the apps and changes nothing in them. After this task the real catalog's four
apps with an API are checked (their key only, since no app has an integration until
Task 7), and the CLI shows a "Wiring:" section.

Decision: an app is asked only when it is *settled*: running, healthy, and left as it is
by this plan. Any other app's resources are `after-start`, so a first plan, or one that
recreates an app, never waits for an app that isn't there.
Decision: `plan` joins the network first (decision 2), and a stack that has never been
applied with one (`no-network`) is `after-start` throughout. A join that is refused
(a network with a route out, or another project's) fails `plan` with `wire.network`.
Decision: `plan`'s calls have a 15 s deadline (`PLAN_DEADLINE_MS`), not apply's 120 s, so
a stuck app makes the resource `unknown` with a warning (`wire.<kind>`), and the rest of
the plan still comes.
Decision: an app's resources are examined with the secrets `apply` would set: the store
as `plan` previews it (with the keys it would generate, in memory only), and the admin
login. A secret is checked with `verify`, never compared (decision 6): a failed sign-in
makes the resource an `update` naming the secret (`password`), never showing it.
Decision: `apply`'s verify step fails while any wiring other than `unchanged` remains,
because `plan`'s `changed` now counts it. Task 7 wires them.
Decision: the CLI tests' apps are one fake server for the whole real catalog
(`fakeStackApis`), told apart by their `Host` header, through `CliDeps.wiring`.
Each fake app returns the `addresses` to give the fake runtime, which has none by
default (Task 3, preflight M10): the engine's tests pass them, and the CLI's `deps()`
puts its runtime's containers there (`onWiring`).
Decision: the fake Sonarr repeats a key it refuses (`Unauthorized: <key>`), as an app
may, so the "no secret" checks fail if the client is ever made without the stack's
secrets (preflight M5).
Decision: the shared pieces are one each (preflight M1, M2, M4): `notOnNetwork(app)`
says why an app can't be asked, for `plan` here and the wire step in Task 7;
`wiringLine(change)` is the one wiring line the CLI prints, for `plan` here and
`history` in Task 7; and the wiring tests' stack and containers come from
`testing/wiring.ts` (`WIRING_STACK`, `wiringStack()`, `WIRING_RUNNING`).

**Files:**
- Create: `packages/engine/src/integrations/wiring.ts`,
  `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/testing/wiring.ts`
- Modify: `packages/engine/src/plan/plan.ts`, `packages/engine/src/apply/apply.ts`,
  `packages/engine/src/index.ts`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`
- Test: `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/testing/index.ts`,
  `packages/cli/src/output.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** `createAppApi`, `AppApiError`, `Endpoint`, `RetryOptions` (Task 4);
  `ResourceSpec`, `DesiredResource`, `ObservedResource`, `WiringContext`,
  `KnownResource(s)`, `readResources` (Task 5); `Runtime.joinWiring`,
  `Runtime.wiringAddresses` (Task 3); `adminLogin`; `runbookUrl` (Task 1).
- **Produces:**
  - `WIRING_RUNBOOK = runbookUrl('wiring-failed')`, `PLAN_DEADLINE_MS = 15_000`;
  - `type WiringAction = 'create' | 'update' | 'adopt' | 'unchanged' | 'after-start' | 'unknown'`;
  - `interface WiringChange { resource: string; action: WiringAction; changes?: string[]; reason?: string }`;
  - `interface WiringSeams { endpoint?: (app: ResolvedApp, address: string, port: number) => Endpoint; retry?: Partial<RetryOptions>; timeoutMs?: number }`;
  - `wiringOrder(stack): ResolvedApp[]` (throws on a loop);
    `resourceAddress(app, spec): string`; `wiringTargets(app): string[]`;
    `notOnNetwork(app): string`;
    `settled(app, current, changing): boolean`;
    `reachApps(apps, options): Promise<Map<string, ReachedApp>>`, where
    `ReachedApp = { app: ResolvedApp; api: AppApi }`;
    `knownSecrets(values, keys, admin): string[]`; `checkApp(reached): Promise<void>`;
    `examine(spec, api, ctx, known): Promise<Examined | undefined>`, where
    `Examined = { desired; observed; action: 'create' | 'update' | 'adopt' | 'unchanged'; changes: string[] }`;
    `planWiring(options: PlanWiringOptions): Promise<{ changes: WiringChange[]; diagnostics: Diagnostic[] }>`;
  - `PlanOptions.wiring?: WiringSeams`, `PlanResult.wiring: WiringChange[]`,
    `PlanContext.known: KnownResources`; `CliDeps.wiring?: WiringSeams`;
  - from `@mediaplane/engine/testing`: `FAKE_LOGIN` (a resource like the Servarr admin,
    `sonarr.login`), `WIRED_CATALOG` (the fixture catalog, with an API and `FAKE_LOGIN`
    for Sonarr), `fakeStackApis(): Promise<{ app; apps: Map<string, FakeAppState>; seams; addresses }>`,
    `fakeSonarr(state?): Promise<{ app; state; seams; addresses }>`, where `addresses`
    is a `Record<string, string>` by the fakes' container IDs (`fake-<service>`), and
    `WIRING_STACK`, `wiringStack(catalog?, source?): ResolvedStack`, `WIRING_RUNNING`;
  - in the CLI's `output.ts`: `wiringLine(change: WiringChange): string`.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/testing/wiring.ts`:

```ts
import { z } from 'zod';
import type { Catalog } from '../catalog/types';
import type { WiringSeams } from '../integrations/wiring';
import type { ResourceSpec } from '../integrations/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeContainer } from './fakes';
import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixtures';
import { fakeHttpApp, type FakeApp } from './http';

/** The stack of the wiring tests: Sonarr, and qBittorrent behind Gluetun. */
export const WIRING_STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

/** `source` resolved against `catalog`, WIRED_CATALOG by default. */
export function wiringStack(
  catalog: Catalog = WIRED_CATALOG,
  source = WIRING_STACK,
): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(source),
    catalog,
    FIXTURE_HOST,
    '/opt/mediaplane',
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** WIRING_STACK's containers, running and healthy, with the fakes' IDs (fake-<service>). */
export const WIRING_RUNNING = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'].map(
  (service) => fakeContainer(service, `fake-${service}`),
);

/**
 * Where the fake apps' containers are on the wiring network, by the fakes' container IDs
 * (fake-<service>): pass it as fakeRuntime's or fakeDocker's `addresses`. The seams send
 * the calls to the fake app whatever the address.
 */
function onWiring(services: readonly string[]): Record<string, string> {
  return Object.fromEntries(services.map((service) => [`fake-${service}`, '127.0.0.1']));
}

/**
 * A resource for engine tests, shaped like the Servarr admin: "sonarr.login", whose `user`
 * is a managed field and whose `password` is a secret, checked by signing in.
 */
export const FAKE_LOGIN: ResourceSpec = {
  name: 'login',
  fields: ['user'],
  secrets: ['password'],
  desired: ({ admin }) => ({
    name: 'login',
    fields: { user: admin.username },
    secrets: { password: admin.password },
  }),
  async observe(api) {
    const { user } = await api.get('/api/v3/login', z.looseObject({ user: z.string() }));
    return user === '' ? undefined : { id: null, name: 'login', fields: { user } };
  },
  async verify(api, desired) {
    const answer = await api.login('/login', {
      password: desired.secrets.password ?? '',
    });
    return answer.location === '/';
  },
  async create(api, desired) {
    await api.put('/api/v3/login', { user: desired.fields.user, ...desired.secrets });
    return { id: null };
  },
  async update(api, desired) {
    await api.put('/api/v3/login', { user: desired.fields.user, ...desired.secrets });
  },
};

/** The fixture catalog, with an API and FAKE_LOGIN for Sonarr. */
export const WIRED_CATALOG: Catalog = fixtureCatalog.map((def) =>
  def.id === 'sonarr'
    ? { ...def, api: FIXTURE_API, integration: { after: [], resources: [FAKE_LOGIN] } }
    : def,
);

/** What one fake app of the real catalog holds; a test may change it between calls. */
export interface FakeAppState {
  /** Its admin user name and password (Servarr); empty before there is one. */
  user: string;
  password: string;
  /** false: its readiness path answers 503, as while it starts. */
  up: boolean;
}

/**
 * The APIs of the real catalog's apps, as far as Mediaplane uses them, all on one port
 * of 127.0.0.1: told apart by their Host header ("sonarr:8989", "gluetun:8080"). Sonarr,
 * Radarr and Prowlarr have /ping, system/status, config/host and /login; qBittorrent has
 * / and app/version. Any key is taken. `seams` send every app's calls there.
 */
export async function fakeStackApis(): Promise<{
  app: FakeApp;
  apps: Map<string, FakeAppState>;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const apps = new Map<string, FakeAppState>();
  const stateOf = (service: string) => {
    const known = apps.get(service);
    if (known !== undefined) return known;
    const fresh: FakeAppState = { user: '', password: '', up: true };
    apps.set(service, fresh);
    return fresh;
  };
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    const service = (headers.host ?? '').split(':')[0] ?? '';
    const state = stateOf(service);
    const keyed =
      headers['x-api-key'] !== undefined || headers.authorization !== undefined;
    if (service === 'qbittorrent' || service === 'gluetun') {
      if (path === '/') return { status: state.up ? 200 : 503, body: 'login page' };
      if (path === '/api/v2/app/version') {
        return keyed ? { status: 200, body: 'v5.2.4' } : { status: 403 };
      }
      return { status: 404 };
    }
    if (path === '/ping') return { status: state.up ? 200 : 503, body: { status: 'OK' } };
    if (path === '/login' && method === 'POST') {
      const form = new URLSearchParams(request.body);
      const ok =
        state.user !== '' &&
        form.get('username') === state.user &&
        form.get('password') === state.password;
      return {
        status: 302,
        headers: { Location: ok ? '/' : '/login?returnUrl=&loginFailed=true' },
      };
    }
    if (!keyed) return { status: 401 };
    if (/^\/api\/v[13]\/system\/status$/.test(path)) {
      return { status: 200, body: { version: '1.0.0' } };
    }
    if (/^\/api\/v[13]\/config\/host$/.test(path) && method === 'GET') {
      return { status: 200, body: { id: 1, username: state.user, password: '' } };
    }
    if (/^\/api\/v[13]\/config\/host\/1$/.test(path) && method === 'PUT') {
      const sent = JSON.parse(request.body) as { username: string; password: string };
      state.user = sent.username;
      state.password = sent.password;
      return { status: 202, body: {} };
    }
    return { status: 404 };
  });
  return {
    app,
    apps,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring(['gluetun', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']),
  };
}

/** What the fake Sonarr holds; a test may change it between calls. */
export interface FakeSonarrState {
  user: string;
  password: string;
  /** Its API key: anything else gets 401. */
  key: string;
  /** false: /ping answers 503, as while it starts. */
  up: boolean;
}

/**
 * A fake Sonarr for WIRED_CATALOG: /ping, its key check, and the FAKE_LOGIN resource. The
 * seams send every app's calls to it, and never wait. It answers a key it refuses by
 * repeating it, so a test sees whether the key is kept out of what Mediaplane says.
 */
export async function fakeSonarr(state: Partial<FakeSonarrState> = {}): Promise<{
  app: FakeApp;
  state: FakeSonarrState;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const held: FakeSonarrState = { user: '', password: '', key: '', up: true, ...state };
  const keyed = (headers: Record<string, unknown>) => headers['x-api-key'] === held.key;
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    if (path === '/ping') return { status: held.up ? 200 : 503 };
    if (path === '/login' && method === 'POST') {
      const password = new URLSearchParams(request.body).get('password');
      const ok = held.user !== '' && password === held.password;
      return { status: 302, headers: { Location: ok ? '/' : '/login?loginFailed=true' } };
    }
    if (!keyed(headers)) {
      return { status: 401, body: `Unauthorized: ${String(headers['x-api-key'])}` };
    }
    if (path === '/api/v3/system/status') return { status: 200, body: { version: '4' } };
    if (path === '/api/v3/login' && method === 'GET') {
      return { status: 200, body: { user: held.user } };
    }
    if (path === '/api/v3/login' && method === 'PUT') {
      const sent = JSON.parse(request.body) as { user: string; password: string };
      held.user = sent.user;
      held.password = sent.password;
      return { status: 202, body: {} };
    }
    return { status: 404 };
  });
  return {
    app,
    state: held,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring(['sonarr']),
  };
}
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 3dea8d5..3b0e6ac 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -6 +6,2 @@ export * from './schema';
 export * from './temp';
+export * from './wiring';
```

**Create** `packages/engine/src/integrations/wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import { fakeRuntime } from '../testing/fakes';
import { FIXTURE_API, fixtureCatalog } from '../testing/fixtures';
import {
  fakeSonarr,
  WIRING_RUNNING as RUNNING,
  wiringStack as stackOf,
} from '../testing/wiring';
import type { KnownResources } from './resources';
import {
  planWiring,
  settled,
  wiringOrder,
  type PlanWiringOptions,
  type WiringSeams,
} from './wiring';

const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';
/** A fake app's seams, and where its container is on the wiring network. */
interface Fake {
  seams: WiringSeams;
  addresses: Record<string, string>;
}

function options(fake: Fake, extra: Partial<PlanWiringOptions> = {}): PlanWiringOptions {
  const { seams, addresses } = fake;
  return {
    stack: stackOf(),
    current: RUNNING,
    changing: new Set(),
    onNetwork: true,
    runtime: fakeRuntime({ addresses }),
    keys: { sonarr: { apiKey: KEY } },
    admin: { username: 'admin', password: PASSWORD },
    secrets: [KEY, PASSWORD],
    known: {},
    seams,
    ...extra,
  };
}

const RECORDED: KnownResources = {
  'sonarr.login': {
    id: null,
    name: 'login',
    fields: { user: 'admin' },
    secrets: ['password'],
    appliedAt: '2026-10-10T12:00:00.000Z',
  },
};

describe('planWiring', () => {
  it('would create a resource the app has none of, and changes nothing itself', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(options(sonarr));
    expect(planned).toEqual({
      changes: [{ resource: 'sonarr.login', action: 'create' }],
      diagnostics: [],
    });
    expect(sonarr.app.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /ping',
      'GET /api/v3/system/status',
      'GET /api/v3/login',
    ]);
  });

  it('adopts one already as wanted that resources.json lacks, and leaves a recorded one', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    expect((await planWiring(options(sonarr))).changes).toEqual([
      { resource: 'sonarr.login', action: 'adopt' },
    ]);
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'unchanged' },
    ]);
  });

  it('would update a field that differs, and a secret the app refuses, by name only', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['user', 'password'] },
    ]);
    sonarr.state.user = 'admin';
    expect((await planWiring(options(sonarr, { known: RECORDED }))).changes).toEqual([
      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
    ]);
  });

  it('checks after the start an app whose container apply changes, or that is not ready', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const after = [{ resource: 'sonarr.login', action: 'after-start' }];
    for (const extra of [
      { changing: new Set(['sonarr']) },
      { current: RUNNING.filter((c) => c.service !== 'sonarr') },
      {
        current: RUNNING.map((c) =>
          c.service === 'sonarr' ? { ...c, health: 'starting' } : c,
        ),
      },
      // Not on the wiring network yet: there is none.
      { onNetwork: false },
    ]) {
      expect((await planWiring(options(sonarr, extra))).changes).toEqual(after);
    }
    expect(sonarr.app.requests).toEqual([]);
  });

  it('says so when an app that stays as it is has no address on the wiring network', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const planned = await planWiring(
      options(sonarr, { runtime: fakeRuntime({ addresses: {} }) }),
    );
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        reason:
          "sonarr's container is not on the stack's wiring network, so Mediaplane can't reach it",
      },
    ]);
    expect(planned.diagnostics.map((d) => d.code)).toEqual(['wire.not-on-network']);
  });

  it('says what stopped it from asking an app, with no secret, and goes on to the next', async () => {
    const sonarr = await fakeSonarr({ key: 'f'.repeat(32) });
    const planned = await planWiring(options(sonarr));
    expect(planned.changes).toEqual([
      {
        resource: 'sonarr.login',
        action: 'unknown',
        // The app repeated the key it refused: the redaction took it out.
        reason: expect.stringContaining(
          "refused Mediaplane's API key (HTTP 401): Unauthorized: ***",
        ) as string,
      },
    ]);
    expect(planned.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'wire.auth',
        hint: 'check it with "mediaplane status sonarr", then see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md',
      }),
    ]);
    expect(JSON.stringify(planned)).not.toContain(KEY);
  });

  it('only checks an app with an API and nothing to wire: it is up, and takes the key', async () => {
    const catalog = fixtureCatalog.map((def) =>
      def.id === 'sonarr' ? { ...def, api: FIXTURE_API } : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const stack = stackOf(catalog);
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      { resource: 'sonarr', action: 'unchanged' },
    ]);
    sonarr.state.up = false;
    expect((await planWiring(options(sonarr, { stack }))).changes).toEqual([
      {
        resource: 'sonarr',
        action: 'unknown',
        reason: expect.stringContaining('failed (HTTP 503)') as string,
      },
    ]);
  });
});

describe('wiringOrder', () => {
  const withAfter = (after: Record<string, string[]>): Catalog =>
    fixtureCatalog.map((def) =>
      def.id in after
        ? {
            ...def,
            api: FIXTURE_API,
            integration: { after: after[def.id] ?? [], resources: [] },
          }
        : def,
    );

  it("puts an app after the apps its integration names, and ignores the stack's absent ones", () => {
    const stack = stackOf(
      withAfter({
        qbittorrent: [],
        sonarr: ['qbittorrent', 'radarr'],
        jellyfin: ['sonarr'],
      }),
    );
    expect(wiringOrder(stack).map((app) => app.def.id)).toEqual([
      'qbittorrent',
      'sonarr',
      'jellyfin',
    ]);
  });

  it('refuses a loop', () => {
    const stack = stackOf(
      withAfter({ qbittorrent: ['sonarr'], sonarr: ['qbittorrent'] }),
    );
    expect(() => wiringOrder(stack)).toThrow('loops: qbittorrent → sonarr → qbittorrent');
  });
});

describe('settled', () => {
  it('needs the app and the one whose network it uses running, healthy and unchanged', () => {
    const qbittorrent = stackOf().apps.find((app) => app.def.id === 'qbittorrent');
    if (qbittorrent === undefined) throw new Error('no qbittorrent');
    expect(settled(qbittorrent, RUNNING, new Set())).toBe(true);
    expect(settled(qbittorrent, RUNNING, new Set(['gluetun']))).toBe(false);
    const stopped = RUNNING.map((c) =>
      c.service === 'gluetun' ? { ...c, state: 'exited' } : c,
    );
    expect(settled(qbittorrent, stopped, new Set())).toBe(false);
    const noHealthCheck = RUNNING.map((c) => ({ ...c, health: '' }));
    expect(settled(qbittorrent, noHealthCheck, new Set())).toBe(true);
  });
});
```

**Change** `packages/engine/src/plan/plan.test.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 267a2fe..f722af6 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -15,4 +15,7 @@ import {
 } from '../runtime/types';
+import { writeResources } from '../integrations/resources';
+import type { WiringSeams } from '../integrations/wiring';
 import { fakeHash, fakeProbe, fakeRuntime, running } from '../testing/fakes';
 import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
+import { fakeSonarr, WIRED_CATALOG } from '../testing/wiring';
 import { plan, planStack } from './plan';
@@ -94,2 +97,3 @@ function planFor(
     catalog = fixtureCatalog,
+    wiring,
   }: {
@@ -99,5 +103,14 @@ function planFor(
     catalog?: Catalog;
+    wiring?: WiringSeams;
   } = {},
 ) {
-  return plan({ home, catalog, host: FIXTURE_HOST, env, runtime, probe });
+  return plan({
+    home,
+    catalog,
+    host: FIXTURE_HOST,
+    env,
+    runtime,
+    probe,
+    ...(wiring === undefined ? {} : { wiring }),
+  });
 }
@@ -788 +801,118 @@ describe('plan', () => {
 });
+
+describe('plan: the wiring', () => {
+  /** A current home for WIRED_CATALOG, its apps running as `runtime` says. */
+  async function wiredHome(runtime: Runtime, seams: WiringSeams): Promise<string> {
+    const home = await makeHome({ withStore: true });
+    const first = await planFor(home, { runtime, catalog: WIRED_CATALOG, wiring: seams });
+    await mkdir(join(home, 'generated'));
+    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
+    await writeCurrentEnv(home);
+    return home;
+  }
+  const current = (calls: string[], addresses: Record<string, string>) =>
+    fakeRuntime({
+      hashes: { ok: true, hashes: HASHES },
+      containers: running(HASHES),
+      addresses,
+      calls,
+    });
+
+  it('joins the wiring network, then plans each resource of a running app', async () => {
+    const sonarr = await fakeSonarr({ key: '0'.repeat(32) });
+    const calls: string[] = [];
+    const runtime = current(calls, sonarr.addresses);
+    const home = await wiredHome(runtime, sonarr.seams);
+    calls.length = 0;
+    const result = await planFor(home, {
+      runtime,
+      catalog: WIRED_CATALOG,
+      wiring: sonarr.seams,
+    });
+    expect(result).toMatchObject({
+      ok: true,
+      changed: true,
+      wiring: [{ resource: 'sonarr.login', action: 'create' }],
+    });
+    expect(result.files.every((f) => f.status === 'unchanged')).toBe(true);
+    expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
+    expect(calls.indexOf('join-wiring')).toBeLessThan(
+      calls.findIndex((call) => call.startsWith('wiring-addresses')),
+    );
+  });
+
+  it('has nothing to change once the app holds what resources.json records', async () => {
+    const sonarr = await fakeSonarr({
+      key: '0'.repeat(32),
+      user: 'admin',
+      password: 'fake-admin-password',
+    });
+    const runtime = current([], sonarr.addresses);
+    const home = await wiredHome(runtime, sonarr.seams);
+    await writeResources(home, {
+      'sonarr.login': {
+        id: null,
+        name: 'login',
+        fields: { user: 'admin' },
+        secrets: ['password'],
+        appliedAt: '2026-10-10T12:00:00.000Z',
+      },
+    });
+    const result = await planFor(home, {
+      runtime,
+      catalog: WIRED_CATALOG,
+      wiring: sonarr.seams,
+    });
+    expect(result).toMatchObject({
+      ok: true,
+      changed: false,
+      wiring: [{ resource: 'sonarr.login', action: 'unchanged' }],
+    });
+  });
+
+  it('checks the wiring after the start on a first plan, asking no app', async () => {
+    const sonarr = await fakeSonarr();
+    const result = await planFor(await makeHome(), {
+      catalog: WIRED_CATALOG,
+      wiring: sonarr.seams,
+    });
+    expect(result.wiring).toEqual([{ resource: 'sonarr.login', action: 'after-start' }]);
+    expect(sonarr.app.requests).toEqual([]);
+  });
+
+  it('fails on a wiring network it must not join, or a resources.json it cannot read', async () => {
+    const refused = fakeRuntime({
+      join: () => {
+        throw new RuntimeError(
+          'refusing to join mediaplane_wiring: it is not internal, so Mediaplane would get a route out',
+        );
+      },
+    });
+    const network = await planFor(await makeHome(), {
+      runtime: refused,
+      catalog: WIRED_CATALOG,
+    });
+    expect(network.ok).toBe(false);
+    expect(network.diagnostics).toContainEqual(
+      expect.objectContaining({ code: 'wire.network', severity: 'error' }),
+    );
+    const home = await makeHome();
+    await mkdir(join(home, 'state'));
+    await writeFile(
+      join(home, 'state', 'resources.json'),
+      '{"schema": "something else"}',
+    );
+    const unreadable = await planFor(home, { catalog: WIRED_CATALOG });
+    expect(unreadable.ok).toBe(false);
+    expect(unreadable.diagnostics).toContainEqual(
+      expect.objectContaining({ code: 'resources.invalid', severity: 'error' }),
+    );
+  });
+
+  it('joins nothing and asks no app for a stack with no API', async () => {
+    const calls: string[] = [];
+    const result = await planFor(await makeHome(), { runtime: fakeRuntime({ calls }) });
+    expect(result.wiring).toEqual([]);
+    expect(calls.some((call) => /wiring/.test(call))).toBe(false);
+  });
+});
```

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index ad6c6b4..a66020e 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -33,2 +33,3 @@ const PLAN: PlanResult = {
   unhealthy: [],
+  wiring: [],
   diagnostics: [],
@@ -36,2 +37,40 @@ const PLAN: PlanResult = {
 
+describe('printPlan: the wiring', () => {
+  const WIRED: PlanResult = {
+    ...PLAN,
+    files: [],
+    wiring: [
+      { resource: 'sonarr.admin', action: 'create' },
+      { resource: 'radarr.admin', action: 'update', changes: ['username', 'password'] },
+      { resource: 'prowlarr.admin', action: 'adopt' },
+      { resource: 'qbittorrent', action: 'unchanged' },
+      { resource: 'seerr.admin', action: 'after-start' },
+      { resource: 'jellyfin.admin', action: 'unknown', reason: 'Jellyfin at … refused' },
+    ],
+  };
+
+  it('lists what it would wire, with the names of what differs, and counts it', () => {
+    const term = capture();
+    printPlan(WIRED, { json: false }, term.io);
+    expect(term.stdout()).toBe(
+      [
+        'Wiring:',
+        '  + create      sonarr.admin',
+        '  ~ update      radarr.admin (username, password)',
+        '  = adopt       prowlarr.admin',
+        '  > after start seerr.admin',
+        '  ? unknown     jellyfin.admin',
+        'Plan: 3 resources to wire, 1 wiring check after the start, 1 wiring check that could not be made.',
+        '',
+      ].join('\n'),
+    );
+  });
+
+  it('gives every resource in JSON, unchanged ones too', () => {
+    const term = capture();
+    printPlan(WIRED, { json: true }, term.io);
+    expect((JSON.parse(term.stdout()) as PlanResult).wiring).toEqual(WIRED.wiring);
+  });
+});
+
 describe('printPlan', () => {
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index e1549ad..5e7ebef 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -27,2 +27,3 @@ import {
   fakeRuntime,
+  fakeStackApis,
   running,
@@ -30,3 +31,3 @@ import {
 } from '@mediaplane/engine/testing';
-import { describe, expect, it, vi } from 'vitest';
+import { beforeEach, describe, expect, it, vi } from 'vitest';
 import { PromptCancelled } from './prompt';
@@ -70,4 +71,5 @@ async function currentHome(
     env: {},
-    runtime,
+    runtime: onWiring(runtime),
     probe: fakeProbe(),
+    wiring: apis.seams,
   });
@@ -105,2 +107,24 @@ function expectNoSecrets(output: string, secrets: readonly string[]): void {
 
+/** The apps' APIs, faked anew for each test: the test stack's Sonarr and qBittorrent. */
+let apis: Awaited<ReturnType<typeof fakeStackApis>>;
+beforeEach(async () => {
+  apis = await fakeStackApis();
+});
+
+/** `runtime`, with the stack's containers on the wiring network, where `apis` are. */
+function onWiring(runtime: Runtime): Runtime {
+  return {
+    ...runtime,
+    wiringAddresses: (ids) =>
+      Promise.resolve(
+        Object.fromEntries(
+          ids.flatMap((id) => {
+            const address = apis.addresses[id];
+            return address === undefined ? [] : [[id, address]];
+          }),
+        ),
+      ),
+  };
+}
+
 function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
@@ -108,4 +132,5 @@ function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
     host: () => Promise.resolve(FIXTURE_HOST),
-    runtime: () => runtime,
+    runtime: () => onWiring(runtime),
     probe: () => fakeProbe(),
+    wiring: apis.seams,
   };
@@ -182,3 +207,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 2 wiring checks after the start.',
     );
@@ -243,3 +268,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toBe(
-      'Not healthy yet: sonarr (unhealthy)\nPlan: 1 app to wait for.\n',
+      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr\nPlan: 1 app to wait for, 1 wiring check after the start.\n',
     );
@@ -440,3 +465,3 @@ describe('mediaplane apply', () => {
     expect(first.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 2 wiring checks after the start.',
     );
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/integrations packages/engine/src/plan packages/cli/src/output.test.ts packages/cli/src/run.test.ts`

Expected: FAIL: `wiring.test.ts` can't load `./wiring`; `plan.test.ts`'s five "plan: the
wiring" tests (the plan has no `wiring`); the output test of the "Wiring:" section ("No
changes." comes instead); and three `run.test.ts` tests whose summary now counts the
wiring checks. 4 files, 9 tests failed, 122 passed.

- [ ] **Step 3: The wiring in `plan`**

**Create** `packages/engine/src/integrations/wiring.ts`:

```ts
import { warning, type Diagnostic } from '../diagnostics';
import {
  AppApiError,
  createAppApi,
  type AppApi,
  type Endpoint,
  type RetryOptions,
} from '../http/client';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { runbookUrl } from '../runbooks';
import type { ContainerState, Runtime } from '../runtime/types';
import { compare } from '../util/sort';
import type { KnownResource, KnownResources } from './resources';
import type {
  DesiredResource,
  ObservedResource,
  ResourceSpec,
  WiringContext,
} from './types';

/** Where a failed wiring step sends you. */
export const WIRING_RUNBOOK = runbookUrl('wiring-failed');

/** How long plan waits for an app that is starting, in ms: apply waits APP_DEADLINE_MS. */
export const PLAN_DEADLINE_MS = 15_000;

/**
 * What apply would do to one managed resource (spec §5 step 5, "the wiring"):
 * - `create`, `update`: make it, or make it match (`changes` names what differs);
 * - `adopt`: the app already holds it as wanted, and resources.json doesn't say so yet;
 * - `unchanged`;
 * - `after-start`: its app isn't running, or apply will change its container, so it is
 *   checked after the start;
 * - `unknown`: Mediaplane couldn't ask the app (`reason`, and a warning, say why).
 */
export type WiringAction =
  'create' | 'update' | 'adopt' | 'unchanged' | 'after-start' | 'unknown';

export interface WiringChange {
  /** "<app>.<resource>", or "<app>" alone for an app Mediaplane only checks. */
  resource: string;
  action: WiringAction;
  /** The managed fields and secrets that differ, by name. */
  changes?: string[];
  /** Why it couldn't be checked. */
  reason?: string;
}

/** For tests: where an app is reached, and how long its calls take and are tried. */
export interface WiringSeams {
  endpoint?: (app: ResolvedApp, address: string, port: number) => Endpoint;
  retry?: Partial<RetryOptions>;
  timeoutMs?: number;
}

/** An app Mediaplane calls, ready to be asked. */
export interface ReachedApp {
  app: ResolvedApp;
  api: AppApi;
}

/**
 * The apps with an API, in the order their integrations go (spec §6.2, "Ordering"): an
 * app after every app its integration names in `after`, by id otherwise. Throws on a
 * loop, which the catalog's tests rule out.
 */
export function wiringOrder(stack: ResolvedStack): ResolvedApp[] {
  const apps = stack.apps.filter((app) => app.def.api !== undefined);
  const byId = new Map(apps.map((app) => [app.def.id, app]));
  const ordered: ResolvedApp[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (app: ResolvedApp, path: readonly string[]): void => {
    const id = app.def.id;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      throw new Error(`the integrations' "after" loops: ${[...path, id].join(' → ')}`);
    }
    state.set(id, 'visiting');
    for (const before of [...(app.def.integration?.after ?? [])].sort(compare)) {
      const other = byId.get(before);
      if (other !== undefined) visit(other, [...path, id]);
    }
    state.set(id, 'done');
    ordered.push(app);
  };
  for (const app of apps) visit(app, []);
  return ordered;
}

/** "<app>.<resource>". */
export function resourceAddress(app: ResolvedApp, spec: ResourceSpec): string {
  return `${app.def.id}.${spec.name}`;
}

/** Every resource of `app`, or the app itself when it has none: what a change names. */
export function wiringTargets(app: ResolvedApp): string[] {
  const resources = app.def.integration?.resources ?? [];
  return resources.length === 0
    ? [app.def.id]
    : resources.map((spec) => resourceAddress(app, spec));
}

/** Why Mediaplane can't ask `app`: its container isn't on the stack's wiring network. */
export function notOnNetwork(app: ResolvedApp): string {
  return `${app.def.name}'s container is not on the stack's wiring network, so Mediaplane can't reach it`;
}

/** The service whose container serves the app's API: Gluetun's, for qBittorrent. */
function serviceOf(app: ResolvedApp): string {
  return app.networkVia ?? app.def.id;
}

/**
 * Whether apply would leave `app`'s containers as they are, running and healthy: only
 * then is what its API says now what apply would find.
 */
export function settled(
  app: ResolvedApp,
  current: readonly ContainerState[],
  changing: ReadonlySet<string>,
): boolean {
  const services = [app.def.id, serviceOf(app)];
  return services.every((service) => {
    if (changing.has(service)) return false;
    const containers = current.filter((c) => c.service === service);
    return (
      containers.length > 0 &&
      containers.every(
        (c) => c.state === 'running' && (c.health === '' || c.health === 'healthy'),
      )
    );
  });
}

/**
 * A client for each of `apps` that has an address on the wiring network: where its
 * service's container is on it, its key from the store, and every secret to keep out
 * of messages. An app missing from the answer has no address yet.
 */
export async function reachApps(
  apps: readonly ResolvedApp[],
  options: {
    runtime: Runtime;
    current: readonly ContainerState[];
    keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
    secrets: readonly string[];
    deadlineMs: number;
    seams?: WiringSeams;
  },
): Promise<Map<string, ReachedApp>> {
  const containerOf = (app: ResolvedApp) =>
    options.current.find((c) => c.service === serviceOf(app));
  const ids = apps.flatMap((app) => {
    const container = containerOf(app);
    return container === undefined ? [] : [container.id];
  });
  const addresses = await options.runtime.wiringAddresses(ids);
  const reached = new Map<string, ReachedApp>();
  for (const app of apps) {
    const spec = app.def.api;
    const container = containerOf(app);
    const address = container === undefined ? undefined : addresses[container.id];
    if (spec === undefined || address === undefined) continue;
    const port = app.containerPorts[spec.port] ?? 0;
    const key = options.keys[app.def.id]?.[spec.key.secret];
    reached.set(app.def.id, {
      app,
      api: createAppApi({
        name: app.def.name,
        service: serviceOf(app),
        port,
        endpoint: options.seams?.endpoint?.(app, address, port) ?? {
          host: address,
          port,
        },
        ...(key === undefined ? {} : { key: { scheme: spec.key.scheme, value: key } }),
        secrets: options.secrets,
        ...(options.seams?.timeoutMs === undefined
          ? {}
          : { timeoutMs: options.seams.timeoutMs }),
        retry: { deadlineMs: options.deadlineMs, ...options.seams?.retry },
      }),
    });
  }
  return reached;
}

/**
 * Every secret an app's answer could repeat: the .env values, every key in the store, and
 * the admin password. The client replaces each with *** in what it says.
 */
export function knownSecrets(
  values: Readonly<Record<string, string>>,
  keys: Readonly<Record<string, Readonly<Record<string, string>>>>,
  admin: { password: string },
): string[] {
  return [
    ...Object.values(values),
    ...Object.values(keys).flatMap((secrets) => Object.values(secrets)),
    admin.password,
  ].filter((value) => value !== '');
}

/** The app is up, and still takes Mediaplane's key (spec §6.3, "the source"). */
export async function checkApp(reached: ReachedApp): Promise<void> {
  const spec = reached.app.def.api;
  if (spec === undefined) return;
  await reached.api.ready(spec.ready);
  await reached.api.check(spec.check);
}

/** What one resource is, against what it should be. */
export interface Examined {
  desired: DesiredResource;
  observed: ObservedResource | undefined;
  /** What the change would be; never 'after-start' or 'unknown'. */
  action: 'create' | 'update' | 'adopt' | 'unchanged';
  /** The managed fields and secrets that differ, by name. */
  changes: string[];
}

/**
 * Look at one resource: observe it, compare its managed fields, and check its secrets by
 * using them (spec §6.3). Undefined when the stack wants none. Throws AppApiError.
 */
export async function examine(
  spec: ResourceSpec,
  api: AppApi,
  ctx: WiringContext,
  known: KnownResource | undefined,
): Promise<Examined | undefined> {
  const desired = spec.desired(ctx);
  if (desired === undefined) return undefined;
  const observed = await spec.observe(api, known);
  if (observed === undefined) {
    return { desired, observed, action: 'create', changes: [] };
  }
  const changes = spec.fields.filter(
    (field) => observed.fields[field] !== desired.fields[field],
  );
  if (spec.secrets.length > 0 && spec.verify !== undefined) {
    if (!(await spec.verify(api, desired))) changes.push(...spec.secrets);
  }
  if (changes.length > 0) return { desired, observed, action: 'update', changes };
  const recorded =
    known !== undefined &&
    spec.fields.every((field) => known.fields[field] === desired.fields[field]);
  return { desired, observed, action: recorded ? 'unchanged' : 'adopt', changes };
}

/** The warning for an app Mediaplane couldn't ask, with what to do. */
export function unreachableWarning(app: ResolvedApp, cause: AppApiError): Diagnostic {
  return warning(`wire.${cause.kind}`, cause.message, {
    hint: `check it with "mediaplane status ${app.def.id}", then see ${WIRING_RUNBOOK}`,
  });
}

export interface PlanWiringOptions {
  stack: ResolvedStack;
  current: readonly ContainerState[];
  /** Services apply will create, recreate, start or remove. */
  changing: ReadonlySet<string>;
  /** Whether Mediaplane is on the wiring network, or doesn't need to be. */
  onNetwork: boolean;
  runtime: Runtime;
  keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
  admin: { username: string; password: string };
  secrets: readonly string[];
  known: KnownResources;
  seams?: WiringSeams;
}

/**
 * What apply would do to the wiring (spec §5 step 5): for each app with an API, in order,
 * whether it is up and takes Mediaplane's key, then each of its resources. An app that
 * isn't settled is checked after the start. Asks the apps; changes nothing.
 */
export async function planWiring(
  options: PlanWiringOptions,
): Promise<{ changes: WiringChange[]; diagnostics: Diagnostic[] }> {
  const order = wiringOrder(options.stack);
  const ready = options.onNetwork
    ? order.filter((app) => settled(app, options.current, options.changing))
    : [];
  const reached = await reachApps(ready, { ...options, deadlineMs: PLAN_DEADLINE_MS });
  const changes: WiringChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of order) {
    const client = reached.get(app.def.id);
    if (client === undefined && ready.includes(app)) {
      // Running, and apply leaves it as it is, but it isn't on the network.
      const reason = notOnNetwork(app);
      diagnostics.push(
        warning('wire.not-on-network', reason, {
          hint: `see ${WIRING_RUNBOOK}`,
        }),
      );
      changes.push(
        ...wiringTargets(app).map((resource) => ({
          resource,
          action: 'unknown' as const,
          reason,
        })),
      );
      continue;
    }
    if (client === undefined) {
      changes.push(
        ...wiringTargets(app).map((resource) => ({
          resource,
          action: 'after-start' as const,
        })),
      );
      continue;
    }
    const ctx: WiringContext = { stack: options.stack, app, admin: options.admin };
    const resources = app.def.integration?.resources ?? [];
    let looked = 0;
    try {
      await checkApp(client);
      if (resources.length === 0)
        changes.push({ resource: app.def.id, action: 'unchanged' });
      for (const spec of resources) {
        const address = resourceAddress(app, spec);
        const result = await examine(spec, client.api, ctx, options.known[address]);
        looked++;
        if (result === undefined) continue;
        changes.push({
          resource: address,
          action: result.action,
          ...(result.changes.length === 0 ? {} : { changes: result.changes }),
        });
      }
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw cause;
      diagnostics.push(unreachableWarning(app, cause));
      // What is left of the app could not be looked at.
      const left = wiringTargets(app).slice(resources.length === 0 ? 0 : looked);
      changes.push(
        ...left.map((resource) => ({
          resource,
          action: 'unknown' as const,
          reason: cause.message,
        })),
      );
    }
  }
  return { changes, diagnostics };
}
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index c30b614..ccdc965 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -19,4 +19,19 @@ import { composeToYaml } from '../render/yaml';
 import { resolveStack, type ResolvedStack } from '../resolver/resolve';
+import { readResources, type KnownResources } from '../integrations/resources';
+import {
+  knownSecrets,
+  planWiring,
+  WIRING_RUNBOOK,
+  wiringOrder,
+  type WiringChange,
+  type WiringSeams,
+} from '../integrations/wiring';
 import { dockerAccessWarnings } from '../runtime/docker';
-import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
+import {
+  RuntimeError,
+  type ContainerState,
+  type Runtime,
+  type WiringJoin,
+} from '../runtime/types';
+import { adminLogin } from '../secrets/admin';
 import { withGeneratedSecrets } from '../secrets/generate';
@@ -42,2 +57,4 @@ export interface PlanOptions {
   probe: HostProbe;
+  /** For tests: where the apps' APIs are reached, and how long their calls are tried. */
+  wiring?: WiringSeams;
 }
@@ -57,2 +74,4 @@ export interface PlanResult {
   unhealthy: string[];
+  /** What apply would do to each managed resource in the apps (spec §5 step 5). */
+  wiring: WiringChange[];
   diagnostics: Diagnostic[];
@@ -70,2 +89,4 @@ export interface PlanContext {
   current: ContainerState[];
+  /** state/resources.json, as plan read it. */
+  known: KnownResources;
 }
@@ -171,2 +192,57 @@ export async function planStack(
   const unhealthy = notYetHealthy(current, containers);
+
+  let wiring: WiringChange[] = [];
+  let known: KnownResources = {};
+  if (wiringOrder(stack).length > 0) {
+    try {
+      known = await readResources(home);
+    } catch (cause) {
+      return failed([
+        ...diagnostics,
+        error(
+          'resources.invalid',
+          cause instanceof Error ? cause.message : String(cause),
+          {
+            hint: `move it aside and run plan again: Mediaplane finds what it made by name, and adopts it (${WIRING_RUNBOOK})`,
+          },
+        ),
+      ]);
+    }
+    let joined: WiringJoin;
+    try {
+      joined = await options.runtime.joinWiring();
+    } catch (cause) {
+      if (!(cause instanceof RuntimeError)) throw cause;
+      return failed([
+        ...diagnostics,
+        error('wire.network', cause.message, {
+          hint: `look for a networks: entry in compose.override.yaml that changes the wiring network, take it out, and run apply; see ${WIRING_RUNBOOK}`,
+        }),
+      ]);
+    }
+    // In memory: the secrets apply would generate, so that a first plan can say what it
+    // would set. Apply sets the ones it saves.
+    const admin = await adminLogin(stack.config, home, preview, options.env);
+    try {
+      const planned = await planWiring({
+        stack,
+        current,
+        changing: new Set(
+          containers.filter((c) => c.action !== 'unchanged').map((c) => c.service),
+        ),
+        onNetwork: joined !== 'no-network',
+        runtime: options.runtime,
+        keys: preview.apps,
+        admin,
+        secrets: knownSecrets(values, preview.apps, admin),
+        known,
+        ...(options.wiring === undefined ? {} : { seams: options.wiring }),
+      });
+      wiring = planned.changes;
+      diagnostics.push(...planned.diagnostics);
+    } catch (cause) {
+      if (!(cause instanceof RuntimeError)) throw cause;
+      return failed([...diagnostics, dockerUnavailable(cause, options.env)]);
+    }
+  }
   return {
@@ -178,3 +254,4 @@ export async function planStack(
         generate.length > 0 ||
-        unhealthy.length > 0,
+        unhealthy.length > 0 ||
+        wiring.some((change) => change.action !== 'unchanged'),
       files,
@@ -183,5 +260,6 @@ export async function planStack(
       unhealthy,
+      wiring,
       diagnostics,
     },
-    context: { stack, compose, store, current },
+    context: { stack, compose, store, current, known },
   };
@@ -198,2 +276,3 @@ function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undef
       unhealthy: [],
+      wiring: [],
       diagnostics,
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 13c4978..6ed452a 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -346,2 +346,5 @@ function remaining(result: PlanResult): string {
     ...result.unhealthy,
+    ...result.wiring
+      .filter((w) => w.action !== 'unchanged')
+      .map((w) => `${w.resource} (${w.action})`),
   ].join(', ');
@@ -371,2 +374,3 @@ function emptyPlan(): PlanResult {
     unhealthy: [],
+    wiring: [],
     diagnostics: [],
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 264837a..19a5b71 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -34,2 +34,3 @@ export * from './integrations/types';
 export * from './integrations/resources';
+export * from './integrations/wiring';
 export * from './runtime/types';
```

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 84a983c..8fe46b2 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -12,2 +12,4 @@ import {
   type StepEvent,
+  type WiringAction,
+  type WiringChange,
 } from '@mediaplane/engine';
@@ -29,2 +31,17 @@ const MARKS: Record<ContainerAction, string> = {
 
+const WIRING_MARKS: Record<WiringAction, string> = {
+  create: '+',
+  update: '~',
+  adopt: '=',
+  'after-start': '>',
+  unknown: '?',
+  unchanged: ' ',
+};
+
+/** One resource's line, as plan and history show it: "  + create      sonarr.admin". */
+function wiringLine(change: WiringChange): string {
+  const what = change.changes === undefined ? '' : ` (${change.changes.join(', ')})`;
+  return `  ${WIRING_MARKS[change.action]} ${change.action.replace('-', ' ').padEnd(11)} ${change.resource}${what}`;
+}
+
 export function formatDiagnostic(diagnostic: Diagnostic): string {
@@ -97,2 +114,11 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
   if (unhealthy.length > 0) io.stdout(`Not healthy yet: ${unhealthy.join(', ')}\n`);
+  const wiring = result.wiring.filter((change) => change.action !== 'unchanged');
+  if (wiring.length > 0) {
+    io.stdout('Wiring:\n');
+    for (const change of wiring) {
+      io.stdout(`${wiringLine(change)}\n`);
+    }
+  }
+  const tally = (...actions: WiringAction[]) =>
+    wiring.filter((change) => actions.includes(change.action)).length;
   const parts = [
@@ -102,2 +128,5 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     count(unhealthy.length, 'app', 'to wait for'),
+    count(tally('create', 'update', 'adopt'), 'resource', 'to wire'),
+    count(tally('after-start'), 'wiring check', 'after the start'),
+    count(tally('unknown'), 'wiring check', 'that could not be made'),
   ].filter((part): part is string => part !== undefined);
@@ -149,3 +178,3 @@ export function printApply(
   if (options.json) {
-    const { files, containers, secrets, unhealthy } = result.plan;
+    const { files, containers, secrets, unhealthy, wiring } = result.plan;
     io.stdout(
@@ -162,2 +191,3 @@ export function printApply(
             unhealthy,
+            wiring,
           },
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index a271949..6cdb4f1 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -28,2 +28,3 @@ import {
   type Runtime,
+  type WiringSeams,
 } from '@mediaplane/engine';
@@ -69,2 +70,4 @@ export interface CliDeps {
   egress: (runtime: Runtime) => (url: string) => Promise<EgressResult>;
+  /** For tests: where plan and apply reach the apps' APIs. */
+  wiring?: WiringSeams;
   /** init's data folder: created where it can be (prepareDataFolder). */
@@ -239,2 +242,3 @@ export function createProgram(
         probe: deps.probe(runtime, home),
+        ...(deps.wiring === undefined ? {} : { wiring: deps.wiring }),
       });
@@ -273,2 +277,3 @@ export function createProgram(
         probe: deps.probe(runtime, home),
+        ...(deps.wiring === undefined ? {} : { wiring: deps.wiring }),
         confirm: async (shown) => {
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine packages/cli`

Expected: PASS.

- [ ] **Step 5: Check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src packages/cli/src
git commit -m "feat(engine): plan asks the apps, and shows the wiring" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `apply` wires the apps: the wire step

`apply` gains its wire step (spec §5 step 10, decisions 3, 12 and 13), and Sonarr,
Radarr and Prowlarr get their integration, so the shared admin login reaches them
through their API. From here, `plan` lists `sonarr.admin`, `radarr.admin` and
`prowlarr.admin`, and `apply` makes them.

Decision: the start step leaves the wiring network before `up` (decision 3); the wire
step joins it again, and fails at once if the network isn't there, since `up` has just
made it.
Decision: the wire step re-reads what it needs, rather than trusting `plan`'s answers:
apps it couldn't ask in `plan` (`after-start`) are asked now, after `ready` has waited
for each, with apply's 120 s deadline. Each resource is examined again, then created,
updated or adopted.
Decision: each resource's result is an action of its own in the change record
(`{ step: 'wire', resource: 'sonarr.admin', result: 'done', detail: 'created' }`), and
`resources.json` is written after each one, so a crash loses nothing and the next
`plan` finds the resource as it is. An `unchanged` resource is recorded, with no write.
Decision: the change record keeps `mediaplane.change/v1` (D15): `step` gains `wire`, and
actions gain an optional `resource`, the plan an optional `wiring`. A record written
before this slice still reads.
Decision: the CLI shows each resource's action ("done    wiring sonarr.admin: created")
and counts "N resource(s) wired" in `history`. A failed wire step is counted once per
resource, not once more for the step. `history <id>` prints the plan's wiring with
`wiringLine`, the same line as `plan`'s ("> after start sonarr.admin") (preflight M2).
Decision: the wire step takes an app's targets and the "not on the stack's wiring
network" message from `wiring.ts` (`wiringTargets`, `notOnNetwork`), and its tests the
shared stack and containers from `testing/wiring.ts` (preflight M1, M4).
Decision: the catalog's list of the apps with an integration becomes Sonarr, Radarr and
Prowlarr, so its per-integration checks now run for each (Task 5).
Decision: Sonarr, Radarr and Prowlarr say `login: 'shared'` now, so `credentials` lists
them with the shared login.

**Files:**
- Create: `packages/engine/src/integrations/wire.ts`,
  `packages/engine/src/integrations/wire.test.ts`
- Modify: `packages/engine/src/apply/apply.ts`, `packages/engine/src/history/records.ts`,
  `packages/cli/src/output.ts`, `catalog/sonarr/app.ts`, `catalog/radarr/app.ts`,
  `catalog/prowlarr/app.ts`
- Generated: `catalog/sonarr/README.md`, `catalog/radarr/README.md`,
  `catalog/prowlarr/README.md` (what each manages)
- Test: `packages/engine/src/apply/apply.test.ts`, `packages/engine/src/testing/wiring.ts`,
  `packages/cli/src/output.test.ts`, `packages/cli/src/run.test.ts`,
  `packages/cli/src/credentials.test.ts`, `catalog/catalog.test.ts`

**Interfaces:**
- **Consumes:** `wiringOrder`, `reachApps`, `checkApp`, `examine`, `knownSecrets`,
  `resourceAddress`, `wiringTargets`, `notOnNetwork`, `WIRING_RUNBOOK`, `WiringSeams`,
  `wiringLine`, and the shared fixture in `testing/wiring.ts` (Task 6); `writeResources` (Task 5);
  `APP_DEADLINE_MS`, `AppApiError` (Task 4); `Runtime.joinWiring`, `Runtime.leaveWiring`
  (Task 3); `adminLogin`; `servarrIntegration` through each app's `integration.ts`
  (Task 5).
- **Produces:**
  - `interface WireOptions { home; stack; store: SecretStore; values; env; runtime; known: KnownResources; now: () => Date; record: (action: ActionResult) => void; seams?: WiringSeams }`;
  - `wire(options: WireOptions): Promise<string[]>`, the changes as
    `"<resource> <what>"`; throws `WiringFailed`;
  - `class WiringFailed extends Error { diagnostics: Diagnostic[] }`;
  - `ApplyStep` gains `'wire'`; `ActionResult.resource?: string`;
    `ChangeRecord.plan.wiring?: WiringChange[]`;
  - `fakeSonarr({ key: '' })` takes any key.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index 4137ee8..560ac9f 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -172,3 +172,3 @@ export interface FakeSonarrState {
   password: string;
-  /** Its API key: anything else gets 401. */
+  /** Its API key: anything else gets 401. Empty: any key will do. */
   key: string;
@@ -190,3 +190,6 @@ export async function fakeSonarr(state: Partial<FakeSonarrState> = {}): Promise<
   const held: FakeSonarrState = { user: '', password: '', key: '', up: true, ...state };
-  const keyed = (headers: Record<string, unknown>) => headers['x-api-key'] === held.key;
+  const keyed = (headers: Record<string, unknown>) =>
+    held.key === ''
+      ? headers['x-api-key'] !== undefined
+      : headers['x-api-key'] === held.key;
   const app = await fakeHttpApp((request) => {
```

**Create** `packages/engine/src/integrations/wire.test.ts`:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ActionResult } from '../history/records';
import { RESOURCES_PATH } from '../paths';
import type { WiringJoin } from '../runtime/types';
import { fakeRuntime } from '../testing/fakes';
import { tempDir } from '../testing/temp';
import {
  FAKE_LOGIN,
  fakeSonarr,
  WIRED_CATALOG,
  WIRING_RUNNING as RUNNING,
  wiringStack as stackOf,
} from '../testing/wiring';
import { readResources, type KnownResources } from './resources';
import type { ResourceSpec } from './types';
import { wire, WiringFailed, type WireOptions } from './wire';
import type { WiringSeams } from './wiring';

const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';
const AT = new Date('2026-10-10T12:00:00.000Z');

/** A fake app's seams, and where its container is on the wiring network. */
interface Fake {
  seams: WiringSeams;
  addresses: Record<string, string>;
}

async function wireWith(
  fake: Fake,
  extra: Partial<WireOptions> & { join?: WiringJoin } = {},
) {
  const { seams, addresses } = fake;
  const home = await tempDir('mediaplane-wire-');
  const actions: ActionResult[] = [];
  const calls: string[] = [];
  const { join: joined = 'not-needed', ...rest } = extra;
  const run = wire({
    home,
    stack: stackOf(),
    store: {
      version: 1,
      apps: { sonarr: { apiKey: KEY } },
      shared: { adminPassword: PASSWORD },
    },
    values: {},
    env: {},
    runtime: fakeRuntime({ containers: RUNNING, addresses, calls, join: joined }),
    known: {},
    now: () => AT,
    record: (action) => actions.push(action),
    seams,
    ...rest,
  });
  return { run, home, actions, calls };
}

const RECORDED: KnownResources = {
  'sonarr.login': {
    id: null,
    name: 'login',
    fields: { user: 'admin' },
    secrets: ['password'],
    appliedAt: AT.toISOString(),
  },
};

describe('wire', () => {
  it('joins the network, creates what is missing, and records it at once, privately', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, home, actions, calls } = await wireWith(sonarr);
    expect(await run).toEqual(['sonarr.login created']);
    expect(sonarr.state).toMatchObject({ user: 'admin', password: PASSWORD });
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'created' },
    ]);
    expect(await readResources(home)).toEqual(RECORDED);
    expect((await stat(join(home, RESOURCES_PATH))).mode & 0o777).toBe(0o600);
    expect(calls.indexOf('join-wiring')).toBeLessThan(
      calls.findIndex((call) => call.startsWith('wiring-addresses')),
    );
  });

  it('updates what differs, saying what, and adopts what is already right', async () => {
    const wrong = await fakeSonarr({ key: KEY, user: 'someone', password: 'other' });
    const updated = await wireWith(wrong, { known: RECORDED });
    expect(await updated.run).toEqual(['sonarr.login updated user, password']);
    expect(wrong.state).toMatchObject({ user: 'admin', password: PASSWORD });

    const right = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const adopted = await wireWith(right);
    expect(await adopted.run).toEqual(['sonarr.login adopted']);
    expect(right.app.requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(await readResources(adopted.home)).toEqual(RECORDED);
  });

  it('changes nothing, and writes nothing, when all is as wanted', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const { run, home, actions } = await wireWith(sonarr, { known: RECORDED });
    expect(await run).toEqual([]);
    expect(actions).toEqual([
      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
    ]);
    await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
  });

  it("fails each resource of an app that refuses the key, with the app's message and no secret", async () => {
    const sonarr = await fakeSonarr({ key: 'f'.repeat(32) });
    const { run, home, actions } = await wireWith(sonarr);
    const failure = await run.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(WiringFailed);
    expect((failure as WiringFailed).message).toBe('the wiring failed for sonarr.login');
    expect((failure as WiringFailed).diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'wire.auth',
        hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md',
      }),
    ]);
    // The app repeated the key it refused: the redaction took it out.
    expect(actions).toEqual([
      expect.objectContaining({
        resource: 'sonarr.login',
        result: 'failed',
        error: expect.stringContaining('Unauthorized: ***') as string,
      }),
    ]);
    expect(JSON.stringify([failure, actions])).not.toContain(KEY);
    await expect(stat(join(home, RESOURCES_PATH))).rejects.toThrow();
  });

  it('skips what needs a resource that failed, and still does what does not', async () => {
    // The fake Sonarr answers 404 to the first: a refusal, which needs no retry.
    const failing: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'first',
      observe: (api) => api.get('/api/v3/missing', z.unknown()).then(() => undefined),
    };
    const needs = (name: string, requires: string[]): ResourceSpec => ({
      ...FAKE_LOGIN,
      name,
      requires,
    });
    const wired = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? {
            ...def,
            integration: {
              after: [],
              resources: [failing, needs('second', ['sonarr.first']), needs('third', [])],
            },
          }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY });
    const { run, actions } = await wireWith(sonarr, { stack: stackOf(wired) });
    await expect(run).rejects.toBeInstanceOf(WiringFailed);
    expect(
      actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
    ).toEqual([
      'sonarr.first failed ',
      'sonarr.second skipped sonarr.first failed',
      'sonarr.third done created',
    ]);
  });

  it('says so when there is no wiring network after the start', async () => {
    const sonarr = await fakeSonarr({ key: KEY });
    const { run } = await wireWith(sonarr, { join: 'no-network' });
    await expect(run).rejects.toThrow(
      'the stack has no wiring network, though apply has just started it',
    );
  });
});
```

**Change** `packages/engine/src/apply/apply.test.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 2e75828..c7b5671 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -16,2 +16,3 @@ import type { AppDefinition, Catalog } from '../catalog/types';
 import { listRecords } from '../history/records';
+import { readResources } from '../integrations/resources';
 import {
@@ -26,2 +27,3 @@ import { fakeDocker, fakeProbe } from '../testing/fakes';
 import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
+import { fakeSonarr, WIRED_CATALOG } from '../testing/wiring';
 import { apply, unhealthyServices, type ApplyOptions } from './apply';
@@ -163,2 +165,3 @@ describe('apply', () => {
       ['start', 'done'],
+      ['wire', 'done'],
       ['verify', 'done'],
@@ -280,2 +283,3 @@ describe('apply', () => {
       ['start', 'done'],
+      ['wire', 'done'],
       ['verify', 'done'],
@@ -368,2 +372,3 @@ describe('apply', () => {
       ['start', 'skipped'],
+      ['wire', 'skipped'],
       ['verify', 'skipped'],
@@ -416,2 +421,3 @@ describe('apply', () => {
       ['start', 'skipped'],
+      ['wire', 'skipped'],
       ['verify', 'skipped'],
@@ -451,2 +457,3 @@ describe('apply', () => {
       ['start', 'done'],
+      ['wire', 'done'],
       ['verify', 'done'],
@@ -477,2 +484,3 @@ describe('apply', () => {
       ['start', 'skipped'],
+      ['wire', 'skipped'],
       ['verify', 'skipped'],
@@ -583,2 +591,3 @@ describe('apply', () => {
       ['start', 'skipped'],
+      ['wire', 'skipped'],
       ['verify', 'skipped'],
@@ -607,2 +616,3 @@ describe('apply', () => {
       ['start', 'skipped'],
+      ['wire', 'skipped'],
       ['verify', 'skipped'],
@@ -976,2 +986,3 @@ describe('apply', () => {
       ['start', 'skipped'],
+      ['wire', 'skipped'],
       ['verify', 'skipped'],
@@ -1002 +1013,74 @@ describe('unhealthyServices', () => {
 });
+
+describe('apply: the wiring', () => {
+  it('steps off the wiring network for up, wires each app after it, and records it', async () => {
+    const home = await makeHome();
+    const sonarr = await fakeSonarr();
+    const docker = fakeDocker(home, { addresses: sonarr.addresses });
+    const wired = { catalog: WIRED_CATALOG, wiring: sonarr.seams };
+    const first = await apply(options(home, docker, wired));
+    expect(first.outcome).toBe('success');
+    expect(first.plan.wiring).toEqual([
+      { resource: 'sonarr.login', action: 'after-start' },
+    ]);
+    expect(first.actions.map((a) => [a.step, a.resource ?? '', a.result])).toEqual([
+      ['keys', '', 'done'],
+      ['files', '', 'done'],
+      ['pull', '', 'done'],
+      ['ownership', '', 'done'],
+      ['start', '', 'done'],
+      ['wire', 'sonarr.login', 'done'],
+      ['wire', '', 'done'],
+      ['verify', '', 'done'],
+    ]);
+    expect(
+      first.actions.find((a) => a.step === 'wire' && a.resource === undefined)?.detail,
+    ).toBe('sonarr.login created');
+    const leave = docker.calls.indexOf('leave-wiring');
+    expect(leave).toBeGreaterThan(-1);
+    expect(leave).toBeLessThan(docker.calls.indexOf('up'));
+    expect(docker.calls.lastIndexOf('join-wiring')).toBeGreaterThan(
+      docker.calls.indexOf('up'),
+    );
+    expect(sonarr.state.user).toBe('admin');
+    expect(Object.keys(await readResources(home))).toEqual(['sonarr.login']);
+    const [record] = (await listRecords(home)).records;
+    expect(record?.plan.wiring).toEqual([
+      { resource: 'sonarr.login', action: 'after-start' },
+    ]);
+
+    const second = await apply(options(home, docker, wired));
+    expect(second.outcome).toBe('no-changes');
+    expect(second.plan.wiring).toEqual([
+      { resource: 'sonarr.login', action: 'unchanged' },
+    ]);
+  });
+
+  it("fails the wire step with the app's own message, and skips verify", async () => {
+    const home = await makeHome();
+    const sonarr = await fakeSonarr({ key: 'f'.repeat(32) });
+    const docker = fakeDocker(home, { addresses: sonarr.addresses });
+    const result = await apply(
+      options(home, docker, { catalog: WIRED_CATALOG, wiring: sonarr.seams }),
+    );
+    expect(result.outcome).toBe('failed');
+    expect(
+      result.actions.slice(-3).map((a) => [a.step, a.resource ?? '', a.result]),
+    ).toEqual([
+      ['wire', 'sonarr.login', 'failed'],
+      ['wire', '', 'failed'],
+      ['verify', '', 'skipped'],
+    ]);
+    expect(result.diagnostics.map((d) => d.code)).toEqual([
+      'wire.auth',
+      'apply.wire-failed',
+    ]);
+    expect(result.diagnostics[0]?.message).toContain(
+      "refused Mediaplane's API key (HTTP 401)",
+    );
+    expect(result.diagnostics[1]).toMatchObject({
+      message: 'the wiring failed for sonarr.login',
+      hint: "the apps' own messages are above; fix what they say, then run apply again. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md",
+    });
+  });
+});
```

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index a66020e..c44a1a2 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -1,4 +1,9 @@
-import type { PlanResult } from '@mediaplane/engine';
+import type {
+  ActionResult,
+  ApplyResult,
+  ChangeRecord,
+  PlanResult,
+} from '@mediaplane/engine';
 import { describe, expect, it } from 'vitest';
-import { printPlan } from './output';
+import { printApply, printHistory, printPlan, printRecord, printStep } from './output';
 import type { Io } from './run';
@@ -100 +105,82 @@ describe('printPlan', () => {
 });
+
+describe('the wire step, as apply shows it', () => {
+  const ACTIONS: ActionResult[] = [
+    { step: 'start', result: 'done', detail: 'every app is running and healthy' },
+    { step: 'wire', resource: 'sonarr.admin', result: 'done', detail: 'created' },
+    {
+      step: 'wire',
+      resource: 'radarr.admin',
+      result: 'failed',
+      error: 'Radarr at … refused',
+    },
+    { step: 'wire', result: 'failed', error: 'the wiring failed for radarr.admin' },
+    { step: 'verify', result: 'skipped' },
+  ];
+
+  it('shows each resource as it is wired', () => {
+    const term = capture();
+    printStep({ step: 'wire', phase: 'start' }, term.io);
+    for (const action of ACTIONS.slice(1, 3)) {
+      printStep({ step: 'wire', phase: 'end', action }, term.io);
+    }
+    expect(term.stdout()).toBe(
+      'Wiring the apps…\n  done    wiring sonarr.admin: created\n  failed  wiring radarr.admin: Radarr at … refused\n',
+    );
+  });
+
+  it('counts a failed resource once, not again for its step', () => {
+    const out: string[] = [];
+    const io: Io = {
+      stdout: () => undefined,
+      stderr: (text) => {
+        out.push(text);
+      },
+      env: {},
+    };
+    const result: ApplyResult = {
+      outcome: 'failed',
+      plan: { ...PLAN, files: [] },
+      actions: ACTIONS,
+      recordId: 'fake-record',
+      diagnostics: [],
+    };
+    printApply(result, { json: false }, io);
+    expect(out.join('')).toContain(
+      'Apply failed: 2 done, 1 failed, 1 skipped. Run apply again to retry.',
+    );
+  });
+
+  it("shows a record's wiring and its resources' results", () => {
+    const term = capture();
+    const record: ChangeRecord = {
+      schema: 'mediaplane.change/v1',
+      id: '20261010T120000Z-0a1b2c3d',
+      trigger: 'cli',
+      startedAt: '2026-10-10T12:00:00.000Z',
+      finishedAt: '2026-10-10T12:01:00.000Z',
+      durationMs: 60_000,
+      outcome: 'failed',
+      stackSha256: '0'.repeat(64),
+      plan: {
+        files: [],
+        containers: [],
+        secrets: { generate: [] },
+        wiring: [
+          { resource: 'sonarr.admin', action: 'after-start' },
+          { resource: 'radarr.admin', action: 'unchanged' },
+        ],
+      },
+      actions: ACTIONS,
+    };
+    printRecord(record, { json: false }, term.io);
+    // The same line as plan's.
+    expect(term.stdout()).toContain('  > after start sonarr.admin\nSteps:\n');
+    expect(term.stdout()).toContain('  done    wiring sonarr.admin: created\n');
+    expect(term.stdout()).not.toContain('radarr.admin\nSteps');
+    printHistory({ records: [record], unreadable: [] }, { json: false }, term.io);
+    expect(term.stdout()).toContain(
+      '20261010T120000Z-0a1b2c3d  failed   1 resource wired\n',
+    );
+  });
+});
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 5e7ebef..d329d06 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -17,2 +17,3 @@ import {
   writePrestartFiles,
+  writeResources,
   writeSecretStore,
@@ -88,2 +89,14 @@ async function currentHome(
   }
+  // Sonarr holds the shared login, as resources.json records.
+  const password = store.shared?.adminPassword ?? '';
+  apis.apps.set('sonarr', { user: 'admin', password, up: true });
+  await writeResources(home, {
+    'sonarr.admin': {
+      id: null,
+      name: 'admin',
+      fields: { username: 'admin' },
+      secrets: ['password'],
+      appliedAt: '2026-10-10T12:00:00.000Z',
+    },
+  });
   return home;
@@ -268,3 +281,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toBe(
-      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr\nPlan: 1 app to wait for, 1 wiring check after the start.\n',
+      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr.admin\nPlan: 1 app to wait for, 1 wiring check after the start.\n',
     );
@@ -525,3 +538,3 @@ describe('mediaplane apply', () => {
       plan: { files: Record<string, unknown>[] };
-      actions: { step: string; result: string }[];
+      actions: { step: string; resource?: string; result: string }[];
     };
@@ -540,9 +553,11 @@ describe('mediaplane apply', () => {
     });
-    expect(json.actions.map((a) => a.result)).toEqual([
-      'done',
-      'done',
-      'done',
-      'done',
-      'done',
-      'done',
+    expect(json.actions.map((a) => [a.step, a.resource ?? '', a.result])).toEqual([
+      ['keys', '', 'done'],
+      ['files', '', 'done'],
+      ['pull', '', 'done'],
+      ['ownership', '', 'done'],
+      ['start', '', 'done'],
+      ['wire', 'sonarr.admin', 'done'],
+      ['wire', '', 'done'],
+      ['verify', '', 'done'],
     ]);
@@ -597,3 +612,3 @@ describe('mediaplane apply', () => {
     expect(term.stderr()).toContain(
-      'Apply failed: 2 done, 1 failed, 3 skipped. Run apply again to retry.',
+      'Apply failed: 2 done, 1 failed, 4 skipped. Run apply again to retry.',
     );
@@ -643,3 +658,3 @@ describe('mediaplane apply', () => {
     expect(term.stderr()).toMatch(
-      /\nApply failed: 2 done, 1 failed, 3 skipped\. Run apply again to retry\.\n$/,
+      /\nApply failed: 2 done, 1 failed, 4 skipped\. Run apply again to retry\.\n$/,
     );
@@ -807,3 +822,3 @@ describe('mediaplane history', () => {
     expect(list.stdout()).toBe(
-      `${id}  success  5 files written, 4 containers changed, 4 secrets generated\n`,
+      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 1 resource wired\n`,
     );
@@ -815,2 +830,3 @@ describe('mediaplane history', () => {
     );
+    expect(one.stdout()).toContain('  done    wiring sonarr.admin: created\n');
   });
```

**Change** `packages/cli/src/credentials.test.ts`:

```diff
diff --git a/packages/cli/src/credentials.test.ts b/packages/cli/src/credentials.test.ts
index 7410011..08c04d9 100644
--- a/packages/cli/src/credentials.test.ts
+++ b/packages/cli/src/credentials.test.ts
@@ -85,3 +85,3 @@ describe('mediaplane credentials', () => {
         'qBittorrent  http://127.0.0.1:8080',
-        'Sonarr       http://127.0.0.1:8989  (its login arrives in Slice 3b)',
+        'Sonarr       http://127.0.0.1:8989',
         '',
@@ -119,4 +119,3 @@ describe('mediaplane credentials', () => {
           urls: ['http://127.0.0.1:8989'],
-          login: 'not-yet',
-          comingIn: 'Slice 3b',
+          login: 'shared',
         },
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 07f6dbc..f128dfc 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -57,3 +57,3 @@ describe('catalog', () => {
       catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
-    ).toEqual([]);
+    ).toEqual(['prowlarr', 'radarr', 'sonarr']);
   });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/integrations packages/engine/src/apply packages/cli/src catalog/catalog.test.ts`

Expected: FAIL: `wire.test.ts` can't load `./wire`; `apply.test.ts`'s step lists have no
`wire` step (`expected [ [ 'keys', 'done' ], …(5) ] to deeply equal [ [ 'keys', 'done' ],
…(6) ]`), and its two "apply: the wiring" tests fail; the output tests of the wire step;
`credentials.test.ts`, which expects Sonarr, Radarr and Prowlarr with the shared login;
`run.test.ts`'s apply and history tests, which count the wire step; and
`catalog.test.ts`'s list of the apps with an integration. 6 files, 22 tests failed, 410
passed.

- [ ] **Step 3: The wire step, and the apps' integrations**

**Create** `packages/engine/src/integrations/wire.ts`:

```ts
import { error, type Diagnostic } from '../diagnostics';
import { AppApiError, APP_DEADLINE_MS } from '../http/client';
import type { ActionResult } from '../history/records';
import type { ResolvedStack } from '../resolver/resolve';
import type { Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import type { SecretStore } from '../secrets/store';
import { writeResources, type KnownResources } from './resources';
import type { WiringContext } from './types';
import {
  checkApp,
  examine,
  knownSecrets,
  notOnNetwork,
  reachApps,
  resourceAddress,
  WIRING_RUNBOOK,
  wiringOrder,
  wiringTargets,
  type WiringSeams,
} from './wiring';

export interface WireOptions {
  home: string;
  stack: ResolvedStack;
  store: SecretStore;
  /** The secret values of .env: kept out of every message. */
  values: Readonly<Record<string, string>>;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  /** state/resources.json as plan read it; kept up to date as resources are wired. */
  known: KnownResources;
  now: () => Date;
  /** Each resource's result, as it comes. */
  record: (action: ActionResult) => void;
  seams?: WiringSeams;
}

/** What one wired resource came to, for the step's own detail. */
const DONE = { create: 'created', update: 'updated', adopt: 'adopted' } as const;

/**
 * Apply's wire step (spec §5 step 10): for each app with an API, in order, wait until it
 * is ready and check its key, then make each of its resources what the stack wants, and
 * record it in resources.json at once. A resource that fails doesn't stop the others; one
 * that `requires` it is skipped (spec §5.1). Each result goes to `record`. Returns what it
 * changed, as "<resource> <what>"; throws WiringFailed when anything failed.
 */
export async function wire(options: WireOptions): Promise<string[]> {
  const { stack, runtime } = options;
  const order = wiringOrder(stack);
  if (order.length === 0) return [];
  if ((await runtime.joinWiring()) === 'no-network') {
    throw new Error('the stack has no wiring network, though apply has just started it');
  }
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const keys = options.store.apps;
  const reached = await reachApps(order, {
    runtime,
    current: await runtime.containers(),
    keys,
    secrets: knownSecrets(options.values, keys, admin),
    deadlineMs: APP_DEADLINE_MS,
    ...(options.seams === undefined ? {} : { seams: options.seams }),
  });
  const known: KnownResources = { ...options.known };
  const diagnostics: Diagnostic[] = [];
  const failed = new Set<string>();
  const done: string[] = [];
  const fail = (resource: string, message: string, code: string) => {
    failed.add(resource);
    diagnostics.push(error(code, message, { hint: `see ${WIRING_RUNBOOK}` }));
    options.record({ step: 'wire', resource, result: 'failed', error: message });
  };
  for (const app of order) {
    const resources = app.def.integration?.resources ?? [];
    const targets = wiringTargets(app);
    const client = reached.get(app.def.id);
    if (client === undefined) {
      for (const target of targets)
        fail(target, notOnNetwork(app), 'wire.not-on-network');
      continue;
    }
    try {
      await checkApp(client);
    } catch (cause) {
      if (!(cause instanceof AppApiError)) throw cause;
      for (const target of targets) fail(target, cause.message, `wire.${cause.kind}`);
      continue;
    }
    const ctx: WiringContext = { stack, app, admin };
    for (const spec of resources) {
      const address = resourceAddress(app, spec);
      const blocker = (spec.requires ?? []).find((needed) => failed.has(needed));
      if (blocker !== undefined) {
        failed.add(address);
        options.record({
          step: 'wire',
          resource: address,
          result: 'skipped',
          detail: `${blocker} failed`,
        });
        continue;
      }
      try {
        const result = await examine(spec, client.api, ctx, known[address]);
        if (result === undefined) continue;
        let id = result.observed?.id ?? null;
        if (result.action === 'create') {
          ({ id } = await spec.create(client.api, result.desired));
        } else if (result.action === 'update' && result.observed !== undefined) {
          await spec.update(client.api, result.desired, result.observed);
        }
        if (result.action === 'unchanged') {
          options.record({
            step: 'wire',
            resource: address,
            result: 'done',
            detail: 'unchanged',
          });
          continue;
        }
        // At once: a crash later loses no id, and the next plan finds it as it is.
        known[address] = {
          id,
          name: result.desired.name,
          fields: { ...result.desired.fields },
          secrets: [...spec.secrets],
          appliedAt: options.now().toISOString(),
        };
        await writeResources(options.home, known);
        const what =
          result.action === 'update'
            ? `${DONE.update} ${result.changes.join(', ')}`
            : DONE[result.action];
        done.push(`${address} ${what}`);
        options.record({ step: 'wire', resource: address, result: 'done', detail: what });
      } catch (cause) {
        if (!(cause instanceof AppApiError)) throw cause;
        fail(address, cause.message, `wire.${cause.kind}`);
      }
    }
  }
  if (failed.size > 0) {
    const names = [...failed].join(', ');
    throw new WiringFailed(`the wiring failed for ${names}`, diagnostics);
  }
  return done;
}

/** Some of the wiring failed: each failure's diagnostic, from the app's own message. */
export class WiringFailed extends Error {
  override readonly name = 'WiringFailed';
  readonly diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[]) {
    super(message);
    this.diagnostics = diagnostics;
  }
}
```

**Change** `packages/engine/src/history/records.ts`:

```diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index 1b9a3e6..5154047 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -16,3 +16,5 @@ const RECORD_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
 const actionSchema = z.strictObject({
-  step: z.enum(['keys', 'files', 'pull', 'ownership', 'start', 'verify']),
+  step: z.enum(['keys', 'files', 'pull', 'ownership', 'start', 'wire', 'verify']),
+  /** The wire step's actions name the resource ("sonarr.admin"). Added in Slice 3b. */
+  resource: z.string().optional(),
   result: z.enum(['done', 'failed', 'skipped']),
@@ -46,2 +48,20 @@ export const changeRecordSchema = z.strictObject({
     secrets: z.strictObject({ generate: z.array(z.string()) }),
+    /** What the plan said of each managed resource. Added in Slice 3b. */
+    wiring: z
+      .array(
+        z.strictObject({
+          resource: z.string(),
+          action: z.enum([
+            'create',
+            'update',
+            'adopt',
+            'unchanged',
+            'after-start',
+            'unknown',
+          ]),
+          changes: z.array(z.string()).optional(),
+          reason: z.string().optional(),
+        }),
+      )
+      .optional(),
   }),
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 6ed452a..91fb9f1 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -35,2 +35,3 @@ import { writePrestartFiles } from './prestart';
 import { pullImages } from './pull';
+import { wire, WiringFailed } from '../integrations/wire';
 
@@ -77,2 +78,3 @@ const STEP_HINTS: Record<ApplyStep, string> = {
   start: `run "mediaplane status" to see each app, fix the cause, then run apply again; see ${runbookUrl('app-wont-start')}`,
+  wire: `the apps' own messages are above; fix what they say, then run apply again. See ${runbookUrl('wiring-failed')}`,
   verify: 'run "mediaplane plan" to see what is still different',
@@ -172,2 +174,5 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   await steps.run('start', async () => {
+    // Compose can't recreate the wiring network while another project's container is on
+    // it, so Mediaplane steps off before up, and back on in the wire step (ADR 0011).
+    await runtime.leaveWiring();
     const result = await runtime.up(options.waitSeconds ?? DEFAULT_WAIT_SECONDS, values);
@@ -176,2 +181,25 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   });
+  await steps.run('wire', async () => {
+    try {
+      const done = await wire({
+        home,
+        stack,
+        store,
+        values,
+        env: options.env,
+        runtime,
+        known: context.known,
+        now,
+        record: (action) => {
+          steps.record(action);
+        },
+        ...(options.wiring === undefined ? {} : { seams: options.wiring }),
+      });
+      return done.length === 0 ? NONE_NEEDED : done.join('; ');
+    } catch (cause) {
+      // Each failure's own message, as well as the step's.
+      if (cause instanceof WiringFailed) steps.diagnostics.push(...cause.diagnostics);
+      throw cause;
+    }
+  });
   await steps.run('verify', async () => {
@@ -200,2 +228,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
       secrets: shown.secrets,
+      wiring: shown.wiring,
     },
@@ -264,2 +293,7 @@ class Steps {
 
+  /** One result inside the step that runs: the wire step's, for each resource. */
+  record(action: ActionResult): void {
+    this.#finish(action);
+  }
+
   #finish(action: ActionResult): void {
```

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 8fe46b2..f4edfd5 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -145,2 +145,3 @@ const STEP_LABELS: Record<ApplyStep, string> = {
   start: 'containers',
+  wire: 'wiring',
   verify: 'verify',
@@ -151,2 +152,3 @@ const SLOW_STEPS: Partial<Record<ApplyStep, string>> = {
   start: 'Starting containers and waiting until every app is healthy…',
+  wire: 'Wiring the apps…',
 };
@@ -161,4 +163,24 @@ export function printStep(event: StepEvent, io: Io): void {
   const { action } = event;
-  const detail = action.detail === undefined ? '' : `: ${action.detail}`;
-  io.stdout(`  ${action.result.padEnd(7)} ${STEP_LABELS[action.step]}${detail}\n`);
+  io.stdout(`  ${action.result.padEnd(7)} ${describeAction(action)}\n`);
+}
+
+/** "wiring sonarr.admin: created", or "files: wrote generated/.env". */
+function describeAction(action: ActionResult): string {
+  const said = action.detail ?? action.error;
+  const what =
+    action.resource === undefined
+      ? STEP_LABELS[action.step]
+      : `${STEP_LABELS[action.step]} ${action.resource}`;
+  return said === undefined ? what : `${what}: ${said}`;
+}
+
+/**
+ * The actions to count in a summary: every step's, except a wire step whose resources
+ * were counted one by one, which would count each failure twice.
+ */
+function tallied(actions: readonly ActionResult[]): ActionResult[] {
+  const byResource = actions.some((a) => a.resource !== undefined);
+  return actions.filter(
+    (a) => !(byResource && a.step === 'wire' && a.resource === undefined),
+  );
 }
@@ -234,3 +256,3 @@ export function printApply(
       const tally = (outcome: ActionResult['result']) =>
-        result.actions.filter((a) => a.result === outcome).length;
+        tallied(result.actions).filter((a) => a.result === outcome).length;
       if (result.recordId === undefined && tally('failed') === 0) {
@@ -258,2 +280,10 @@ function summary(record: ChangeRecord) {
       secrets: record.plan.secrets.generate.length,
+      // What the wire step changed in the apps; the plan only knew it after the start.
+      wiring: record.actions.filter(
+        (a) =>
+          a.step === 'wire' &&
+          a.resource !== undefined &&
+          a.result === 'done' &&
+          a.detail !== 'unchanged',
+      ).length,
     },
@@ -350,2 +380,3 @@ export function printHistory(
       count(changes.secrets, 'secret', 'generated'),
+      count(changes.wiring, 'resource', 'wired'),
     ].filter((part): part is string => part !== undefined);
@@ -378,8 +409,10 @@ export function printRecord(
   }
+  for (const change of (record.plan.wiring ?? []).filter(
+    (w) => w.action !== 'unchanged',
+  )) {
+    io.stdout(`${wiringLine(change)}\n`);
+  }
   io.stdout('Steps:\n');
   for (const action of record.actions) {
-    const detail = action.detail ?? action.error;
-    io.stdout(
-      `  ${action.result.padEnd(7)} ${STEP_LABELS[action.step]}${detail === undefined ? '' : `: ${detail}`}\n`,
-    );
+    io.stdout(`  ${action.result.padEnd(7)} ${describeAction(action)}\n`);
   }
```

**Change** `catalog/sonarr/app.ts`:

```diff
diff --git a/catalog/sonarr/app.ts b/catalog/sonarr/app.ts
index 2c3e051..532d4f8 100644
--- a/catalog/sonarr/app.ts
+++ b/catalog/sonarr/app.ts
@@ -2,2 +2,3 @@ import { defineApp } from '@mediaplane/engine';
 import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import integration from './integration';
 
@@ -22,5 +23,6 @@ export default defineApp({
   api: servarrApi('v3'),
+  integration,
   env: (ctx) => servarrEnv('SONARR', ctx),
   configFiles: servarrConfigFiles,
-  login: { comingIn: 'Slice 3b' },
+  login: 'shared',
   experimental: false,
```

**Change** `catalog/radarr/app.ts`:

```diff
diff --git a/catalog/radarr/app.ts b/catalog/radarr/app.ts
index 535e554..173c12a 100644
--- a/catalog/radarr/app.ts
+++ b/catalog/radarr/app.ts
@@ -2,2 +2,3 @@ import { defineApp } from '@mediaplane/engine';
 import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import integration from './integration';
 
@@ -22,5 +23,6 @@ export default defineApp({
   api: servarrApi('v3'),
+  integration,
   env: (ctx) => servarrEnv('RADARR', ctx),
   configFiles: servarrConfigFiles,
-  login: { comingIn: 'Slice 3b' },
+  login: 'shared',
   experimental: false,
```

**Change** `catalog/prowlarr/app.ts`:

```diff
diff --git a/catalog/prowlarr/app.ts b/catalog/prowlarr/app.ts
index 6b0e35f..901fbd0 100644
--- a/catalog/prowlarr/app.ts
+++ b/catalog/prowlarr/app.ts
@@ -2,2 +2,3 @@ import { defineApp } from '@mediaplane/engine';
 import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import integration from './integration';
 
@@ -22,2 +23,3 @@ export default defineApp({
   api: servarrApi('v1'),
+  integration,
   implies: () => ['byparr'],
@@ -25,3 +27,3 @@ export default defineApp({
   configFiles: servarrConfigFiles,
-  login: { comingIn: 'Slice 3b' },
+  login: 'shared',
   experimental: false,
```

Regenerate the three READMEs' facts (`catalog/sonarr/README.md`,
`catalog/radarr/README.md`, `catalog/prowlarr/README.md`):

```bash
pnpm docs:generate
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine packages/cli catalog`

Expected: PASS.

- [ ] **Step 5: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src packages/cli/src catalog
git commit -m "feat(engine): apply wires the apps, and sets the shared admin in Sonarr, Radarr and Prowlarr" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A stranded qBittorrent: `restart`, and verify's VPN check

The roadmap's S3b item from S3d, as the owner's trial found it: after `docker stop`
Gluetun, `apply` starts Gluetun again but leaves qBittorrent in Gluetun's old, empty
network namespace, and its health check still passes on the loopback (decision 14).

Decision: `plan` finds a stranded guest itself (`strandedGuests`): an app running in
another app's namespace, otherwise unchanged, whose host `apply` will `start`, or which
started before its host's current run. It is planned as `restart`, a container action of
`plan`'s own: Compose never says "restart". Compose restarts a guest when it recreates
its host, so a `recreate` of Gluetun is left to Compose.
Decision: `apply`'s start step stops the `restart` services (`compose stop`) before `up`,
which starts them, after Gluetun, in its new namespace. Nothing is removed or recreated.
Decision: verify runs vpn-check's own checks (`vpnCheck`) without the egress check,
whenever qBittorrent runs behind Gluetun: no request leaves for the outside service,
and the topology (qBittorrent in Gluetun's namespace, the route into the tunnel, the
control server's status, the start times) is checked as spec §6.4 asks. A `leak` or
`down` fails verify with the failing check's own message and hint.
Decision: `vpnCheck` and `strandedGuests` share `startedBefore`, so the two always agree.
Decision: vpn-check's hint for a stranded qBittorrent puts the plain first step first,
as the runbook and the READMEs do: `run "mediaplane apply", which restarts it (or
"docker restart <container>")` (preflight M20, decision 16). The kill-switch e2e test
checks that hint too, so its expectation changes here; Task 9 runs it.
Decision: the trial's test stops Gluetun with Task 1's `stoppedUntilUp` (preflight M4).
Decision: the fixture Gluetun gets its `controlApiKey` secret, as the real one has since
S3a, so verify's check can run against the fakes, whose `run` now answers a healthy
probe (`HEALTHY_PROBE`) and whose `inspect` reports a guest in its host's network.

**Files:**
- Create: `packages/engine/src/plan/stranded.ts`, `packages/engine/src/plan/stranded.test.ts`
- Modify: `packages/engine/src/plan/containers.ts`, `packages/engine/src/plan/plan.ts`,
  `packages/engine/src/apply/apply.ts`, `packages/engine/src/history/records.ts`,
  `packages/engine/src/vpn/check.ts`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`
- Test: `packages/engine/src/testing/fixtures.ts`, `packages/engine/src/testing/fakes.ts`,
  `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/apply/apply.test.ts`,
  `packages/engine/src/secrets/values.test.ts`, `packages/engine/src/vpn/check.test.ts`,
  `packages/cli/src/output.test.ts`, `packages/cli/src/vpn-check.test.ts`,
  `test/e2e/vpn.e2e.test.ts` (the hint's expectation only)

**Interfaces:**
- **Consumes:** `Runtime.inspect`, `ContainerDetails` (S3d); `Runtime.stop` (Task 3);
  `vpnCheck`, `VPN_RUNBOOK`; `PROJECT_NAME`; `probeOutput`, `ProbeAnswers` in the fakes;
  `stoppedUntilUp` in `apply.test.ts` (Task 1).
- **Produces:**
  - `startedBefore(guest: ContainerDetails | undefined, host: ContainerDetails | undefined): boolean | undefined`;
  - `strandedGuests(stack, current, changes: readonly ContainerChange[], runtime): Promise<string[]>`;
  - `ContainerAction` gains `'restart'` (and the change record's enum with it);
  - `ApplyOptions.project?: string` (default `PROJECT_NAME`), for verify's check;
  - `HEALTHY_PROBE: ProbeAnswers` from `@mediaplane/engine/testing`.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/plan/stranded.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import type { ContainerState } from '../runtime/types';
import { fakeContainer, fakeRuntime } from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import type { ContainerAction, ContainerChange } from './containers';
import { startedBefore, strandedGuests } from './stranded';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`;

function stack(): ResolvedStack {
  const result = resolveStack(fixtureConfig(STACK), fixtureCatalog, FIXTURE_HOST, '/opt');
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const GLUETUN = fakeContainer('gluetun', 'id-gluetun');
const QBITTORRENT = fakeContainer('qbittorrent', 'id-qbittorrent');
const changes = (gluetun: ContainerAction, qbittorrent: ContainerAction = 'unchanged') =>
  [
    { service: 'gluetun', action: gluetun },
    { service: 'jellyfin', action: 'unchanged' },
    { service: 'qbittorrent', action: qbittorrent },
  ] satisfies ContainerChange[];
const EARLY = '2026-10-10T10:00:00Z';
const LATE = '2026-10-10T11:00:00Z';

function runtimeWith(
  started: { qbittorrent: string; gluetun: string },
  calls: string[] = [],
) {
  return fakeRuntime({
    calls,
    details: {
      'id-qbittorrent': { startedAt: started.qbittorrent },
      'id-gluetun': { startedAt: started.gluetun },
    },
  });
}

describe('startedBefore', () => {
  it('compares the two start times, and knows nothing of one it cannot read', () => {
    const at = (startedAt: string) => ({ id: 'x', networkMode: 'bridge', startedAt });
    expect(startedBefore(at(EARLY), at(LATE))).toBe(true);
    expect(startedBefore(at(LATE), at(EARLY))).toBe(false);
    expect(startedBefore(at(EARLY), at(EARLY))).toBe(false);
    expect(startedBefore(at('0001-01-01T00:00:00Z'), at('not a time'))).toBeUndefined();
    expect(startedBefore(undefined, at(EARLY))).toBeUndefined();
  });
});

describe('strandedGuests', () => {
  const current: ContainerState[] = [GLUETUN, QBITTORRENT];

  it('restarts a running guest whose stopped host apply starts again', async () => {
    const stopped = [{ ...GLUETUN, state: 'exited' }, QBITTORRENT];
    const calls: string[] = [];
    const runtime = runtimeWith({ qbittorrent: LATE, gluetun: EARLY }, calls);
    expect(await strandedGuests(stack(), stopped, changes('start'), runtime)).toEqual([
      'qbittorrent',
    ]);
    // Nothing to compare: its host's next start is the one that matters.
    expect(calls.filter((call) => call.startsWith('inspect'))).toEqual([]);
  });

  it('restarts a guest that started before its host last did', async () => {
    const runtime = runtimeWith({ qbittorrent: EARLY, gluetun: LATE });
    expect(await strandedGuests(stack(), current, changes('unchanged'), runtime)).toEqual(
      ['qbittorrent'],
    );
  });

  it('leaves a guest that started after its host, or that apply changes anyway', async () => {
    const after = runtimeWith({ qbittorrent: LATE, gluetun: EARLY });
    expect(await strandedGuests(stack(), current, changes('unchanged'), after)).toEqual(
      [],
    );
    const before = runtimeWith({ qbittorrent: EARLY, gluetun: LATE });
    // A recreated host recreates its guest too (its hash changes), and Compose restarts
    // a guest whose host it recreates; a guest that up starts or recreates joins anew.
    for (const [gluetun, qbittorrent] of [
      ['recreate', 'recreate'],
      ['unchanged', 'start'],
      ['start', 'recreate'],
    ] as const) {
      expect(
        await strandedGuests(stack(), current, changes(gluetun, qbittorrent), before),
      ).toEqual([]);
    }
  });

  it('leaves a guest that is not running', async () => {
    const runtime = runtimeWith({ qbittorrent: EARLY, gluetun: LATE });
    const exited = [GLUETUN, { ...QBITTORRENT, state: 'exited' }];
    expect(await strandedGuests(stack(), exited, changes('start'), runtime)).toEqual([]);
  });
});
```

**Change** `packages/engine/src/testing/fixtures.ts`:

```diff
diff --git a/packages/engine/src/testing/fixtures.ts b/packages/engine/src/testing/fixtures.ts
index ed37fd3..833bde1 100644
--- a/packages/engine/src/testing/fixtures.ts
+++ b/packages/engine/src/testing/fixtures.ts
@@ -76,3 +76,6 @@ export const fixtureCatalog: Catalog = [
     health: 'image',
-    secrets: { wireguardKey: { userProvided: 'vpn.private_key' } },
+    secrets: {
+      controlApiKey: { generate: 'hex32' },
+      wireguardKey: { userProvided: 'vpn.private_key' },
+    },
     credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
```

**Change** `packages/engine/src/testing/fakes.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.ts b/packages/engine/src/testing/fakes.ts
index f191668..edc4600 100644
--- a/packages/engine/src/testing/fakes.ts
+++ b/packages/engine/src/testing/fakes.ts
@@ -219,3 +219,4 @@ export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
  * compose.yaml and .env. Like Compose, it hashes a guest (`network_mode: service:<host>`)
- * as `container:<host's id>`.
+ * as `container:<host's id>`, and inspect says it is in its host's network. A vpn-check
+ * probe in qBittorrent's network finds a healthy tunnel, unless `run` says otherwise.
  */
@@ -226,4 +227,13 @@ export function fakeDocker(
   const calls: string[] = [];
-  const base = fakeRuntime({ ...options, calls });
+  const base = fakeRuntime({
+    run: (service, command) =>
+      service === 'qbittorrent' && command.entrypoint === 'sh'
+        ? { code: 0, stdout: probeOutput(HEALTHY_PROBE), stderr: '' }
+        : { code: 0, stdout: '', stderr: '' },
+    ...options,
+    calls,
+  });
   let containers = options.containers ?? [];
+  /** Guest container ID → its host's, from the compose.yaml up started. */
+  const hosts = new Map<string, string>();
   return {
@@ -235,2 +245,10 @@ export function fakeDocker(
     },
+    inspect: async (ids) =>
+      (await base.inspect(ids)).map((details) => {
+        const host = hosts.get(details.id);
+        return host === undefined ||
+          options.details?.[details.id]?.networkMode !== undefined
+          ? details
+          : { ...details, networkMode: `container:${host}` };
+      }),
     up: async (waitSeconds, values) => {
@@ -247,2 +265,8 @@ export function fakeDocker(
       }
+      hosts.clear();
+      for (const [service, config] of Object.entries(compose.services)) {
+        const mode = config.network_mode;
+        if (typeof mode === 'string')
+          hosts.set(`fake-${service}`, mode.slice('container:'.length));
+      }
       const env = parseEnvFile(await readFile(join(home, ENV_PATH), 'utf8'));
@@ -296,2 +320,13 @@ export type ProbeAnswers = Partial<Record<ProbeCheck, readonly [number, string]>
 
+/**
+ * A probe of a healthy tunnel, without the egress check: the route goes into tun0, and
+ * Gluetun's control server says the VPN runs, with Mediaplane's key only.
+ */
+export const HEALTHY_PROBE: ProbeAnswers = {
+  route: [0, '1.1.1.1 dev tun0  src 10.66.0.2 '],
+  anonymous: [0, '401'],
+  status: [0, '{"status":"running"}\n200'],
+  publicip: [0, '{"public_ip":""}\n200'],
+};
+
 /** What the probe script prints for `answers`, after a line of Compose's own. */
```

**Change** `packages/engine/src/plan/plan.test.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index f722af6..5e0f412 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -61,3 +61,6 @@ async function makeHome({
         version: 1,
-        apps: { sonarr: { apiKey: '0'.repeat(32) } },
+        apps: {
+          gluetun: { controlApiKey: '1'.repeat(32) },
+          sonarr: { apiKey: '0'.repeat(32) },
+        },
         shared: { adminPassword: 'fake-admin-password' },
@@ -233,3 +236,5 @@ describe('plan', () => {
     );
-    expect(result.secrets).toEqual({ generate: ['admin.password', 'sonarr.apiKey'] });
+    expect(result.secrets).toEqual({
+      generate: ['admin.password', 'gluetun.controlApiKey', 'sonarr.apiKey'],
+    });
   });
```

**Change** `packages/engine/src/apply/apply.test.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index c7b5671..3a1d589 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -25,3 +25,3 @@ import {
 import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
-import { fakeDocker, fakeProbe } from '../testing/fakes';
+import { fakeDocker, fakeProbe, HEALTHY_PROBE, probeOutput } from '../testing/fakes';
 import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
@@ -168,3 +168,5 @@ describe('apply', () => {
     ]);
-    expect(result.actions[0]?.detail).toBe('generated admin.password, sonarr.apiKey');
+    expect(result.actions[0]?.detail).toBe(
+      'generated admin.password, gluetun.controlApiKey, sonarr.apiKey',
+    );
     expect(events.slice(0, 4)).toEqual([
@@ -182,3 +184,6 @@ describe('apply', () => {
       version: 1,
-      apps: { sonarr: { apiKey: 'ab'.repeat(16) } },
+      apps: {
+        gluetun: { controlApiKey: 'ab'.repeat(16) },
+        sonarr: { apiKey: 'ab'.repeat(16) },
+      },
       shared: { adminPassword: 'l'.repeat(24) },
@@ -206,2 +211,3 @@ describe('apply', () => {
       'admin.password',
+      'gluetun.controlApiKey',
       'sonarr.apiKey',
@@ -740,3 +746,6 @@ describe('apply', () => {
       version: 1,
-      apps: { sonarr: { apiKey: '0'.repeat(32) } },
+      apps: {
+        gluetun: { controlApiKey: '1'.repeat(32) },
+        sonarr: { apiKey: '0'.repeat(32) },
+      },
       shared: { adminPassword: 'fake-admin-password' },
@@ -1014,2 +1023,62 @@ describe('unhealthyServices', () => {
 
+describe('apply: qBittorrent behind Gluetun', () => {
+  it('restarts qBittorrent when it starts a Gluetun stopped by hand, and verifies the VPN', async () => {
+    // The owner's trial: "docker stop" on Gluetun, then apply. qBittorrent kept running
+    // with the network the old Gluetun had; Compose would start Gluetun alone.
+    const home = await makeHome();
+    const docker = fakeDocker(home);
+    expect((await apply(options(home, docker))).outcome).toBe('success');
+    docker.calls.length = 0;
+    const result = await apply(options(home, stoppedUntilUp(docker, 'gluetun')));
+    expect(result.outcome).toBe('success');
+    expect(result.plan.containers).toEqual(
+      expect.arrayContaining([
+        { service: 'gluetun', action: 'start' },
+        { service: 'qbittorrent', action: 'restart' },
+      ]),
+    );
+    expect(docker.calls.indexOf('stop qbittorrent')).toBeLessThan(
+      docker.calls.indexOf('up'),
+    );
+    expect(result.actions.find((a) => a.step === 'start')?.detail).toBe(
+      'every app is running and healthy; restarted qbittorrent',
+    );
+    expect(result.actions.find((a) => a.step === 'verify')).toEqual({
+      step: 'verify',
+      result: 'done',
+      detail:
+        "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up",
+    });
+    // The VPN check's probe ran, in qBittorrent's network, without asking the internet.
+    const probe = docker.calls.filter(
+      (call) => call === 'run qbittorrent sh as 65534:65534',
+    );
+    expect(probe).toHaveLength(1);
+  });
+
+  it('fails verify, with what to do, when the VPN check finds the VPN down', async () => {
+    const home = await makeHome();
+    const docker = fakeDocker(home, {
+      run: () => ({
+        code: 0,
+        stdout: probeOutput({
+          ...HEALTHY_PROBE,
+          status: [0, '{"status":"stopped"}\n200'],
+        }),
+        stderr: '',
+      }),
+    });
+    const result = await apply(options(home, docker));
+    expect(result.outcome).toBe('failed');
+    expect(result.diagnostics).toContainEqual(
+      expect.objectContaining({
+        code: 'apply.verify-failed',
+        message:
+          "the VPN check found the VPN down: Gluetun's control server says the VPN is stopped",
+        hint: 'see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md',
+      }),
+    );
+  });
+});
+
 describe('apply: the wiring', () => {
```

**Change** `packages/engine/src/secrets/values.test.ts`:

```diff
diff --git a/packages/engine/src/secrets/values.test.ts b/packages/engine/src/secrets/values.test.ts
index 6d81793..b48e036 100644
--- a/packages/engine/src/secrets/values.test.ts
+++ b/packages/engine/src/secrets/values.test.ts
@@ -37,3 +37,6 @@ const stored: SecretStore = {
   version: 1,
-  apps: { sonarr: { apiKey: '0'.repeat(32) } },
+  apps: {
+    gluetun: { controlApiKey: '1'.repeat(32) },
+    sonarr: { apiKey: '0'.repeat(32) },
+  },
   shared: { adminPassword: 'fake-admin-password' },
@@ -44,2 +47,3 @@ describe('missingGeneratedSecrets', () => {
     expect(missingGeneratedSecrets(await stackIn(), emptySecretStore())).toEqual([
+      { app: 'gluetun', name: 'controlApiKey', kind: 'hex32' },
       { app: 'sonarr', name: 'apiKey', kind: 'hex32' },
@@ -57,2 +61,3 @@ describe('secretsToGenerate', () => {
       'admin.password',
+      'gluetun.controlApiKey',
       'sonarr.apiKey',
```

**Change** `packages/engine/src/vpn/check.test.ts`:

```diff
diff --git a/packages/engine/src/vpn/check.test.ts b/packages/engine/src/vpn/check.test.ts
index 093bbd8..e520006 100644
--- a/packages/engine/src/vpn/check.test.ts
+++ b/packages/engine/src/vpn/check.test.ts
@@ -526,3 +526,3 @@ describe('vpnCheck', () => {
       status: 'down',
-      hint: 'restart qBittorrent: "docker restart mediaplane-dev-qbittorrent-1"',
+      hint: 'run "mediaplane apply", which restarts it (or "docker restart mediaplane-dev-qbittorrent-1")',
     });
```

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index c44a1a2..0a17115 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -81,2 +81,14 @@ describe('printPlan: the wiring', () => {
 describe('printPlan', () => {
+  it('shows a guest apply restarts, with the hosts it starts', () => {
+    const term = capture();
+    const containers: PlanResult['containers'] = [
+      { service: 'gluetun', action: 'start' },
+      { service: 'qbittorrent', action: 'restart' },
+    ];
+    printPlan({ ...PLAN, files: [], containers }, { json: false }, term.io);
+    expect(term.stdout()).toBe(
+      'Containers:\n  > start     gluetun\n  > restart   qbittorrent\nPlan: 2 containers to change.\n',
+    );
+  });
+
   it('shows a pre-start file as written before first start, without its content', () => {
```

**Change** `packages/cli/src/vpn-check.test.ts`:

```diff
diff --git a/packages/cli/src/vpn-check.test.ts b/packages/cli/src/vpn-check.test.ts
index c6d0d7d..28fba7e 100644
--- a/packages/cli/src/vpn-check.test.ts
+++ b/packages/cli/src/vpn-check.test.ts
@@ -389,3 +389,3 @@ describe('mediaplane vpn-check', () => {
     expect(term.stdout()).toContain(
-      '        hint: restart qBittorrent: "docker restart mediaplane-dev-qbittorrent-1"\n',
+      '        hint: run "mediaplane apply", which restarts it (or "docker restart mediaplane-dev-qbittorrent-1")\n',
     );
@@ -398,3 +398,3 @@ describe('mediaplane vpn-check', () => {
     expect(plain.stdout()).toContain(
-      '        hint: restart qBittorrent: "docker restart mediaplane-qbittorrent-1"\n',
+      '        hint: run "mediaplane apply", which restarts it (or "docker restart mediaplane-qbittorrent-1")\n',
     );
```

**Change** `test/e2e/vpn.e2e.test.ts`:

```diff
diff --git a/test/e2e/vpn.e2e.test.ts b/test/e2e/vpn.e2e.test.ts
index c485c50..1301091 100644
--- a/test/e2e/vpn.e2e.test.ts
+++ b/test/e2e/vpn.e2e.test.ts
@@ -465,3 +465,3 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       expect(itemOf(open, 'network').hint).toBe(
-        `restart qBittorrent: "docker restart ${PROJECT}-qbittorrent-1"`,
+        `run "mediaplane apply", which restarts it (or "docker restart ${PROJECT}-qbittorrent-1")`,
       );
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/plan packages/engine/src/apply packages/engine/src/secrets packages/engine/src/vpn packages/cli/src/output.test.ts packages/cli/src/vpn-check.test.ts`

Expected: FAIL: `stranded.test.ts` can't load `./stranded`; the two "apply: qBittorrent
behind Gluetun" tests (no `restart`, and a VPN down that verify doesn't catch: `expected
'success' to be 'failed'`); the output test of the `restart` line; and the stranded hint
in `check.test.ts` and `vpn-check.test.ts`, which doesn't put `mediaplane apply` first
yet. 5 files, 5 tests failed, 311 passed.

- [ ] **Step 3: `restart`, the stop before `up`, and verify's VPN check**

**Create** `packages/engine/src/plan/stranded.ts`:

```ts
import type { ResolvedStack } from '../resolver/resolve';
import type { ContainerDetails, ContainerState, Runtime } from '../runtime/types';
import { compare } from '../util/sort';
import type { ContainerChange } from './containers';

/**
 * Whether `guest`, which shares `host`'s network namespace, last started before `host`
 * did: it then holds the namespace the host had, which is gone, so it has no network.
 * Undefined when either start time can't be read.
 */
export function startedBefore(
  guest: ContainerDetails | undefined,
  host: ContainerDetails | undefined,
): boolean | undefined {
  const started = (details: ContainerDetails | undefined) =>
    Date.parse(details?.startedAt ?? '');
  const [ours, theirs] = [started(guest), started(host)];
  if (Number.isNaN(ours) || Number.isNaN(theirs)) return undefined;
  return ours < theirs;
}

/**
 * The guests apply must restart (spec §6.4): an app such as qBittorrent, running in
 * another app's network namespace and otherwise unchanged, whose host, Gluetun, apply
 * starts again, or which started before its host's current run. Compose restarts a guest
 * when it recreates its host (depends_on restart), but not when it starts a stopped host
 * again (verified with Compose 5.5.1), so a guest would be left with no network.
 */
export async function strandedGuests(
  stack: ResolvedStack,
  current: readonly ContainerState[],
  changes: readonly ContainerChange[],
  runtime: Runtime,
): Promise<string[]> {
  const action = (service: string) => changes.find((c) => c.service === service)?.action;
  const runningOne = (service: string) =>
    current.find((c) => c.service === service && c.state === 'running');
  const stranded: string[] = [];
  const pairs: { service: string; guest: ContainerState; host: ContainerState }[] = [];
  for (const app of stack.apps) {
    const hostService = app.networkVia;
    const guest = runningOne(app.def.id);
    if (hostService === undefined || guest === undefined) continue;
    if (action(app.def.id) !== 'unchanged') continue;
    if (action(hostService) === 'start') {
      stranded.push(app.def.id);
      continue;
    }
    const host = runningOne(hostService);
    if (host !== undefined && action(hostService) === 'unchanged') {
      pairs.push({ service: app.def.id, guest, host });
    }
  }
  if (pairs.length > 0) {
    const details = await runtime.inspect(pairs.flatMap((p) => [p.guest.id, p.host.id]));
    const of = (id: string) => details.find((d) => d.id === id);
    for (const { service, guest, host } of pairs) {
      if (startedBefore(of(guest.id), of(host.id)) === true) stranded.push(service);
    }
  }
  return stranded.sort(compare);
}
```

**Change** `packages/engine/src/plan/containers.ts`:

```diff
diff --git a/packages/engine/src/plan/containers.ts b/packages/engine/src/plan/containers.ts
index fa09866..fbc3ead 100644
--- a/packages/engine/src/plan/containers.ts
+++ b/packages/engine/src/plan/containers.ts
@@ -5,3 +5,8 @@ import { compare, unique } from '../util/sort';
 
-export type ContainerAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged';
+/**
+ * What up does to a service's containers. `restart`: plan's own, for a guest whose host
+ * apply starts again (strandedGuests): apply stops it, and up starts it.
+ */
+export type ContainerAction =
+  'create' | 'recreate' | 'start' | 'restart' | 'remove' | 'unchanged';
 
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index ccdc965..cfc2b77 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -44,2 +44,3 @@ import { predictContainers, type PredictResult } from './predict';
 import { planPrestartFiles } from './prestart';
+import { strandedGuests } from './stranded';
 
@@ -190,3 +191,13 @@ export async function planStack(
   }
-  const containers = predicted.changes;
+  let containers = predicted.changes;
+  try {
+    // A guest whose host apply starts again, or that holds a host's old network.
+    const stranded = await strandedGuests(stack, current, containers, options.runtime);
+    containers = containers.map((change) =>
+      stranded.includes(change.service) ? { ...change, action: 'restart' } : change,
+    );
+  } catch (cause) {
+    if (!(cause instanceof RuntimeError)) throw cause;
+    return failed([...diagnostics, dockerUnavailable(cause, options.env)]);
+  }
   const unhealthy = notYetHealthy(current, containers);
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 91fb9f1..5968166 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -33,2 +33,4 @@ import {
 } from './ownership';
+import { PROJECT_NAME } from '../render/compose';
+import { vpnCheck, VPN_RUNBOOK } from '../vpn/check';
 import { writePrestartFiles } from './prestart';
@@ -57,2 +59,7 @@ export interface ApplyOptions extends PlanOptions {
   sleep?: (ms: number) => Promise<unknown>;
+  /**
+   * The Compose project `runtime` manages ("mediaplane" by default): verify's VPN check
+   * names its containers by it.
+   */
+  project?: string;
 }
@@ -177,5 +184,13 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     await runtime.leaveWiring();
+    // A guest whose host up starts again (strandedGuests): stopped now, up starts it in
+    // the host's new network.
+    const restart = shown.containers
+      .filter((change) => change.action === 'restart')
+      .map((change) => change.service);
+    succeeded(await runtime.stop(restart, values));
     const result = await runtime.up(options.waitSeconds ?? DEFAULT_WAIT_SECONDS, values);
     if (!result.ok) throw new Error(await startFailure(runtime, result.error));
-    return 'every app is running and healthy';
+    return restart.length === 0
+      ? 'every app is running and healthy'
+      : `every app is running and healthy; restarted ${restart.join(', ')}`;
   });
@@ -211,3 +226,33 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     if (after.changed) throw new Error(`changes remain after apply: ${remaining(after)}`);
-    return 'no changes remain';
+    // The VPN's topology too (spec §6.4, §7.2(6)): vpn-check's checks, without egress.
+    if (
+      !stack.apps.some(
+        (app) => app.def.id === 'qbittorrent' && app.networkVia === 'gluetun',
+      )
+    ) {
+      return 'no changes remain';
+    }
+    const vpn = await vpnCheck({
+      home,
+      catalog: options.catalog,
+      host: options.host,
+      env: options.env,
+      runtime,
+      project: options.project ?? PROJECT_NAME,
+    });
+    if (!vpn.ok) {
+      const first = vpn.diagnostics.find((d) => d.severity === 'error');
+      throw new StepError(
+        `the VPN check could not run: ${first?.message ?? 'unknown error'}`,
+        first?.hint ?? `see ${VPN_RUNBOOK}`,
+      );
+    }
+    if (vpn.verdict !== 'pass') {
+      const failing = vpn.checks.find((c) => c.status === 'leak' || c.status === 'down');
+      throw new StepError(
+        `the VPN check found ${vpn.verdict === 'leak' ? 'a leak' : 'the VPN down'}: ${failing?.message ?? vpn.verdict}`,
+        failing?.hint ?? `see ${VPN_RUNBOOK}`,
+      );
+    }
+    return "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up";
   });
@@ -261,2 +306,12 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
 
+/** A step that failed, and what to do about it, better said than the step's own hint. */
+class StepError extends Error {
+  readonly hint: string;
+
+  constructor(message: string, hint: string) {
+    super(message);
+    this.hint = hint;
+  }
+}
+
 /** Runs apply's steps in order; after a failure the rest are skipped (ADR 0004). */
@@ -287,3 +342,5 @@ class Steps {
       const hint =
-        cause instanceof AppdataNotPrivateError ? cause.hint : STEP_HINTS[step];
+        cause instanceof AppdataNotPrivateError || cause instanceof StepError
+          ? cause.hint
+          : STEP_HINTS[step];
       this.diagnostics.push(error(`apply.${step}-failed`, message, { hint }));
```

**Change** `packages/engine/src/history/records.ts`:

```diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index 5154047..b820482 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -44,3 +44,3 @@ export const changeRecordSchema = z.strictObject({
         service: z.string(),
-        action: z.enum(['create', 'recreate', 'start', 'remove', 'unchanged']),
+        action: z.enum(['create', 'recreate', 'start', 'restart', 'remove', 'unchanged']),
       }),
```

**Change** `packages/engine/src/vpn/check.ts`:

```diff
diff --git a/packages/engine/src/vpn/check.ts b/packages/engine/src/vpn/check.ts
index 914b147..13cfd7c 100644
--- a/packages/engine/src/vpn/check.ts
+++ b/packages/engine/src/vpn/check.ts
@@ -8,2 +8,3 @@ import { dockerUnavailable, hostFactsOrFailure } from '../host/failure';
 import { STACK_PATH } from '../paths';
+import { startedBefore } from '../plan/stranded';
 import { resolveStack, type ResolvedApp } from '../resolver/resolve';
@@ -268,6 +269,5 @@ async function networkCheck(
     // own, after qBittorrent, has a new one; qBittorrent keeps the old, which is gone.
-    const started = (id: string) => Date.parse(of(id)?.startedAt ?? '');
-    const [ours, gluetuns] = [started(qbittorrent.id), started(gluetun.id)];
+    const before = startedBefore(of(qbittorrent.id), of(gluetun.id));
     // A time that can't be read must not read as "not before".
-    if (gluetun.state === 'running' && (Number.isNaN(ours) || Number.isNaN(gluetuns))) {
+    if (gluetun.state === 'running' && before === undefined) {
       return {
@@ -280,3 +280,3 @@ async function networkCheck(
     }
-    if (gluetun.state === 'running' && ours < gluetuns) {
+    if (gluetun.state === 'running' && before === true) {
       return {
@@ -286,3 +286,4 @@ async function networkCheck(
           'qBittorrent started before Gluetun last did, so it still holds the network Gluetun had then, which is gone: it has none',
-        hint: `restart qBittorrent: "${restart}"`,
+        // Apply restarts it (strandedGuests), which says what it does; docker as well.
+        hint: `run "mediaplane apply", which restarts it (or "${restart}")`,
       };
```

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index f4edfd5..dc429ea 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -27,2 +27,3 @@ const MARKS: Record<ContainerAction, string> = {
   start: '>',
+  restart: '>',
   remove: '-',
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 6cdb4f1..63963ed 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -278,2 +278,3 @@ export function createProgram(
         ...(deps.wiring === undefined ? {} : { wiring: deps.wiring }),
+        project,
         confirm: async (shown) => {
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine packages/cli`

Expected: PASS.

- [ ] **Step 5: Check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src packages/cli/src test/e2e/vpn.e2e.test.ts
git commit -m "feat(engine): apply restarts a stranded qBittorrent, and verify checks the VPN" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end: the wiring on real Docker, from source and from the image

What S3b proves on real Docker, on top of the unit tests: the wiring network is
internal and holds the right containers; the shared admin login works in Sonarr, Radarr
and Prowlarr after `apply`, from source and from the deployed image behind the real
socket proxy; Mediaplane's container has no route out; qBittorrent's API is reached
through Gluetun; and the owner's trial (`docker stop` Gluetun, then `apply`) ends with
qBittorrent restarted and verify clean. These tests check Tasks 1 to 8, so they pass as
soon as they are written; a failure is a bug in those tasks, not in the test.

Decision: the apply test (`apply.e2e.test.ts`) adds, at the stages it already has:
- after the first `apply`: the wiring network is internal and holds exactly Prowlarr,
  qBittorrent, Radarr and Sonarr (no VPN in this stack, so qBittorrent is on it
  itself); the first plan had every resource `after-start`, and `apply` created
  `radarr.admin`, `sonarr.admin` and `prowlarr.admin`; the shared login signs in on
  8989, 7878 and 9696; `state/resources.json` holds no password;
- with `resources.json` deleted: `plan` finds all three to `adopt`, `apply` adopts
  them, and the next `plan` has no changes;
- Sonarr's own settings show `apps.sonarr.env`'s two `SERVER__TRUSTEDNETWORKS` subnets
  as the same comma list (the "Things S1 encodes" row);
- after the eject check: with `login_on_lan: false`, `apply` recreates the three apps,
  and Sonarr answers 200 to `Host: sonarr:8989` and `Host: 127.0.0.1:8989`, and 400 to
  `Host: rebinding.example:8989` (decision 10).
Decision: the deploy test (`deploy.e2e.test.ts`) adds: from the image, `apply` creates
`sonarr.admin` and the login works; the Mediaplane container is on exactly two
networks, both internal (`<stack>_wiring` and `<system>_docker-api`), and has no
default route (`ip route`); and an `apply` that recreates Sonarr (an env change) runs
the disconnect and connect through the proxy, which Docker's own events show
(`docker events --since … --until … --filter network=<stack>_wiring`), not only where
the container ends up (preflight M5). Its teardown brings the system down before the
stack, which would otherwise leave the wiring network behind, and runs every removal
whatever the one before it did, collecting the failures (preflight M7, as `vpn.e2e`'s
`removeAll` does).
Decision: the VPN test (`vpn.e2e.test.ts`) adds: verify's detail says qBittorrent's
network is Gluetun's; the wiring network holds only Gluetun; from the image,
`plan --json` reaches qBittorrent's API through Gluetun (`qbittorrent` `unchanged`);
and, last, `docker stop` Gluetun, then `apply`: Gluetun `start`, qBittorrent `restart`,
the start step's "restarted qbittorrent", verify done, `vpn-check --no-egress` with
five `ok` checks, and then no changes. The trial runs from source only: from the image,
its `compose stop` makes only calls `up` already makes through the proxy (decision 1).
Decision: the apply and VPN tests read the wiring network with one helper,
`wiringMembers(project)` in `test/e2e/helpers.ts` (preflight M4).
Decision: the kill-switch test's check that, without `tun0`, the route leaves by
Gluetun's own network accepts either interface (`/ dev eth\d+ /`). Gluetun is on two
networks now, and Docker names their interfaces in no fixed order: the replay saw the
stack's network as `eth1` once, which `/ dev eth0 /` failed. What it checks, that only
Gluetun's firewall stands in the way, doesn't change.

**Files:**
- Modify: `test/e2e/helpers.ts`, `test/e2e/apply.e2e.test.ts`,
  `test/e2e/deploy.e2e.test.ts`, `test/e2e/vpn.e2e.test.ts`

**Interfaces:**
- **Consumes:** `mediaplane plan --json`, `apply --json`, `vpn-check`, `credentials`;
  `ApplyOptions.project` (Task 8); `startWireGuard`, `deployMediaplane`, `buildImage`,
  `nodeExec` and `REPO` from `test/e2e/helpers.ts` and `wireguard.ts`.
- **Produces:** `wiringMembers(project: string): Promise<{ internal: boolean; members: string[] }>`
  in `test/e2e/helpers.ts` (the names on `<project>_wiring`, sorted).

- [ ] **Step 1: The apply test, and the helper it shares with the VPN test**

**Change** `test/e2e/helpers.ts`:

```diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index a8dedd8..de44f70 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -57,2 +57,25 @@ export async function makeHome(): Promise<string> {
 
+/**
+ * The stack's wiring network (`<project>_wiring`): whether it is internal, and the names
+ * of the containers on it, sorted.
+ */
+export async function wiringMembers(
+  project: string,
+): Promise<{ internal: boolean; members: string[] }> {
+  const inspect = await nodeExec(
+    'docker',
+    [
+      'network',
+      'inspect',
+      '--format',
+      '{{.Internal}}{{range $id, $c := .Containers}} {{$c.Name}}{{end}}',
+      `${project}_wiring`,
+    ],
+    { cwd: '/' },
+  );
+  expect(inspect.code, inspect.stderr).toBe(0);
+  const [internal, ...members] = inspect.stdout.trim().split(' ');
+  return { internal: internal === 'true', members: members.sort() };
+}
+
 /**
```

**Change** `test/e2e/apply.e2e.test.ts`:

```diff
diff --git a/test/e2e/apply.e2e.test.ts b/test/e2e/apply.e2e.test.ts
index 7196d54..bfc696d 100644
--- a/test/e2e/apply.e2e.test.ts
+++ b/test/e2e/apply.e2e.test.ts
@@ -1,2 +1,3 @@
-import { readFile, stat, writeFile } from 'node:fs/promises';
+import { readFile, rm, stat, writeFile } from 'node:fs/promises';
+import { request } from 'node:http';
 import { join } from 'node:path';
@@ -17,3 +18,10 @@ import { tempDir } from '@mediaplane/engine/testing';
 import { describe, expect, it } from 'vitest';
-import { BUSYBOX, composeDown, ejectArguments, makeHome, REPO } from './helpers';
+import {
+  BUSYBOX,
+  composeDown,
+  ejectArguments,
+  makeHome,
+  REPO,
+  wiringMembers,
+} from './helpers';
 
@@ -32,2 +40,75 @@ function mediaplane(...args: string[]): Promise<ExecResult> {
 
+/** What the video stack wires, in the order apply wires it (Prowlarr after the arrs). */
+const WIRED = ['radarr.admin', 'sonarr.admin', 'prowlarr.admin', 'qbittorrent'];
+
+/** Two documentation subnets (RFC 5737), to check Sonarr takes a comma-separated list. */
+const TRUSTED = ['192.0.2.0/24', '198.51.100.0/24'];
+
+/** The Servarr apps, and where their web UI is published. */
+const SERVARR = [
+  ['Sonarr', 8989],
+  ['Radarr', 7878],
+  ['Prowlarr', 9696],
+] as const;
+
+interface Resources {
+  resources: Record<string, unknown>;
+}
+
+/**
+ * The stack's wiring network is internal, and holds exactly the apps Mediaplane calls.
+ * Run from source, Mediaplane itself is not on it: the host reaches it.
+ */
+async function expectWiringNetwork(containers: readonly { service: string }[]) {
+  const wired = ['prowlarr', 'qbittorrent', 'radarr', 'sonarr'];
+  expect(await wiringMembers(PROJECT)).toEqual({
+    internal: true,
+    members: wired.map((service) => `${PROJECT}-${service}-1`),
+  });
+  expect(containers.map((c) => c.service)).toEqual(expect.arrayContaining(wired));
+}
+
+/** The shared login opens Sonarr, Radarr and Prowlarr, and a wrong password doesn't. */
+async function expectSharedLogin(login: { username: string; password: string }) {
+  for (const [name, port] of SERVARR) {
+    const signIn = (password: string) =>
+      fetch(`http://127.0.0.1:${String(port)}/login`, {
+        method: 'POST',
+        body: new URLSearchParams({ username: login.username, password }),
+        redirect: 'manual',
+        signal: AbortSignal.timeout(10_000),
+      });
+    const right = await signIn(login.password);
+    expect([right.status, right.headers.get('location')], `${name} login`).toEqual([
+      302,
+      '/',
+    ]);
+    const wrong = await signIn('not-the-password');
+    expect(wrong.headers.get('location') ?? '', `${name} wrong login`).toContain(
+      'loginFailed',
+    );
+  }
+}
+
+/** The status an app answers with the Host header `host`, which fetch can't set. */
+function statusWithHost(port: number, host: string): Promise<number> {
+  return new Promise((resolve, reject) => {
+    const req = request(
+      {
+        host: '127.0.0.1',
+        port,
+        path: '/ping',
+        headers: { Host: host },
+        timeout: 10_000,
+      },
+      (res) => {
+        res.resume();
+        resolve(res.statusCode ?? 0);
+      },
+    );
+    req.on('error', reject);
+    req.end();
+  });
+}
+
 /** The pre-start files every apply of the video stack plans. */
@@ -43,2 +124,7 @@ describe('apply against real Docker', () => {
     const home = await makeHome();
+    const stack = (await readFile(join(home, 'stack.yaml'), 'utf8')).replace(
+      '  sonarr: {}',
+      `  sonarr: { env: { SONARR__SERVER__TRUSTEDNETWORKS: "${TRUSTED.join(',')}" } }`,
+    );
+    await writeFile(join(home, 'stack.yaml'), stack);
     const runtime = createDockerRuntime({ home, project: PROJECT });
@@ -150,2 +236,51 @@ describe('apply against real Docker', () => {
 
+      // Slice 3b: the wiring network, and the shared login through each app's API.
+      await expectWiringNetwork(containers);
+      expect(first.plan.wiring).toEqual(
+        WIRED.map((resource) => ({ resource, action: 'after-start' })),
+      );
+      expect(
+        first.actions
+          .filter((a) => a.resource !== undefined)
+          .map((a) => [a.resource, a.detail]),
+      ).toEqual([
+        ['radarr.admin', 'created'],
+        ['sonarr.admin', 'created'],
+        ['prowlarr.admin', 'created'],
+      ]);
+      expect(second.plan.wiring.map((w) => w.action)).toEqual(
+        WIRED.map(() => 'unchanged'),
+      );
+      await expectSharedLogin(login);
+      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
+      expect(Object.keys((JSON.parse(resources) as Resources).resources)).toEqual([
+        'prowlarr.admin',
+        'radarr.admin',
+        'sonarr.admin',
+      ]);
+      expect(
+        resources.includes(login.password),
+        'resources.json holds the password',
+      ).toBe(false);
+      // Lost state: apply adopts what the apps hold, by name, and changes nothing in them.
+      await rm(join(home, 'state', 'resources.json'));
+      const adopted = await apply(options);
+      expect(adopted.outcome).toBe('success');
+      expect(adopted.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
+        { resource: 'radarr.admin', action: 'adopt' },
+        { resource: 'sonarr.admin', action: 'adopt' },
+        { resource: 'prowlarr.admin', action: 'adopt' },
+      ]);
+      expect(adopted.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
+      expect((await apply(options)).outcome).toBe('no-changes');
+      await expectSharedLogin(login);
+      // Things S1 encodes: Sonarr takes a comma-separated TRUSTEDNETWORKS, from apps.sonarr.env.
+      const sonarrKey = store.apps.sonarr?.apiKey ?? '';
+      const host = await fetch('http://127.0.0.1:8989/api/v3/config/host', {
+        headers: { 'X-Api-Key': sonarrKey },
+        signal: AbortSignal.timeout(10_000),
+      });
+      const { trustedNetworks } = (await host.json()) as { trustedNetworks: string };
+      expect(trustedNetworks).toBe(TRUSTED.join(','));
+
       // Ejectable: the command printed in compose.yaml's header recreates nothing. An
@@ -161,2 +296,26 @@ describe('apply against real Docker', () => {
       expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(ids);
+
+      // Without a login for local addresses, the Servarr apps take only the Host names
+      // Mediaplane lists (their service name; 127.0.0.1 and localhost always pass), and
+      // still take the shared login through their API, Host and all.
+      await writeFile(
+        join(home, 'stack.yaml'),
+        stack.replace(
+          'network: { bind: localhost }',
+          'network: { bind: localhost }\nsecurity: { login_on_lan: false }',
+        ),
+      );
+      const lanless = await apply(options);
+      expect(lanless.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
+      expect(lanless.outcome).toBe('success');
+      expect(
+        lanless.plan.containers
+          .filter((c) => c.action === 'recreate')
+          .map((c) => c.service),
+      ).toEqual(['prowlarr', 'radarr', 'sonarr']);
+      await expectSharedLogin(login);
+      expect(await statusWithHost(8989, 'sonarr:8989')).toBe(200);
+      expect(await statusWithHost(8989, '127.0.0.1:8989')).toBe(200);
+      expect(await statusWithHost(8989, 'rebinding.example:8989')).toBe(400);
+      expect((await apply(options)).outcome).toBe('no-changes');
     } finally {
```

- [ ] **Step 2: The deploy test**

**Change** `test/e2e/deploy.e2e.test.ts`:

```diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index 9adf464..46b4ecc 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -101,2 +101,61 @@ async function composeVersion(where: 'host' | 'image'): Promise<string> {
 
+/** The networks a container is on, as "<name> internal=<true|false>", sorted. */
+async function networksOf(container: string): Promise<string[]> {
+  const result = await nodeExec(
+    'docker',
+    [
+      'inspect',
+      '--format',
+      '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}\n{{end}}',
+      container,
+    ],
+    { cwd: '/' },
+  );
+  expect(result.code, result.stderr).toBe(0);
+  const names = result.stdout.split('\n').filter((name) => name !== '');
+  const described: string[] = [];
+  for (const name of names) {
+    const network = await nodeExec(
+      'docker',
+      ['network', 'inspect', '--format', '{{.Internal}}', name],
+      { cwd: '/' },
+    );
+    described.push(`${name} internal=${network.stdout.trim()}`);
+  }
+  return described.sort();
+}
+
+/**
+ * What happened to `container` on the stack's wiring network since `since` (a Unix time,
+ * in seconds), as Docker's events say: "connect" and "disconnect", in order.
+ */
+async function wiringEvents(container: string, since: string): Promise<string[]> {
+  const id = await nodeExec('docker', ['inspect', '--format', '{{.Id}}', container], {
+    cwd: '/',
+  });
+  expect(id.code, id.stderr).toBe(0);
+  const events = await nodeExec(
+    'docker',
+    [
+      'events',
+      '--since',
+      since,
+      '--until',
+      (Date.now() / 1000 + 1).toFixed(3),
+      '--filter',
+      'type=network',
+      '--filter',
+      `network=${STACK}_wiring`,
+      '--format',
+      '{{.Action}} {{index .Actor.Attributes "container"}}',
+    ],
+    { cwd: '/' },
+  );
+  expect(events.code, events.stderr).toBe(0);
+  return events.stdout
+    .split('\n')
+    .filter((line) => line.endsWith(` ${id.stdout.trim()}`))
+    .map((line) => line.split(' ')[0] ?? '');
+}
+
 function codesIn(stdout: string): string[] {
@@ -148,20 +207,28 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
   afterAll(async () => {
-    const stackDown = await composeDown(STACK);
-    const systemDown =
-      override === '' ? undefined : await system('down', '--remove-orphans');
-    // Each removal runs even if one before it throws, and so do the image removal (last,
-    // once no container uses the image) and the checks.
-    try {
-      if (override !== '') await rm(dirname(override), { recursive: true, force: true });
-      if (home !== '') await removeHome(home);
-    } finally {
+    // Each removal runs whether or not the one before it worked; then what failed.
+    const failures: unknown[] = [];
+    const attempt = async (removal: () => Promise<unknown>) => {
       try {
-        if (data !== '') await removeAsRoot(data);
-      } finally {
-        const image = await nodeExec('docker', ['image', 'rm', TAG], { cwd: '/' });
-        expect(stackDown.code, stackDown.stderr).toBe(0);
-        if (systemDown !== undefined) expect(systemDown.code, systemDown.stderr).toBe(0);
-        expect(image.code, image.stderr).toBe(0);
+        await removal();
+      } catch (failure) {
+        failures.push(failure);
       }
+    };
+    const succeeds = async (command: Promise<ExecResult>) => {
+      const result = await command;
+      expect(result.code, result.stderr).toBe(0);
+    };
+    // Mediaplane first: while its container is on the stack's wiring network, the
+    // stack's down leaves that network behind ("Resource is still in use").
+    if (override !== '')
+      await attempt(() => succeeds(system('down', '--remove-orphans')));
+    await attempt(() => succeeds(composeDown(STACK)));
+    if (override !== '') {
+      await attempt(() => rm(dirname(override), { recursive: true, force: true }));
     }
+    if (home !== '') await attempt(() => removeHome(home));
+    if (data !== '') await attempt(() => removeAsRoot(data));
+    // Last, once no container uses the image.
+    await attempt(() => succeeds(nodeExec('docker', ['image', 'rm', TAG], { cwd: '/' })));
+    if (failures.length > 0) throw new AggregateError(failures, 'teardown failed');
   }, 300_000);
@@ -266,2 +333,57 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
 
+    // Slice 3b, through the proxy: Mediaplane joined the stack's wiring network to set
+    // the shared login in Sonarr, and checked qBittorrent's key there. Its container is on
+    // two networks, both internal, so it still has no route out.
+    expect(
+      (
+        JSON.parse(first.stdout) as { actions: { resource?: string; detail?: string }[] }
+      ).actions
+        .filter((a) => a.resource !== undefined)
+        .map((a) => [a.resource, a.detail]),
+    ).toEqual([['sonarr.admin', 'created']]);
+    const shown = await mediaplane('credentials', '--json', '--reveal');
+    expect(shown.code, shown.stderr).toBe(0);
+    const login = JSON.parse(shown.stdout) as { username: string; password: string };
+    const signIn = await fetch('http://127.0.0.1:8989/login', {
+      method: 'POST',
+      body: new URLSearchParams({ username: login.username, password: login.password }),
+      redirect: 'manual',
+      signal: AbortSignal.timeout(10_000),
+    });
+    expect([signIn.status, signIn.headers.get('location')]).toEqual([302, '/']);
+    expect(await networksOf(CONTAINER)).toEqual([
+      `${STACK}_wiring internal=true`,
+      `${SYSTEM}_docker-api internal=true`,
+    ]);
+    const routes = await nodeExec('docker', ['exec', CONTAINER, 'ip', 'route'], {
+      cwd: '/',
+    });
+    expect(routes.code, routes.stderr).toBe(0);
+    expect(routes.stdout).not.toMatch(/^default /m);
+    // An apply that recreates an app steps off the network for up, and back on after:
+    // network disconnect and connect, through the proxy.
+    const since = (Date.now() / 1000).toFixed(3);
+    await writeFile(
+      join(home, 'stack.yaml'),
+      smallStack(data).replace(
+        '  sonarr: {}',
+        '  sonarr: { env: { FAKE_SETTING: "1" } }',
+      ),
+    );
+    const changed = await mediaplane('apply', '--yes', '--json');
+    expect(changed.code, changed.stdout + changed.stderr).toBe(0);
+    const recreated = JSON.parse(changed.stdout) as {
+      outcome: string;
+      plan: { containers: { service: string; action: string }[] };
+    };
+    expect(recreated.outcome).toBe('success');
+    expect(recreated.plan.containers).toContainEqual({
+      service: 'sonarr',
+      action: 'recreate',
+    });
+    expect(await networksOf(CONTAINER)).toContain(`${STACK}_wiring internal=true`);
+    expect(await wiringEvents(CONTAINER, since)).toEqual(['disconnect', 'connect']);
+    const settled = await mediaplane('plan', '--json');
+    expect(settled.code, settled.stdout).toBe(0);
+
     // Ejectable (success criterion 6): the header's command, run on the host, runs the
@@ -272,2 +394,3 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     const header = await readFile(join(home, COMPOSE_PATH), 'utf8');
+    const before = await runtime.containers();
     const eject = await nodeExec('docker', ejectArguments(header, STACK), { cwd: '/' });
@@ -278,3 +401,3 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
       // recreated.
-      expect(ejected.map((c) => c.id).sort()).toEqual(containers.map((c) => c.id).sort());
+      expect(ejected.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
     } else {
```

- [ ] **Step 3: The VPN test**

**Change** `test/e2e/vpn.e2e.test.ts`:

```diff
diff --git a/test/e2e/vpn.e2e.test.ts b/test/e2e/vpn.e2e.test.ts
index 1301091..43b4ba9 100644
--- a/test/e2e/vpn.e2e.test.ts
+++ b/test/e2e/vpn.e2e.test.ts
@@ -10,2 +10,3 @@ import {
   readSecretStore,
+  type ApplyOptions,
   type ExecResult,
@@ -19,2 +20,3 @@ import {
   REPO,
+  wiringMembers,
   type DeployedMediaplane,
@@ -215,3 +217,3 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       const runtime = createDockerRuntime({ home, project: PROJECT });
-      const applied = await apply({
+      const options: ApplyOptions = {
         home,
@@ -222,6 +224,17 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
         probe: nodeProbe,
+        project: PROJECT,
         confirm: () => Promise.resolve(true),
-      });
+      };
+      const applied = await apply(options);
       expect(applied.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
       expect(applied.outcome).toBe('success');
+      // Verify checked qBittorrent's key through Gluetun, from the host, on the wiring
+      // network, and ran vpn-check's checks.
+      expect(applied.actions.find((a) => a.step === 'verify')?.detail).toBe(
+        "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up",
+      );
+      expect(await wiringMembers(PROJECT)).toEqual({
+        internal: true,
+        members: [`${PROJECT}-gluetun-1`],
+      });
 
@@ -328,2 +341,10 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       expect(itemOf(inImage, 'egress').message).toBe(bothAddresses);
+      // Gluetun's firewall lets the wiring network reach qBittorrent's port: from its
+      // image, behind the proxy, Mediaplane checks qBittorrent's key through Gluetun.
+      const planned = await deployed.mediaplane(['plan', '--json']);
+      expect(planned.code, planned.stdout + planned.stderr).toBe(0);
+      expect(JSON.parse(planned.stdout)).toMatchObject({
+        changed: false,
+        wiring: [{ resource: 'qbittorrent', action: 'unchanged' }],
+      });
       // Cleared first, so the teardown below doesn't try a failed removal again.
@@ -333,2 +354,33 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
 
+      // The owner's trial: Gluetun stopped by hand, then apply. Compose would only start
+      // Gluetun, leaving qBittorrent with the network the old one had; apply restarts
+      // qBittorrent into the new one, and verify finds the VPN up.
+      const stoppedByHand = await nodeExec('docker', ['stop', '-t', '5', gluetun], {
+        cwd: '/',
+      });
+      expect(stoppedByHand.code, stoppedByHand.stderr).toBe(0);
+      const restarted = await apply(options);
+      expect(restarted.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
+      expect(restarted.outcome).toBe('success');
+      expect(restarted.plan.containers).toEqual(
+        expect.arrayContaining([
+          { service: 'gluetun', action: 'start' },
+          { service: 'qbittorrent', action: 'restart' },
+        ]),
+      );
+      expect(restarted.actions.find((a) => a.step === 'start')?.detail).toBe(
+        'every app is running and healthy; restarted qbittorrent',
+      );
+      expect(restarted.actions.find((a) => a.step === 'verify')?.result).toBe('done');
+      const rejoined = await vpnCheck(home, {}, '--no-egress');
+      expect(rejoined.code, rejoined.stdout + rejoined.stderr).toBe(0);
+      expect(checksOf(rejoined)).toEqual([
+        'network ok',
+        'gluetun ok',
+        'control ok',
+        'control-key ok',
+        'route ok',
+      ]);
+      expect((await apply(options)).outcome).toBe('no-changes');
+
       // The tunnel goes down. At once, with the route still into tun0, vpn-check finds the
@@ -336,4 +388,4 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       // Gluetun's health check restarts the dead tunnel every few seconds, and for a moment
-      // in each restart the route can leave by eth0. That is not the state under test, so
-      // a `route down` caught in it is asked again; a leak never is.
+      // in each restart the route can leave by Gluetun's own network. That is not the
+      // state under test, so a `route down` caught in it is asked again; a leak never is.
       await wg.stop();
@@ -373,3 +425,5 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       // works. Take tun0 away, as if the VPN had lost its interface: the route now
-      // leaves by eth0 (the control), and only Gluetun's firewall stands in the way.
+      // leaves by one of Gluetun's own networks (the control), and only Gluetun's
+      // firewall stands in the way. Gluetun is on two, the stack's and the wiring one,
+      // and Docker names their interfaces (eth0, eth1) in no fixed order.
       const deleted = await busyboxWith(
@@ -383,4 +437,4 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       expect(deleted.code, deleted.stderr).toBe(0);
-      const viaEth0 = await busybox(inGluetun, 'ip', 'route', 'get', wg.gateway);
-      expect(viaEth0.stdout, viaEth0.stderr).toMatch(/ dev eth0 /);
+      const viaEth = await busybox(inGluetun, 'ip', 'route', 'get', wg.gateway);
+      expect(viaEth.stdout, viaEth.stderr).toMatch(/ dev eth\d+ /);
       expect((await fetchFrom(inGluetun, leak)).code).not.toBe(0);
@@ -389,4 +443,4 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
       // health check may have rebuilt tun0 by now, so it says that nothing leaks only as
-      // the route it reports allows: into the tunnel or nowhere, yes; by eth0, where only
-      // the firewall stands in the way and nothing measured it, no.
+      // the route it reports allows: into the tunnel or nowhere, yes; by Gluetun's own
+      // network, where only the firewall stands in the way and nothing measured it, no.
       const tunnelDown = await vpnCheck(home, toEcho);
```

- [ ] **Step 4: Run them, and check nothing is left behind**

The VPN test needs the `wireguard` kernel module (`test -d /sys/module/wireguard || sudo
modprobe wireguard`).

```bash
docker volume ls -q | wc -l
ls -d "$(node -p 'require("os").tmpdir()')"/mediaplane-e2e-* 2>/dev/null | wc -l
pnpm test:e2e
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e --format '{{.Name}}'
docker ps -a --filter label=io.mediaplane.helper --format '{{.Names}}'
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^mediaplane-e2e' || true
docker volume ls -q | wc -l
ls -d "$(node -p 'require("os").tmpdir()')"/mediaplane-e2e-* 2>/dev/null | wc -l
```

Expected: the whole suite passes: 5 files, 19 tests, in about 4 minutes (224 s) on the dev
box with the images cached. The four listings print nothing, and both counts equal
those before the run. If a call from the image fails with `Forbidden`, the proxy refused
it: read `docker logs <PROJECT>-system-socket-proxy-1` before anything else, and do not
widen the allow-list (Global Constraints): report it to the controller.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): the wiring on real Docker, from source and from the image behind the proxy" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs: ADR 0011, the runbook, the threat model, architecture, READMEs, spec, roadmap

The §9 documentation set for what Tasks 1 to 9 built and tested, and nothing more.
Every diagram is a `text` block of at most 40 columns.

Decision: ADR 0011 records D1 as the owner decided it (A2), what was rejected and why,
and its limit in its own words: "defence in depth, not a wall", because the proxy still
lets Mediaplane create containers. ADR 0008 lists the network connect and disconnect as
the engine's own calls now, and says what changed in `mediaplane-system`: its container
joins one more network, which is internal.
Decision: the threat model adds the wiring network to the assets and the diagram, the
Mediaplane container on two internal networks, a new threat (T14: Mediaplane's
container gets a way out, or a way in, with what remains: the proxy still lets it
create containers, the host's gateway address, and a name on two networks), and updates
T1, T2, T4, T5, T10 and T12, and the proxy's section.
Decision: the runbook "wiring failed" follows the others' shape (symptoms, checks, fix,
prevention): each `wire.*` code, what the app's message means, `resources.json`
invalid, the network refused or left behind, and the steps by hand for a wiring network
whose settings changed (decision 3).
Decision: the spec changes where S3b differs from it: §5.2's `init` row (decision 15),
§7.2(2)'s exception for the wiring network, and a new "Slice 3b" entry in §11.
Decision: the roadmap marks S3b done and records what it found for later: the S3c list,
two S4 items (a wiring network whose settings change, and `partial`), and one item not
scheduled (restrict what the proxy lets Mediaplane create).
Decision: what the preflight scan found in the docs (M11 to M15, M21):
- the lines that still said what S3b changed: the deploy guide's "Mediaplane's
  network", the architecture's `mediaplane-system` and `plan` lines, the README's flow,
  which gains the wire step, and the spec's §5.2 `plan` row ("no changes to the stack");
- claims cut to what is checked: "(only without the proxy)" for making the network anew;
  ADR 0011 says CI confirms Docker 28 on the slice PR's first run, and drops "exits 0";
- the spec's §11 entry gains the runtime's new calls (§3.2) and where the wiring takes
  an app's port (the resolver's container ports, not Compose's effective config: §5);
- T14 says what "offline" means: no route of its own, while the apps on the network can
  fetch for it (qBittorrent's add-by-URL, the Servarr apps' tests, Gluetun's HTTP proxy
  or Shadowsocks when turned on);
- table cells stay short: the README's capability row, the spec's §5.2 `init` cell and
  the roadmap's `TRUSTEDNETWORKS` row point to the lists that hold the detail;
- `CONTRIBUTING.md` says the unit tests also run fake HTTP apps on `127.0.0.1`, and one
  spawns a Node process.

**Files:**
- Create: `docs/adr/0011-a-private-wiring-network.md`, `docs/runbooks/wiring-failed.md`
- Modify: `docs/adr/0008-docker-socket-proxy-on-by-default.md`,
  `docs/security/threat-model.md`, `docs/architecture.md`, `docs/runbooks/vpn-down.md`,
  `README.md`, `deploy/README.md`, `CONTRIBUTING.md`, `catalog/sonarr/README.md`,
  `catalog/radarr/README.md`, `catalog/prowlarr/README.md`,
  `catalog/qbittorrent/README.md`, `catalog/gluetun/README.md`,
  `packages/engine/src/config/schema.ts` (the `admin` description),
  `docs/design/m1-engine-cli.md`, `docs/plans/m1-roadmap.md`
- Generated: `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** what Tasks 1 to 9 built, as their tests show it.
- **Produces:** nothing for other tasks.

- [ ] **Step 1: ADR 0011, and ADR 0008**

**Create** `docs/adr/0011-a-private-wiring-network.md`:

```md
# 0011. Reach the apps over a private wiring network

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Wiring means calling each app's HTTP API: Sonarr's, Radarr's and Prowlarr's from
Slice 3b, then qBittorrent's and the media servers'. Two places run those calls:

- **Mediaplane's container**, in `mediaplane-system`. Until Slice 3b its only network was
  internal, shared with the socket proxy alone, so it reached no app.
- **The CLI run from source**, on the host.

The container that can drive Docker should not also get a route out, nor share a
network with containers that have one. The owner chose how to reach the apps on
2026-10-10, from these options:

- **Join the stack's default network.** No new proxy call, but Mediaplane's container
  would get a route out, and every app could reach it.
- **A shared network declared `external` in both projects.** The stack would fail to
  start without `mediaplane-system`, so it would no longer eject (success criterion 6).
- **A helper container that runs the wiring.** Mediaplane's container never changes, but
  the whole engine would run behind a call into a container, with secrets passed in,
  and a container start for every `plan`.
- **A private wiring network** in the stack itself, with no route out.

## Decision

- **The stack's `compose.yaml` declares a network `wiring` with `internal: true`.**
  Compose names it `<project>_wiring` and creates it at `up`, like the default network.
  - Every app with an API in the catalog joins it, beside its default network, which
    still carries the app's own traffic, to the internet and to the other apps.
  - An app inside another app's network namespace is reached through that app, which
    joins for it: Gluetun, for qBittorrent. Gluetun counts every network it is on as
    local, so its firewall lets the wiring network reach qBittorrent's port, and its
    tunnel is unchanged.
  - Compose attaches the apps when it creates their containers. That needs no Docker
    API call the proxy didn't already allow.
- **Mediaplane's container joins it, and stays.** `plan` and `apply` join it when they
  need the apps, with `docker network connect`, which the proxy already allowed for an
  override's networks. Mediaplane finds its own container in `/proc/self/mountinfo`.
  The runtime joins only its own project's wiring network, and refuses one that isn't
  internal: Mediaplane's container is on two internal networks, and has no route out.
- **Apply steps off before `up`, and back on after.** Compose can't recreate a network
  that another project's container is on. Through the proxy it can't delete one at all,
  so a wiring network whose settings change has to be removed by hand (see the
  [wiring failed runbook](../runbooks/wiring-failed.md)).
- **Run from source, nothing joins.** The host reaches every container on a bridge
  network at its address, internal ones too, as long as the bridge has an address on
  the host, which Docker gives it by default. The end-to-end tests check it on Docker
  29.8; CI confirms it on Docker 28 (the slice PR's first run).
- **The apps are reached at their container's address on the wiring network,** found
  with `docker container inspect`, from source and from the image alike. Each request
  carries `Host: <service>:<port>`, as the other apps' requests do, which Servarr's
  allowed hosts and qBittorrent's Host check accept.
- **The one change Mediaplane makes to `mediaplane-system`** is its own container's
  membership of this network. Spec §7.2(2) is refined to say so.

## Consequences

- **This is defence in depth, not a wall.** The proxy still lets Mediaplane create
  containers, with any network, so a compromised Mediaplane can still reach anything
  the host can ([ADR 0008](0008-docker-socket-proxy-on-by-default.md)). A later
  hardening could restrict what the proxy lets it create.
- **Mediaplane stays offline.** It needs no internet in M1 except plex.tv, in Slice 6,
  which a short-lived helper will reach for it. The apps' own internet traffic is
  unchanged.
- **The apps can reach Mediaplane's container on the wiring network.** It listens on
  nothing in M1. The socket proxy is on another network and answers only the address the
  name `mediaplane` has there.
- **Like any Docker network, the wiring network reaches the host** at its gateway
  address, where the host's own services listen.
- **`docker compose down` on the stack leaves the wiring network** while Mediaplane is on
  it ("Resource is still in use"). Bring `mediaplane-system` down first, or
  take Mediaplane off with `docker network disconnect <project>_wiring mediaplane`.
- **A Mediaplane update recreates its container,** which then is on the proxy's network
  only, until the next `plan` or `apply` joins the wiring network again.
- **The stack ejects as before.** The wiring network is part of `compose.yaml`, so the
  header's command still runs it without Mediaplane.
```

**Change** `docs/adr/0008-docker-socket-proxy-on-by-default.md`:

```diff
diff --git a/docs/adr/0008-docker-socket-proxy-on-by-default.md b/docs/adr/0008-docker-socket-proxy-on-by-default.md
index 1ecc312..eba9cdd 100644
--- a/docs/adr/0008-docker-socket-proxy-on-by-default.md
+++ b/docs/adr/0008-docker-socket-proxy-on-by-default.md
@@ -34,3 +34,3 @@ bug in Mediaplane itself, or in something it runs, such as Compose.
   - images: inspect and pull;
-  - networks: list, inspect and create;
+  - networks: list, inspect, create, connect and disconnect;
   - volumes: list.
@@ -38,7 +38,10 @@ bug in Mediaplane itself, or in something it runs, such as Compose.
   Kill is there because `docker run` passes a signal it receives on to its container as a
-  kill. That is how a host helper that times out is stopped.
+  kill. That is how a host helper that times out is stopped. Connect and disconnect are
+  how Mediaplane's own container joins the stack's wiring network, and steps off it for
+  `up` (Slice 3b, [ADR 0011](0011-a-private-wiring-network.md)). They were allowed
+  before that, because Compose can call them when an override adds a network: the
+  wiring network needed no new permission.
 
   It also allows volume create and inspect, which Compose calls when a
-  `compose.override.yaml` adds a named volume, and network connect and disconnect, which
-  Compose can call when an override adds a network.
+  `compose.override.yaml` adds a named volume.
 
@@ -78,3 +81,6 @@ bug in Mediaplane itself, or in something it runs, such as Compose.
   §7.2(2)). The one container created outside the managed project is the unnamed, `--rm`
-  host helper, labelled `io.mediaplane.helper`.
+  host helper, labelled `io.mediaplane.helper`. The one change to a `mediaplane-system`
+  container is Mediaplane's own membership of its project's wiring network: the runtime
+  connects only its own container, and only to an internal network that the managed
+  project's Compose made as its wiring network.
 
@@ -96,2 +102,4 @@ bug in Mediaplane itself, or in something it runs, such as Compose.
     runtime's project check is what keeps Mediaplane to its own project.
+  - Network connect takes any container and any network. The runtime is what keeps it
+    to Mediaplane's own container and its project's internal wiring network.
 - **`-allowfrom` checks a name, not a container.** A container that joins the proxy's
```

- [ ] **Step 2: The threat model**

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 9362a1d..5a6a49a 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -3,3 +3,3 @@
 This is the threat model for Mediaplane as built today: M1, up to and including Slice 3a,
-and Slice 3d.
+and Slices 3d and 3b.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -18,3 +18,3 @@ that power. None of them removes it.
 | Generated API keys                           | `state/secrets.json`, `generated/.env` (both 0600) and `appdata/`     | They open the apps' APIs                                   |
-| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent today, and more apps from Slice 3b    |
+| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr and Prowlarr          |
 | Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                     |
@@ -33,3 +33,5 @@ mediaplane project: the apps
   with a VPN)
-
+  ▲
+  │ wiring network:
+  │ internal, no route out
 mediaplane-system project
@@ -47,4 +49,6 @@ host network, read-only mounts
     capabilities and `no-new-privileges`.
-  - Its only mount is the home. Its only network is internal, and reaches the proxy and
-    nothing else. It listens on nothing.
+  - Its only mount is the home. It listens on nothing.
+  - It is on two networks, both internal, so it has no route out: the proxy's, and the
+    stack's wiring network, which it joins to call the apps' APIs (see T14 and
+    [ADR 0011](../adr/0011-a-private-wiring-network.md)).
   - You reach it with `docker exec`, which already needs Docker access on the host.
@@ -77,2 +81,8 @@ host network, read-only mounts
   `chown` exits. Today only Seerr, which runs as uid 1000, needs it.
+- **The wiring.** `plan` and `apply` call the apps' APIs over the wiring network: from
+  the Mediaplane container, or run from source, from the host. Each request goes
+  straight to the app's container, through an HTTP agent of Mediaplane's own, so a proxy
+  in the environment (`NODE_USE_ENV_PROXY`) never sees a key. It carries the app's key in
+  a header (`X-Api-Key`, or a Bearer token for qBittorrent), never in the URL. Mediaplane
+  signs in to Sonarr, Radarr and Prowlarr with the shared login, to check it.
 - **vpn-check's probe.** `mediaplane vpn-check` runs
@@ -95,2 +105,5 @@ host network, read-only mounts
     on the stack's own Docker network.
+  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, and qBittorrent,
+    through Gluetun with a VPN) are on the stack's wiring network too. It is internal:
+    it gives them no way out, which they have on their own network.
   - Before an app's first start, Mediaplane writes the files it reads when it starts:
@@ -112,3 +125,5 @@ Controls today:
   and the system, swarm, secret, config and plugin APIs.
-- The runtime refuses any project but `mediaplane` or `mediaplane-<name>`.
+- The runtime refuses any project but `mediaplane` or `mediaplane-<name>`. It connects
+  only Mediaplane's own container, and only to its project's wiring network, which must
+  be internal.
 
@@ -129,3 +144,4 @@ Controls today:
   with its temporary password. It asks on localhost too.
-- Sonarr, Radarr and Prowlarr ask for a login from the LAN too, by default
+- Sonarr, Radarr and Prowlarr ask for the shared admin login, which `apply` sets through
+  their API once they first start. They ask from the LAN too, by default
   (`security.login_on_lan`).
@@ -134,4 +150,6 @@ Controls today:
   subnets of the host's private addresses. Sonarr, Radarr and Prowlarr let any local
-  address in (see What remains). `network.lan_subnet` must be private (RFC 1918): a
-  public range, or `0.0.0.0/0`, is refused.
+  address in (see What remains), and take only the Host names Mediaplane lists: their
+  own name, and the addresses their web UI is published on. That stops a web page from
+  reaching them through a name it controls (DNS rebinding). `network.lan_subnet` must be
+  private (RFC 1918): a public range, or `0.0.0.0/0`, is refused.
 
@@ -143,6 +161,8 @@ What remains:
   `bind: localhost` until you have.
-- Sonarr, Radarr and Prowlarr have no user until Slice 3b creates the shared admin
-  there, or you do. Until then, with `login_on_lan: true` nobody can sign in, and with
-  `false` anyone on a local address gets in without a login. For them, "local" means
-  any private address, not just your LAN subnet.
+- With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
+  Prowlarr without a login. For them, "local" means any private address, not just your
+  LAN subnet.
+- Between an app's first start and the wiring step a moment later, Sonarr, Radarr and
+  Prowlarr have no user: with `login_on_lan: true` nobody can sign in, and with `false`
+  a local address gets in anyway.
 
@@ -177,2 +197,6 @@ Controls today:
 
+- An app's answers to Mediaplane are read at most 5 MiB at a time, checked against what
+  Mediaplane expects, and never run or shown whole: only the app's own message about a
+  refusal is shown, cut to 200 characters, with every secret replaced.
+
 What remains:
@@ -181,2 +205,10 @@ What remains:
   image, or files it writes in its own appdata, could make the check pass.
+- A compromised app on the wiring network can reach Mediaplane's container's address
+  there. Mediaplane listens on nothing in M1. The proxy is on another network, and
+  answers only the address the name `mediaplane` has there.
+- A compromised app can answer Mediaplane's calls with anything it likes, such as a
+  setting that looks right but isn't.
+- The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
+  networks, with keys in them. An app with Docker's default capabilities could try to
+  intercept another's traffic on a network they share.
 - The apps that handle media share the data folder, which hardlinks need, so a
@@ -196,2 +228,7 @@ Controls today:
 - Replaced with `***` in errors. Change records hold names, never values.
+- `state/resources.json` (0600) holds, for each resource Mediaplane manages in an app,
+  its id, name and managed fields, and the names of its secrets: never a value or a
+  hash. Secrets are checked by using them, such as signing in, so none needs keeping.
+- An app's error message, as Mediaplane shows it, has every key and password replaced
+  with `***`, and never includes what was sent: a request body is never shown or kept.
 - Given to Compose in its environment or in the 0600 `generated/.env`, never on its
@@ -291,6 +328,6 @@ What remains:
 
-- One password opens every app that uses it: qBittorrent today, Sonarr, Radarr and
-  Prowlarr from Slice 3b, and Jellyfin from Slice 6. A leak from one is a leak for all.
-- From Slice 3b, Sonarr, Radarr and Prowlarr give their password hash to anyone who
-  holds their API key. Prowlarr holds Sonarr's and Radarr's keys from Slice 5.
+- One password opens every app that uses it: qBittorrent, Sonarr, Radarr and Prowlarr
+  today, and Jellyfin from Slice 6. A leak from one is a leak for all.
+- Sonarr, Radarr and Prowlarr give their password hash to anyone who holds their API
+  key. Prowlarr holds Sonarr's and Radarr's keys from Slice 5.
 - Changing `admin.username`, `admin.password`, `login_on_lan`, `network.bind` or
@@ -337,2 +374,8 @@ Controls today:
   (`apps.qbittorrent.vpn: false`).
+- `apply`'s verify step runs vpn-check's checks, without the address comparison, after
+  every apply that changes something: qBittorrent's network, Gluetun's health and its
+  own report, and the route into the tunnel.
+- When Gluetun starts again on its own, qBittorrent keeps the old, empty network until it
+  restarts too. That fails closed, and vpn-check reports it. `apply` restarts
+  qBittorrent then, and when it starts a stopped Gluetun.
 
@@ -340,5 +383,3 @@ What remains:
 
-- vpn-check runs only when you run it. Alerts come in M3.
-- When Gluetun restarts on its own, qBittorrent keeps the old, empty network until it
-  restarts too. That fails closed, and vpn-check reports it, but `apply` doesn't.
+- vpn-check runs only when you run it, or `apply` does. Alerts come in M3.
 - The address comparison asks one IP-echo service; one that answers wrongly could hide a
@@ -394,2 +435,32 @@ What remains:
 
+### T14. Mediaplane's container gets a way out, or a way in
+
+Controls today:
+
+- The apps' APIs are reached over the stack's wiring network, which is internal
+  ([ADR 0011](../adr/0011-a-private-wiring-network.md)). Mediaplane's container is on it
+  and on the proxy's network, and on nothing else, so it has no route out: the
+  end-to-end test checks that it has no default route.
+- The runtime connects only Mediaplane's own container, only to the internal wiring
+  network the managed project's Compose made, and never takes it off any other network.
+- The apps keep their own network for their own traffic. Gluetun counts the wiring
+  network as local, so its firewall lets Mediaplane reach qBittorrent's port, and its
+  tunnel is unchanged: the kill-switch test checks both.
+- Joining needs no Docker API call that the proxy didn't already allow.
+
+What remains:
+
+- The proxy still lets Mediaplane create containers with any network, so this is
+  defence in depth, not a wall: a compromised Mediaplane can still reach anything the
+  host can.
+- Like any Docker network, the wiring network reaches the host at its gateway address,
+  where the host's own services listen.
+- "Offline" means no route of its own. Mediaplane holds the apps' keys, and the apps on
+  the wiring network can fetch for it: qBittorrent's add-by-URL, the Servarr apps' test
+  endpoints, and Gluetun's HTTP proxy or Shadowsocks, if `apps.gluetun.env` turns them
+  on (they listen on every Gluetun interface).
+- Docker answers a name from every network a container is on. Only your
+  `compose.override.yaml` could put a container called `socket-proxy` on the wiring
+  network; it would then compete with the proxy for that name.
+
 ## What the proxy does not stop
@@ -410,4 +481,5 @@ exception: it reads bind mounts, and nothing else. So:
 - **An allowed call works on any container.** Stop and delete reach every container on
-  the host, not just the stack's. The runtime's project check is what keeps Mediaplane to
-  its own project.
+  the host, not just the stack's, and network connect takes any container and any
+  network. The runtime's checks are what keep Mediaplane to its own project, and to its
+  own container on the wiring network.
 - **`-allowfrom=mediaplane` checks a DNS name,** not a container identity.
```

- [ ] **Step 3: The architecture**

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index bc2c621..f3d8dd0 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -3,3 +3,3 @@
 This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
-covering what is built so far (Slices 1 to 3a, and 3d). The design describes the whole
+covering what is built so far (Slices 1 to 3a, 3d and 3b). The design describes the whole
 of M1; this page describes what exists.
@@ -11,3 +11,4 @@ You describe the stack you want in one file, `stack.yaml`. Mediaplane then works
 
-- `plan` works out what would change, and changes nothing;
+- `plan` works out what would change, and changes nothing in your stack (in the image,
+  it joins the stack's wiring network, to ask the apps: see [The wiring](#the-wiring));
 - `apply` makes those changes, then plans again to check that nothing is left.
@@ -32,2 +33,4 @@ host (Docker)
 │    Radarr, Jellyfin, …
+│    and its wiring network,
+│    which mediaplane joins
 │
@@ -39,4 +42,5 @@ host (Docker)
 - **`mediaplane-system`** is Mediaplane's own Compose project. Apply never manages it,
-  and the runtime refuses to. [`deploy/README.md`](../deploy/README.md) shows how to start
-  it.
+  and the runtime refuses to, but for one thing: it puts Mediaplane's own container on
+  the stack's wiring network, and takes it off for `up` ([The wiring](#the-wiring)).
+  [`deploy/README.md`](../deploy/README.md) shows how to start it.
 - **The Mediaplane container** has a read-only root, no capabilities and
@@ -46,4 +50,6 @@ host (Docker)
     `stack.yaml` is the host's own file at that path (`preflight.home-path`).
-  - Its network is internal: it reaches the socket proxy and nothing else. Image pulls
-    happen in the Docker daemon, which has the host's network.
+  - Its networks are internal, so it has no route out. One reaches the socket proxy;
+    the other, the stack's wiring network, reaches the apps whose API it calls
+    ([ADR 0011](adr/0011-a-private-wiring-network.md)). Image pulls happen in the Docker
+    daemon, which has the host's network.
 - **The socket proxy** is the only container with Docker's socket. It forwards only the
@@ -67,3 +73,4 @@ host (Docker)
   unset. There is no container and no host helper: the CLI runs under Node on the host,
-  and looks at the host itself.
+  and looks at the host itself. It reaches the apps on the wiring network from the host,
+  which reaches every container on a Docker bridge network.
 
@@ -103,2 +110,6 @@ Each part, and where its code is:
   where each app's web UI is.
+- **http** (`packages/engine/src/http`): the client for the apps' APIs (see
+  [The wiring](#the-wiring)).
+- **integrations** (`packages/engine/src/integrations`, and `catalog/<app>/integration.ts`):
+  what Mediaplane manages in each app, and how `plan` and `apply` wire it.
 - **vpn** (`packages/engine/src/vpn`): `vpn-check`. It reads the containers, runs a probe
@@ -111,3 +122,3 @@ Not built yet:
 
-- the integrations, which wire the apps together through their APIs (Slices 3b to 7);
+- the links between the apps, through their APIs (Slices 3c to 7);
 - drift detection, with Keep mine (Slice 4).
@@ -136,5 +147,10 @@ render
 diff
-  files, containers,
-  keys to generate,
-  apps not healthy yet
+  │ files, containers,
+  │ keys to generate,
+  │ apps not healthy yet
+  ▼
+ask the apps
+  each resource: create,
+  update, adopt, unchanged,
+  or after the start
 ```
@@ -142,3 +158,5 @@ diff
 `plan` writes nothing. Its exit code is 0 when nothing would change, 2 when something
-would (or an app is still waiting for its health check), and 1 on an error.
+would (or an app is still waiting for its health check), and 1 on an error. In the
+image, it joins Mediaplane's container to the stack's wiring network, to ask the apps;
+that changes no app and no file.
 
@@ -167,4 +185,9 @@ lock
  → set appdata owners
+ → step off the wiring
+   network; stop a
+   stranded qBittorrent
  → up --wait
- → plan again
+ → wire each app
+ → plan again, and
+   vpn-check's checks
  → write change record
@@ -192,2 +215,9 @@ lock
   unhealthy, and gives up after 10 minutes.
+- **A stranded qBittorrent is restarted.** qBittorrent joins Gluetun's network when it
+  starts. When Gluetun starts again on its own, or `apply` starts a stopped one, Compose
+  leaves qBittorrent with the old network, which is gone. So `plan` lists qBittorrent as
+  `restart` then, and apply stops it before `up`, which starts it again in Gluetun's new
+  network.
+- **Verify** plans again, and nothing may be left to do. With qBittorrent behind
+  Gluetun, it also runs vpn-check's checks, without the address comparison.
 - **The lock** records the process and the host name. That is why the Mediaplane
@@ -210,2 +240,3 @@ lock
 │  ├─ secrets.json   0600
+│  ├─ resources.json 0600
 │  ├─ history/
@@ -244,2 +275,56 @@ exist, are on the same filesystem as the folder itself.
 
+## The wiring
+
+Wiring is what Mediaplane does through each app's API once the apps run. Today that is
+the shared admin login in Sonarr, Radarr and Prowlarr, and a check that Mediaplane's key
+still opens qBittorrent.
+
+```text
+mediaplane-system
+  mediaplane
+    │ wiring network:
+    │ internal, no way out
+    ▼
+mediaplane (the stack)
+  sonarr, radarr, prowlarr
+  gluetun ─ qbittorrent
+  (each keeps its default
+  network, for its own
+  traffic)
+```
+
+- **The wiring network** is part of `compose.yaml`: `wiring`, with `internal: true`.
+  Every app whose API Mediaplane calls is on it, and Gluetun is on it for qBittorrent.
+  Gluetun counts it as local, so its firewall lets it through to qBittorrent's port. The
+  apps are reached at their container's address on it, with
+  `Host: <service>:<port>`, as the other apps reach them. In the image, `plan` and
+  `apply` join Mediaplane's container to it, and it stays; `apply` steps off for `up`,
+  so that Compose can make the network anew if it must (only without the proxy, which
+  lets no one delete a network: [ADR 0011](adr/0011-a-private-wiring-network.md)).
+- **Each app's integration** (`catalog/<app>/integration.ts`) lists the resources
+  Mediaplane manages in it, such as `sonarr.admin`. For each, it says how to read it
+  from the app, which of its fields are managed, which secrets it holds, and how to
+  create or change it. The app's README lists them.
+- **Each resource** is one of:
+  - `create` or `update`: the app lacks it, or a managed field or a secret differs. A
+    secret is checked by using it, such as signing in, never compared.
+  - `adopt`: the app already holds it as wanted, but `state/resources.json` doesn't say
+    so yet, such as after lost state.
+  - `unchanged`.
+  - `after the start`: its app isn't running yet, or apply will change its container.
+  - `unknown`: Mediaplane couldn't ask the app, and a warning says why.
+- **The wire step** waits until each app is ready (`/ping` for the arrs), checks that its
+  key still works, then makes each resource what the stack wants, in order: an app comes
+  after the apps its integration names. A resource that fails doesn't stop the others,
+  and one that needs it is skipped. Each result is kept at once in
+  `state/resources.json`: each resource's id, name and managed fields, and the names of
+  its secrets, never their values.
+- **The client** (`http/client.ts`) goes straight to the container, through an HTTP
+  agent of its own, never through a proxy from the environment. It sends the app's key in
+  a header, never in the URL. It tries a refused connection, a timeout, or a 502, 503 or
+  504 again, waiting longer each time, for up to two minutes in `apply` and 15 seconds in
+  `plan`; a create only when nothing reached the app. It reads at most 5 MiB of an
+  answer, checks its shape, and shows only the app's own message about a refusal, with
+  every secret replaced.
+
 ## `vpn-check`
@@ -301,3 +386,3 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- the wiring, app by app (Slices 3b to 7);
+- the wiring, app by app (Slices 3c to 7);
 - drift detection (Slice 4);
````

- [ ] **Step 4: The runbooks**

**Create** `docs/runbooks/wiring-failed.md`:

````md
# Runbook: wiring failed

Wiring is what `apply` does through each app's API once the apps run: today, the shared
admin login in Sonarr, Radarr and Prowlarr, and a check that Mediaplane's key still
opens qBittorrent. Later slices add the links between the apps.

## Symptoms

- **`mediaplane apply` stops at the wiring step,** with each failed resource on its own
  line and the app's own message:

  ```console
  Wiring the apps…
    failed  wiring sonarr.admin: Sonarr at http://sonarr:8989 (172.20.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    failed  wiring: the wiring failed for sonarr.admin
    skipped verify
  error: Sonarr at http://sonarr:8989 (172.20.0.3) refused Mediaplane's API key (HTTP 401) (GET /api/v3/system/status)
    hint: see https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
  error: the wiring failed for sonarr.admin
    hint: the apps' own messages are above; fix what they say, then run apply again. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md

  Apply failed: 5 done, 1 failed, 1 skipped. Run apply again to retry. Change record: 20261010T120000Z-0a1b2c3d
  ```

  A resource that needs one that failed is `skipped`, and the others still run.

- **`mediaplane plan`** warns with the same message, lists the resource under `Wiring:`
  as `? unknown`, and exits 2.
- **`apply` fails at verify** with `changes remain after apply: sonarr.admin (update)`:
  the app took the change, then kept something else.
- **`plan` stops** with `wire.network` (Mediaplane won't join the wiring network) or
  `resources.invalid` (it can't read `state/resources.json`).

In `--json` output, a failure's code is `wire.<kind>`: `auth`, `rejected`, `server`,
`unreachable`, `timeout`, `protocol` or `not-on-network`.

## Checks

1. **What it says:** `mediaplane plan`, and read the `Wiring:` lines and each warning.
   `mediaplane history <id>` shows each resource's result from an apply.
2. **Whether the app runs:** `mediaplane status <app>`. An app that isn't healthy is
   checked after the start, not before.
3. **Its log,** on the host: `docker compose -p mediaplane logs --tail 100 <app>`.
4. **Who is on the wiring network,** on the host:
   `docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' mediaplane_wiring`.
   It holds the apps Mediaplane calls (Gluetun for qBittorrent, with a VPN), and, in
   the image, Mediaplane's own container.

## Fix

- **`refused Mediaplane's API key (HTTP 401 or 403)`.** The app's key is no longer the
  one in `state/secrets.json`.
  - **qBittorrent** keeps its key only in its file, so a key made anew in its web UI
    shuts Mediaplane out. Stop it, put the stored key back, and start it:
    `docker stop mediaplane-qbittorrent-1`, set `WebUI\APIKey=` in
    `appdata/qbittorrent/qBittorrent/qBittorrent.conf` to `qbittorrent.apiKey` from
    `state/secrets.json`, then `docker start mediaplane-qbittorrent-1`.
  - **Sonarr, Radarr and Prowlarr** take their key from their environment as well as
    `config.xml`, so `apply` puts it back when it recreates them. If `plan` says
    `<app>.not-seeded`, follow the app's README.
  - Slice 4 restores a key at its source for you.
- **`could not be reached` or `did not answer within 30 s`.** The app isn't up, or
  Mediaplane can't get to it.
  - Wait until `mediaplane status` shows it healthy, then run `apply` again: `apply`
    waits up to two minutes for an app that is starting.
  - In the image, check that Mediaplane is on the wiring network (check 4). `plan` and
    `apply` join it themselves.
- **`container is not on the stack's wiring network`.** Something took the app off it,
  such as `docker network disconnect`. Put it back on the host:
  `docker network connect mediaplane_wiring mediaplane-<app>-1`, or
  `mediaplane-gluetun-1` for qBittorrent behind the VPN.
- **`refused the request (HTTP 400): … Invalid Hostname`, or
  `Allowed Hosts is required`.** With `security.login_on_lan: false`, Sonarr, Radarr and
  Prowlarr take only the Host names Mediaplane lists in `<APP>__SERVER__ALLOWEDHOSTS`:
  their own name and the addresses their web UI is published on. If you set that
  variable yourself, in `apps.<app>.env`, keep the app's name, such as `sonarr`, in it.
  A browser that uses another name, such as your host's, needs it listed there too.
- **`failed (HTTP 500)`.** The app failed. Read its log (check 3).
- **`answered something Mediaplane doesn't understand`.** The app answered in a shape the
  tested version doesn't. Usually that is a `version:` of your own in `apps.<app>`:
  remove it to go back to the tested image.
- **`resources.invalid`.** Move `state/resources.json` aside, and run `plan` again.
  Mediaplane finds what it made in each app by name, adopts it, and writes the file
  anew at the next `apply`.
- **`wire.network`: `refusing to join mediaplane_wiring`.** The wiring network isn't the
  one Mediaplane's `compose.yaml` makes: it isn't internal, or another project made it.
  Look for a `networks:` entry in `compose.override.yaml` that changes it, and take it
  out. Then remove the network on the host, as below.
- **The wiring network must be made anew,** because its settings changed. Through the
  socket proxy, Compose can't delete a network. On the host:

  ```bash
  docker network disconnect mediaplane_wiring mediaplane
  docker compose -p mediaplane down
  mediaplane apply
  ```

  `down` keeps every app's data. Use the container name of your Mediaplane, as
  `docker ps` shows it.

Then run `mediaplane apply`. It plans again and does only what is left
([ADR 0004](../adr/0004-converge-forward-apply.md)).

## Prevention

- **Run `mediaplane plan` first.** It checks every app's key and each resource, and
  shows what `apply` would change.
- **Leave the keys as Mediaplane set them,** and don't make one anew in an app's web UI.
- **Leave the wiring network out of `compose.override.yaml`**
  ([ADR 0011](../adr/0011-a-private-wiring-network.md)).
- **Keep the tested versions:** leave out `version:`.
````

**Change** `docs/runbooks/vpn-down.md`:

```diff
diff --git a/docs/runbooks/vpn-down.md b/docs/runbooks/vpn-down.md
index dab2562..d80c053 100644
--- a/docs/runbooks/vpn-down.md
+++ b/docs/runbooks/vpn-down.md
@@ -95,4 +95,5 @@ and `unpause` from inside Mediaplane's container.
   its own, by hand or after a crash, so it has a new network, and qBittorrent kept the
-  old one, which has nothing but loopback. `mediaplane apply` doesn't fix this: Compose
-  restarts qBittorrent only when it recreates Gluetun. Restart qBittorrent, on the host:
+  old one, which has nothing but loopback. Compose restarts qBittorrent only when it
+  recreates Gluetun, so run `mediaplane apply`: `plan` lists qBittorrent as `restart`,
+  and apply restarts it. Or restart it yourself, on the host:
 
@@ -113,4 +114,5 @@ and `unpause` from inside Mediaplane's container.
 - **`gluetun`: Gluetun is exited, dead or created, or has no container.** Run
-  `mediaplane apply`, which starts or recreates it. Then run `mediaplane vpn-check` again,
-  and follow the `network` line if it now finds qBittorrent stranded.
+  `mediaplane apply`, which starts or recreates it, and restarts qBittorrent into its new
+  network. Its verify step runs these checks again, without the address comparison.
+  Then run `mediaplane vpn-check` to compare the addresses too.
 - **`gluetun`: Gluetun is paused or restarting.** A restart usually ends by itself: wait
@@ -207,3 +209,4 @@ Run `mediaplane vpn-check` again before you start qBittorrent.
   time. It exits 1 on a leak or a VPN that is down, so a cron job can alert on it.
-- **Restart qBittorrent whenever you restart Gluetun** by hand.
+- **Restart qBittorrent whenever you restart Gluetun** by hand, or run
+  `mediaplane apply`, which does.
 - **Leave qBittorrent's network alone** in `compose.override.yaml`: anything about its
```

- [ ] **Step 5: The READMEs, `CONTRIBUTING.md`, and the `admin` description**

**Change** `README.md`:

````diff
diff --git a/README.md b/README.md
index b722572..97f7a75 100644
--- a/README.md
+++ b/README.md
@@ -11,12 +11,11 @@ Compose and wires the apps together for you.**
 > - **Works today:** `mediaplane plan` checks a real host and shows exactly what it
->   would do. `mediaplane apply` then starts the stack and confirms that every app
->   is healthy. `mediaplane vpn-check` confirms that qBittorrent reaches the internet
->   only through the VPN. Mediaplane runs in its own hardened container, behind a
->   Docker socket proxy.
-> - **Next:** wiring the apps together. Until that lands, each app still needs
+>   would do. `mediaplane apply` then starts the stack, confirms that every app is
+>   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr and Prowlarr
+>   (`mediaplane credentials` shows it). `mediaplane vpn-check` confirms that
+>   qBittorrent reaches the internet only through the VPN. Mediaplane runs in its own
+>   hardened container, behind a Docker socket proxy, and reaches the apps over a
+>   private network with no route out.
+> - **Next:** wiring the apps to each other. Until that lands, each app still needs
 >   setting up by hand. Jellyfin's wizard and Seerr's setup are open to anyone who
->   can reach them until you complete them, so complete them first. qBittorrent has
->   the shared admin login from its first start (`mediaplane credentials` shows it).
->   Sonarr, Radarr and Prowlarr ask for a login that doesn't exist yet (Slice 3b
->   creates it); their READMEs say how to set one.
+>   can reach them until you complete them, so complete them first.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -46,19 +45,20 @@ Mediaplane does that part for you:
 
-| Capability                                                                            | Status       |
-| ------------------------------------------------------------------------------------- | ------------ |
-| Validate `stack.yaml`, with errors that say what to change                            | Done         |
-| Render a readable Compose project with images pinned by tag and digest                | Done         |
-| Check the host first: Docker versions, disk, data folder, ports, the VPN device       | Done         |
-| Refuse to publish web UIs on a cloud VM's private address by mistake                  | Done         |
-| Predict exactly which containers will change, using Compose's own config hashes       | Done         |
-| Generate keys and start the stack (`mediaplane apply`)                                | Done         |
-| See each app's health and every past apply (`status`, `history`)                      | Done         |
-| Write a starter `stack.yaml` (`init`)                                                 | Done         |
-| One admin login, generated, set in qBittorrent before it first starts (`credentials`) | Done         |
-| A VPN kill switch, tested against a real WireGuard server, and `vpn-check`            | Done         |
-| Run in a hardened container, behind a Docker socket proxy                             | Done         |
-| Documentation generated from code: the `stack.yaml` and CLI references, app facts     | Done         |
-| Wire the apps together (download clients, indexers, root folders, media server)       | Planned      |
-| Detect manual changes and offer Re-apply or "Keep mine"                               | Planned      |
-| Web panel with a setup wizard                                                         | Planned (M2) |
+| Capability                                                                        | Status       |
+| --------------------------------------------------------------------------------- | ------------ |
+| Validate `stack.yaml`, with errors that say what to change                        | Done         |
+| Render a readable Compose project with images pinned by tag and digest            | Done         |
+| Check the host first: Docker versions, disk, data folder, ports, the VPN device   | Done         |
+| Refuse to publish web UIs on a cloud VM's private address by mistake              | Done         |
+| Predict exactly which containers will change, using Compose's own config hashes   | Done         |
+| Generate keys and start the stack (`mediaplane apply`)                            | Done         |
+| See each app's health and every past apply (`status`, `history`)                  | Done         |
+| Write a starter `stack.yaml` (`init`)                                             | Done         |
+| One admin login, generated, for qBittorrent and the Servarr apps (`credentials`)  | Done         |
+| Reach the apps' APIs over a private network with no route out                     | Done         |
+| A VPN kill switch, tested against a real WireGuard server, and `vpn-check`        | Done         |
+| Run in a hardened container, behind a Docker socket proxy                         | Done         |
+| Documentation generated from code: the `stack.yaml` and CLI references, app facts | Done         |
+| Wire the apps together (download clients, indexers, root folders, media server)   | Planned      |
+| Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
+| Web panel with a setup wizard                                                     | Planned (M2) |
 
@@ -101,3 +101,4 @@ Mediaplane works like `terraform plan` and `apply`. `plan` validates `stack.yaml
 the host, renders the Compose project and diffs it against what is running. It shows you
-the changes and touches nothing. `apply` does the same, then makes those changes.
+the changes and touches nothing in your stack. `apply` does the same, then makes those
+changes.
 
@@ -110,4 +111,5 @@ mediaplane plan
   │  ports, the data folder
-  │  compares with what is running
-  │  changes nothing
+  │  compares with what is running,
+  │  and asks the apps
+  │  changes nothing in the stack
   ▼
@@ -120,2 +122,4 @@ mediaplane apply
   ├─ waits until every app is healthy
+  ├─ wires the apps through their
+  │  APIs (the shared login, so far)
   ├─ plans again: nothing left to do
@@ -124,3 +128,3 @@ mediaplane apply
 
-Next, `apply` will also wire the apps together through their own APIs.
+Next, `apply` will wire the apps to each other through the same APIs (Slices 3c to 7).
 
@@ -213,7 +217,7 @@ Admin login for the apps:
 Jellyfin     http://127.0.0.1:8096  (its login arrives in Slice 6)
-Prowlarr     http://127.0.0.1:9696  (its login arrives in Slice 3b)
+Prowlarr     http://127.0.0.1:9696
 qBittorrent  http://127.0.0.1:8080
-Radarr       http://127.0.0.1:7878  (its login arrives in Slice 3b)
+Radarr       http://127.0.0.1:7878
 Seerr        http://127.0.0.1:5055  (its login arrives in Slice 7)
-Sonarr       http://127.0.0.1:8989  (its login arrives in Slice 3b)
+Sonarr       http://127.0.0.1:8989
 ```
@@ -377,6 +381,6 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **Merged:** S1 (the pure core), S2a (`plan` against a real host), S2b (`apply`), S2c
-  (packaging), S3a (the shared admin and pre-start files) and S3d (the VPN's kill-switch
-  test and `vpn-check`).
-- **Next:** S3b (the wiring framework).
-- **After that:** S3c (the download path), then S4 to S8.
+  (packaging), S3a (the shared admin and pre-start files), S3d (the VPN's kill-switch
+  test and `vpn-check`) and S3b (the wiring framework).
+- **Next:** S3c (the download path).
+- **After that:** S4 to S8.
 
````

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index 2e200fb..f8c9462 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -13,14 +13,10 @@ never touch Mediaplane itself.
 
-> Mediaplane is pre-alpha. The apps are not wired together yet (Slices 3b to 7 do that).
-> On a home network, `init` suggests publishing their web UIs on your LAN. Until the
-> wiring lands:
+> Mediaplane is pre-alpha. The apps are not wired to each other yet (Slices 3c to 7 do
+> that). On a home network, `init` suggests publishing their web UIs on your LAN. Until
+> the wiring lands, Jellyfin's setup wizard and Seerr's setup are open to anyone on your
+> LAN until you complete them, so complete them first.
 >
-> - Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
->   complete them, so complete them first;
-> - Sonarr, Radarr and Prowlarr ask for a login that has no user yet (Slice 3b creates
->   it).
->
-> qBittorrent has the shared admin login from its first start: `mediaplane credentials`
-> shows it. To keep the web UIs on this machine only, answer `localhost` when `init`
-> asks (see [First run](#first-run)).
+> qBittorrent, Sonarr, Radarr and Prowlarr have the shared admin login:
+> `mediaplane credentials` shows it. To keep the web UIs on this machine only, answer
+> `localhost` when `init` asks (see [First run](#first-run)).
 
@@ -145,7 +141,5 @@ nothing. Without a terminal it asks nothing: pass the flags in the
 
-  Until the wiring lands (Slices 3b to 7):
-  - Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
-    complete them. Complete them right after the first `apply`.
-  - Sonarr, Radarr and Prowlarr ask for a login that has no user yet. Their READMEs,
-    such as [Sonarr's](../catalog/sonarr/README.md), say how to create one.
+  Until the wiring lands (Slices 6 and 7), Jellyfin's setup wizard and Seerr's setup
+  are open to anyone on your LAN until you complete them. Complete them right after the
+  first `apply`.
 
@@ -156,4 +150,5 @@ nothing. Without a terminal it asks nothing: pass the flags in the
   password of your own only with `--reveal`, and its `--json` output leaves out either
-  unless you add `--reveal`. qBittorrent uses this login today; Sonarr, Radarr and
-  Prowlarr follow in Slice 3b.
+  unless you add `--reveal`. qBittorrent, Sonarr, Radarr and Prowlarr use it. `apply`
+  sets it in Sonarr, Radarr and Prowlarr through their API once they run, and sets it
+  again whenever it changes.
   - qBittorrent gets the login only at its first start, from a file Mediaplane never
@@ -221,4 +216,6 @@ host
 
-- **Mediaplane's network** is internal: the container reaches the proxy and nothing else.
-  Image pulls happen in the Docker daemon, which has the host's network.
+- **Mediaplane's networks** are internal: the proxy's, and the stack's wiring network
+  ([How Mediaplane reaches the apps](#how-mediaplane-reaches-the-apps)). The container
+  has no route out. Image pulls happen in the Docker daemon, which has the host's
+  network.
 - **vpn-check's probe** is a throwaway container of qBittorrent's image, in Gluetun's
@@ -375,7 +372,21 @@ Each item is a message you may see, then what to do.
 
+## How Mediaplane reaches the apps
+
+The stack has a network of its own for Mediaplane, `mediaplane_wiring`, with no route
+out ([ADR 0011](../docs/adr/0011-a-private-wiring-network.md)). The apps whose API
+Mediaplane calls are on it, and so is Gluetun, for qBittorrent. `plan` and `apply` put
+Mediaplane's container on it too, and it stays there; `apply` takes it off for `up`, and
+back on after. So Mediaplane's container is on two networks, and neither has a route
+out. After an update recreates the container, the next `plan` or `apply` puts it back.
+
+While Mediaplane is on it, `docker compose -p mediaplane down` on the host leaves that
+network behind ("Resource is still in use"). Bring `mediaplane-system` down first, or
+take Mediaplane off: `docker network disconnect mediaplane_wiring mediaplane`.
+
 ## Removing Mediaplane
 
-`docker compose -f deploy/mediaplane.compose.yaml down` removes Mediaplane and the proxy.
-Your stack keeps running. The command in the header of
-`/opt/mediaplane/generated/compose.yaml` manages it without Mediaplane.
+`docker compose -f deploy/mediaplane.compose.yaml down` removes Mediaplane and the proxy,
+and takes Mediaplane off the stack's wiring network. Your stack keeps running. The
+command in the header of `/opt/mediaplane/generated/compose.yaml` manages it without
+Mediaplane.
 
```

**Change** `CONTRIBUTING.md`:

```diff
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
index 8657a38..ba0ba04 100644
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -28,3 +28,7 @@ what it writes. CI fails while the generated docs are stale.
 
-The unit tests use in-memory fakes for Docker and the host. The spawned-CLI tests in
+The unit tests use in-memory fakes for Docker and the host. The apps' APIs are fake
+HTTP servers on 127.0.0.1 (`fakeHttpApp` in `@mediaplane/engine/testing`, §8.1(2) of the
+spec), which the CLI's tests reach through `CliDeps.wiring`; no unit test reaches a real
+app. One client test spawns a Node process, to check that no proxy sees a key. The
+spawned-CLI tests in
 `packages/cli/src/main.test.ts` and `pnpm test:e2e` use the real Docker, under their own
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 0c4abea..cd86ab5 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -38,2 +38,14 @@ LinuxServer.io image, unmodified.
   `SONARR__SERVER__TRUSTEDNETWORKS` lists your LAN subnet, when Mediaplane knows it.
+- **The shared admin login.** Once Sonarr runs, `apply` sets the login that
+  `mediaplane credentials` shows, through Sonarr's API, and checks it by signing in. It
+  is the resource `sonarr.admin`: its user name is managed, and its password is a secret,
+  which `state/resources.json` names but never holds. Sonarr needs no restart for
+  it. Mediaplane reaches Sonarr's API over the stack's wiring network, with its API key.
+- **The names a browser may use, without a login on the LAN.** With
+  `security.login_on_lan: false`, Sonarr takes only the Host names in
+  `SONARR__SERVER__ALLOWEDHOSTS`, and refuses to save its settings without them:
+  Mediaplane lists `sonarr`, which the other apps and Mediaplane use, and the addresses its
+  web UI is published on. `localhost` and `127.0.0.1` always work. To use another name,
+  such as your host's, set the variable yourself in `apps.sonarr.env`, keeping `sonarr` in
+  the list.
 - **What it needs.** A download client. Listing Sonarr does not turn one on: list
@@ -45,6 +57,4 @@ LinuxServer.io image, unmodified.
 
-The wiring arrives in Slices 3b to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 3c to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 3b:** the shared admin login. Until then, `mediaplane credentials` lists
-  Sonarr with `its login arrives in Slice 3b`.
 - **Slice 3c:** qBittorrent as its download client, and the `/data/media/tv` root
@@ -75,13 +85,2 @@ The wiring arrives in Slices 3b to 7 (see the [roadmap](../../docs/plans/m1-road
 
-- **No one can sign in yet.** Mediaplane turns the forms login on, but no user exists
-  until Slice 3b creates the shared admin login.
-  - With the default `security.login_on_lan: true`, Sonarr shows a login page that has
-    no account to sign in to.
-  - With `security.login_on_lan: false`, anyone who reaches Sonarr from a local address
-    (a private network such as your LAN) gets in without a login.
-  - To get in today, set `security.login_on_lan: false`, run `apply`, and set a user name
-    and password under Settings, General, Security. Then set `login_on_lan` back to
-    `true` and run `apply` again. While `login_on_lan` is `false`, anyone on your network
-    gets in, so do this straight away, or keep `network.bind: localhost` while you do.
-    From Slice 3b, `apply` sets the shared admin login instead.
 - **Set up before Slice 3a.** If Sonarr first started before Mediaplane wrote its
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 82b6a10..7d20dce 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -38,2 +38,14 @@ LinuxServer.io image, unmodified.
   `RADARR__SERVER__TRUSTEDNETWORKS` lists your LAN subnet, when Mediaplane knows it.
+- **The shared admin login.** Once Radarr runs, `apply` sets the login that
+  `mediaplane credentials` shows, through Radarr's API, and checks it by signing in. It
+  is the resource `radarr.admin`: its user name is managed, and its password is a secret,
+  which `state/resources.json` names but never holds. Radarr needs no restart for
+  it. Mediaplane reaches Radarr's API over the stack's wiring network, with its API key.
+- **The names a browser may use, without a login on the LAN.** With
+  `security.login_on_lan: false`, Radarr takes only the Host names in
+  `RADARR__SERVER__ALLOWEDHOSTS`, and refuses to save its settings without them:
+  Mediaplane lists `radarr`, which the other apps and Mediaplane use, and the addresses its
+  web UI is published on. `localhost` and `127.0.0.1` always work. To use another name,
+  such as your host's, set the variable yourself in `apps.radarr.env`, keeping `radarr` in
+  the list.
 - **What it needs.** A download client. Listing Radarr does not turn one on: list
@@ -45,6 +57,4 @@ LinuxServer.io image, unmodified.
 
-The wiring arrives in Slices 3b to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 3c to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 3b:** the shared admin login. Until then, `mediaplane credentials` lists
-  Radarr with `its login arrives in Slice 3b`.
 - **Slice 3c:** qBittorrent as its download client, and the `/data/media/movies` root
@@ -84,13 +94,2 @@ The wiring arrives in Slices 3b to 7 (see the [roadmap](../../docs/plans/m1-road
 
-- **No one can sign in yet.** Mediaplane turns the forms login on, but no user exists
-  until Slice 3b creates the shared admin login.
-  - With the default `security.login_on_lan: true`, Radarr shows a login page that has
-    no account to sign in to.
-  - With `security.login_on_lan: false`, anyone who reaches Radarr from a local address
-    (a private network such as your LAN) gets in without a login.
-  - To get in today, set `security.login_on_lan: false`, run `apply`, and set a user name
-    and password under Settings, General, Security. Then set `login_on_lan` back to
-    `true` and run `apply` again. While `login_on_lan` is `false`, anyone on your network
-    gets in, so do this straight away, or keep `network.bind: localhost` while you do.
-    From Slice 3b, `apply` sets the shared admin login instead.
 - **Set up before Slice 3a.** If Radarr first started before Mediaplane wrote its
```

**Change** `catalog/prowlarr/README.md`:

```diff
diff --git a/catalog/prowlarr/README.md b/catalog/prowlarr/README.md
index 780bb25..14d43e0 100644
--- a/catalog/prowlarr/README.md
+++ b/catalog/prowlarr/README.md
@@ -38,2 +38,14 @@ folder, only its own config folder.
   `PROWLARR__SERVER__TRUSTEDNETWORKS` lists your LAN subnet, when Mediaplane knows it.
+- **The shared admin login.** Once Prowlarr runs, `apply` sets the login that
+  `mediaplane credentials` shows, through Prowlarr's API, and checks it by signing in. It
+  is the resource `prowlarr.admin`: its user name is managed, and its password is a secret,
+  which `state/resources.json` names but never holds. Prowlarr needs no restart for
+  it. Mediaplane reaches Prowlarr's API over the stack's wiring network, with its API key.
+- **The names a browser may use, without a login on the LAN.** With
+  `security.login_on_lan: false`, Prowlarr takes only the Host names in
+  `PROWLARR__SERVER__ALLOWEDHOSTS`, and refuses to save its settings without them:
+  Mediaplane lists `prowlarr`, which the other apps and Mediaplane use, and the addresses its
+  web UI is published on. `localhost` and `127.0.0.1` always work. To use another name,
+  such as your host's, set the variable yourself in `apps.prowlarr.env`, keeping `prowlarr` in
+  the list.
 - **Byparr.** Listing Prowlarr also turns on Byparr, the Cloudflare challenge solver,
@@ -50,4 +62,2 @@ to Sonarr and Radarr.
 
-- **Slice 3b:** the shared admin login. Until then, `mediaplane credentials` lists
-  Prowlarr with `its login arrives in Slice 3b`.
 - **Slice 5:**
@@ -87,13 +97,2 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **No one can sign in yet.** Mediaplane turns the forms login on, but no user exists
-  until Slice 3b creates the shared admin login.
-  - With the default `security.login_on_lan: true`, Prowlarr shows a login page that has
-    no account to sign in to.
-  - With `security.login_on_lan: false`, anyone who reaches Prowlarr from a local address
-    (a private network such as your LAN) gets in without a login.
-  - To get in today, set `security.login_on_lan: false`, run `apply`, and set a user name
-    and password under Settings, General, Security. Then set `login_on_lan` back to
-    `true` and run `apply` again. While `login_on_lan` is `false`, anyone on your network
-    gets in, so do this straight away, or keep `network.bind: localhost` while you do.
-    From Slice 3b, `apply` sets the shared admin login instead.
 - **Set up before Slice 3a.** If Prowlarr first started before Mediaplane wrote its
```

**Change** `catalog/qbittorrent/README.md`:

```diff
diff --git a/catalog/qbittorrent/README.md b/catalog/qbittorrent/README.md
index 794a93b..bb288a7 100644
--- a/catalog/qbittorrent/README.md
+++ b/catalog/qbittorrent/README.md
@@ -31,3 +31,5 @@ unmodified, and by default puts it behind Gluetun's VPN.
   - it starts only once Gluetun is healthy, and Compose restarts it when it recreates
-    Gluetun;
+    Gluetun. When Gluetun has started again without it, by hand or after a crash, or
+    when `apply` starts a stopped Gluetun, `apply` restarts qBittorrent too, so that it
+    joins Gluetun's new network: `plan` lists it as `restart`;
   - its web UI is published on Gluetun's service;
@@ -39,2 +41,6 @@ unmodified, and by default puts it behind Gluetun's VPN.
 - **Without the VPN** (`vpn: false`), it has its own network, and `plan` warns every time.
+- **Its API, over the wiring network.** `plan` and `apply` check that Mediaplane's key
+  still opens qBittorrent's API, sent as a Bearer token. Behind the VPN they reach it
+  through Gluetun, which is on the stack's wiring network for it, at qBittorrent's own
+  port. Slice 3c manages its settings through that API.
 - **One port, inside and out.** qBittorrent checks the `Host` header, so the published
@@ -81,5 +87,5 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **After Gluetun restarts on its own, qBittorrent has no network.** It keeps the network
-  the old Gluetun had, until it restarts too. `mediaplane vpn-check` reports it; see
-  [Gluetun's README](../gluetun/README.md).
+- **After Gluetun restarts on its own, qBittorrent has no network** until it restarts
+  too. `mediaplane vpn-check` reports it, and `mediaplane apply` restarts qBittorrent;
+  see [Gluetun's README](../gluetun/README.md).
 - **`stack.yaml` reaches qBittorrent only at its first start.** Mediaplane never
```

**Change** `catalog/gluetun/README.md`:

```diff
diff --git a/catalog/gluetun/README.md b/catalog/gluetun/README.md
index 2867936..b99e2cb 100644
--- a/catalog/gluetun/README.md
+++ b/catalog/gluetun/README.md
@@ -108,6 +108,7 @@ Nothing for Gluetun itself. See the [roadmap](../../docs/plans/m1-roadmap.md).
   crash, it gets a new network, and qBittorrent keeps the old one, which has nothing but
-  loopback. Nothing leaks, but nothing downloads either. `mediaplane apply` doesn't
-  notice, because Compose restarts qBittorrent only when it recreates Gluetun, but
-  `mediaplane vpn-check` does. Restart qBittorrent after Gluetun:
-  `docker restart mediaplane-qbittorrent-1`.
+  loopback. Nothing leaks, but nothing downloads either. Compose restarts qBittorrent
+  only when it recreates Gluetun, so `mediaplane apply` does it: `plan` lists qBittorrent
+  as `restart` when it started before Gluetun last did, or when Gluetun is stopped and
+  `apply` will start it. `mediaplane vpn-check` reports it too. By hand, restart
+  qBittorrent after Gluetun: `docker restart mediaplane-qbittorrent-1`.
 - **A wrong key never connects.** Gluetun's health check needs a working tunnel. With a
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index 446519b..179f873 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -223,3 +223,3 @@ const stackShape = {
     .describe(
-      "The shared admin login for the apps' web UIs, set up in each app as its slice lands: qBittorrent in Slice 3a, Sonarr, Radarr and Prowlarr in Slice 3b, and Jellyfin in Slice 6.",
+      "The shared admin login for the apps' web UIs: qBittorrent, Sonarr, Radarr and Prowlarr use it, and Jellyfin will from Slice 6. Apply sets it in Sonarr, Radarr and Prowlarr through their API, and again whenever it changes.",
     ),
```

The description of `admin` changed, so regenerate the stack.yaml reference
(`docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`):

```bash
pnpm docs:generate
```

- [ ] **Step 6: The spec, and the roadmap**

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index e446b47..8e3ab32 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -541,4 +541,4 @@ in `compose.override.yaml` is therefore wired automatically.
 |---|---|
-| `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file |
-| `plan` | Show what `apply` would change, including drift. Makes no changes |
+| `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file (more in §11, Slice 3b) |
+| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (§11, Slice 3b) |
 | `apply` | Converge on `stack.yaml` (§5) |
@@ -755,3 +755,4 @@ full threat model goes in `docs/security/threat-model.md`.
    - Mediaplane refuses to act on resources outside the managed `mediaplane`
-     Compose project (its own `mediaplane-system` project is read-only to it).
+     Compose project (its own `mediaplane-system` project is read-only to it, but for
+     its own container's membership of the stack's wiring network: §11, Slice 3b).
      That is enforced in code.
@@ -1124 +1125,93 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   separated by commas without spaces, as Gluetun's `WIREGUARD_ADDRESSES` takes them.
+
+### Slice 3b: the wiring framework (2026-10-10)
+
+- **Mediaplane reaches the apps over a private wiring network** (§3.2, §7.2; the owner's
+  decision of 2026-10-10, [ADR 0011](../adr/0011-a-private-wiring-network.md)).
+  - `compose.yaml` declares a network `wiring` with `internal: true`. Every app whose API
+    Mediaplane calls joins it, beside its default network. An app in another app's
+    network namespace is reached through that app, which joins for it: Gluetun, for
+    qBittorrent, whose firewall counts the network as local.
+  - Mediaplane's container joins it during `plan` and `apply`, and stays, so it is on two
+    internal networks and has no route out. Apply steps off it before `up`, and back on
+    in the wire step. The runtime joins only its own container, and only to its
+    project's internal wiring network. That is the one change Mediaplane makes to
+    `mediaplane-system` (§7.2(2)). The socket proxy allows nothing new.
+  - Run from source, nothing joins: the host reaches the apps' addresses on the network.
+  - The apps are reached at their container's address there, with
+    `Host: <service>:<port>`, as the other apps reach them.
+- **An app's API is in the catalog** (§4.3): its port, a path that answers without the
+  key once the app is ready, its key and how a request carries it (`X-Api-Key`, or a
+  Bearer token for qBittorrent), and a path that answers only with the key. `plan` and
+  `apply` check that path for every app with an API, before its resources.
+- **The integration contract** (§3.2) is `catalog/<app>/integration.ts`: the apps it
+  comes `after`, and its resources. Each resource has a one-segment name, so its address
+  is `<app>.<resource>` and a field's is `<app>.<resource>.<field>`, as override keys are
+  (§4.2). It lists its managed fields and its secrets, and says how to read it from the
+  app, check its secrets, create it and update it. A resource may `require` others: one
+  that failed skips it (§5.1).
+- **The shared admin in Sonarr, Radarr and Prowlarr is a resource,** `<app>.admin`, not a
+  `bootstrap-api` step (§4.3, §6.1): its user name is a managed field, and its password a
+  secret, checked by signing in at `/login`. Apply sets it with the app's host settings
+  (`PUT /api/v3/config/host/1`, `/api/v1` for Prowlarr), sending the rest back as it
+  came; no restart is needed.
+- **Without a login for local addresses, the Servarr apps take only listed Host names**
+  (§6.1, §6.4). With `security.login_on_lan: false`, Mediaplane sets
+  `<APP>__SERVER__ALLOWEDHOSTS` to the app's service name and the addresses its web UI is
+  published on. The apps refuse to save their settings without it in that mode; it also
+  stops DNS rebinding. `localhost` and `127.0.0.1` always pass. A name of your own goes in
+  `apps.<app>.env`.
+- **`state/resources.json`** (§4.1, §6.3) is `mediaplane.resources/v1`: for each resource,
+  its id in the app (null for a singleton), its name, its managed fields as applied, the
+  names of its secrets, and when it was applied. It never holds a secret's value or hash:
+  secrets are checked by using them. It is written, 0600, after each resource that
+  changes.
+- **`plan` plans the wiring** (§5 step 5). For each app that is running, healthy and left
+  as it is, in order, it checks readiness and the key, then each resource: `create`,
+  `update` (naming what differs), `adopt` (the app holds it as wanted, but
+  `resources.json` doesn't say so: re-adoption by name, §6.3), or `unchanged`. A resource
+  of any other app is checked `after-start`. One Mediaplane couldn't ask is `unknown`,
+  with a warning, and makes the plan changed. `plan` waits up to 15 seconds for an app;
+  it changes nothing in the apps. In the image it joins the wiring network to ask them:
+  the one change `plan` makes, to Docker and not to the stack (the §5.2 row).
+- **The wire step** (§5 step 10) runs after `start`. It waits up to two minutes for each
+  app, checks its key, and makes each resource what the stack wants, in the order of
+  `after`. A resource that fails doesn't stop the others; one that requires it is
+  skipped, and the step fails (outcome `failed`: `partial` is not used yet).
+- **The typed HTTP client** (§3.2, §5.1) uses Node's `http` with an agent of its own, so a
+  proxy from the environment never sees a key. It tries again a refused connection, a
+  timeout, or a 502, 503 or 504, with exponential backoff and jitter, until the deadline;
+  a POST only when nothing reached the app. A 4xx or a 500 fails at once, with the app's
+  own message: Servarr's validation list, ASP.NET's problem details, or plain text, cut
+  to 200 characters, and never an `attemptedValue`. It reads at most 5 MiB of an answer,
+  and checks its shape with Zod, naming only the paths that don't fit. Every message has
+  each key and password replaced with `***`, before an answer is collapsed or cut, and
+  again after.
+- **The runtime** (§3.2) gains, as `compose run` and `inspect` were added before:
+  `docker network inspect`, `connect` and `disconnect` for Mediaplane's own container
+  and the wiring network, each container's address on that network (from
+  `docker container inspect`), and `compose stop`.
+- **An integration's ports** (§5) come from the resolver's container ports, after
+  `apps.<id>.port`, not from Compose's effective config: an override that changes a
+  wired app's port is not followed yet.
+- **Verify** (§5 step 11, §6.4, §7.2(6)) also runs vpn-check's checks, without the
+  address comparison, when qBittorrent is behind Gluetun.
+- **A stranded qBittorrent is restarted** (§6.4). `plan` lists it as `restart` when it
+  started before Gluetun last did, or when Gluetun is stopped and apply will start it:
+  Compose restarts it only when it recreates Gluetun. Apply stops it before `up`, which
+  starts it in Gluetun's new network.
+- **Change records** (§5 step 12) gain, within `mediaplane.change/v1`: the step `wire`,
+  each action's `resource`, the plan's `wiring`, and the container action `restart`.
+- **Housekeeping.**
+  - The secrets store refuses to save a key it couldn't read back, such as one an app
+    made with other characters, naming the key and never its value.
+  - Apply writes `generated/.env` only when it changed, as `plan` says.
+  - A hint that points to a runbook gives its address on GitHub, with the first thing to
+    do before it where that is plain: from the image there is no copy of the repo.
+  - `init` (§5.2) checks that it can create the home, or write into it, before its first
+    question. It creates the data folder when it can, as the user it runs as, and never
+    changes an owner or a mode; when it can't, its next steps give the `sudo` commands,
+    and in the image a folder outside the home is left to you. On a terminal, a line or
+    two before each question says what it is for, and with a VPN provider it takes the
+    WireGuard private key on a hidden prompt, checks its shape, and writes it to
+    `secrets/wg.key` (0600), never over an existing one.
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index 3e74302..352ea89 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -19,2 +19,3 @@ Detailed plans so far:
 - Slice 3d: [`m1-s3d-vpn-check.md`](m1-s3d-vpn-check.md) (done).
+- Slice 3b: [`m1-s3b-wiring.md`](m1-s3b-wiring.md) (done).
 
@@ -22,5 +23,5 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a and S3d.
-- **Next:** S3b.
-- **After that:** S3c, then S4 to S8.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d and S3b.
+- **Next:** S3c.
+- **After that:** S4 to S8.
 
@@ -129,5 +130,11 @@ each one, or corrects it in the catalog:
 | qBittorrent `WEBUI_PORT` behaviour inside Gluetun's namespace. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: with `apps.qbittorrent.port: 8090` and `bind: localhost`, the web UI answers on `127.0.0.1:8090`. It runs in CI from Slice 3d | S3d (done) |
-| The value format of Servarr `SERVER__TRUSTEDNETWORKS` (comma-separated CIDRs) | S3b |
+| The value format of Servarr `SERVER__TRUSTEDNETWORKS` (comma-separated CIDRs). Verified in S3b: see below | S3b (done) |
 | Seerr running as uid 1000 with `init: true`. **Verified on 2026-10-09** by `test/e2e/apply.e2e.test.ts` and `test/e2e/deploy.e2e.test.ts`: Seerr, rendered with `init: true`, runs healthy after apply's ownership step gives its appdata to uid 1000 | S2b (done) |
 
+Verified in S3b (2026-10-10):
+
+- **`SERVER__TRUSTEDNETWORKS`**: `test/e2e/apply.e2e.test.ts` gives two subnets through
+  `apps.sonarr.env`, and Sonarr's own settings show them back as the same
+  comma-separated list. It runs in CI from Slice 3b.
+
 ## Inputs for later slices from the reviews
@@ -141,4 +148,5 @@ four S8 items. Slice 3a (2026-10-10) added three S3 items, the S3d list, three
 S4 items, two S6 items, an S8 item and an M2 item. Slice 3d (2026-10-10) added the last
-S3 item, the unscheduled list and extended two S8 items. Each slice plan must address the
-items for that slice.
+S3 item, the unscheduled list and extended two S8 items. Slice 3b (2026-10-10) added the
+S3c list, two S4 items and one unscheduled item. Each slice plan must address the items
+for that slice.
 
@@ -223,3 +231,4 @@ items for that slice.
 **S3:** S3a handles the first five, except Mediaplane's network in TRUSTEDNETWORKS,
-which moved to M2. The rest are for S3b and S3c.
+which moved to M2. S3b handles the rest, except qBittorrent's settings and admin
+password, which are S3c's (and listed again below).
 
@@ -250,2 +259,5 @@ which moved to M2. The rest are for S3b and S3c.
   - S3b writes ADR 0011 on it.
+  - **Done in S3b:** as decided, with the end-to-end tests proving the login from source
+    and from the image behind the real proxy, Gluetun letting the wiring network reach
+    qBittorrent's port, and Mediaplane's container having no default route.
 - **qBittorrent's settings after its first start.** `admin.username`,
@@ -256,3 +268,4 @@ which moved to M2. The rest are for S3b and S3c.
   (S3b for Sonarr, Radarr and Prowlarr, S3c for qBittorrent). Today `credentials` shows
-  the new password while qBittorrent keeps the one from its first start.
+  the new password while qBittorrent keeps the one from its first start. **Done in S3b
+  for Sonarr, Radarr and Prowlarr:** the `<app>.admin` resource.
 - **Keys an app creates must fit the secrets store (S3b).** `state/secrets.json` takes
@@ -261,3 +274,5 @@ which moved to M2. The rest are for S3b and S3c.
   store, so its value must fit too, or the check must apply only to the keys Mediaplane
-  generates. Otherwise the next `plan` can't read the store.
+  generates. Otherwise the next `plan` can't read the store. **Done in S3b:** the rule
+  stays for every key, and the store refuses to save one it couldn't read back, naming
+  the key. Jellyfin's (S6) is 32 hex characters, which fits.
 - **qBittorrent stranded by a Gluetun started again on its own (S3b).** When Gluetun
@@ -268,3 +283,15 @@ which moved to M2. The rest are for S3b and S3c.
   VPN topology check (spec §6.4) catch it too, by reusing `vpnCheck` without the egress
-  check, and have `apply` restart qBittorrent then.
+  check, and have `apply` restart qBittorrent then. **Done in S3b:** `plan` lists such a
+  qBittorrent as `restart`, also when apply starts a stopped Gluetun (the owner's trial),
+  and verify runs vpn-check's checks without egress.
+
+**S3c:**
+
+- **qBittorrent through its API.** S3b reaches qBittorrent's API already, through Gluetun
+  on the wiring network, and checks its key. Add its integration: the categories, the
+  preferences, and `qbittorrent.admin`, whose password goes through `setPreferences`.
+- **Download clients need their category.** Sonarr's and Radarr's `download_client`
+  should `require` the qBittorrent category, so that a failed category skips it (S3b's
+  contract has `requires`).
+- **`after` for the arrs.** Sonarr and Radarr come after qBittorrent once they link to it.
 
@@ -312,2 +339,8 @@ which moved to M2. The rest are for S3b and S3c.
   yet. Add one, which reaches every app through its API.
+- **A wiring network whose settings change.** Compose must make it anew then, and
+  through the socket proxy it can't delete a network (S3b). The wiring failed runbook
+  gives the steps by hand. Decide whether Mediaplane should do them.
+- **The `partial` outcome.** Spec §5 step 12 names `success`, `partial` and `failed`.
+  Apply records `failed` when part of the wiring failed (S3b). Decide whether drift's
+  re-apply needs `partial`.
 
@@ -376,2 +409,6 @@ which moved to M2. The rest are for S3b and S3c.
 
+- **Restrict what the proxy lets Mediaplane create.** The wiring network keeps
+  Mediaplane's container offline, but the proxy still lets it create containers with any
+  network, so that is defence in depth, not a wall (ADR 0011).
+
 - **An IPv6 egress check.** `vpn-check` measures IPv4 only (S3d): its route target is
```

- [ ] **Step 7: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
node -e '
const fs = require("fs");
for (const f of process.argv.slice(1)) {
  let indent = -1;
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    const fence = /^(\s*)```(\S*)/.exec(l);
    if (fence) {
      indent = indent < 0 && fence[2] === "text" ? fence[1].length : -1;
      return;
    }
    if (indent >= 0 && [...l].length - indent > 40) console.log(`${f}:${i + 1}`);
  });
}' docs/architecture.md docs/security/threat-model.md docs/adr/0011-a-private-wiring-network.md docs/runbooks/wiring-failed.md deploy/README.md README.md
git grep -n -e '```mermaid' -- '*.md' ':!docs/plans' || true
git grep -n -E "Slice 3b creates|follow in Slice 3b|comingIn: 'Slice 3b'" \
  -- '*.md' 'catalog/*.ts' ':!docs/plans/m1-s*' ':!docs/design' || true
git add README.md deploy/README.md CONTRIBUTING.md catalog docs packages/engine/src/config/schema.ts
git commit -m "docs: ADR 0011, the wiring failed runbook, the threat model, architecture, READMEs, spec and roadmap" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `pnpm docs:generate` writes nothing, every check passes, and the width check
(every line of a `text` block, measured from its fence, within 40 columns) and both
`git grep`s print nothing (`git grep` exits 1 when it finds nothing, hence `|| true`):
no doc still says the admin login is to come in Slice 3b.

---

## Slice 3b completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements.
- [ ] `pnpm test:e2e` leaves no `mediaplane-e2e-*` container, network or image, no host
  helper, and no new volume or `mediaplane-e2e-*` folder (Task 9, Step 4).
- [ ] The socket proxy's allow-list is unchanged: `git diff 4125ce1 --
  deploy/mediaplane.compose.yaml` shows comment lines only, and in
  `deploy/deploy.test.ts` only the comment above the lists and three new calls in
  `ENGINE_CALLS` (with a comment line) changed, with `OVERRIDE_CALLS` as it was
  (decision 1). `4125ce1` is
  `origin/main` after S3d; the local `main` may be older (preflight M16).
- [ ] No secret shows: the tests that check it pass (the client's "never repeats a
  secret the app echoes", `resources.json`'s "no secret value", the wire step's "no
  secret", `init`'s key that never shows), and so does the apply e2e's check that
  `state/resources.json` holds no password.
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  outside the GitHub URLs (`https://github.com/cyclopsgd/Mediaplane/…`).
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B 4125ce1.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - that decision 18 (the host reaching an internal network's containers from source on
    Docker 28) is to be confirmed by the slice PR's first CI run, as are the e2e tests on
    Compose v2.38.2;
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 2 (`plan` joins the network), 3 (stepping off for `up`, and a network
    that can't be deleted through the proxy), 10 (the allowed hosts), 13 (`failed`, not
    `partial`) and 15 (`init`'s changes to spec §5.2);
  - for the owner's manual-steps list: with Mediaplane deployed, bring
    `mediaplane-system` down before `docker compose -p mediaplane down`, or the wiring
    network stays behind; and after updating to S3b, run `mediaplane apply` once, so the
    apps join the wiring network.
