# M1 Slice 4: indexers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apply` links Prowlarr to Sonarr and Radarr with full sync, so that an indexer
you add in Prowlarr reaches both arrs, and makes the stack's Cloudflare solver (Byparr,
or FlareSolverr when you choose it) Prowlarr's indexer proxy, tagged `cloudflare`, so
that Prowlarr fetches an indexer tagged so through it.

**Architecture:**

- **Prowlarr's integration** (`catalog/prowlarr/integration.ts`): three resources on
  S3b's contract after `prowlarr.admin`. `prowlarr.application_sonarr` and
  `prowlarr.application_radarr` are its links to the arrs, each checked with Prowlarr's
  own test and requiring its arr's admin. `prowlarr.indexer_proxy` is the solver, with
  the tag.
- **A shared Servarr provider** (`catalog/_shared/servarr-provider.ts`): how Mediaplane
  finds, makes from the app's template, updates and tests what a Servarr app keeps as a
  "provider". The arrs' download client moves onto it, its S3c tests unchanged.
- **FlareSolverr gets a health check,** so `up --wait` waits for it before Prowlarr tests
  the new proxy.
- **The fakes:** `fakeStackApis`' arrs refuse what the real ones do (the roadmap's S4
  item), and a fake Prowlarr joins them.
- **An end-to-end test** with a made-up Torznab indexer of its own, outside the stack,
  behind a stand-in Cloudflare challenge: through Byparr, then FlareSolverr.
- **No engine change.** The contract, `plan` and the wire step are S3c's.

**Tech Stack:** as Slice 3c (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image:
the made-up indexer runs on the busybox the end-to-end helpers already pin.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3 (success criterion 1: "Prowlarr syncs to Sonarr and Radarr, with Byparr as its
  proxy");
- §5.1 (dependent actions are skipped), §5.2 (`plan` changes nothing);
- §6.2 (the Prowlarr rows: the application with `syncLevel: fullSync`, its managed
  fields and `POST /applications/test`; the indexer proxy of type `FlareSolverr`, the
  tag `cloudflare`, its managed fields and `POST /indexerproxy/test`; the ordering;
  "Never touched: Indexers"; the tag that routes an indexer through the proxy);
- §6.3 (secrets verified, never compared; identity by id, else by name);
- §7.2(2) (the socket proxy), §8.1(2) and (3), §9 (the documentation set), §10 (Byparr's
  risks: "lightly tested on arm64 upstream", "FlareSolverr compatibility … End-to-end
  tests run a proxied request through it"), §11.

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S4 row ("Indexers added
in Prowlarr reach both arrs, and proxied requests work"), the S4 list in "Inputs for later
slices from the reviews" (the fakes of the arrs are kinder than the apps), and the S3c
final review's ruling to make those fakes stricter "when S4 extends these fakes".

The owner's decision of 2026-10-15, which Task 4 applies: the slices after S4 are
renumbered, with the media servers split and Jellyfin first. S5 Jellyfin, with the arrs'
links to it; S6 requests, with Seerr signing in through Jellyfin; S7 Plex (`plex-login`'s
PIN flow, the claim, the plex.tv helper, its libraries, the arrs' links to it, and the
nightly Plex CI); S8 drift; S9 release. That makes 14 slices in M1.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`), with one line of context. It
  is exact: save it to a file and run `git apply <file>` from the repo root, or make the
  same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact or a
  schema description says to run `pnpm docs:generate`, and names what it rewrites.
- Every block was applied in order to a fresh worktree at `9f060e6`, and each task's
  tests failed before its implementation and passed after it (see the completion
  checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a, 3d, 3b and 3c Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`, `m1-s3d-vpn-check.md`,
`m1-s3b-wiring.md`, `m1-s3c-download-path.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `'0'.repeat(32)`, `` `qbt_${'1'.repeat(28)}` `` or `fake-admin-password`. Addresses in
  tests and docs come from the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`,
  `203.0.113.0/24`), private ranges, or `fd00::/8`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps. Its one change to Docker is
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
  teardown never stops at the first failure;
- never prune images (`docker image prune`, `docker system prune`);
- temporary folders in unit tests come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing`;
- coverage thresholds are never lowered: `vitest.config.ts` keeps 90% lines, functions,
  branches and statements on `packages/engine/src`;
- the integration contract (S3b, S3c): `observe`, `create`, `update`, `requires`, `after`
  and `verify`; resource records hold names only; a resource that requires a failed or
  skipped one is `skipped`; a resource may `require` another app's only when that app
  comes before it through `after` (the catalog invariant test, `029f65d`);
- never push.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records,
  `state/resources.json`, logs, human or JSON output, command lines, container
  environments, `docker inspect` or the public CI log. This slice adds:
  - **Sonarr's and Radarr's keys go to Prowlarr,** in a request body: its links'
    settings. Prowlarr gives them back masked (`********`), and its test is sent the
    masked link, by its id. They are among the secrets every client redacts already
    (`knownSecrets` holds every key in the store).
  - The made-up indexer's key is `fake-indexer-key`, and no secret.
  - End-to-end failure messages show an app's refusal as its `propertyName:
    errorMessage` list only, never a raw body, with every stored key replaced
    (`servarrFailure`, S3c's, now shared).
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and
  `deploy/deploy.test.ts` don't change. Anything that would need a new Docker API call is
  a security-sensitive decision for the controller, not for an implementer.
- **The end-to-end test never touches a real tracker or indexer.** It serves made-up
  indexers of its own. It needs the internet for Byparr's health check and for
  Prowlarr's test of the new proxy (decision 6), as CI's runners have.
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. This slice adds no `docker`
  or Compose flag.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes a catalog fact or a schema description runs `pnpm docs:generate` first,
  and commits the generated files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it, in the numbering of 2026-10-15.
  - Short, plain sentences; lists rather than wide tables; no internal jargon (no
    "controller", "ruling" or decision numbers in public docs).
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid,
    because Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.
- **The renumbering** maps each forward reference by its meaning, never by a chained
  replacement: a Plex one that says Slice 5 says Slice 7, a Jellyfin one stays Slice 5, a
  requests one stays Slice 6, a drift one says Slice 8 (from 7), and a release one Slice 9
  (from 8). Merged plans (`docs/plans/m1-s1*` to `m1-s3*`) keep their numbers.

## Decisions taken in this plan

The spec, the roadmap and the reviews leave these open. Each is marked `Decision:` where
it is applied. The ones to look at first are marked **(check)**. Every fact about an app
below was checked on the pinned images (Prowlarr 2.6.5.5623, Sonarr 4.0.20, Radarr
6.4.4, qBittorrent 5.2.4, Byparr 3.0.4, FlareSolverr 3.5.2) on real Docker (29.8, Compose
5.5.1, aarch64) while writing this plan, unless it says otherwise.

1. **(check) Prowlarr's links to Sonarr and Radarr** (Task 2). `prowlarr.application_sonarr`
   and `prowlarr.application_radarr` are Prowlarr's applications (`/api/v1/applications`),
   named `Sonarr (Mediaplane)` and `Radarr (Mediaplane)` (spec §6.2: "Every resource
   Mediaplane creates is named … (Mediaplane)"). Each is wanted while its arr is in the
   stack and its key is stored.
   - Its managed fields are §6.2's: `prowlarrUrl`, `http://prowlarr:9696` (how the arr
     reaches Prowlarr back, by service and container port on the stack's network);
     `baseUrl`, `http://sonarr:8989` or `http://radarr:7878` (how Prowlarr reaches the
     arr); `syncLevel`, `fullSync`, which is a property of the application beside its
     settings; and `syncCategories` (decision 2).
   - §6.2 lists `apiKey` among the managed fields too. It is the link's secret instead,
     as qBittorrent's key is the download client's (S3c decision 3): Prowlarr gives it
     back masked (`********`), so it can't be compared, and `state/resources.json` never
     holds a secret (S3b). Decision 3 says how it is checked.
   - It is made from Prowlarr's own template (`GET /api/v1/applications/schema`, its
     `Sonarr` or `Radarr` entry, without its UI `presets`). Its other settings
     (`animeSyncCategories`, the sync options, a basic-auth login) keep Prowlarr's
     defaults, and stay the user's: an update PUTs back what Prowlarr gave, with the
     managed settings and the key set.
   - It is found by the id `resources.json` recorded, else by its name, among Prowlarr's
     applications of that implementation. Prowlarr refuses a second application of the
     same name (`Name: Should be unique`).
2. **(check) The categories it syncs are Prowlarr's own defaults** (Task 2). §6.2 manages
   `syncCategories` and gives no value. Prowlarr 2.6's templates give Sonarr TV and its
   subcategories (5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090), and Radarr Movies and
   its subcategories (2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090).
   Those are what the integration sets (`LINKED`). A field is a scalar (S3b's contract), so
   the list is kept as one sorted string, `5000,5010,…`, the form a Keep mine override
   (S8) will take. The e2e checks that each link holds exactly its template's list, so a
   Prowlarr bump that changes them shows. Sonarr's `animeSyncCategories` (5070) stays the
   template's, unmanaged.
3. **(check) A link's key is checked with Prowlarr's own test** (Task 2; §6.2's secret
   check, `POST /applications/test`). `verify` GETs the link as Prowlarr holds it (the key
   masked) and POSTs it, with its id, to `/api/v1/applications/test`. That test calls the
   arr's API with the key, then has the arr call Prowlarr back at `prowlarrUrl`. A wrong
   host gives `BaseUrl: Unable to complete application test, cannot connect to Sonarr.
   Resource temporarily unavailable (<host>:8989)`, a wrong `prowlarrUrl` gives
   `ProwlarrUrl: Prowlarr URL is invalid, Sonarr cannot connect to Prowlarr`, and a wrong
   key `ApiKey: API Key is invalid`. So:
   - a 2xx passes; a failure that names `ApiKey` means the key it holds isn't the arr's,
     and an update sets it. The e2e gives Sonarr's link a wrong key by hand, and `apply`
     sets it again, which pins the property's real name;
   - any other failure is Prowlarr's own words, thrown: `unknown` in `plan`, a failure in
     the wire step and in verify;
   - a new link is POSTed with `?forceSave=true`, and Prowlarr still tests it (a wrong
     key or host is refused with 400, as Sonarr's download client is: S3c's final review,
     M1), so a create fails while the arr is out of reach. An update is PUT with
     `?forceSave=true`, which Prowlarr saves untested (202);
   - **what a test leaves in the app**, probed on the pinned Prowlarr and Sonarr. A test
     by id that fails records the failure in Prowlarr's status of the link (a row in its
     `ApplicationStatus` table, at escalation 1, whose last failure each failing test
     moves on), as a test from Prowlarr's web UI does. A test that passes sets the
     escalation back to 0 and keeps the row. Sonarr's test of S3c's download client does
     the same, in `DownloadClientStatus`. Neither changes `GET /api/v1/health` or
     `/api/v3/health`. So a `plan` that finds a key refused records that in the app, the
     one thing it leaves there, as S3c's test leaves a post-import category. The app's
     own test is the only way to check a masked key, so the code doesn't change: the
     spec's §11 entries for Slices 3c and 4 and the threat model say so, and the
     roadmap's S8 list asks drift, which would run these tests on a schedule.
4. **(check) Each link `requires` its arr's admin** (Task 2; §5.1, §5.2). Found while
   writing this plan, on the real stack: with Sonarr stopped and `apply` about to start
   it, `plan` reached Prowlarr, ran its test of the link, and warned
   `Prowlarr … tested Sonarr (Mediaplane), and it failed: BaseUrl: … cannot connect to
   Sonarr`, with the link `unknown`. The link was fine; Sonarr was down.
   `requires: ['sonarr.admin']` uses S3c's rule: while a resource it requires is pending
   (here `after start`), `plan` checks only its fields, and the wire step skips it when
   the requirement failed. `sonarr.admin` is the first thing Mediaplane checks in Sonarr,
   after its key: it is pending while Sonarr isn't up, refuses its key, or has its admin
   yet to be set. Run again with the requirement, `plan` showed only Sonarr's `after
   start` resources, and the next `apply` checked the link and found it `unchanged`. The
   cost: a link is skipped when Sonarr's admin alone fails, which the next `apply`
   retries. Prowlarr comes `after: ['radarr', 'sonarr']` already, so S3c's catalog
   invariant holds. A unit test pins it both ways: no test of the link while Sonarr is to
   be started, one once Sonarr is up with its admin in place.
5. **(check) The indexer proxy** (Task 2; §6.2). `prowlarr.indexer_proxy` is an indexer
   proxy of type FlareSolverr (`/api/v1/indexerproxy`), which Byparr answers too (spec
   §10), wanted while the stack has a Cloudflare solver:
   - **host:** `http://byparr:8191/`, or `http://flaresolverr:8191/`: the solver's service
     and its `api` port. The trailing "/" is Prowlarr's own form, which it keeps as given;
   - **requestTimeout:** 60 seconds, Prowlarr's default, which it sends as the solver's
     `maxTimeout`;
   - **tags:** `cloudflare`. The proxy's tags are compared by label, sorted and
     comma-joined, so a tag added by hand shows as `cloudflare,other`, and an update puts
     back `cloudflare` alone (S8's Keep mine can keep it). Prowlarr sends an indexer
     through a proxy only when they share a tag (spec §6.2).
   - **One resource, not two.** §6.2 lists the tag among the proxy's managed fields.
     Create and update first POST `{ label: 'cloudflare' }` to `/api/v1/tag`, which gives
     back the tag Prowlarr has by that label, or makes it (201 with the same id; Prowlarr
     keeps labels lower-case). So a tag the user made first is reused, and none is ever
     doubled. `observe` reads `/api/v1/tag` to name the proxy's tag ids.
   - **Named `Cloudflare (Mediaplane)`, whichever solver runs.** `observe` has only the
     recorded id and a name, no `ctx`. A name that followed the solver (`Byparr
     (Mediaplane)`) couldn't be found after lost state once the stack moved to
     FlareSolverr, and its create would be refused as a duplicate name. With one name, a
     change of solver is an update of `host`, which the e2e makes, and re-adoption works
     for both. The name says what the proxy is for, beside the tag it carries.
6. **(check) Only Prowlarr checks the proxy, as it makes it** (Tasks 2, 3). The proxy
   holds no secret, so `verify` is never asked (§6.3: secrets are verified; S3b's
   contract asks `verify` only of a resource with secrets), and nothing runs §6.2's
   `POST /indexerproxy/test` after the create. Prowlarr runs that test itself when the
   proxy is created, `forceSave` or not, and the test has the solver fetch
   `https://prowlarr.servarr.com/v1/ping` (Byparr's log shows it). With a solver that
   can't reach that page, the create fails with
   `Host: Unable to connect to proxy: HTTP request failed: [502:BadGateway] …`. That was
   checked twice: with a Byparr on a network with no way out, and on a real stack whose
   Byparr had that name pointed at itself by a `compose.override.yaml`. The runbook's
   example is the second run. So the `apply` that makes the proxy needs the solver
   online, as Byparr's own health check already does: it loads `https://google.com`.
   `plan` never runs the test, so `plan` needs no internet. An update with `forceSave` isn't tested. Running
   the test in every `plan`, as a drift check, would fetch a third-party page through the
   solver each time: the roadmap's S8 list asks drift to decide.
7. **FlareSolverr gets a health check** (Task 2). The image has none, and the catalog
   said `health: 'none'`, so `up --wait` returned as soon as FlareSolverr ran. The wire
   step's create could then reach Prowlarr's test before FlareSolverr listened: it starts
   a browser first, for a few seconds. It now has
   `curl -fsS -o /dev/null http://127.0.0.1:8191/health` (its `/health` answers without
   browsing; the image has `curl`). A catalog test asks every Cloudflare solver for a
   health check. `scripts/docs/catalog-facts.test.ts` tests the `none` wording on a copy
   of FlareSolverr's definition instead.
8. **One way to wire a Servarr provider** (Task 2). The download client (S3c), the links
   and the proxy are all Servarr "providers", with the same list, `…/schema`, `…/{id}`
   and `…/test` endpoints and `forceSave` rules. `catalog/_shared/servarr-provider.ts`
   holds them once: `findProvider`, `createProvider`, `updateProvider`, `testProvider`,
   `settingOf` and `textOf`, with the `ProviderKind` and `Provider` types; the schema a
   provider is read with stays private to the file. The download client moves onto it,
   with its messages as they were, and its S3c tests pass untouched: they are the check of
   the move. The root folder isn't a provider, and stays as it is.
9. **The fakes refuse what the apps refuse** (Task 1; the roadmap's S4 item, and the S3c
   final review's "can wait" until S4 extends these fakes). In `fakeStackApis`:
   - Sonarr and Radarr refuse a root folder whose folder no `mkdir` made, with the arrs'
     own `Path: Path '<path>' does not exist`. The wire step makes the folder through the
     runtime, so `fakeStackApis` gains `mkdir(service, command)`, to be given the fake
     runtime's one-off commands. The CLI tests' runtime gives it them, so their `apply`s
     show the folder made before the root folder;
   - their test of a download client fails at a port qBittorrent doesn't listen on
     (`FakeAppState.port`, 8080), or with `useSsl`, with the arrs' own words:
     `Connection refused (<host>:<port>)`, and `The SSL connection could not be
     established, see inner exception.`;
   - they test a new, enabled client as they save it, with `forceSave` too, and save none
     that fails;
   - a fake Prowlarr (`testing/prowlarr.ts`) answers Prowlarr's applications, indexer
     proxies and tags as decisions 1 to 6 found them: each tested as it is made, untested
     on a `forceSave` update, a masked key kept, names unique, tags lower-case and given
     back by label. Its test of a link checks the arr's service and port, the arr's key
     (`FakeAppState.key`, any when empty, as qBittorrent's is), and `prowlarrUrl`. Its
     test of a proxy checks that the host is a solver at 8191.
10. **(check) The end-to-end test, and what it can prove without a third party** (Task
    3). A new `test/e2e/indexers.e2e.test.ts` runs from source a stack of Sonarr, Radarr,
    Prowlarr (Byparr comes with it), qBittorrent without the VPN, and Jellyfin.
    - **No real tracker or indexer.** It serves a made-up Torznab feed
      (`test/e2e/indexer.ts`): busybox httpd with a CGI script, on the busybox the e2e
      helpers pin, on a network of its own outside the stack. It is published on that
      network's gateway, which the stack's containers reach as they would a site on the
      internet, as S3d's echo server is. It knows two made-up, neutral items, a TV episode
      and a film.
    - **A stand-in Cloudflare challenge.** Its protected feed answers a client without a
      clearance cookie with Cloudflare's 503 (`Server: cloudflare`, "Just a moment..."),
      which Prowlarr's FlareSolverr proxy takes for a challenge. A browser, told apart by
      the header it sends when it opens a page (`Upgrade-Insecure-Requests: 1`, which
      Prowlarr never sends), gets the feed and a cookie. So Prowlarr asks the solver,
      whose browser fetches the page (Byparr's Firefox and FlareSolverr's Chrome both),
      then asks again with the solver's cookie and user agent. Nothing is solved: the test
      proves the proxied path, Prowlarr → solver → indexer → Prowlarr, not Byparr's
      solving, which needs Cloudflare itself. The feed is `application/xml`: sent as
      `application/rss+xml`, Byparr's browser never finished loading the page, and Byparr
      answered 408 after its minute.
    - **What it checks.** The first `apply` makes the links and the proxy. Prowlarr's own
      test of each link passes, and each link's categories are its template's. The proxy
      is FlareSolverr-typed at `http://byparr:8191/` with the `cloudflare` tag, and
      `state/resources.json` holds neither arr's key. An open
      indexer and a protected one, tagged `cloudflare`, added as a user would, both reach
      Sonarr and Radarr as `<name> (Prowlarr)`. A browser passed the protected feed's
      challenge (the feed's own log), and Prowlarr's search of it finds both items. A
      wrong key put in Sonarr's link by hand is set again (`updated apiKey`). The next
      `apply` has no changes. Then, with `flaresolverr: {}` added, `apply` updates only
      the proxy's host, Byparr goes, FlareSolverr runs healthy, a new protected indexer
      goes through FlareSolverr's browser, and a last `apply` has no changes.
    - **The internet it needs, which CI's runners have:** Byparr's health check (Google's
      home page, since S2b) and Prowlarr's test of the new proxy (Prowlarr's own ping
      service, decision 6). Neither is a tracker or an indexer, a user's stack needs both
      too, and neither could be faked without changing the images.
    - **From source only.** The links and the proxy add no Docker call, and the image's
      way to the apps (the wiring network, from the image behind the socket proxy) is
      S3b's, which the deploy and download tests prove on every run.
    - The apply e2e's lists of what is wired gain the three resources, which its
      lost-state re-adoption and its `login_on_lan: false` recreation now cover too.
    - **The helpers are shared, not copied.** S3c's `servarrFailure` (with its
      redaction of every secret it is given), `wired` and its `WireActions` shape, from
      `download.e2e.test.ts`, and `docker`, `publishedPort` and `removeOrIgnoreMissing`,
      from `wireguard.ts`, move unchanged into `test/e2e/helpers.ts`, and those files
      import them, as the new ones do. `stackFor` takes `{ seerr: false }`, for the
      video stack without Seerr. The indexers test's refusals go through
      `servarrFailure` with every key the store holds, as CI's log is public. Since the
      moves touch S3c's e2e files, Task 3 runs the whole e2e suite.
11. **A link stays when its arr leaves the stack** (Tasks 2, 4). With an arr gone from
    the stack, the link to it isn't wanted, and Mediaplane removes nothing it made, as
    S3c's download client stays when qBittorrent goes. Prowlarr then reports the link
    failing. So does the indexer proxy when the stack drops its Cloudflare solver, and
    indexers tagged `cloudflare` then fail. Spec §8.1(3) step 4 asks an app's links to
    go with it: the spec's §11 and the roadmap's S8 list carry both, and Prowlarr's README
    says how to delete the link by hand.
12. **No new Docker API call, and no proxy permission** (all tasks). The new calls are
    Prowlarr's API over the wiring network. `deploy/mediaplane.compose.yaml` and
    `deploy/deploy.test.ts` don't change.
13. **The docs, and the second renumbering** (Task 4; the owner's decision of
    2026-10-15). The §9 set for what Tasks 1 to 3 built:
    - the wiring-failed runbook: the proxy and the internet, Prowlarr's link failures,
      the skipped link, and a real example; the app-won't-start runbook: a Byparr that
      never becomes healthy without the internet;
    - the architecture: the indexers, with a diagram;
    - the threat model: Prowlarr holds the arrs' keys (an asset, T4, T5, T10), what a
      failing key test records in the app (decision 3), and the Cloudflare solver (a
      new T15);
    - the README: status, capabilities, flow, and the example's wiring lines from a real
      run of the same stack with this slice;
    - the Prowlarr, Byparr, FlareSolverr, Sonarr and Radarr READMEs, with how to tag an
      indexer `cloudflare` (spec §6.2: "`catalog/prowlarr/README.md` explains how");
    - CONTRIBUTING: the new test, and the internet it needs;
    - the spec: a "Slice 4" entry in §11, and a sentence in Slice 3c's (decision 3);
    - the roadmap: S4 done, four S8 items, and a note in S7's (decision 14).

    Then the renumbering: S5 Jellyfin, S6 requests, S7 Plex, S8 drift, S9 release, mapped
    by meaning (Global Constraints). The roadmap's 2026-10-11 note becomes a short
    history of both renumberings. The generated references are regenerated from
    `schema.ts`. Plex's `login.comingIn` moves to Slice 7, pinned by a new catalog test of
    every app's; Jellyfin's stays Slice 5, and Seerr's Slice 6.
14. **(check) Seerr's sign-in with the Plex token goes to S7** (Task 4). The owner's S6 is
    "requests, with Seerr signing in through Jellyfin", and S7 is Plex. Success criterion
    2 ("the Plex path is identical except that the user supplies a Plex token") needs
    Seerr connected to Plex, so the roadmap's S7 row takes Seerr's Plex sign-in and its
    link to Plex, with criterion 2, and S6 proves criterion 1. Seerr's and Plex's READMEs
    and ADR 0006 say so. Seerr's `login.comingIn` stays `Slice 6`, which is wrong on a
    Plex stack: the roadmap's S7 item on logins says so, to fix with it. The three lines
    that say until when Seerr's setup is open (Seerr's README, the threat model, the
    deploy guide) add "Slice 7 with Plex".

## File structure (new and changed in this slice)

`packages/engine/src/testing/`:

- `prowlarr.ts`, new: `fakeProwlarr` (applications, indexer proxies and tags, as
  Prowlarr 2.6 answers them) and `FakeProvider`.
- `wiring.ts` (+test): `FakeAppState.port`, `.folders`, `.applications`, `.proxies` and
  `.tags`; the arrs' test of a client (`testClient`), run on a new client too; a root
  folder that needs its folder; `fakeStackApis().mkdir`; Prowlarr's calls go to
  `fakeProwlarr`.
- `index.ts`: exports `prowlarr.ts`.

`catalog/`:

- `_shared/servarr-provider.ts`, new: `ProviderKind`, `Provider`, `findProvider`,
  `createProvider`, `updateProvider`, `testProvider`, `settingOf`, `textOf`.
- `_shared/servarr-download.ts`: the download client on the shared provider; its test
  file is changed for the stricter fakes only.
- `prowlarr/integration.ts` (+test, new): `prowlarr.application_sonarr`,
  `prowlarr.application_radarr`, `prowlarr.indexer_proxy`; `LINKED`, `PROXY_NAME`,
  `PROXY_TAG`.
- `flaresolverr/app.ts`: a health check. `plex/app.ts`: `login.comingIn` is Slice 7.
- `catalog.test.ts`: every Cloudflare solver has a health check; each login still to come
  names its slice.
- The generated facts in `prowlarr` and `flaresolverr`'s READMEs; the hand-written parts
  of the Prowlarr, Byparr, FlareSolverr, Sonarr, Radarr, qBittorrent, Plex and Seerr
  READMEs.

Elsewhere:

- `packages/cli/src/run.test.ts`: the fake runtime makes its folders in the fake apps.
- `packages/cli/src/init.ts`, `packages/engine/src/config/schema.ts`: renumbered words.
- `scripts/docs/catalog-facts.test.ts`: the `none` health wording, on a copy.
- `test/e2e/indexer.ts` and `test/e2e/indexers.e2e.test.ts`, new;
  `test/e2e/apply.e2e.test.ts` (its wiring lists); `test/e2e/helpers.ts`, which gains
  the helpers `download.e2e.test.ts` and `wireguard.ts` had, and `stackFor`'s option.
- docs: the wiring-failed and app-won't-start runbooks, the architecture, the threat
  model, the README, CONTRIBUTING, the deploy guide, ADRs 0006 and 0011, the spec, the
  roadmap, the generated references (`stack-yaml.md`, `stack.schema.json`), and a
  comment in `.github/workflows/ci.yml`.

**Tasks:**

1. The fakes: a fake Prowlarr, and fake arrs that refuse what the real ones do.
2. Prowlarr's links to Sonarr and Radarr, and its indexer proxy, on a shared Servarr
   provider.
3. End-to-end: indexers added in Prowlarr reach both arrs, through Byparr or
   FlareSolverr.
4. Docs, and the slices after S4 renumbered.

**Out of scope here:**

- **Indexers themselves.** Mediaplane never adds one (spec §6.2): only the e2e does, as
  a user would, with made-up ones.
- **Keep mine and drift** for the new resources, removing a link whose arr left the
  stack, and a drift check of the proxy: S8 (the roadmap's S8 list).
- **The image's run of the e2e:** the links add no Docker call (decision 10).
- **Solving a real Cloudflare challenge:** it needs Cloudflare (decision 10).

---

### Task 1: The fakes: a fake Prowlarr, and fake arrs that refuse what the real ones do

The unit tests of Tasks 2 and 3 run against `fakeStackApis`. Its Sonarr and Radarr are
kinder than the apps (the roadmap's S4 item), and it has no Prowlarr yet. This task makes
them refuse what the real arrs refuse, and adds a Prowlarr that answers as the pinned one
does.

Decision: the arrs refuse a root folder whose folder no `mkdir` made; `fakeStackApis`
gains `mkdir(service, command)`, which a test gives the fake runtime's one-off commands
(decision 9).
Decision: the arrs' test of a client fails at a port qBittorrent doesn't listen on
(`FakeAppState.port`), or with `useSsl`, and runs on a new, enabled client as it is
saved (decision 9).
Decision: `fakeProwlarr` answers applications, indexer proxies and tags as Prowlarr 2.6
does: tested as made, untested on a `forceSave` update, the key kept for a masked one,
names unique, tags lower-case and given back by label (decisions 1 to 6, 9).

**Files:**
- Create: `packages/engine/src/testing/prowlarr.ts`
- Modify: `packages/engine/src/testing/wiring.ts`, `packages/engine/src/testing/index.ts`
- Test: `packages/engine/src/testing/wiring.test.ts`,
  `catalog/_shared/servarr-download.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** S3c's `fakeStackApis`, `FakeAppState`, `freshAppState`,
  `FakeDownloadClient`; `OneOffCommand` from `packages/engine/src/runtime/types.ts`.
- **Produces:**
  - `FakeAppState.port: number` (qBittorrent's web UI port; 8080 fresh),
    `.folders: string[]`, `.applications: FakeProvider[]`, `.proxies: FakeProvider[]`,
    `.tags: { id: number; label: string }[]`;
  - `fakeStackApis()` also returns
    `mkdir: (service: string, command: OneOffCommand) => void`;
  - `interface FakeProvider { id: number; name: string; implementation: string; fields: { name: string; value?: unknown }[]; tags: number[]; syncLevel?: string }`
    and `fakeProwlarr(request, state, stateOf)`, exported from
    `@mediaplane/engine/testing`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/testing/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.test.ts b/packages/engine/src/testing/wiring.test.ts
index d9d8ea6..d602550 100644
--- a/packages/engine/src/testing/wiring.test.ts
+++ b/packages/engine/src/testing/wiring.test.ts
@@ -11,2 +11,3 @@ function send(
   body?: string,
+  method = body === undefined ? 'GET' : 'POST',
 ): Promise<{ status: number; body: string }> {
@@ -18,3 +19,3 @@ function send(
         path,
-        method: body === undefined ? 'GET' : 'POST',
+        method,
         headers: {
@@ -90 +91,244 @@ describe("fakeStackApis' qBittorrent", () => {
 });
+
+/** What a fake app answered `sent` as `host`, with a key: its status, and its JSON. */
+async function json(
+  port: number,
+  host: string,
+  path: string,
+  sent: unknown,
+  method = 'POST',
+): Promise<{ status: number; body: unknown }> {
+  const answer = await send(
+    port,
+    host,
+    path,
+    { 'x-api-key': '0'.repeat(32), 'content-type': 'application/json' },
+    JSON.stringify(sent),
+    method,
+  );
+  return {
+    status: answer.status,
+    body: answer.body === '' ? '' : (JSON.parse(answer.body) as unknown),
+  };
+}
+
+/** A qBittorrent client as Sonarr's template makes it, aimed at `host` and `port`. */
+function client(host: string, port: number, useSsl = false) {
+  return {
+    name: 'qBittorrent (Mediaplane)',
+    enable: true,
+    implementation: 'QBittorrent',
+    priority: 1,
+    fields: [
+      { name: 'host', value: host },
+      { name: 'port', value: port },
+      { name: 'useSsl', value: useSsl },
+      { name: 'apiKey', value: `qbt_${'0'.repeat(28)}` },
+      { name: 'tvCategory', value: 'tv' },
+    ],
+  };
+}
+
+/** Sonarr's refusal of a client it can't reach at qBittorrent, for `why`. */
+function unreachable(why: string) {
+  return {
+    status: 400,
+    body: [
+      {
+        propertyName: 'Host',
+        errorMessage: 'Unable to connect to qBittorrent',
+        detailedDescription: why,
+      },
+    ],
+  };
+}
+
+describe("fakeStackApis' Sonarr and Radarr", () => {
+  it('refuses a root folder whose folder was never made, as the arrs do', async () => {
+    const apis = await fakeStackApis();
+    const add = () =>
+      json(apis.app.port, 'sonarr:8989', '/api/v3/rootfolder', {
+        path: '/data/media/tv',
+      });
+    expect(await add()).toMatchObject({
+      status: 400,
+      body: [
+        { propertyName: 'Path', errorMessage: "Path '/data/media/tv' does not exist" },
+      ],
+    });
+    // The wire step's folder helper: mkdir, in a throwaway container of the arr.
+    apis.mkdir('sonarr', {
+      user: { uid: 1000, gid: 1000 },
+      entrypoint: 'mkdir',
+      args: ['-p', '--', '/data/media/tv'],
+      values: {},
+    });
+    expect((await add()).status).toBe(201);
+    expect(apis.apps.get('sonarr')?.rootFolders).toEqual([
+      { id: 1, path: '/data/media/tv' },
+    ]);
+  });
+
+  it('tests a new download client as it saves it, and keeps none that fails', async () => {
+    const apis = await fakeStackApis();
+    const save = (sent: unknown) =>
+      json(apis.app.port, 'sonarr:8989', '/api/v3/downloadclient?forceSave=true', sent);
+    expect(await save(client('gluetun', 8090))).toMatchObject(
+      unreachable('Connection refused (gluetun:8090)'),
+    );
+    expect(apis.apps.get('sonarr')?.downloadClients).toEqual([]);
+    expect((await save(client('gluetun', 8080))).status).toBe(201);
+    expect(apis.apps.get('sonarr')?.downloadClients).toHaveLength(1);
+  });
+
+  it("fails a client's test at a port qBittorrent doesn't listen on, or over TLS", async () => {
+    const apis = await fakeStackApis();
+    apis.apps.set('qbittorrent', { ...freshAppState(), port: 8090 });
+    const test = (sent: unknown) =>
+      json(apis.app.port, 'sonarr:8989', '/api/v3/downloadclient/test', sent);
+    expect(await test(client('qbittorrent', 8080))).toMatchObject(
+      unreachable('Connection refused (qbittorrent:8080)'),
+    );
+    expect(await test(client('qbittorrent', 8090, true))).toMatchObject(
+      unreachable('The SSL connection could not be established, see inner exception.'),
+    );
+    expect((await test(client('qbittorrent', 8090))).status).toBe(200);
+  });
+});
+
+const SONARR_KEY = '1'.repeat(32);
+
+/** A link to Sonarr as Prowlarr's template makes it, with these settings. */
+function link(values: { baseUrl?: string; apiKey?: string; prowlarrUrl?: string } = {}) {
+  return {
+    name: 'Sonarr (Mediaplane)',
+    implementation: 'Sonarr',
+    syncLevel: 'fullSync',
+    tags: [],
+    fields: [
+      { name: 'prowlarrUrl', value: values.prowlarrUrl ?? 'http://prowlarr:9696' },
+      { name: 'baseUrl', value: values.baseUrl ?? 'http://sonarr:8989' },
+      { name: 'apiKey', value: values.apiKey ?? SONARR_KEY },
+      { name: 'syncCategories', value: [5000] },
+    ],
+  };
+}
+
+describe("fakeStackApis' Prowlarr", () => {
+  it('tests a link to Sonarr as it saves it: Prowlarr reaches Sonarr with its key, and Sonarr Prowlarr', async () => {
+    const apis = await fakeStackApis();
+    apis.apps.set('sonarr', { ...freshAppState(), key: SONARR_KEY });
+    const save = (sent: unknown) =>
+      json(apis.app.port, 'prowlarr:9696', '/api/v1/applications?forceSave=true', sent);
+    const refused = (property: string, message: string) => ({
+      status: 400,
+      body: [{ propertyName: property, errorMessage: message }],
+    });
+    expect(await save(link({ baseUrl: 'http://nowhere:8989' }))).toMatchObject(
+      refused(
+        'BaseUrl',
+        'Unable to complete application test, cannot connect to Sonarr. Resource temporarily unavailable (nowhere:8989)',
+      ),
+    );
+    expect(await save(link({ apiKey: '9'.repeat(32) }))).toMatchObject(
+      refused('ApiKey', 'API Key is invalid'),
+    );
+    expect(await save(link({ prowlarrUrl: 'http://localhost:9696' }))).toMatchObject(
+      refused(
+        'ProwlarrUrl',
+        'Prowlarr URL is invalid, Sonarr cannot connect to Prowlarr',
+      ),
+    );
+    expect(apis.apps.get('prowlarr')?.applications).toEqual([]);
+    expect(await save(link())).toMatchObject({ status: 201, body: { id: 1 } });
+    expect(await save(link())).toMatchObject(refused('Name', 'Should be unique'));
+    // Read back with its key masked, and tested as it is held: by its id, the key masked.
+    const held = await send(apis.app.port, 'prowlarr:9696', '/api/v1/applications/1', {
+      'x-api-key': '0'.repeat(32),
+    });
+    expect(held.body).not.toContain(SONARR_KEY);
+    const tested = await json(
+      apis.app.port,
+      'prowlarr:9696',
+      '/api/v1/applications/test',
+      JSON.parse(held.body),
+    );
+    expect(tested.status).toBe(200);
+  });
+
+  it('saves an update with forceSave untested, keeping the key it holds for a masked one', async () => {
+    const apis = await fakeStackApis();
+    await json(
+      apis.app.port,
+      'prowlarr:9696',
+      '/api/v1/applications?forceSave=true',
+      link(),
+    );
+    const update = (sent: unknown) =>
+      json(
+        apis.app.port,
+        'prowlarr:9696',
+        '/api/v1/applications/1?forceSave=true',
+        sent,
+        'PUT',
+      );
+    expect(
+      await update({
+        ...link({ baseUrl: 'http://nowhere:8989', apiKey: '********' }),
+        id: 1,
+      }),
+    ).toMatchObject({ status: 202 });
+    const [held] = apis.apps.get('prowlarr')?.applications ?? [];
+    expect(held?.fields).toEqual(
+      expect.arrayContaining([
+        { name: 'baseUrl', value: 'http://nowhere:8989' },
+        { name: 'apiKey', value: SONARR_KEY },
+      ]),
+    );
+  });
+
+  it('tests an indexer proxy as it saves it: Prowlarr must reach a Cloudflare solver', async () => {
+    const apis = await fakeStackApis();
+    const proxy = (host: string) => ({
+      name: 'Cloudflare (Mediaplane)',
+      implementation: 'FlareSolverr',
+      tags: [1],
+      fields: [
+        { name: 'host', value: host },
+        { name: 'requestTimeout', value: 60 },
+      ],
+    });
+    const save = (sent: unknown) =>
+      json(apis.app.port, 'prowlarr:9696', '/api/v1/indexerproxy?forceSave=true', sent);
+    expect(await save(proxy('http://nowhere:8191/'))).toMatchObject({
+      status: 400,
+      body: [
+        {
+          propertyName: 'Host',
+          errorMessage:
+            'Unable to connect to proxy: Resource temporarily unavailable (nowhere:8191). Check the log surrounding this error for details',
+        },
+      ],
+    });
+    expect((await save(proxy('http://byparr:8191/'))).status).toBe(201);
+    expect(apis.apps.get('prowlarr')?.proxies).toMatchObject([
+      { id: 1, name: 'Cloudflare (Mediaplane)', tags: [1] },
+    ]);
+  });
+
+  it('keeps a tag lower-case, and gives back the one it has by that label', async () => {
+    const apis = await fakeStackApis();
+    const tag = (label: string) =>
+      json(apis.app.port, 'prowlarr:9696', '/api/v1/tag', { label });
+    expect(await tag('Cloudflare')).toEqual({
+      status: 201,
+      body: { id: 1, label: 'cloudflare' },
+    });
+    expect(await tag('cloudflare')).toEqual({
+      status: 201,
+      body: { id: 1, label: 'cloudflare' },
+    });
+    expect(await tag('not a label')).toMatchObject({ status: 400 });
+    expect(apis.apps.get('prowlarr')?.tags).toEqual([{ id: 1, label: 'cloudflare' }]);
+  });
+});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/testing/wiring.test.ts`
Expected: FAIL, 7 of 9: Sonarr answers 201 (a root folder with no folder made, and a
client aimed at a closed port) and 200 (a client's test at a closed port) where 400 is
expected, and Prowlarr answers 404 to all four of its tests. The two qBittorrent tests
pass.

- [ ] **Step 3: Write the fakes**

**Create** `packages/engine/src/testing/prowlarr.ts`:

```ts
import type { FakeReply, FakeRequest } from './http';
import type { FakeAppState } from './wiring';

/**
 * One of Prowlarr's providers, as it keeps one: a link to Sonarr or Radarr (an
 * application) or an indexer proxy, with its secrets in clear.
 */
export interface FakeProvider {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
  /** Its tags, by id. */
  tags: number[];
  /** An application's: "fullSync", "addOnly" or "disabled". */
  syncLevel?: string;
}

/** Where the fake apps listen in their containers: what Prowlarr's links must name. */
const PORTS: Readonly<Record<string, number>> = {
  prowlarr: 9696,
  radarr: 7878,
  sonarr: 8989,
};

/** The Cloudflare solvers' services, and the port their API is on. */
const SOLVERS = ['byparr', 'flaresolverr'];
const SOLVER_PORT = 8191;

/**
 * Prowlarr's templates for a link to Sonarr and to Radarr, as `…/schema` gives them, with
 * Prowlarr 2.6's own categories, and one Mediaplane skips.
 */
function applicationTemplates(): (Omit<FakeProvider, 'id'> & { presets: unknown[] })[] {
  const template = (
    implementation: string,
    port: number,
    categories: number[],
    more: FakeProvider['fields'] = [],
  ) => ({
    name: '',
    implementation,
    syncLevel: 'fullSync',
    tags: [],
    presets: [],
    fields: [
      { name: 'prowlarrUrl', value: 'http://localhost:9696' },
      { name: 'baseUrl', value: `http://localhost:${String(port)}` },
      { name: 'apiKey' },
      { name: 'authUsername' },
      { name: 'authPassword' },
      { name: 'syncCategories', value: categories },
      ...more,
    ],
  });
  return [
    template('Lidarr', 8686, [3000, 3010, 3030, 3040, 3050, 3060]),
    template(
      'Radarr',
      7878,
      [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090],
    ),
    template(
      'Sonarr',
      8989,
      [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
      [{ name: 'animeSyncCategories', value: [5070] }],
    ),
  ];
}

/** Prowlarr's templates for an indexer proxy: FlareSolverr's, and one Mediaplane skips. */
function proxyTemplates(): (Omit<FakeProvider, 'id'> & { presets: unknown[] })[] {
  return [
    {
      name: '',
      implementation: 'FlareSolverr',
      tags: [],
      presets: [],
      fields: [
        { name: 'host', value: 'http://localhost:8191/' },
        { name: 'requestTimeout', value: 60 },
      ],
    },
    {
      name: '',
      implementation: 'Http',
      tags: [],
      presets: [],
      fields: [{ name: 'host' }, { name: 'port', value: 0 }],
    },
  ];
}

/** A provider as Prowlarr shows it: its key masked. */
function masked(held: FakeProvider): FakeProvider {
  return {
    ...held,
    fields: held.fields.map((f) =>
      f.name === 'apiKey' && f.value !== undefined ? { ...f, value: '********' } : f,
    ),
  };
}

/** A refusal of Prowlarr's own test, as its validation list says it. */
function refused(property: string, message: string): FakeReply & { status: 400 } {
  return {
    status: 400,
    body: [{ propertyName: property, errorMessage: message, isWarning: false }],
  };
}

/** "host:port" of a URL a test is given, as Prowlarr's messages name it. */
function hostOf(url: unknown): { host: string; port: number; at: string } {
  const parsed = /^https?:\/\/([^:/]+):(\d+)\/?$/.exec(String(url));
  const host = parsed?.[1] ?? '';
  const port = Number(parsed?.[2] ?? 0);
  return { host, port, at: `${host}:${String(port)}` };
}

/**
 * Prowlarr's test of a link to Sonarr or Radarr, `sent` holding `key` in clear: its
 * refusal, or undefined when it passes. As Prowlarr's does, it reaches the arr at
 * `baseUrl`, by its service and port, with `key`, which must be the arr's `key` when that
 * is set; and the arr reaches Prowlarr back at `prowlarrUrl`.
 */
function testApplication(
  sent: Pick<FakeProvider, 'implementation' | 'fields'>,
  key: unknown,
  stateOf: (service: string) => FakeAppState,
): (FakeReply & { status: 400 }) | undefined {
  const value = (name: string) => sent.fields.find((f) => f.name === name)?.value;
  const arr = sent.implementation.toLowerCase();
  const base = hostOf(value('baseUrl'));
  if (base.host !== arr || base.port !== PORTS[arr]) {
    const why =
      base.host === arr ? 'Connection refused' : 'Resource temporarily unavailable';
    return refused(
      'BaseUrl',
      `Unable to complete application test, cannot connect to ${sent.implementation}. ${why} (${base.at})`,
    );
  }
  const expected = stateOf(arr).key;
  if (typeof key !== 'string' || key === '' || (expected !== '' && key !== expected)) {
    return refused('ApiKey', 'API Key is invalid');
  }
  const back = hostOf(value('prowlarrUrl'));
  if (back.host !== 'prowlarr' || back.port !== PORTS.prowlarr) {
    return refused(
      'ProwlarrUrl',
      `Prowlarr URL is invalid, ${sent.implementation} cannot connect to Prowlarr`,
    );
  }
  return undefined;
}

/**
 * Prowlarr's test of an indexer proxy: undefined when its host is a Cloudflare solver of
 * the stack, at its API's port, as Prowlarr reaches one; otherwise its refusal.
 */
function testProxy(
  sent: Pick<FakeProvider, 'fields'>,
): (FakeReply & { status: 400 }) | undefined {
  const host = hostOf(sent.fields.find((f) => f.name === 'host')?.value);
  return SOLVERS.includes(host.host) && host.port === SOLVER_PORT
    ? undefined
    : refused(
        'Host',
        `Unable to connect to proxy: Resource temporarily unavailable (${host.at}). Check the log surrounding this error for details`,
      );
}

/**
 * One kind of Prowlarr's providers at `path`, kept in `held`: listed, read and updated by
 * id (an update with forceSave isn't tested), made from `templates` (tested as it is
 * saved, with forceSave too, and refused under a name already taken), and tested by
 * `test`, with a masked key standing for the one held.
 */
function fakeProviders(
  request: FakeRequest,
  path: string,
  held: FakeProvider[],
  templates: () => unknown[],
  test: (sent: FakeProvider, key: unknown) => (FakeReply & { status: 400 }) | undefined,
): FakeReply | undefined {
  const { method } = request;
  if (request.path === `${path}/schema`) return { status: 200, body: templates() };
  if (request.path === path && method === 'GET') {
    return { status: 200, body: held.map(masked) };
  }
  const keyOf = (sent: FakeProvider) => {
    const key = sent.fields.find((f) => f.name === 'apiKey')?.value;
    const stored = held
      .find((p) => p.id === sent.id)
      ?.fields.find((f) => f.name === 'apiKey')?.value;
    return key === '********' ? stored : key;
  };
  const one = new RegExp(`^${path}/(\\d+)(\\?forceSave=true)?$`).exec(request.path);
  const found = held.find((p) => p.id === Number(one?.[1]));
  if (one !== null && method === 'GET') {
    return found === undefined ? { status: 404 } : { status: 200, body: masked(found) };
  }
  if (request.path === `${path}?forceSave=true` && method === 'POST') {
    const sent = { tags: [], ...JSON.parse(request.body) } as FakeProvider;
    if (held.some((p) => p.name === sent.name)) {
      return {
        status: 400,
        body: [{ propertyName: 'Name', errorMessage: 'Should be unique' }],
      };
    }
    const failed = test(sent, keyOf(sent));
    if (failed !== undefined) return failed;
    const made = { ...sent, id: held.length + 1 };
    held.push(made);
    return { status: 201, body: masked(made) };
  }
  if (one?.[2] !== undefined && method === 'PUT' && found !== undefined) {
    const sent = JSON.parse(request.body) as FakeProvider;
    const key = found.fields.find((f) => f.name === 'apiKey')?.value;
    Object.assign(found, {
      ...sent,
      fields: sent.fields.map((f) =>
        f.name === 'apiKey' && f.value === '********' ? { ...f, value: key } : f,
      ),
    });
    return { status: 202, body: masked(found) };
  }
  if (request.path === `${path}/test` && method === 'POST') {
    const sent = JSON.parse(request.body) as FakeProvider;
    return test(sent, keyOf(sent)) ?? { status: 200, body: {} };
  }
  return undefined;
}

/**
 * Prowlarr's links to Sonarr and Radarr, its indexer proxies and its tags, as
 * fakeStackApis answers them, as Prowlarr 2.6 does. A tag's label is kept lower-case,
 * and asking for one it has gives that one back.
 */
export function fakeProwlarr(
  request: FakeRequest,
  state: FakeAppState,
  stateOf: (service: string) => FakeAppState,
): FakeReply | undefined {
  const answered =
    fakeProviders(
      request,
      '/api/v1/applications',
      state.applications,
      applicationTemplates,
      (sent, key) => testApplication(sent, key, stateOf),
    ) ??
    fakeProviders(
      request,
      '/api/v1/indexerproxy',
      state.proxies,
      proxyTemplates,
      testProxy,
    );
  if (answered !== undefined) return answered;
  if (request.path === '/api/v1/tag' && request.method === 'GET') {
    return { status: 200, body: state.tags };
  }
  if (request.path === '/api/v1/tag' && request.method === 'POST') {
    const label = (JSON.parse(request.body) as { label: string }).label.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(label)) {
      return refused('Label', 'Allowed characters a-z, 0-9 and -');
    }
    const known = state.tags.find((t) => t.label === label);
    if (known !== undefined) return { status: 201, body: known };
    const made = { id: state.tags.length + 1, label };
    state.tags.push(made);
    return { status: 201, body: made };
  }
  return undefined;
}
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index cab0459..08bb07a 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -6,2 +6,3 @@ import type { ResourceSpec } from '../integrations/types';
 import { resolveStack, type ResolvedStack } from '../resolver/resolve';
+import type { OneOffCommand } from '../runtime/types';
 import { fakeContainer } from './fakes';
@@ -9,2 +10,3 @@ import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixt
 import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';
+import { fakeProwlarr, type FakeProvider } from './prowlarr';
 
@@ -100,4 +102,9 @@ export interface FakeAppState {
   categories: Record<string, string>;
-  /** qBittorrent's API key: the only Bearer token it takes, or any when empty. */
+  /**
+   * Its API key, or any when empty: qBittorrent takes only this one, as a Bearer token,
+   * and Prowlarr's test of its link to Sonarr or Radarr passes only with the arr's.
+   */
   key: string;
+  /** qBittorrent's web UI port: an arr's test of a client aimed at another fails. */
+  port: number;
   /**
@@ -111,2 +118,8 @@ export interface FakeAppState {
   rootFolders: { id: number; path: string }[];
+  /**
+   * The folders in Sonarr's or Radarr's container, as `mkdir` made them (fakeStackApis'
+   * `mkdir`): the arr refuses a root folder anywhere else, as it refuses one whose folder
+   * doesn't exist.
+   */
+  folders: string[];
   /**
@@ -117,2 +130,8 @@ export interface FakeAppState {
   testFailure: string;
+  /** Prowlarr's links to Sonarr and Radarr (its applications), their keys in clear. */
+  applications: FakeProvider[];
+  /** Prowlarr's indexer proxies. */
+  proxies: FakeProvider[];
+  /** Prowlarr's tags. */
+  tags: { id: number; label: string }[];
 }
@@ -143,2 +162,3 @@ export function freshAppState(): FakeAppState {
     key: '',
+    port: 8080,
     signInFailures: 0,
@@ -146,3 +166,7 @@ export function freshAppState(): FakeAppState {
     rootFolders: [],
+    folders: [],
     testFailure: '',
+    applications: [],
+    proxies: [],
+    tags: [],
   };
@@ -184,7 +208,64 @@ function masked(held: FakeDownloadClient): FakeDownloadClient {
 
+/** A refusal of the arr's own test, as its validation list says it. */
+function refusedTest(
+  property: string,
+  message: string,
+  details?: string,
+): FakeReply & { status: 400 } {
+  return {
+    status: 400,
+    body: [
+      {
+        propertyName: property,
+        errorMessage: message,
+        ...(details === undefined ? {} : { detailedDescription: details }),
+        isWarning: false,
+      },
+    ],
+  };
+}
+
+/**
+ * Sonarr's or Radarr's test of the download client `sent`, holding `key` in clear: its
+ * refusal, or undefined when it passes. It passes when the client reaches qBittorrent as
+ * Sonarr's does: by its service (gluetun or qbittorrent), at its web UI port, without
+ * TLS, which qBittorrent doesn't serve, with its key. A `testFailure` set on the app
+ * overrides every check: the test then fails with it, whatever the client.
+ */
+function testClient(
+  sent: Pick<FakeDownloadClient, 'fields'>,
+  key: unknown,
+  state: FakeAppState,
+  qbittorrent: FakeAppState,
+): (FakeReply & { status: 400 }) | undefined {
+  const value = (name: string) => sent.fields.find((f) => f.name === name)?.value;
+  const at = `${String(value('host'))}:${String(value('port'))}`;
+  const unreachable = (details: string) =>
+    refusedTest('Host', 'Unable to connect to qBittorrent', details);
+  if (state.testFailure !== '') return refusedTest('Host', state.testFailure);
+  const host = value('host');
+  if (host !== 'gluetun' && host !== 'qbittorrent') {
+    return unreachable(`Name does not resolve (${at})`);
+  }
+  if (value('port') !== qbittorrent.port) {
+    return unreachable(`Connection refused (${at})`);
+  }
+  if (value('useSsl') === true) {
+    return unreachable(
+      'The SSL connection could not be established, see inner exception.',
+    );
+  }
+  const right =
+    typeof key === 'string' &&
+    key !== '' &&
+    (qbittorrent.key === '' || key === qbittorrent.key);
+  return right
+    ? undefined
+    : refusedTest('ApiKey', 'Authentication Failure', 'Please verify your credentials.');
+}
+
 /**
- * Sonarr's and Radarr's download clients and root folders, as fakeStackApis answers them.
- * A client's test passes when it names qBittorrent's service (gluetun or qbittorrent)
- * and holds qBittorrent's key; otherwise it fails as Sonarr's does. A `testFailure` set
- * on the app overrides both checks: the test then fails with it, whatever the client.
+ * Sonarr's and Radarr's download clients and root folders, as fakeStackApis answers them,
+ * as strictly as the arrs: a new client is tested as it is saved (`testClient`), unless
+ * it is off; an update with forceSave is not; and a root folder needs its folder made.
  */
@@ -216,2 +297,6 @@ function fakeServarrDownloads(
     }
+    // forceSave skips only the test's warnings: a client that fails it isn't saved.
+    const key = sent.fields.find((f) => f.name === 'apiKey')?.value;
+    const refused = sent.enable ? testClient(sent, key, state, qbittorrent) : undefined;
+    if (refused !== undefined) return refused;
     const made = { ...sent, id: state.downloadClients.length + 1 };
@@ -239,41 +324,3 @@ function fakeServarrDownloads(
     const key = value('apiKey') === '********' ? stored : value('apiKey');
-    const host = value('host');
-    if (state.testFailure !== '') {
-      return {
-        status: 400,
-        body: [
-          { propertyName: 'Host', errorMessage: state.testFailure, isWarning: false },
-        ],
-      };
-    }
-    if (host !== 'gluetun' && host !== 'qbittorrent') {
-      return {
-        status: 400,
-        body: [
-          {
-            propertyName: 'Host',
-            errorMessage: 'Unable to connect to qBittorrent',
-            detailedDescription: `Name does not resolve (${String(host)}:${String(value('port'))})`,
-            isWarning: false,
-          },
-        ],
-      };
-    }
-    const right =
-      typeof key === 'string' &&
-      key !== '' &&
-      (qbittorrent.key === '' || key === qbittorrent.key);
-    return right
-      ? { status: 200, body: {} }
-      : {
-          status: 400,
-          body: [
-            {
-              propertyName: 'ApiKey',
-              errorMessage: 'Authentication Failure',
-              detailedDescription: 'Please verify your credentials.',
-              isWarning: false,
-            },
-          ],
-        };
+    return testClient(sent, key, state, qbittorrent) ?? { status: 200, body: {} };
   }
@@ -288,2 +335,14 @@ function fakeServarrDownloads(
     const { path: wanted } = JSON.parse(request.body) as { path: string };
+    if (!state.folders.includes(wanted.replace(/\/+$/, ''))) {
+      return {
+        status: 400,
+        body: [
+          {
+            propertyName: 'Path',
+            errorMessage: `Path '${wanted}' does not exist`,
+            attemptedValue: wanted,
+          },
+        ],
+      };
+    }
     if (state.rootFolders.some((f) => f.path === wanted)) {
@@ -304,4 +363,5 @@ function fakeServarrDownloads(
  * of 127.0.0.1: told apart by their Host header ("sonarr:8989", "gluetun:8080"). Sonarr,
- * Radarr and Prowlarr have /ping, system/status, config/host and /login, and the arrs
- * their download clients and root folders; qBittorrent has /, app/version, its sign-in
+ * Radarr and Prowlarr have /ping, system/status, config/host and /login, the arrs their
+ * download clients and root folders, and Prowlarr its links to them, its indexer proxies
+ * and its tags (fakeProwlarr); qBittorrent has /, app/version, its sign-in
  * (with its ban), preferences and categories, answered as qBittorrent 5.2 answers them,
@@ -309,3 +369,4 @@ function fakeServarrDownloads(
  * qBittorrent takes only a Bearer token (X-Api-Key gets a 403): its `key` when that is
- * set. `seams` send every app's calls there.
+ * set. `seams` send every app's calls there. `mkdir` is what the wire step's folder
+ * helper does to them: pass it what a fake runtime's `run` is given.
  */
@@ -316,2 +377,4 @@ export async function fakeStackApis(): Promise<{
   addresses: Record<string, string>;
+  /** A `mkdir -p -- <folders>` one-off command of `service` makes them in its container. */
+  mkdir: (service: string, command: OneOffCommand) => void;
 }> {
@@ -358,7 +421,7 @@ export async function fakeStackApis(): Promise<{
     }
-    return (
-      fakeServarrDownloads(request, service, state, stateOf('qbittorrent')) ?? {
-        status: 404,
-      }
-    );
+    const answered =
+      service === 'prowlarr'
+        ? fakeProwlarr(request, state, stateOf)
+        : fakeServarrDownloads(request, service, state, stateOf('qbittorrent'));
+    return answered ?? { status: 404 };
   });
@@ -372,2 +435,7 @@ export async function fakeStackApis(): Promise<{
     addresses: onWiring(['gluetun', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']),
+    mkdir: (service, command) => {
+      if (command.entrypoint !== 'mkdir') return;
+      const folders = command.args.slice(command.args.indexOf('--') + 1);
+      stateOf(service).folders.push(...folders.map((f) => f.replace(/\/+$/, '')));
+    },
   };
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 3b0e6ac..3dd0ba1 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -4,2 +4,3 @@ export * from './fakes';
 export * from './http';
+export * from './prowlarr';
 export * from './schema';
```

- [ ] **Step 4: Run them to see them pass, and the tests that relied on the kind fakes fail**

Run: `pnpm vitest run packages/engine/src/testing/wiring.test.ts`
Expected: PASS (9 tests).

Run: `pnpm vitest run catalog packages/cli`
Expected: FAIL, 14 tests, all leaning on the old kindness:
- `catalog/_shared/servarr-download.test.ts`: "says the app's own words when its test
  fails for another reason" (the client aimed at `nohost` is now refused as it is made)
  and "needs its folder made first, and is known by its path"
  (`Path '/data/media/tv' does not exist`);
- `packages/cli/src/run.test.ts`: the 12 tests whose `apply` adds Sonarr's root folder,
  which the fake Sonarr now refuses, since nothing gives it the folder helper's `mkdir`.

- [ ] **Step 5: Give the tests what the apps need**

**Change** `catalog/_shared/servarr-download.test.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.test.ts b/catalog/_shared/servarr-download.test.ts
index 043077a..e8dba07 100644
--- a/catalog/_shared/servarr-download.test.ts
+++ b/catalog/_shared/servarr-download.test.ts
@@ -202,8 +202,11 @@ describe('servarrDownloadClient', () => {
   it("says the app's own words when its test fails for another reason", async () => {
-    const { api } = await sonarr();
+    const { api, state } = await sonarr();
     const desired = wanted();
-    await client.create(api, {
-      ...desired,
-      fields: { ...desired.fields, host: 'nohost' },
-    });
+    await client.create(api, desired);
+    // Aimed elsewhere by hand: the app tests a new client as it saves it.
+    const [held] = state.downloadClients;
+    if (held === undefined) throw new Error('no client made');
+    held.fields = held.fields.map((f) =>
+      f.name === 'host' ? { ...f, value: 'nohost' } : f,
+    );
     const observed = await client.observe(api, undefined);
@@ -332,2 +335,4 @@ describe('servarrRootFolder', () => {
     if (desired === undefined) throw new Error('the root folder is wanted');
+    // The wire step makes the folder first: the app refuses a root folder without one.
+    state.folders.push('/data/media/tv');
     expect(await folder.create(api, desired)).toEqual({ id: 1 });
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 2d639a3..88dd325 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -204,3 +204,6 @@ beforeEach(async () => {
 
-/** `runtime`, with the stack's containers on the wiring network, where `apis` are. */
+/**
+ * `runtime`, with the stack's containers on the wiring network, where `apis` are, and its
+ * one-off commands making their folders there: an arr's root folder needs its folder.
+ */
 function reachingFakeApis(runtime: Runtime): Runtime {
@@ -208,2 +211,6 @@ function reachingFakeApis(runtime: Runtime): Runtime {
     ...runtime,
+    run: (service, command) => {
+      apis.mkdir(service, command);
+      return runtime.run(service, command);
+    },
     wiringAddresses: (ids) =>
```

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm vitest run packages/engine/src/testing catalog packages/cli`
Expected: PASS.

- [ ] **Step 7: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/testing catalog/_shared/servarr-download.test.ts packages/cli/src/run.test.ts
git commit -m "test(engine): a fake Prowlarr, and fake arrs that refuse what the real ones do" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1488 tests pass (1481 before this slice).

---

### Task 2: Prowlarr's links to Sonarr and Radarr, and its indexer proxy, on a shared Servarr provider

Prowlarr's integration gains its three resources after `prowlarr.admin`. They are Servarr
providers, as the arrs' download client is, so the way to find, make, update and test one
moves into a shared file first, and the download client onto it.

Decision: `servarr-provider.ts` holds `findProvider`, `createProvider`,
`updateProvider`, `testProvider`, `settingOf` and `textOf`, and keeps its schema private;
the download client keeps its messages, and its S3c tests pass unchanged (decision 8).
Decision: the links are `Sonarr (Mediaplane)` and `Radarr (Mediaplane)`, with the fields
`prowlarrUrl`, `baseUrl`, `syncLevel` and `syncCategories`, and the secret `apiKey`,
checked by Prowlarr's own test; each requires its arr's admin (decisions 1 to 4).
Decision: the proxy is `Cloudflare (Mediaplane)`, of type FlareSolverr, with the fields
`host`, `requestTimeout` and `tags`, and no secret; its tag is asked for as it is made or
updated (decisions 5, 6).
Decision: FlareSolverr's health check asks its `/health` (decision 7).

**Files:**
- Create: `catalog/_shared/servarr-provider.ts`
- Modify: `catalog/_shared/servarr-download.ts`, `catalog/prowlarr/integration.ts`,
  `catalog/flaresolverr/app.ts`
- Test: `catalog/prowlarr/integration.test.ts` (new), `catalog/catalog.test.ts`,
  `scripts/docs/catalog-facts.test.ts`
- Generated: the facts in `catalog/prowlarr/README.md` and
  `catalog/flaresolverr/README.md`

**Interfaces:**
- **Consumes:** Task 1's `fakeStackApis` (its Prowlarr and the arrs' keys), S3c's
  `ResourceSpec` contract, `servarrIntegration`, and `provides` from the engine's
  resolver.
- **Produces:**
  - `catalog/_shared/servarr-provider.ts`: `interface ProviderKind { path: string; implementation: string; what: string; of: string }`,
    `type Provider`, `settingOf(held: Provider, name: string): unknown`,
    `textOf(value: unknown): string`,
    `findProvider(api, kind, known, name): Promise<Provider | undefined>`,
    `createProvider(api, kind, settings, top): Promise<{ id: number }>`,
    `updateProvider(api, kind, id, settings, top): Promise<void>`,
    `testProvider(api, kind, id, name, credentials): Promise<boolean>`;
  - `catalog/prowlarr/integration.ts`: `LINKED`, `PROXY_NAME`
    (`'Cloudflare (Mediaplane)'`), `PROXY_TAG` (`'cloudflare'`), and the integration
    with the resources `admin`, `application_sonarr`, `application_radarr`,
    `indexer_proxy`.

- [ ] **Step 1: Write the failing tests**

**Create** `catalog/prowlarr/integration.test.ts`:

```ts
import {
  AppApiError,
  createAppApi,
  planWiring,
  type ResolvedStack,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeContainer,
  fakeHttpApp,
  fakeRuntime,
  fakeStackApis,
  freshAppState,
  wiringStack,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import integration, { PROXY_NAME } from './integration';

const PROWLARR_KEY = '0'.repeat(32);
const SONARR_KEY = '1'.repeat(32);
const RADARR_KEY = '2'.repeat(32);
const KEYS = {
  prowlarr: { apiKey: PROWLARR_KEY },
  sonarr: { apiKey: SONARR_KEY },
  radarr: { apiKey: RADARR_KEY },
};

/** Prowlarr, Sonarr and Radarr, with `more` (Byparr comes with Prowlarr). */
function stack(more = ''): ResolvedStack {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  prowlarr: {}
  sonarr: {}
  radarr: {}
  qbittorrent: { vpn: false }
${more}`,
  );
}

function contextOf(
  resolved: ResolvedStack = stack(),
  keys: WiringContext['keys'] = KEYS,
): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'prowlarr');
  if (app === undefined) throw new Error('no Prowlarr in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys,
  };
}

function resource(name: string): ResourceSpec {
  const spec = integration.resources.find((r) => r.name === name);
  if (spec === undefined) throw new Error(`Prowlarr has no resource ${name}`);
  return spec;
}

const toSonarr = resource('application_sonarr');
const proxy = resource('indexer_proxy');

function wanted(spec: ResourceSpec, ctx: WiringContext = contextOf()) {
  const desired = spec.desired(ctx);
  if (desired === undefined) throw new Error(`${spec.name} is wanted`);
  return desired;
}

/** Prowlarr, faked as fakeStackApis fakes it, Sonarr taking SONARR_KEY, and a client. */
async function prowlarr() {
  const apis = await fakeStackApis();
  const state = freshAppState();
  apis.apps.set('prowlarr', state);
  apis.apps.set('sonarr', { ...freshAppState(), key: SONARR_KEY });
  const api = createAppApi({
    name: 'Prowlarr',
    service: 'prowlarr',
    port: 9696,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: PROWLARR_KEY },
    secrets: [PROWLARR_KEY, SONARR_KEY, RADARR_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, app: apis.app, state, apps: apis.apps };
}

describe("Prowlarr's integration", () => {
  it("links Sonarr and Radarr, after them, and sends indexers through the stack's Cloudflare solver", () => {
    expect(integration.after).toEqual(['radarr', 'sonarr']);
    expect(
      integration.resources.map((r) => [r.name, r.fields, r.secrets, r.requires]),
    ).toEqual([
      ['admin', ['username'], ['password'], undefined],
      [
        'application_sonarr',
        ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
        ['apiKey'],
        ['sonarr.admin'],
      ],
      [
        'application_radarr',
        ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
        ['apiKey'],
        ['radarr.admin'],
      ],
      ['indexer_proxy', ['host', 'requestTimeout', 'tags'], [], undefined],
    ]);
  });
});

describe('a link to Sonarr or Radarr', () => {
  it("syncs fully, each app reaching the other by its service, with the arr's key", () => {
    expect(wanted(toSonarr)).toEqual({
      name: 'Sonarr (Mediaplane)',
      fields: {
        prowlarrUrl: 'http://prowlarr:9696',
        baseUrl: 'http://sonarr:8989',
        syncLevel: 'fullSync',
        syncCategories: '5000,5010,5020,5030,5040,5045,5050,5090',
      },
      secrets: { apiKey: SONARR_KEY },
    });
    expect(wanted(resource('application_radarr'))).toMatchObject({
      name: 'Radarr (Mediaplane)',
      fields: {
        baseUrl: 'http://radarr:7878',
        syncCategories: '2000,2010,2020,2030,2040,2045,2050,2060,2070,2080,2090',
      },
      secrets: { apiKey: RADARR_KEY },
    });
  });

  it("wants none to an arr the stack doesn't run, or whose key isn't stored", () => {
    const withoutRadarr = wiringStack(
      catalog,
      `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  prowlarr: {}
  sonarr: {}
  qbittorrent: { vpn: false }
`,
    );
    expect(resource('application_radarr').desired(contextOf(withoutRadarr))).toBe(
      undefined,
    );
    expect(toSonarr.desired(contextOf(stack(), { prowlarr: KEYS.prowlarr }))).toBe(
      undefined,
    );
  });

  it("is made from Prowlarr's own template, tested as it is saved, and found by its name", async () => {
    const { api, app, state } = await prowlarr();
    expect(await toSonarr.observe(api, undefined)).toBeUndefined();
    expect(await toSonarr.create(api, wanted(toSonarr))).toEqual({ id: 1 });
    const post = app.requests.find((r) => r.method === 'POST');
    expect(post?.path).toBe('/api/v1/applications?forceSave=true');
    expect(JSON.parse(post?.body ?? '{}')).not.toHaveProperty('presets');
    expect(state.applications[0]).toMatchObject({
      name: 'Sonarr (Mediaplane)',
      implementation: 'Sonarr',
      syncLevel: 'fullSync',
    });
    expect(state.applications[0]?.fields).toEqual(
      expect.arrayContaining([
        { name: 'prowlarrUrl', value: 'http://prowlarr:9696' },
        { name: 'baseUrl', value: 'http://sonarr:8989' },
        { name: 'apiKey', value: SONARR_KEY },
        {
          name: 'syncCategories',
          value: [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
        },
        // A setting Mediaplane doesn't manage keeps the template's value.
        { name: 'animeSyncCategories', value: [5070] },
      ]),
    );
    expect(await toSonarr.observe(api, undefined)).toEqual({
      id: 1,
      name: 'Sonarr (Mediaplane)',
      fields: wanted(toSonarr).fields,
    });
  });

  it("checks the arr's key with Prowlarr's own test of the link it holds: a refusal means update", async () => {
    const { api, app, state } = await prowlarr();
    const desired = wanted(toSonarr);
    await toSonarr.create(api, desired);
    const observed = await toSonarr.observe(api, undefined);
    if (observed === undefined) throw new Error('no link observed');
    expect(await toSonarr.verify?.(api, desired, observed)).toBe(true);
    // Tested as Prowlarr holds it: by its id, the key masked.
    const test = app.requests.find((r) => r.path === '/api/v1/applications/test');
    expect(JSON.parse(test?.body ?? '{}')).toMatchObject({ id: 1 });
    expect(test?.body).not.toContain(SONARR_KEY);
    const key = state.applications[0]?.fields.find((f) => f.name === 'apiKey');
    if (key !== undefined) key.value = '9'.repeat(32);
    expect(await toSonarr.verify?.(api, desired, observed)).toBe(false);
    await toSonarr.update(api, desired, observed);
    expect(await toSonarr.verify?.(api, desired, observed)).toBe(true);
  });

  it("says Prowlarr's own words when its test fails for another reason", async () => {
    const { api, state } = await prowlarr();
    const desired = wanted(toSonarr);
    await toSonarr.create(api, desired);
    // Aimed elsewhere by hand: Prowlarr tests a new link as it saves it.
    const [held] = state.applications;
    if (held === undefined) throw new Error('no link made');
    held.fields = held.fields.map((f) =>
      f.name === 'baseUrl' ? { ...f, value: 'http://nowhere:8989' } : f,
    );
    const observed = await toSonarr.observe(api, undefined);
    if (observed === undefined) throw new Error('no link observed');
    const failure = await toSonarr
      .verify?.(api, desired, observed)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppApiError);
    expect((failure as AppApiError).message).toBe(
      'Prowlarr at http://prowlarr:9696 (127.0.0.1) tested Sonarr (Mediaplane), and it failed: BaseUrl: Unable to complete application test, cannot connect to Sonarr. Resource temporarily unavailable (nowhere:8989) (POST /api/v1/applications/test)',
    );
  });

  it('is tested by plan only once the arr is up and takes its key', async () => {
    // Sonarr is stopped, and apply will start it: Prowlarr's test of the link would fail
    // on Sonarr, not on the link. plan leaves its key unchecked, and warns of nothing.
    const { api, app, apps } = await prowlarr();
    await toSonarr.create(api, wanted(toSonarr));
    const tests = () =>
      app.requests.filter((r) => r.path === '/api/v1/applications/test').length;
    const addresses = Object.fromEntries(
      ['prowlarr', 'qbittorrent', 'radarr', 'sonarr'].map((s) => [
        `fake-${s}`,
        '127.0.0.1',
      ]),
    );
    const plan = (sonarr: 'running' | 'exited') =>
      planWiring({
        stack: stack(),
        current: [
          'byparr',
          'jellyfin',
          'prowlarr',
          'qbittorrent',
          'radarr',
          'sonarr',
        ].map((service) =>
          fakeContainer(service, `fake-${service}`, {
            ...(service === 'sonarr' ? { state: sonarr } : {}),
          }),
        ),
        changing: new Set(sonarr === 'exited' ? ['sonarr'] : []),
        onNetwork: true,
        runtime: fakeRuntime({ addresses }),
        keys: { ...KEYS, qbittorrent: { apiKey: `qbt_${'3'.repeat(28)}` } },
        admin: { username: 'admin', password: 'fake-admin-password' },
        secrets: [PROWLARR_KEY, SONARR_KEY, RADARR_KEY],
        known: {},
        seams: {
          endpoint: () => ({ host: '127.0.0.1', port: app.port }),
          retry: { deadlineMs: 0 },
        },
      });
    const stopped = await plan('exited');
    expect(
      stopped.changes.find((c) => c.resource === 'prowlarr.application_sonarr'),
    ).toEqual({ resource: 'prowlarr.application_sonarr', action: 'adopt' });
    expect(stopped.diagnostics).toEqual([]);
    expect(tests()).toBe(0);
    // With Sonarr up and its admin in place, plan asks Prowlarr's own test.
    const sonarr = apps.get('sonarr');
    if (sonarr === undefined) throw new Error('no Sonarr faked');
    sonarr.user = 'admin';
    sonarr.password = 'fake-admin-password';
    expect((await plan('running')).changes).toContainEqual({
      resource: 'prowlarr.application_sonarr',
      action: 'adopt',
    });
    expect(tests()).toBe(1);
  });

  it("updates what differs, keeping the settings it doesn't manage", async () => {
    const { api, state } = await prowlarr();
    const desired = wanted(toSonarr);
    await toSonarr.create(api, desired);
    const [held] = state.applications;
    if (held === undefined) throw new Error('no link made');
    held.syncLevel = 'addOnly';
    held.tags = [7];
    held.fields = held.fields.map((f) =>
      f.name === 'syncCategories' ? { ...f, value: [5040, 5000] } : f,
    );
    const observed = await toSonarr.observe(api, undefined);
    expect(observed?.fields).toMatchObject({
      syncLevel: 'addOnly',
      syncCategories: '5000,5040',
    });
    if (observed === undefined) throw new Error('no link observed');
    await toSonarr.update(api, desired, observed);
    expect(state.applications[0]).toMatchObject({ syncLevel: 'fullSync', tags: [7] });
    expect((await toSonarr.observe(api, undefined))?.fields).toEqual(desired.fields);
  });

  it('refuses a Prowlarr that offers no link to the arr, and sends nothing', async () => {
    const app = await fakeHttpApp((request) =>
      request.path === '/api/v1/applications/schema'
        ? { status: 200, body: [{ implementation: 'Lidarr', fields: [] }] }
        : { status: 404 },
    );
    const api = createAppApi({
      name: 'Prowlarr',
      service: 'prowlarr',
      port: 9696,
      endpoint: { host: '127.0.0.1', port: app.port },
      key: { scheme: 'x-api-key', value: PROWLARR_KEY },
      secrets: [PROWLARR_KEY, SONARR_KEY],
      retry: { deadlineMs: 0 },
    });
    const failure = await toSonarr
      .create(api, wanted(toSonarr))
      .catch((thrown: unknown) => thrown);
    expect(failure).toMatchObject({
      kind: 'protocol',
      message:
        'Prowlarr at http://prowlarr:9696 (127.0.0.1) offers no Sonarr application (GET /api/v1/applications/schema)',
    });
    expect(app.requests.map((r) => r.method)).toEqual(['GET']);
  });
});

describe('the indexer proxy', () => {
  it("is the stack's Cloudflare solver, tagged cloudflare: Byparr, or FlareSolverr when you choose it", () => {
    expect(wanted(proxy)).toEqual({
      name: PROXY_NAME,
      fields: { host: 'http://byparr:8191/', requestTimeout: 60, tags: 'cloudflare' },
      secrets: {},
    });
    expect(wanted(proxy, contextOf(stack('  flaresolverr: {}\n'))).fields.host).toBe(
      'http://flaresolverr:8191/',
    );
    expect(proxy.desired(contextOf(stack('  byparr: { enabled: false }\n')))).toBe(
      undefined,
    );
  });

  it('is made with the tag cloudflare, which Prowlarr makes first, and found with its tags by label', async () => {
    const { api, state } = await prowlarr();
    expect(await proxy.observe(api, undefined)).toBeUndefined();
    expect(await proxy.create(api, wanted(proxy))).toEqual({ id: 1 });
    expect(state.tags).toEqual([{ id: 1, label: 'cloudflare' }]);
    expect(state.proxies[0]).toMatchObject({
      name: PROXY_NAME,
      implementation: 'FlareSolverr',
      tags: [1],
    });
    expect(await proxy.observe(api, undefined)).toEqual({
      id: 1,
      name: PROXY_NAME,
      fields: wanted(proxy).fields,
    });
  });

  it('keeps the tag Prowlarr has, and puts back the tags and settings it manages', async () => {
    const { api, state } = await prowlarr();
    state.tags.push({ id: 1, label: 'other' }, { id: 2, label: 'cloudflare' });
    await proxy.create(api, wanted(proxy));
    expect(state.proxies[0]?.tags).toEqual([2]);
    const [held] = state.proxies;
    if (held === undefined) throw new Error('no proxy made');
    held.tags = [2, 1];
    held.fields = held.fields.map((f) =>
      f.name === 'host' ? { ...f, value: 'http://flaresolverr:8191/' } : f,
    );
    const observed = await proxy.observe(api, undefined);
    expect(observed?.fields).toMatchObject({
      host: 'http://flaresolverr:8191/',
      tags: 'cloudflare,other',
    });
    if (observed === undefined) throw new Error('no proxy observed');
    await proxy.update(api, wanted(proxy), observed);
    expect(state.proxies[0]?.tags).toEqual([2]);
    expect((await proxy.observe(api, undefined))?.fields).toEqual(wanted(proxy).fields);
  });
});
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index f6a80be..c9d00fd 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -64,2 +64,13 @@ describe('catalog', () => {
 
+  it("gives each Cloudflare solver a health check, and its API on the port Prowlarr's proxy names", () => {
+    // Prowlarr tests a new indexer proxy as it saves it: up --wait must wait until the
+    // solver answers, or the wire step's create would race its start.
+    const solvers = catalog.filter((app) => app.provides.includes('cloudflare-solver'));
+    expect(solvers.map((app) => app.id)).toEqual(['byparr', 'flaresolverr']);
+    for (const solver of solvers) {
+      expect(typeof solver.health, `${solver.id}'s health check`).toBe('object');
+      expect(solver.ports).toEqual([{ name: 'api', container: 8191, publish: false }]);
+    }
+  });
+
   it('gives an integration to the apps Mediaplane wires so far', () => {
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 7856d70..53919eb 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -81,3 +81,5 @@ describe('renderFacts', () => {
     expect(renderFacts(app('gluetun'))).toContain("- **Health check:** the image's own");
-    expect(renderFacts(app('flaresolverr'))).toContain('- **Health check:** none: ');
+    expect(renderFacts({ ...app('flaresolverr'), health: 'none' })).toContain(
+      '- **Health check:** none: ',
+    );
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog scripts/docs`
Expected: FAIL:
- `catalog/prowlarr/integration.test.ts` fails as it loads, with
  `Error: Prowlarr has no resource application_sonarr`;
- `catalog/catalog.test.ts`: "gives each Cloudflare solver a health check, and its API on
  the port Prowlarr's proxy names", with
  `flaresolverr's health check: expected 'string' to be 'object'`.

`scripts/docs/catalog-facts.test.ts` passes before and after: it no longer leans on
FlareSolverr having no health check.

- [ ] **Step 3: Write the shared provider, the integration and the health check**

**Create** `catalog/_shared/servarr-provider.ts`:

```ts
import {
  AppApiError,
  type AppApi,
  type KnownResource,
  type ObservedResource,
} from '@mediaplane/engine';
import { z } from 'zod';

/** One setting of a Servarr provider; the rest of it goes back as it came. */
const setting = z.looseObject({ name: z.string(), value: z.unknown().optional() });

/**
 * A provider as a Servarr app gives it: Sonarr's or Radarr's download client, or one of
 * Prowlarr's links to them (its applications) or indexer proxies. Its secrets are masked
 * as "********", and the rest of it goes back as it came, so a setting Mediaplane doesn't
 * manage stays the user's.
 */
const provider = z.looseObject({
  id: z.number(),
  name: z.string(),
  implementation: z.string(),
  fields: z.array(setting),
});

export type Provider = z.infer<typeof provider>;

/** One of the app's templates for a new provider (`…/schema`). */
const template = z.looseObject({ implementation: z.string(), fields: z.array(setting) });

const created = z.looseObject({ id: z.number() });

/** One kind of provider Mediaplane makes in a Servarr app, and where the app keeps it. */
export interface ProviderKind {
  /** Where: "/api/v3/downloadclient", "/api/v1/applications", "/api/v1/indexerproxy". */
  path: string;
  /** Its implementation, as the app names it: "QBittorrent", "Sonarr", "FlareSolverr". */
  implementation: string;
  /** What it is, in messages: "qBittorrent download client". */
  what: string;
  /** Whose settings it holds, in messages: "qBittorrent". */
  of: string;
}

/** What a provider's setting `name` holds, as the app gives it. */
export function settingOf(held: Provider, name: string): unknown {
  return held.fields.find((f) => f.name === name)?.value;
}

/** A setting's text, or "" when it holds none. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The provider Mediaplane made, among the app's of `kind`: by the id resources.json
 * recorded, else by the name Mediaplane gives it (spec §6.3).
 */
export async function findProvider(
  api: AppApi,
  kind: ProviderKind,
  known: KnownResource | undefined,
  name: string,
): Promise<Provider | undefined> {
  const held = (await api.get(kind.path, z.array(provider))).filter(
    (p) => p.implementation === kind.implementation,
  );
  return (
    held.find((p) => known !== undefined && p.id === known.id) ??
    held.find((p) => p.name === name)
  );
}

/**
 * `body`, as the app gave it at `read`, with `settings` set: secrets among them in clear,
 * in this request body only. A setting the app doesn't have means a version Mediaplane
 * doesn't know: say so, rather than save a provider that can't work.
 */
function withSettings<T extends { fields: z.infer<typeof setting>[] }>(
  api: AppApi,
  kind: ProviderKind,
  read: string,
  body: T,
  settings: Readonly<Record<string, unknown>>,
): T {
  const missing = Object.keys(settings).filter(
    (name) => !body.fields.some((f) => f.name === name),
  );
  if (missing.length > 0) {
    throw new AppApiError(
      `${api.name} at ${api.where} has no ${missing.join(', ')} setting for ${kind.of}, which Mediaplane needs (GET ${read})`,
      { kind: 'protocol' },
    );
  }
  return {
    ...body,
    fields: body.fields.map((f) =>
      Object.hasOwn(settings, f.name) ? { ...f, value: settings[f.name] } : f,
    ),
  };
}

/**
 * Make one from the app's own template (without its UI presets), with `settings` and the
 * provider's own properties `top` (its name, enable, tags…), saved with forceSave. The
 * app still tests a new provider as it saves it, skipping only the warnings, so a create
 * fails while the test does: while the arr can't reach qBittorrent, say.
 */
export async function createProvider(
  api: AppApi,
  kind: ProviderKind,
  settings: Readonly<Record<string, unknown>>,
  top: Readonly<Record<string, unknown>>,
): Promise<{ id: number }> {
  const schema = `${kind.path}/schema`;
  const offered = (await api.get(schema, z.array(template))).find(
    (t) => t.implementation === kind.implementation,
  );
  if (offered === undefined) {
    throw new AppApiError(
      `${api.name} at ${api.where} offers no ${kind.what} (GET ${schema})`,
      { kind: 'protocol' },
    );
  }
  const { presets, ...body } = offered;
  const made = await api.post(
    `${kind.path}?forceSave=true`,
    { ...withSettings(api, kind, schema, body, settings), ...top },
    created,
  );
  return { id: made.id };
}

/**
 * Update the provider with the app's id `id`: PUT it back as the app gave it, with
 * `settings` and `top`, and its masked secrets as they came, which keeps them. With
 * forceSave the app skips its test, so an update is saved even while the test would
 * fail: the check says whether it works.
 */
export async function updateProvider(
  api: AppApi,
  kind: ProviderKind,
  id: ObservedResource['id'],
  settings: Readonly<Record<string, unknown>>,
  top: Readonly<Record<string, unknown>>,
): Promise<void> {
  const path = `${kind.path}/${String(id)}`;
  const held = await api.get(path, provider);
  await api.put(`${path}?forceSave=true`, {
    ...withSettings(api, kind, path, held, settings),
    ...top,
  });
}

/**
 * The app's own test of the provider it holds as `id`, sent as the app gave it (its
 * secrets masked) and with that id, or the app tests it as a new one and refuses its
 * name. True when it passes; false when it fails on one of `credentials`, a secret the
 * update sets; otherwise the app's own words, thrown.
 */
export async function testProvider(
  api: AppApi,
  kind: ProviderKind,
  id: ObservedResource['id'],
  name: string,
  credentials: readonly string[],
): Promise<boolean> {
  const held = await api.get(`${kind.path}/${String(id)}`, provider);
  const result = await api.test(`${kind.path}/test`, held);
  if (result.passed) return true;
  if (result.failures.some((f) => credentials.includes(f.property))) return false;
  const said = result.failures
    .map((f) => (f.property === '' ? f.message : `${f.property}: ${f.message}`))
    .join('; ');
  throw new AppApiError(
    `${api.name} at ${api.where} tested ${name}, and it failed: ${said} (POST ${kind.path}/test)`,
    { kind: 'rejected', status: 400 },
  );
}
```

**Change** `catalog/_shared/servarr-download.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.ts b/catalog/_shared/servarr-download.ts
index b9c1e58..6c8f664 100644
--- a/catalog/_shared/servarr-download.ts
+++ b/catalog/_shared/servarr-download.ts
@@ -1,8 +1,13 @@
-import {
-  AppApiError,
-  type AppApi,
-  type DesiredResource,
-  type ResourceSpec,
-} from '@mediaplane/engine';
+import type { DesiredResource, Fields, ResourceSpec } from '@mediaplane/engine';
 import { z } from 'zod';
+import {
+  createProvider,
+  findProvider,
+  settingOf,
+  testProvider,
+  textOf,
+  updateProvider,
+  type Provider,
+  type ProviderKind,
+} from './servarr-provider';
 
@@ -11,3 +16,9 @@ export const DOWNLOAD_CLIENT_NAME = 'qBittorrent (Mediaplane)';
 
-const CLIENTS = '/api/v3/downloadclient';
+/** Sonarr's and Radarr's qBittorrent download clients. */
+const CLIENTS: ProviderKind = {
+  path: '/api/v3/downloadclient',
+  implementation: 'QBittorrent',
+  what: 'qBittorrent download client',
+  of: 'qBittorrent',
+};
 const ROOT_FOLDERS = '/api/v3/rootfolder';
@@ -18,21 +29,3 @@ const ROOT_FOLDERS = '/api/v3/rootfolder';
  */
-const CREDENTIALS = new Set(['ApiKey', 'Username', 'Password']);
-
-/** One setting of a Servarr provider; the rest of it goes back as it came. */
-const setting = z.looseObject({ name: z.string(), value: z.unknown().optional() });
-
-/**
- * A download client as Sonarr or Radarr gives it, its key masked as "********". The rest
- * of it goes back as it came, so a setting Mediaplane doesn't manage stays the user's.
- */
-const client = z.looseObject({
-  id: z.number(),
-  name: z.string(),
-  enable: z.boolean(),
-  implementation: z.string(),
-  fields: z.array(setting),
-});
-
-/** One of the app's templates for a new download client (`…/schema`). */
-const template = z.looseObject({ implementation: z.string(), fields: z.array(setting) });
+const CREDENTIALS = ['ApiKey', 'Username', 'Password'];
 
@@ -48,16 +41,11 @@ export interface DownloadLink {
 
-function text(value: unknown): string {
-  return typeof value === 'string' ? value : '';
-}
-
 /** The managed fields of a download client, from the app's settings. */
-function fieldsOf(held: z.infer<typeof client>, link: DownloadLink) {
-  const value = (name: string) => held.fields.find((f) => f.name === name)?.value;
-  const port = value('port');
+function fieldsOf(held: Provider, link: DownloadLink): Fields {
+  const port = settingOf(held, 'port');
   return {
-    host: text(value('host')),
+    host: textOf(settingOf(held, 'host')),
     port: typeof port === 'number' ? port : 0,
-    useSsl: value('useSsl') === true,
-    category: text(value(link.setting)),
-    enable: held.enable,
+    useSsl: settingOf(held, 'useSsl') === true,
+    category: textOf(settingOf(held, link.setting)),
+    enable: held.enable === true,
   };
@@ -66,17 +54,12 @@ function fieldsOf(held: z.infer<typeof client>, link: DownloadLink) {
 /**
- * `body`, as the app gave it at `read`, with the desired settings, and qBittorrent's key
- * in clear: the one place one app's key goes to another, in a request body. A setting
- * the app doesn't have means a version Mediaplane doesn't know: say so, rather than save
- * a client that can't work.
+ * The desired settings, with qBittorrent's key in clear: the one place one app's key goes
+ * to another, in a request body.
  */
-function withSettings<T extends { fields: z.infer<typeof setting>[] }>(
-  api: AppApi,
-  read: string,
-  body: T,
+function settingsOf(
   desired: DesiredResource,
   link: DownloadLink,
-): T & { name: string; enable: boolean } {
+): Record<string, unknown> {
   const key = desired.secrets.apiKey;
   if (key === undefined) throw new Error(`${desired.name} has no apiKey to send`);
-  const values: Record<string, unknown> = {
+  return {
     host: desired.fields.host,
@@ -87,19 +70,7 @@ function withSettings<T extends { fields: z.infer<typeof setting>[] }>(
   };
-  const missing = Object.keys(values).filter(
-    (name) => !body.fields.some((f) => f.name === name),
-  );
-  if (missing.length > 0) {
-    throw new AppApiError(
-      `${api.name} at ${api.where} has no ${missing.join(', ')} setting for qBittorrent, which Mediaplane needs (GET ${read})`,
-      { kind: 'protocol' },
-    );
-  }
-  return {
-    ...body,
-    name: desired.name,
-    enable: desired.fields.enable === true,
-    fields: body.fields.map((f) =>
-      Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f,
-    ),
-  };
+}
+
+/** The client's own properties Mediaplane sets: its name, and whether it is on. */
+function topOf(desired: DesiredResource): Record<string, unknown> {
+  return { name: desired.name, enable: desired.fields.enable === true };
 }
@@ -146,8 +117,3 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
     async observe(api, known) {
-      const clients = (await api.get(CLIENTS, z.array(client))).filter(
-        (c) => c.implementation === 'QBittorrent',
-      );
-      const held =
-        clients.find((c) => known !== undefined && c.id === known.id) ??
-        clients.find((c) => c.name === DOWNLOAD_CLIENT_NAME);
+      const held = await findProvider(api, CLIENTS, known, DOWNLOAD_CLIENT_NAME);
       return held === undefined
@@ -156,43 +122,14 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
     },
-    async verify(api, _desired, observed) {
-      const held = await api.get(`${CLIENTS}/${String(observed.id)}`, client);
-      const result = await api.test(`${CLIENTS}/test`, held);
-      if (result.passed) return true;
-      if (result.failures.some((f) => CREDENTIALS.has(f.property))) return false;
-      const said = result.failures
-        .map((f) => (f.property === '' ? f.message : `${f.property}: ${f.message}`))
-        .join('; ');
-      throw new AppApiError(
-        `${api.name} at ${api.where} tested ${DOWNLOAD_CLIENT_NAME}, and it failed: ${said} (POST ${CLIENTS}/test)`,
-        { kind: 'rejected', status: 400 },
-      );
-    },
-    async create(api, desired) {
-      const schema = `${CLIENTS}/schema`;
-      const offered = (await api.get(schema, z.array(template))).find(
-        (t) => t.implementation === 'QBittorrent',
-      );
-      if (offered === undefined) {
-        throw new AppApiError(
-          `${api.name} at ${api.where} offers no qBittorrent download client (GET ${schema})`,
-          { kind: 'protocol' },
-        );
-      }
-      // Its presets are the UI's, not part of a client.
-      const { presets, ...body } = offered;
-      const made = await api.post(
-        `${CLIENTS}?forceSave=true`,
-        withSettings(api, schema, body, desired, link),
-        created,
-      );
-      return { id: made.id };
-    },
-    async update(api, desired, observed) {
-      const path = `${CLIENTS}/${String(observed.id)}`;
-      const held = await api.get(path, client);
-      await api.put(
-        `${path}?forceSave=true`,
-        withSettings(api, path, held, desired, link),
-      );
-    },
+    verify: (api, desired, observed) =>
+      testProvider(api, CLIENTS, observed.id, desired.name, CREDENTIALS),
+    create: (api, desired) =>
+      createProvider(api, CLIENTS, settingsOf(desired, link), topOf(desired)),
+    update: (api, desired, observed) =>
+      updateProvider(
+        api,
+        CLIENTS,
+        observed.id,
+        settingsOf(desired, link),
+        topOf(desired),
+      ),
   };
```

**Change** `catalog/prowlarr/integration.ts`:

```diff
diff --git a/catalog/prowlarr/integration.ts b/catalog/prowlarr/integration.ts
index f72bfed..9d13abd 100644
--- a/catalog/prowlarr/integration.ts
+++ b/catalog/prowlarr/integration.ts
@@ -1,7 +1,228 @@
+import {
+  provides,
+  type AppApi,
+  type DesiredResource,
+  type ResourceSpec,
+} from '@mediaplane/engine';
+import { z } from 'zod';
 import { servarrIntegration } from '../_shared/servarr';
+import {
+  createProvider,
+  findProvider,
+  settingOf,
+  testProvider,
+  textOf,
+  updateProvider,
+  type ProviderKind,
+} from '../_shared/servarr-provider';
 
 /**
- * What Mediaplane wires in Prowlarr (spec §6.2): the shared admin login, so far. It comes
- * after Sonarr and Radarr, whose links it will test (Slice 4).
+ * The arrs Prowlarr syncs its indexers to (spec §6.2), each with the categories it syncs:
+ * Prowlarr 2.6's own defaults for that app.
  */
-export default servarrIntegration('v1', ['radarr', 'sonarr']);
+export const LINKED = [
+  {
+    arr: 'sonarr',
+    implementation: 'Sonarr',
+    categories: [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090],
+  },
+  {
+    arr: 'radarr',
+    implementation: 'Radarr',
+    categories: [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090],
+  },
+] as const;
+
+/** The name of the indexer proxy Mediaplane makes, whichever solver the stack runs. */
+export const PROXY_NAME = 'Cloudflare (Mediaplane)';
+
+/** The tag that routes an indexer through the proxy (spec §6.2). */
+export const PROXY_TAG = 'cloudflare';
+
+/** Prowlarr's FlareSolverr proxies: Byparr answers as FlareSolverr does. */
+const PROXIES: ProviderKind = {
+  path: '/api/v1/indexerproxy',
+  implementation: 'FlareSolverr',
+  what: 'FlareSolverr indexer proxy',
+  of: 'FlareSolverr',
+};
+
+/** How long Prowlarr gives the solver for a page, in seconds: Prowlarr's own default. */
+const REQUEST_TIMEOUT = 60;
+
+const TAGS = '/api/v1/tag';
+const tag = z.looseObject({ id: z.number(), label: z.string() });
+const tagIds = z.array(z.number());
+
+/** A provider's categories, as one sorted list: "5000,5010". */
+function categoriesOf(value: unknown): string {
+  const parsed = z.array(z.number()).safeParse(value);
+  return parsed.success ? [...parsed.data].sort((a, b) => a - b).join(',') : '';
+}
+
+/**
+ * Prowlarr's link to Sonarr or Radarr (spec §6.2, an "application"), named
+ * "<arr> (Mediaplane)", with full sync: an indexer you add in Prowlarr reaches the arr.
+ * - baseUrl is how Prowlarr reaches the arr, and prowlarrUrl how the arr reaches
+ *   Prowlarr back, each by its service on the stack's network, at its container port.
+ * - Its secret is the arr's key, checked with Prowlarr's own test of the link it holds,
+ *   which calls the arr with it, and has the arr call Prowlarr back: a refused key means
+ *   an update, which sets it; any other failure Prowlarr explains.
+ * - It is saved with forceSave: Prowlarr still tests a new one as it saves it, so a create
+ *   fails while it can't reach the arr. Prowlarr comes after the arrs, so they are up.
+ * - It requires the arr's admin, the first thing Mediaplane checks there: while the arr
+ *   is down, refuses its key or is yet to be started, `plan` leaves the link's key
+ *   unchecked rather than blame the link, and the wire step skips the link when the
+ *   arr's admin fails.
+ */
+function application(link: (typeof LINKED)[number]): ResourceSpec {
+  const kind: ProviderKind = {
+    path: '/api/v1/applications',
+    implementation: link.implementation,
+    what: `${link.implementation} application`,
+    of: link.implementation,
+  };
+  const name = `${link.implementation} (Mediaplane)`;
+  const settingsOf = (desired: DesiredResource) => {
+    const key = desired.secrets.apiKey;
+    if (key === undefined) throw new Error(`${desired.name} has no apiKey to send`);
+    return {
+      prowlarrUrl: desired.fields.prowlarrUrl,
+      baseUrl: desired.fields.baseUrl,
+      apiKey: key,
+      syncCategories: String(desired.fields.syncCategories).split(',').map(Number),
+    };
+  };
+  const topOf = (desired: DesiredResource) => ({
+    name: desired.name,
+    syncLevel: desired.fields.syncLevel,
+  });
+  return {
+    name: `application_${link.arr}`,
+    fields: ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
+    secrets: ['apiKey'],
+    requires: [`${link.arr}.admin`],
+    desired: ({ stack, app, keys }) => {
+      const arr = stack.apps.find((a) => a.def.id === link.arr);
+      const port = arr?.containerPorts.web;
+      const own = app.containerPorts.web;
+      const key = keys[link.arr]?.apiKey;
+      if (arr === undefined || port === undefined || own === undefined) return undefined;
+      if (key === undefined) return undefined;
+      return {
+        name,
+        fields: {
+          prowlarrUrl: `http://${app.def.id}:${String(own)}`,
+          baseUrl: `http://${arr.networkVia ?? arr.def.id}:${String(port)}`,
+          syncLevel: 'fullSync',
+          syncCategories: categoriesOf(link.categories),
+        },
+        secrets: { apiKey: key },
+      };
+    },
+    async observe(api, known) {
+      const held = await findProvider(api, kind, known, name);
+      if (held === undefined) return undefined;
+      return {
+        id: held.id,
+        name: held.name,
+        fields: {
+          prowlarrUrl: textOf(settingOf(held, 'prowlarrUrl')),
+          baseUrl: textOf(settingOf(held, 'baseUrl')),
+          syncLevel: textOf(held.syncLevel),
+          syncCategories: categoriesOf(settingOf(held, 'syncCategories')),
+        },
+      };
+    },
+    verify: (api, desired, observed) =>
+      testProvider(api, kind, observed.id, desired.name, ['ApiKey']),
+    create: (api, desired) =>
+      createProvider(api, kind, settingsOf(desired), topOf(desired)),
+    update: (api, desired, observed) =>
+      updateProvider(api, kind, observed.id, settingsOf(desired), topOf(desired)),
+  };
+}
+
+/** The id of the tag `cloudflare`: Prowlarr gives back the one it has, or makes it. */
+async function proxyTag(api: AppApi): Promise<number> {
+  return (await api.post(TAGS, { label: PROXY_TAG }, tag)).id;
+}
+
+/** The proxy's settings, and its own properties: its name, and its tag's id. */
+async function proxyBody(api: AppApi, desired: DesiredResource) {
+  return {
+    settings: {
+      host: desired.fields.host,
+      requestTimeout: desired.fields.requestTimeout,
+    },
+    top: { name: desired.name, tags: [await proxyTag(api)] },
+  };
+}
+
+/**
+ * Prowlarr's indexer proxy (spec §6.2): the stack's Cloudflare solver, Byparr or
+ * FlareSolverr, as a proxy of type FlareSolverr, which both answer, tagged `cloudflare`.
+ * Prowlarr sends an indexer through it only when they share a tag, so you tag the indexers
+ * Cloudflare protects. Its tags are known by their labels. It holds no secret. Prowlarr
+ * tests a new one as it saves it: it has the solver fetch a page of Prowlarr's own
+ * service, so the solver needs the internet then.
+ */
+const indexerProxy: ResourceSpec = {
+  name: 'indexer_proxy',
+  fields: ['host', 'requestTimeout', 'tags'],
+  secrets: [],
+  desired: ({ stack }) => {
+    const solver = stack.apps.find((a) => provides(a.def, 'cloudflare-solver'));
+    const port = solver?.containerPorts.api;
+    if (solver === undefined || port === undefined) return undefined;
+    return {
+      name: PROXY_NAME,
+      fields: {
+        host: `http://${solver.def.id}:${String(port)}/`,
+        requestTimeout: REQUEST_TIMEOUT,
+        tags: PROXY_TAG,
+      },
+      secrets: {},
+    };
+  },
+  async observe(api, known) {
+    const held = await findProvider(api, PROXIES, known, PROXY_NAME);
+    if (held === undefined) return undefined;
+    const labels = new Map(
+      (await api.get(TAGS, z.array(tag))).map((t) => [t.id, t.label]),
+    );
+    const ids = tagIds.safeParse(held.tags);
+    const timeout = settingOf(held, 'requestTimeout');
+    return {
+      id: held.id,
+      name: held.name,
+      fields: {
+        host: textOf(settingOf(held, 'host')),
+        requestTimeout: typeof timeout === 'number' ? timeout : 0,
+        tags: (ids.success ? ids.data : [])
+          .map((id) => labels.get(id) ?? String(id))
+          .sort()
+          .join(','),
+      },
+    };
+  },
+  async create(api, desired) {
+    const { settings, top } = await proxyBody(api, desired);
+    return createProvider(api, PROXIES, settings, top);
+  },
+  async update(api, desired, observed) {
+    const { settings, top } = await proxyBody(api, desired);
+    await updateProvider(api, PROXIES, observed.id, settings, top);
+  },
+};
+
+/**
+ * What Mediaplane wires in Prowlarr (spec §6.2): the shared admin login, its links to
+ * Sonarr and Radarr, which it tests against them, so it comes after them, and the
+ * indexer proxy. Indexers stay yours: you add them in Prowlarr, and it syncs them.
+ */
+export default servarrIntegration(
+  'v1',
+  ['radarr', 'sonarr'],
+  [...LINKED.map(application), indexerProxy],
+);
```

**Change** `catalog/flaresolverr/app.ts`:

```diff
diff --git a/catalog/flaresolverr/app.ts b/catalog/flaresolverr/app.ts
index 08ddde9..19d503b 100644
--- a/catalog/flaresolverr/app.ts
+++ b/catalog/flaresolverr/app.ts
@@ -20,3 +20,7 @@ export default defineApp({
   credentials: [],
-  health: 'none',
+  // The image has none. Prowlarr tests a new indexer proxy as it saves it, so `up --wait`
+  // waits until FlareSolverr answers, before the wire step makes the proxy.
+  health: {
+    test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'],
+  },
   env: () => ({ LOG_LEVEL: 'info' }),
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

Run: `pnpm vitest run catalog scripts/docs packages/cli`
Expected: PASS. `catalog/_shared/servarr-download.test.ts` passes as Task 1 left it: the
download client's move onto the shared provider changes none of its behaviour.

Run: `pnpm docs:generate`
Expected: it writes `catalog/flaresolverr/README.md` (the health check) and
`catalog/prowlarr/README.md` (the three new resources under "Managed in the app").

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog scripts/docs/catalog-facts.test.ts
git commit -m "feat(catalog): Prowlarr's links to Sonarr and Radarr, and its indexer proxy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1501 tests pass.

---

### Task 3: End-to-end: indexers added in Prowlarr reach both arrs, through Byparr or FlareSolverr

The roadmap's proof for this slice, on real containers: indexers added in Prowlarr reach
both arrs, and proxied requests work. The test serves made-up indexers of its own, so it
never touches a real one.

Decision: a new `test/e2e/indexers.e2e.test.ts`, from source; a made-up Torznab feed in a
busybox container outside the stack, with a protected feed behind a stand-in Cloudflare
challenge that only a browser passes (decision 10).
Decision: it checks the links and the proxy as Prowlarr holds them, two indexers synced
to both arrs, the protected one fetched through Byparr's browser, a wrong key set again,
then the same through FlareSolverr after switching, and no changes after each round
(decision 10).
Decision: the apply e2e's wiring lists gain the three resources (decision 10).
Decision: S3c's e2e helpers the new files need move into `helpers.ts`, unchanged, and
`stackFor` can leave Seerr out; the new test's refusals redact every stored key
(decision 10).

**Files:**
- Create: `test/e2e/indexer.ts`, `test/e2e/indexers.e2e.test.ts`
- Modify: `test/e2e/helpers.ts`, `test/e2e/download.e2e.test.ts`,
  `test/e2e/wireguard.ts`, `test/e2e/apply.e2e.test.ts`

**Interfaces:**
- **Consumes:** Task 2's resources, as `apply` makes them; `makeHome`, `composeDown`,
  `expectWiringRemoved`, `runTeardown`, `stackFor` and `BUSYBOX` from
  `test/e2e/helpers.ts`.
- **Produces:**
  - `test/e2e/indexer.ts`: `startFakeIndexer(id: string): Promise<FakeIndexer>`, with
    `interface FakeIndexer { url: string; open: string; protected: string; browserVisits(): Promise<number>; remove(): Promise<void> }`;
  - `test/e2e/helpers.ts`, moved from S3c's files as they were:
    `docker(...args: string[]): Promise<string>`,
    `publishedPort(container: string, port: string): Promise<number>`,
    `removeOrIgnoreMissing(...args: string[]): Promise<void>`,
    `servarrFailure(response: Response, secrets: readonly string[]): Promise<string>`,
    `interface WireActions`, `wired(actions: WireActions['actions']): string[][]`; and
    `stackFor(data: string, { seerr = true }: { seerr?: boolean } = {}): string`.

- [ ] **Step 1: See the apply end-to-end test fail on the new resources**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/apply.e2e.test.ts`
Expected: FAIL in "starts the video stack healthy, then has nothing left to do": the
plan's wiring now lists 14 resources, where the test expects 11
(`expected [ { …(2) }, { …(2) }, { …(2) }, …(11) ] to deeply equal [ { …(2) }, { …(2) }, { …(2) }, …(8) ]`).
The stack itself comes up healthy, and its first `apply` succeeds: Prowlarr makes its
links, and its proxy at Byparr.

- [ ] **Step 2: Share the helpers, write the made-up indexer and the test, and update the apply test**

**Change** `test/e2e/helpers.ts`:

```diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index 1eb578c..a911fef 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -32,6 +32,10 @@ export async function buildImage(tag: string): Promise<void> {
 /**
- * The M1 video stack without the VPN (vpn.e2e.test.ts has its own, behind the VPN).
- * The apps run as the current user, who owns the temporary data folder.
+ * The M1 video stack without the VPN (vpn.e2e.test.ts has its own, behind the VPN), or
+ * without Seerr too. The apps run as the current user, who owns the temporary data
+ * folder.
  */
-export function stackFor(data: string): string {
+export function stackFor(
+  data: string,
+  { seerr = true }: { seerr?: boolean } = {},
+): string {
   return `version: 1
@@ -46,4 +50,3 @@ apps:
   qbittorrent: { vpn: false }
-  seerr: {}
-`;
+${seerr ? '  seerr: {}\n' : ''}`;
 }
@@ -153,2 +156,82 @@ export async function runTeardown(
 
+/** `docker <args>`'s output, trimmed; a failure throws, with Docker's own words. */
+export async function docker(...args: string[]): Promise<string> {
+  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
+  if (result.code !== 0) {
+    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
+  }
+  return result.stdout.trim();
+}
+
+/** The host port Docker chose for a container's `port` (such as "51820/udp"). */
+export async function publishedPort(container: string, port: string): Promise<number> {
+  const output = await docker('port', container, port);
+  const [first] = output.split('\n');
+  const published = Number(first?.split(':').at(-1));
+  if (!Number.isInteger(published) || published < 1 || published > 65535) {
+    throw new Error(`docker port ${container} ${port} gave no host port:\n${output}`);
+  }
+  return published;
+}
+
+/**
+ * A removal that must not fail silently: a non-zero exit is an error, unless stderr says
+ * the thing was already gone ("No such container", or "network … not found").
+ */
+export async function removeOrIgnoreMissing(...args: string[]): Promise<void> {
+  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
+  if (result.code !== 0 && !/No such|not found/.test(result.stderr)) {
+    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
+  }
+}
+
+/**
+ * Why an arr refused a request, safe for CI's public log: the status, and each validation
+ * error's `propertyName: errorMessage`, with every one of `secrets` replaced. Never the
+ * raw body, nor an error's `attemptedValue`, which can be the key under test. A body that
+ * isn't such a list gives only its length.
+ */
+export async function servarrFailure(
+  response: Response,
+  secrets: readonly string[],
+): Promise<string> {
+  const status = `status ${String(response.status)}`;
+  const body = await response.text();
+  let parsed: unknown;
+  try {
+    parsed = JSON.parse(body);
+  } catch {
+    return `${status}, with ${String(body.length)} characters that aren't JSON`;
+  }
+  if (!Array.isArray(parsed)) {
+    return `${status}, with ${String(body.length)} characters of JSON that isn't a list`;
+  }
+  const text = (value: unknown) => (typeof value === 'string' ? value : '?');
+  const said = parsed.map((item: unknown) => {
+    const { propertyName, errorMessage } = (
+      typeof item === 'object' && item !== null ? item : {}
+    ) as Record<string, unknown>;
+    return `${text(propertyName)}: ${text(errorMessage)}`;
+  });
+  return secrets
+    .filter((secret) => secret !== '')
+    .reduce(
+      (message, secret) => message.replaceAll(secret, '***'),
+      `${status}: ${said.join('; ')}`,
+    );
+}
+
+/** What `apply --json` says, and `apply` returns: its outcome, and each action. */
+export interface WireActions {
+  outcome: string;
+  actions: { step: string; resource?: string; detail?: string }[];
+}
+
+/** Each wired resource's detail, in order. */
+export function wired(actions: WireActions['actions']): string[][] {
+  return actions
+    .filter((a) => a.resource !== undefined)
+    .map((a) => [a.resource ?? '', a.detail ?? '']);
+}
+
 /**
```

**Change** `test/e2e/download.e2e.test.ts`:

```diff
diff --git a/test/e2e/download.e2e.test.ts b/test/e2e/download.e2e.test.ts
index 0ade576..e0ef3bc 100644
--- a/test/e2e/download.e2e.test.ts
+++ b/test/e2e/download.e2e.test.ts
@@ -22,3 +22,6 @@ import {
   runTeardown,
+  servarrFailure,
+  wired,
   type DeployedMediaplane,
+  type WireActions,
 } from './helpers';
@@ -147,38 +150,2 @@ async function getJson<T>(
 
-/**
- * Why an arr refused a request, safe for CI's public log: the status, and each validation
- * error's `propertyName: errorMessage`, with every one of `secrets` replaced. Never the
- * raw body, nor an error's `attemptedValue`, which can be the key under test. A body that
- * isn't such a list gives only its length.
- */
-async function servarrFailure(
-  response: Response,
-  secrets: readonly string[],
-): Promise<string> {
-  const status = `status ${String(response.status)}`;
-  const body = await response.text();
-  let parsed: unknown;
-  try {
-    parsed = JSON.parse(body);
-  } catch {
-    return `${status}, with ${String(body.length)} characters that aren't JSON`;
-  }
-  if (!Array.isArray(parsed)) {
-    return `${status}, with ${String(body.length)} characters of JSON that isn't a list`;
-  }
-  const text = (value: unknown) => (typeof value === 'string' ? value : '?');
-  const said = parsed.map((item: unknown) => {
-    const { propertyName, errorMessage } = (
-      typeof item === 'object' && item !== null ? item : {}
-    ) as Record<string, unknown>;
-    return `${text(propertyName)}: ${text(errorMessage)}`;
-  });
-  return secrets
-    .filter((secret) => secret !== '')
-    .reduce(
-      (message, secret) => message.replaceAll(secret, '***'),
-      `${status}: ${said.join('; ')}`,
-    );
-}
-
 interface Client {
@@ -386,14 +353,2 @@ async function wrongSonarrKey(home: string): Promise<void> {
 
-interface WireActions {
-  outcome: string;
-  actions: { step: string; resource?: string; detail?: string }[];
-}
-
-/** Each wired resource's detail, in order. */
-function wired(actions: WireActions['actions']): string[][] {
-  return actions
-    .filter((a) => a.resource !== undefined)
-    .map((a) => [a.resource ?? '', a.detail ?? '']);
-}
-
 describe('the download path, behind the VPN', () => {
```

**Change** `test/e2e/wireguard.ts`:

```diff
diff --git a/test/e2e/wireguard.ts b/test/e2e/wireguard.ts
index 460634f..4eb21e1 100644
--- a/test/e2e/wireguard.ts
+++ b/test/e2e/wireguard.ts
@@ -5,3 +5,9 @@ import { join } from 'node:path';
 import { nodeExec } from '@mediaplane/engine';
-import { BUSYBOX, removeAsRoot } from './helpers';
+import {
+  BUSYBOX,
+  docker,
+  publishedPort,
+  removeAsRoot,
+  removeOrIgnoreMissing,
+} from './helpers';
 
@@ -79,32 +85,2 @@ export function wireguardKeys(): { privateKey: string; publicKey: string } {
 
-async function docker(...args: string[]): Promise<string> {
-  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
-  if (result.code !== 0) {
-    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
-  }
-  return result.stdout.trim();
-}
-
-/** The host port Docker chose for a container's `port` (such as "51820/udp"). */
-async function publishedPort(container: string, port: string): Promise<number> {
-  const output = await docker('port', container, port);
-  const [first] = output.split('\n');
-  const published = Number(first?.split(':').at(-1));
-  if (!Number.isInteger(published) || published < 1 || published > 65535) {
-    throw new Error(`docker port ${container} ${port} gave no host port:\n${output}`);
-  }
-  return published;
-}
-
-/**
- * A removal that must not fail silently: a non-zero exit is an error, unless stderr says
- * the thing was already gone ("No such container", or "network … not found").
- */
-async function removeOrIgnoreMissing(...args: string[]): Promise<void> {
-  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
-  if (result.code !== 0 && !/No such|not found/.test(result.stderr)) {
-    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
-  }
-}
-
 async function addressOn(container: string, network: string): Promise<string> {
```

**Create** `test/e2e/indexer.ts`:

```ts
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec } from '@mediaplane/engine';
import { BUSYBOX, docker, publishedPort, removeOrIgnoreMissing } from './helpers';

/**
 * A made-up indexer for the indexer test, so that it never touches a real one: a minimal
 * Torznab feed (Prowlarr's "Generic Torznab"), served by busybox httpd on a network of its
 * own, outside the stack, as an indexer on the internet would be. It knows two made-up
 * items, a TV episode and a film, whatever it is asked.
 *
 * Its protected feed stands in for a site behind Cloudflare: a client without its
 * clearance cookie gets Cloudflare's challenge (a 503 from `Server: cloudflare`), but a
 * browser gets the feed and the cookie. Prowlarr sees the challenge, has the indexer
 * proxy's browser (Byparr's or FlareSolverr's) fetch the page, and asks again with the
 * cookie it got. A browser is told apart by the header it sends when it opens a page,
 * which Prowlarr's own requests don't (Upgrade-Insecure-Requests).
 */
export interface FakeIndexer {
  /** Where the stack's containers reach it: the network's gateway, and its port there. */
  url: string;
  /** The API path of the open feed, and of the protected one, as Prowlarr takes them. */
  open: string;
  protected: string;
  /** How many times a browser has passed the protected feed's challenge. */
  browserVisits(): Promise<number>;
  /** Remove the container, the network and the files. Safe to call more than once. */
  remove(): Promise<void>;
}

/** What the fake indexer logs when a browser passes its challenge. */
const PASSED = 'fake-indexer: a browser passed the challenge';

/**
 * The CGI script behind both feeds. The header ends in CRLF, as Node's fetch insists. A
 * challenge is answered with its own status line, which busybox httpd passes on. The feed
 * is application/xml: a browser would download application/rss+xml rather than show it.
 */
const SCRIPT = [
  '#!/bin/sh',
  'case "$SCRIPT_NAME" in',
  '  */protected)',
  '    case "$HTTP_COOKIE" in',
  '      *cf_clearance=fake-clearance*) ;;',
  '      *)',
  '        if [ "$HTTP_UPGRADE_INSECURE_REQUESTS" = 1 ]; then',
  `          echo '${PASSED}' >&2`,
  "          printf 'Set-Cookie: cf_clearance=fake-clearance; Path=/\\r\\n'",
  '        else',
  "          printf 'HTTP/1.1 503 Service Unavailable\\r\\nServer: cloudflare\\r\\nContent-Type: text/html\\r\\n\\r\\n'",
  "          printf '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>\\n'",
  '          exit 0',
  '        fi',
  '        ;;',
  '    esac',
  '    ;;',
  'esac',
  "printf 'Content-Type: application/xml\\r\\n\\r\\n'",
  'case "$QUERY_STRING" in',
  '  *t=caps*)',
  "    cat <<'EOF'",
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<caps>',
  '  <server title="Fake indexer"/>',
  '  <limits max="100" default="100"/>',
  '  <searching>',
  '    <search available="yes" supportedParams="q"/>',
  '    <tv-search available="yes" supportedParams="q,season,ep"/>',
  '    <movie-search available="yes" supportedParams="q"/>',
  '  </searching>',
  '  <categories>',
  '    <category id="2000" name="Movies"/>',
  '    <category id="5000" name="TV"/>',
  '  </categories>',
  '</caps>',
  'EOF',
  '    ;;',
  '  *)',
  "    cat <<'EOF'",
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">',
  '  <channel>',
  '    <title>Fake indexer</title>',
  ...[
    ['1', 'Mediaplane Test Show S01E01', '5000'],
    ['2', 'Mediaplane Test Movie 2026', '2000'],
  ].flatMap(([id = '', title = '', category = '']) => [
    '    <item>',
    `      <title>${title}</title>`,
    `      <guid>fake-indexer-${id}</guid>`,
    `      <link>http://indexer.invalid/fake/${id}.torrent</link>`,
    '      <pubDate>Thu, 01 Oct 2026 12:00:00 +0000</pubDate>',
    '      <size>1073741824</size>',
    `      <enclosure url="http://indexer.invalid/fake/${id}.torrent" length="1073741824" type="application/x-bittorrent"/>`,
    `      <torznab:attr name="category" value="${category}"/>`,
    '      <torznab:attr name="seeders" value="10"/>',
    '      <torznab:attr name="peers" value="12"/>',
    '    </item>',
  ]),
  '  </channel>',
  '</rss>',
  'EOF',
  '    ;;',
  'esac',
  '',
].join('\n');

/** Start the fake indexer, as `<id>-indexer` on `<id>-indexer-net`. */
export async function startFakeIndexer(id: string): Promise<FakeIndexer> {
  const network = `${id}-indexer-net`;
  const container = `${id}-indexer`;
  const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-indexer-'));
  let removed = false;
  const remove = async () => {
    if (removed) return;
    removed = true;
    // Every removal runs, even when one before it fails; the failures are reported after.
    const failures: unknown[] = [];
    for (const step of [
      () => removeOrIgnoreMissing('rm', '-f', '-v', container),
      () => removeOrIgnoreMissing('network', 'rm', network),
      // The server only reads its files: they are this user's.
      () => rm(dir, { recursive: true, force: true }),
    ]) {
      try {
        await step();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `could not remove all of ${id}'s fake indexer`);
    }
  };
  try {
    await mkdir(join(dir, 'www', 'cgi-bin'), { recursive: true });
    for (const feed of ['api', 'protected']) {
      const path = join(dir, 'www', 'cgi-bin', feed);
      await writeFile(path, SCRIPT);
      await chmod(path, 0o755);
    }
    await docker('network', 'create', network);
    const gateway = await docker(
      'network',
      'inspect',
      '--format',
      '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
      network,
    );
    // --init: busybox httpd as PID 1 would not stop on SIGTERM.
    await docker(
      'run',
      '-d',
      '--init',
      '--name',
      container,
      '--network',
      network,
      '-p',
      `${gateway}::80`,
      '-v',
      `${join(dir, 'www')}:/www:ro`,
      BUSYBOX,
      'httpd',
      '-f',
      '-p',
      '80',
      '-h',
      '/www',
    );
    return {
      url: `http://${gateway}:${String(await publishedPort(container, '80/tcp'))}`,
      open: '/cgi-bin/api',
      protected: '/cgi-bin/protected',
      browserVisits: async () => {
        const logs = await nodeExec('docker', ['logs', container], {
          cwd: '/',
          timeoutMs: 120_000,
        });
        if (logs.code !== 0) throw new Error(`docker logs failed:\n${logs.stderr}`);
        return (logs.stdout + logs.stderr).split('\n').filter((l) => l === PASSED).length;
      },
      remove,
    };
  } catch (cause) {
    try {
      await remove();
    } catch (cleanup) {
      throw new AggregateError(
        [cause, cleanup],
        'the fake indexer failed to start, and cleaning up failed too',
        { cause: cleanup },
      );
    }
    throw cause;
  }
}
```

**Create** `test/e2e/indexers.e2e.test.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  composeDown,
  expectWiringRemoved,
  makeHome,
  runTeardown,
  servarrFailure,
  stackFor,
  wired,
} from './helpers';
import { startFakeIndexer, type FakeIndexer } from './indexer';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-indexers`;
/** Prowlarr's web UI, on 127.0.0.1. */
const PROWLARR = 9696;
/** What the stack wires, in the order apply wires it: Prowlarr after the arrs. */
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
  'prowlarr.admin',
  'prowlarr.application_sonarr',
  'prowlarr.application_radarr',
  'prowlarr.indexer_proxy',
];
/** Each arr, and its web UI's port. */
const ARRS = [
  { app: 'sonarr', port: 8989 },
  { app: 'radarr', port: 7878 },
] as const;
/** The made-up items the fake indexer knows. */
const ITEMS = ['Mediaplane Test Movie 2026', 'Mediaplane Test Show S01E01'];

/**
 * How the test calls an app: with this key, and every key the stack stores kept out of
 * what a failure says, since CI's log is public.
 */
interface Access {
  key: string;
  secrets: readonly string[];
}

/** A call to an app's API on its published port, with its key, as JSON. */
function api(
  port: number,
  path: string,
  key: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-Api-Key': key,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(120_000),
  });
}

/** A GET of an app's API, as JSON, after checking it answered 2xx. */
async function getJson<T>(port: number, path: string, access: Access): Promise<T> {
  const response = await api(port, path, access.key);
  const what = `GET ${path} on port ${String(port)}`;
  expect(
    response.ok,
    `${what}: ${await servarrFailure(response.clone(), access.secrets)}`,
  ).toBe(true);
  return (await response.json()) as T;
}

interface Provider {
  id: number;
  name: string;
  implementation: string;
  syncLevel?: string;
  tags: number[];
  fields: { name: string; value?: unknown }[];
}

function settingOf(held: Provider | undefined, name: string): unknown {
  return held?.fields.find((f) => f.name === name)?.value;
}

/** Ask `check` again, each second, until it holds or `seconds` have gone. */
async function eventually(check: () => Promise<boolean>, seconds = 60): Promise<void> {
  for (let tried = 0; tried < seconds && !(await check()); tried++) {
    await new Promise((done) => setTimeout(done, 1000));
  }
}

/**
 * Add a fake indexer in Prowlarr, as you would in its web UI: Generic Torznab, at `feed`,
 * with `tags`. Prowlarr tests it as it saves it: it fetches the feed's caps and a search.
 */
async function addIndexer(
  prowlarr: Access,
  indexer: FakeIndexer,
  name: string,
  feed: string,
  tags: number[],
): Promise<number> {
  const added = await api(PROWLARR, '/api/v1/indexer', prowlarr.key, {
    method: 'POST',
    body: {
      name,
      implementation: 'Torznab',
      configContract: 'TorznabSettings',
      protocol: 'torrent',
      enable: true,
      appProfileId: 1,
      priority: 25,
      tags,
      fields: [
        { name: 'baseUrl', value: indexer.url },
        { name: 'apiPath', value: feed },
        { name: 'apiKey', value: 'fake-indexer-key' },
      ],
    },
  });
  expect(
    added.status,
    `Prowlarr did not add ${name}: ${await servarrFailure(added.clone(), prowlarr.secrets)}`,
  ).toBe(201);
  return ((await added.json()) as { id: number }).id;
}

/** The titles a search of Prowlarr's indexer `id` finds. */
async function searched(prowlarr: Access, id: number): Promise<string[]> {
  const found = await getJson<{ title: string }[]>(
    PROWLARR,
    `/api/v1/search?query=Mediaplane&type=search&indexerIds=${String(id)}`,
    prowlarr,
  );
  return found.map((release) => release.title).sort();
}

/**
 * What the slice asks of Prowlarr, read back from it: a link to each arr, with full sync,
 * reaching it by its service and port and reached back, which Prowlarr's own test passes,
 * syncing Prowlarr's own categories for that app; and the indexer proxy, tagged
 * cloudflare, aimed at the stack's solver. Returns the tag's id.
 */
async function expectLinks(prowlarr: Access, solver: string): Promise<number> {
  const links = await getJson<Provider[]>(PROWLARR, '/api/v1/applications', prowlarr);
  const templates = await getJson<Provider[]>(
    PROWLARR,
    '/api/v1/applications/schema',
    prowlarr,
  );
  // Prowlarr lists them by name.
  expect(
    links.map((l) => [
      l.name,
      l.syncLevel,
      settingOf(l, 'baseUrl'),
      settingOf(l, 'prowlarrUrl'),
    ]),
  ).toEqual([
    ['Radarr (Mediaplane)', 'fullSync', 'http://radarr:7878', 'http://prowlarr:9696'],
    ['Sonarr (Mediaplane)', 'fullSync', 'http://sonarr:8989', 'http://prowlarr:9696'],
  ]);
  for (const link of links) {
    const template = templates.find((t) => t.implementation === link.implementation);
    expect(settingOf(link, 'syncCategories'), `${link.name}'s categories`).toEqual(
      settingOf(template, 'syncCategories'),
    );
    // Prowlarr's own test: it calls the arr with the arr's key, and the arr calls it back.
    const tested = await api(PROWLARR, '/api/v1/applications/test', prowlarr.key, {
      method: 'POST',
      body: link,
    });
    expect(
      tested.status,
      `${link.name}: ${await servarrFailure(tested.clone(), prowlarr.secrets)}`,
    ).toBe(200);
  }
  const tags = await getJson<{ id: number; label: string }[]>(
    PROWLARR,
    '/api/v1/tag',
    prowlarr,
  );
  const cloudflare = tags.find((t) => t.label === 'cloudflare');
  if (cloudflare === undefined) throw new Error('Prowlarr has no cloudflare tag');
  const proxies = await getJson<Provider[]>(PROWLARR, '/api/v1/indexerproxy', prowlarr);
  expect(
    proxies.map((p) => [p.name, p.implementation, settingOf(p, 'host'), p.tags]),
  ).toEqual([
    [
      'Cloudflare (Mediaplane)',
      'FlareSolverr',
      `http://${solver}:8191/`,
      [cloudflare.id],
    ],
  ]);
  return cloudflare.id;
}

/**
 * Give Prowlarr's link to Sonarr a key that isn't Sonarr's, as a hand-made change would:
 * saved with forceSave, since Prowlarr's own test of it fails.
 */
async function wrongSonarrKey(prowlarr: Access): Promise<void> {
  const links = await getJson<Provider[]>(PROWLARR, '/api/v1/applications', prowlarr);
  const link = links.find((l) => l.name === 'Sonarr (Mediaplane)');
  if (link === undefined) throw new Error('Prowlarr has no link to Sonarr');
  const wrong = '9'.repeat(32);
  const put = await api(
    PROWLARR,
    `/api/v1/applications/${String(link.id)}?forceSave=true`,
    prowlarr.key,
    {
      method: 'PUT',
      body: {
        ...link,
        fields: link.fields.map((f) =>
          f.name === 'apiKey' ? { ...f, value: wrong } : f,
        ),
      },
    },
  );
  expect(
    put.status,
    `Prowlarr did not save the link: ${await servarrFailure(put.clone(), [wrong, ...prowlarr.secrets])}`,
  ).toBe(202);
}

describe('indexers, through Prowlarr', () => {
  it('reach Sonarr and Radarr, through Byparr or FlareSolverr when tagged cloudflare', async () => {
    const home = await makeHome();
    const indexer = await startFakeIndexer(PROJECT);
    /**
     * Every removal, each whether or not the one before it worked. Each command is bounded
     * by TEARDOWN_MS (120 s): the test's timeout leaves room for them.
     */
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
        () => indexer.remove(),
      ]);
    try {
      // The video stack without Seerr: Prowlarr brings Byparr.
      const data = join(home, 'data');
      await writeFile(join(home, 'stack.yaml'), stackFor(data, { seerr: false }));
      const runtime = createDockerRuntime({ home, project: PROJECT });
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        project: PROJECT,
        confirm: () => Promise.resolve(true),
      };

      // Prowlarr links to Sonarr and Radarr after them, and makes its proxy. Its own test
      // of the new proxy has Byparr fetch a page of Prowlarr's own service.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      expect(wired(first.actions).slice(-4)).toEqual([
        ['prowlarr.admin', 'created'],
        ['prowlarr.application_sonarr', 'created'],
        ['prowlarr.application_radarr', 'created'],
        ['prowlarr.indexer_proxy', 'created'],
      ]);
      const store = await readSecretStore(home);
      const secrets = Object.values(store.apps).flatMap((keys) => Object.values(keys));
      const access = (app: string): Access => {
        const key = store.apps[app]?.apiKey ?? '';
        expect(key !== '', `no ${app} key stored`).toBe(true);
        return { key, secrets };
      };
      const prowlarr = access('prowlarr');
      const cloudflare = await expectLinks(prowlarr, 'byparr');
      // resources.json names the links' secret, and never holds it.
      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      for (const arr of ARRS) {
        expect(
          resources.includes(access(arr.app).key),
          `resources.json holds ${arr.app}'s key`,
        ).toBe(false);
      }

      // Two indexers you add in Prowlarr: one open, and one behind a challenge, tagged
      // cloudflare. Prowlarr fetches the second through Byparr's browser, and both reach
      // the arrs, which Prowlarr adds them to.
      await addIndexer(prowlarr, indexer, 'Open indexer', indexer.open, []);
      expect(await indexer.browserVisits()).toBe(0);
      const guarded = await addIndexer(
        prowlarr,
        indexer,
        'Protected indexer',
        indexer.protected,
        [cloudflare],
      );
      expect(await indexer.browserVisits()).toBeGreaterThan(0);
      expect(await searched(prowlarr, guarded)).toEqual(ITEMS);
      for (const arr of ARRS) {
        const names = async () =>
          (
            await getJson<{ name: string }[]>(
              arr.port,
              '/api/v3/indexer',
              access(arr.app),
            )
          )
            .map((i) => i.name)
            .sort();
        await eventually(async () => (await names()).length === 2);
        expect(await names(), `${arr.app}'s indexers`).toEqual([
          'Open indexer (Prowlarr)',
          'Protected indexer (Prowlarr)',
        ]);
      }

      // A key in Prowlarr's link to Sonarr that isn't Sonarr's, as a hand-made change
      // would leave it: Prowlarr's own test refuses it, naming it, so apply sets it again.
      await wrongSonarrKey(prowlarr);
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(
        wired(restored.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([['prowlarr.application_sonarr', 'updated apiKey']]);
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // FlareSolverr instead of Byparr: the proxy is aimed at it, and a new indexer
      // behind the challenge goes through FlareSolverr's browser.
      await writeFile(
        join(home, 'stack.yaml'),
        `${stackFor(data, { seerr: false })}  flaresolverr: {}\n`,
      );
      const switched = await apply(options);
      expect(switched.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(switched.outcome).toBe('success');
      expect(
        wired(switched.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([['prowlarr.indexer_proxy', 'updated host']]);
      expect(
        (await runtime.containers())
          .filter((c) => c.service === 'byparr' || c.service === 'flaresolverr')
          .map((c) => `${c.service} ${c.state} ${c.health}`),
      ).toEqual(['flaresolverr running healthy']);
      expect(await expectLinks(prowlarr, 'flaresolverr')).toBe(cloudflare);
      const visits = await indexer.browserVisits();
      const second = await addIndexer(
        prowlarr,
        indexer,
        'Protected again',
        indexer.protected,
        [cloudflare],
      );
      expect(await indexer.browserVisits()).toBeGreaterThan(visits);
      expect(await searched(prowlarr, second)).toEqual(ITEMS);
      const settled = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(settled.outcome).toBe('no-changes');
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is only logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 1_200_000);
});
```

**Change** `test/e2e/apply.e2e.test.ts`:

```diff
diff --git a/test/e2e/apply.e2e.test.ts b/test/e2e/apply.e2e.test.ts
index 34bc83c..aa512ea 100644
--- a/test/e2e/apply.e2e.test.ts
+++ b/test/e2e/apply.e2e.test.ts
@@ -57,2 +57,5 @@ const WIRED = [
   'prowlarr.admin',
+  'prowlarr.application_sonarr',
+  'prowlarr.application_radarr',
+  'prowlarr.indexer_proxy',
 ];
@@ -275,2 +278,5 @@ describe('apply against real Docker', () => {
         ['prowlarr.admin', 'created'],
+        ['prowlarr.application_sonarr', 'created'],
+        ['prowlarr.application_radarr', 'created'],
+        ['prowlarr.indexer_proxy', 'created'],
       ]);
```

- [ ] **Step 3: Run the two to see them pass**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/apply.e2e.test.ts test/e2e/indexers.e2e.test.ts`
Expected: PASS. On the dev box each takes about a minute and a half, warm. The moved
helpers are S3c's download and VPN tests' too: Step 4 runs them.

- [ ] **Step 4: The whole suite, on both Composes, and nothing left behind**

The VPN and download tests need the `wireguard` module:
`test -d /sys/module/wireguard || sudo modprobe wireguard`.

Run: `pnpm test:e2e`, alone on the machine, with the Compose plugin of the dev box
(5.5.1). Then again with Compose 2.38.2 as the host plugin: a `DOCKER_CONFIG` folder
whose `cli-plugins/docker-compose` is Compose 2.38.2, as CI's runners have.
Expected: 7 files pass with each, the 6 of Slice 3c and `indexers.e2e.test.ts`.
Afterwards these print nothing:

```bash
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e --format '{{.Name}}'
```

The completion checklist records the times.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): indexers added in Prowlarr reach both arrs, through Byparr or FlareSolverr" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, and the slices after S4 renumbered

The §9 documentation set for what Tasks 1 to 3 built and tested, and nothing more; then
the owner's renumbering of 2026-10-15. Every diagram is a `text` block of at most 40
columns.

Decision: the wiring-failed runbook adds what S4 can say: the skipped link, Prowlarr's
proxy that can't be made (with a real run's lines), its link test failing for another
reason than the key, and the names Prowlarr already has; the app-won't-start runbook, a
Byparr that never becomes healthy without the internet (decisions 3, 4, 6).
Decision: the architecture adds the indexers (a diagram and four points); the threat
model adds the arrs' keys in Prowlarr (an asset, T4, T5, T10), what a failing key test
records in the app, and the Cloudflare solver (T15); "Not built yet" and "What comes
next" use the new numbers (decisions 1 to 6, 13).
Decision: the README's status, capabilities, flow and questions say what works now; its
example's wiring lines are a real run of the same stack with this slice, and its change
record stays the one its `status` shows (decision 13).
Decision: Prowlarr's README says how to tag an indexer `cloudflare` (spec §6.2), what the
proxy needs of the internet, and that a link stays when its arr leaves (decisions 6, 11).
Decision: the spec gains a "Slice 4" entry in §11, and a sentence in Slice 3c's on what
the download client's test records; the roadmap marks S4 done, splits the media servers,
adds four S8 items, and notes Seerr's `comingIn` in S7's (decisions 3, 11, 13, 14).
Decision: Seerr's README, the threat model and the deploy guide say Seerr's setup stays
open until Slice 7 with Plex (decision 14).
Decision: the renumbering maps each reference by meaning (Global Constraints); Plex's
`login.comingIn` is Slice 7, and a catalog test pins every app's (decision 13).

**Files:**
- Modify: `catalog/plex/app.ts`, `packages/cli/src/init.ts`,
  `packages/engine/src/config/schema.ts`, `docs/runbooks/wiring-failed.md`,
  `docs/runbooks/app-wont-start.md`, `docs/architecture.md`, `docs/security/threat-model.md`, `README.md`,
  `catalog/prowlarr/README.md`, `catalog/byparr/README.md`,
  `catalog/flaresolverr/README.md`, `catalog/sonarr/README.md`,
  `catalog/radarr/README.md`, `catalog/qbittorrent/README.md`,
  `catalog/plex/README.md`, `catalog/seerr/README.md`, `deploy/README.md`,
  `CONTRIBUTING.md`, `docs/adr/0006-seerr-as-the-requests-app.md`,
  `docs/adr/0011-a-private-wiring-network.md`, `docs/design/m1-engine-cli.md`,
  `docs/plans/m1-roadmap.md`, `.github/workflows/ci.yml` (a comment)
- Test: `catalog/catalog.test.ts`
- Generated: `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** what Tasks 1 to 3 built, as their tests show it.
- **Produces:** nothing for other tasks.

- [ ] **Step 1: Write the failing test of the logins still to come**

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index c9d00fd..7d1ab5d 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -64,2 +64,14 @@ describe('catalog', () => {
 
+  it('names the slice that brings each login still to come', () => {
+    expect(
+      Object.fromEntries(
+        catalog.flatMap((app) =>
+          app.login === undefined || app.login === 'shared'
+            ? []
+            : [[app.id, app.login.comingIn]],
+        ),
+      ),
+    ).toEqual({ jellyfin: 'Slice 5', plex: 'Slice 7', seerr: 'Slice 6' });
+  });
+
   it("gives each Cloudflare solver a health check, and its API on the port Prowlarr's proxy names", () => {
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run catalog/catalog.test.ts`
Expected: FAIL in "names the slice that brings each login still to come": Plex says
`Slice 5`, where `Slice 7` is expected.

- [ ] **Step 3: The renumbered words in code, and the generated references**

**Change** `catalog/plex/app.ts`:

```diff
diff --git a/catalog/plex/app.ts b/catalog/plex/app.ts
index e5527e9..5d91aa7 100644
--- a/catalog/plex/app.ts
+++ b/catalog/plex/app.ts
@@ -25,3 +25,3 @@ export default defineApp({
   env: () => ({ VERSION: 'docker' }),
-  login: { comingIn: 'Slice 5' },
+  login: { comingIn: 'Slice 7' },
   experimental: false,
```

**Change** `packages/cli/src/init.ts`:

```diff
diff --git a/packages/cli/src/init.ts b/packages/cli/src/init.ts
index 5ce5403..fa08e09 100644
--- a/packages/cli/src/init.ts
+++ b/packages/cli/src/init.ts
@@ -328,3 +328,3 @@ export const NOTES = {
     'Media server: jellyfin needs no account. plex needs a Plex',
-    "account; Mediaplane can't claim it for you until Slice 5.",
+    "account; Mediaplane can't claim it for you until Slice 7.",
   ],
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index abd52b7..9953195 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -233,3 +233,3 @@ const stackShape = {
       token: secretRefSchema.describe(
-        'Your Plex token, as a secret reference. Checked to exist, but not used yet: claiming the server arrives in Slice 5.',
+        'Your Plex token, as a secret reference. Checked to exist, but not used yet: claiming the server arrives in Slice 7.',
       ),
@@ -279,3 +279,3 @@ const stackShape = {
     .describe(
-      'Keep mine values, by <app>.<resource>.<field>. Not used yet: drift detection arrives in Slice 7.',
+      'Keep mine values, by <app>.<resource>.<field>. Not used yet: drift detection arrives in Slice 8.',
     ),
@@ -285,3 +285,3 @@ const stackShape = {
     .describe(
-      'external: Mediaplane never writes this file, for when automation such as Ansible owns it. Today only init writes it, and init never overwrites. Matters from Slice 7.',
+      'external: Mediaplane never writes this file, for when automation such as Ansible owns it. Today only init writes it, and init never overwrites. Matters from Slice 8.',
     ),
```

Run: `pnpm vitest run catalog/catalog.test.ts`
Expected: PASS.

Run: `pnpm docs:generate`
Expected: it writes `docs/reference/stack.schema.json` and `docs/reference/stack-yaml.md`
(the Plex token's slice, and the drift slice of `overrides` and `managed_by`).

- [ ] **Step 4: The runbooks**

**Change** `docs/runbooks/wiring-failed.md`:

````diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 55f5866..4032b0a 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -4,5 +4,5 @@ Wiring is what `apply` does through each app's API once the apps run: today, the
 admin login in Sonarr, Radarr, Prowlarr and qBittorrent, qBittorrent's settings and its
-`tv` and `movies` categories, and in Sonarr and Radarr, qBittorrent as their download
-client and their root folders. Later slices add Prowlarr's links, the media server and
-the requests app.
+`tv` and `movies` categories, in Sonarr and Radarr, qBittorrent as their download client
+and their root folders, and in Prowlarr, its links to Sonarr and Radarr and its indexer
+proxy. Later slices add the media server and the requests app.
 
@@ -39,5 +39,6 @@ the requests app.
   A resource that needs a failed one is `skipped`, and the others still run. Sonarr's
-  download client needs qBittorrent's `tv` category, and Radarr's its `movies` one. So
-  when qBittorrent refuses the key, its resources fail and the download client is skipped
-  (the wiring lines only):
+  download client needs qBittorrent's `tv` category, and Radarr's its `movies` one;
+  Prowlarr's link to Sonarr needs `sonarr.admin`, and its link to Radarr `radarr.admin`.
+  So when qBittorrent refuses the key, its resources fail and the download client is
+  skipped (the wiring lines only):
 
@@ -53,2 +54,17 @@ the requests app.
 
+  A resource can fail on its own, while its app's others are done. Here Prowlarr couldn't
+  add its indexer proxy, because Byparr couldn't reach the page Prowlarr's test of a new
+  proxy asks for (trimmed):
+
+  ```console
+  Wiring the apps…
+    …
+    done    wiring prowlarr.admin: unchanged
+    done    wiring prowlarr.application_sonarr: unchanged
+    done    wiring prowlarr.application_radarr: unchanged
+    failed  wiring prowlarr.indexer_proxy: Prowlarr at http://prowlarr:9696 (172.20.0.4) refused the request (HTTP 400): Host: Unable to connect to proxy: HTTP request failed: [502:BadGateway] [POST] at [http://byparr:8191/v1]. Check the log surrounding this error for details (POST /api/v1/indexerproxy)
+    failed  wiring
+    skipped verify
+  ```
+
 - **`mediaplane plan`** warns with the same message, once for the app, and exits 2. It
@@ -73,3 +89,6 @@ the requests app.
   the arr's own test of it: a failure there is `sonarr.download_client (unknown: …)`,
-  with the arr's own words after `tested qBittorrent (Mediaplane), and it failed:`.
+  with the arr's own words after `tested qBittorrent (Mediaplane), and it failed:`. For
+  Prowlarr's links, it runs Prowlarr's test: a failure is
+  `prowlarr.application_sonarr (unknown: …)`, with Prowlarr's own words after
+  `tested Sonarr (Mediaplane), and it failed:`.
 - **`apply` stops at the containers step** with `could not leave the wiring network …`,
@@ -133,3 +152,3 @@ differ, and a `reason` when it is `unknown`.
     start it. If `plan` says `<app>.not-seeded`, follow the app's README.
-  - Slice 7 restores a key at its source for you.
+  - Slice 8 restores a key at its source for you.
 - **`refused the request (HTTP 403)`, with
@@ -169,5 +188,33 @@ differ, and a `reason` when it is `unknown`.
   run `apply` again.
+- **`Host: Unable to connect to proxy`, for `prowlarr.indexer_proxy`.** Prowlarr tests a
+  new indexer proxy as it saves it: it has the Cloudflare solver fetch
+  `https://prowlarr.servarr.com/v1/ping`, a page of Prowlarr's own service.
+  - With `HTTP request failed: [502:BadGateway]`, the solver answered, but couldn't load
+    that page. Byparr's log says why: run
+    `docker compose -p mediaplane logs --tail 20 byparr`, and look for
+    `Could not reach the target`. Look for what keeps the solver off the internet, such
+    as a firewall, a DNS that fails, or a `compose.override.yaml` that changes its
+    network, then run `apply` again. With FlareSolverr, read its log the same way.
+  - With `Resource temporarily unavailable (byparr:8191)` or `Connection refused`,
+    Prowlarr couldn't reach the solver at all: check that it runs and is healthy
+    (`mediaplane status byparr`).
+- **`tested Sonarr (Mediaplane), and it failed`** (or Radarr). Prowlarr's own test of its
+  link failed for another reason than the key, which Mediaplane would set again itself.
+  Prowlarr's words say which way:
+  - `BaseUrl: Unable to complete application test, cannot connect to Sonarr`: Prowlarr
+    can't reach Sonarr at `http://sonarr:8989`. Check that Sonarr runs and is healthy.
+  - `ProwlarrUrl: Prowlarr URL is invalid, Sonarr cannot connect to Prowlarr`: Sonarr
+    can't reach Prowlarr back at `http://prowlarr:9696`.
+
+  A `compose.override.yaml` that takes either app off the stack's network breaks both.
+  Fix that, then run `apply` again. When `apply` makes the link, the same words follow
+  `refused the request (HTTP 400):`, since Prowlarr tests a new link before it saves it.
+  While Sonarr isn't up, or its admin login is yet to be set, `plan` doesn't run the
+  test.
+
 - **`refused the request (HTTP 400): Name: Should be unique`.** Sonarr or Radarr already
-  has a download client called `qBittorrent (Mediaplane)` that isn't a qBittorrent one.
-  Rename or remove it in the app's web UI, then run `apply` again.
+  has a download client called `qBittorrent (Mediaplane)` that isn't a qBittorrent one,
+  or Prowlarr has an application called `Sonarr (Mediaplane)` or `Radarr (Mediaplane)`
+  of another kind, or an indexer proxy called `Cloudflare (Mediaplane)` that isn't a
+  FlareSolverr one. Rename or remove it in the app's web UI, then run `apply` again.
 - **`could not be reached`, `cut the connection` or `did not answer within … s`.** The
````

**Change** `docs/runbooks/app-wont-start.md`:

```diff
diff --git a/docs/runbooks/app-wont-start.md b/docs/runbooks/app-wont-start.md
index 870d07d..53881a5 100644
--- a/docs/runbooks/app-wont-start.md
+++ b/docs/runbooks/app-wont-start.md
@@ -46,2 +46,7 @@
   [Gluetun's README](../../catalog/gluetun/README.md)).
+- **Byparr never becomes healthy.** Its health check loads a web page from the internet,
+  so Byparr is marked unhealthy, and `apply` fails naming `byparr`, when it has no way
+  out. Look for what keeps it off the internet, such as a firewall or a DNS that fails.
+  A Cloudflare solver is of no use without the internet: to run without one, and so
+  without Prowlarr's indexer proxy, set `byparr: { enabled: false }`.
 - **The port is taken.** `plan` says the port "is already in use on this host"
```

- [ ] **Step 5: The architecture and the threat model**

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 0834d31..9ef6cce 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -3,4 +3,4 @@
 This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
-covering what is built so far (Slices 1 to 3a, 3d, 3b and 3c). The design describes the
-whole of M1; this page describes what exists.
+covering what is built so far (Slices 1 to 4). The design describes the whole of M1;
+this page describes what exists.
 
@@ -127,5 +127,5 @@ Not built yet:
 
-- the rest of the links between the apps: Prowlarr's to Sonarr and Radarr (Slice 4),
-  the media server (Slice 5) and the requests app (Slice 6);
-- drift detection, with Keep mine (Slice 7).
+- the rest of the links between the apps: Jellyfin (Slice 5), the requests app
+  (Slice 6) and Plex (Slice 7);
+- drift detection, with Keep mine (Slice 8).
 
@@ -290,5 +290,6 @@ exist, are on the same filesystem as the folder itself. qBittorrent saves into
 Wiring is what Mediaplane does through each app's API once the apps run. Today that is
-the shared admin login in Sonarr, Radarr, Prowlarr and qBittorrent, and the download
-path: qBittorrent's settings and categories, and Sonarr's and Radarr's download client
-and root folder.
+the shared admin login in Sonarr, Radarr, Prowlarr and qBittorrent; the download path:
+qBittorrent's settings and categories, and Sonarr's and Radarr's download client and
+root folder; and the indexers: Prowlarr's links to Sonarr and Radarr, and its indexer
+proxy.
 
@@ -349,2 +350,34 @@ mediaplane (the stack)
 
+- **The indexers:**
+
+  ```text
+  prowlarr
+    │ link "<arr> (Mediaplane)":
+    │ full sync, the arr's key
+    ▼
+  sonarr, radarr
+    your indexers, synced:
+    "<name> (Prowlarr)"
+
+  prowlarr ─► byparr
+    or flaresolverr: only for
+    indexers tagged cloudflare
+  ```
+
+  - Prowlarr comes after Sonarr and Radarr. For each, Prowlarr gets a link with full
+    sync: it reaches the arr at `http://<arr>:<port>`, and the arr reaches it back at
+    `http://prowlarr:9696`. Each link needs the arr's admin in place first: while the arr
+    isn't up, or its admin login is yet to be set, `plan` leaves the link's key for
+    `apply` to check.
+  - Prowlarr tests a link, and a proxy, as it saves a new one, and Mediaplane's check of
+    a link's key is the same test: Prowlarr calls the arr with the key, and the arr calls
+    Prowlarr back.
+  - The indexer proxy is the stack's Cloudflare solver, Byparr or FlareSolverr, as a
+    proxy of type FlareSolverr, tagged `cloudflare`. Prowlarr's test of a new proxy has
+    the solver fetch a page of Prowlarr's own service on the internet. The proxy holds no
+    secret, so nothing checks it again.
+  - The indexers are yours: you add them in Prowlarr, which syncs them to the arrs, and
+    sends those tagged `cloudflare` through the solver when their site answers with a
+    challenge.
+
 - **Each resource** is one of:
@@ -352,7 +385,7 @@ mediaplane (the stack)
     secret is checked by using it, never compared: signing in, or the app's own test, as
-    Sonarr's test of its download client. While a field differs, the secrets aren't
-    checked: the update sets them anyway. `plan` also leaves them unchecked until a
-    resource they require is in place (`unchanged` or `adopt`) and checked, since the
-    check could make what is missing, and `plan` changes nothing. `apply` doesn't check
-    again a secret its own plan found refused: it sets it.
+    Sonarr's test of its download client, or Prowlarr's of its link to Sonarr. While a
+    field differs, the secrets aren't checked: the update sets them anyway. `plan` also
+    leaves them unchecked until a resource they require is in place (`unchanged` or
+    `adopt`) and checked, since the check could make what is missing, and `plan` changes
+    nothing. `apply` doesn't check again a secret its own plan found refused: it sets it.
   - `adopt`: the app already holds it as wanted, but `state/resources.json` doesn't say
@@ -435,5 +468,6 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- the rest of the wiring, app by app (Slices 4 to 6);
-- drift detection (Slice 7);
-- releases (Slice 8);
+- the rest of the wiring, app by app: Jellyfin (Slice 5), the requests app (Slice 6)
+  and Plex (Slice 7);
+- drift detection (Slice 8);
+- releases (Slice 9);
 - the web panel (M2).
````

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index eb54e96..358b835 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -2,4 +2,3 @@
 
-This is the threat model for Mediaplane as built today: M1, up to and including Slice 3a,
-and Slices 3d, 3b and 3c.
+This is the threat model for Mediaplane as built today: M1, up to and including Slice 4.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -19,2 +18,3 @@ that power. None of them removes it.
 | qBittorrent's key, in Sonarr and Radarr      | Their download client's settings, in `appdata/`                       | It opens qBittorrent's API                                 |
+| Sonarr's and Radarr's keys, in Prowlarr      | Its links' settings, in `appdata/`                                    | They open Sonarr's and Radarr's APIs                       |
 | The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr and Prowlarr          |
@@ -102,3 +102,12 @@ host network, read-only mounts
   in the arr (`tvImportedCategory`, `movieImportedCategory`) and later deleted in
-  qBittorrent.
+  qBittorrent. It checks Prowlarr's links with Prowlarr's own test, which calls the arr
+  with its key, and has the arr call Prowlarr back. Either test, when it fails, records a
+  failure in that app's status of the client or link, as a test from the app's web UI
+  does; a later pass resets it.
+- **The Cloudflare solver.** Byparr, or FlareSolverr, runs a browser for Prowlarr on the
+  stack's own network. Its port is never published, it has no login, and it isn't on
+  the wiring network. Prowlarr sends it an indexer's request only for an indexer tagged
+  `cloudflare`, and only when the site answers with a Cloudflare challenge; when
+  Mediaplane adds the proxy, Prowlarr has it fetch a page of Prowlarr's own service, to
+  test it (see T15).
 - **vpn-check's probe.** `mediaplane vpn-check` runs
@@ -175,5 +184,5 @@ What remains:
 - On a home network, `init` suggests `bind: lan`, which puts the web UIs on your LAN.
-- Until the wiring lands (Slices 5 and 6), Jellyfin's wizard and Seerr's setup are open
-  to whoever reaches them first. Complete them right after the first `apply`, or keep
-  `bind: localhost` until you have.
+- Until the wiring lands (Slices 5 and 6, and Slice 7 with Plex), Jellyfin's wizard and
+  Seerr's setup are open to whoever reaches them first. Complete them right after the
+  first `apply`, or keep `bind: localhost` until you have.
 - With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
@@ -237,2 +246,4 @@ What remains:
   compromised one can drive qBittorrent: add a torrent, or change its settings.
+- Prowlarr holds Sonarr's and Radarr's keys, as its links need, so a compromised Prowlarr
+  can drive both: change their settings, or read their password hash (see T10).
 - The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
@@ -264,5 +275,6 @@ Controls today:
   quoted in an HTML page.
-- qBittorrent's key goes to Sonarr and Radarr in their download client's settings, a
-  request body: the one place one app's key goes to another. They show it masked
-  (`********`) afterwards, and Mediaplane tests the masked client, so the key isn't sent
+- qBittorrent's key goes to Sonarr and Radarr in their download client's settings, and
+  Sonarr's and Radarr's keys go to Prowlarr in its links' settings: request bodies, the
+  only places one app's key goes to another. They show it masked (`********`)
+  afterwards, and Mediaplane tests the masked client or link, so the key isn't sent
   again for the check.
@@ -330,5 +342,5 @@ What remains:
 - The audit needs the npm registry at CI time.
-- Nothing bumps pins or dependencies automatically yet (Renovate, Slice 8).
+- Nothing bumps pins or dependencies automatically yet (Renovate, Slice 9).
 - The catalog images are not scanned yet, and there is no SBOM or provenance yet. Both
-  arrive in Slice 8.
+  arrive in Slice 9.
 
@@ -373,3 +385,3 @@ What remains:
 - Sonarr, Radarr and Prowlarr give their password hash to anyone who holds their API
-  key. Prowlarr holds Sonarr's and Radarr's keys from Slice 4.
+  key. Prowlarr holds Sonarr's and Radarr's keys, for its links.
 - `apply` checks qBittorrent's password by signing in. qBittorrent bans an address from
@@ -382,3 +394,3 @@ What remains:
   what to do.
-- There is no way yet to rotate the generated password (Slice 7).
+- There is no way yet to rotate the generated password (Slice 8).
 
@@ -519,2 +531,26 @@ What remains:
 
+### T15. The Cloudflare solver fetches for whoever asks
+
+Controls today:
+
+- Byparr's or FlareSolverr's port is never published, and they are on the stack's own
+  network only, not the wiring network.
+- Prowlarr sends a request through the solver only for an indexer you tagged
+  `cloudflare`, and only when the site answers with a Cloudflare challenge.
+- Mediaplane never calls the solver. Prowlarr tests the proxy when Mediaplane adds it,
+  by having the solver fetch `https://prowlarr.servarr.com/v1/ping`; `plan` runs no such
+  test.
+
+What remains:
+
+- The solver has no login: any container on the stack's network can have its browser
+  load any address, your LAN included. qBittorrent behind the VPN reaches the stack's
+  network too, so a compromised qBittorrent could load a page through the solver,
+  outside the tunnel.
+- An indexer's request goes to the solver whole, with the indexer's own API key in its
+  address, and Byparr logs the addresses it fetches. Treat the solver's log like the
+  indexer's key.
+- The solver needs the internet: Byparr's health check loads a web page, and Prowlarr's
+  test fetches one from Prowlarr's service.
+
 ## What the proxy does not stop
```

- [ ] **Step 6: The READMEs, the deploy guide and CONTRIBUTING**

**Change** `README.md`:

```diff
diff --git a/README.md b/README.md
index 87539ee..83e7f3f 100644
--- a/README.md
+++ b/README.md
@@ -14,3 +14,5 @@ Compose and wires the apps together for you.**
 >   (`mediaplane credentials` shows it). It links Sonarr and Radarr to qBittorrent:
->   download clients, categories and root folders. `mediaplane vpn-check` confirms that
+>   download clients, categories and root folders. It links Prowlarr to Sonarr and
+>   Radarr, so the indexers you add in Prowlarr reach both, with Byparr as Prowlarr's
+>   proxy for indexers behind Cloudflare. `mediaplane vpn-check` confirms that
 >   qBittorrent reaches the internet only through the VPN. Mediaplane runs in its own
@@ -18,6 +20,5 @@ Compose and wires the apps together for you.**
 >   private network with no route out.
-> - **Next:** the rest of the wiring: Prowlarr's links to Sonarr and Radarr, the media
->   server and Seerr. Until that lands, those still need setting up by hand. Jellyfin's
->   wizard and Seerr's setup are open to anyone who can reach them until you complete
->   them, so complete them first.
+> - **Next:** the rest of the wiring: Jellyfin, then Seerr, then Plex. Until that lands,
+>   those still need setting up by hand. Jellyfin's wizard and Seerr's setup are open to
+>   anyone who can reach them until you complete them, so complete them first.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -63,3 +64,4 @@ Mediaplane does that part for you:
 | Link Sonarr and Radarr to qBittorrent: download clients, categories, root folders | Done         |
-| Wire the rest together (Prowlarr's links, media server, requests)                 | Planned      |
+| Link Prowlarr to Sonarr and Radarr, with Byparr or FlareSolverr as its proxy      | Done         |
+| Wire the rest together (media server, requests)                                   | Planned      |
 | Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
@@ -126,4 +128,4 @@ mediaplane apply
   ├─ wires the apps through their
-  │  APIs: the shared login, and
-  │  the download path, so far
+  │  APIs: the shared login, the
+  │  download path and indexers
   ├─ plans again: nothing left to do
@@ -132,3 +134,3 @@ mediaplane apply
 
-Next, `apply` will wire the rest of the apps through the same APIs (Slices 4 to 6).
+Next, `apply` will wire the rest of the apps through the same APIs (Slices 5 to 7).
 
@@ -155,3 +157,3 @@ A few principles hold throughout:
 Most of this is real output from a run on an arm64 VM, trimmed where marked. The wiring
-lines came later, from a run of the same stack with Slice 3c. The stack is
+lines came later, from a run of the same stack with Slice 4. The stack is
 the example above without the VPN, which is why `plan` warns about qBittorrent, and with
@@ -197,3 +199,6 @@ Wiring:
   > after start prowlarr.admin
-Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 11 wiring checks after the start.
+  > after start prowlarr.application_sonarr
+  > after start prowlarr.application_radarr
+  > after start prowlarr.indexer_proxy
+Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 14 wiring checks after the start.
 
@@ -220,3 +225,6 @@ Wiring the apps…
   done    wiring prowlarr.admin: created
-  done    wiring: qbittorrent.admin adopted; qbittorrent.preferences adopted; … prowlarr.admin created
+  done    wiring prowlarr.application_sonarr: created
+  done    wiring prowlarr.application_radarr: created
+  done    wiring prowlarr.indexer_proxy: created
+  done    wiring: qbittorrent.admin adopted; qbittorrent.preferences adopted; … prowlarr.indexer_proxy created
   done    verify: no changes remain
@@ -257,3 +265,3 @@ Sonarr       http://127.0.0.1:8989
 Mediaplane runs as its own container next to a Docker socket proxy, in a Compose
-project of its own. No image is published yet (that comes in Slice 8), so build one from
+project of its own. No image is published yet (that comes in Slice 9), so build one from
 a checkout:
@@ -361,4 +369,4 @@ The pipeline decides what the stack is, and Mediaplane does the stateful part. T
 that covers generating the keys, deploying, setting the shared login in the apps,
-linking Sonarr and Radarr to qBittorrent, and checking. The rest of the wiring and
-change detection are what is being built next.
+linking Sonarr and Radarr to qBittorrent and Prowlarr to them, and checking. The rest of
+the wiring and change detection are what is being built next.
 
@@ -377,2 +385,3 @@ and keep. What it adds is everything around the file:
 - Sonarr and Radarr linked to qBittorrent, with its categories and their root folders;
+- Prowlarr linked to Sonarr and Radarr, with a Cloudflare solver as its indexer proxy;
 - next, the rest of the wiring between the apps.
@@ -385,5 +394,5 @@ secrets, a socket proxy, a tested VPN kill switch, and a private wiring network.
 the apps to each other, with `plan` and `apply` and a history of what it did, and leaves
-the rest of each app's settings to you. Today it sets the shared login, and links Sonarr
-and Radarr to qBittorrent; Prowlarr's links, the media server and Seerr come in
-Slices 4 to 6.
+the rest of each app's settings to you. Today it sets the shared login, links Sonarr
+and Radarr to qBittorrent, and Prowlarr to them; the media servers and Seerr come in
+Slices 5 to 7.
 
@@ -434,5 +443,6 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   (packaging), S3a (the shared admin and pre-start files), S3d (the VPN's kill-switch
-  test and `vpn-check`), S3b (the wiring framework) and S3c (the download path).
-- **Next:** S4 (indexers).
-- **After that:** S5 to S8.
+  test and `vpn-check`), S3b (the wiring framework), S3c (the download path) and S4
+  (indexers).
+- **Next:** S5 (Jellyfin).
+- **After that:** S6 to S9: requests, Plex, drift detection, and the release.
 
@@ -458,3 +468,4 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **[Runbook: wiring failed](docs/runbooks/wiring-failed.md):** an app refused Mediaplane's
-  key or a change, an arr can't reach qBittorrent, or Mediaplane can't reach an app.
+  key or a change, an arr can't reach qBittorrent, Prowlarr can't make its proxy, or
+  Mediaplane can't reach an app.
 - **[Threat model](docs/security/threat-model.md):** what is protected, how, and what
```

**Change** `catalog/prowlarr/README.md`:

```diff
diff --git a/catalog/prowlarr/README.md b/catalog/prowlarr/README.md
index d07587b..a936ffb 100644
--- a/catalog/prowlarr/README.md
+++ b/catalog/prowlarr/README.md
@@ -50,4 +50,24 @@ folder, only its own config folder.
   the list, with commas between the names.
+- **Its links to Sonarr and Radarr** (`prowlarr.application_sonarr` and
+  `prowlarr.application_radarr`). For each of them in the stack, `apply` adds an
+  application to Prowlarr, `Sonarr (Mediaplane)` or `Radarr (Mediaplane)`, with full
+  sync, so that the indexers you add in Prowlarr reach the arr:
+  - Prowlarr reaches the arr as `http://sonarr:8989` or `http://radarr:7878`, and the arr
+    reaches Prowlarr back as `http://prowlarr:9696`, on the stack's network;
+  - it syncs Prowlarr's own categories for that app: TV (5000 and its subcategories) to
+    Sonarr, and Movies (2000 and its subcategories) to Radarr;
+  - its key is the arr's, which Prowlarr shows masked. `plan` and `apply` check it with
+    Prowlarr's own test of the link, which calls the arr with the key and has the arr
+    call Prowlarr back: a refused key is set again, and any other failure is Prowlarr's
+    own message. While the arr isn't up, or its admin login is yet to be set, `plan`
+    leaves that check to `apply`;
+  - its other settings, such as its tags, are yours: `apply` leaves them as they are.
+- **The indexer proxy** (`prowlarr.indexer_proxy`). `apply` adds the stack's Cloudflare
+  solver to Prowlarr as an indexer proxy, `Cloudflare (Mediaplane)`, of type FlareSolverr,
+  which Byparr answers too: `http://byparr:8191/`, or `http://flaresolverr:8191/` when you
+  list FlareSolverr, with a 60-second timeout and the tag `cloudflare`, which `apply`
+  makes in Prowlarr when it isn't there.
 - **Byparr.** Listing Prowlarr also turns on Byparr, the Cloudflare challenge solver,
-  unless you list FlareSolverr instead or set `byparr: { enabled: false }`.
+  unless you list FlareSolverr instead or set `byparr: { enabled: false }`. Without a
+  solver, there is no indexer proxy.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -57,4 +77,10 @@ folder, only its own config folder.
 
-Mediaplane never adds indexers. You add them once in Prowlarr, and from Slice 4 they sync
-to Sonarr and Radarr.
+Mediaplane never adds indexers. You add them once in Prowlarr, and it syncs them to Sonarr
+and Radarr, where they show as `<name> (Prowlarr)`. Change them in Prowlarr, not in the
+arrs: Prowlarr puts its own settings back.
+
+To send an indexer through the Cloudflare solver, give it the tag `cloudflare` in
+Prowlarr (Indexers, then edit the indexer, then Tags). Prowlarr sends an indexer through a
+proxy only when they share a tag. Even then it asks the indexer itself first, and turns
+to the solver only when the site answers with a Cloudflare challenge.
 
@@ -62,6 +88,6 @@ to Sonarr and Radarr.
 
-- **Slice 4:**
-  - the links to Sonarr and Radarr, with full sync;
-  - Byparr registered as Prowlarr's indexer proxy, with the tag `cloudflare`. Tag your
-    Cloudflare-protected indexers `cloudflare` to route them through it.
+- **Slice 8:** keeping a setting of your own in place of one Mediaplane manages ("Keep
+  mine"). Until then, the next `apply` puts back a link's addresses, sync level or
+  categories, or the proxy's host, timeout or tags, changed in Prowlarr's web UI. `plan`
+  shows it first.
 
@@ -97,2 +123,11 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
+- **The indexer proxy needs the internet to be made.** Prowlarr tests a new proxy as it
+  saves it: it has the solver fetch a page of Prowlarr's own service,
+  `https://prowlarr.servarr.com/v1/ping`. Without the internet, `apply` fails with
+  `Unable to connect to proxy: HTTP request failed: [502:BadGateway]`; the
+  [runbook](../../docs/runbooks/wiring-failed.md) says what to do. Byparr needs the
+  internet anyway: its health check loads a web page.
+- **A link stays when its arr leaves the stack.** Remove Sonarr or Radarr from
+  `stack.yaml`, and Mediaplane stops managing its link, but leaves it in Prowlarr, which
+  then reports it as failing. Delete it in Prowlarr's web UI (Settings, then Apps).
 - **Set up before Slice 3a.** If Prowlarr first started before Mediaplane wrote its
@@ -111,3 +146,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Prowlarr. Slice 7 does
+  `sudo mv`. The old file keeps your settings, to enter again in Prowlarr. Slice 8 does
   this for you.
```

**Change** `catalog/byparr/README.md`:

```diff
diff --git a/catalog/byparr/README.md b/catalog/byparr/README.md
index 9e0fb6c..3732880 100644
--- a/catalog/byparr/README.md
+++ b/catalog/byparr/README.md
@@ -31,9 +31,8 @@ image, unmodified. Listing Prowlarr turns it on.
   listening, the container would stay "starting" until the next check, 15 minutes later,
-  so `apply` would reach its ten-minute limit and fail.
-
-## Not built yet
-
-- **Slice 4:** registering Byparr as Prowlarr's indexer proxy, with the tag `cloudflare`.
-
-See the [roadmap](../../docs/plans/m1-roadmap.md).
+  so `apply` would reach its ten-minute limit and fail. Byparr's health check loads a web
+  page, so it needs the internet to pass.
+- **Prowlarr's indexer proxy.** `apply` adds Byparr to Prowlarr as its indexer proxy,
+  `Cloudflare (Mediaplane)`, with the tag `cloudflare`. Tag an indexer `cloudflare` in
+  Prowlarr to send it through Byparr: [Prowlarr's README](../prowlarr/README.md) says
+  how, and how Prowlarr tests the proxy.
 
@@ -42,4 +41,6 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 - **To use FlareSolverr instead,** list `flaresolverr: {}`. Prowlarr then doesn't turn
-  Byparr on. Listing both is an error.
-- **To run without a solver,** set `byparr: { enabled: false }`.
+  Byparr on, and `apply` aims Prowlarr's proxy at FlareSolverr. Listing both is an
+  error.
+- **To run without a solver,** set `byparr: { enabled: false }`. Mediaplane then adds no
+  proxy to Prowlarr, and leaves one it added before.
 - **In `stack.yaml`,** under `apps.byparr`, you can also set `version` and `env`.
```

**Change** `catalog/flaresolverr/README.md`:

```diff
diff --git a/catalog/flaresolverr/README.md b/catalog/flaresolverr/README.md
index 1ce60c6..0e5b83d 100644
--- a/catalog/flaresolverr/README.md
+++ b/catalog/flaresolverr/README.md
@@ -30,11 +30,9 @@ Prowlarr's indexers. Mediaplane runs the upstream image, unmodified, when you li
 - **`LOG_LEVEL=info`.**
-- **No health check.** The image has none, and Mediaplane adds none, so `apply` waits
-  only for it to be running.
-
-## Not built yet
-
-- **Slice 4:** registering FlareSolverr as Prowlarr's indexer proxy, with the tag
-  `cloudflare`.
-
-See the [roadmap](../../docs/plans/m1-roadmap.md).
+- **A health check of its own.** The image has none, so Mediaplane asks FlareSolverr's
+  `/health` every 30 seconds, and `apply` waits until it answers. Prowlarr tests a new
+  indexer proxy as it saves it, so FlareSolverr must answer before `apply` adds it.
+- **Prowlarr's indexer proxy.** `apply` adds FlareSolverr to Prowlarr as its indexer
+  proxy, `Cloudflare (Mediaplane)`, with the tag `cloudflare`, in place of Byparr. Tag an
+  indexer `cloudflare` in Prowlarr to send it through FlareSolverr:
+  [Prowlarr's README](../prowlarr/README.md) says how, and how Prowlarr tests the proxy.
 
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index b1a3e37..88c21db 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -66,2 +66,6 @@ LinuxServer.io image, unmodified.
   Sonarr. It is in the data folder, with the downloads, so an import is a hard link.
+- **Prowlarr's link to it.** With Prowlarr in the stack, `apply` adds Sonarr to Prowlarr
+  (`prowlarr.application_sonarr`, see [Prowlarr's README](../prowlarr/README.md)), with
+  Sonarr's key. Prowlarr then adds the indexers you add in Prowlarr to Sonarr, as
+  `<name> (Prowlarr)`, and keeps them in step: change them in Prowlarr, not here.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -71,7 +75,7 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 4 to 6 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 5 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 4:** Prowlarr's link to it.
-- **Slice 5:** the media server connection that refreshes your library on import.
+- **Slice 5:** the Jellyfin connection that refreshes your library on import.
 - **Slice 6:** Seerr's link to it.
+- **Slice 7:** the same connection for Plex.
 
@@ -111,3 +115,3 @@ The rest of the wiring arrives in Slices 4 to 6 (see the [roadmap](../../docs/pl
   Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Sonarr. Slice 7 does
+  `sudo mv`. The old file keeps your settings, to enter again in Sonarr. Slice 8 does
   this for you.
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 0bb2fac..bc09f3b 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -66,2 +66,6 @@ LinuxServer.io image, unmodified.
   Radarr. It is in the data folder, with the downloads, so an import is a hard link.
+- **Prowlarr's link to it.** With Prowlarr in the stack, `apply` adds Radarr to Prowlarr
+  (`prowlarr.application_radarr`, see [Prowlarr's README](../prowlarr/README.md)), with
+  Radarr's key. Prowlarr then adds the indexers you add in Prowlarr to Radarr, as
+  `<name> (Prowlarr)`, and keeps them in step: change them in Prowlarr, not here.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -71,7 +75,7 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 4 to 6 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 5 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 4:** Prowlarr's link to it.
-- **Slice 5:** the media server connection that refreshes your library on import.
+- **Slice 5:** the Jellyfin connection that refreshes your library on import.
 - **Slice 6:** Seerr's link to it.
+- **Slice 7:** the same connection for Plex.
 
@@ -120,3 +124,3 @@ The rest of the wiring arrives in Slices 4 to 6 (see the [roadmap](../../docs/pl
   Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Radarr. Slice 7 does
+  `sudo mv`. The old file keeps your settings, to enter again in Radarr. Slice 8 does
   this for you.
```

**Change** `catalog/qbittorrent/README.md`:

```diff
diff --git a/catalog/qbittorrent/README.md b/catalog/qbittorrent/README.md
index 3591ef5..d83125c 100644
--- a/catalog/qbittorrent/README.md
+++ b/catalog/qbittorrent/README.md
@@ -88,3 +88,3 @@ unmodified, and by default puts it behind Gluetun's VPN.
 Nothing for qBittorrent itself. Keeping a setting of your own in place of one Mediaplane
-manages ("Keep mine") comes in Slice 7. See the
+manages ("Keep mine") comes in Slice 8. See the
 [roadmap](../../docs/plans/m1-roadmap.md).
@@ -108,3 +108,3 @@ manages ("Keep mine") comes in Slice 7. See the
   next `apply`: the login, the save path, Automatic Torrent Management, who may skip the
-  login, and the two categories' save paths. `plan` shows it first. Slice 7 adds "Keep
+  login, and the two categories' save paths. `plan` shows it first. Slice 8 adds "Keep
   mine".
@@ -147,3 +147,3 @@ manages ("Keep mine") comes in Slice 7. See the
   sign in with what `mediaplane credentials` shows. The old file keeps your settings,
-  to enter again in qBittorrent. Slice 7 does this for you.
+  to enter again in qBittorrent. Slice 8 does this for you.
 
```

**Change** `catalog/plex/README.md`:

```diff
diff --git a/catalog/plex/README.md b/catalog/plex/README.md
index 4b3a5b4..0a44589 100644
--- a/catalog/plex/README.md
+++ b/catalog/plex/README.md
@@ -37,3 +37,3 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
 
-- **Slice 5:**
+- **Slice 7:**
   - `mediaplane plex-login`, which signs in through plex.tv and saves your token;
@@ -41,3 +41,4 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
   - the Movies and TV Shows libraries;
-  - the connections from Sonarr and Radarr.
+  - the connections from Sonarr and Radarr;
+  - with Seerr in the stack, its sign-in with your token, and its link to Plex.
 
@@ -64,3 +65,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **Plex starts unclaimed.** Until Slice 5 claims it for you, you can claim it yourself.
+- **Plex starts unclaimed.** Until Slice 7 claims it for you, you can claim it yourself.
   Get a claim token at `https://plex.tv/claim`. It expires within four minutes, so save it
```

**Change** `catalog/seerr/README.md`:

```diff
diff --git a/catalog/seerr/README.md b/catalog/seerr/README.md
index 1d50036..49c7528 100644
--- a/catalog/seerr/README.md
+++ b/catalog/seerr/README.md
@@ -42,6 +42,7 @@ Radarr. Mediaplane runs the upstream image, unmodified (see
 - **Slice 6:**
-  - Seerr's first sign-in, as the Jellyfin admin or with your Plex token;
-  - its links to the media server, Sonarr and Radarr;
+  - Seerr's first sign-in, as the Jellyfin admin;
+  - its links to Jellyfin, Sonarr and Radarr;
   - `apps.seerr.sonarr_profile` and `radarr_profile`, which choose the quality profiles
     it requests with.
+- **Slice 7:** with Plex, its first sign-in with your Plex token, and its link to Plex.
 
@@ -58,5 +59,5 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **Setup is open.** Until Slice 6, Seerr's setup page is open to whoever reaches it
-  first. Finish it yourself as soon as `apply` is done, or keep `network.bind: localhost`
-  until you have.
+- **Setup is open.** Until Slice 6 (Slice 7 with Plex), Seerr's setup page is open to
+  whoever reaches it first. Finish it yourself as soon as `apply` is done, or keep
+  `network.bind: localhost` until you have.
 - **Removing it needs `sudo`.** `appdata/seerr` belongs to uid 1000, so unless you are
```

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index fffd1de..00f5de7 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -13,7 +13,7 @@ never touch Mediaplane itself.
 
-> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent, but the rest of
-> the apps are not wired to each other yet (Slices 4 to 6 do that). On a home network,
-> `init` suggests publishing their web UIs on your LAN. Until the wiring lands,
-> Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
-> complete them, so complete them first.
+> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent, and Prowlarr to
+> them, but the media server and Seerr are not wired yet (Slices 5 to 7 do that). On a
+> home network, `init` suggests publishing their web UIs on your LAN. Until the wiring
+> lands, Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until
+> you complete them, so complete them first.
 >
@@ -40,3 +40,3 @@ never touch Mediaplane itself.
 
-No image is published yet: releases arrive in Slice 8. Build one from a checkout:
+No image is published yet: releases arrive in Slice 9. Build one from a checkout:
 
@@ -142,5 +142,5 @@ nothing. Without a terminal it asks nothing: pass the flags in the
 
-  Until the wiring lands (Slices 5 and 6), Jellyfin's setup wizard and Seerr's setup
-  are open to anyone on your LAN until you complete them. Complete them right after the
-  first `apply`.
+  Until the wiring lands (Slices 5 and 6, and Slice 7 with Plex), Jellyfin's setup wizard
+  and Seerr's setup are open to anyone on your LAN until you complete them. Complete them
+  right after the first `apply`.
 
@@ -231,3 +231,3 @@ docker compose -f deploy/mediaplane.compose.yaml up -d
 
-Once images are published (Slice 8), `docker compose -f deploy/mediaplane.compose.yaml pull`
+Once images are published (Slice 9), `docker compose -f deploy/mediaplane.compose.yaml pull`
 replaces the build. Updating Mediaplane never restarts your stack.
```

**Change** `CONTRIBUTING.md`:

```diff
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
index 9d54d34..5ee2655 100644
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -51,2 +51,8 @@ through Gluetun, runs a WireGuard server too, so it needs the module as well.
 
+The indexers test (`test/e2e/indexers.e2e.test.ts`) serves made-up indexers of its own,
+from a container outside the stack, so it never touches a real one. It needs the
+internet all the same, as the apply test does: Byparr's health check loads a web page,
+and Prowlarr tests its new proxy by having Byparr fetch a page of Prowlarr's own
+service.
+
 Before committing, run
```

- [ ] **Step 7: The ADRs, the spec, the roadmap and CI's comment**

**Change** `docs/adr/0006-seerr-as-the-requests-app.md`:

```diff
diff --git a/docs/adr/0006-seerr-as-the-requests-app.md b/docs/adr/0006-seerr-as-the-requests-app.md
index 58b355e..973383c 100644
--- a/docs/adr/0006-seerr-as-the-requests-app.md
+++ b/docs/adr/0006-seerr-as-the-requests-app.md
@@ -22,5 +22,5 @@ Seerr, version 3.5 or later, is M1's requests app (spec §2.1, §6.1, §6.5):
 
-- **It works with both media servers.** The wiring (Slice 6) will sign in to it as the
-  Jellyfin admin Mediaplane created (`POST /api/v1/auth/jellyfin`), or with the user's
-  Plex token (`POST /api/v1/auth/plex`).
+- **It works with both media servers.** The wiring will sign in to it as the Jellyfin
+  admin Mediaplane created (`POST /api/v1/auth/jellyfin`, Slice 6), or with the user's
+  Plex token (`POST /api/v1/auth/plex`, Slice 7).
 - **Its settings API covers the wiring:**
```

**Change** `docs/adr/0011-a-private-wiring-network.md`:

```diff
diff --git a/docs/adr/0011-a-private-wiring-network.md b/docs/adr/0011-a-private-wiring-network.md
index 9fb1c62..4bc4afc 100644
--- a/docs/adr/0011-a-private-wiring-network.md
+++ b/docs/adr/0011-a-private-wiring-network.md
@@ -76,3 +76,3 @@ network with containers that have one. The owner chose how to reach the apps on
   [threat model](../security/threat-model.md). It needs no internet in M1 except
-  plex.tv, in Slice 5, which a short-lived helper will reach for it. The apps' own
+  plex.tv, in Slice 7, which a short-lived helper will reach for it. The apps' own
   internet traffic is unchanged.
```

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 98ac12e..7d181e3 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -942,3 +942,3 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   started with `docker compose -f deploy/mediaplane.compose.yaml up -d`. Until
-  images are published (S8), it needs `MEDIAPLANE_IMAGE`, the image to run. It
+  images are published (S9), it needs `MEDIAPLANE_IMAGE`, the image to run. It
   also needs `DOCKER_GID`, the group that owns the Docker socket.
@@ -962,3 +962,3 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   see because they are bundled. Neither sees Node itself. Scanning the catalog
-  images, the SBOM and provenance stay in S8.
+  images, the SBOM and provenance stay in S9.
 - **CI runs on arm64 from S2c** (§8.2), on GitHub's `ubuntu-24.04-arm` runners,
@@ -966,7 +966,7 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   tested end to end natively on each architecture. A multi-arch manifest comes
-  with publishing, in S8.
+  with publishing, in S9.
 - **Generated references from S2c.** The `stack.yaml` reference, its JSON Schema at
   `docs/reference/stack.schema.json` (§4.2, §9) and the CLI reference are generated
-  from code, and CI fails when they are stale. They move here from S8, by the owner's
-  decision. The `--json` shapes stay in S8.
+  from code, and CI fails when they are stale. They move here from S9, by the owner's
+  decision. The `--json` shapes stay in S9.
 
@@ -1002,3 +1002,3 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   with `<app>.not-seeded`, and its hint gives the steps. A file Mediaplane can't read
-  counts as seeded, because there is no way to tell. Slice 7 automates the fix, with
+  counts as seeded, because there is no way to tell. Slice 8 automates the fix, with
   the rest of "restore the key at the source" (§6.3).
@@ -1273,3 +1273,5 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   manage, so a `plan` makes one again in qBittorrent when you set it in the arr and later
-  delete it in qBittorrent.
+  delete it in qBittorrent. A test that fails also records a failure in the arr's status
+  of that client (`DownloadClientStatus`), as a test from the arr's web UI does, and a
+  later pass resets it (probed in Slice 4).
 - **Sonarr's and Radarr's root folder** (§6.2): `<arr>.root_folder`, `/data/media/tv` or
@@ -1297 +1299,55 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   helper and vpn-check's probe are; the socket proxy allows nothing new (§7.2(2)).
+
+### Slice 4: indexers (2026-10-15)
+
+- **Prowlarr's links to Sonarr and Radarr** (§6.2): `prowlarr.application_sonarr` and
+  `prowlarr.application_radarr`, Prowlarr's applications `Sonarr (Mediaplane)` and
+  `Radarr (Mediaplane)`, each while that arr is in the stack.
+  - The managed fields are §6.2's: `prowlarrUrl` (`http://prowlarr:9696`, how the arr
+    reaches Prowlarr back), `baseUrl` (`http://sonarr:8989` or `http://radarr:7878`, how
+    Prowlarr reaches the arr), `syncLevel` (`fullSync`) and `syncCategories`, Prowlarr
+    2.6's own default categories for that app, kept as one sorted list. `apiKey` is the
+    link's secret, not a compared field, as qBittorrent's key is the download client's
+    (Slice 3c): Prowlarr shows it masked.
+  - The key is checked with Prowlarr's own test of the link it holds, sent masked with
+    its id, which calls the arr with the key and has the arr call Prowlarr back: a
+    failure that names `ApiKey` is an update; any other is Prowlarr's own message. A link
+    is made from Prowlarr's template with `forceSave`, which still tests a new one, and
+    updated with `forceSave`, which doesn't. A test that fails records a failure in
+    Prowlarr's status of that link (`ApplicationStatus`), as a test from its web UI does,
+    and a later pass resets it, so a `plan` that finds a key refused leaves that record
+    (probed).
+  - Each `requires` its arr's `admin`, the first thing Mediaplane checks in the arr. While
+    the arr isn't up, refuses its key, or has its admin yet to be set, `plan` leaves the
+    link's key unchecked, rather than report Prowlarr's test failing on the arr, and the
+    wire step skips the link when the arr's admin fails (§5.1).
+- **The indexer proxy** (§6.2): `prowlarr.indexer_proxy`, named `Cloudflare (Mediaplane)`
+  whichever solver runs, so a change of solver is an update, and lost state finds it by
+  name. Its type is FlareSolverr, which Byparr answers too. Its `host` is
+  `http://byparr:8191/`, or `http://flaresolverr:8191/`, its `requestTimeout` 60 seconds
+  (Prowlarr's default), and its `tags` `cloudflare`, compared as labels. Apply asks
+  Prowlarr for the tag as it makes or updates the proxy: Prowlarr gives back the one it
+  has, or makes it.
+  - It holds no secret, so nothing checks it once it is made (§6.3). §6.2's secret-check
+    column names Prowlarr's test of it; Prowlarr runs that test itself, as it saves a new
+    proxy: it has the solver fetch `https://prowlarr.servarr.com/v1/ping`. So the `apply`
+    that makes the proxy needs that page within the solver's reach, and `plan` never runs
+    the test.
+  - FlareSolverr gets a health check (`/health`), so that `up --wait` waits for it before
+    the wire step makes the proxy. Byparr has one already.
+- **Indexers stay yours** (§6.2). The end-to-end test adds made-up Torznab indexers,
+  served by a container of its own outside the stack, and never a real one: Prowlarr
+  syncs them to Sonarr and Radarr, and fetches those tagged `cloudflare`, behind a
+  stand-in Cloudflare challenge, through Byparr's browser, then FlareSolverr's (§10,
+  Byparr's risks). Byparr's health check and Prowlarr's test of the proxy need the
+  internet.
+- **A link stays when its arr leaves the stack**, and Prowlarr's indexer proxy, when the
+  stack drops its Cloudflare solver, as a download client stays when qBittorrent leaves:
+  Mediaplane doesn't remove what it made yet. Slice 8 decides, with §8.1(3) step 4.
+- **One way to wire a Servarr provider.** The arrs' download client and Prowlarr's links
+  and proxy share how they are found (by id, else by name, among the app's providers of
+  that kind), made from the app's template, updated, and tested.
+- **No new Docker API call.** The new calls are the apps' APIs over the wiring network
+  (§7.2(2)).
+- **The slices after S4 are renumbered** (the owner's decision, 2026-10-15): S5 Jellyfin,
+  S6 requests, S7 Plex, S8 drift and S9 release. The roadmap keeps the history.
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index 2053595..7618f98 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -4,4 +4,4 @@
 
-M1 is too large for one implementation plan, so it is delivered in eight
-vertical slices. Each slice:
+M1 is too large for one implementation plan, so it is delivered in 14 vertical
+slices: S1, S2 in three parts, S3 in four, and S4 to S9. Each slice:
 
@@ -21,2 +21,3 @@ Detailed plans so far:
 - Slice 3c: [`m1-s3c-download-path.md`](m1-s3c-download-path.md) (done).
+- Slice 4: [`m1-s4-indexers.md`](m1-s4-indexers.md) (done).
 
@@ -24,5 +25,5 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b and S3c.
-- **Next:** S4 (indexers).
-- **After that:** S5 to S8.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c and S4.
+- **Next:** S5 (Jellyfin).
+- **After that:** S6 to S9.
 
@@ -30,12 +31,10 @@ Where M1 stands (the README shows the same):
 
-> **Renumbered on 2026-10-11.** By the owner's decision, drift moved after
-> requests, so that it is designed against every app and a hands-off stack comes
-> sooner. The slices after S3c are now:
+> **Renumbered twice, by the owner's decisions.** A plan uses the numbers of its day.
 >
-> - S4 indexers (was S5);
-> - S5 media servers (was S6);
-> - S6 requests (was S7);
-> - S7 drift (was S4).
->
-> Plans written before then use the old numbers.
+> - **2026-10-11:** drift moved after requests, so that it is designed against every
+>   app and a hands-off stack comes sooner. S4 indexers (was S5), S5 media servers (was
+>   S6), S6 requests (was S7), S7 drift (was S4); S8 release unchanged.
+> - **2026-10-15:** the media servers split, Jellyfin first. S5 Jellyfin and the arrs'
+>   links to it (from S5), S6 requests (unchanged), S7 Plex (from S5), S8 drift (was
+>   S7), S9 release (was S8).
 
@@ -47,6 +46,7 @@ Where M1 stands (the README shows the same):
 | S4 | **Indexers** | Prowlarr application links (fullSync), the Byparr/FlareSolverr indexer proxy and the `cloudflare` tag | §6.2 (Prowlarr rows) | Indexers added in Prowlarr reach both arrs, and proxied requests work |
-| S5 | **Media servers** | Jellyfin bootstrap-before-publish, its API key and libraries, the arr → media-server connections, Plex `plex-login` (PIN flow), the Plex claim and libraries, and a nightly Plex CI job | §6.1 (Jellyfin, Plex), §6.4, §8.1 (Plex) | Both media servers are wired headlessly, except for the single Plex sign-in |
-| S6 | **Requests** | The Seerr first sign-in (through the Jellyfin admin or the Plex token), libraries, the Sonarr/Radarr servers, initialize, and the full-stack end-to-end test | §6.1 (Seerr), §6.2 (Seerr row) | Success criteria 1 and 2 |
-| S7 | **Drift** | The three-way drift model, `drift`, `keep`, a comment-preserving override writer, `unmanaged`, externally managed mode, name-based re-adoption, key recovery from appdata, and shared-key propagation | §6.3, §6.1 (key recovery) | Success criterion 4 |
-| S8 | **Release and public readiness** | Trivy for the catalog images (Mediaplane's own image is scanned from S2c), SBOM and provenance, release-please, Renovate (a custom manager for catalog pins plus SHA-pinned Actions), a multi-arch release workflow and manifest (arm64 CI itself runs from S2c), the `--json` output shapes in the generated docs (the `stack.yaml`, JSON Schema and CLI references, with their freshness check, arrive in S2c), `migrate`, the full README, the add-an-app guide, the code of conduct, templates and CODEOWNERS | §8.2, §9 | Success criterion 7. Everything is green on both architectures |
+| S5 | **Jellyfin** | Jellyfin bootstrap-before-publish, its API key and libraries, and the arr → Jellyfin connections | §6.1 (Jellyfin), §6.2 (media-server rows), §6.4 | Jellyfin is wired headlessly |
+| S6 | **Requests** | The Seerr first sign-in through the Jellyfin admin, libraries, the Sonarr/Radarr servers, initialize, and the full-stack end-to-end test | §6.1 (Seerr), §6.2 (Seerr row) | Success criterion 1 |
+| S7 | **Plex** | `plex-login` (the plex.tv PIN flow), the Plex claim through a plex.tv helper, its libraries, the arr → Plex connections, Seerr's sign-in with the Plex token, and a nightly Plex CI job | §6.1 (Plex, Seerr), §6.2 (media-server rows), §8.1 (Plex) | Success criterion 2: Plex is wired headlessly, except for the single Plex sign-in |
+| S8 | **Drift** | The three-way drift model, `drift`, `keep`, a comment-preserving override writer, `unmanaged`, externally managed mode, name-based re-adoption, key recovery from appdata, and shared-key propagation | §6.3, §6.1 (key recovery) | Success criterion 4 |
+| S9 | **Release and public readiness** | Trivy for the catalog images (Mediaplane's own image is scanned from S2c), SBOM and provenance, release-please, Renovate (a custom manager for catalog pins plus SHA-pinned Actions), a multi-arch release workflow and manifest (arm64 CI itself runs from S2c), the `--json` output shapes in the generated docs (the `stack.yaml`, JSON Schema and CLI references, with their freshness check, arrive in S2c), `migrate`, the full README, the add-an-app guide, the code of conduct, templates and CODEOWNERS | §8.2, §9 | Success criterion 7. Everything is green on both architectures |
 
@@ -61,3 +61,3 @@ just like a full slice.
 | S2b | **Apply.** Key generation and persistence, `.env` rendering, atomic writes and the lock, the appdata ownership helper (Seerr runs as uid 1000), the apply stages (write, pull, `up --wait`, verify, record), change history, the `apply`, `status`, `history` and `init` commands, verified health checks, and ADR 0004 | Containers come up healthy on amd64 and arm64. A second apply reports no changes |
-| S2c | **Packaging.** The Mediaplane image, `deploy/mediaplane.compose.yaml` with the socket proxy (`mediaplane-system`), host detection from inside the container (the host helper), the threat model and ADR 0008. Also, by the owner's decisions of 2026-10-09: Trivy for the Mediaplane image (moved here from S8); native arm64 CI (moved here from S8); and the docs so far, which are the generated `stack.yaml`, JSON Schema and CLI references with a CI freshness check (moved here from S8), `docs/architecture.md`, a README per app, the "app won't start" runbook and ADR 0006. And `pnpm audit` of the CLI's production dependencies in CI, which the image scan can't see because they are bundled (spec §7.2(7)) | Success criterion 6 |
+| S2c | **Packaging.** The Mediaplane image, `deploy/mediaplane.compose.yaml` with the socket proxy (`mediaplane-system`), host detection from inside the container (the host helper), the threat model and ADR 0008. Also, by the owner's decisions of 2026-10-09: Trivy for the Mediaplane image (moved here from S9); native arm64 CI (moved here from S9); and the docs so far, which are the generated `stack.yaml`, JSON Schema and CLI references with a CI freshness check (moved here from S9), `docs/architecture.md`, a README per app, the "app won't start" runbook and ADR 0006. And `pnpm audit` of the CLI's production dependencies in CI, which the image scan can't see because they are bundled (spec §7.2(7)) | Success criterion 6 |
 
@@ -101,3 +101,3 @@ Every slice writes its own docs as it goes:
   - 0010 in S2a, 0004 in S2b, and 0006 and 0008 in S2c;
-  - 0003 in S7.
+  - 0003 in S8.
   - 0007 (books) belongs to M4.
@@ -107,3 +107,3 @@ Every slice writes its own docs as it goes:
   - "VPN down" in S3d, and "wiring failed" in S3b;
-  - "drift reported" in S7;
+  - "drift reported" in S8;
   - "app won't start" in S2c.
@@ -126,3 +126,3 @@ repositories, and the repo is public, so from S2c (owner, 2026-10-09):
   reports either way, so it is the one check branch protection should require;
-- a multi-arch image manifest waits for publishing, in S8.
+- a multi-arch image manifest waits for publishing, in S9.
 
@@ -159,2 +159,11 @@ Verified in S3c (2026-10-11):
 
+Verified in S4 (2026-10-15):
+
+- **Byparr answers Prowlarr as FlareSolverr does** (spec §10):
+  `test/e2e/indexers.e2e.test.ts` has Prowlarr make its proxy of type FlareSolverr at
+  Byparr, which passes Prowlarr's own test, then fetch a made-up indexer behind a
+  stand-in Cloudflare challenge through Byparr's browser, and get its items. Then the same
+  through FlareSolverr. Checked on the arm64 dev box; it runs in CI on both architectures
+  from Slice 4.
+
 ## Inputs for later slices from the reviews
@@ -164,9 +173,10 @@ design gaps below, which only matter once Mediaplane writes files or deploys.
 The Slice 2a final review (2026-10-09) added the S2b list and two S3 items.
-The Slice 2b final review (2026-10-09) added the S2c list, two S7 items and an
-M2 item. Slice 2c (2026-10-09) added the last S3 item, the S5 list and the last
-four S8 items. Slice 3a (2026-10-10) added three S3 items, the S3d list, three
-S7 items, two S5 items, an S8 item and an M2 item. Slice 3d (2026-10-10) added the last
-S3 item, the unscheduled list and extended two S8 items. Slice 3b (2026-10-10) added the
-S3c list, two S7 items and one unscheduled item. Slice 3c (2026-10-11) added three S7
-items. Each slice plan must address the items for that slice.
+The Slice 2b final review (2026-10-09) added the S2c list, two S8 items and an
+M2 item. Slice 2c (2026-10-09) added the last S3 item, the S5 item, the first S7 item
+and the last four S9 items. Slice 3a (2026-10-10) added three S3 items, the S3d list,
+three S8 items, two S7 items, an S9 item and an M2 item. Slice 3d (2026-10-10) added the
+last S3 item, the unscheduled list and extended two S9 items. Slice 3b (2026-10-10) added
+the S3c list, two S8 items and one unscheduled item. Slice 3c (2026-10-11) added the S4
+item and five S8 items. Slice 4 (2026-10-15) added three S8 items. Each slice plan must
+address the items for that slice.
 
@@ -275,3 +285,3 @@ password, which are S3c's (and listed again below).
     end-to-end test proves it.
-  - The plex.tv calls go through a short-lived helper in S5.
+  - The plex.tv calls go through a short-lived helper in S7.
   - This is defence in depth, not a wall, because the proxy still lets Mediaplane
@@ -349,2 +359,6 @@ password, which are S3c's (and listed again below).
   extends them.
+- **Done in S4:** `fakeStackApis`' arrs refuse a root folder whose folder no `mkdir` made,
+  fail a client's test at a port qBittorrent doesn't listen on, or over TLS, and test a
+  new client as they save it; its new Prowlarr is as strict, with its links and its
+  proxy.
 
@@ -352,2 +366,8 @@ password, which are S3c's (and listed again below).
 
+- **Jellyfin's health check can pass early.** In its first seconds, Jellyfin's
+  `/health` answers 200 with `Degraded` while the server still answers 503 to
+  everything else (S2c). Look at a check that waits for the server itself.
+
+**S7:**
+
 - **The Plex claim and `plex-login` need plex.tv.** The Mediaplane container has no
@@ -356,5 +376,2 @@ password, which are S3c's (and listed again below).
   threat model.
-- **Jellyfin's health check can pass early.** In its first seconds, Jellyfin's
-  `/health` answers 200 with `Degraded` while the server still answers 503 to
-  everything else (S2c). Look at a check that waits for the server itself.
 - **A login of your own for Plex, and for Seerr on Plex.** Plex's login is always
@@ -363,4 +380,5 @@ password, which are S3c's (and listed again below).
   or the slice that brings it, so `credentials` says their login arrives in
-  Slice 5 (Plex) or Slice 6 (Seerr). Give `login` a value for your own account,
-  and use it for both.
+  Slice 7 (Plex) or Slice 6 (Seerr). Give `login` a value for your own account,
+  and use it for both. Seerr's `comingIn` says Slice 6 on a Plex stack too, where
+  Seerr's wiring comes in Slice 7 (S4): fix that with this item.
 - **Plex's web UI is at `/web`.** `credentials` prints `http://<address>:<port>`
@@ -368,3 +386,3 @@ password, which are S3c's (and listed again below).
 
-**S7:**
+**S8:**
 
@@ -420,4 +438,21 @@ password, which are S3c's (and listed again below).
   re-apply needs `partial`.
-
-**S8 (before going public):**
+- **Links to an app that leaves the stack.** Remove Sonarr or Radarr from `stack.yaml`,
+  and Prowlarr keeps its link to it (S4), as the arrs keep their download client when
+  qBittorrent goes; so does Prowlarr's indexer proxy, when the stack drops its
+  Cloudflare solver, and indexers tagged `cloudflare` then fail. Spec §8.1(3) step 4
+  asks that an app's links go with it. Decide whether `apply` removes what it made, or
+  drift reports it.
+- **Settings Mediaplane manages in Prowlarr are put back.** A link's addresses, sync
+  level or categories, or the proxy's host, timeout or tags, changed in Prowlarr's web
+  UI, are undone by the next `apply` (S4). Keep mine must cover them.
+- **The indexer proxy is never checked once it is made.** It holds no secret, so `plan`
+  runs no test of it (S4): Prowlarr's would have the solver fetch a page of Prowlarr's
+  own service. Decide whether drift checks it, and how often.
+- **`plan`'s key checks can record a failing status in the app; drift runs them on a
+  schedule.** A failing test of a download client (S3c) or a Prowlarr link (S4) records
+  a failure in the app's status of it (`DownloadClientStatus`, `ApplicationStatus`),
+  as a test from its web UI does, and a later pass resets it (S4's probe). Decide
+  whether scheduled drift may do that.
+
+**S9 (before going public):**
 
```

**Change** `.github/workflows/ci.yml`:

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 01d091f..df3bf35 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -139,3 +139,3 @@ jobs:
           persist-credentials: false
-      # Native on each runner: no emulation. A multi-arch manifest comes with publishing (S8).
+      # Native on each runner: no emulation. A multi-arch manifest comes with publishing (S9).
       # The image scanned here and the one the e2e tests build are two builds of the same
```

- [ ] **Step 8: Check the renumbering and the docs rules, and commit**

Every reference to a slice after S3c, outside the merged plans, must read right in the
numbering of 2026-10-15. Read each line this prints, by its meaning: Jellyfin Slice 5,
requests Slice 6, Plex Slice 7, drift Slice 8, release Slice 9, and the rest of the
wiring Slices 5 to 7:

```bash
git grep -n -E 'Slices? [4-9]|\bS[4-9]\b' -- . ':!docs/plans/m1-s1*' ':!docs/plans/m1-s2*' ':!docs/plans/m1-s3*'
```

Every diagram must be at most 40 columns wide, and no public doc may name the planning
process (controller, ruling, decision numbers):

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git diff -U0 -- docs README.md CONTRIBUTING.md catalog deploy | grep '^+' | grep -i -E 'controller|ruling|\bD[0-9]+\b'
```

Expected: the check passes (1502 tests), and the `grep` prints nothing.

```bash
git add -A .github CONTRIBUTING.md README.md catalog deploy docs packages
git commit -m "docs: the indexers, and the slices after S4 renumbered (Jellyfin first)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Slice 4 completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.68% of statements, 93.7% of branches, 98.71% of functions and
  99.6% of lines, with 1502 tests in 75 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too (Task 3, Step 4),
  and leaves no `mediaplane-e2e-*` container or network, and no new volume or
  `mediaplane-e2e-*` folder. When this plan was replayed, alone on the dev box, warm:
  - with Compose 5.5.1, 7 files and 21 tests in 400 s (Slice 3c's suite took 306 s; the
    indexers file alone takes about 85 s);
  - with Compose 2.38.2, the same in 439 s (Slice 3c's: 337 s).

  CI's e2e job allows 60 minutes, and took 8 on amd64 for Slice 3c, so `ci.yml` keeps its
  timeout.
- [ ] The socket proxy's allow-list is unchanged: `git diff 9f060e6 --
  deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints nothing (decision 12).
  `9f060e6` is `main` after S3c.
- [ ] No secret shows: the tests that check it pass (the link tested masked, by its id;
  `state/resources.json` holding neither arr's key, which the indexers e2e checks).
- [ ] `plan` changes nothing in the apps of its own, and asks Prowlarr to test no link
  while its arr is to be started (Task 2's test, decision 4). It never runs Prowlarr's
  test of the proxy (decision 6). A failing test of a link's key records that failure in
  Prowlarr, as a test from its web UI does, and the spec, the threat model and the
  roadmap say so (decision 3).
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  outside the GitHub URLs (`https://github.com/cyclopsgd/Mediaplane/…`).
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B 9f060e6.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 4 (each link requires its arr's admin), 5 (one proxy named
    `Cloudflare (Mediaplane)`, with its tag in the same resource), 6 (only Prowlarr tests
    the proxy, as it makes it, and needs the internet then), 10 (what the e2e proves
    without a third party, and the two it needs: Google's home page for Byparr's health
    check, and Prowlarr's own ping service) and 14 (Seerr's Plex sign-in goes with Plex,
    to S7);
  - that the e2e tests on Compose v2.38.2 and Docker 28 are confirmed by the slice PR's
    first CI run, on amd64 and arm64, as they were locally with Compose 2.38.2 on arm64;
  - for the owner's manual-steps list: to send an indexer through Byparr, tag it
    `cloudflare` in Prowlarr; a link of Prowlarr's to an arr removed from the stack stays
    until it is deleted in Prowlarr; and settings Mediaplane manages in Prowlarr (a
    link's addresses, sync level and categories, the proxy's host, timeout and tags) are
    put back by the next `apply`.
