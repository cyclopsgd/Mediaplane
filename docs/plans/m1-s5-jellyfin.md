# M1 Slice 5: Jellyfin — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apply` sets Jellyfin up before anyone else can reach it: Jellyfin starts with no
published port, Mediaplane finishes its startup wizard over the wiring network as the
shared admin, makes its API key and keeps it, and only then publishes it. It then makes
the Movies and Shows libraries, and gives Sonarr and Radarr a connection to Jellyfin that
updates its library on import. Jellyfin is wired headlessly.

**Architecture:**

- **Bootstrap before publish, in the engine.** An app may declare a first-run setup in the
  catalog (`bootstrap`). `plan` lists the apps to set up (`bootstrap`), and never runs a
  setup. Apply's start step gives Compose one more file, on its standard input, that resets
  those apps' `ports`; a new `bootstrap` step, after `start`, finishes each setup over the
  wiring network without a key, keeps the key the app makes in `state/secrets.json` at
  once, and runs `up` again, which recreates the app with its ports.
- **Jellyfin in the catalog** (`catalog/jellyfin/`): its API (the `mediabrowser` key
  scheme), its setup (`bootstrap.ts`), a health check that waits for `Healthy`, and an
  integration of three resources: `jellyfin.admin`, `jellyfin.library_movies` and
  `jellyfin.library_shows`.
- **Sonarr and Radarr → Jellyfin** (`catalog/_shared/servarr-connection.ts`):
  `<arr>.connection_jellyfin`, on S4's shared Servarr provider, checked with the arr's own
  `POST /notification/test`.
- **The typed client** gains Jellyfin's ways: its MediaBrowser header, a JSON sign-in, a
  POST or DELETE whose answer isn't read, and the same app with another key.
- **The fakes** gain a fake Jellyfin and the arrs' connections, as the pinned images answer.
- **The roadmap's S5 inputs** from S4's final review: the two fake gaps, the two provider
  repeats, one address helper, and a CLI-level `apply` test with Prowlarr.
- **An end-to-end test** on real Docker shows Jellyfin set up before its port is
  published, its libraries, both arrs' connections passing their own test, a second
  `apply` with no changes, and what `apply` does with a key and a library changed by hand.

**Tech Stack:** as Slice 4 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2 (M1 scope; success criterion 1's "Seerr is connected to Jellyfin", which needs
  Jellyfin set up, comes in Slice 6);
- §5 steps 4, 8 and 9 (keys an app creates are kept "the moment they are created during
  bootstrap"; "On their first start, apps that have anonymous first-run endpoints start
  **without published ports**"; "Perform `bootstrap-api` first-run setup for newly started
  apps. Afterwards, re-render with ports and recreate any app that was started
  unpublished"), §5.1, §5.2 (`plan` changes nothing in the stack, but for its documented
  marks);
- §6.1, Jellyfin's row; §6.2, the media-server rows, the libraries row and the ordering;
  §6.3 (secrets verified, never compared; identity by id, else by name); §6.4 (bootstrap
  before publish); §6.5 (Jellyfin ≥ 12);
- §7.2(2) (the socket proxy), §8.1(2) and (3), §9 (the documentation set), §11.

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S5 row ("Jellyfin
bootstrap-before-publish, its API key and libraries, and the arr → Jellyfin connections";
it proves "Jellyfin is wired headlessly"), and the S5 list in "Inputs for later slices
from the reviews": Jellyfin's health check can pass early, and the five small gaps from
S4's final review.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`), with one line of context. It
  is exact: save it to a file and run `git apply <file>` from the repo root, or make the
  same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact or a
  schema description says to run `pnpm docs:generate`, and names what it rewrites.
- Every block was applied in order to a fresh worktree at `c35e04c`, and each task's
  tests failed before its implementation and passed after it (see the completion
  checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a, 3d, 3b, 3c and 4 Global Constraints still
holds (`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`, `m1-s3d-vpn-check.md`,
`m1-s3b-wiring.md`, `m1-s3c-download-path.md`, `m1-s4-indexers.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `'0'.repeat(32)`, `` `qbt_${'1'.repeat(28)}` `` or `fake-admin-password`. Addresses in
  tests and docs come from the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`,
  `203.0.113.0/24`), private ranges, or `fd00::/8`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps but for its documented marks. Its
  one change to Docker is still joining the wiring network from the image (S3b decision 2);
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
  comes before it through `after` (the catalog invariant test);
- the shared Servarr provider (`catalog/_shared/servarr-provider.ts`, S4): every Servarr
  provider is found, made, updated and tested through it;
- never push.

The spec's exact values for this slice, verbatim:

- §6.1, Jellyfin: "Cannot be chosen. Created with `POST /Auth/Keys?app=Mediaplane` after
  setup, read back with `GET /Auth/Keys`, then stored in `state/secrets.json`"; "Startup
  API (`POST /Startup/User`, `POST /Startup/Complete`), then `AuthenticateByName`. Uses
  **bootstrap-before-publish** (§6.4)"; "Uses `Authorization: MediaBrowser Token="…"`; the
  legacy token headers are disabled by default in v12".
- §6.2: "Every resource Mediaplane creates is named `… (Mediaplane)`"; "Sonarr / Radarr →
  Jellyfin or Plex | Connection (`MediaBrowser` / `PlexServer`) that updates the library
  on import | host, port, apiKey / authToken, updateLibrary | `POST /notification/test`";
  "Jellyfin | Libraries Movies (`movies`) and Shows (`tvshows`) | name, collectionType,
  paths | —"; "The `after` relationships give this order: qBittorrent and Jellyfin/Plex,
  then Sonarr and Radarr, then Prowlarr, then Seerr".
- §6.4: "These start first with **no published ports**. Mediaplane completes setup over
  the internal Docker network, then re-renders with ports and recreates the container.
  There is never a window in which a LAN client could claim the admin account."
- §6.5: Jellyfin's floor is 12.0 ("Auth header format"); the pin is 12.2.0.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records,
  `state/resources.json`, logs, human or JSON output, command lines, container
  environments, `docker inspect` or the public CI log. This slice adds:
  - **Jellyfin's API key,** which Jellyfin makes: read once from its list of keys, kept in
    `state/secrets.json` at once, sent in the MediaBrowser header, and given to Sonarr and
    Radarr in a request body (their connection), which they show masked. It is among the
    secrets every client redacts (`knownSecrets` holds every key in the store).
  - **The admin password** goes to Jellyfin only in request bodies: its wizard, its
    sign-in (a secret of that call), and its password set with the key. A session's
    token is used for the key alone, and signed out of.
  - End-to-end failure messages show only statuses, lengths, or an arr's
    `propertyName: errorMessage` list with every stored secret replaced (`getJson`,
    `jsonBody`, `servarrFailure`): never an app's body.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and
  `deploy/deploy.test.ts` don't change. Anything that would need a new Docker API call is
  a security-sensitive decision for the controller, not for an implementer.
- **`plan` never runs an app's first-run setup, and never makes a key.**
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. This slice adds one Compose
  file on standard input (`-f -`) to `up`, and no other flag.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes a catalog fact or a schema description runs `pnpm docs:generate` first,
  and commits the generated files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it.
  - Short, plain sentences; lists rather than wide tables; no internal jargon (no
    "controller", "ruling" or decision numbers in public docs).
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid,
    because Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.
- **No renumbering.** Seerr's `login.comingIn` stays `Slice 6`, and Plex's `Slice 7`.

## Decisions taken in this plan

The spec, the roadmap and the reviews leave these open. Each is marked `Decision:` where
it is applied. The ones to look at first are marked **(check)**. Every fact about an app
below was probed on the pinned images (Jellyfin 12.2.0, `12.2ubu2604-ls53`; Sonarr
4.0.20; Radarr 6.4.4) on real Docker (29.8, Compose 5.5.1 and 2.38.2, aarch64) while
writing this plan, unless it says otherwise.

1. **(check) How "no published ports, then published" works** (Task 2; §5 steps 8 and 9,
   §6.4). The start step's `up` gets one more Compose file, on its standard input, after
   `compose.override.yaml`:

   ```yaml
   services:
     jellyfin:
       ports: !reset []
   ```

   The bootstrap step's `up` runs without it, and Compose recreates the app with its
   ports. Probed with both Composes on a two-service project with an override that
   published a second port: the service started with no port at all, the override's
   included; a second `up` with the same file recreated nothing; the plain `up`
   recreated only that service, with both ports; the other service was never touched,
   and both Composes gave the same hashes. `!reset` needs Compose 2.24, which is already
   preflight's floor (spec §3.3).
   - `compose.yaml` always holds the ports, so the stack runs as written without
     Mediaplane (success criterion 6), and `compose.prev.yaml` keeps its meaning. The
     unpublished state lives only in the running container: `plan` sees its hash differ,
     and plans a recreate.
   - Two renders of `compose.yaml` were the alternative. They leave the override's ports
     published, and write a `compose.yaml` that isn't the stack's.
   - The spec's "re-render with ports" (§5 step 9, §6.4) is the publishing `up`, of
     `compose.yaml` as written: nothing is rendered twice, as the spec's §11 entry for
     this slice (Task 6) describes.
   - **No new socket-proxy permission:** a recreate makes only the calls `apply` already
     makes, and the file goes on Compose's standard input. The deploy and VPN end-to-end
     tests run Jellyfin's setup from the image, behind the proxy.
2. **(check) Which apps are set up, and which start unpublished** (Task 2). An app with a
   `bootstrap` in its catalog entry is set up when its key isn't stored, or its appdata
   doesn't say the setup is done (`done`: Jellyfin's `system.xml`, with
   `<IsStartupWizardCompleted>true</IsStartupWizardCompleted>`). It starts unpublished
   unless that file says the setup is done. A file Mediaplane can't read says nothing:
   the stored key decides.
   - The file, and not the key alone, because a Jellyfin whose appdata was emptied, with
     its key still stored, starts with its wizard open: on the key alone it would start
     published. Probed: Jellyfin writes `system.xml` with `false` at its first start, and
     `true` the moment `POST /Startup/Complete` answers.
   - A wizard finished by hand (before Slice 5, say) with no key stored isn't unpublished:
     nobody can claim it, so apply only signs in. If the sign-in fails, apply fails, and
     Jellyfin isn't recreated on every run.
3. **The bootstrap step** (Task 2; §5 step 9). A new apply step, `bootstrap`, after
   `start`, run only when `plan` lists a setup. It joins the wiring network, reaches each
   app without a key, waits until it is ready, and runs its setup as the shared admin.
   The key goes into `state/secrets.json` at once (§5 step 4). Then it steps off the
   wiring network, as the start step does (spec §11 Slice 3b, ADR 0011: "apply steps off
   it before `up`"), and runs `up` again with only the apps whose setup is still open
   unpublished: an app whose setup failed while open stays unpublished, and one whose
   setup is done is published even when making its key failed. A failure before the setup
   reaches its app (no wiring network, a join that fails, an app not on the network)
   publishes nothing. It throws `BootstrapFailed` with a hint, and the wire and verify
   steps are skipped, as after a failed start: until the setup works, `apply` wires no
   app. Letting the wire step run past it, with that app's resources failed so that
   `requires` skips them (§5.1), is on the roadmap's S8 list. Change records gain the step `bootstrap` and the plan's
   `bootstrap`, additive within `mediaplane.change/v1`.
4. **What `plan` shows** (Task 2). `PlanResult.bootstrap` lists `{ app, unpublished }`,
   under `First-run setup:` in human output and as `bootstrap` in `--json` (additive
   within `mediaplane.plan/v1` and `mediaplane.apply/v1`). An app to set up makes the plan
   changed; its container is `recreate` when it would start unpublished while it runs; its
   wiring is checked after the start, since it can't be asked without its key. `plan`
   never runs a setup and never makes a key.
5. **Jellyfin's setup, step by step** (Task 3; §6.1). Probed on a fresh Jellyfin:
   - `GET /System/Info/Public` answers `StartupWizardCompleted`, without a key;
   - `POST /Startup/User` before anything asks for the first user answers 404:
     `GET /Startup/User` makes it (`{"Name":"abc"}` in this image). An empty password is
     400 (`"Password must not be empty"`); the first `POST` is 204; a second is 403, since
     the user has a password;
   - `POST /Startup/Complete` answers 204 even with no user set: probed, it leaves a
     Jellyfin nobody can sign in to. So it comes only after a sign-in has worked;
   - `AuthenticateByName` works before the wizard is completed, and its session's token
     keeps working after;
   - once complete, every startup endpoint answers 401 without a key (it still takes a
     key);
   - `POST /Auth/Keys?app=Mediaplane` answers 204, with no body, and makes another key
     each time; `GET /Auth/Keys` lists every key in full, with `AppName` and
     `DateCreated` (every `Id` is 0). The key is 32 hex characters, which the store takes;
   - `POST /Sessions/Logout` ends the session; Jellyfin's devices list is then empty.

   So the setup asks for the first user, names it and gives it the password (a 403 means
   a password is set already, from a setup that stopped before it was done), signs in,
   and completes the wizard only then: a first user the shared admin can't sign in as
   isn't Mediaplane's, and the wizard is left open. The key is the newest named
   `Mediaplane` that Jellyfin holds, as after a run that made one and stopped before
   keeping it, else a new one, read back; then it signs out.
6. **Jellyfin's header, and the client's new calls** (Task 2; §6.1, §6.5). Probed:
   `AuthenticateByName` is refused (400) unless `Authorization: MediaBrowser` carries all
   four of `Client`, `Device`, `DeviceId` and `Version`; a key works in
   `MediaBrowser Token="…"`, alone or with those fields, and with them makes no session
   or device; `X-Emby-Token`, `X-MediaBrowser-Token`, `?api_key=` and a Bearer token are
   refused (401). So the client's new `mediabrowser` scheme sends
   `MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"`
   on every call, with `, Token="…"` once it has a key. One device id, so a new sign-in
   ends Mediaplane's last session (probed). The client also gains `submit` (a POST or
   DELETE whose answer isn't read: Jellyfin answers 204), `signIn` (a JSON sign-in that
   takes 401 as its answer, sent once it may have reached the app), and `withKey` (the
   same app with another key, which it redacts).
7. **Jellyfin's health check waits for the server** (Task 3; the roadmap's S5 item).
   Probed at every start, not only the first: `/health` answers 200 `Degraded` for a few
   seconds while `/Startup/…` and `/System/Ping` answer 503 (and `/System/Info/Public`
   200 from a minimal startup server, in camelCase); then Jellyfin restarts its server,
   which refuses connections for a second, answers 503 "Jellyfin Server is loading", and
   then `Healthy`. So the check is
   `curl -fsS http://localhost:8096/health | grep -qx Healthy` (the image has `grep`). Its
   API is `ready: /System/Info/Public`, `check: /System/Info` (the key's), asked only once
   the container is healthy.
8. **(check) Jellyfin's admin is a resource** (Task 3; §6.1). `jellyfin.admin`, as the
   Servarr apps' and qBittorrent's are, so that a change of `admin.username` or
   `admin.password` reaches Jellyfin, and `credentials` (Jellyfin's `login` is now
   `'shared'`) stays true. The spec lists only the setup; without the resource, Jellyfin
   would keep its first password.
   - It is known by the id `resources.json` records, else by the shared admin's user
     name. That name comes from the stack, so an integration's `observe` now also sees
     what the stack wants (`desired`), an optional third argument that the wire step and
     `plan` always pass.
   - Its password is checked by signing in, then out. Probed: seven failed sign-ins in a
     row didn't lock the admin out (`LoginAttemptsBeforeLockout` is -1); but Jellyfin's
     activity log keeps "is online", "successfully authenticated" and "has disconnected"
     for each check, and "Failed login attempt" for a wrong one. That is a third small mark
     a `plan` can leave in an app (§5.2), beside S3c's category and the test status rows:
     the spec, the threat model and `plan --help` say so. The roadmap's S8 list asks
     drift, which would check every 15 minutes.
   - It is renamed (`POST /Users/{id}` with the user as Jellyfin gave it; a bare
     `{"Name"}` is refused, probed) and given its password (`POST /Users/{id}/Password`
     with `NewPw` only: the key needs no old password, probed), never made: the wizard
     makes it, and Mediaplane makes no other user.
9. **(check) The libraries** (Task 3; §6.2). `jellyfin.library_movies` and
   `jellyfin.library_shows`: `Movies` (`movies`, `/data/media/movies`) and `Shows`
   (`tvshows`, `/data/media/tv`), the folders Radarr and Sonarr file into, wanted
   whenever Jellyfin runs.
   - **Named `Movies` and `Shows`,** as §6.2 names them, without "(Mediaplane)": they are
     what you browse, as the root folders and qBittorrent's categories are named by what
     they hold.
   - **Known by name.** Probed: a library's `ItemId` follows its folder's name, which a
     rename changes (renamed, it had none; renamed back, its old one), so it can't be
     the identity. `resources.json` records the name as the id.
   - **Its folder first.** Probed: a library at a missing folder is refused (400, "Error
     processing request."). The wire step makes it in a throwaway Jellyfin container, as
     the root folders are made.
   - **Made only when none has the name.** Probed: a second `POST` of the same name is
     204, and makes `Movies2`.
   - **`paths` is one sorted list** of Jellyfin's `Locations`, each once, without a
     trailing "/". Probed: a path added twice is listed twice, and removed one at a time;
     a trailing "/" is listed without it; a missing path is 404. An update adds the
     wanted folder first, then removes the others, so the library never has none.
   - **`collectionType` can't change** (Jellyfin has no call for it): an update of it
     fails, saying to rename or remove the library in Jellyfin.
   - **A new library gets the options Jellyfin's own web UI gives one.** Probed: a library
     made with `"LibraryOptions": {}` has `EnableInternetProviders: false`,
     `EnableRealtimeMonitor: false` and no `TypeOptions`. Scanned, its film still got its
     metadata and images, as one in a library made the web UI's way did; but it doesn't
     watch its folders for new files. The web UI (read from the image's own bundle) always
     sends `EnableInternetProviders: true`, checks `Enabled`,
     `EnableRealtimeMonitor` and the downloaders Jellyfin marks `DefaultEnabled` in
     `/Libraries/AvailableOptions?libraryContentType=<type>&isNewLibrary=true`. Mediaplane
     sends those (TheMovieDb for Movie metadata, for instance), and Jellyfin's defaults for
     the rest, which stay yours.
10. **(check) Sonarr's and Radarr's connection to Jellyfin** (Task 4; §6.2).
    `<arr>.connection_jellyfin`, an "Emby / Jellyfin" connection (`MediaBrowser`) named
    `Jellyfin (Mediaplane)`, made from the arr's template.
    - **Managed fields** are §6.2's: `host` (`jellyfin`), `port` (Jellyfin's container
      port) and `updateLibrary` (`true`); `apiKey` is its secret, not a compared field, as
      the download client's and the links' are: the arrs show it masked (probed).
    - **Its triggers** are on at its creation for each event that changes a file: Sonarr's
      `onDownload`, `onUpgrade`, `onRename`, `onSeriesDelete`, `onEpisodeFileDelete` and
      `onEpisodeFileDeleteForUpgrade`, and Radarr's `onDownload`, `onUpgrade`, `onRename`,
      `onMovieDelete`, `onMovieFileDelete` and `onMovieFileDeleteForUpgrade`. They stay the
      user's after that. "Updates the library on import" needs at least `onDownload`; the
      others keep Jellyfin's library in step as files move or go.
    - **Its key is checked with the arr's own test** (`POST /api/v3/notification/test`), of
      the connection as the arr holds it, by id. Probed: a wrong key fails as
      `ApiKey: API Key is invalid`, an empty one as `ApiKey: 'Api Key' must not be empty.`;
      a host it can't resolve as `Host: Unable to send test message: Resource temporarily
      unavailable (<host>:8096)`, a closed port as `… Connection refused (<host>:<port>)`,
      TLS as `… The SSL connection could not be established, see inner exception.`, and
      a right one passes (200 `{}`): Sonarr 4.0.20 reaches Jellyfin 12.2 with its key. A
      failure that names `ApiKey` is an update; any other is the arr's own words.
    - **What a test leaves in the arr.** Probed: a failing test by id records a failure in
      the arr's `NotificationStatus` (escalation 1, its last failure moved on by each
      failing test), and a passing one sets the escalation back to 0 and keeps the row; a
      test without the id records nothing; `/api/v3/health` doesn't change. As S4 found
      for the download client and Prowlarr's links, documented the same way.
    - **Tested as it is made.** Probed: a new connection with a trigger on is tested as
      it is saved, `forceSave` or not (refused with the test's words); one with every
      trigger off is saved untested, wrong key and all; an update with `forceSave` is
      saved untested.
    - **It requires `jellyfin.admin`,** and the arrs come `after` Jellyfin (the catalog
      invariant). While Jellyfin is still to be set up, or refuses its key, `plan` leaves
      the connection's key unchecked, and the wire step skips it when Jellyfin's admin
      fails. It is wanted whenever Jellyfin runs, before Jellyfin has made its key: `plan`
      lists it, and apply has the key by the wire step.
11. **The roadmap's other S5 inputs, from S4's final review** (Tasks 1, 4).
    - `testedOnCreate` with `enable` missing: the fake arrs take such a client as off, and
      save it untested, as the arrs do (Task 1).
    - The fake Prowlarr's `stateOf`: its tests read the other apps through a `peek` that
      gives a fresh state for one it doesn't hold, and adds nothing to `apps` (Task 1).
    - The two repeats: `secretOf` ("no apiKey to send") and `numberOf` (a number read as
      0) move into `servarr-provider.ts`, used by the download client, Prowlarr's links and
      proxy, and the new connection (Task 4).
    - One helper for service addresses: `serviceAddress(app, port)` and `serviceOf(app)`
      in `packages/engine/src/integrations/address.ts`: the service, or the one whose
      network the app runs in, and its container port. The download client, Prowlarr's
      links and proxy, the connection, and the wiring's own `serviceOf` use it. No address
      changes (Task 4).
    - A CLI-level `apply` with Prowlarr in the stack: its links' and proxy's create, their
      records, an empty plan after, and a link skipped when Sonarr's admin fails
      (`packages/cli/src/run.test.ts`, Task 4). They pass before Task 4's code, since they
      pin S4's behaviour.
12. **The fakes answer as the apps do** (Task 1). A fake Jellyfin
    (`packages/engine/src/testing/jellyfin.ts`), served by `fakeStackApis` for
    `Host: jellyfin`, and the arrs' connections, each as decisions 5 to 10 found them: the
    first user made by asking, a second `POST /Startup/User` refused, the wizard completed
    with or without a user, a sign-in that needs all four client fields and ends the
    device's last session, keys only in the MediaBrowser header and listed in full,
    libraries that need their folder (`mkdir`) and are named `<name>2` when taken, and
    `system.xml` written as Jellyfin writes it when a test gives the fake its appdata. The
    arrs' test of a connection reaches Jellyfin only by its service, while it runs, at
    8096, without TLS, with one of the keys Jellyfin made: none until it has made one.
13. **(check) The end-to-end test** (Task 5). A new `test/e2e/jellyfin.e2e.test.ts`, from
    source, on a stack of Jellyfin, Sonarr, Radarr and qBittorrent without the VPN
    (`stackFor` can leave Prowlarr out too, so Byparr and the internet aren't needed). It
    shows:
    - the setup before the port: a runtime that wraps `up` reads Jellyfin's state at
      each `up`, from its address on the wiring network: after the first, no port and
      the wizard open; before the publishing one, no port and the wizard done; after it,
      `127.0.0.1:8096`;
    - the shared admin signs in to the published Jellyfin, and another password doesn't;
    - the libraries, each in its folder, with Jellyfin's default metadata downloaders;
    - both arrs' connections, aimed at `jellyfin:8096`, the key masked, passing their own
      test;
    - a second `apply` with no changes;
    - by hand: a wrong key in Sonarr's connection is set again, a deleted Shows library is
      made again, and a folder added to Movies is taken out, in one `apply` that changes
      nothing else;
    - Jellyfin's own key deleted in its dashboard: `plan` reports Jellyfin refusing it;
      with it removed from `state/secrets.json`, `apply` signs in while Jellyfin stays
      published, makes a new key, and gives it to both arrs, whose test then passes; then
      no changes. The new key joins the secrets kept out of every failure message.

    Every other e2e stack runs Jellyfin too, so their lists gain Jellyfin's resources and
    the arrs' connections, and the deploy test checks the setup from the image, behind the
    proxy. It also shows that Mediaplane in the image reads Jellyfin's `system.xml`: with
    Jellyfin's key taken out of the store, `plan --json` gives
    `bootstrap: [{ app: 'jellyfin', unpublished: false }]` (one it couldn't read would give
    `true`), and the store is put back.
14. **No new Docker API call, and no proxy permission** (all tasks): see decision 1. The
    other new calls are Jellyfin's and the arrs' APIs over the wiring network.
    `deploy/mediaplane.compose.yaml` and `deploy/deploy.test.ts` don't change.
15. **The docs** (Task 6). The §9 set for what Tasks 1 to 5 built:
    - the wiring-failed runbook: the first-run setup's failures, Jellyfin refusing its
      key (and the fix above), a library that holds other content, and the connection's
      failures; the app-won't-start runbook: Jellyfin's health check;
    - the architecture: bootstrap before publish, with a diagram, and the media server;
    - the threat model: Jellyfin's key (an asset, T4, T5), the setup (a new T16), the
      shared password (T2, T10), and `plan`'s third mark;
    - the README: status, capabilities, flow, and the example's output from a real run of
      the same stack with this slice; Jellyfin's, Sonarr's and Radarr's READMEs; the
      deploy guide; CONTRIBUTING;
    - `plan --help`, and `admin`'s description in the schema, with the generated
      references;
    - the spec: a "Slice 5" entry in §11, and §5.2's `plan` row;
    - the roadmap: S5 done, its inputs marked done, an S6 item and six S8 items, and one
      S8 item extended; and Jellyfin's health check among what S1 encodes.

## File structure (new and changed in this slice)

`packages/engine/src/`:

- `http/client.ts` (+test): `KeyScheme` (`'x-api-key' | 'bearer' | 'mediabrowser'`), a key
  that may have no value yet, and `AppApi.submit`, `.signIn` and `.withKey`.
- `catalog/types.ts`: `ApiSpec.key.scheme` is a `KeyScheme`; `Bootstrap`;
  `AppDefinition.bootstrap`.
- `integrations/types.ts`, `integrations/wiring.ts` (+test): `observe` sees `desired`;
  every client carries its app's scheme; the wiring uses `serviceOf` from
  `integrations/address.ts` (+test, new in Task 4), with `serviceAddress`.
- `runtime/types.ts`, `runtime/docker.ts` (+test): `up(waitSeconds, values, unpublished?)`.
- `plan/bootstrap.ts` (+test), new: `BootstrapChange`, `planBootstrap`; `plan/plan.ts`:
  `PlanResult.bootstrap`.
- `apply/bootstrap.ts`, new: `bootstrapApps`, `BootstrapFailed`; `apply/apply.ts` (+test):
  the start step's unpublished apps, and the `bootstrap` step.
- `history/records.ts`: the step `bootstrap`, the plan's `bootstrap`.
- `testing/`: `jellyfin.ts` (+test), new: `fakeJellyfin`, `fakeServarrConnections`,
  `FakeApiKey`, `FakeLibrary`, `FakeConnection`, `FAKE_JELLYFIN_USER_ID`; `bootstrap.ts`,
  new: `FAKE_SETUP`, `SET_UP_CATALOG`, `SET_UP_KEY`, `fakeSetUpApp`; `wiring.ts` (+test):
  Jellyfin's state in `FakeAppState`, and the two S4 gaps; `prowlarr.ts`: `peek`;
  `fakes.ts` (+test): `up` with `unpublished`.
- `config/schema.ts`: `admin`'s description (Task 6).

`catalog/`:

- `jellyfin/app.ts`: its API, integration, bootstrap, health check and `login: 'shared'`;
  `jellyfin/bootstrap.ts` and `jellyfin/integration.ts` (+test), new.
- `_shared/servarr-connection.ts` (+test), new: `servarrJellyfin`,
  `JELLYFIN_CONNECTION_NAME`; `_shared/servarr-provider.ts`: `secretOf`, `numberOf`;
  `_shared/servarr-download.ts` and `prowlarr/integration.ts`: on them and
  `serviceAddress`.
- `sonarr/integration.ts`, `radarr/integration.ts`: after Jellyfin, with the connection,
  and their `JELLYFIN_TRIGGERS`.
- `catalog.test.ts`, `render.test.ts`, `prowlarr/integration.test.ts`: what changes with
  Jellyfin wired.
- The generated facts in Jellyfin's, Sonarr's and Radarr's READMEs; their hand-written
  parts (Task 6).

Elsewhere:

- `packages/cli/src/output.ts` (+test): `First-run setup:`, the step's label, and the plan's
  `bootstrap` in `apply --json`; `run.ts`: `plan --help` (Task 6); `run.test.ts`,
  `credentials.test.ts`: the stack's Jellyfin wired, and Prowlarr at the CLI.
- `scripts/docs/catalog-facts.ts` (+test): the MediaBrowser header.
- `test/e2e/jellyfin.e2e.test.ts`, new; `helpers.ts`: `stackFor` without Prowlarr; the
  apply, download, indexers, VPN, deploy and plan e2e tests: Jellyfin's resources.
- docs: the wiring-failed and app-won't-start runbooks, the architecture, the threat
  model, the README, CONTRIBUTING, the deploy guide, the spec, the roadmap, and the
  generated references (`cli.md`, `stack-yaml.md`, `stack.schema.json`).

**Tasks:**

1. The fakes: a fake Jellyfin, the arrs' connections to it, and fakes no kinder than the
   apps.
2. Bootstrap before publish, in the engine.
3. Jellyfin: set up before its port is published, with its admin and libraries.
4. Sonarr and Radarr → Jellyfin, on the shared provider, with S4's provider and address
   gaps closed.
5. End-to-end: Jellyfin wired headlessly.
6. Docs.

**Out of scope here:**

- **Seerr's sign-in through Jellyfin,** and its link to it: Slice 6 (the roadmap's S6
  item).
- **Plex,** and the arrs' connection to it: Slice 7.
- **Drift and Keep mine** for the new resources, making Jellyfin's key anew when it is
  refused, and how often drift may sign in to Jellyfin: Slice 8 (the roadmap's S8 list).
- **A library scan, or an import, in the end-to-end test.** The connection's own test
  proves the arr reaches Jellyfin with its key; an import needs media and a download.

---

### Task 1: The fakes: a fake Jellyfin, the arrs' connections to it, and fakes no kinder than the apps

The unit tests of Tasks 2 to 4 run against `fakeStackApis`. It has no Jellyfin yet, and
its arrs keep no connections. This task adds them, answering as the pinned images do, and
closes the two fake gaps S4's final review found.

Decision: `fakeJellyfin` answers Jellyfin's startup wizard, sign-in, keys, user and
libraries as decisions 5 to 9 found them, and keeps `system.xml` in `state.configDir`
when a test sets it (decision 12).
Decision: `fakeServarrConnections` serves the arrs' connections as their other providers
are, tested as they are saved when a trigger is on, and tested against Jellyfin's own
keys (decisions 10, 12).
Decision: a client sent without `enable` is saved untested; the fake Prowlarr reads other
apps through `peek`, adding nothing to `apps` (decision 11).

**Files:**
- Create: `packages/engine/src/testing/jellyfin.ts`
- Modify: `packages/engine/src/testing/wiring.ts`, `packages/engine/src/testing/prowlarr.ts`,
  `packages/engine/src/testing/index.ts`
- Test: `packages/engine/src/testing/jellyfin.test.ts` (new),
  `packages/engine/src/testing/wiring.test.ts`

**Interfaces:**
- **Consumes:** S3c's `fakeStackApis`, `FakeAppState`, `freshAppState`; S4's
  `fakeProviders`, `refusal` and `fakeProwlarr`.
- **Produces:**
  - `FakeAppState` gains `wizard: 'new' | 'open' | 'done'`, `apiKeys: FakeApiKey[]`,
    `sessions: Record<string, string>`, `libraries: FakeLibrary[]`, `configDir?: string`
    and `connections: FakeConnection[]`; Jellyfin's admin is its `user` and `password`;
  - `fakeStackApis()` answers `Host: jellyfin` with `fakeJellyfin`, Sonarr's and Radarr's
    `/api/v3/notification…` with `fakeServarrConnections`, and lists `fake-jellyfin` in
    `addresses`;
  - from `@mediaplane/engine/testing`:
    `interface FakeApiKey { AccessToken: string; AppName: string; DateCreated: string }`,
    `interface FakeLibrary { Name: string; CollectionType?: string; Locations: string[]; LibraryOptions: Record<string, unknown> }`,
    `` interface FakeConnection extends FakeProviderBase { [trigger: `on${string}`]: boolean | undefined } ``,
    `FAKE_JELLYFIN_USER_ID`, `fakeJellyfin(request, state)` and
    `fakeServarrConnections(request, service, state, jellyfin)`;
  - `fakeProwlarr(request, state, peek)`, `peek` giving a fresh state for an app it
    doesn't hold.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/testing/jellyfin.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAKE_JELLYFIN_USER_ID } from './jellyfin';
import { tempDir } from './temp';
import { fakeStackApis, freshAppState, type FakeAppState } from './wiring';

/** The client fields Jellyfin asks of a sign-in. */
const CLIENT =
  'MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"';

/** A token in Jellyfin's MediaBrowser header, with the client fields. */
const withToken = (token: string) => `${CLIENT}, Token="${token}"`;

/** One call to a fake app as `host`: its status, and its body (as JSON when it is). */
function call(
  port: number,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    host?: string;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const text = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? (text === undefined ? 'GET' : 'POST'),
        headers: {
          host: init.host ?? 'jellyfin:8096',
          ...(text === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
        reply.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: unknown = raw;
          try {
            body = JSON.parse(raw) as unknown;
          } catch {
            // Plain text, as Jellyfin's own refusals are.
          }
          resolve({ status: reply.statusCode ?? 0, body });
        });
      },
    );
    sent.on('error', reject);
    sent.end(text);
  });
}

/** The fake Jellyfin's state, as `apis` holds it. */
function jellyfinOf(apis: Awaited<ReturnType<typeof fakeStackApis>>): FakeAppState {
  const state = apis.apps.get('jellyfin');
  if (state === undefined) throw new Error('no Jellyfin faked');
  return state;
}

/** A Jellyfin whose wizard is done, with the admin and the key `key`. */
function setUp(key: string): FakeAppState {
  return {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: 'fake-admin-password',
    apiKeys: [
      {
        AccessToken: key,
        AppName: 'Mediaplane',
        DateCreated: '2026-10-15T12:00:00.000Z',
      },
    ],
  };
}

const KEY = '7'.repeat(32);

describe("fakeStackApis' Jellyfin", () => {
  it('runs its startup wizard as Jellyfin 12 does: the first user made by asking for it, named once, then completed', async () => {
    const apis = await fakeStackApis();
    const { port } = apis.app;
    const user = (body: unknown) => call(port, '/Startup/User', { body });
    const wizard = async () =>
      ((await call(port, '/System/Info/Public')).body as Record<string, unknown>)
        .StartupWizardCompleted;
    expect(await wizard()).toBe(false);
    // Before anything asks for the first user, there is none to name.
    expect((await user({ Name: 'admin', Password: 'fake-admin-password' })).status).toBe(
      404,
    );
    expect(await call(port, '/Startup/User')).toEqual({
      status: 200,
      body: { Name: 'abc' },
    });
    expect(await user({ Name: 'admin' })).toEqual({
      status: 400,
      body: 'Password must not be empty',
    });
    expect((await user({ Name: 'admin', Password: 'fake-admin-password' })).status).toBe(
      204,
    );
    // Its password is set: a second time is refused.
    expect((await user({ Name: 'admin', Password: 'fake-other-password' })).status).toBe(
      403,
    );
    expect((await call(port, '/Startup/Complete', { method: 'POST' })).status).toBe(204);
    expect(await wizard()).toBe(true);
    // Done: the wizard's endpoints refuse anyone without a token.
    expect((await call(port, '/Startup/User')).status).toBe(401);
    expect((await call(port, '/Startup/Complete', { method: 'POST' })).status).toBe(401);
  });

  it('signs in only with its client fields and the right password, one session per device, until it signs out', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const signIn = (
      Pw: string,
      headers: Record<string, string> = { authorization: CLIENT },
    ) =>
      call(port, '/Users/AuthenticateByName', {
        body: { Username: 'admin', Pw },
        headers,
      });
    expect((await signIn('fake-admin-password', {})).status).toBe(400);
    expect(
      (
        await signIn('fake-admin-password', {
          authorization: 'MediaBrowser Client="Mediaplane", Version="1"',
        })
      ).status,
    ).toBe(400);
    expect(await signIn('wrong')).toEqual({
      status: 401,
      body: 'Error processing request.',
    });
    const first = await signIn('fake-admin-password');
    expect(first).toMatchObject({
      status: 200,
      body: { User: { Name: 'admin', Id: FAKE_JELLYFIN_USER_ID } },
    });
    const token = (first.body as { AccessToken: string }).AccessToken;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const info = (t: string) =>
      call(port, '/System/Info', { headers: { authorization: withToken(t) } });
    expect((await info(token)).status).toBe(200);
    // A second sign-in from the same device ends the first session.
    const second = (await signIn('fake-admin-password')).body as { AccessToken: string };
    expect((await info(token)).status).toBe(401);
    expect(
      (
        await call(port, '/Sessions/Logout', {
          method: 'POST',
          headers: { authorization: withToken(second.AccessToken) },
        })
      ).status,
    ).toBe(204);
    expect((await info(second.AccessToken)).status).toBe(401);
    expect(jellyfinOf(apis).sessions).toEqual({});
  });

  it('makes API keys by name, lists them in full, and takes them only in its MediaBrowser header', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    expect(
      (await call(port, '/Auth/Keys?app=Mediaplane', { method: 'POST', headers: keyed }))
        .status,
    ).toBe(204);
    const { body } = await call(port, '/Auth/Keys', { headers: keyed });
    const items = (body as { Items: { AccessToken: string; AppName: string }[] }).Items;
    expect(items.map((k) => k.AppName)).toEqual(['Mediaplane', 'Mediaplane']);
    expect(items[1]?.AccessToken).toMatch(/^[0-9a-f]{32}$/);
    // Jellyfin 12's legacy ways to send a key are off.
    const info = (headers: Record<string, string>, query = '') =>
      call(port, `/System/Info${query}`, { headers });
    expect((await info({ 'x-emby-token': KEY })).status).toBe(401);
    expect((await info({ 'x-mediabrowser-token': KEY })).status).toBe(401);
    expect((await info({}, `?api_key=${KEY}`)).status).toBe(401);
    expect((await info({ authorization: `Bearer ${KEY}` })).status).toBe(401);
    expect((await info({ authorization: `MediaBrowser Token="${KEY}"` })).status).toBe(
      200,
    );
  });

  it('renames its admin and sets its password with a key, and refuses a user sent without its policy', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    const users = await call(port, '/Users', { headers: keyed });
    expect(users.body).toMatchObject([
      { Name: 'admin', Id: FAKE_JELLYFIN_USER_ID, Policy: { IsAdministrator: true } },
    ]);
    const path = `/Users/${FAKE_JELLYFIN_USER_ID}`;
    const [held] = users.body as Record<string, unknown>[];
    expect(
      (await call(port, path, { body: { Name: 'boss' }, headers: keyed })).status,
    ).toBe(400);
    expect(
      (await call(port, path, { body: { ...held, Name: 'boss' }, headers: keyed }))
        .status,
    ).toBe(204);
    expect(
      (
        await call(port, `${path}/Password`, {
          body: { NewPw: 'fake-new-password' },
          headers: keyed,
        })
      ).status,
    ).toBe(204);
    expect(jellyfinOf(apis)).toMatchObject({
      user: 'boss',
      password: 'fake-new-password',
    });
  });

  it('keeps libraries as Jellyfin does: folders it can see, a second of one name renamed, paths added and removed by name', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { port } = apis.app;
    const keyed = { authorization: withToken(KEY) };
    const add = (name: string, folder: string) =>
      call(
        port,
        `/Library/VirtualFolders?${new URLSearchParams({ name, collectionType: 'movies', paths: folder, refreshLibrary: 'true' }).toString()}`,
        { body: { LibraryOptions: { Enabled: true } }, headers: keyed },
      );
    expect(await add('Movies', '/data/media/movies')).toEqual({
      status: 400,
      body: 'Error processing request.',
    });
    // The wire step's folder helper: mkdir, in a throwaway container of Jellyfin.
    apis.mkdir('jellyfin', {
      user: { uid: 1000, gid: 1000 },
      entrypoint: 'mkdir',
      args: ['-p', '--', '/data/media/movies', '/data/media/other'],
      values: {},
    });
    expect((await add('Movies', '/data/media/movies')).status).toBe(204);
    expect((await add('Movies', '/data/media/movies')).status).toBe(204);
    const names = async () =>
      (
        (await call(port, '/Library/VirtualFolders', { headers: keyed })).body as {
          Name: string;
          Locations: string[];
        }[]
      ).map((l) => [l.Name, l.Locations]);
    expect(await names()).toEqual([
      ['Movies', ['/data/media/movies']],
      ['Movies2', ['/data/media/movies']],
    ]);
    const paths = '/Library/VirtualFolders/Paths';
    expect(
      (
        await call(port, `${paths}?refreshLibrary=true`, {
          body: { Name: 'Movies', Path: '/data/media/other/' },
          headers: keyed,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call(port, `${paths}?refreshLibrary=true`, {
          body: { Name: 'Movies', Path: '/nowhere' },
          headers: keyed,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          port,
          `${paths}?${new URLSearchParams({ name: 'Movies', path: '/data/media/movies' }).toString()}`,
          { method: 'DELETE', headers: keyed },
        )
      ).status,
    ).toBe(204);
    expect((await names())[0]).toEqual(['Movies', ['/data/media/other']]);
    const { body } = await call(port, '/Library/VirtualFolders', { headers: keyed });
    expect((body as Record<string, unknown>[])[0]).toMatchObject({
      CollectionType: 'movies',
      LibraryOptions: { Enabled: true, PathInfos: [{ Path: '/data/media/other' }] },
    });
  });

  it('offers a new library the fetchers Jellyfin 12 offers, some on by default', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const { body } = await call(
      apis.app.port,
      '/Libraries/AvailableOptions?libraryContentType=movies&isNewLibrary=true',
      { headers: { authorization: withToken(KEY) } },
    );
    expect(body).toMatchObject({
      TypeOptions: [
        {
          Type: 'Movie',
          MetadataFetchers: [
            { Name: 'TheMovieDb', DefaultEnabled: true },
            { Name: 'The Open Movie Database', DefaultEnabled: false },
          ],
        },
      ],
    });
  });

  it('writes system.xml as Jellyfin does: when it starts, and when its wizard is done', async () => {
    const apis = await fakeStackApis();
    const configDir = join(await tempDir('mediaplane-fake-jellyfin-'), 'jellyfin');
    apis.apps.set('jellyfin', { ...freshAppState(), configDir });
    const done = async () =>
      /<IsStartupWizardCompleted>(\w+)</.exec(
        await readFile(join(configDir, 'system.xml'), 'utf8'),
      )?.[1];
    await call(apis.app.port, '/System/Info/Public');
    expect(await done()).toBe('false');
    await call(apis.app.port, '/Startup/Complete', { method: 'POST' });
    expect(await done()).toBe('true');
  });
});

/** A connection to Jellyfin as Sonarr's template makes it, with these settings. */
function connection(
  values: { host?: string; port?: number; useSsl?: boolean; apiKey?: string } = {},
  triggers: Record<string, boolean> = { onDownload: true },
) {
  return {
    name: 'Jellyfin (Mediaplane)',
    implementation: 'MediaBrowser',
    tags: [],
    ...triggers,
    fields: [
      { name: 'host', value: values.host ?? 'jellyfin' },
      { name: 'port', value: values.port ?? 8096 },
      { name: 'useSsl', value: values.useSsl ?? false },
      { name: 'apiKey', value: values.apiKey ?? KEY },
      { name: 'updateLibrary', value: true },
    ],
  };
}

describe("fakeStackApis' Sonarr and Radarr connections to Jellyfin", () => {
  const save = (apis: Awaited<ReturnType<typeof fakeStackApis>>, sent: unknown) =>
    call(apis.app.port, '/api/v3/notification?forceSave=true', {
      body: sent,
      host: 'sonarr:8989',
      headers: { 'x-api-key': '0'.repeat(32) },
    });
  const refused = (property: string, message: string) => ({
    status: 400,
    body: [{ propertyName: property, errorMessage: message }],
  });

  it('tests a new one with a trigger on as it saves it, as Sonarr does: Jellyfin by its service, port and key', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    const unsent = (why: string) =>
      refused('Host', `Unable to send test message: ${why}`);
    expect(await save(apis, connection({ host: 'nowhere' }))).toMatchObject(
      unsent('Resource temporarily unavailable (nowhere:8096)'),
    );
    expect(await save(apis, connection({ port: 8097 }))).toMatchObject(
      unsent('Connection refused (jellyfin:8097)'),
    );
    expect(await save(apis, connection({ useSsl: true }))).toMatchObject(
      unsent('The SSL connection could not be established, see inner exception.'),
    );
    expect(await save(apis, connection({ apiKey: '' }))).toMatchObject(
      refused('ApiKey', "'Api Key' must not be empty."),
    );
    expect(await save(apis, connection({ apiKey: '9'.repeat(32) }))).toMatchObject(
      refused('ApiKey', 'API Key is invalid'),
    );
    expect(apis.apps.get('sonarr')?.connections).toEqual([]);
    expect(await save(apis, connection())).toMatchObject({
      status: 201,
      body: { id: 1 },
    });
    // Read back with its key masked.
    const held = await call(apis.app.port, '/api/v3/notification/1', {
      host: 'sonarr:8989',
      headers: { 'x-api-key': '0'.repeat(32) },
    });
    expect(JSON.stringify(held.body)).not.toContain(KEY);
  });

  it('refuses every key while Jellyfin has made none', async () => {
    const apis = await fakeStackApis();
    expect(await save(apis, connection())).toMatchObject(
      refused('ApiKey', 'API Key is invalid'),
    );
  });

  it('saves one with no trigger on untested, as the arrs do', async () => {
    const apis = await fakeStackApis();
    apis.apps.set('jellyfin', setUp(KEY));
    expect(
      (await save(apis, connection({ apiKey: '9'.repeat(32) }, { onDownload: false })))
        .status,
    ).toBe(201);
  });

  it("offers Sonarr's and Radarr's own triggers in their templates, all off", async () => {
    const apis = await fakeStackApis();
    const template = async (host: string) => {
      const { body } = await call(apis.app.port, '/api/v3/notification/schema', {
        host,
        headers: { 'x-api-key': '0'.repeat(32) },
      });
      const [offered] = body as Record<string, unknown>[];
      return Object.entries(offered ?? {}).filter(([name]) => name.startsWith('on'));
    };
    expect(await template('sonarr:8989')).toContainEqual(['onSeriesDelete', false]);
    expect(await template('radarr:7878')).toContainEqual(['onMovieDelete', false]);
  });
});
```

**Change** `packages/engine/src/testing/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.test.ts b/packages/engine/src/testing/wiring.test.ts
index e8146a0..88b72c9 100644
--- a/packages/engine/src/testing/wiring.test.ts
+++ b/packages/engine/src/testing/wiring.test.ts
@@ -205,2 +205,12 @@ describe("fakeStackApis' Sonarr and Radarr", () => {
 
+  it('saves a client sent without enable untested: the arrs take it as off', async () => {
+    const apis = await fakeStackApis();
+    const save = (sent: unknown) =>
+      json(apis.app.port, 'sonarr:8989', '/api/v3/downloadclient?forceSave=true', sent);
+    const { enable, ...unsaid } = client('gluetun', 8090);
+    expect(enable).toBe(true);
+    expect((await save(unsaid)).status).toBe(201);
+    expect(apis.apps.get('sonarr')?.downloadClients).toHaveLength(1);
+  });
+
   it('refuses to rename a client to the name of another, but not to its own', async () => {
@@ -506,2 +516,14 @@ describe("fakeStackApis' Prowlarr, as strictly as the app", () => {
 
+  it('tests a link or a proxy without adding the app it tests to the fake apps', async () => {
+    const apis = await fakeStackApis();
+    await saveLink(apis, link());
+    await json(
+      apis.app.port,
+      'prowlarr:9696',
+      '/api/v1/indexerproxy?forceSave=true',
+      proxyAt('http://byparr:8191/'),
+    );
+    expect([...apis.apps.keys()]).toEqual(['prowlarr']);
+  });
+
   it('refuses a proxy under a name taken, and a rename to one, but not a rename to its own', async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/testing`
Expected: FAIL. `jellyfin.test.ts` doesn't load
(`Cannot find module './jellyfin' imported from …/jellyfin.test.ts`), and 2 of
`wiring.test.ts`'s tests fail:
- "saves a client sent without enable untested: the arrs take it as off":
  `expected 400 to be 201`, since the fake tests it and refuses it;
- "tests a link or a proxy without adding the app it tests to the fake apps":
  `expected [ 'prowlarr', 'sonarr', 'byparr' ] to deeply equal [ 'prowlarr' ]`.

- [ ] **Step 3: Write the fakes**

**Create** `packages/engine/src/testing/jellyfin.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import {
  fakeProviders,
  refusal,
  type FakeProviderBase,
  type FakeRefusal,
} from './providers';
import type { FakeAppState } from './wiring';

/** One of Jellyfin's API keys, as /Auth/Keys lists it: in full. */
export interface FakeApiKey {
  AccessToken: string;
  AppName: string;
  DateCreated: string;
}

/** One of Jellyfin's libraries, as it keeps one. */
export interface FakeLibrary {
  Name: string;
  /** "movies", "tvshows"…; undefined for mixed content. */
  CollectionType?: string;
  /** Its folders, as Jellyfin lists them: one per link it keeps, so a path can repeat. */
  Locations: string[];
  /** The options it was made with. */
  LibraryOptions: Record<string, unknown>;
}

/** A connection of Sonarr or Radarr (a "notification"), as the arr keeps it. */
export interface FakeConnection extends FakeProviderBase {
  /** Its triggers, beside its settings: "onDownload", "onRename"… */
  [trigger: `on${string}`]: boolean | undefined;
}

/** The id of the fake Jellyfin's one user, its admin. */
export const FAKE_JELLYFIN_USER_ID = '0123456789abcdef0123456789abcdef';

/** The first user Jellyfin makes when its startup wizard asks for one, in this image. */
const FIRST_USER = 'abc';

/** What Jellyfin answers a request it refuses without saying why. */
const UNEXPLAINED = 'Error processing request.';

/** A token or key of the fake's, from a counter: 32 hex characters, as Jellyfin's. */
let made = 0;
function token(): string {
  made += 1;
  return made.toString(16).padStart(32, 'e');
}

/**
 * The fields of a `MediaBrowser` Authorization header (Client, Device, DeviceId, Version,
 * Token), or undefined for another header. Jellyfin 12 takes a token only there: its
 * legacy headers (X-Emby-Token, X-MediaBrowser-Token) and `?api_key=` are off.
 */
function mediaBrowser(header: string | undefined): Record<string, string> | undefined {
  const match = /^MediaBrowser\s+(.*)$/i.exec(header ?? '');
  if (match === null) return undefined;
  return Object.fromEntries(
    [...(match[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  );
}

/**
 * system.xml, which Jellyfin writes into its config folder when it starts, and again when
 * its startup wizard completes: `IsStartupWizardCompleted` says which.
 */
function keepSystemXml(state: FakeAppState): void {
  if (state.configDir === undefined) return;
  const path = join(state.configDir, 'system.xml');
  const content = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ServerConfiguration>',
    `  <IsStartupWizardCompleted>${String(state.wizard === 'done')}</IsStartupWizardCompleted>`,
    '</ServerConfiguration>',
    '',
  ].join('\n');
  try {
    if (readFileSync(path, 'utf8') === content) return;
  } catch {
    // Not there yet: Jellyfin writes it.
  }
  mkdirSync(state.configDir, { recursive: true });
  writeFileSync(path, content);
}

/** Jellyfin's answer to a call made without a token it takes. */
const UNAUTHORIZED: FakeReply = { status: 401 };

/** Jellyfin's user, as /Users lists it, with the policy fields a save must send back. */
function userOf(state: FakeAppState) {
  return {
    Name: state.user,
    Id: FAKE_JELLYFIN_USER_ID,
    HasPassword: state.password !== '',
    Policy: {
      IsAdministrator: true,
      IsDisabled: false,
      AuthenticationProviderId:
        'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
      PasswordResetProviderId:
        'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
    },
  };
}

/** A user name Jellyfin takes: letters, digits and a few signs, never empty. */
function validName(name: unknown): name is string {
  return typeof name === 'string' && /^[\w\-'.@+]+$/.test(name);
}

/** What Jellyfin 12 offers a new library of `type`, as /Libraries/AvailableOptions does. */
function availableOptions(type: string) {
  const fetchers = (...offered: [string, boolean][]) =>
    offered.map(([Name, DefaultEnabled]) => ({ Name, DefaultEnabled }));
  const images = (...limits: [string, number][]) =>
    limits.map(([Type, Limit]) => ({
      Type,
      Limit,
      MinWidth: Type === 'Backdrop' ? 1280 : 0,
    }));
  const typeOptions =
    type === 'movies'
      ? [
          {
            Type: 'Movie',
            MetadataFetchers: fetchers(
              ['TheMovieDb', true],
              ['The Open Movie Database', false],
            ),
            ImageFetchers: fetchers(
              ['TheMovieDb', true],
              ['The Open Movie Database', false],
              ['Embedded Image Extractor', false],
              ['Screen Grabber', true],
            ),
            SupportedImageTypes: ['Primary', 'Backdrop', 'Logo', 'Thumb'],
            DefaultImageOptions: images(['Backdrop', 1], ['Primary', 1], ['Logo', 1]),
          },
        ]
      : [
          {
            Type: 'Series',
            MetadataFetchers: fetchers(
              ['TheMovieDb', true],
              ['The Open Movie Database', false],
            ),
            ImageFetchers: fetchers(['TheMovieDb', false]),
            SupportedImageTypes: ['Primary', 'Backdrop', 'Logo', 'Thumb'],
            DefaultImageOptions: images(['Backdrop', 1], ['Primary', 1], ['Banner', 1]),
          },
          {
            Type: 'Episode',
            MetadataFetchers: fetchers(
              ['TheMovieDb', false],
              ['The Open Movie Database', false],
            ),
            ImageFetchers: fetchers(['TheMovieDb', false], ['Screen Grabber', true]),
            SupportedImageTypes: ['Primary'],
            DefaultImageOptions: images(['Primary', 1]),
          },
        ];
  return {
    MetadataSavers: fetchers(['Nfo', false]),
    MetadataReaders: fetchers(['Nfo', true]),
    SubtitleFetchers: [],
    LyricFetchers: [],
    MediaSegmentProviders: [],
    TypeOptions: typeOptions,
  };
}

/** A library as /Library/VirtualFolders lists it. */
function shown(library: FakeLibrary) {
  return {
    ...library,
    ItemId: Buffer.from(library.Name).toString('hex').padEnd(32, '0').slice(0, 32),
    RefreshStatus: 'Idle',
    LibraryOptions: {
      ...library.LibraryOptions,
      PathInfos: library.Locations.map((Path) => ({ Path })),
    },
  };
}

/** A path as Jellyfin lists it among a library's Locations: without a trailing "/". */
function trimmed(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Jellyfin's API, as fakeStackApis answers it, as Jellyfin 12 does, from `state`:
 * - its startup wizard: the first user is made by asking for it (GET /Startup/User), then
 *   named and given a password once (a second time is 403), and the wizard completed,
 *   which it takes even with no user; once done, only a key reaches it;
 * - a sign-in needs its client fields (Client, Device, DeviceId, Version) and gives a
 *   session token, one per device, until it signs out;
 * - API keys, listed in full, made by name; a token is taken only in the MediaBrowser
 *   Authorization header;
 * - its user, renamed or given a password with a key; its libraries, each needing a
 *   folder it can see (`state.folders`, as `mkdir` made them), a second of one name made
 *   as "<name>2"; and what it offers a new library.
 * It keeps system.xml in `state.configDir`, when that is set, as Jellyfin does.
 */
export function fakeJellyfin(request: FakeRequest, state: FakeAppState): FakeReply {
  keepSystemXml(state);
  const url = new URL(request.path, 'http://jellyfin');
  const { method } = request;
  const path = url.pathname;
  const auth = mediaBrowser(request.headers.authorization);
  const sessionOf = Object.entries(state.sessions).find(
    ([, value]) => value === auth?.Token,
  );
  const keyed =
    auth?.Token !== undefined &&
    (state.apiKeys.some((k) => k.AccessToken === auth.Token) || sessionOf !== undefined);
  const body = () => (request.body === '' ? {} : (JSON.parse(request.body) as unknown));
  if (path === '/System/Info/Public') {
    if (!state.up) {
      return {
        status: 503,
        body: 'Jellyfin Server is loading. Please try again shortly.',
      };
    }
    return {
      status: 200,
      body: {
        ServerName: 'jellyfin',
        Version: '12.2.0',
        ProductName: 'Jellyfin Server',
        StartupWizardCompleted: state.wizard === 'done',
      },
    };
  }
  // While the wizard is open, its endpoints answer anyone; once done, only a key.
  const wizardOpen = state.wizard !== 'done' || keyed;
  if (path === '/Startup/User' && method === 'GET') {
    if (!wizardOpen) return UNAUTHORIZED;
    if (state.wizard === 'new') {
      state.wizard = 'open';
      state.user = FIRST_USER;
    }
    return { status: 200, body: { Name: state.user } };
  }
  if (path === '/Startup/User' && method === 'POST') {
    if (!wizardOpen) return UNAUTHORIZED;
    if (state.wizard === 'new') {
      return { status: 404, body: { title: 'Not Found', status: 404 } };
    }
    const sent = body() as { Name?: unknown; Password?: unknown };
    if (typeof sent.Password !== 'string' || sent.Password === '') {
      return { status: 400, body: 'Password must not be empty' };
    }
    if (!validName(sent.Name)) return { status: 400, body: UNEXPLAINED };
    if (state.password !== '') return { status: 403 };
    state.user = sent.Name;
    state.password = sent.Password;
    return { status: 204 };
  }
  if (path === '/Startup/Complete' && method === 'POST') {
    if (!wizardOpen) return UNAUTHORIZED;
    state.wizard = 'done';
    keepSystemXml(state);
    return { status: 204 };
  }
  if (path === '/Users/AuthenticateByName' && method === 'POST') {
    const device = auth?.DeviceId;
    if (
      auth?.Client === undefined ||
      auth.Device === undefined ||
      device === undefined ||
      auth.Version === undefined
    ) {
      return { status: 400, body: UNEXPLAINED };
    }
    const sent = body() as { Username?: unknown; Pw?: unknown };
    const right =
      state.user !== '' &&
      state.password !== '' &&
      sent.Username === state.user &&
      sent.Pw === state.password;
    if (!right) return { status: 401, body: UNEXPLAINED };
    // A sign-in from a device ends that device's last session.
    const session = token();
    state.sessions[device] = session;
    return {
      status: 200,
      body: { User: userOf(state), AccessToken: session, ServerId: 'fake' },
    };
  }
  if (!keyed) return UNAUTHORIZED;
  if (path === '/System/Info') return { status: 200, body: { Version: '12.2.0' } };
  if (path === '/Sessions/Logout' && method === 'POST') {
    state.sessions = Object.fromEntries(
      Object.entries(state.sessions).filter(([device]) => device !== sessionOf?.[0]),
    );
    return { status: 204 };
  }
  if (path === '/Auth/Keys' && method === 'GET') {
    return {
      status: 200,
      body: {
        Items: state.apiKeys.map((k) => ({ Id: 0, ...k, IsActive: false })),
        TotalRecordCount: state.apiKeys.length,
        StartIndex: 0,
      },
    };
  }
  if (path === '/Auth/Keys' && method === 'POST') {
    const app = url.searchParams.get('app');
    if (app === null || app === '') return { status: 400, body: UNEXPLAINED };
    state.apiKeys.push({
      AccessToken: token(),
      AppName: app,
      DateCreated: new Date(Date.UTC(2026, 9, 15, 12, 0, made)).toISOString(),
    });
    return { status: 204 };
  }
  return fakeJellyfinLibrary(request, url, state, body) ?? { status: 404 };
}

/** Jellyfin's user and libraries, with a key: the rest of fakeJellyfin. */
function fakeJellyfinLibrary(
  request: FakeRequest,
  url: URL,
  state: FakeAppState,
  body: () => unknown,
): FakeReply | undefined {
  const { method } = request;
  const path = url.pathname;
  const query = (name: string) => url.searchParams.get(name) ?? '';
  const userPath = `/Users/${FAKE_JELLYFIN_USER_ID}`;
  if (path === '/Users' && method === 'GET') {
    return { status: 200, body: state.user === '' ? [] : [userOf(state)] };
  }
  if (path === userPath && method === 'GET') {
    return state.user === '' ? { status: 404 } : { status: 200, body: userOf(state) };
  }
  if (path === userPath && method === 'POST') {
    const sent = body() as {
      Name?: unknown;
      Policy?: { AuthenticationProviderId?: unknown; PasswordResetProviderId?: unknown };
    };
    if (
      typeof sent.Policy?.AuthenticationProviderId !== 'string' ||
      typeof sent.Policy.PasswordResetProviderId !== 'string'
    ) {
      return {
        status: 400,
        body: { title: 'One or more validation errors occurred.', status: 400 },
      };
    }
    if (!validName(sent.Name)) return { status: 400, body: UNEXPLAINED };
    state.user = sent.Name;
    return { status: 204 };
  }
  if (path === `${userPath}/Password` && method === 'POST') {
    const sent = body() as { NewPw?: unknown };
    if (typeof sent.NewPw !== 'string') return { status: 400, body: UNEXPLAINED };
    state.password = sent.NewPw;
    return { status: 204 };
  }
  if (path === '/Libraries/AvailableOptions' && method === 'GET') {
    return { status: 200, body: availableOptions(query('libraryContentType')) };
  }
  const named = (name: string) => state.libraries.find((l) => l.Name === name);
  const seen = (folder: string) => state.folders.includes(trimmed(folder));
  if (path === '/Library/VirtualFolders' && method === 'GET') {
    return { status: 200, body: state.libraries.map(shown) };
  }
  if (path === '/Library/VirtualFolders' && method === 'POST') {
    const paths = url.searchParams.getAll('paths');
    if (!paths.every(seen)) return { status: 400, body: UNEXPLAINED };
    // A second library of one name isn't refused: Jellyfin names it "<name>2".
    let name = query('name');
    while (named(name) !== undefined) name = `${name}2`;
    const type = query('collectionType');
    const sent = body() as { LibraryOptions?: Record<string, unknown> };
    state.libraries.push({
      Name: name,
      ...(type === '' ? {} : { CollectionType: type }),
      Locations: paths.map(trimmed),
      LibraryOptions: sent.LibraryOptions ?? {},
    });
    return { status: 204 };
  }
  if (path === '/Library/VirtualFolders' && method === 'DELETE') {
    const library = named(query('name'));
    if (library === undefined) return { status: 404, body: UNEXPLAINED };
    state.libraries.splice(state.libraries.indexOf(library), 1);
    return { status: 204 };
  }
  if (path === '/Library/VirtualFolders/Paths' && method === 'POST') {
    const sent = body() as { Name?: unknown; Path?: unknown };
    const library = named(String(sent.Name));
    if (library === undefined || typeof sent.Path !== 'string' || !seen(sent.Path)) {
      return { status: 404, body: UNEXPLAINED };
    }
    library.Locations.push(trimmed(sent.Path));
    return { status: 204 };
  }
  if (path === '/Library/VirtualFolders/Paths' && method === 'DELETE') {
    const library = named(query('name'));
    const at = library?.Locations.indexOf(trimmed(query('path'))) ?? -1;
    if (library !== undefined && at >= 0) library.Locations.splice(at, 1);
    return { status: 204 };
  }
  return undefined;
}

/** Each arr's triggers for a connection, as its template lists them, all off. */
const TRIGGERS: Readonly<Record<string, readonly string[]>> = {
  sonarr: [
    'onGrab',
    'onDownload',
    'onUpgrade',
    'onImportComplete',
    'onRename',
    'onSeriesAdd',
    'onSeriesDelete',
    'onEpisodeFileDelete',
    'onEpisodeFileDeleteForUpgrade',
    'onHealthIssue',
    'onHealthRestored',
    'onApplicationUpdate',
    'onManualInteractionRequired',
  ],
  radarr: [
    'onGrab',
    'onDownload',
    'onUpgrade',
    'onRename',
    'onMovieAdded',
    'onMovieDelete',
    'onMovieFileDelete',
    'onMovieFileDeleteForUpgrade',
    'onHealthIssue',
    'onHealthRestored',
    'onApplicationUpdate',
    'onManualInteractionRequired',
  ],
};

/** Sonarr's or Radarr's template for an "Emby / Jellyfin" connection. */
function mediaBrowserTemplate(service: string) {
  return {
    name: '',
    implementation: 'MediaBrowser',
    tags: [],
    presets: [],
    ...Object.fromEntries((TRIGGERS[service] ?? []).map((t) => [t, false])),
    fields: [
      { name: 'host' },
      { name: 'port', value: 8096 },
      { name: 'useSsl', value: false },
      { name: 'urlBase' },
      { name: 'apiKey' },
      { name: 'notify', value: false },
      { name: 'updateLibrary', value: true },
      { name: 'mapFrom' },
      { name: 'mapTo' },
    ],
  };
}

/**
 * Sonarr's or Radarr's test of a connection to Jellyfin, `sent` holding `key` in clear: its
 * refusal, or undefined when it passes. As theirs does, it reaches Jellyfin by its service
 * (jellyfin), while it runs, at 8096, without TLS, with one of Jellyfin's keys: none, until
 * Jellyfin has made one.
 */
function testConnection(
  sent: Pick<FakeConnection, 'fields'>,
  key: unknown,
  jellyfin: FakeAppState,
): FakeRefusal | undefined {
  const value = (name: string) => sent.fields.find((f) => f.name === name)?.value;
  const at = `${String(value('host'))}:${String(value('port'))}`;
  const unsent = (why: string) => refusal('Host', `Unable to send test message: ${why}`);
  if (value('host') !== 'jellyfin' || !jellyfin.up) {
    return unsent(`Resource temporarily unavailable (${at})`);
  }
  if (value('port') !== 8096) return unsent(`Connection refused (${at})`);
  if (value('useSsl') === true) {
    return unsent('The SSL connection could not be established, see inner exception.');
  }
  if (typeof key !== 'string' || key === '') {
    return refusal('ApiKey', "'Api Key' must not be empty.");
  }
  return jellyfin.apiKeys.some((k) => k.AccessToken === key)
    ? undefined
    : refusal('ApiKey', 'API Key is invalid');
}

/**
 * Sonarr's and Radarr's connections, as fakeStackApis answers them, as strictly as the
 * arrs: served as their other providers are, one with a trigger on tested as it is saved
 * (one with none is saved untested), and tested against `jellyfin`.
 */
export function fakeServarrConnections(
  request: FakeRequest,
  service: string,
  state: FakeAppState,
  jellyfin: FakeAppState,
): FakeReply | undefined {
  return fakeProviders<FakeConnection>(request, {
    path: '/api/v3/notification',
    held: state.connections,
    templates: () => [mediaBrowserTemplate(service)],
    test: (sent, key) => testConnection(sent, key, jellyfin),
    testedOnCreate: (sent) =>
      Object.entries(sent).some(([name, on]) => name.startsWith('on') && on === true),
  });
}
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index 0f0e309..8e5ce6c 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -10,2 +10,9 @@ import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixt
 import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';
+import {
+  fakeJellyfin,
+  fakeServarrConnections,
+  type FakeApiKey,
+  type FakeConnection,
+  type FakeLibrary,
+} from './jellyfin';
 import { fakeProwlarr, type FakeProvider } from './prowlarr';
@@ -142,2 +149,20 @@ export interface FakeAppState {
   tags: { id: number; label: string }[];
+  /**
+   * Jellyfin's startup wizard: `new` until its first user is made (asking for it makes
+   * it), `open` with that user, `done` once completed. Its admin is `user` and `password`.
+   */
+  wizard: 'new' | 'open' | 'done';
+  /** Jellyfin's API keys, in full, oldest first. */
+  apiKeys: FakeApiKey[];
+  /** Jellyfin's sessions from signing in: each device's token. */
+  sessions: Record<string, string>;
+  /** Jellyfin's libraries. */
+  libraries: FakeLibrary[];
+  /**
+   * Where Jellyfin keeps system.xml (its appdata folder): the fake writes it there as
+   * Jellyfin does, saying whether its wizard is done. Unset: nowhere.
+   */
+  configDir?: string;
+  /** Sonarr's or Radarr's connections, such as to Jellyfin, their keys in clear. */
+  connections: FakeConnection[];
 }
@@ -173,2 +198,7 @@ export function freshAppState(): FakeAppState {
     tags: [],
+    wizard: 'new',
+    apiKeys: [],
+    sessions: {},
+    libraries: [],
+    connections: [],
   };
@@ -257,3 +287,4 @@ function fakeServarrDownloads(
     test: (sent, key) => testClient(sent, key, state, qbittorrent),
-    testedOnCreate: (sent) => sent.enable,
+    // A client sent without `enable` is off, to the arr: it isn't tested.
+    testedOnCreate: (sent: Partial<FakeDownloadClient>) => sent.enable === true,
   });
@@ -298,9 +329,11 @@ function fakeServarrDownloads(
  * Radarr and Prowlarr have /ping, system/status, config/host and /login, the arrs their
- * download clients and root folders, and Prowlarr its links to them, its indexer proxies
- * and its tags (fakeProwlarr); qBittorrent has /, app/version, its sign-in
- * (with its ban), preferences and categories, answered as qBittorrent 5.2 answers them,
- * and is `apps`' "qbittorrent" also when reached through Gluetun. Any key is taken, but
- * qBittorrent takes only a Bearer token (X-Api-Key gets a 403): its `key` when that is
- * set. `seams` send every app's calls there. `mkdir` is what the wire step's folder
- * helper does to them: pass it what a fake runtime's `run` is given.
+ * download clients, root folders and connections (fakeServarrConnections), and Prowlarr
+ * its links to them, its indexer proxies and its tags (fakeProwlarr); qBittorrent has /,
+ * app/version, its sign-in (with its ban), preferences and categories, answered as
+ * qBittorrent 5.2 answers them, and is `apps`' "qbittorrent" also when reached through
+ * Gluetun; Jellyfin has its startup wizard, sign-in, keys, user and libraries
+ * (fakeJellyfin). Any key is taken, but qBittorrent takes only a Bearer token (X-Api-Key
+ * gets a 403): its `key` when that is set; and Jellyfin only one of its own, in its
+ * MediaBrowser header. `seams` send every app's calls there. `mkdir` is what the wire
+ * step's folder helper does to them: pass it what a fake runtime's `run` is given.
  */
@@ -327,2 +360,4 @@ export async function fakeStackApis(): Promise<{
   };
+  // What an app's test reads of another app, without adding it to `apps`.
+  const peek = (service: string) => apps.get(service) ?? freshAppState();
   const app = await fakeHttpApp((request) => {
@@ -333,2 +368,3 @@ export async function fakeStackApis(): Promise<{
     if (service === 'qbittorrent') return fakeQbittorrent(request, state);
+    if (service === 'jellyfin') return fakeJellyfin(request, state);
     const keyed =
@@ -362,4 +398,5 @@ export async function fakeStackApis(): Promise<{
       service === 'prowlarr'
-        ? fakeProwlarr(request, state, stateOf)
-        : fakeServarrDownloads(request, service, state, stateOf('qbittorrent'));
+        ? fakeProwlarr(request, state, peek)
+        : (fakeServarrDownloads(request, service, state, stateOf('qbittorrent')) ??
+          fakeServarrConnections(request, service, state, peek('jellyfin')));
     return answered ?? { status: 404 };
@@ -373,3 +410,10 @@ export async function fakeStackApis(): Promise<{
     },
-    addresses: onWiring(['gluetun', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']),
+    addresses: onWiring([
+      'gluetun',
+      'jellyfin',
+      'prowlarr',
+      'qbittorrent',
+      'radarr',
+      'sonarr',
+    ]),
     mkdir: (service, command) => {
```

**Change** `packages/engine/src/testing/prowlarr.ts`:

```diff
diff --git a/packages/engine/src/testing/prowlarr.ts b/packages/engine/src/testing/prowlarr.ts
index 6d1e11c..711431d 100644
--- a/packages/engine/src/testing/prowlarr.ts
+++ b/packages/engine/src/testing/prowlarr.ts
@@ -117,3 +117,3 @@ function testApplication(
   key: unknown,
-  stateOf: (service: string) => FakeAppState,
+  peek: (service: string) => FakeAppState,
 ): FakeRefusal | undefined {
@@ -124,3 +124,3 @@ function testApplication(
   // A stopped arr is nowhere to be found, as a host that isn't one.
-  if (!named || !stateOf(arr).up) {
+  if (!named || !peek(arr).up) {
     const why =
@@ -134,3 +134,3 @@ function testApplication(
   }
-  const expected = stateOf(arr).key;
+  const expected = peek(arr).key;
   if (typeof key !== 'string' || key === '' || (expected !== '' && key !== expected)) {
@@ -156,3 +156,3 @@ function testProxy(
   sent: Pick<FakeProvider, 'fields'>,
-  stateOf: (service: string) => FakeAppState,
+  peek: (service: string) => FakeAppState,
 ): FakeRefusal | undefined {
@@ -160,3 +160,3 @@ function testProxy(
   const reached = SOLVERS.includes(host.host) && host.port === SOLVER_PORT && !host.tls;
-  return reached && stateOf(host.host).up
+  return reached && peek(host.host).up
     ? undefined
@@ -170,3 +170,4 @@ function testProxy(
  * fakeStackApis answers them, as Prowlarr 2.6 does. A tag's label is kept lower-case,
- * and asking for one it has gives that one back.
+ * and asking for one it has gives that one back. Its tests read the other apps through
+ * `peek`, which gives an app it doesn't hold as it first starts, and holds it nowhere.
  */
@@ -175,3 +176,3 @@ export function fakeProwlarr(
   state: FakeAppState,
-  stateOf: (service: string) => FakeAppState,
+  peek: (service: string) => FakeAppState,
 ): FakeReply | undefined {
@@ -182,3 +183,3 @@ export function fakeProwlarr(
       templates: applicationTemplates,
-      test: (sent, key) => testApplication(sent, key, stateOf),
+      test: (sent, key) => testApplication(sent, key, peek),
       defaults: { tags: [] },
@@ -189,3 +190,3 @@ export function fakeProwlarr(
       templates: proxyTemplates,
-      test: (sent) => testProxy(sent, stateOf),
+      test: (sent) => testProxy(sent, peek),
       defaults: { tags: [] },
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 374c5c2..3d8b7f5 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -4,2 +4,3 @@ export * from './fakes';
 export * from './http';
+export * from './jellyfin';
 export * from './prowlarr';
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/engine/src/testing`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/testing
git commit -m "test(engine): a fake Jellyfin, the arrs' connections to it, and fakes no kinder than the apps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1525 tests pass in 76 files (1512 in 75 before this slice).

---

### Task 2: Bootstrap before publish, in the engine

The engine learns to start an app whose first-run setup is open without its ports, finish
its setup over the wiring network, keep the key it makes, and publish it. Nothing in the
real catalog uses it yet: the tests use a fixture app shaped like Jellyfin
(`SET_UP_CATALOG`), whose setup is a POST.

Decision: one more Compose file, on `up`'s standard input, resets the unpublished apps'
`ports`; the publishing `up` runs without it (decision 1).
Decision: an app is set up while its key isn't stored, or its appdata's `done` file
doesn't match; it starts unpublished unless that file matches; an unreadable file leaves
it to the key (decision 2).
Decision: a `bootstrap` step after `start`, only when the plan lists a setup; it keeps
each key at once, and publishes all but the apps whose setup is still open (decision 3).
Decision: `PlanResult.bootstrap`, `First-run setup:` and `bootstrap` in `--json`; a
container to start unpublished is `recreate`; its wiring after the start (decision 4).
Decision: the client's `mediabrowser` scheme, `submit`, `signIn` and `withKey`
(decision 6); `observe` sees `desired` (decision 8).

**Files:**
- Create: `packages/engine/src/plan/bootstrap.ts`, `packages/engine/src/apply/bootstrap.ts`,
  `packages/engine/src/testing/bootstrap.ts`
- Modify: `packages/engine/src/http/client.ts`, `packages/engine/src/catalog/types.ts`,
  `packages/engine/src/integrations/types.ts`, `packages/engine/src/integrations/wiring.ts`,
  `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/testing/fakes.ts`, `packages/engine/src/testing/index.ts`,
  `packages/engine/src/plan/plan.ts`, `packages/engine/src/history/records.ts`,
  `packages/engine/src/apply/apply.ts`, `packages/engine/src/index.ts`,
  `packages/cli/src/output.ts`
- Test: `packages/engine/src/plan/bootstrap.test.ts` (new),
  `packages/engine/src/http/client.test.ts`, `packages/engine/src/runtime/docker.test.ts`,
  `packages/engine/src/testing/fakes.test.ts`,
  `packages/engine/src/integrations/wiring.test.ts`,
  `packages/engine/src/apply/apply.test.ts`, `packages/cli/src/output.test.ts`

**Interfaces:**
- **Consumes:** S3b's `reachApps`, `knownSecrets`, `redactionValues`, `joinFailure`,
  `notOnNetwork`, `WIRING_RUNBOOK`; `adminLogin`, `writeSecretStore`; `readIfExists`.
- **Produces:**
  - `http/client.ts`: `type KeyScheme = 'x-api-key' | 'bearer' | 'mediabrowser'`;
    `AppApiOptions.key?: { scheme: KeyScheme; value?: string }`;
    `AppApi.submit(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void>`,
    `AppApi.signIn<T>(path: string, fields: Readonly<Record<string, string>>, schema: z.ZodType<T>, secrets: readonly string[]): Promise<T | undefined>`,
    `AppApi.withKey(value: string): AppApi`;
  - `catalog/types.ts`: `ApiSpec.key.scheme: KeyScheme`;
    `interface Bootstrap { secret: string; done: { path: string; pattern: RegExp }; open(api: AppApi): Promise<boolean>; run(api: AppApi, admin: { username: string; password: string }): Promise<string> }`;
    `AppDefinition.bootstrap?: Bootstrap`;
  - `integrations/types.ts`: `ResourceSpec.observe(api, known, desired?: DesiredResource)`;
  - `runtime/types.ts`: `Runtime.up(waitSeconds, values, unpublished?: readonly string[])`;
  - `plan/bootstrap.ts`: `interface BootstrapChange { app: string; unpublished: boolean }`,
    `planBootstrap(stack: ResolvedStack, store: SecretStore): Promise<BootstrapChange[]>`;
    `PlanResult.bootstrap: BootstrapChange[]`;
  - `apply/bootstrap.ts`: `bootstrapApps(options: BootstrapOptions): Promise<{ store: SecretStore; detail: string }>`,
    `class BootstrapFailed extends Error { hint: string }`;
  - the change record's step `'bootstrap'`, and `plan.bootstrap`;
  - `testing/bootstrap.ts`: `FAKE_SETUP`, `SET_UP_CATALOG`, `SET_UP_KEY`,
    `fakeSetUpApp(home)`, `interface FakeSetUpState`;
  - `fakeRuntime().up` records `up unpublished <services>`; `fakeDocker`'s `up` hashes an
    unpublished service without its ports.

- [ ] **Step 1: Write the failing tests, and the fixture they use**

**Create** `packages/engine/src/testing/bootstrap.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Bootstrap, Catalog } from '../catalog/types';
import type { AppApi } from '../http/client';
import type { WiringSeams } from '../integrations/wiring';
import { FIXTURE_API, fixtureCatalog } from './fixtures';
import { fakeHttpApp, type FakeApp } from './http';

/** The key the fake setup makes. */
export const SET_UP_KEY = '9'.repeat(32);

/** Whether FAKE_SETUP's app can still be claimed. */
async function open(api: AppApi): Promise<boolean> {
  return !(await api.get('/setup', z.looseObject({ done: z.boolean() }))).done;
}

/**
 * A first-run setup shaped like Jellyfin's: open until a POST of /setup finishes it, as
 * the admin, which makes the app's key (GET /key) and writes setup.txt in its appdata.
 */
export const FAKE_SETUP: Bootstrap = {
  secret: 'apiKey',
  done: { path: 'setup.txt', pattern: /^done$/m },
  open,
  async run(api, admin) {
    if (await open(api)) await api.submit('POST', '/setup', { user: admin.username });
    return (await api.get('/key', z.looseObject({ key: z.string() }))).key;
  },
};

/** The fixture catalog, with Jellyfin given an API, a key it makes, and FAKE_SETUP. */
export const SET_UP_CATALOG: Catalog = fixtureCatalog.map((def) =>
  def.id === 'jellyfin'
    ? {
        ...def,
        api: { ...FIXTURE_API, ready: '/ready', check: '/check' },
        secrets: { apiKey: { createdBy: 'app' } },
        bootstrap: FAKE_SETUP,
      }
    : def,
);

/** What the app behind FAKE_SETUP holds; a test may change it between calls. */
export interface FakeSetUpState {
  /** Whether its setup is done. */
  done: boolean;
  /** Its key, once its setup made one. */
  key: string;
  /** Refuse the setup's POST with this message (400). Empty: take it. */
  refuse: string;
  /** Fail GET /key, with a 500. */
  keyFails: boolean;
  /** Who the setup was finished as. */
  admin: string;
}

/**
 * The app behind FAKE_SETUP, as Jellyfin of the stack in `home`: /ready, /setup (its
 * state, and a POST that finishes it), /key, and /check, which takes only its key. A
 * finished setup writes appdata/jellyfin/setup.txt, as Jellyfin writes its system.xml.
 * `addresses` put Jellyfin's fake container on the wiring network, and `seams` send its
 * calls here.
 */
export async function fakeSetUpApp(home: string): Promise<{
  app: FakeApp;
  state: FakeSetUpState;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const state: FakeSetUpState = {
    done: false,
    key: '',
    refuse: '',
    keyFails: false,
    admin: '',
  };
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    if (path === '/ready') return { status: 200 };
    if (path === '/setup' && method === 'GET') {
      return { status: 200, body: { done: state.done } };
    }
    if (path === '/setup' && method === 'POST') {
      if (state.refuse !== '') return { status: 400, body: { message: state.refuse } };
      state.admin = (JSON.parse(request.body) as { user: string }).user;
      state.done = true;
      state.key = SET_UP_KEY;
      writeFileSync(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
      return { status: 204 };
    }
    if (path === '/key') {
      return state.keyFails
        ? { status: 500, body: { message: 'fake failure' } }
        : { status: 200, body: { key: state.key } };
    }
    if (path === '/check') {
      return {
        status: state.key !== '' && headers['x-api-key'] === state.key ? 200 : 401,
      };
    }
    return { status: 404 };
  });
  return {
    app,
    state,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: { 'fake-jellyfin': '127.0.0.1' },
  };
}
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 3d8b7f5..b61a6f2 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -1,2 +1,3 @@
 // Test helpers for this repo's tests only; not part of the engine's public API.
+export * from './bootstrap';
 export * from './fixtures';
```

**Create** `packages/engine/src/plan/bootstrap.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { emptySecretStore, type SecretStore } from '../secrets/store';
import { SET_UP_CATALOG } from '../testing/bootstrap';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { planBootstrap } from './bootstrap';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

/** The stack, resolved with the fake setup's Jellyfin, in a home of its own. */
async function stackIn(): Promise<ResolvedStack> {
  const home = await tempDir('mediaplane-bootstrap-');
  const resolved = resolveStack(fixtureConfig(STACK), SET_UP_CATALOG, FIXTURE_HOST, home);
  if (resolved.stack === undefined) throw new Error(JSON.stringify(resolved.diagnostics));
  return resolved.stack;
}

/** Jellyfin's setup.txt, saying `text` (a folder, for undefined: it can't be read). */
async function setupFile(stack: ResolvedStack, text: string | undefined): Promise<void> {
  const folder = join(stack.home, 'appdata', 'jellyfin');
  await mkdir(folder, { recursive: true });
  if (text === undefined) await mkdir(join(folder, 'setup.txt'));
  else await writeFile(join(folder, 'setup.txt'), text);
}

const KEYED: SecretStore = { version: 1, apps: { jellyfin: { apiKey: '9'.repeat(32) } } };

describe('planBootstrap', () => {
  it('sets up, unpublished, an app with no key and no sign that its setup is done', async () => {
    const stack = await stackIn();
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
    // Its file says the setup is still open.
    await setupFile(stack, 'open\n');
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
  });

  it('only makes the key, published, when the setup is done but no key is stored', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: false },
    ]);
  });

  it('sets up again, unpublished, an app whose appdata lost its setup, though its key is stored', async () => {
    const stack = await stackIn();
    expect(await planBootstrap(stack, KEYED)).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
  });

  it('has nothing to do with the key stored and the setup done', async () => {
    const stack = await stackIn();
    await setupFile(stack, 'done\n');
    expect(await planBootstrap(stack, KEYED)).toEqual([]);
  });

  it('lets the stored key decide when it cannot read the file', async () => {
    const stack = await stackIn();
    await setupFile(stack, undefined);
    expect(await planBootstrap(stack, KEYED)).toEqual([]);
    expect(await planBootstrap(stack, emptySecretStore())).toEqual([
      { app: 'jellyfin', unpublished: true },
    ]);
  });

  it('has nothing to set up in a stack whose apps have no setup', async () => {
    const resolved = resolveStack(
      fixtureConfig(STACK),
      fixtureCatalog,
      FIXTURE_HOST,
      await tempDir('mediaplane-bootstrap-'),
    );
    if (resolved.stack === undefined) throw new Error('the stack must resolve');
    expect(await planBootstrap(resolved.stack, emptySecretStore())).toEqual([]);
  });
});
```

**Change** `packages/engine/src/http/client.test.ts`:

```diff
diff --git a/packages/engine/src/http/client.test.ts b/packages/engine/src/http/client.test.ts
index 1b39b30..b6b2053 100644
--- a/packages/engine/src/http/client.test.ts
+++ b/packages/engine/src/http/client.test.ts
@@ -1126 +1126,116 @@ describe('createAppApi', () => {
 });
+
+/** The client fields Mediaplane sends Jellyfin on every call. */
+const CLIENT_FIELDS =
+  'MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"';
+
+describe("createAppApi: Jellyfin's ways", () => {
+  const jellyfin = { name: 'Jellyfin', service: 'jellyfin', port: 8096 };
+
+  it('carries its key in the MediaBrowser header, with its client fields on every call', async () => {
+    const { api, app } = await sonarr(
+      () => ({ status: 200, body: { version: '12.2.0' } }),
+      {
+        ...jellyfin,
+        key: { scheme: 'mediabrowser', value: KEY },
+      },
+    );
+    await api.get('/System/Info', STATUS);
+    await api.ready('/System/Info/Public');
+    expect(app.requests.map((r) => r.headers.authorization)).toEqual([
+      `${CLIENT_FIELDS}, Token="${KEY}"`,
+      CLIENT_FIELDS,
+    ]);
+    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
+  });
+
+  it('calls an app its own way before it has a key, and a Servarr app with no key header', async () => {
+    const { api, app } = await sonarr(
+      () => ({ status: 200, body: { version: '12.2.0' } }),
+      {
+        ...jellyfin,
+        key: { scheme: 'mediabrowser' },
+      },
+    );
+    await api.get('/System/Info/Public', STATUS);
+    expect(app.requests[0]?.headers.authorization).toBe(CLIENT_FIELDS);
+    const keyless = await sonarr(() => ({ status: 200, body: { version: '4.0.20' } }), {
+      key: { scheme: 'x-api-key' },
+    });
+    await keyless.api.get('/api/v3/system/status', STATUS);
+    expect(keyless.app.requests[0]?.headers).not.toHaveProperty('x-api-key');
+    expect(keyless.app.requests[0]?.headers).not.toHaveProperty('authorization');
+  });
+
+  it('POSTs and DELETEs, taking any 2xx as done without reading it, and sends a POST again only when nothing reached the app', async () => {
+    const statuses = [204, 503, 503, 204];
+    const { api, app, slept } = await sonarr(
+      () => ({ status: statuses.shift() ?? 500 }),
+      {
+        ...jellyfin,
+        key: { scheme: 'mediabrowser', value: KEY },
+      },
+    );
+    await api.submit('POST', '/Startup/User', { Name: 'admin' });
+    expect(app.requests[0]).toMatchObject({
+      method: 'POST',
+      path: '/Startup/User',
+      body: '{"Name":"admin"}',
+      headers: { 'content-type': 'application/json' },
+    });
+    expect(await failure(api.submit('POST', '/Startup/Complete'))).toMatchObject({
+      kind: 'server',
+      status: 503,
+    });
+    expect(app.requests[1]?.body).toBe('');
+    // A DELETE is tried again, as a GET is.
+    await api.submit('DELETE', '/Library/VirtualFolders/Paths?name=Movies');
+    expect(app.requests.map((r) => r.method)).toEqual([
+      'POST',
+      'POST',
+      'DELETE',
+      'DELETE',
+    ]);
+    expect(slept).toHaveLength(1);
+  });
+
+  it('signs in with JSON and without the key: the answer, or nothing when refused, never the password', async () => {
+    const { api, app } = await sonarr(
+      (request) => {
+        const { Pw } = JSON.parse(request.body) as { Pw: string };
+        if (Pw === PASSWORD)
+          return { status: 200, body: { AccessToken: 'e'.repeat(32) } };
+        if (Pw === 'fake-odd-password') return { status: 400, body: `bad ${Pw}` };
+        return { status: 401, body: 'Error processing request.' };
+      },
+      { ...jellyfin, key: { scheme: 'mediabrowser', value: KEY } },
+    );
+    const token = z.looseObject({ AccessToken: z.string() });
+    const signIn = (pw: string) =>
+      api.signIn('/Users/AuthenticateByName', { Username: 'admin', Pw: pw }, token, [pw]);
+    expect(await signIn(PASSWORD)).toEqual({ AccessToken: 'e'.repeat(32) });
+    expect(await signIn('fake-wrong-password')).toBeUndefined();
+    const refused = await failure(signIn('fake-odd-password'));
+    expect(refused.message).toBe(
+      'Jellyfin at http://jellyfin:8096 (127.0.0.1) refused the request (HTTP 400): bad *** (POST /Users/AuthenticateByName)',
+    );
+    expect(app.requests[0]?.headers.authorization).toBe(CLIENT_FIELDS);
+    expect(app.requests[0]?.headers['content-type']).toBe('application/json');
+    expect(app.requests).toHaveLength(3);
+  });
+
+  it('gives the same app with another key, which it keeps out of what it says', async () => {
+    const session = 'd'.repeat(32);
+    const { api, app } = await sonarr(
+      (request) => ({ status: 401, body: `no ${String(request.headers.authorization)}` }),
+      { ...jellyfin, key: { scheme: 'mediabrowser', value: KEY }, secrets: [] },
+    );
+    const refused = await failure(api.withKey(session).check('/System/Info'));
+    expect(app.requests[0]?.headers.authorization).toBe(
+      `${CLIENT_FIELDS}, Token="${session}"`,
+    );
+    expect(refused.message).toBe(
+      `Jellyfin at http://jellyfin:8096 (127.0.0.1) refused Mediaplane's API key (HTTP 401): no ${CLIENT_FIELDS}, Token="***" (GET /System/Info)`,
+    );
+  });
+});
```

**Change** `packages/engine/src/runtime/docker.test.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.test.ts b/packages/engine/src/runtime/docker.test.ts
index 0756b2b..66a7b27 100644
--- a/packages/engine/src/runtime/docker.test.ts
+++ b/packages/engine/src/runtime/docker.test.ts
@@ -587,2 +587,38 @@ describe('createDockerRuntime', () => {
 
+  it('starts services without any published port through one more file, on its standard input', async () => {
+    const dir = await tempDir('mediaplane-runtime-');
+    await writeFile(join(dir, 'compose.override.yaml'), 'services: {}\n');
+    const { exec, calls } = recorder(() => ok(''));
+    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
+    expect(await runtime.up(600, {}, ['jellyfin'])).toEqual({ ok: true });
+    // After the user's override, so that its ports for the service go too.
+    expect(calls[0]?.args).toEqual([
+      'compose',
+      '-p',
+      'mediaplane-test',
+      '--project-directory',
+      dir,
+      '-f',
+      join(dir, 'generated/compose.yaml'),
+      '-f',
+      join(dir, 'compose.override.yaml'),
+      '--env-file',
+      join(dir, 'generated/.env'),
+      '-f',
+      '-',
+      'up',
+      '--detach',
+      '--wait',
+      '--wait-timeout',
+      '600',
+      '--remove-orphans',
+      '--quiet-pull',
+    ]);
+    expect(calls[0]?.options?.input).toBe(
+      'services:\n  jellyfin:\n    ports: !reset []\n',
+    );
+    await expect(runtime.up(600, {}, ['-f'])).rejects.toThrow('not a service name: "-f"');
+    expect(calls).toHaveLength(1);
+  });
+
   it("reports a failed command with Compose's last lines, secrets replaced", async () => {
```

**Change** `packages/engine/src/testing/fakes.test.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.test.ts b/packages/engine/src/testing/fakes.test.ts
index bad3704..5abb90c 100644
--- a/packages/engine/src/testing/fakes.test.ts
+++ b/packages/engine/src/testing/fakes.test.ts
@@ -36,2 +36,27 @@ describe('fakeDocker', () => {
 
+  it('hashes a service up starts unpublished as having no ports, and says so in its calls', async () => {
+    const home = await tempDir('mediaplane-fakes-');
+    await mkdir(join(home, 'generated'));
+    const published = `services:
+  web:
+    image: registry.test/web:1
+    ports:
+      - 127.0.0.1:8096:8096
+`;
+    await writeFile(join(home, COMPOSE_PATH), published);
+    await writeFile(join(home, ENV_PATH), '');
+    const docker = fakeDocker(home);
+    await docker.up(600, {}, ['web']);
+    const hash = async () => (await docker.containers())[0]?.configHash;
+    expect(await hash()).toBe(
+      fakeHash('services:\n  web:\n    image: registry.test/web:1\n', {}).web,
+    );
+    await docker.up(600, {});
+    expect(await hash()).toBe(fakeHash(published, {}).web);
+    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
+      'up unpublished web',
+      'up',
+    ]);
+  });
+
   it('can fail a step or leave the containers as they were', async () => {
```

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 85a2e7c..758f3a2 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -139,2 +139,26 @@ describe('planWiring', () => {
 
+  it('looks a resource up with what the stack wants of it: a name that comes from the stack', async () => {
+    // Jellyfin's admin is the user named as the shared admin, before resources.json
+    // records its id.
+    const seen: unknown[] = [];
+    const named: ResourceSpec = {
+      ...FAKE_LOGIN,
+      observe: (api, known, desired) => {
+        seen.push(desired);
+        return FAKE_LOGIN.observe(api, known);
+      },
+    };
+    const stack = stackOf(
+      WIRED_CATALOG.map((def) =>
+        def.id === 'sonarr'
+          ? { ...def, integration: { after: [], resources: [named] } }
+          : def,
+      ),
+    );
+    await planWiring(options(await fakeSonarr({ key: KEY }), { stack }));
+    expect(seen).toEqual([
+      { name: 'login', fields: { user: 'admin' }, secrets: { password: PASSWORD } },
+    ]);
+  });
+
   /** WIRED_CATALOG, with Sonarr's resources replaced by `resources`. */
```

**Change** `packages/engine/src/apply/apply.test.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 88cfa39..5748aad 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -17,2 +17,3 @@ import { listRecords } from '../history/records';
 import { readResources } from '../integrations/resources';
+import { plan } from '../plan/plan';
 import { runbookUrl } from '../runbooks';
@@ -28,3 +29,11 @@ import { WiringRefused } from '../runtime/docker';
 import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
-import { fakeDocker, fakeProbe, HEALTHY_PROBE, probeOutput } from '../testing/fakes';
+import { readSecretStore, writeSecretStore } from '../secrets/store';
+import { fakeSetUpApp, SET_UP_CATALOG, SET_UP_KEY } from '../testing/bootstrap';
+import {
+  fakeDocker,
+  fakeProbe,
+  HEALTHY_PROBE,
+  probeOutput,
+  type FakeRuntimeOptions,
+} from '../testing/fakes';
 import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
@@ -1568 +1577,183 @@ describe('apply: what a failed wiring says to do', () => {
 });
+
+describe('apply: first-run setup before the ports are published', () => {
+  /**
+   * The fake setup's stack, and a Docker that notes, at each up, which apps it starts
+   * without their ports and whether the setup is done then.
+   */
+  async function setUpStack(more: FakeRuntimeOptions = {}) {
+    const home = await makeHome();
+    const setup = await fakeSetUpApp(home);
+    const docker = fakeDocker(home, { addresses: setup.addresses, ...more });
+    const ups: string[] = [];
+    const runtime: Runtime = {
+      ...docker,
+      up: (seconds, values, unpublished = []) => {
+        const shown =
+          unpublished.length === 0
+            ? 'all published'
+            : `${unpublished.join(' ')} unpublished`;
+        ups.push(`${shown}, setup ${setup.state.done ? 'done' : 'open'}`);
+        return docker.up(seconds, values, unpublished);
+      },
+    };
+    const extra = { catalog: SET_UP_CATALOG, wiring: setup.seams };
+    const run = (more: Partial<ApplyOptions> = {}) =>
+      apply(options(home, runtime, { ...extra, ...more }));
+    return { home, setup, docker, runtime, ups, run, extra };
+  }
+
+  it('names the setup in plan, and never runs it there', async () => {
+    const { home, setup, runtime, extra } = await setUpStack();
+    const shown = await plan(options(home, runtime, extra));
+    expect(shown.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    expect(shown.changed).toBe(true);
+    expect(setup.app.requests).toEqual([]);
+  });
+
+  it('starts an app whose setup is open without its ports, sets it up, saves its key at once, then publishes it', async () => {
+    const { home, setup, docker, ups, run } = await setUpStack();
+    const onStep = (event: StepEvent) => {
+      if (event.phase === 'start') docker.calls.push(`step ${event.step}`);
+    };
+    const first = await run({ onStep });
+    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
+    expect(first.outcome).toBe('success');
+    expect(first.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    expect(first.plan.wiring).toEqual([{ resource: 'jellyfin', action: 'after-start' }]);
+    expect(first.actions.map((a) => a.step)).toEqual([
+      'keys',
+      'files',
+      'pull',
+      'ownership',
+      'start',
+      'bootstrap',
+      'wire',
+      'verify',
+    ]);
+    expect(first.actions.find((a) => a.step === 'start')?.detail).toBe(
+      'every app is running and healthy; started jellyfin without its ports, to set it up first',
+    );
+    expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+      'set up jellyfin and saved jellyfin.apiKey; published jellyfin',
+    );
+    // Its ports were published only once its setup was done, as the shared admin.
+    expect(ups).toEqual([
+      'jellyfin unpublished, setup open',
+      'all published, setup done',
+    ]);
+    expect(setup.state.admin).toBe('admin');
+    const during = docker.calls.slice(
+      docker.calls.indexOf('step bootstrap') + 1,
+      docker.calls.indexOf('step wire'),
+    );
+    expect(during).toEqual([
+      'join-wiring',
+      'containers',
+      'wiring-addresses fake-jellyfin',
+      // Off the wiring network before up, as the start step steps off (ADR 0011).
+      'leave-wiring',
+      'up',
+    ]);
+    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
+    const [record] = (await listRecords(home)).records;
+    expect(record?.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    expect(JSON.stringify([first, record])).not.toContain(SET_UP_KEY);
+    expect((await run()).outcome).toBe('no-changes');
+  });
+
+  it("keeps an app whose setup fails while it is open unpublished, and fails with the app's words", async () => {
+    const { home, setup, ups, run } = await setUpStack();
+    setup.state.refuse = 'fake refusal';
+    const result = await run();
+    expect(result.outcome).toBe('failed');
+    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
+      ['bootstrap', 'failed'],
+      ['wire', 'skipped'],
+      ['verify', 'skipped'],
+    ]);
+    expect(ups).toEqual([
+      'jellyfin unpublished, setup open',
+      'jellyfin unpublished, setup open',
+    ]);
+    expect(result.diagnostics.at(-1)).toMatchObject({
+      code: 'apply.bootstrap-failed',
+      message:
+        'the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the request (HTTP 400): fake refusal (POST /setup)',
+      hint: `fix what the error says, then run apply again: an app whose setup is still open keeps its ports unpublished until then. See ${RUNBOOK}`,
+    });
+    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
+  });
+
+  it('publishes nothing when the setup fails before it reaches the app', async () => {
+    // No wiring network after the start: the setup can't reach the app, so it stays open.
+    const { home, setup, ups, run } = await setUpStack({ join: 'no-network' });
+    const result = await run();
+    expect(result.outcome).toBe('failed');
+    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
+      ['bootstrap', 'failed'],
+      ['wire', 'skipped'],
+      ['verify', 'skipped'],
+    ]);
+    expect(result.diagnostics.at(-1)).toMatchObject({
+      code: 'apply.bootstrap-failed',
+      message: 'the stack has no wiring network, though apply has just started it',
+    });
+    // Only the start step's up, which left it unpublished.
+    expect(ups).toEqual(['jellyfin unpublished, setup open']);
+    expect(setup.app.requests).toEqual([]);
+    expect((await readSecretStore(home)).apps.jellyfin).toBeUndefined();
+  });
+
+  it('publishes an app whose setup is done though making its key failed, then only makes the key', async () => {
+    const { home, setup, ups, run } = await setUpStack();
+    setup.state.keyFails = true;
+    const failed = await run();
+    expect(failed.outcome).toBe('failed');
+    expect(failed.diagnostics.at(-1)?.message).toBe(
+      'the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) failed (HTTP 500): fake failure (GET /key)',
+    );
+    // Nobody can claim it any more: it is published all the same.
+    expect(ups).toEqual([
+      'jellyfin unpublished, setup open',
+      'all published, setup done',
+    ]);
+    setup.state.keyFails = false;
+    const again = await run();
+    expect(again.outcome).toBe('success');
+    expect(again.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
+    expect(again.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
+      'unchanged',
+    );
+    expect(again.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+      'set up jellyfin and saved jellyfin.apiKey',
+    );
+    // Only the start step's up: the bootstrap step had nothing to publish.
+    expect(ups.slice(2)).toEqual(['all published, setup done']);
+    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
+  });
+
+  it('sets up again, without its ports, an app whose appdata lost its setup, and keeps its new key', async () => {
+    const { home, setup, ups, run } = await setUpStack();
+    expect((await run()).outcome).toBe('success');
+    // Its appdata emptied by hand: it starts its setup again, with the old key stored.
+    await rm(join(home, 'appdata', 'jellyfin', 'setup.txt'));
+    Object.assign(setup.state, { done: false, key: '' });
+    const store = await readSecretStore(home);
+    await writeSecretStore(home, {
+      ...store,
+      apps: { ...store.apps, jellyfin: { apiKey: '8'.repeat(32) } },
+    });
+    const again = await run();
+    expect(again.outcome).toBe('success');
+    expect(again.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    expect(again.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
+      'recreate',
+    );
+    expect(ups.slice(2)).toEqual([
+      'jellyfin unpublished, setup open',
+      'all published, setup done',
+    ]);
+    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
+  });
+});
```

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index cf5a0e6..4ec2b23 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -34,2 +34,3 @@ const PLAN: PlanResult = {
   wiring: [],
+  bootstrap: [],
   diagnostics: [],
@@ -113,2 +114,53 @@ describe('printPlan', () => {
 
+describe('printPlan: first-run setup', () => {
+  it('lists each app to set up, and how, and counts them', () => {
+    const term = capture();
+    printPlan(
+      {
+        ...PLAN,
+        files: [],
+        bootstrap: [
+          { app: 'jellyfin', unpublished: true },
+          { app: 'other', unpublished: false },
+        ],
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      'First-run setup:\n  + jellyfin (with no port published until it is done)\n  + other (signing in as the admin, to make its key)\nPlan: 2 apps to set up.\n',
+    );
+  });
+
+  it('shows the step by its name as apply runs it', () => {
+    const term = capture();
+    printStep(
+      {
+        step: 'bootstrap',
+        phase: 'end',
+        action: { step: 'bootstrap', result: 'done', detail: 'set up jellyfin' },
+      },
+      term.io,
+    );
+    expect(term.stdout()).toBe('  done    first-run setup: set up jellyfin\n');
+  });
+
+  it("gives apply's plan of it in JSON", () => {
+    const term = capture();
+    const bootstrap = [{ app: 'jellyfin', unpublished: true }];
+    printApply(
+      {
+        outcome: 'success',
+        plan: { ...PLAN, bootstrap },
+        actions: [],
+        recordId: 'fake-record',
+        diagnostics: [],
+      },
+      { json: true },
+      term.io,
+    );
+    expect(JSON.parse(term.stdout())).toMatchObject({ plan: { bootstrap } });
+  });
+});
+
 describe('the wire step, as apply shows it', () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/http packages/engine/src/runtime/docker.test.ts packages/engine/src/testing/fakes.test.ts packages/engine/src/integrations packages/engine/src/plan/bootstrap.test.ts packages/engine/src/apply packages/cli/src/output.test.ts`
Expected: FAIL. `plan/bootstrap.test.ts` doesn't load
(`Cannot find module './bootstrap'`), and 17 tests fail in 6 files:
- `client.test.ts`, 5: no MediaBrowser header (`expected [ undefined, undefined ]`), and
  `api.submit`, `api.signIn` and `api.withKey` are not functions;
- `docker.test.ts`, 1: `up` sends no `-f -` (16 arguments where 18 are expected);
- `fakes.test.ts`, 1: the unpublished service is hashed with its ports;
- `wiring.test.ts`, 1: `observe` is given no desired resource
  (`expected [ undefined ] to deeply equal [ { name: 'login', … } ]`);
- `apply.test.ts`, 6: the plan has no `bootstrap`, and apply runs no bootstrap step, so the
  fixture's setup is never run and its wiring fails. One of them, "publishes nothing when
  the setup fails before it reaches the app", fails here only because there is no step
  yet: it needs no code of its own. Written after Step 3, it passes at once, since it
  pins what the step does anyway (no `up` but the start step's when the setup can't reach
  its app). Without Step 3's `leaveWiring` call, "starts an app whose setup is open…"
  fails on its order of calls (`'leave-wiring'` before the publishing `up`);
- `output.test.ts`, 3: no `First-run setup:` lines, no step label (`undefined: set up
  jellyfin`), and no `bootstrap` in `apply --json`'s plan.

- [ ] **Step 3: Write the client, the contract, the runtime, plan and apply**

**Change** `packages/engine/src/http/client.ts`:

```diff
diff --git a/packages/engine/src/http/client.ts b/packages/engine/src/http/client.ts
index 6b1d7e3..7c77980 100644
--- a/packages/engine/src/http/client.ts
+++ b/packages/engine/src/http/client.ts
@@ -64,2 +64,16 @@ export interface TestFailure {
 
+/**
+ * How a request carries the key: the X-Api-Key header (Servarr), a Bearer token
+ * (qBittorrent), or Jellyfin's `Authorization: MediaBrowser …` header, whose client
+ * fields go with every request, a token or not.
+ */
+export type KeyScheme = 'x-api-key' | 'bearer' | 'mediabrowser';
+
+/**
+ * The client fields Jellyfin asks of every request in its MediaBrowser header: a sign-in
+ * is refused without them. One device id, so a new sign-in ends the last one's session.
+ */
+const MEDIA_BROWSER =
+  'MediaBrowser Client="Mediaplane", Device="Mediaplane", DeviceId="mediaplane", Version="1"';
+
 /** Where to connect: the container's address, and its port. */
@@ -87,3 +101,7 @@ export interface AppApiOptions {
   endpoint: Endpoint;
-  key?: { scheme: 'x-api-key' | 'bearer'; value: string };
+  /**
+   * How requests carry the key, and the key itself, once Mediaplane has one: before its
+   * first-run setup, Jellyfin has none, and is still called its own way.
+   */
+  key?: { scheme: KeyScheme; value?: string };
   /**
@@ -111,2 +129,8 @@ export interface AppApi {
   put(path: string, body: unknown): Promise<void>;
+  /**
+   * POST or DELETE with the key, and a JSON body if given; any 2xx answer is success, and
+   * its body isn't read (Jellyfin answers 204). A POST is sent again only when nothing
+   * reached the app; a DELETE, like a GET.
+   */
+  submit(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void>;
   /** POST a JSON body with the key, and the JSON answer, checked with `schema`. */
@@ -147,4 +171,21 @@ export interface AppApi {
   ): Promise<{ status: number; location: string | undefined }>;
+  /**
+   * POST `fields` as JSON, without the key, to an app's own sign-in that answers JSON
+   * (Jellyfin's): its answer, checked with `schema`, or undefined when the app refuses
+   * the sign-in (401). Like `post`, it is sent again only when nothing reached the app.
+   * `secrets` are values it sends, kept out of every message, listed or not.
+   */
+  signIn<T>(
+    path: string,
+    fields: Readonly<Record<string, string>>,
+    schema: z.ZodType<T>,
+    secrets: readonly string[],
+  ): Promise<T | undefined>;
   /** Wait, until the deadline, for `path` to answer 200 without the key. */
   ready(path: string): Promise<void>;
+  /**
+   * The same app's API, carrying `value` as its key, the way this one carries its own: a
+   * session's token, say. It keeps `value` out of its messages.
+   */
+  withKey(value: string): AppApi;
 }
@@ -152,3 +193,3 @@ export interface AppApi {
 interface Call {
-  method: 'GET' | 'PUT' | 'POST';
+  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
   path: string;
@@ -213,3 +254,3 @@ export function createAppApi(options: AppApiOptions): AppApi {
   // What the client sends is redacted whether or not the caller listed it.
-  const sent = options.key === undefined ? [] : [options.key.value];
+  const sent = options.key?.value === undefined ? [] : [options.key.value];
   const cleanAlways = redactor([...options.secrets, ...sent]);
@@ -231,8 +272,9 @@ export function createAppApi(options: AppApiOptions): AppApi {
       };
-      if (!call.anonymous && options.key !== undefined) {
-        if (options.key.scheme === 'bearer') {
-          headers.Authorization = `Bearer ${options.key.value}`;
-        } else {
-          headers['X-Api-Key'] = options.key.value;
-        }
+      const key = call.anonymous ? undefined : options.key?.value;
+      if (options.key?.scheme === 'mediabrowser') {
+        headers.Authorization =
+          key === undefined ? MEDIA_BROWSER : `${MEDIA_BROWSER}, Token="${key}"`;
+      } else if (key !== undefined) {
+        if (options.key?.scheme === 'bearer') headers.Authorization = `Bearer ${key}`;
+        else headers['X-Api-Key'] = key;
       }
@@ -469,2 +511,8 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
+    async submit(method, path, body) {
+      await send(
+        { method, path, ...(body === undefined ? {} : { body: json(body) }) },
+        method === 'DELETE',
+      );
+    },
     async post(path, body, schema) {
@@ -524,2 +572,17 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
+    async signIn(path, fields, schema, secrets) {
+      const call: Call = {
+        method: 'POST',
+        path,
+        anonymous: true,
+        secrets,
+        body: json(fields),
+      };
+      const answer = await send(
+        call,
+        false,
+        (a) => (a.status >= 200 && a.status < 300) || a.status === 401,
+      );
+      return answer.status === 401 ? undefined : parsed(call, answer, schema);
+    },
     async ready(path) {
@@ -532,2 +595,7 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
+    withKey: (value) =>
+      createAppApi({
+        ...options,
+        key: { scheme: options.key?.scheme ?? 'x-api-key', value },
+      }),
   };
```

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index 3e7b228..30c74cf 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -3,2 +3,3 @@ import type { AppSettings, StackConfig } from '../config/schema';
 import type { Diagnostic } from '../diagnostics';
+import type { AppApi, KeyScheme } from '../http/client';
 import type { Integration } from '../integrations/types';
@@ -112,3 +113,3 @@ export interface ApiSpec {
   /** Which of the app's secrets is its API key, and how a request carries it. */
-  key: { secret: string; scheme: 'x-api-key' | 'bearer' };
+  key: { secret: string; scheme: KeyScheme };
   /** A path that answers 200 only with the key: it shows the key still works. */
@@ -117,2 +118,25 @@ export interface ApiSpec {
 
+/**
+ * First-run setup that an app opens to anyone who reaches it, which Mediaplane finishes
+ * before it publishes the app's ports (spec §5 step 9, §6.4: bootstrap before publish),
+ * over the wiring network, without a key: Jellyfin's startup wizard, then the API key that
+ * only the app can make.
+ */
+export interface Bootstrap {
+  /** The secret the setup makes, which the app creates (`createdBy: 'app'`): its key. */
+  secret: string;
+  /**
+   * A file in the app's appdata folder that says the setup is done, such as Jellyfin's
+   * system.xml: until it exists and matches `pattern`, the app starts unpublished.
+   */
+  done: { path: string; pattern: RegExp };
+  /** Whether anyone who reaches the app can still claim it. Throws AppApiError. */
+  open(api: AppApi): Promise<boolean>;
+  /**
+   * Finish what is left of the setup as the shared admin, and give the secret it made, or
+   * the one the app already holds for Mediaplane. Throws AppApiError.
+   */
+  run(api: AppApi, admin: { username: string; password: string }): Promise<string>;
+}
+
 export interface ServiceExtras {
@@ -146,2 +170,4 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   integration?: Integration;
+  /** First-run setup to finish through `api` before its ports are published. */
+  bootstrap?: Bootstrap;
   /** App-specific settings under apps.<id> in stack.yaml. */
```

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index 86b4759..4baf544 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -65,3 +65,4 @@ export interface ResourceSpec {
    * What the app holds: by the id resources.json recorded (`known`), else by the exact
-   * name Mediaplane gives it (spec §6.3). Undefined when it holds none.
+   * name Mediaplane gives it (spec §6.3), which `desired` holds where it comes from the
+   * stack (Jellyfin's admin is the shared admin's user name). Undefined when it holds none.
    */
@@ -70,2 +71,3 @@ export interface ResourceSpec {
     known: KnownResource | undefined,
+    desired?: DesiredResource,
   ): Promise<ObservedResource | undefined>;
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 673d648..f52d87b 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -189,3 +189,4 @@ export async function reachApps(
         },
-        ...(key === undefined ? {} : { key: { scheme: spec.key.scheme, value: key } }),
+        // Without a key, as Jellyfin is before its first-run setup, still its own way.
+        key: { scheme: spec.key.scheme, ...(key === undefined ? {} : { value: key }) },
         secrets: options.secrets,
@@ -274,3 +275,3 @@ export async function examine(
   if (desired === undefined) return undefined;
-  const observed = await spec.observe(api, known);
+  const observed = await spec.observe(api, known, desired);
   if (observed === undefined) {
```

**Change** `packages/engine/src/runtime/types.ts`:

```diff
diff --git a/packages/engine/src/runtime/types.ts b/packages/engine/src/runtime/types.ts
index 382f1b6..d60b51a 100644
--- a/packages/engine/src/runtime/types.ts
+++ b/packages/engine/src/runtime/types.ts
@@ -92,4 +92,13 @@ export interface Runtime {
   pull(values: Record<string, string>): Promise<CommandResult>;
-  /** `up --detach --wait --remove-orphans` on the written project. */
-  up(waitSeconds: number, values: Record<string, string>): Promise<CommandResult>;
+  /**
+   * `up --detach --wait --remove-orphans` on the written project, with the services
+   * `unpublished` started without any published port, the override's too (bootstrap
+   * before publish, spec §6.4): Compose gets one more file, on its standard input, that
+   * resets their `ports`. An `up` without them recreates them with their ports.
+   */
+  up(
+    waitSeconds: number,
+    values: Record<string, string>,
+    unpublished?: readonly string[],
+  ): Promise<CommandResult>;
   /**
```

**Change** `packages/engine/src/runtime/docker.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.ts b/packages/engine/src/runtime/docker.ts
index d25a5a2..f9eb426 100644
--- a/packages/engine/src/runtime/docker.ts
+++ b/packages/engine/src/runtime/docker.ts
@@ -366,3 +366,4 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
 
-    async up(waitSeconds, values) {
+    async up(waitSeconds, values, unpublished = []) {
+      const reset = unpublishedPorts(unpublished);
       const result = await docker(
@@ -371,2 +372,4 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
           ...(await projectArgs()),
+          // Read after the user's override: its ports for these services go too.
+          ...(reset === undefined ? [] : ['-f', '-']),
           'up',
@@ -379,3 +382,6 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
         ],
-        { timeoutMs: (waitSeconds + 120) * 1000 },
+        {
+          timeoutMs: (waitSeconds + 120) * 1000,
+          ...(reset === undefined ? {} : { input: reset }),
+        },
       );
@@ -638,2 +644,17 @@ function serviceName(service: string): string {
 
+/**
+ * A Compose file that takes every published port off `services`, or undefined for none:
+ * `!reset` (Compose 2.24 and later, the floor preflight checks) empties what the files
+ * before it set.
+ */
+function unpublishedPorts(services: readonly string[]): string | undefined {
+  if (services.length === 0) return undefined;
+  const names = services.map((service) => serviceName(service));
+  return [
+    'services:',
+    ...names.map((name) => `  ${name}:\n    ports: !reset []`),
+    '',
+  ].join('\n');
+}
+
 /**
```

**Change** `packages/engine/src/testing/fakes.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.ts b/packages/engine/src/testing/fakes.ts
index edc4600..c07cfa9 100644
--- a/packages/engine/src/testing/fakes.ts
+++ b/packages/engine/src/testing/fakes.ts
@@ -152,4 +152,4 @@ export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
     },
-    up: () => {
-      record('up');
+    up: (_seconds, _values, unpublished = []) => {
+      record(unpublished.length === 0 ? 'up' : `up unpublished ${unpublished.join(' ')}`);
       return Promise.resolve(options.up ?? { ok: true });
@@ -219,4 +219,5 @@ export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
  * compose.yaml and .env. Like Compose, it hashes a guest (`network_mode: service:<host>`)
- * as `container:<host's id>`, and inspect says it is in its host's network. A vpn-check
- * probe in qBittorrent's network finds a healthy tunnel, unless `run` says otherwise.
+ * as `container:<host's id>`, and inspect says it is in its host's network, and it hashes
+ * a service `up` starts unpublished without its ports. A vpn-check probe in qBittorrent's
+ * network finds a healthy tunnel, unless `run` says otherwise.
  */
@@ -253,4 +254,4 @@ export function fakeDocker(
       }),
-    up: async (waitSeconds, values) => {
-      const result = await base.up(waitSeconds, values);
+    up: async (waitSeconds, values, unpublished = []) => {
+      const result = await base.up(waitSeconds, values, unpublished);
       if (!result.ok || options.upChangesNothing === true) return result;
@@ -259,2 +260,4 @@ export function fakeDocker(
       };
+      // As `ports: !reset []` leaves them: with no ports at all.
+      for (const service of unpublished) delete compose.services[service]?.ports;
       for (const config of Object.values(compose.services)) {
```

**Create** `packages/engine/src/plan/bootstrap.ts`:

```ts
import { join } from 'node:path';
import type { ResolvedStack } from '../resolver/resolve';
import type { SecretStore } from '../secrets/store';
import { readIfExists } from '../util/fs';

/** An app whose first-run setup apply will finish (spec §5 step 9, §6.4). */
export interface BootstrapChange {
  /** The app, such as "jellyfin". */
  app: string;
  /**
   * Whether it starts with no published ports first: its setup is open to anyone who
   * reaches it, or Mediaplane can't tell. Otherwise apply only signs in to make its key.
   */
  unpublished: boolean;
}

/**
 * Each app with a first-run setup (`bootstrap`) that apply will finish: one whose key the
 * store doesn't hold, or whose appdata doesn't say the setup is done (a Jellyfin whose
 * appdata was emptied starts its wizard again). It starts unpublished unless its appdata
 * says the setup is done, when nobody can claim it any more. A file Mediaplane can't read
 * says nothing, so the stored key decides. Reads only; writes nothing.
 */
export async function planBootstrap(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<BootstrapChange[]> {
  const changes: BootstrapChange[] = [];
  for (const app of stack.apps) {
    const setup = app.def.bootstrap;
    if (setup === undefined) continue;
    const stored = store.apps[app.def.id]?.[setup.secret] !== undefined;
    const done = await setupDone(
      join(stack.home, 'appdata', app.def.id, setup.done.path),
      setup.done.pattern,
    );
    if (stored && done !== false) continue;
    changes.push({ app: app.def.id, unpublished: done !== true });
  }
  return changes;
}

/** Whether the file at `path` says the setup is done; undefined when it can't be read. */
async function setupDone(path: string, pattern: RegExp): Promise<boolean | undefined> {
  try {
    const text = await readIfExists(path);
    return text !== undefined && pattern.test(text);
  } catch {
    return undefined;
  }
}
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index e768a2b..106f223 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -37,2 +37,3 @@ import { secretsToGenerate, secretValues } from '../secrets/values';
 import { planAppdata } from './appdata';
+import { planBootstrap, type BootstrapChange } from './bootstrap';
 import { notYetHealthy, otherHomes, ownPorts, type ContainerChange } from './containers';
@@ -74,2 +75,4 @@ export interface PlanResult {
   wiring: WiringChange[];
+  /** The apps whose first-run setup apply would finish before publishing them. */
+  bootstrap: BootstrapChange[];
   diagnostics: Diagnostic[];
@@ -187,2 +190,11 @@ export async function planStack(
   let containers = predicted.changes;
+  // An app whose setup is open starts again without its ports, whatever it runs now: up
+  // recreates it, and again once it is set up.
+  const bootstrap = await planBootstrap(stack, store);
+  const unpublished = new Set(bootstrap.filter((b) => b.unpublished).map((b) => b.app));
+  containers = containers.map((change) =>
+    unpublished.has(change.service) && change.action !== 'create'
+      ? { ...change, action: 'recreate' }
+      : change,
+  );
   try {
@@ -213,5 +225,7 @@ export async function planStack(
     const admin = await adminLogin(stack.config, home, preview, options.env);
-    const changing = new Set(
-      containers.filter((c) => c.action !== 'unchanged').map((c) => c.service),
-    );
+    // An app to set up is asked once it is: without its key, it can't be asked now.
+    const changing = new Set([
+      ...containers.filter((c) => c.action !== 'unchanged').map((c) => c.service),
+      ...bootstrap.map((b) => b.app),
+    ]);
     // The join is plan's one change to Docker, and only an app that is settled is asked:
@@ -255,3 +269,4 @@ export async function planStack(
         unhealthy.length > 0 ||
-        wiring.some((change) => change.action !== 'unchanged'),
+        wiring.some((change) => change.action !== 'unchanged') ||
+        bootstrap.length > 0,
       files,
@@ -261,2 +276,3 @@ export async function planStack(
       wiring,
+      bootstrap,
       diagnostics,
@@ -277,2 +293,3 @@ function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undef
       wiring: [],
+      bootstrap: [],
       diagnostics,
```

**Change** `packages/engine/src/history/records.ts`:

```diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index b820482..9292b02 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -16,3 +16,13 @@ const RECORD_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
 const actionSchema = z.strictObject({
-  step: z.enum(['keys', 'files', 'pull', 'ownership', 'start', 'wire', 'verify']),
+  /** `bootstrap` was added in Slice 5. */
+  step: z.enum([
+    'keys',
+    'files',
+    'pull',
+    'ownership',
+    'start',
+    'bootstrap',
+    'wire',
+    'verify',
+  ]),
   /** The wire step's actions name the resource ("sonarr.admin"). Added in Slice 3b. */
@@ -66,2 +76,6 @@ export const changeRecordSchema = z.strictObject({
       .optional(),
+    /** The apps whose first-run setup the plan said apply would finish. Added in Slice 5. */
+    bootstrap: z
+      .array(z.strictObject({ app: z.string(), unpublished: z.boolean() }))
+      .optional(),
   }),
```

**Create** `packages/engine/src/apply/bootstrap.ts`:

```ts
import { AppApiError, APP_DEADLINE_MS } from '../http/client';
import {
  joinFailure,
  knownSecrets,
  notOnNetwork,
  reachApps,
  redactionValues,
  WIRING_RUNBOOK,
  type ReachedApp,
  type WiringSeams,
} from '../integrations/wiring';
import type { BootstrapChange } from '../plan/bootstrap';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import { writeSecretStore, type SecretStore } from '../secrets/store';
import { redact } from '../util/redact';

export interface BootstrapOptions {
  home: string;
  stack: ResolvedStack;
  store: SecretStore;
  /** The secret values of .env: kept out of every message. */
  values: Readonly<Record<string, string>>;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  /** What apply's own plan said to set up. */
  pending: readonly BootstrapChange[];
  /**
   * Start the stack again with `unpublished` still without their published ports, and the
   * other apps the plan started unpublished with theirs. Throws when that fails.
   */
  publish: (unpublished: readonly string[]) => Promise<void>;
  seams?: WiringSeams;
}

/** The first-run setup failed: what it said, and what to do. It keeps no cause. */
export class BootstrapFailed extends Error {
  override readonly name = 'BootstrapFailed';
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

const HINT = `fix what the error says, then run apply again: an app whose setup is still open keeps its ports unpublished until then. See ${WIRING_RUNBOOK}`;

const LEAVE_HINT = `Mediaplane steps off the stack's wiring network before Compose publishes the apps, and couldn't, so nothing was published; fix what the error says, then run apply again. See ${WIRING_RUNBOOK}`;

/** `store`, with the secret `name` of `app` set to `value`. */
function withSecret(
  store: SecretStore,
  app: string,
  name: string,
  value: string,
): SecretStore {
  return {
    ...store,
    apps: { ...store.apps, [app]: { ...store.apps[app], [name]: value } },
  };
}

/**
 * Apply's bootstrap step (spec §5 step 9, §6.4): for each app the plan names, reach it over
 * the wiring network, without a key, and finish its first-run setup as the shared admin.
 * The key it makes goes into state/secrets.json at once (spec §5 step 4). Then the stack
 * starts again, publishing every app the plan started unpublished, but one whose setup
 * is still open: nobody else ever reaches an open setup. Returns the store with the new
 * keys and what it did; throws BootstrapFailed when a setup failed, once it has published
 * what it can.
 */
export async function bootstrapApps(
  options: BootstrapOptions,
): Promise<{ store: SecretStore; detail: string }> {
  const { stack, runtime } = options;
  const apps = options.pending.flatMap((change) => {
    const app = stack.apps.find((a) => a.def.id === change.app);
    return app?.def.bootstrap === undefined ? [] : [app];
  });
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const secrets = knownSecrets(options.values, options.store, admin);
  let reached: Map<string, ReachedApp>;
  try {
    if ((await runtime.joinWiring()) === 'no-network') {
      throw new BootstrapFailed(
        'the stack has no wiring network, though apply has just started it',
        HINT,
      );
    }
    reached = await reachApps(apps, {
      runtime,
      current: await runtime.containers(),
      keys: {},
      secrets,
      deadlineMs: APP_DEADLINE_MS,
      ...(options.seams === undefined ? {} : { seams: options.seams }),
    });
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    const failure = joinFailure(cause, options.env);
    throw new BootstrapFailed(failure.message, failure.hint ?? HINT);
  }
  let store = options.store;
  const done: string[] = [];
  const failed: string[] = [];
  const stillOpen: string[] = [];
  for (const app of apps) {
    const result = await setUp(app, reached.get(app.def.id), admin);
    if (result.key !== undefined) {
      const secret = app.def.bootstrap?.secret ?? '';
      store = withSecret(store, app.def.id, secret, result.key);
      // At once: a key the app made, and Mediaplane lost, would need making again.
      await writeSecretStore(options.home, store);
      done.push(`${app.def.id}.${secret}`);
      continue;
    }
    failed.push(redact(result.failure, redactionValues(secrets)));
    if (result.open) stillOpen.push(app.def.id);
  }
  const unpublished = options.pending.filter((p) => p.unpublished).map((p) => p.app);
  if (unpublished.length > 0) {
    // Compose can't recreate the wiring network while another project's container is on
    // it, so Mediaplane steps off before up, as the start step does, and back on in the
    // wire step (ADR 0011).
    try {
      await runtime.leaveWiring();
    } catch (cause) {
      if (!(cause instanceof RuntimeError)) throw cause;
      throw new BootstrapFailed(cause.message, LEAVE_HINT);
    }
    await options.publish(stillOpen);
  }
  if (failed.length > 0) {
    throw new BootstrapFailed(`the first-run setup failed: ${failed.join('; ')}`, HINT);
  }
  const published = unpublished.filter((app) => !stillOpen.includes(app));
  return {
    store,
    detail: [
      `set up ${apps.map((a) => a.def.id).join(', ')} and saved ${done.join(', ')}`,
      ...(published.length === 0 ? [] : [`published ${published.join(', ')}`]),
    ].join('; '),
  };
}

/**
 * Finish `app`'s setup: its new key, or why not and whether the setup is still open (then
 * it stays unpublished). One Mediaplane can't ask counts as open.
 */
async function setUp(
  app: ResolvedApp,
  client: ReachedApp | undefined,
  admin: { username: string; password: string },
): Promise<{ key: string } | { key?: undefined; failure: string; open: boolean }> {
  const { bootstrap, api } = app.def;
  if (client === undefined || bootstrap === undefined || api === undefined) {
    return { failure: notOnNetwork(app), open: true };
  }
  try {
    await client.api.ready(api.ready);
    return { key: await bootstrap.run(client.api, admin) };
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    const open = await bootstrap.open(client.api).catch((also: unknown) => {
      if (also instanceof AppApiError) return true;
      throw also;
    });
    return { failure: cause.message, open };
  }
}
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 86cb30c..84ff650 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -35,2 +35,3 @@ import { compare } from '../util/sort';
 import { vpnCheck, VPN_RUNBOOK } from '../vpn/check';
+import { bootstrapApps, BootstrapFailed } from './bootstrap';
 import {
@@ -90,2 +91,3 @@ const STEP_HINTS: Record<ApplyStep, string> = {
   start: `run "mediaplane status" to see each app, fix the cause, then run apply again; see ${runbookUrl('app-wont-start')}`,
+  bootstrap: `fix what the error says, then run apply again; see ${runbookUrl('wiring-failed')}`,
   wire: `fix what the error says, then run apply again; see ${runbookUrl('wiring-failed')}`,
@@ -144,2 +146,8 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   let values: Record<string, string> = {};
+  /** `up`, with `unpublished` started without their ports; a failure names the apps. */
+  const up = async (unpublished: readonly string[]) => {
+    const wait = options.waitSeconds ?? DEFAULT_WAIT_SECONDS;
+    const result = await runtime.up(wait, values, unpublished);
+    if (!result.ok) throw new Error(await startFailure(runtime, result.error));
+  };
 
@@ -200,8 +208,31 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     if (restart.length > 0) succeeded(await runtime.stop(restart, values));
-    const result = await runtime.up(options.waitSeconds ?? DEFAULT_WAIT_SECONDS, values);
-    if (!result.ok) throw new Error(await startFailure(runtime, result.error));
-    return restart.length === 0
-      ? 'every app is running and healthy'
-      : `every app is running and healthy; restarted ${restart.join(', ')}`;
+    // An app whose first-run setup is open to anyone starts with no published port: the
+    // bootstrap step publishes it once it is set up (spec §6.4).
+    const unpublished = shown.bootstrap.filter((b) => b.unpublished).map((b) => b.app);
+    await up(unpublished);
+    return [
+      'every app is running and healthy',
+      ...(restart.length === 0 ? [] : [`restarted ${restart.join(', ')}`]),
+      ...(unpublished.length === 0
+        ? []
+        : [`started ${unpublished.join(', ')} without its ports, to set it up first`]),
+    ].join('; ');
   });
+  if (shown.bootstrap.length > 0) {
+    await steps.run('bootstrap', async () => {
+      const set = await bootstrapApps({
+        home,
+        stack,
+        store,
+        values,
+        env: options.env,
+        runtime,
+        pending: shown.bootstrap,
+        publish: up,
+        ...(options.wiring === undefined ? {} : { seams: options.wiring }),
+      });
+      store = set.store;
+      return set.detail;
+    });
+  }
   await steps.run('wire', async () => {
@@ -301,2 +332,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
       wiring: shown.wiring,
+      bootstrap: shown.bootstrap,
     },
@@ -396,3 +428,4 @@ function ownHint(cause: unknown): string | undefined {
     cause instanceof LeaveFailed ||
-    cause instanceof StepError
+    cause instanceof StepError ||
+    cause instanceof BootstrapFailed
   ) {
@@ -513,2 +546,3 @@ function emptyPlan(): PlanResult {
     wiring: [],
+    bootstrap: [],
     diagnostics: [],
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 19a5b71..30c336d 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -22,2 +22,3 @@ export * from './render/prestart';
 export * from './render/yaml';
+export * from './plan/bootstrap';
 export * from './plan/files';
@@ -41,2 +42,3 @@ export * from './preflight/checks';
 export * from './history/records';
+export * from './apply/bootstrap';
 export * from './apply/ownership';
```

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 61bd96c..812734b 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -115,2 +115,11 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
   if (unhealthy.length > 0) io.stdout(`Not healthy yet: ${unhealthy.join(', ')}\n`);
+  if (result.bootstrap.length > 0) {
+    io.stdout('First-run setup:\n');
+    for (const { app, unpublished } of result.bootstrap) {
+      const how = unpublished
+        ? 'with no port published until it is done'
+        : 'signing in as the admin, to make its key';
+      io.stdout(`  + ${app} (${how})\n`);
+    }
+  }
   const wiring = result.wiring.filter((change) => change.action !== 'unchanged');
@@ -129,2 +138,3 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     count(unhealthy.length, 'app', 'to wait for'),
+    count(result.bootstrap.length, 'app', 'to set up'),
     count(tally('create', 'update', 'adopt'), 'resource', 'to wire'),
@@ -146,2 +156,3 @@ const STEP_LABELS: Record<ApplyStep, string> = {
   start: 'containers',
+  bootstrap: 'first-run setup',
   wire: 'wiring',
@@ -153,2 +164,3 @@ const SLOW_STEPS: Partial<Record<ApplyStep, string>> = {
   start: 'Starting containers and waiting until every app is healthy…',
+  bootstrap: 'Finishing first-run setup before publishing the web UIs…',
   wire: 'Wiring the apps…',
@@ -220,3 +232,3 @@ export function printApply(
   if (options.json) {
-    const { files, containers, secrets, unhealthy, wiring } = result.plan;
+    const { files, containers, secrets, unhealthy, wiring, bootstrap } = result.plan;
     io.stdout(
@@ -234,2 +246,3 @@ export function printApply(
             wiring,
+            bootstrap,
           },
```

- [ ] **Step 4: Run them to see them pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src packages/cli/src/output.ts packages/cli/src/output.test.ts
git commit -m "feat(engine): finish an app's first-run setup before its ports are published" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1548 tests pass in 77 files.

---

### Task 3: Jellyfin: set up before its port is published, with its admin and libraries

Jellyfin gets its API, its setup, its health check and its three resources. With it,
every real-catalog stack sets Jellyfin up: the CLI tests' stack has Jellyfin, so their
expectations follow.

Decision: Jellyfin's setup asks for the first user, names it, signs in, and only then
completes the wizard; its key is the newest named `Mediaplane`, else a new one, read
back; then it signs out (decision 5).
Decision: its API is `ready: /System/Info/Public`, `check: /System/Info`, in its
MediaBrowser header; its health check waits for `Healthy` (decisions 6, 7).
Decision: `jellyfin.admin`, known by id else by the shared admin's name, checked by
signing in and out, renamed and given its password with the key, never made; `login` is
`'shared'` (decision 8).
Decision: `Movies` and `Shows`, known by name, their folders made first, made only when
none has the name, with the web UI's options for a new library; `collectionType` can't
change (decision 9).

**Files:**
- Create: `catalog/jellyfin/bootstrap.ts`, `catalog/jellyfin/integration.ts`
- Modify: `catalog/jellyfin/app.ts`, `scripts/docs/catalog-facts.ts`
- Test: `catalog/jellyfin/integration.test.ts` (new), `catalog/catalog.test.ts`,
  `catalog/render.test.ts`, `catalog/prowlarr/integration.test.ts`,
  `scripts/docs/catalog-facts.test.ts`, `packages/cli/src/credentials.test.ts`,
  `packages/cli/src/run.test.ts`
- Generated: the facts in `catalog/jellyfin/README.md`

**Interfaces:**
- **Consumes:** Task 1's fake Jellyfin; Task 2's `Bootstrap`, the `mediabrowser` scheme,
  `submit`, `signIn`, `withKey`, and `observe`'s `desired`; S3c's `ResourceSpec`
  contract.
- **Produces:**
  - `catalog/jellyfin/bootstrap.ts`: `jellyfinBootstrap: Bootstrap`, `KEY_NAME`
    (`'Mediaplane'`), `signIn(api, login): Promise<string | undefined>`;
  - `catalog/jellyfin/integration.ts`: `LIBRARIES`, and the integration with the resources
    `admin`, `library_movies` and `library_shows`, after nothing.

- [ ] **Step 1: Write the failing tests**

**Create** `catalog/jellyfin/integration.test.ts`:

```ts
import {
  AppApiError,
  createAppApi,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  FAKE_JELLYFIN_USER_ID,
  fakeStackApis,
  freshAppState,
  wiringStack,
  type FakeAppState,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { jellyfinBootstrap, KEY_NAME } from './bootstrap';
import integration, { LIBRARIES } from './integration';

const PASSWORD = 'fake-admin-password';
const ADMIN = { username: 'admin', password: PASSWORD };
const KEY = '7'.repeat(32);

/** Jellyfin, faked as fakeStackApis fakes it, and a client: keyed with KEY, or not. */
async function jellyfin(state: FakeAppState = freshAppState(), keyed = false) {
  const apis = await fakeStackApis();
  apis.apps.set('jellyfin', state);
  const api = createAppApi({
    name: 'Jellyfin',
    service: 'jellyfin',
    port: 8096,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'mediabrowser', ...(keyed ? { value: KEY } : {}) },
    secrets: [PASSWORD, KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, apis, state, app: apis.app };
}

/** A Jellyfin set up by Mediaplane: its wizard done, its admin, and KEY. */
function setUp(more: Partial<FakeAppState> = {}): FakeAppState {
  return {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: PASSWORD,
    apiKeys: [
      { AccessToken: KEY, AppName: KEY_NAME, DateCreated: '2026-10-15T12:00:00.000Z' },
    ],
    ...more,
  };
}

/** What `api` failed with, as an AppApiError. */
async function failure(call: Promise<unknown>): Promise<AppApiError> {
  const thrown = await call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(thrown instanceof AppApiError)) throw new Error(`expected an AppApiError`);
  return thrown;
}

/** Each call `app` received, as "METHOD /path". */
function calls(app: { requests: { method: string; path: string }[] }): string[] {
  return app.requests.map((r) => `${r.method} ${r.path.split('?')[0] ?? ''}`);
}

function resource(name: string): ResourceSpec {
  const spec = integration.resources.find((r) => r.name === name);
  if (spec === undefined) throw new Error(`Jellyfin has no resource ${name}`);
  return spec;
}

function contextOf(): WiringContext {
  const stack = wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`,
  );
  const app = stack.apps.find((a) => a.def.id === 'jellyfin');
  if (app === undefined) throw new Error('no Jellyfin in the stack');
  return { stack, app, admin: ADMIN, keys: {} };
}

function wanted(spec: ResourceSpec) {
  const desired = spec.desired(contextOf());
  if (desired === undefined) throw new Error(`${spec.name} is wanted`);
  return desired;
}

describe("Jellyfin's first-run setup", () => {
  it('runs its startup wizard as the shared admin, makes its key, reads it back, and signs out', async () => {
    const { api, state, app } = await jellyfin();
    expect(await jellyfinBootstrap.open(api)).toBe(true);
    const key = await jellyfinBootstrap.run(api, ADMIN);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(state).toMatchObject({ wizard: 'done', user: 'admin', password: PASSWORD });
    expect(state.apiKeys.map((k) => [k.AccessToken, k.AppName])).toEqual([
      [key, 'Mediaplane'],
    ]);
    expect(state.sessions).toEqual({});
    expect(await jellyfinBootstrap.open(api)).toBe(false);
    // Signed in before it completes the wizard: a first user it can't sign in as isn't
    // Mediaplane's.
    expect(calls(app)).toEqual([
      'GET /System/Info/Public',
      'GET /System/Info/Public',
      'GET /Startup/User',
      'POST /Startup/User',
      'POST /Users/AuthenticateByName',
      'POST /Startup/Complete',
      'GET /Auth/Keys',
      'POST /Auth/Keys',
      'GET /Auth/Keys',
      'POST /Sessions/Logout',
      'GET /System/Info/Public',
    ]);
  });

  it('keeps the key it made before rather than make another', async () => {
    const { api, state, app } = await jellyfin(setUp());
    expect(await jellyfinBootstrap.run(api, ADMIN)).toBe(KEY);
    expect(state.apiKeys).toHaveLength(1);
    expect(calls(app)).not.toContain('POST /Auth/Keys');
  });

  it('finishes a setup that stopped once the first user had its password', async () => {
    const { api, state } = await jellyfin({
      ...freshAppState(),
      wizard: 'open',
      user: 'admin',
      password: PASSWORD,
    });
    expect(await jellyfinBootstrap.run(api, ADMIN)).toMatch(/^[0-9a-f]{32}$/);
    expect(state.wizard).toBe('done');
  });

  it('leaves the wizard open, and says so, when its first user is not the shared admin', async () => {
    const { api, state, app } = await jellyfin({
      ...freshAppState(),
      wizard: 'open',
      user: 'abc',
      password: 'fake-someone-else',
    });
    const refused = await failure(jellyfinBootstrap.run(api, ADMIN));
    expect(refused.message).toBe(
      "Jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in: its startup wizard has a first user that Mediaplane did not set, so Mediaplane left the wizard open (POST /Users/AuthenticateByName)",
    );
    expect(state.wizard).toBe('open');
    expect(calls(app)).not.toContain('POST /Startup/Complete');
  });

  it('says when its wizard was finished with another login', async () => {
    const { api } = await jellyfin(setUp({ password: 'fake-someone-else' }));
    expect((await failure(jellyfinBootstrap.run(api, ADMIN))).message).toContain(
      "refused the shared admin's sign-in: its startup wizard was finished with another login",
    );
  });

  it('is done once system.xml says its wizard is', () => {
    const { done } = jellyfinBootstrap;
    expect(done.path).toBe('system.xml');
    expect(
      done.pattern.test('  <IsStartupWizardCompleted>true</IsStartupWizardCompleted>'),
    ).toBe(true);
    expect(
      done.pattern.test('<IsStartupWizardCompleted>false</IsStartupWizardCompleted>'),
    ).toBe(false);
  });
});

describe("Jellyfin's integration", () => {
  it('has the shared admin, then the Movies and Shows libraries, after nothing', () => {
    expect(integration.after).toEqual([]);
    expect(
      integration.resources.map((r) => [r.name, r.fields, r.secrets, r.requires]),
    ).toEqual([
      ['admin', ['username'], ['password'], undefined],
      ['library_movies', ['name', 'collectionType', 'paths'], [], undefined],
      ['library_shows', ['name', 'collectionType', 'paths'], [], undefined],
    ]);
  });
});

describe("Jellyfin's admin", () => {
  const admin = resource('admin');

  it('is the user named as the shared admin, then the one of the id it was found by', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    const desired = wanted(admin);
    const found = await admin.observe(api, undefined, desired);
    expect(found).toEqual({
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'admin' },
    });
    state.user = 'renamed';
    expect(await admin.observe(api, undefined, desired)).toBeUndefined();
    const known = {
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'admin' },
      secrets: ['password'],
      appliedAt: '2026-10-15T12:00:00.000Z',
    };
    expect(await admin.observe(api, known, desired)).toMatchObject({
      fields: { username: 'renamed' },
    });
  });

  it('checks its password by signing in, then out', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    const desired = wanted(admin);
    const held = await admin.observe(api, undefined, desired);
    if (held === undefined) throw new Error('the admin is there');
    expect(await admin.verify?.(api, desired, held)).toBe(true);
    expect(state.sessions).toEqual({});
    state.password = 'fake-changed-by-hand';
    expect(await admin.verify?.(api, desired, held)).toBe(false);
  });

  it('renames it and sets its password with the key, and makes no other user', async () => {
    const { api, state } = await jellyfin(
      setUp({ user: 'renamed', password: 'x' }),
      true,
    );
    const desired = wanted(admin);
    const held = {
      id: FAKE_JELLYFIN_USER_ID,
      name: 'admin',
      fields: { username: 'renamed' },
    };
    await admin.update(api, desired, held);
    expect(state).toMatchObject({ user: 'admin', password: PASSWORD });
    expect((await failure(admin.create(api, desired))).message).toBe(
      "Jellyfin at http://jellyfin:8096 (127.0.0.1) has no user admin: Mediaplane makes Jellyfin's admin in its startup wizard, and no other user (GET /Users)",
    );
  });
});

describe("Jellyfin's libraries", () => {
  const movies = resource('library_movies');
  const shows = resource('library_shows');

  it('are Movies and Shows, in their folders under /data/media, which are made first', () => {
    expect(wanted(movies)).toEqual({
      name: 'Movies',
      fields: { name: 'Movies', collectionType: 'movies', paths: '/data/media/movies' },
      secrets: {},
      folders: ['/data/media/movies'],
    });
    expect(wanted(shows).fields).toEqual({
      name: 'Shows',
      collectionType: 'tvshows',
      paths: '/data/media/tv',
    });
    expect(LIBRARIES.map((l) => l.name)).toEqual(['Movies', 'Shows']);
  });

  it("makes one as Jellyfin's web UI makes a new library, with its default downloaders, and finds it by name", async () => {
    const { api, apis, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/movies');
    expect(await movies.observe(api, undefined)).toBeUndefined();
    expect(await movies.create(api, wanted(movies))).toEqual({ id: 'Movies' });
    const [made] = state.libraries;
    expect(made).toMatchObject({
      Name: 'Movies',
      CollectionType: 'movies',
      Locations: ['/data/media/movies'],
      LibraryOptions: {
        Enabled: true,
        EnableInternetProviders: true,
        EnableRealtimeMonitor: true,
        TypeOptions: [
          {
            Type: 'Movie',
            MetadataFetchers: ['TheMovieDb'],
            MetadataFetcherOrder: ['TheMovieDb', 'The Open Movie Database'],
            ImageFetchers: ['TheMovieDb', 'Screen Grabber'],
          },
        ],
      },
    });
    expect(await movies.observe(api, undefined)).toEqual({
      id: 'Movies',
      name: 'Movies',
      fields: { name: 'Movies', collectionType: 'movies', paths: '/data/media/movies' },
    });
    expect(apis.app.requests.at(-2)?.path).toBe(
      '/Library/VirtualFolders?name=Movies&collectionType=movies&paths=%2Fdata%2Fmedia%2Fmovies&refreshLibrary=true',
    );
  });

  it('puts back its folder, and takes out one added by hand, each once', async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.folders.push('/data/media/tv', '/data/media/other');
    state.libraries.push({
      Name: 'Shows',
      CollectionType: 'tvshows',
      Locations: ['/data/media/other', '/data/media/other'],
      LibraryOptions: {},
    });
    const held = await shows.observe(api, undefined);
    expect(held?.fields.paths).toBe('/data/media/other');
    if (held === undefined) throw new Error('Shows is there');
    await shows.update(api, wanted(shows), held);
    expect(state.libraries[0]?.Locations).toEqual([
      '/data/media/other',
      '/data/media/tv',
    ]);
    // Jellyfin keeps a path given twice twice, and takes one out at a time.
    const again = await shows.observe(api, undefined);
    if (again === undefined) throw new Error('Shows is there');
    await shows.update(api, wanted(shows), again);
    expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv']);
  });

  it("says Jellyfin can't change what a library of that name holds", async () => {
    const { api, state } = await jellyfin(setUp(), true);
    state.libraries.push({
      Name: 'Shows',
      Locations: ['/data/media/tv'],
      LibraryOptions: {},
    });
    const held = await shows.observe(api, undefined);
    if (held === undefined) throw new Error('Shows is there');
    expect(held.fields.collectionType).toBe('');
    expect((await failure(shows.update(api, wanted(shows), held))).message).toBe(
      "Jellyfin at http://jellyfin:8096 (127.0.0.1) has a library named Shows that holds mixed content, not tvshows, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes Shows (GET /Library/VirtualFolders)",
    );
  });
});
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 7d1ab5d..14cbd17 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -35,2 +35,3 @@ describe('catalog', () => {
     expect(catalog.filter((app) => app.api !== undefined).map((app) => app.id)).toEqual([
+      'jellyfin',
       'prowlarr',
@@ -51,3 +52,25 @@ describe('catalog', () => {
       expect(api.ready).toMatch(/^\//);
-      expect(api.check).toMatch(/^\/api\//);
+      expect(api.check).toMatch(/^\//);
+      // The check needs the key; the ready path mustn't.
+      expect(api.check).not.toBe(api.ready);
+    });
+  });
+
+  it('gives a first-run setup only to an app whose key it makes, and that its API carries', () => {
+    const set = catalog.filter((app) => app.bootstrap !== undefined);
+    expect(set.map((app) => app.id)).toEqual(['jellyfin']);
+    for (const app of set) {
+      const secret = app.bootstrap?.secret ?? '';
+      expect(app.secrets[secret]).toEqual({ createdBy: 'app' });
+      expect(app.api?.key.secret).toBe(secret);
+      expect(app.bootstrap?.done.path).not.toMatch(/^\/|\.\./);
+    }
+  });
+
+  it("waits for Jellyfin's server itself: its /health says 200 Degraded at every start", () => {
+    // In its first seconds the server answers 503 to everything else (probed on 12.2).
+    const jellyfin = catalog.find((app) => app.id === 'jellyfin');
+    expect(jellyfin?.health).toEqual({
+      test: ['CMD-SHELL', 'curl -fsS http://localhost:8096/health | grep -qx Healthy'],
+      startPeriod: '120s',
     });
@@ -73,3 +96,3 @@ describe('catalog', () => {
       ),
-    ).toEqual({ jellyfin: 'Slice 5', plex: 'Slice 7', seerr: 'Slice 6' });
+    ).toEqual({ plex: 'Slice 7', seerr: 'Slice 6' });
   });
@@ -90,3 +113,3 @@ describe('catalog', () => {
       catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
-    ).toEqual(['prowlarr', 'qbittorrent', 'radarr', 'sonarr']);
+    ).toEqual(['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']);
   });
```

**Change** `catalog/render.test.ts`:

```diff
diff --git a/catalog/render.test.ts b/catalog/render.test.ts
index 2fddec4..35d3eb6 100644
--- a/catalog/render.test.ts
+++ b/catalog/render.test.ts
@@ -171,2 +171,3 @@ describe('the real catalog', () => {
       'gluetun default,wiring',
+      'jellyfin default,wiring',
       'prowlarr default,wiring',
```

**Change** `catalog/prowlarr/integration.test.ts`:

```diff
diff --git a/catalog/prowlarr/integration.test.ts b/catalog/prowlarr/integration.test.ts
index d2aaf1f..9a7cb9a 100644
--- a/catalog/prowlarr/integration.test.ts
+++ b/catalog/prowlarr/integration.test.ts
@@ -253,13 +253,8 @@ apps:
         stack: stack(),
-        current: [
-          'byparr',
-          'jellyfin',
-          'prowlarr',
-          'qbittorrent',
-          'radarr',
-          'sonarr',
-        ].map((service) =>
-          fakeContainer(service, `fake-${service}`, {
-            ...(service === 'sonarr' ? { state: sonarr } : {}),
-          }),
+        // Jellyfin isn't running yet: it is checked after the start.
+        current: ['byparr', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr'].map(
+          (service) =>
+            fakeContainer(service, `fake-${service}`, {
+              ...(service === 'sonarr' ? { state: sonarr } : {}),
+            }),
         ),
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 53919eb..3504bfa 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -55,2 +55,5 @@ describe('renderFacts', () => {
     expect(renderFacts(app('jellyfin'))).toContain(
+      "with `apiKey` in Jellyfin's `Authorization: MediaBrowser` header\n",
+    );
+    expect(renderFacts(app('plex'))).toContain(
       '- **API:** none over the wiring network\n',
@@ -69,5 +72,3 @@ describe('renderFacts', () => {
     );
-    expect(renderFacts(app('jellyfin'))).toContain(
-      '- **Managed in the app:** nothing yet\n',
-    );
+    expect(renderFacts(app('plex'))).toContain('- **Managed in the app:** nothing yet\n');
   });
```

**Change** `packages/cli/src/credentials.test.ts`:

```diff
diff --git a/packages/cli/src/credentials.test.ts b/packages/cli/src/credentials.test.ts
index b24d1cd..74810cb 100644
--- a/packages/cli/src/credentials.test.ts
+++ b/packages/cli/src/credentials.test.ts
@@ -20,2 +20,3 @@ apps:
   qbittorrent: {}
+  seerr: {}
 `;
@@ -83,4 +84,5 @@ describe('mediaplane credentials', () => {
         '',
-        'Jellyfin     http://127.0.0.1:8096  (its login arrives in Slice 5)',
+        'Jellyfin     http://127.0.0.1:8096',
         'qBittorrent  http://127.0.0.1:8080',
+        'Seerr        http://127.0.0.1:5055  (its login arrives in Slice 6)',
         'Sonarr       http://127.0.0.1:8989',
@@ -106,4 +108,3 @@ describe('mediaplane credentials', () => {
           urls: ['http://127.0.0.1:8096'],
-          login: 'not-yet',
-          comingIn: 'Slice 5',
+          login: 'shared',
         },
@@ -115,2 +116,9 @@ describe('mediaplane credentials', () => {
         },
+        {
+          app: 'seerr',
+          name: 'Seerr',
+          urls: ['http://127.0.0.1:5055'],
+          login: 'not-yet',
+          comingIn: 'Slice 6',
+        },
         {
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 5461fec..127bfe7 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -23,4 +23,6 @@ import {
   type Runtime,
+  type SecretStore,
 } from '@mediaplane/engine';
 import {
+  FAKE_JELLYFIN_USER_ID,
   FIXTURE_HOST,
@@ -52,2 +54,6 @@ const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64
 
+/** Where the home's Jellyfin keeps system.xml, as the image does. */
+const jellyfinConfig = (home: string) => join(home, 'appdata', 'jellyfin');
+
+/** A home of the test stack, whose fake Jellyfin, as it first starts, keeps its files. */
 async function makeHome(stack = STACK): Promise<string> {
@@ -57,2 +63,3 @@ async function makeHome(stack = STACK): Promise<string> {
   await writeFile(join(home, 'stack.yaml'), stack);
+  apis.apps.set('jellyfin', { ...freshAppState(), configDir: jellyfinConfig(home) });
   return home;
@@ -62,4 +69,32 @@ const AT = '2026-10-10T12:00:00.000Z';
 
+/** The key Jellyfin made for Mediaplane, in a home of the test stack set up already. */
+const JELLYFIN_KEY = '5'.repeat(32);
+
+/** Jellyfin's libraries, as resources.json records them and Jellyfin holds them. */
+const LIBRARIES = [
+  ['library_movies', 'Movies', 'movies', '/data/media/movies'],
+  ['library_shows', 'Shows', 'tvshows', '/data/media/tv'],
+] as const;
+
 /** What resources.json records once the test stack is wired, as the fake apps hold it. */
 const WIRED: KnownResources = {
+  'jellyfin.admin': {
+    id: FAKE_JELLYFIN_USER_ID,
+    name: 'admin',
+    fields: { username: 'admin' },
+    secrets: ['password'],
+    appliedAt: AT,
+  },
+  ...Object.fromEntries(
+    LIBRARIES.map(([resource, name, collectionType, paths]) => [
+      `jellyfin.${resource}`,
+      {
+        id: name,
+        name,
+        fields: { name, collectionType, paths },
+        secrets: [],
+        appliedAt: AT,
+      },
+    ]),
+  ),
   'qbittorrent.admin': {
@@ -132,3 +167,8 @@ async function currentHome(
   if (context === undefined) throw new Error('the test stack must plan');
-  const { store } = withGeneratedSecrets(context.stack, context.store, zeros);
+  const generated = withGeneratedSecrets(context.stack, context.store, zeros).store;
+  // Jellyfin's key, which it made in its first-run setup.
+  const store: SecretStore = {
+    ...generated,
+    apps: { ...generated.apps, jellyfin: { apiKey: JELLYFIN_KEY } },
+  };
   await writeSecretStore(home, store);
@@ -143,5 +183,26 @@ async function currentHome(
     await writePrestartFiles(home, files);
+    // Jellyfin finished its startup wizard, and says so in its system.xml.
+    await mkdir(jellyfinConfig(home), { recursive: true });
+    await writeFile(
+      join(jellyfinConfig(home), 'system.xml'),
+      '<ServerConfiguration>\n  <IsStartupWizardCompleted>true</IsStartupWizardCompleted>\n</ServerConfiguration>\n',
+    );
   }
-  // Sonarr and qBittorrent hold what the stack wants, as resources.json records.
+  // The apps hold what the stack wants, as resources.json records.
   const password = store.shared?.adminPassword ?? '';
+  apis.apps.set('jellyfin', {
+    ...freshAppState(),
+    wizard: 'done',
+    user: 'admin',
+    password,
+    apiKeys: [{ AccessToken: JELLYFIN_KEY, AppName: 'Mediaplane', DateCreated: AT }],
+    libraries: LIBRARIES.map(([, name, collectionType, path]) => ({
+      Name: name,
+      CollectionType: collectionType,
+      Locations: [path],
+      LibraryOptions: {},
+    })),
+    folders: LIBRARIES.map(([, , , path]) => path),
+    ...(prestart ? { configDir: jellyfinConfig(home) } : {}),
+  });
   // qBittorrent takes only the stack's key, and gives it back among its preferences.
@@ -307,3 +368,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 6 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 9 wiring checks after the start.',
     );
@@ -610,3 +671,3 @@ describe('mediaplane apply', () => {
     expect(first.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 6 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 9 wiring checks after the start.',
     );
@@ -845,2 +906,6 @@ describe('mediaplane apply', () => {
       ['start', '', 'done'],
+      ['bootstrap', '', 'done'],
+      ['wire', 'jellyfin.admin', 'done'],
+      ['wire', 'jellyfin.library_movies', 'done'],
+      ['wire', 'jellyfin.library_shows', 'done'],
       ['wire', 'qbittorrent.admin', 'done'],
@@ -903,3 +968,3 @@ describe('mediaplane apply', () => {
     expect(term.stderr()).toContain(
-      'Apply failed: 2 done, 1 failed, 4 skipped. Run apply again to retry.',
+      'Apply failed: 2 done, 1 failed, 5 skipped. Run apply again to retry.',
     );
@@ -949,3 +1014,3 @@ describe('mediaplane apply', () => {
     expect(term.stderr()).toMatch(
-      /\nApply failed: 2 done, 1 failed, 4 skipped\. Run apply again to retry\.\n$/,
+      /\nApply failed: 2 done, 1 failed, 5 skipped\. Run apply again to retry\.\n$/,
     );
@@ -1113,3 +1178,3 @@ describe('mediaplane history', () => {
     expect(list.stdout()).toBe(
-      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 6 resources wired\n`,
+      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 9 resources wired\n`,
     );
@@ -1119,3 +1184,3 @@ describe('mediaplane history', () => {
     expect(one.stdout()).toContain(
-      '  done    containers: every app is running and healthy\n',
+      '  done    containers: every app is running and healthy; started jellyfin without its ports, to set it up first\n',
     );
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog packages/cli scripts`
Expected: FAIL. `catalog/jellyfin/integration.test.ts` doesn't load
(`Cannot find module './bootstrap'`), and 15 tests fail in 5 files:
- `catalog.test.ts`, 5: no API, integration or setup for Jellyfin, its old health check,
  and its `login.comingIn` still `Slice 5`;
- `render.test.ts`, 1: Jellyfin isn't on the wiring network;
- `catalog-facts.test.ts`, 1: no MediaBrowser wording;
- `credentials.test.ts`, 2: Jellyfin's login still "arrives in Slice 5";
- `run.test.ts`, 6: no first-run setup or Jellyfin resources in the plan and the steps,
  and the counts that follow (`5 skipped`, `9 resources wired`).

The change to `prowlarr/integration.test.ts` passes either way: that test isn't about
Jellyfin, which it no longer runs.

- [ ] **Step 3: Write Jellyfin's setup and integration**

**Create** `catalog/jellyfin/bootstrap.ts`:

```ts
import { AppApiError, type AppApi, type Bootstrap } from '@mediaplane/engine';
import { z } from 'zod';

/** The name Mediaplane's API key goes by in Jellyfin (Dashboard → API Keys). */
export const KEY_NAME = 'Mediaplane';

const publicInfo = z.looseObject({ StartupWizardCompleted: z.boolean() });
const startupUser = z.looseObject({ Name: z.string() });
const session = z.looseObject({ AccessToken: z.string() });
const apiKeys = z.looseObject({
  Items: z.array(
    z.looseObject({
      AccessToken: z.string(),
      AppName: z.string(),
      DateCreated: z.string(),
    }),
  ),
});

/** Whether Jellyfin's startup wizard is still open: whoever reaches it can finish it. */
async function open(api: AppApi): Promise<boolean> {
  return !(await api.get('/System/Info/Public', publicInfo)).StartupWizardCompleted;
}

/**
 * Sign in to Jellyfin as `login`: a session's token, or undefined when Jellyfin refuses
 * the login. A session of Mediaplane's ends the last one, and should be signed out of.
 */
export async function signIn(
  api: AppApi,
  login: { username: string; password: string },
): Promise<string | undefined> {
  const answer = await api.signIn(
    '/Users/AuthenticateByName',
    { Username: login.username, Pw: login.password },
    session,
    [login.password],
  );
  return answer?.AccessToken;
}

/** The newest key named KEY_NAME that Jellyfin holds, listed in full, or undefined. */
async function heldKey(api: AppApi): Promise<string | undefined> {
  const { Items } = await api.get('/Auth/Keys', apiKeys);
  let newest: { AccessToken: string; DateCreated: string } | undefined;
  for (const key of Items) {
    if (key.AppName !== KEY_NAME) continue;
    if (newest === undefined || key.DateCreated > newest.DateCreated) newest = key;
  }
  return newest?.AccessToken;
}

/**
 * Jellyfin's first-run setup (spec §6.1, §6.4): its startup wizard, finished as the shared
 * admin, then an API key, which only Jellyfin can make.
 * - The wizard: asking for the first user makes it (Jellyfin 12 has none to name before),
 *   which is then named and given the password. A 403 says it has a password already,
 *   from a setup that stopped before it was done.
 * - The sign-in comes before the wizard is completed: Jellyfin takes it then, and a first
 *   user the shared admin can't sign in as isn't Mediaplane's. Completing the wizard with
 *   it would hand Jellyfin to whoever set it, so the wizard is left open.
 * - The key: the one named KEY_NAME that Jellyfin holds already, as after a run that made
 *   it and stopped before saving it, else a new one, read back from the list (making one
 *   answers nothing). Then the session is signed out of.
 * - It is done once system.xml says the wizard is: Jellyfin writes it when it completes.
 */
export const jellyfinBootstrap: Bootstrap = {
  secret: 'apiKey',
  done: {
    path: 'system.xml',
    pattern: /<IsStartupWizardCompleted>true<\/IsStartupWizardCompleted>/,
  },
  open,
  async run(api, admin) {
    const wizard = await open(api);
    if (wizard) {
      await api.get('/Startup/User', startupUser);
      try {
        await api.submit('POST', '/Startup/User', {
          Name: admin.username,
          Password: admin.password,
        });
      } catch (cause) {
        if (!(cause instanceof AppApiError) || cause.status !== 403) throw cause;
      }
    }
    const token = await signIn(api, admin);
    if (token === undefined) {
      const why = wizard
        ? 'its startup wizard has a first user that Mediaplane did not set, so Mediaplane left the wizard open'
        : 'its startup wizard was finished with another login';
      throw new AppApiError(
        `${api.name} at ${api.where} refused the shared admin's sign-in: ${why} (POST /Users/AuthenticateByName)`,
        { kind: 'auth', status: 401 },
      );
    }
    if (wizard) await api.submit('POST', '/Startup/Complete');
    const signedIn = api.withKey(token);
    let key = await heldKey(signedIn);
    if (key === undefined) {
      await signedIn.submit('POST', `/Auth/Keys?app=${KEY_NAME}`);
      key = await heldKey(signedIn);
    }
    await signedIn.submit('POST', '/Sessions/Logout');
    if (key === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} made no key named ${KEY_NAME} (GET /Auth/Keys)`,
        { kind: 'protocol' },
      );
    }
    return key;
  },
};
```

**Create** `catalog/jellyfin/integration.ts`:

```ts
import {
  AppApiError,
  defineIntegration,
  type AppApi,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';
import { signIn } from './bootstrap';

const user = z.looseObject({ Id: z.string(), Name: z.string() });

/**
 * The shared admin (spec §6.1): the user Mediaplane made in Jellyfin's startup wizard,
 * known by the id resources.json records, else by the shared admin's user name. Its name
 * is a managed field, and its password a secret, checked by signing in, then out again.
 * Both are set with the key, which needs neither the old password nor a restart. Jellyfin
 * doesn't lock its admin out after failed sign-ins (probed: none after seven), but its
 * activity log records each sign-in, as it records any.
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
  async observe(api, known, desired) {
    const users = await api.get('/Users', z.array(user));
    const held =
      users.find((u) => known !== undefined && u.Id === known.id) ??
      users.find((u) => u.Name === desired?.fields.username);
    return held === undefined
      ? undefined
      : { id: held.Id, name: 'admin', fields: { username: held.Name } };
  },
  async verify(api, desired) {
    const token = await signIn(api, {
      username: String(desired.fields.username),
      password: desired.secrets.password ?? '',
    });
    if (token === undefined) return false;
    await api.withKey(token).submit('POST', '/Sessions/Logout');
    return true;
  },
  // The startup wizard makes it: Mediaplane makes no other user.
  create: (api, desired) =>
    Promise.reject(
      new AppApiError(
        `${api.name} at ${api.where} has no user ${String(desired.fields.username)}: Mediaplane makes Jellyfin's admin in its startup wizard, and no other user (GET /Users)`,
        { kind: 'rejected' },
      ),
    ),
  async update(api, desired, observed) {
    const path = `/Users/${String(observed.id)}`;
    // The user goes back as Jellyfin gave it, its policy and all: it refuses less.
    const held = await api.get(path, user);
    if (held.Name !== desired.fields.username) {
      await api.submit('POST', path, { ...held, Name: desired.fields.username });
    }
    await api.submit('POST', `${path}/Password`, {
      NewPw: desired.secrets.password ?? '',
    });
  },
};

/**
 * The libraries Mediaplane makes in Jellyfin (spec §6.2): their name, what they hold, and
 * their folder under /data/media, which Sonarr and Radarr fill.
 */
export const LIBRARIES = [
  {
    resource: 'library_movies',
    name: 'Movies',
    collectionType: 'movies',
    path: '/data/media/movies',
  },
  {
    resource: 'library_shows',
    name: 'Shows',
    collectionType: 'tvshows',
    path: '/data/media/tv',
  },
] as const;

const VIRTUAL_FOLDERS = '/Library/VirtualFolders';

const library = z.looseObject({
  Name: z.string(),
  /** Absent for mixed content. */
  CollectionType: z.string().optional(),
  Locations: z.array(z.string()),
});

const fetcher = z.looseObject({ Name: z.string(), DefaultEnabled: z.boolean() });
const available = z.looseObject({
  TypeOptions: z.array(
    z.looseObject({
      Type: z.string(),
      MetadataFetchers: z.array(fetcher),
      ImageFetchers: z.array(fetcher),
      DefaultImageOptions: z.array(z.unknown()),
    }),
  ),
});

/** A library's folders as one sorted list, each once and without a trailing "/". */
function pathsOf(locations: readonly string[]): string {
  const trimmed = locations.map((p) => (p.length > 1 ? p.replace(/\/+$/, '') : p));
  return [...new Set(trimmed)].sort().join(',');
}

/**
 * What Jellyfin's own web UI gives a new library of `type`, where it matters: each kind of
 * item it holds gets the metadata and image downloaders Jellyfin turns on by default, in
 * its order; metadata comes from the internet; and new files are picked up as they come.
 * A library made without them still gets its metadata, but doesn't watch its folders for
 * new files. Everything else is Jellyfin's default, and stays yours.
 */
async function newLibraryOptions(api: AppApi, type: string) {
  const { TypeOptions } = await api.get(
    `/Libraries/AvailableOptions?${new URLSearchParams({ libraryContentType: type, isNewLibrary: 'true' }).toString()}`,
    available,
  );
  const on = (offered: z.infer<typeof fetcher>[]) =>
    offered.filter((f) => f.DefaultEnabled).map((f) => f.Name);
  const all = (offered: z.infer<typeof fetcher>[]) => offered.map((f) => f.Name);
  return {
    Enabled: true,
    EnableInternetProviders: true,
    EnableRealtimeMonitor: true,
    TypeOptions: TypeOptions.map((t) => ({
      Type: t.Type,
      MetadataFetchers: on(t.MetadataFetchers),
      MetadataFetcherOrder: all(t.MetadataFetchers),
      ImageFetchers: on(t.ImageFetchers),
      ImageFetcherOrder: all(t.ImageFetchers),
      ImageOptions: t.DefaultImageOptions,
    })),
  };
}

/**
 * One of Jellyfin's libraries (spec §6.2), known by its name: Jellyfin keys a library by
 * its folder, which a rename changes. Its managed fields are its name, what it holds and
 * its folders. It needs its folder to exist: the wire step makes it first. A second
 * library of one name isn't refused but named "<name>2", so one is made only when none
 * has the name. Jellyfin can't change what a library holds.
 */
function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
  return {
    name: spec.resource,
    fields: ['name', 'collectionType', 'paths'],
    secrets: [],
    desired: () => ({
      name: spec.name,
      fields: { name: spec.name, collectionType: spec.collectionType, paths: spec.path },
      secrets: {},
      folders: [spec.path],
    }),
    async observe(api) {
      const held = (await api.get(VIRTUAL_FOLDERS, z.array(library))).find(
        (l) => l.Name === spec.name,
      );
      return held === undefined
        ? undefined
        : {
            id: spec.name,
            name: spec.name,
            fields: {
              name: held.Name,
              collectionType: held.CollectionType ?? '',
              paths: pathsOf(held.Locations),
            },
          };
    },
    async create(api) {
      const query = new URLSearchParams({
        name: spec.name,
        collectionType: spec.collectionType,
        paths: spec.path,
        refreshLibrary: 'true',
      });
      await api.submit('POST', `${VIRTUAL_FOLDERS}?${query.toString()}`, {
        LibraryOptions: await newLibraryOptions(api, spec.collectionType),
      });
      return { id: spec.name };
    },
    async update(api, _desired, observed) {
      const holds = String(observed.fields.collectionType);
      if (holds !== spec.collectionType) {
        throw new AppApiError(
          `${api.name} at ${api.where} has a library named ${spec.name} that holds ${holds === '' ? 'mixed content' : holds}, not ${spec.collectionType}, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes ${spec.name} (GET ${VIRTUAL_FOLDERS})`,
          { kind: 'rejected' },
        );
      }
      const held = String(observed.fields.paths)
        .split(',')
        .filter((p) => p !== '');
      // The wanted folder first, so the library never holds none.
      if (!held.includes(spec.path)) {
        await api.submit('POST', `${VIRTUAL_FOLDERS}/Paths?refreshLibrary=true`, {
          Name: spec.name,
          Path: spec.path,
        });
      }
      for (const path of held.filter((p) => p !== spec.path)) {
        const query = new URLSearchParams({
          name: spec.name,
          path,
          refreshLibrary: 'true',
        });
        await api.submit('DELETE', `${VIRTUAL_FOLDERS}/Paths?${query.toString()}`);
      }
    },
  };
}

/**
 * What Mediaplane wires in Jellyfin (spec §6.2): the shared admin, and the Movies and
 * Shows libraries. Its first-run setup (bootstrap.ts) comes before, with its key.
 */
export default defineIntegration({
  after: [],
  resources: [admin, ...LIBRARIES.map(libraryResource)],
});
```

**Change** `catalog/jellyfin/app.ts`:

```diff
diff --git a/catalog/jellyfin/app.ts b/catalog/jellyfin/app.ts
index c8fbd09..77614dc 100644
--- a/catalog/jellyfin/app.ts
+++ b/catalog/jellyfin/app.ts
@@ -1,2 +1,4 @@
 import { defineApp } from '@mediaplane/engine';
+import { jellyfinBootstrap } from './bootstrap';
+import integration from './integration';
 
@@ -23,7 +25,18 @@ export default defineApp({
   ],
+  // /health answers 200 with "Degraded" for the first seconds of every start, while the
+  // server itself answers 503: only "Healthy" means it is up.
   health: {
-    test: ['CMD', 'curl', '-fsS', 'http://localhost:8096/health'],
+    test: ['CMD-SHELL', 'curl -fsS http://localhost:8096/health | grep -qx Healthy'],
     startPeriod: '120s',
   },
-  login: { comingIn: 'Slice 5' },
+  // Its key goes in its MediaBrowser header: Jellyfin 12 turns the legacy ones off.
+  api: {
+    port: 'web',
+    ready: '/System/Info/Public',
+    key: { secret: 'apiKey', scheme: 'mediabrowser' },
+    check: '/System/Info',
+  },
+  integration,
+  bootstrap: jellyfinBootstrap,
+  login: 'shared',
   experimental: false,
```

**Change** `scripts/docs/catalog-facts.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.ts b/scripts/docs/catalog-facts.ts
index aec20d9..608fb3c 100644
--- a/scripts/docs/catalog-facts.ts
+++ b/scripts/docs/catalog-facts.ts
@@ -72,3 +72,7 @@ function api(def: AppDefinition): string {
   const carried =
-    key.scheme === 'bearer' ? 'as a Bearer token' : 'in the `X-Api-Key` header';
+    key.scheme === 'bearer'
+      ? 'as a Bearer token'
+      : key.scheme === 'mediabrowser'
+        ? "in Jellyfin's `Authorization: MediaBrowser` header"
+        : 'in the `X-Api-Key` header';
   return `on its ${code(port)} port, which Mediaplane reaches over the stack's wiring network, with ${code(key.secret)} ${carried}`;
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

Run: `pnpm vitest run catalog packages/cli scripts`
Expected: PASS.

Run: `pnpm docs:generate`
Expected: it rewrites the facts in `catalog/jellyfin/README.md`: the health check, the
API and what is managed.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages/cli/src scripts
git commit -m "feat(catalog): Jellyfin set up before its port is published, with its admin and libraries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1567 tests pass in 78 files.

---

### Task 4: Sonarr and Radarr → Jellyfin, on the shared provider, with S4's provider and address gaps closed

Sonarr and Radarr get their connection to Jellyfin, a Servarr provider like the download
client and Prowlarr's links. On the way, the two repeats between providers move into
`servarr-provider.ts`, every app's address comes from one helper, and the CLI tests
apply a stack with Prowlarr.

Decision: `<arr>.connection_jellyfin`, `Jellyfin (Mediaplane)`, with the fields `host`,
`port` and `updateLibrary` and the secret `apiKey`, checked by the arr's own test; made
with the triggers that change a file; requiring `jellyfin.admin`, the arrs after
Jellyfin; wanted before Jellyfin has its key (decision 10).
Decision: `secretOf` and `numberOf` in `servarr-provider.ts`; `serviceAddress` and
`serviceOf` in the engine, used by every provider and the wiring; no address changes
(decision 11).
Decision: a CLI-level `apply` with Prowlarr pins S4's links and proxy, their records, an
empty plan after, and a link skipped when Sonarr's admin fails (decision 11).

**Files:**
- Create: `packages/engine/src/integrations/address.ts`,
  `catalog/_shared/servarr-connection.ts`
- Modify: `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/index.ts`,
  `catalog/_shared/servarr-provider.ts`, `catalog/_shared/servarr-download.ts`,
  `catalog/prowlarr/integration.ts`, `catalog/sonarr/integration.ts`,
  `catalog/radarr/integration.ts`
- Test: `packages/engine/src/integrations/address.test.ts` (new),
  `catalog/_shared/servarr-connection.test.ts` (new), `packages/cli/src/run.test.ts`
- Generated: the facts in `catalog/sonarr/README.md` and `catalog/radarr/README.md`

**Interfaces:**
- **Consumes:** Task 1's fake connections; Task 3's `jellyfin.admin` and Jellyfin's key
  (`keys.jellyfin.apiKey`); S4's `findProvider`, `createProvider`, `updateProvider`,
  `testProvider`, `settingOf`, `textOf` and `ProviderKind`.
- **Produces:**
  - `packages/engine/src/integrations/address.ts`: `serviceOf(app: ResolvedApp): string`,
    `serviceAddress(app: ResolvedApp | undefined, port: string): { host: string; port: number } | undefined`;
  - `catalog/_shared/servarr-provider.ts`: `numberOf(value: unknown): number`,
    `secretOf(desired: DesiredResource, name: string): string`;
  - `catalog/_shared/servarr-connection.ts`: `JELLYFIN_CONNECTION_NAME`
    (`'Jellyfin (Mediaplane)'`), `servarrJellyfin(triggers: readonly string[]): ResourceSpec`;
  - `catalog/sonarr/integration.ts` and `catalog/radarr/integration.ts`:
    `JELLYFIN_TRIGGERS`, and the arrs' integrations after `['jellyfin', 'qbittorrent']`.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/integrations/address.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { wiringStack } from '../testing/wiring';
import { fixtureCatalog } from '../testing/fixtures';
import { serviceAddress, serviceOf } from './address';

const STACK = (qbittorrent: string) => `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: { port: 8990 }
  qbittorrent: ${qbittorrent}
`;

function appOf(id: string, qbittorrent = '{}') {
  return wiringStack(fixtureCatalog, STACK(qbittorrent)).apps.find(
    (a) => a.def.id === id,
  );
}

describe('serviceAddress', () => {
  it("gives an app's service and container port, whatever port the host publishes", () => {
    const sonarr = appOf('sonarr');
    expect(sonarr === undefined ? undefined : serviceOf(sonarr)).toBe('sonarr');
    expect(serviceAddress(sonarr, 'web')).toEqual({ host: 'sonarr', port: 8989 });
  });

  it("puts the app whose network namespace an app runs in at that app's service", () => {
    expect(serviceAddress(appOf('qbittorrent'), 'web')).toEqual({
      host: 'gluetun',
      port: 8080,
    });
    expect(
      serviceAddress(appOf('qbittorrent', '{ vpn: false, port: 8090 }'), 'web'),
    ).toEqual({ host: 'qbittorrent', port: 8090 });
  });

  it('gives nothing for an app the stack lacks, or a port it has none of', () => {
    expect(serviceAddress(undefined, 'web')).toBeUndefined();
    expect(serviceAddress(appOf('sonarr'), 'api')).toBeUndefined();
  });
});
```

**Create** `catalog/_shared/servarr-connection.test.ts`:

```ts
import {
  createAppApi,
  planWiring,
  type ResolvedStack,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeContainer,
  fakeRuntime,
  fakeStackApis,
  freshAppState,
  wiringStack,
  type FakeAppState,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { JELLYFIN_TRIGGERS } from '../sonarr/integration';
import { JELLYFIN_CONNECTION_NAME, servarrJellyfin } from './servarr-connection';

const SONARR_KEY = '0'.repeat(32);
const JELLYFIN_KEY = '7'.repeat(32);

/** A stack with Sonarr, qBittorrent, and the media server `server`. */
function stack(server = 'jellyfin', more = ''): ResolvedStack {
  return wiringStack(
    catalog,
    `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: ${server}
${server === 'plex' ? 'plex: { token: { file: secrets/plex-token } }\n' : ''}apps:
  sonarr: {}
  qbittorrent: { vpn: false }
${more}`,
  );
}

function contextOf(
  resolved: ResolvedStack = stack(),
  keys: WiringContext['keys'] = { jellyfin: { apiKey: JELLYFIN_KEY } },
): WiringContext {
  const app = resolved.apps.find((a) => a.def.id === 'sonarr');
  if (app === undefined) throw new Error('no Sonarr in the stack');
  return {
    stack: resolved,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys: { sonarr: { apiKey: SONARR_KEY }, ...keys },
  };
}

const connection = servarrJellyfin(JELLYFIN_TRIGGERS);

function wanted(ctx: WiringContext = contextOf()) {
  const desired = connection.desired(ctx);
  if (desired === undefined) throw new Error('the connection is wanted');
  return desired;
}

/** A Jellyfin that takes `key`, JELLYFIN_KEY unless given. */
function jellyfin(more: Partial<FakeAppState> = {}, key = JELLYFIN_KEY): FakeAppState {
  return {
    ...freshAppState(),
    apiKeys: [
      { AccessToken: key, AppName: 'Mediaplane', DateCreated: '2026-10-15T12:00:00Z' },
    ],
    ...more,
  };
}

/** Sonarr, faked as fakeStackApis fakes it, Jellyfin taking JELLYFIN_KEY, and a client. */
async function sonarr() {
  const apis = await fakeStackApis();
  const state = freshAppState();
  apis.apps.set('sonarr', state);
  apis.apps.set('jellyfin', jellyfin());
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SONARR_KEY },
    secrets: [SONARR_KEY, JELLYFIN_KEY],
    retry: { deadlineMs: 0 },
  });
  return { api, apis, state };
}

/** The key the connection Sonarr holds has, in clear. */
const heldKey = (state: FakeAppState) =>
  state.connections[0]?.fields.find((f) => f.name === 'apiKey')?.value;

describe("an arr's connection to Jellyfin", () => {
  it("reaches Jellyfin by its service and container port, updates its library, and holds Jellyfin's key", () => {
    expect(connection).toMatchObject({
      name: 'connection_jellyfin',
      fields: ['host', 'port', 'updateLibrary'],
      secrets: ['apiKey'],
      requires: ['jellyfin.admin'],
    });
    expect(wanted(contextOf(stack('jellyfin', '  jellyfin: { port: 8097 }\n')))).toEqual({
      name: JELLYFIN_CONNECTION_NAME,
      fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
      secrets: { apiKey: JELLYFIN_KEY },
    });
  });

  it('is wanted before Jellyfin has made its key, and not at all with Plex', () => {
    // plan names it before Jellyfin's first-run setup; the wire step has the key.
    expect(wanted(contextOf(stack(), {})).secrets).toEqual({});
    expect(connection.desired(contextOf(stack('plex')))).toBeUndefined();
  });

  it("is made from the arr's template with its triggers on, tested as it is saved", async () => {
    const { api, apis, state } = await sonarr();
    expect(await connection.observe(api, undefined)).toBeUndefined();
    const desired = wanted();
    // Jellyfin takes another key: the arr refuses to save the connection.
    apis.apps.set('jellyfin', jellyfin({}, '9'.repeat(32)));
    await expect(connection.create(api, desired)).rejects.toThrow(
      'refused the request (HTTP 400): ApiKey: API Key is invalid',
    );
    apis.apps.set('jellyfin', jellyfin());
    expect(await connection.create(api, desired)).toEqual({ id: 1 });
    expect(state.connections[0]).toMatchObject({
      name: JELLYFIN_CONNECTION_NAME,
      onDownload: true,
      onUpgrade: true,
      onRename: true,
      onSeriesDelete: true,
      onEpisodeFileDelete: true,
      onEpisodeFileDeleteForUpgrade: true,
      onGrab: false,
    });
    expect(heldKey(state)).toBe(JELLYFIN_KEY);
    expect(await connection.observe(api, undefined)).toEqual({
      id: 1,
      name: JELLYFIN_CONNECTION_NAME,
      fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
    });
  });

  it("checks its key with the arr's own test: a refused key is an update, which keeps the user's triggers", async () => {
    const { api, state } = await sonarr();
    const desired = wanted();
    await connection.create(api, desired);
    const held = await connection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    expect(await connection.verify?.(api, desired, held)).toBe(true);
    // A key changed by hand, and a trigger turned off by hand.
    const [made] = state.connections;
    if (made === undefined) throw new Error('no connection made');
    made.fields = made.fields.map((f) =>
      f.name === 'apiKey' ? { ...f, value: '9'.repeat(32) } : f,
    );
    made.onRename = false;
    expect(await connection.verify?.(api, desired, held)).toBe(false);
    await connection.update(api, desired, held);
    expect(heldKey(state)).toBe(JELLYFIN_KEY);
    expect(state.connections[0]?.onRename).toBe(false);
  });

  it("says the arr's own words when its test fails for another reason", async () => {
    const { api, apis } = await sonarr();
    const desired = wanted();
    await connection.create(api, desired);
    const held = await connection.observe(api, undefined);
    if (held === undefined) throw new Error('the connection is there');
    apis.apps.set('jellyfin', jellyfin({ up: false }));
    await expect(connection.verify?.(api, desired, held)).rejects.toThrow(
      'Sonarr at http://sonarr:8989 (127.0.0.1) tested Jellyfin (Mediaplane), and it failed: Host: Unable to send test message: Resource temporarily unavailable (jellyfin:8096) (POST /api/v3/notification/test)',
    );
  });

  it('is never tested by plan while Jellyfin is still to be set up, and once it is', async () => {
    const { apis, state } = await sonarr();
    state.user = 'admin';
    state.password = 'fake-admin-password';
    const tests = () =>
      apis.app.requests.filter((r) => r.path === '/api/v3/notification/test').length;
    const plan = (changing: string[], keys: WiringContext['keys']) =>
      planWiring({
        stack: stack(),
        current: ['jellyfin', 'qbittorrent', 'sonarr'].map((s) =>
          fakeContainer(s, `fake-${s}`),
        ),
        changing: new Set(changing),
        onNetwork: true,
        runtime: fakeRuntime({ addresses: apis.addresses }),
        keys: { sonarr: { apiKey: SONARR_KEY }, ...keys },
        admin: { username: 'admin', password: 'fake-admin-password' },
        secrets: [SONARR_KEY, JELLYFIN_KEY],
        known: {},
        seams: apis.seams,
      });
    // A connection Sonarr holds, its key Jellyfin's.
    const sonarrApi = createAppApi({
      name: 'Sonarr',
      service: 'sonarr',
      port: 8989,
      endpoint: { host: '127.0.0.1', port: apis.app.port },
      key: { scheme: 'x-api-key', value: SONARR_KEY },
      secrets: [],
      retry: { deadlineMs: 0 },
    });
    await connection.create(sonarrApi, wanted());
    const before = tests();
    const pending = await plan(['jellyfin'], {});
    expect(pending.changes).toContainEqual({
      resource: 'sonarr.connection_jellyfin',
      action: 'adopt',
    });
    expect(tests()).toBe(before);
    // Set up: Jellyfin takes its key, and its admin is in place.
    apis.apps.set(
      'jellyfin',
      jellyfin({ wizard: 'done', user: 'admin', password: 'fake-admin-password' }),
    );
    await plan([], { jellyfin: { apiKey: JELLYFIN_KEY } });
    expect(tests()).toBe(before + 1);
  });
});
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 127bfe7..224b2fa 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -12,2 +12,3 @@ import {
   prestartFilesFor,
+  readResources,
   readSecretStore,
@@ -146,2 +147,9 @@ const WIRED: KnownResources = {
   },
+  'sonarr.connection_jellyfin': {
+    id: 1,
+    name: 'Jellyfin (Mediaplane)',
+    fields: { host: 'jellyfin', port: 8096, updateLibrary: true },
+    secrets: ['apiKey'],
+    appliedAt: AT,
+  },
 };
@@ -231,2 +239,17 @@ async function currentHome(
     rootFolders: [{ id: 1, path: '/data/media/tv' }],
+    connections: [
+      {
+        id: 1,
+        name: 'Jellyfin (Mediaplane)',
+        implementation: 'MediaBrowser',
+        onDownload: true,
+        fields: [
+          { name: 'host', value: 'jellyfin' },
+          { name: 'port', value: 8096 },
+          { name: 'useSsl', value: false },
+          { name: 'apiKey', value: JELLYFIN_KEY },
+          { name: 'updateLibrary', value: true },
+        ],
+      },
+    ],
   });
@@ -368,3 +391,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 9 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 10 wiring checks after the start.',
     );
@@ -474,3 +497,3 @@ describe('mediaplane plan', () => {
     expect(term.stdout()).toBe(
-      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr.admin\n  > after start sonarr.download_client\n  > after start sonarr.root_folder\nPlan: 1 app to wait for, 3 wiring checks after the start.\n',
+      'Not healthy yet: sonarr (unhealthy)\nWiring:\n  > after start sonarr.admin\n  > after start sonarr.download_client\n  > after start sonarr.root_folder\n  > after start sonarr.connection_jellyfin\nPlan: 1 app to wait for, 4 wiring checks after the start.\n',
     );
@@ -671,3 +694,3 @@ describe('mediaplane apply', () => {
     expect(first.stdout()).toContain(
-      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 9 wiring checks after the start.',
+      'Plan: 5 files to write, 4 containers to change, 4 secrets to generate, 1 app to set up, 10 wiring checks after the start.',
     );
@@ -916,2 +939,3 @@ describe('mediaplane apply', () => {
       ['wire', 'sonarr.root_folder', 'done'],
+      ['wire', 'sonarr.connection_jellyfin', 'done'],
       ['wire', '', 'done'],
@@ -1060,2 +1084,55 @@ describe('mediaplane apply', () => {
 
+describe('mediaplane apply: Prowlarr in the stack', () => {
+  const WITH_PROWLARR = STACK.replace(
+    '  qbittorrent: {}',
+    '  qbittorrent: {}\n  prowlarr: {}',
+  );
+
+  it('links Prowlarr to Sonarr and makes its indexer proxy, records them, then leaves them as they are', async () => {
+    const home = await makeHome(WITH_PROWLARR);
+    const docker = fakeDocker(home);
+    const first = capture();
+    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
+    expect(first.stdout()).toContain(
+      '  done    wiring prowlarr.application_sonarr: created\n',
+    );
+    expect(first.stdout()).toContain(
+      '  done    wiring prowlarr.indexer_proxy: created\n',
+    );
+    const known = await readResources(home);
+    expect(known['prowlarr.application_sonarr']).toMatchObject({
+      name: 'Sonarr (Mediaplane)',
+      fields: { baseUrl: 'http://sonarr:8989', prowlarrUrl: 'http://prowlarr:9696' },
+      secrets: ['apiKey'],
+    });
+    expect(known['prowlarr.indexer_proxy']).toMatchObject({
+      name: 'Cloudflare (Mediaplane)',
+      fields: { host: 'http://byparr:8191/', requestTimeout: 60, tags: 'cloudflare' },
+      secrets: [],
+    });
+    // Sonarr's key went to Prowlarr; neither the output nor resources.json shows it.
+    const secrets = await secretsIn(home);
+    expectNoSecrets(first.stdout() + first.stderr(), secrets);
+    expectNoSecrets(JSON.stringify(known), secrets);
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+    expect(again.stdout()).toBe('No changes.\n');
+  });
+
+  it("skips Prowlarr's link to Sonarr when Sonarr's admin fails, and still makes the proxy", async () => {
+    const home = await makeHome(WITH_PROWLARR);
+    // Sonarr never becomes ready, so nothing of it can be set: its admin fails.
+    apis.apps.set('sonarr', { ...freshAppState(), up: false });
+    const term = capture();
+    expect(
+      await run(['apply', '--home', home, '--yes'], term.io, deps(fakeDocker(home))),
+    ).toBe(1);
+    expect(term.stdout()).toContain(
+      '  skipped wiring prowlarr.application_sonarr: sonarr.admin failed\n',
+    );
+    expect(term.stdout()).toContain('  done    wiring prowlarr.indexer_proxy: created\n');
+    expect(apis.apps.get('prowlarr')?.applications).toEqual([]);
+  });
+});
+
 describe('mediaplane status', () => {
@@ -1178,3 +1255,3 @@ describe('mediaplane history', () => {
     expect(list.stdout()).toBe(
-      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 9 resources wired\n`,
+      `${id}  success  5 files written, 4 containers changed, 4 secrets generated, 10 resources wired\n`,
     );
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/_shared packages/engine/src/integrations/address.test.ts packages/cli/src/run.test.ts`
Expected: FAIL. `servarr-connection.test.ts` and `address.test.ts` don't load
(`Cannot find module './servarr-connection'`, `'./address'`), and 5 of `run.test.ts`'s
tests fail: the plan, the steps and the history have no `sonarr.connection_jellyfin`
(`10 wiring checks`, `4 wiring checks`, `10 resources wired`). The two tests of Prowlarr
in the stack pass already: they pin what S4 built, at the CLI.

- [ ] **Step 3: Write the address helper, the shared repeats and the connection**

**Create** `packages/engine/src/integrations/address.ts`:

```ts
import type { ResolvedApp } from '../resolver/resolve';

/**
 * The service whose container serves `app` on the stack's networks: the app's own, or for
 * one in another app's network namespace, that app's (Gluetun's, for qBittorrent).
 */
export function serviceOf(app: ResolvedApp): string {
  return app.networkVia ?? app.def.id;
}

/**
 * How the stack's other apps reach `app`'s port `port` (by name), as one app is told of
 * another (spec §6.2): its service, and its container port, after `apps.<id>.port`.
 * Undefined when the stack doesn't run the app, or the app has no such port.
 */
export function serviceAddress(
  app: ResolvedApp | undefined,
  port: string,
): { host: string; port: number } | undefined {
  const container = app?.containerPorts[port];
  return app === undefined || container === undefined
    ? undefined
    : { host: serviceOf(app), port: container };
}
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index f52d87b..e5740d9 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -11,2 +11,3 @@ import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
 import { runbookUrl } from '../runbooks';
+import { serviceOf } from './address';
 import { JoinFailed, OwnContainerUnknown, WiringRefused } from '../runtime/docker';
@@ -121,7 +122,2 @@ export function notOnNetwork(app: ResolvedApp): string {
 
-/** The service whose container serves the app's API: Gluetun's, for qBittorrent. */
-function serviceOf(app: ResolvedApp): string {
-  return app.networkVia ?? app.def.id;
-}
-
 /**
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 30c336d..195daa9 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -33,2 +33,3 @@ export * from './secrets/admin';
 export * from './http/client';
+export * from './integrations/address';
 export * from './integrations/types';
```

**Change** `catalog/_shared/servarr-provider.ts`:

```diff
diff --git a/catalog/_shared/servarr-provider.ts b/catalog/_shared/servarr-provider.ts
index c4eed50..eaa04ca 100644
--- a/catalog/_shared/servarr-provider.ts
+++ b/catalog/_shared/servarr-provider.ts
@@ -3,2 +3,3 @@ import {
   type AppApi,
+  type DesiredResource,
   type KnownResource,
@@ -53,2 +54,17 @@ export function textOf(value: unknown): string {
 
+/** A setting's number, or 0 when it holds none. */
+export function numberOf(value: unknown): number {
+  return typeof value === 'number' ? value : 0;
+}
+
+/**
+ * The secret `name` that `desired` holds, to send in clear in a request body: one app's
+ * key, given to another. desired() gives it whenever it wants the provider.
+ */
+export function secretOf(desired: DesiredResource, name: string): string {
+  const value = desired.secrets[name];
+  if (value === undefined) throw new Error(`${desired.name} has no ${name} to send`);
+  return value;
+}
+
 /**
```

**Change** `catalog/_shared/servarr-download.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.ts b/catalog/_shared/servarr-download.ts
index 6c8f664..3560787 100644
--- a/catalog/_shared/servarr-download.ts
+++ b/catalog/_shared/servarr-download.ts
@@ -1,2 +1,7 @@
-import type { DesiredResource, Fields, ResourceSpec } from '@mediaplane/engine';
+import {
+  serviceAddress,
+  type DesiredResource,
+  type Fields,
+  type ResourceSpec,
+} from '@mediaplane/engine';
 import { z } from 'zod';
@@ -5,2 +10,4 @@ import {
   findProvider,
+  numberOf,
+  secretOf,
   settingOf,
@@ -43,6 +50,5 @@ export interface DownloadLink {
 function fieldsOf(held: Provider, link: DownloadLink): Fields {
-  const port = settingOf(held, 'port');
   return {
     host: textOf(settingOf(held, 'host')),
-    port: typeof port === 'number' ? port : 0,
+    port: numberOf(settingOf(held, 'port')),
     useSsl: settingOf(held, 'useSsl') === true,
@@ -61,4 +67,2 @@ function settingsOf(
 ): Record<string, unknown> {
-  const key = desired.secrets.apiKey;
-  if (key === undefined) throw new Error(`${desired.name} has no apiKey to send`);
   return {
@@ -68,3 +72,3 @@ function settingsOf(
     [link.setting]: desired.fields.category,
-    apiKey: key,
+    apiKey: secretOf(desired, 'apiKey'),
   };
@@ -98,8 +102,8 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
     desired: ({ stack, keys }) => {
-      const qbittorrent = stack.apps.find((app) => app.def.id === 'qbittorrent');
-      const port = qbittorrent?.containerPorts.web;
+      const at = serviceAddress(
+        stack.apps.find((app) => app.def.id === 'qbittorrent'),
+        'web',
+      );
       const key = keys.qbittorrent?.apiKey;
-      if (qbittorrent === undefined || port === undefined || key === undefined) {
-        return undefined;
-      }
+      if (at === undefined || key === undefined) return undefined;
       return {
@@ -107,4 +111,4 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
         fields: {
-          host: qbittorrent.networkVia ?? qbittorrent.def.id,
-          port,
+          host: at.host,
+          port: at.port,
           useSsl: false,
```

**Change** `catalog/prowlarr/integration.ts`:

```diff
diff --git a/catalog/prowlarr/integration.ts b/catalog/prowlarr/integration.ts
index 9ec1964..c65eecc 100644
--- a/catalog/prowlarr/integration.ts
+++ b/catalog/prowlarr/integration.ts
@@ -2,2 +2,3 @@ import {
   provides,
+  serviceAddress,
   type AppApi,
@@ -11,2 +12,4 @@ import {
   findProvider,
+  numberOf,
+  secretOf,
   settingOf,
@@ -85,12 +88,8 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
   const name = `${link.implementation} (Mediaplane)`;
-  const settingsOf = (desired: DesiredResource) => {
-    const key = desired.secrets.apiKey;
-    if (key === undefined) throw new Error(`${desired.name} has no apiKey to send`);
-    return {
-      prowlarrUrl: desired.fields.prowlarrUrl,
-      baseUrl: desired.fields.baseUrl,
-      apiKey: key,
-      syncCategories: String(desired.fields.syncCategories).split(',').map(Number),
-    };
-  };
+  const settingsOf = (desired: DesiredResource) => ({
+    prowlarrUrl: desired.fields.prowlarrUrl,
+    baseUrl: desired.fields.baseUrl,
+    apiKey: secretOf(desired, 'apiKey'),
+    syncCategories: String(desired.fields.syncCategories).split(',').map(Number),
+  });
   const topOf = (desired: DesiredResource) => ({
@@ -105,8 +104,9 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
     desired: ({ stack, app, keys }) => {
-      const arr = stack.apps.find((a) => a.def.id === link.arr);
-      const port = arr?.containerPorts.web;
-      const own = app.containerPorts.web;
+      const arr = serviceAddress(
+        stack.apps.find((a) => a.def.id === link.arr),
+        'web',
+      );
+      const own = serviceAddress(app, 'web');
       const key = keys[link.arr]?.apiKey;
-      if (arr === undefined || port === undefined || own === undefined) return undefined;
-      if (key === undefined) return undefined;
+      if (arr === undefined || own === undefined || key === undefined) return undefined;
       return {
@@ -114,4 +114,4 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
         fields: {
-          prowlarrUrl: `http://${app.def.id}:${String(own)}`,
-          baseUrl: `http://${arr.networkVia ?? arr.def.id}:${String(port)}`,
+          prowlarrUrl: `http://${own.host}:${String(own.port)}`,
+          baseUrl: `http://${arr.host}:${String(arr.port)}`,
           syncLevel: 'fullSync',
@@ -174,5 +174,7 @@ const indexerProxy: ResourceSpec = {
   desired: ({ stack }) => {
-    const solver = stack.apps.find((a) => provides(a.def, 'cloudflare-solver'));
-    const port = solver?.containerPorts.api;
-    if (solver === undefined || port === undefined) return undefined;
+    const solver = serviceAddress(
+      stack.apps.find((a) => provides(a.def, 'cloudflare-solver')),
+      'api',
+    );
+    if (solver === undefined) return undefined;
     return {
@@ -180,3 +182,3 @@ const indexerProxy: ResourceSpec = {
       fields: {
-        host: `http://${solver.def.id}:${String(port)}/`,
+        host: `http://${solver.host}:${String(solver.port)}/`,
         requestTimeout: REQUEST_TIMEOUT,
@@ -194,3 +196,2 @@ const indexerProxy: ResourceSpec = {
     const ids = tagIds.safeParse(held.tags);
-    const timeout = settingOf(held, 'requestTimeout');
     return {
@@ -200,3 +201,3 @@ const indexerProxy: ResourceSpec = {
         host: textOf(settingOf(held, 'host')),
-        requestTimeout: typeof timeout === 'number' ? timeout : 0,
+        requestTimeout: numberOf(settingOf(held, 'requestTimeout')),
         tags: (ids.success ? ids.data : [])
```

**Create** `catalog/_shared/servarr-connection.ts`:

```ts
import {
  serviceAddress,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import {
  createProvider,
  findProvider,
  numberOf,
  secretOf,
  settingOf,
  testProvider,
  textOf,
  updateProvider,
  type ProviderKind,
} from './servarr-provider';

/** The name of the connection to Jellyfin Mediaplane makes in Sonarr and Radarr. */
export const JELLYFIN_CONNECTION_NAME = 'Jellyfin (Mediaplane)';

/** Sonarr's and Radarr's "Emby / Jellyfin" connections, in their "notification" API. */
const CONNECTIONS: ProviderKind = {
  path: '/api/v3/notification',
  implementation: 'MediaBrowser',
  what: 'Emby / Jellyfin connection',
  of: 'Jellyfin',
};

/** The settings the connection's key is refused on: the arr's own test names it so. */
const CREDENTIALS = ['ApiKey'];

/** The desired settings, Jellyfin's key in clear: Jellyfin's key goes to the arr. */
function settingsOf(desired: DesiredResource): Record<string, unknown> {
  return {
    host: desired.fields.host,
    port: desired.fields.port,
    updateLibrary: desired.fields.updateLibrary,
    apiKey: secretOf(desired, 'apiKey'),
  };
}

/**
 * The connection of Sonarr or Radarr to Jellyfin (spec §6.2), named
 * JELLYFIN_CONNECTION_NAME, that has Jellyfin update its library on import.
 * - Its host is Jellyfin's service on the stack's network, at its container port, and it
 *   updates the library; Jellyfin's key is its secret, which the arr shows masked.
 * - It is made from the arr's own template, with `triggers` on: what makes the arr tell
 *   Jellyfin, as files come, are upgraded, renamed or deleted. They stay yours after.
 * - Its key is checked with the arr's own test of the connection it holds: a refused key
 *   (`ApiKey`) means an update, which sets it; any other failure the arr explains. The
 *   arr tests a new connection with a trigger on as it saves it, forceSave or not, so a
 *   create fails while it can't reach Jellyfin; an update is saved untested.
 * - It requires Jellyfin's admin, the first thing Mediaplane checks in Jellyfin, after its
 *   key: while Jellyfin is still to be set up, or refuses its key, `plan` leaves the
 *   connection's key unchecked, and the wire step skips it when Jellyfin's admin fails.
 */
export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
  return {
    name: 'connection_jellyfin',
    fields: ['host', 'port', 'updateLibrary'],
    secrets: ['apiKey'],
    requires: ['jellyfin.admin'],
    desired: ({ stack, keys }) => {
      const at = serviceAddress(
        stack.apps.find((app) => app.def.id === 'jellyfin'),
        'web',
      );
      if (at === undefined) return undefined;
      // Jellyfin makes its key in its first-run setup, which plan never runs: until then
      // the connection is still wanted, and apply has the key by the wire step.
      const key = keys.jellyfin?.apiKey;
      const secrets: Record<string, string> = key === undefined ? {} : { apiKey: key };
      return {
        name: JELLYFIN_CONNECTION_NAME,
        fields: { host: at.host, port: at.port, updateLibrary: true },
        secrets,
      };
    },
    async observe(api, known) {
      const held = await findProvider(api, CONNECTIONS, known, JELLYFIN_CONNECTION_NAME);
      return held === undefined
        ? undefined
        : {
            id: held.id,
            name: held.name,
            fields: {
              host: textOf(settingOf(held, 'host')),
              port: numberOf(settingOf(held, 'port')),
              updateLibrary: settingOf(held, 'updateLibrary') === true,
            },
          };
    },
    verify: (api, desired, observed) =>
      testProvider(api, CONNECTIONS, observed.id, desired.name, CREDENTIALS),
    create: (api, desired) =>
      createProvider(api, CONNECTIONS, settingsOf(desired), {
        name: desired.name,
        ...Object.fromEntries(triggers.map((trigger) => [trigger, true])),
      }),
    update: (api, desired, observed) =>
      updateProvider(api, CONNECTIONS, observed.id, settingsOf(desired), {
        name: desired.name,
      }),
  };
}
```

**Change** `catalog/sonarr/integration.ts`:

```diff
diff --git a/catalog/sonarr/integration.ts b/catalog/sonarr/integration.ts
index cef2617..908633f 100644
--- a/catalog/sonarr/integration.ts
+++ b/catalog/sonarr/integration.ts
@@ -1,8 +1,23 @@
 import { servarrIntegration } from '../_shared/servarr';
+import { servarrJellyfin } from '../_shared/servarr-connection';
 import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';
 
+/**
+ * What tells Jellyfin of a change in Sonarr's library: an episode imported, upgraded or
+ * renamed, or a series or an episode's file deleted.
+ */
+export const JELLYFIN_TRIGGERS = [
+  'onDownload',
+  'onUpgrade',
+  'onRename',
+  'onSeriesDelete',
+  'onEpisodeFileDelete',
+  'onEpisodeFileDeleteForUpgrade',
+] as const;
+
 /**
  * What Mediaplane wires in Sonarr (spec §6.2): the shared admin login, qBittorrent as its
- * download client, filing under the `tv` category, and the root folder /data/media/tv.
- * It comes after qBittorrent, whose category the download client needs.
+ * download client, filing under the `tv` category, the root folder /data/media/tv, and
+ * its connection to Jellyfin. It comes after qBittorrent, whose category the download
+ * client needs, and after Jellyfin, whose admin the connection needs.
  */
@@ -10,3 +25,3 @@ export default servarrIntegration(
   'v3',
-  ['qbittorrent'],
+  ['jellyfin', 'qbittorrent'],
   [
@@ -14,2 +29,3 @@ export default servarrIntegration(
     servarrRootFolder('/data/media/tv'),
+    servarrJellyfin(JELLYFIN_TRIGGERS),
   ],
```

**Change** `catalog/radarr/integration.ts`:

```diff
diff --git a/catalog/radarr/integration.ts b/catalog/radarr/integration.ts
index b966550..bbbfeb7 100644
--- a/catalog/radarr/integration.ts
+++ b/catalog/radarr/integration.ts
@@ -1,8 +1,23 @@
 import { servarrIntegration } from '../_shared/servarr';
+import { servarrJellyfin } from '../_shared/servarr-connection';
 import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';
 
+/**
+ * What tells Jellyfin of a change in Radarr's library: a film imported, upgraded or
+ * renamed, or a film or its file deleted.
+ */
+export const JELLYFIN_TRIGGERS = [
+  'onDownload',
+  'onUpgrade',
+  'onRename',
+  'onMovieDelete',
+  'onMovieFileDelete',
+  'onMovieFileDeleteForUpgrade',
+] as const;
+
 /**
  * What Mediaplane wires in Radarr (spec §6.2): the shared admin login, qBittorrent as its
- * download client, filing under the `movies` category, and the root folder
- * /data/media/movies. It comes after qBittorrent, whose category the download client
+ * download client, filing under the `movies` category, the root folder
+ * /data/media/movies, and its connection to Jellyfin. It comes after qBittorrent, whose
+ * category the download client needs, and after Jellyfin, whose admin the connection
  * needs.
@@ -11,3 +26,3 @@ export default servarrIntegration(
   'v3',
-  ['qbittorrent'],
+  ['jellyfin', 'qbittorrent'],
   [
@@ -15,2 +30,3 @@ export default servarrIntegration(
     servarrRootFolder('/data/media/movies'),
+    servarrJellyfin(JELLYFIN_TRIGGERS),
   ],
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

Run: `pnpm vitest run catalog packages/engine/src/integrations packages/cli`
Expected: PASS: S3c's and S4's tests of the download client and Prowlarr pass unchanged,
which checks that no address moved.

Run: `pnpm docs:generate`
Expected: it rewrites the facts in `catalog/sonarr/README.md` and
`catalog/radarr/README.md`, which now list `<arr>.connection_jellyfin`.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages/engine/src packages/cli/src/run.test.ts
git commit -m "feat(catalog): Sonarr and Radarr have Jellyfin update its library on import" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1578 tests pass in 80 files.

---

### Task 5: End-to-end: Jellyfin wired headlessly

The roadmap's proof for this slice, on real containers: Jellyfin is wired headlessly. It
needs no outside account, and no internet: the stack leaves Prowlarr, and the Byparr it
brings, out.

Decision: a new `test/e2e/jellyfin.e2e.test.ts`, from source, that reads Jellyfin's state
at each `up`, then checks the login, the libraries, both connections, an empty second
`apply`, three changes by hand, and Jellyfin's own key deleted and made again
(decision 13).
Decision: every other e2e stack has Jellyfin, so their lists gain its resources and the
arrs' connections; the deploy test checks the setup from the image, behind the proxy,
and that the image reads Jellyfin's `system.xml` (decisions 1, 2, 13).

**Files:**
- Create: `test/e2e/jellyfin.e2e.test.ts`
- Modify: `test/e2e/helpers.ts`, `test/e2e/apply.e2e.test.ts`,
  `test/e2e/download.e2e.test.ts`, `test/e2e/indexers.e2e.test.ts`,
  `test/e2e/vpn.e2e.test.ts`, `test/e2e/deploy.e2e.test.ts`, `test/e2e/plan.e2e.test.ts`

**Interfaces:**
- **Consumes:** Tasks 2 to 4, as `apply` and `plan` run them; `makeHome`, `composeDown`,
  `expectWiringRemoved`, `runTeardown`, `api`, `getJson`, `jsonBody`, `servarrFailure`
  and `wired` from `test/e2e/helpers.ts`.
- **Produces:** `stackFor(data, { seerr = true, prowlarr = true }: { seerr?: boolean; prowlarr?: boolean } = {})`.

- [ ] **Step 1: See the apply end-to-end test fail on the new resources**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/apply.e2e.test.ts`
Expected: FAIL in "starts the video stack healthy, then has nothing left to do", at the
wiring network:
`expected { internal: true, members: [ …(5) ] } to deeply equal { internal: true, members: [ …(4) ] }`.
Jellyfin is on it now. The stack comes up healthy, and its first `apply` succeeds:
Jellyfin is set up, published and wired.

- [ ] **Step 2: Write the test, and update the others**

**Change** `test/e2e/helpers.ts`:

```diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index 8e47640..d48a460 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -33,4 +33,4 @@ export async function buildImage(tag: string): Promise<void> {
  * The M1 video stack without the VPN (vpn.e2e.test.ts has its own, behind the VPN), or
- * without Seerr too. The apps run as the current user, who owns the temporary data
- * folder.
+ * without Seerr, or Prowlarr (and the Byparr it brings), too. The apps run as the current
+ * user, who owns the temporary data folder.
  */
@@ -38,3 +38,3 @@ export function stackFor(
   data: string,
-  { seerr = true }: { seerr?: boolean } = {},
+  { seerr = true, prowlarr = true }: { seerr?: boolean; prowlarr?: boolean } = {},
 ): string {
@@ -48,4 +48,3 @@ apps:
   radarr: {}
-  prowlarr: {}
-  qbittorrent: { vpn: false }
+${prowlarr ? '  prowlarr: {}\n' : ''}  qbittorrent: { vpn: false }
 ${seerr ? '  seerr: {}\n' : ''}`;
```

**Create** `test/e2e/jellyfin.e2e.test.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  plan,
  readSecretStore,
  writeSecretStore,
  type ApplyOptions,
  type Runtime,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  getJson,
  jsonBody,
  makeHome,
  runTeardown,
  servarrFailure,
  stackFor,
  wired,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-jellyfin`;
/** Jellyfin's web UI, on 127.0.0.1 once it is published. */
const JELLYFIN = 8096;
/** What the stack wires, in the order apply wires it: Jellyfin and qBittorrent first. */
const WIRED = [
  'jellyfin.admin',
  'jellyfin.library_movies',
  'jellyfin.library_shows',
  'qbittorrent.admin',
  'qbittorrent.preferences',
  'qbittorrent.category_tv',
  'qbittorrent.category_movies',
  'radarr.admin',
  'radarr.download_client',
  'radarr.root_folder',
  'radarr.connection_jellyfin',
  'sonarr.admin',
  'sonarr.download_client',
  'sonarr.root_folder',
  'sonarr.connection_jellyfin',
];
/** Each arr, and its web UI's port. */
const ARRS = [
  { app: 'sonarr', port: 8989 },
  { app: 'radarr', port: 7878 },
] as const;
/** The libraries the stack wants: name, what they hold, and their folder. */
const LIBRARIES = [
  ['Movies', 'movies', ['/data/media/movies']],
  ['Shows', 'tvshows', ['/data/media/tv']],
];
/** A key that isn't Jellyfin's: what a hand-made change leaves in an arr's connection. */
const WRONG_KEY = '9'.repeat(32);

/** Jellyfin's MediaBrowser header for its key, or a sign-in's client fields. */
function mediaBrowser(key?: string): Record<string, string> {
  const client =
    'MediaBrowser Client="Mediaplane e2e", Device="e2e", DeviceId="mediaplane-e2e", Version="1"';
  return { Authorization: key === undefined ? client : `${client}, Token="${key}"` };
}

interface Connection {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
}

interface Library {
  Name: string;
  CollectionType?: string;
  Locations: string[];
  LibraryOptions: { TypeOptions: { Type: string; MetadataFetchers: string[] }[] };
}

/**
 * Jellyfin's state now, as the stack's networks show it: whether its port is published
 * on the host, and whether its startup wizard is open, asked at its address on the wiring
 * network (from source, the host reaches it there).
 */
async function jellyfinState(runtime: Runtime): Promise<string> {
  const container = (await runtime.containers()).find((c) => c.service === 'jellyfin');
  if (container === undefined) return 'no container';
  const ports = container.published.filter((p) => p.port !== 0);
  const address = (await runtime.wiringAddresses([container.id]))[container.id] ?? '';
  const answer = await fetch(`http://${address}:${String(JELLYFIN)}/System/Info/Public`, {
    signal: AbortSignal.timeout(10_000),
  });
  const { StartupWizardCompleted: done } = await jsonBody<{
    StartupWizardCompleted: boolean;
  }>(answer, "Jellyfin's public info");
  const shown = ports.map((p) => `${p.address}:${String(p.port)}`).join(' ');
  return `ports ${shown === '' ? 'none' : shown}, wizard ${done ? 'done' : 'open'}`;
}

/**
 * Check that `response` answered `status`. Only a refusal is read, to say why: its
 * validation errors, with every one of `secrets` replaced (servarrFailure).
 */
async function expectStatus(
  response: Response,
  status: number,
  what: string,
  secrets: readonly string[],
): Promise<void> {
  if (response.status === status) return;
  const why = await servarrFailure(response, secrets);
  expect(response.status, `${what}: ${why}`).toBe(status);
}

describe('Jellyfin, set up before it is published', () => {
  it('is wired headlessly: its setup, its libraries, and the arrs telling it of imports', async () => {
    const home = await makeHome();
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      const data = join(home, 'data');
      await writeFile(
        join(home, 'stack.yaml'),
        stackFor(data, { seerr: false, prowlarr: false }),
      );
      const docker = createDockerRuntime({ home, project: PROJECT });
      // Jellyfin as each up leaves it, and as the up that publishes it finds it.
      const seen: string[] = [];
      const runtime: Runtime = {
        ...docker,
        up: async (seconds, values, unpublished = []) => {
          if (unpublished.length === 0) {
            seen.push(`before an up of every port: ${await jellyfinState(docker)}`);
          }
          const result = await docker.up(seconds, values, unpublished);
          const what =
            unpublished.length === 0 ? 'every port' : `no ${unpublished.join(' ')} port`;
          seen.push(`after an up of ${what}: ${await jellyfinState(docker)}`);
          return result;
        },
      };
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

      // plan names the setup, and never runs it.
      const planned = await plan(options);
      expect(planned.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);

      // Jellyfin starts with no published port; Mediaplane finishes its startup wizard
      // over the wiring network, makes its key, and only then publishes it.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(seen).toEqual([
        'after an up of no jellyfin port: ports none, wizard open',
        'before an up of every port: ports none, wizard done',
        `after an up of every port: ports 127.0.0.1:${String(JELLYFIN)}, wizard done`,
      ]);
      expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
        'set up jellyfin and saved jellyfin.apiKey; published jellyfin',
      );
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      // The wizard made the shared admin: the wire step finds it as wanted.
      expect(wired(first.actions)).toEqual([
        ['jellyfin.admin', 'adopted'],
        ['jellyfin.library_movies', 'created'],
        ['jellyfin.library_shows', 'created'],
        ['qbittorrent.admin', 'adopted'],
        ['qbittorrent.preferences', 'adopted'],
        ['qbittorrent.category_tv', 'created'],
        ['qbittorrent.category_movies', 'created'],
        ['radarr.admin', 'created'],
        ['radarr.download_client', 'created'],
        ['radarr.root_folder', 'created'],
        ['radarr.connection_jellyfin', 'created'],
        ['sonarr.admin', 'created'],
        ['sonarr.download_client', 'created'],
        ['sonarr.root_folder', 'created'],
        ['sonarr.connection_jellyfin', 'created'],
      ]);

      // Its key, made by Jellyfin, kept in the store and nowhere Mediaplane shows.
      const store = await readSecretStore(home);
      const key = store.apps.jellyfin?.apiKey ?? '';
      expect(/^[0-9a-f]{32}$/.test(key), 'Jellyfin made no key of 32 hex').toBe(true);
      const password = store.shared?.adminPassword ?? '';
      expect(password !== '', 'no admin password stored').toBe(true);
      const secrets = [
        ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
        password,
      ];
      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      for (const [what, text] of [
        ['resources.json', resources],
        ["apply's result", JSON.stringify(first)],
      ] as const) {
        expect(text.includes(key), `${what} holds Jellyfin's key`).toBe(false);
        expect(text.includes(password), `${what} holds the password`).toBe(false);
      }

      // The shared admin signs in to Jellyfin's published web UI; another password doesn't.
      const signIn = (pw: string) =>
        api(JELLYFIN, '/Users/AuthenticateByName', mediaBrowser(), {
          method: 'POST',
          body: JSON.stringify({ Username: 'admin', Pw: pw }),
          type: 'application/json',
          timeoutMs: 30_000,
        });
      const right = await signIn(password);
      expect(right.status, 'the shared admin signs in').toBe(200);
      const { AccessToken: session } = await jsonBody<{ AccessToken: string }>(
        right,
        "Jellyfin's sign-in",
      );
      const out = await api(JELLYFIN, '/Sessions/Logout', mediaBrowser(session), {
        method: 'POST',
      });
      expect(out.status, 'signed out').toBe(204);
      expect((await signIn('fake-not-the-password')).status).toBe(401);

      // The libraries, each in its folder, with Jellyfin's default metadata downloaders.
      const libraries = async () =>
        (
          await getJson<Library[]>(JELLYFIN, '/Library/VirtualFolders', mediaBrowser(key))
        ).sort((a, b) => (a.Name < b.Name ? -1 : 1));
      const held = await libraries();
      expect(held.map((l) => [l.Name, l.CollectionType, l.Locations])).toEqual(LIBRARIES);
      expect(
        held[0]?.LibraryOptions.TypeOptions.find((t) => t.Type === 'Movie')
          ?.MetadataFetchers,
      ).toContain('TheMovieDb');

      // Both arrs hold "Jellyfin (Mediaplane)", aimed at Jellyfin's service, its key masked,
      // and their own test of it passes.
      const connectionOf = async (arr: (typeof ARRS)[number]) => {
        const all = await getJson<Connection[]>(arr.port, '/api/v3/notification', {
          'X-Api-Key': store.apps[arr.app]?.apiKey ?? '',
        });
        return all.find((c) => c.name === 'Jellyfin (Mediaplane)');
      };
      const testConnection = async (arr: (typeof ARRS)[number]) => {
        const held = await connectionOf(arr);
        const tested = await api(
          arr.port,
          '/api/v3/notification/test',
          { 'X-Api-Key': store.apps[arr.app]?.apiKey ?? '' },
          { method: 'POST', body: JSON.stringify(held), type: 'application/json' },
        );
        return tested.status === 200 ? 'passes' : await servarrFailure(tested, secrets);
      };
      for (const arr of ARRS) {
        const held = await connectionOf(arr);
        const setting = (name: string) =>
          held?.fields.find((f) => f.name === name)?.value;
        expect(
          [
            held?.implementation,
            setting('host'),
            setting('port'),
            setting('updateLibrary'),
          ],
          `${arr.app}'s connection`,
        ).toEqual(['MediaBrowser', 'jellyfin', JELLYFIN, true]);
        expect(setting('apiKey'), `${arr.app} shows the key masked`).toBe('********');
        expect(await testConnection(arr), `${arr.app}'s test of it`).toBe('passes');
      }

      // A second apply changes nothing.
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // Changed by hand: a key in Sonarr's connection that isn't Jellyfin's, the Shows
      // library deleted, and a folder added to Movies. apply puts each back, and nothing
      // else changes.
      const [sonarr] = ARRS;
      const sonarrKey = { 'X-Api-Key': store.apps.sonarr?.apiKey ?? '' };
      const connection = await connectionOf(sonarr);
      const wrong = await api(
        sonarr.port,
        `/api/v3/notification/${String(connection?.id)}?forceSave=true`,
        sonarrKey,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...connection,
            fields: connection?.fields.map((f) =>
              f.name === 'apiKey' ? { ...f, value: WRONG_KEY } : f,
            ),
          }),
          type: 'application/json',
        },
      );
      await expectStatus(wrong, 202, "a wrong key in Sonarr's connection", secrets);
      const removed = await api(
        JELLYFIN,
        '/Library/VirtualFolders?name=Shows&refreshLibrary=false',
        mediaBrowser(key),
        { method: 'DELETE' },
      );
      expect(removed.status, 'Shows removed by hand').toBe(204);
      await mkdir(join(data, 'media', 'other'));
      const added = await api(
        JELLYFIN,
        '/Library/VirtualFolders/Paths?refreshLibrary=false',
        mediaBrowser(key),
        {
          method: 'POST',
          body: JSON.stringify({ Name: 'Movies', Path: '/data/media/other' }),
          type: 'application/json',
        },
      );
      expect(added.status, 'a folder added to Movies by hand').toBe(204);
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'jellyfin.library_movies', action: 'update', changes: ['paths'] },
        { resource: 'jellyfin.library_shows', action: 'create' },
        { resource: 'sonarr.connection_jellyfin', action: 'update', changes: ['apiKey'] },
      ]);
      expect(
        wired(restored.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([
        ['jellyfin.library_movies', 'updated paths'],
        ['jellyfin.library_shows', 'created'],
        ['sonarr.connection_jellyfin', 'updated apiKey'],
      ]);
      expect(restored.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
      expect(
        (await libraries()).map((l) => [l.Name, l.CollectionType, l.Locations]),
      ).toEqual(LIBRARIES);
      expect(await testConnection(sonarr), "Sonarr's test of it").toBe('passes');

      // Jellyfin's own key, deleted in its dashboard: plan says Jellyfin refuses it. With
      // it taken out of state/secrets.json, apply signs in as the admin, published, makes
      // a new key, and gives it to both arrs' connections, whose own test refuses the old.
      const revoked = await api(JELLYFIN, `/Auth/Keys/${key}`, mediaBrowser(key), {
        method: 'DELETE',
      });
      expect(revoked.status, "Jellyfin's key revoked by hand").toBe(204);
      const refused = await plan(options);
      expect(refused.wiring.filter((w) => w.resource.startsWith('jellyfin.'))).toEqual(
        WIRED.slice(0, 3).map((resource) => ({
          resource,
          action: 'unknown',
          reason: expect.stringContaining(
            "refused Mediaplane's API key (HTTP 401)",
          ) as string,
        })),
      );
      const { jellyfin: _lost, ...others } = store.apps;
      await writeSecretStore(home, { ...store, apps: others });
      seen.length = 0;
      const rekeyed = await apply(options);
      expect(rekeyed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(rekeyed.outcome).toBe('success');
      expect(rekeyed.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
      // The start step's up, and no other: Jellyfin stayed published throughout.
      expect(seen).toEqual([
        `before an up of every port: ports 127.0.0.1:${String(JELLYFIN)}, wizard done`,
        `after an up of every port: ports 127.0.0.1:${String(JELLYFIN)}, wizard done`,
      ]);
      const newKey = (await readSecretStore(home)).apps.jellyfin?.apiKey ?? '';
      expect(newKey !== '' && newKey !== key, 'a new key was made and saved').toBe(true);
      // Kept out of every message from here on, as the old one is.
      secrets.push(newKey);
      expect(
        wired(rekeyed.actions).filter(([, detail]) => detail !== 'unchanged'),
      ).toEqual([
        ['radarr.connection_jellyfin', 'updated apiKey'],
        ['sonarr.connection_jellyfin', 'updated apiKey'],
      ]);
      for (const arr of ARRS) {
        expect(await testConnection(arr), `${arr.app}'s test of it`).toBe('passes');
      }
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
index 379bafe..d09385b 100644
--- a/test/e2e/apply.e2e.test.ts
+++ b/test/e2e/apply.e2e.test.ts
@@ -43,6 +43,9 @@ function mediaplane(...args: string[]): Promise<ExecResult> {
 /**
- * What the video stack wires, in the order apply wires it: qBittorrent, then the arrs,
- * then Prowlarr.
+ * What the video stack wires, in the order apply wires it: Jellyfin and qBittorrent, then
+ * the arrs, then Prowlarr.
  */
 const WIRED = [
+  'jellyfin.admin',
+  'jellyfin.library_movies',
+  'jellyfin.library_shows',
   'qbittorrent.admin',
@@ -54,2 +57,3 @@ const WIRED = [
   'radarr.root_folder',
+  'radarr.connection_jellyfin',
   'sonarr.admin',
@@ -57,2 +61,3 @@ const WIRED = [
   'sonarr.root_folder',
+  'sonarr.connection_jellyfin',
   'prowlarr.admin',
@@ -82,3 +87,3 @@ interface Resources {
 async function expectWiringNetwork(containers: readonly { service: string }[]) {
-  const wired = ['prowlarr', 'qbittorrent', 'radarr', 'sonarr'];
+  const wired = ['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr'];
   expect(await wiringMembers(PROJECT)).toEqual({
@@ -268,2 +273,5 @@ describe('apply against real Docker', () => {
       ).toEqual([
+        ['jellyfin.admin', 'adopted'],
+        ['jellyfin.library_movies', 'created'],
+        ['jellyfin.library_shows', 'created'],
         ['qbittorrent.admin', 'adopted'],
@@ -275,2 +283,3 @@ describe('apply against real Docker', () => {
         ['radarr.root_folder', 'created'],
+        ['radarr.connection_jellyfin', 'created'],
         ['sonarr.admin', 'created'],
@@ -278,2 +287,3 @@ describe('apply against real Docker', () => {
         ['sonarr.root_folder', 'created'],
+        ['sonarr.connection_jellyfin', 'created'],
         ['prowlarr.admin', 'created'],
```

**Change** `test/e2e/download.e2e.test.ts`:

```diff
diff --git a/test/e2e/download.e2e.test.ts b/test/e2e/download.e2e.test.ts
index b1b3c45..9a73545 100644
--- a/test/e2e/download.e2e.test.ts
+++ b/test/e2e/download.e2e.test.ts
@@ -43,4 +43,7 @@ const VPN_UP =
   "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up";
-/** What the stack wires, in the order apply wires it: qBittorrent before the arrs. */
+/** What the stack wires, in the order apply wires it: Jellyfin and qBittorrent first. */
 const WIRED = [
+  'jellyfin.admin',
+  'jellyfin.library_movies',
+  'jellyfin.library_shows',
   'qbittorrent.admin',
@@ -52,2 +55,3 @@ const WIRED = [
   'radarr.root_folder',
+  'radarr.connection_jellyfin',
   'sonarr.admin',
@@ -55,2 +59,3 @@ const WIRED = [
   'sonarr.root_folder',
+  'sonarr.connection_jellyfin',
 ];
@@ -359,4 +364,8 @@ describe('the download path, behind the VPN', () => {
       );
-      // qBittorrent's login and settings came with its pre-start file: they are adopted.
+      // qBittorrent's login and settings came with its pre-start file, and Jellyfin's
+      // admin with its first-run setup: they are adopted.
       expect(wired(first.actions)).toEqual([
+        ['jellyfin.admin', 'adopted'],
+        ['jellyfin.library_movies', 'created'],
+        ['jellyfin.library_shows', 'created'],
         ['qbittorrent.admin', 'adopted'],
@@ -368,2 +377,3 @@ describe('the download path, behind the VPN', () => {
         ['radarr.root_folder', 'created'],
+        ['radarr.connection_jellyfin', 'created'],
         ['sonarr.admin', 'created'],
@@ -371,2 +381,3 @@ describe('the download path, behind the VPN', () => {
         ['sonarr.root_folder', 'created'],
+        ['sonarr.connection_jellyfin', 'created'],
       ]);
@@ -406,2 +417,5 @@ describe('the download path, behind the VPN', () => {
       expect(wired(appliedInImage.actions)).toEqual([
+        ['jellyfin.admin', 'unchanged'],
+        ['jellyfin.library_movies', 'unchanged'],
+        ['jellyfin.library_shows', 'unchanged'],
         ['qbittorrent.admin', 'updated password'],
@@ -413,2 +427,3 @@ describe('the download path, behind the VPN', () => {
         ['radarr.root_folder', 'created'],
+        ['radarr.connection_jellyfin', 'unchanged'],
         ['sonarr.admin', 'unchanged'],
@@ -416,2 +431,3 @@ describe('the download path, behind the VPN', () => {
         ['sonarr.root_folder', 'unchanged'],
+        ['sonarr.connection_jellyfin', 'unchanged'],
       ]);
```

**Change** `test/e2e/indexers.e2e.test.ts`:

```diff
diff --git a/test/e2e/indexers.e2e.test.ts b/test/e2e/indexers.e2e.test.ts
index 80e0d92..006da80 100644
--- a/test/e2e/indexers.e2e.test.ts
+++ b/test/e2e/indexers.e2e.test.ts
@@ -31,2 +31,5 @@ const PROWLARR = 9696;
 const WIRED = [
+  'jellyfin.admin',
+  'jellyfin.library_movies',
+  'jellyfin.library_shows',
   'qbittorrent.admin',
@@ -38,2 +41,3 @@ const WIRED = [
   'radarr.root_folder',
+  'radarr.connection_jellyfin',
   'sonarr.admin',
@@ -41,2 +45,3 @@ const WIRED = [
   'sonarr.root_folder',
+  'sonarr.connection_jellyfin',
   'prowlarr.admin',
```

**Change** `test/e2e/vpn.e2e.test.ts`:

```diff
diff --git a/test/e2e/vpn.e2e.test.ts b/test/e2e/vpn.e2e.test.ts
index e79033e..3161a88 100644
--- a/test/e2e/vpn.e2e.test.ts
+++ b/test/e2e/vpn.e2e.test.ts
@@ -253,3 +253,3 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
         internal: true,
-        members: [`${PROJECT}-gluetun-1`],
+        members: [`${PROJECT}-gluetun-1`, `${PROJECT}-jellyfin-1`],
       });
@@ -407,3 +407,7 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
         internal: true,
-        members: [`${PROJECT}-gluetun-1`, `${PROJECT}-mediaplane`],
+        members: [
+          `${PROJECT}-gluetun-1`,
+          `${PROJECT}-jellyfin-1`,
+          `${PROJECT}-mediaplane`,
+        ],
       });
@@ -429,2 +433,5 @@ describe('the VPN kill switch, against a local WireGuard server', () => {
         wiring: [
+          { resource: 'jellyfin.admin', action: 'unchanged' },
+          { resource: 'jellyfin.library_movies', action: 'unchanged' },
+          { resource: 'jellyfin.library_shows', action: 'unchanged' },
           { resource: 'qbittorrent.admin', action: 'unchanged' },
```

**Change** `test/e2e/deploy.e2e.test.ts`:

```diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index b099bbf..c88d63b 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -9,2 +9,4 @@ import {
   nodeExec,
+  readSecretStore,
+  writeSecretStore,
   type ExecResult,
@@ -354,2 +356,14 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     expect(codesIn(again.stdout)).not.toContain('preflight.home-path');
+    // Mediaplane in the image reads Jellyfin's system.xml: with Jellyfin's key out of the
+    // store, plan would set it up again, published, since its setup is done. One it
+    // couldn't read would say nothing, and plan would start it unpublished.
+    const store = await readSecretStore(home);
+    const { jellyfin: _kept, ...others } = store.apps;
+    await writeSecretStore(home, { ...store, apps: others });
+    const keyless = await mediaplane('plan', '--json');
+    await writeSecretStore(home, store);
+    expect(keyless.code, keyless.stderr).toBe(2);
+    expect((JSON.parse(keyless.stdout) as { bootstrap: unknown }).bootstrap).toEqual([
+      { app: 'jellyfin', unpublished: false },
+    ]);
 
@@ -359,7 +373,14 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     // Sonarr to qBittorrent, and made Sonarr's root folder in a throwaway Sonarr
-    // container, through the proxy.
+    // container, through the proxy. Slice 5: it started Jellyfin without its port, set it
+    // up, then published it, all through the proxy, and Sonarr tells it of imports.
+    const applied = JSON.parse(first.stdout) as {
+      plan: { bootstrap: { app: string; unpublished: boolean }[] };
+      actions: { step: string; resource?: string; detail?: string }[];
+    };
+    expect(applied.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    expect(applied.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+      'set up jellyfin and saved jellyfin.apiKey; published jellyfin',
+    );
     expect(
-      (
-        JSON.parse(first.stdout) as { actions: { resource?: string; detail?: string }[] }
-      ).actions
+      applied.actions
         .filter((a) => a.resource !== undefined)
@@ -367,2 +388,5 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     ).toEqual([
+      ['jellyfin.admin', 'adopted'],
+      ['jellyfin.library_movies', 'created'],
+      ['jellyfin.library_shows', 'created'],
       ['qbittorrent.admin', 'adopted'],
@@ -373,2 +397,3 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
       ['sonarr.root_folder', 'created'],
+      ['sonarr.connection_jellyfin', 'created'],
     ]);
```

**Change** `test/e2e/plan.e2e.test.ts`:

```diff
diff --git a/test/e2e/plan.e2e.test.ts b/test/e2e/plan.e2e.test.ts
index d971c2b..15e11d0 100644
--- a/test/e2e/plan.e2e.test.ts
+++ b/test/e2e/plan.e2e.test.ts
@@ -84,2 +84,4 @@ describe('plan against real Docker', () => {
     ]);
+    // Jellyfin's startup wizard: apply finishes it before it publishes Jellyfin.
+    expect(result.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
   });
```

- [ ] **Step 3: Run the two to see them pass**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/jellyfin.e2e.test.ts test/e2e/apply.e2e.test.ts`
Expected: PASS. The Jellyfin test takes about a minute.

- [ ] **Step 4: The whole suite, on both Composes, and nothing left behind**

With nothing else running on Docker, and the module loaded
(`test -d /sys/module/wireguard || sudo modprobe wireguard`):

```bash
pnpm test:e2e
DOCKER_CONFIG=<a config folder whose cli-plugins hold Compose 2.38.2> pnpm test:e2e
docker ps -a --filter name=mediaplane-e2e- --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e- --format '{{.Name}}'
ls -d /tmp/mediaplane-e2e-* 2>/dev/null
```

Expected: 8 files and 22 tests pass on each Compose (see the completion checklist for the
times); the last three print nothing, and `docker volume ls -q | wc -l` is what it was.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): Jellyfin set up before its port is published, its libraries, and the arrs telling it of imports" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1578 tests pass in 80 files (the e2e files aren't among them).

---

### Task 6: Docs

The §9 set for what Tasks 1 to 5 built, and `plan --help`, which now names a password
check among what can leave a mark (decision 8). The README's example output comes from a
real run of the same stack with this slice.

Decision: the docs as decision 15 lists them.

**Files:**
- Modify: `packages/cli/src/run.ts`, `packages/engine/src/config/schema.ts`,
  `docs/runbooks/wiring-failed.md`, `docs/runbooks/app-wont-start.md`,
  `docs/architecture.md`, `docs/security/threat-model.md`, `README.md`,
  `catalog/jellyfin/README.md`, `catalog/sonarr/README.md`, `catalog/radarr/README.md`,
  `deploy/README.md`, `CONTRIBUTING.md`, `docs/design/m1-engine-cli.md`,
  `docs/plans/m1-roadmap.md`
- Test: `packages/cli/src/run.test.ts`
- Generated: `docs/reference/cli.md`, `docs/reference/stack-yaml.md`,
  `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** everything Tasks 1 to 5 built.
- **Produces:** docs only, and `plan`'s help text.

- [ ] **Step 1: Write the failing test of `plan --help`**

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 224b2fa..4b24680 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1343,3 +1343,3 @@ describe('--help', () => {
 
-  it('says plan changes nothing in the stack, apart from the wiring network it joins from the image and the mark a key check can leave', async () => {
+  it('says plan changes nothing in the stack, apart from the wiring network it joins from the image and the mark a key or password check can leave', async () => {
     const term = capture();
@@ -1349,3 +1349,3 @@ describe('--help', () => {
     expect(said).toContain(
-      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key can leave a small mark in an app (see docs/security/threat-model.md)",
+      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see docs/security/threat-model.md)",
     );
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run packages/cli/src/run.test.ts -t "says plan changes nothing"`
Expected: FAIL: `expected 'Usage: mediaplane plan [options] Show…' to contain 'Show what
apply would change; it chan…'`, since the help still says only a key check.

- [ ] **Step 3: The words in code, and the generated references**

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 919ec0b..daea13e 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -228,3 +228,3 @@ export function createProgram(
     .description(
-      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key can leave a small mark in an app (see docs/security/threat-model.md)",
+      "Show what apply would change; it changes nothing in the stack, but from the image it joins the stack's private wiring network, and checking a key or a password can leave a small mark in an app (see docs/security/threat-model.md)",
     )
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index 9953195..bcdd84c 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -223,3 +223,3 @@ const stackShape = {
     .describe(
-      "The shared admin login for the apps' web UIs: qBittorrent, Sonarr, Radarr and Prowlarr use it, and Jellyfin will from Slice 5. qBittorrent gets it before its first start. Once the apps run, apply sets it in all four through their API, and again whenever it changes.",
+      "The shared admin login for the apps' web UIs: qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin use it. qBittorrent gets it before its first start, and Jellyfin in its first-run setup. Once the apps run, apply sets it in all five through their API, and again whenever it changes.",
     ),
```

Run: `pnpm vitest run packages/cli/src/run.test.ts && pnpm docs:generate`
Expected: PASS, and it rewrites `docs/reference/cli.md`, `docs/reference/stack-yaml.md` and
`docs/reference/stack.schema.json`.

- [ ] **Step 4: The runbooks**

**Change** `docs/runbooks/wiring-failed.md`:

```diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 4032b0a..7cfee53 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -3,6 +3,8 @@
 Wiring is what `apply` does through each app's API once the apps run: today, the shared
-admin login in Sonarr, Radarr, Prowlarr and qBittorrent, qBittorrent's settings and its
-`tv` and `movies` categories, in Sonarr and Radarr, qBittorrent as their download client
-and their root folders, and in Prowlarr, its links to Sonarr and Radarr and its indexer
-proxy. Later slices add the media server and the requests app.
+admin login in Sonarr, Radarr, Prowlarr, qBittorrent and Jellyfin, qBittorrent's settings
+and its `tv` and `movies` categories, in Sonarr and Radarr, qBittorrent as their download
+client, their root folders and their connection to Jellyfin, in Prowlarr, its links to
+Sonarr and Radarr and its indexer proxy, and in Jellyfin, its first-run setup, before its
+port is published, and the Movies and Shows libraries. Later slices add the requests app
+and Plex.
 
@@ -69,2 +71,16 @@ proxy. Later slices add the media server and the requests app.
 
+- **`mediaplane apply` stops at the first-run setup step,** before the wiring. Jellyfin's
+  startup wizard is finished there, before its port is published. A Jellyfin whose
+  wizard is still open stays unpublished; one whose wizard is done is published all the
+  same. The step's line, then its error (trimmed):
+
+  ```console
+  Finishing first-run setup before publishing the web UIs…
+    failed  first-run setup
+    skipped wiring
+    skipped verify
+  error: the first-run setup failed: Jellyfin at http://jellyfin:8096 (172.19.0.5) refused the shared admin's sign-in: its startup wizard was finished with another login (POST /Users/AuthenticateByName)
+    hint: fix what the error says, then run apply again: an app whose setup is still open keeps its ports unpublished until then. See https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md
+  ```
+
 - **`mediaplane plan`** warns with the same message, once for the app, and exits 2. It
@@ -117,2 +133,3 @@ In `--json` output, each `diagnostics` entry has a `code`:
 - `resources.invalid`: `state/resources.json` can't be read.
+- `apply.bootstrap-failed`: the first-run setup step failed.
 - `apply.wire-failed`: the wiring step itself failed.
@@ -152,3 +169,11 @@ differ, and a `reason` when it is `unknown`.
     start it. If `plan` says `<app>.not-seeded`, follow the app's README.
-  - Slice 8 restores a key at its source for you.
+  - **Jellyfin** makes its own key, so no key can be put back: a new one is made. A key
+    deleted in Jellyfin's dashboard (API Keys) shuts Mediaplane out of every Jellyfin
+    resource, and `plan` shows them as `? unknown`, with this message. Edit
+    `state/secrets.json` and remove the `jellyfin` entry under `apps`, keeping the file
+    valid JSON (use `sudo` if the file isn't yours). Then run `apply`: Jellyfin is still
+    set up, so Mediaplane signs in as the shared admin, with its port published, makes a
+    new key named `Mediaplane`, keeps it, and gives it to Sonarr's and Radarr's
+    connections, whose own test refuses the old one (`updated apiKey`).
+  - Slice 8 restores a key at its source for you, and makes Jellyfin's anew.
 - **`refused the request (HTTP 403)`, with
@@ -181,5 +206,39 @@ differ, and a `reason` when it is `unknown`.
     it: `refused the request (HTTP 400): Host: Unable to connect to qBittorrent`.
+- **`refused the shared admin's sign-in: its startup wizard was finished with another login`**
+  (`apply.bootstrap-failed`). Jellyfin's startup wizard was finished by hand, with
+  another login, before Mediaplane set it up: from before Slice 5, say. Jellyfin stays
+  published, but Mediaplane can't make its key, and until then, `apply` wires no app.
+  Either set `admin.username`, and
+  `admin.password` to a file of your own, to Jellyfin's admin login, and run `apply`
+  again (the other apps take that login too), or start Jellyfin afresh: stop it
+  (`docker stop mediaplane-jellyfin-1`), remove `appdata/jellyfin` (with `sudo` if it
+  isn't yours), and run `apply`, which sets it up anew. That loses Jellyfin's database
+  and settings, but not your media. With the login fixed, a library of yours named
+  Movies or Shows becomes Mediaplane's: `plan` shows its folders changing, so rename it
+  first to keep it.
+- **`its startup wizard has a first user that Mediaplane did not set, so Mediaplane left the wizard open`**
+  (`apply.bootstrap-failed`). Someone set Jellyfin's first user before Mediaplane could,
+  so Mediaplane didn't complete the wizard for them, and Jellyfin stays unpublished.
+  Start Jellyfin afresh, as above, and run `apply`.
+- **`has no user admin`, for `jellyfin.admin`.** The shared admin's user isn't in
+  Jellyfin by that name: it was removed, or renamed while Mediaplane had no record of it.
+  Rename it back in Jellyfin, or set `admin.username` to its name, and run `apply`
+  again. Mediaplane makes Jellyfin's admin only in its startup wizard.
+- **`has a library named Shows that holds mixed content, not tvshows`** (or Movies).
+  Jellyfin has a library of that name, made by hand, which holds something else, and
+  Jellyfin can't change what a library holds. Rename it or remove it in Jellyfin's
+  dashboard, then run `apply`, which makes the library anew.
+- **`Host: Unable to send test message`, for `<arr>.connection_jellyfin`.** Sonarr or
+  Radarr can't reach Jellyfin at `jellyfin:8096`: check that Jellyfin runs and is
+  healthy (`mediaplane status jellyfin`). A `compose.override.yaml` that takes either off
+  the stack's network breaks it too. Fix that, then run `apply` again. A failure that
+  names `ApiKey` is never this one: Mediaplane gives the arr Jellyfin's key again itself.
+  From `plan`, verify, or `apply` checking a connection the arr holds, it follows
+  `tested Jellyfin (Mediaplane), and it failed:`; when `apply` makes the connection, the
+  arr tests it before it saves it, so it follows `refused the request (HTTP 400):`. While
+  Jellyfin is still to be set up, or refuses its key, `plan` doesn't run the test.
 - **`could not make /data/media/tv for sonarr.root_folder`** (`wire.folders`). Sonarr and
-  Radarr need their root folder to exist, so Mediaplane makes it first, as the stack's
-  `user:`, in a throwaway container of the app. mkdir's own message follows. Usually the
+  Radarr need their root folder to exist, and Jellyfin its libraries', so Mediaplane
+  makes it first, as the stack's `user:`, in a throwaway container of the app. mkdir's
+  own message follows. Usually the
   folder that holds it, such as `media/` in the data folder, belongs to another user:
@@ -218,3 +277,5 @@ differ, and a `reason` when it is `unknown`.
   of another kind, or an indexer proxy called `Cloudflare (Mediaplane)` that isn't a
-  FlareSolverr one. Rename or remove it in the app's web UI, then run `apply` again.
+  FlareSolverr one, or Sonarr or Radarr has a connection called `Jellyfin (Mediaplane)`
+  that isn't an Emby / Jellyfin one. Rename or remove it in the app's web UI, then run
+  `apply` again.
 - **`could not be reached`, `cut the connection` or `did not answer within … s`.** The
@@ -326,2 +387,3 @@ Then run `mediaplane apply`. It plans again and does only what is left
 - **Leave the keys as Mediaplane set them,** and don't make one anew in an app's web UI.
+  In Jellyfin's dashboard, leave the API key named `Mediaplane`.
 - **Leave the wiring network out of `compose.override.yaml`**
```

**Change** `docs/runbooks/app-wont-start.md`:

```diff
diff --git a/docs/runbooks/app-wont-start.md b/docs/runbooks/app-wont-start.md
index 53881a5..77922eb 100644
--- a/docs/runbooks/app-wont-start.md
+++ b/docs/runbooks/app-wont-start.md
@@ -61,2 +61,6 @@
     apply's ownership step.
+- **Jellyfin stays `starting`.** Its health check passes only once its `/health` answers
+  `Healthy`. In the first seconds of every start, it answers `Degraded`, then Jellyfin
+  restarts its server, which answers 503 for a few seconds more (seen on Jellyfin 12.2).
+  Read its log (check 3) for what it is doing.
 - **A slow start.** With the health checks Mediaplane sets, failed checks don't count
```

- [ ] **Step 5: The architecture and the threat model**

**Change** `docs/architecture.md`:

```diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 184e60f..2788290 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -3,3 +3,3 @@
 This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
-covering what is built so far (Slices 1 to 4). The design describes the whole of M1;
+covering what is built so far (Slices 1 to 5). The design describes the whole of M1;
 this page describes what exists.
@@ -13,5 +13,7 @@ You describe the stack you want in one file, `stack.yaml`. Mediaplane then works
   it joins the stack's wiring network, to ask the apps: see [The wiring](#the-wiring)).
-  Checking a key can leave two small marks in an app: a post-import category made in
-  qBittorrent, and a failure recorded in an app's status of a client or link. The
-  [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more;
+  Checking a key or a password can leave small marks in an app: a post-import category
+  made in qBittorrent, a failure recorded in an app's status of a client, link or
+  connection, and a sign-in in Jellyfin's activity log. It never runs an app's first-run
+  setup. The [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says
+  more;
 - `apply` makes those changes, then plans again to check that nothing is left.
@@ -112,2 +114,6 @@ Each part, and where its code is:
   ([ADR 0004](adr/0004-converge-forward-apply.md)).
+- **first-run setup** (`plan/bootstrap.ts` and `apply/bootstrap.ts` in
+  `packages/engine/src`, and each app's `bootstrap` in the catalog, such as
+  `catalog/jellyfin/bootstrap.ts`): an app whose setup anyone could finish is set up
+  before its port is published (see [Bootstrap before publish](#bootstrap-before-publish)).
 - **history** (`packages/engine/src/history`): writes a change record for every apply
@@ -130,4 +136,3 @@ Not built yet:
 
-- the rest of the links between the apps: Jellyfin (Slice 5), the requests app
-  (Slice 6) and Plex (Slice 7);
+- the rest of the links between the apps: the requests app (Slice 6) and Plex (Slice 7);
 - drift detection, with Keep mine (Slice 8).
@@ -158,3 +163,4 @@ diff
   │ keys to generate,
-  │ apps not healthy yet
+  │ apps not healthy yet,
+  │ first-run setups
   ▼
@@ -198,3 +204,7 @@ lock
    stranded qBittorrent
- → up --wait
+ → up --wait, an app
+   still to set up with
+   no published port
+ → set it up, keep its
+   key, up --wait again
  → wire each app
@@ -225,2 +235,4 @@ lock
   unhealthy, and gives up after 10 minutes.
+- **First-run setup** comes between `up` and the wiring, for an app that `plan` lists
+  under `First-run setup:`: see [Bootstrap before publish](#bootstrap-before-publish).
 - **A stranded qBittorrent is restarted.** qBittorrent joins Gluetun's network when it
@@ -288,3 +300,49 @@ exist, are on the same filesystem as the folder itself. qBittorrent saves into
 `/data/torrents`, a folder per category, and Sonarr's and Radarr's libraries are
-`/data/media/tv` and `/data/media/movies`, which `apply` makes.
+`/data/media/tv` and `/data/media/movies`, which `apply` makes, and which are Jellyfin's
+Shows and Movies libraries.
+
+## Bootstrap before publish
+
+Jellyfin's startup wizard answers whoever reaches it, and whoever finishes it owns the
+server. So it is never published while it is open:
+
+```text
+plan
+  │ Jellyfin: no key stored,
+  │ or its system.xml says the
+  │ wizard isn't done
+  ▼
+up --wait
+  │ Jellyfin with no port
+  │ published: one more
+  │ Compose file, on stdin,
+  │ resets its ports
+  ▼
+first-run setup, over the
+wiring network
+  │ the wizard, as the shared
+  │ admin; sign in; make the
+  │ key, keep it; sign out
+  ▼
+up --wait again
+  Jellyfin published
+```
+
+- **Which apps.** An app with a `bootstrap` in its catalog entry, whose key isn't stored,
+  or whose appdata doesn't say its setup is done (Jellyfin's `system.xml`). It starts
+  unpublished unless its appdata says the setup is done: then only its key is to make.
+  `plan` lists it under `First-run setup:` (`bootstrap` in `--json`), shows its container
+  recreated when it runs published, and checks its wiring after the start. It never
+  runs the setup.
+- **No port at all.** The file Compose gets on its standard input, after
+  `compose.override.yaml`, sets the app's `ports` to `!reset []`, so the override's ports
+  go too. `compose.yaml` itself always has the ports, so the stack runs as written
+  without Mediaplane.
+- **The setup** reaches the app on the wiring network without a key, finishes its
+  wizard, and keeps the key it makes in `state/secrets.json` at once. Then Mediaplane
+  steps off the wiring network, `up` runs again, without the extra file, and Compose
+  recreates the app with its ports. An app
+  whose setup failed while it is still open stays unpublished; one whose setup is done
+  is published even when making its key failed.
+- **No new Docker call:** the proxy allows nothing new.
 
@@ -293,6 +351,7 @@ exist, are on the same filesystem as the folder itself. qBittorrent saves into
 Wiring is what Mediaplane does through each app's API once the apps run. Today that is
-the shared admin login in Sonarr, Radarr, Prowlarr and qBittorrent; the download path:
-qBittorrent's settings and categories, and Sonarr's and Radarr's download client and
-root folder; and the indexers: Prowlarr's links to Sonarr and Radarr, and its indexer
-proxy.
+the shared admin login in Sonarr, Radarr, Prowlarr, qBittorrent and Jellyfin; the
+download path: qBittorrent's settings and categories, and Sonarr's and Radarr's download
+client and root folder; the indexers: Prowlarr's links to Sonarr and Radarr, and its
+indexer proxy; and the media server: Jellyfin's libraries, and Sonarr's and Radarr's
+connection to it.
 
@@ -305,3 +364,4 @@ mediaplane-system
 mediaplane (the stack)
-  sonarr, radarr, prowlarr
+  sonarr, radarr, prowlarr,
+  jellyfin
   gluetun ─ qbittorrent
@@ -387,2 +447,25 @@ mediaplane (the stack)
 
+- **The media server:**
+
+  ```text
+  sonarr, radarr
+    │ connection "Jellyfin
+    │ (Mediaplane)": update the
+    │ library on import, with
+    │ Jellyfin's key
+    ▼
+  jellyfin
+    Movies: /data/media/movies
+    Shows: /data/media/tv
+  ```
+
+  - Jellyfin comes first, once it is set up: its shared admin, and the Movies and Shows
+    libraries, each in the folder its arr files into. Each folder is made first, in a
+    throwaway Jellyfin container, as the arrs' root folders are.
+  - Sonarr and Radarr come after it. Each gets `Jellyfin (Mediaplane)`, an Emby / Jellyfin
+    connection that has Jellyfin update its library when a file is imported, upgraded,
+    renamed or deleted. Its key is checked with the arr's own test, which calls Jellyfin
+    with it. It needs Jellyfin's admin in place: while Jellyfin is still to be set up,
+    `plan` leaves the connection's key for `apply` to check.
+
 - **Each resource** is one of:
@@ -402,3 +485,4 @@ mediaplane (the stack)
 - **The wire step** waits until each app is ready (`/ping` for Sonarr, Radarr and
-  Prowlarr), checks that its key still works, then makes each resource what the stack
+  Prowlarr, `/System/Info/Public` for Jellyfin), checks that its key still works, then
+  makes each resource what the stack
   wants, in order: an app comes after the apps its integration names. A resource that
@@ -409,3 +493,5 @@ mediaplane (the stack)
   agent of its own, never through a proxy from the environment. It sends the app's key in
-  a header, never in the URL. It tries a refused or cut connection, a timeout, or a 502,
+  a header, never in the URL: Jellyfin's in its `Authorization: MediaBrowser` header,
+  which names Mediaplane as its client on every call, as Jellyfin's sign-in needs. It
+  tries a refused or cut connection, a timeout, or a 502,
   503 or 504 again, waiting longer each time, for up to two minutes in `apply` and 15
@@ -473,4 +559,3 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- the rest of the wiring, app by app: Jellyfin (Slice 5), the requests app (Slice 6)
-  and Plex (Slice 7);
+- the rest of the wiring, app by app: the requests app (Slice 6) and Plex (Slice 7);
 - drift detection (Slice 8);
```

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 8ec7706..e3ba269 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -2,3 +2,3 @@
 
-This is the threat model for Mediaplane as built today: M1, up to and including Slice 4.
+This is the threat model for Mediaplane as built today: M1, up to and including Slice 5.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -13,12 +13,13 @@ that power. None of them removes it.
 
-| Asset                                        | Where                                                                 | Why it matters                                             |
-| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
-| The host                                     | Everything                                                            | Docker access is root on the host                          |
-| Generated API keys                           | `state/secrets.json`, `generated/.env` (both 0600) and `appdata/`     | They open the apps' APIs                                   |
-| qBittorrent's key, in Sonarr and Radarr      | Their download client's settings, in `appdata/`                       | It opens qBittorrent's API                                 |
-| Sonarr's and Radarr's keys, in Prowlarr      | Its links' settings, in `appdata/`                                    | They open Sonarr's and Radarr's APIs                       |
-| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr and Prowlarr          |
-| Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                     |
-| App data                                     | `appdata/<app>/`                                                      | The apps' databases and settings, some holding credentials |
-| Your media                                   | The data folder                                                       | Your library                                               |
+| Asset                                        | Where                                                                 | Why it matters                                              |
+| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
+| The host                                     | Everything                                                            | Docker access is root on the host                           |
+| Generated API keys                           | `state/secrets.json`, `generated/.env` (both 0600) and `appdata/`     | They open the apps' APIs                                    |
+| qBittorrent's key, in Sonarr and Radarr      | Their download client's settings, in `appdata/`                       | It opens qBittorrent's API                                  |
+| Sonarr's and Radarr's keys, in Prowlarr      | Its links' settings, in `appdata/`                                    | They open Sonarr's and Radarr's APIs                        |
+| Jellyfin's key, which Jellyfin made          | `state/secrets.json` (0600), and Sonarr's and Radarr's connections    | It opens Jellyfin's API, as its admin                       |
+| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin |
+| Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                      |
+| App data                                     | `appdata/<app>/`                                                      | The apps' databases and settings, some holding credentials  |
+| Your media                                   | The data folder                                                       | Your library                                                |
 
@@ -93,2 +94,10 @@ host network, read-only mounts
   new for it. T5 says what its environment holds.
+- **The first-run setup.** An app whose setup anyone who reaches it could finish, which
+  is Jellyfin's startup wizard today, starts with no published port: `apply` gives
+  Compose one more file, on its standard input, that takes every port off it, those of
+  `compose.override.yaml` too. Mediaplane finishes the wizard over the wiring network, as
+  the shared admin, makes Jellyfin's key and keeps it, and only then starts Jellyfin
+  again with its port published (see T16). That uses the Docker API calls an `apply`
+  that recreates an app already makes, so the proxy allows nothing new for it. `plan`
+  never runs it.
 - **The wiring.** `plan` and `apply` call the apps' APIs over the wiring network: from
@@ -97,4 +106,7 @@ host network, read-only mounts
   in the environment (`NODE_USE_ENV_PROXY`) never sees a key. It carries the app's key in
-  a header (`X-Api-Key`, or a Bearer token for qBittorrent), never in the URL. Mediaplane
-  signs in to qBittorrent, Sonarr, Radarr and Prowlarr with the shared login, to check it.
+  a header (`X-Api-Key`, a Bearer token for qBittorrent, or Jellyfin's
+  `Authorization: MediaBrowser Token="…"`), never in the URL. Mediaplane signs in to
+  qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin with the shared login, to check it;
+  Jellyfin's sign-in is signed out of again, and its activity log records both, as it
+  records any sign-in.
   `plan` checks a download client with the arr's own test, which also makes a missing
@@ -103,5 +115,6 @@ host network, read-only mounts
   qBittorrent. It checks Prowlarr's links with Prowlarr's own test, which calls the arr
-  with its key, and has the arr call Prowlarr back. Either test, when it fails, records a
-  failure in that app's status of the client or link, as a test from the app's web UI
-  does; a later pass resets it.
+  with its key, and has the arr call Prowlarr back, and an arr's connection to Jellyfin
+  with the arr's own test, which calls Jellyfin with its key. Each of those tests, when it
+  fails, records a failure in that app's status of the client, link or connection, as a
+  test from the app's web UI does; a later pass resets it.
 - **The Cloudflare solver.** Byparr, or FlareSolverr, runs a browser for Prowlarr on the
@@ -130,5 +143,5 @@ host network, read-only mounts
     on the stack's own Docker network.
-  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, and qBittorrent,
-    through Gluetun with a VPN) are on the stack's wiring network too. It is internal:
-    it gives them no way out, which they have on their own network.
+  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, Jellyfin, and
+    qBittorrent, through Gluetun with a VPN) are on the stack's wiring network too. It is
+    internal: it gives them no way out, which they have on their own network.
   - Before an app's first start, Mediaplane writes the files it reads when it starts:
@@ -173,2 +186,4 @@ Controls today:
   (`security.login_on_lan`).
+- Jellyfin publishes no port while its startup wizard is open: Mediaplane finishes it as
+  the shared admin first (T16). Jellyfin asks for a login from everywhere.
 - With `login_on_lan: false`, qBittorrent lets only your LAN subnet skip its login, and
@@ -184,5 +199,4 @@ What remains:
 - On a home network, `init` suggests `bind: lan`, which puts the web UIs on your LAN.
-- Until the wiring lands (Slices 5 and 6, and Slice 7 with Plex), Jellyfin's wizard and
-  Seerr's setup are open to whoever reaches them first. Complete them right after the
-  first `apply`, or keep `bind: localhost` until you have.
+- Until Slice 6 (Slice 7 with Plex), Seerr's setup is open to whoever reaches it first.
+  Complete it right after the first `apply`, or keep `bind: localhost` until you have.
 - With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
@@ -248,2 +262,5 @@ What remains:
   can drive both: change their settings, or read their password hash (see T10).
+- Sonarr and Radarr hold Jellyfin's key, as their connection to it needs. A key is
+  Jellyfin's admin, so a compromised arr can drive Jellyfin: change its settings, users
+  and libraries.
 - A link stays in Prowlarr when its arr leaves the stack, and keeps that arr's key,
@@ -278,7 +295,13 @@ Controls today:
   quoted in an HTML page.
-- qBittorrent's key goes to Sonarr and Radarr in their download client's settings, and
-  Sonarr's and Radarr's keys go to Prowlarr in its links' settings: request bodies, the
-  only places one app's key goes to another. They show it masked (`********`)
-  afterwards, and Mediaplane tests the masked client or link, so the key isn't sent
-  again for the check.
+- qBittorrent's key goes to Sonarr and Radarr in their download client's settings,
+  Sonarr's and Radarr's keys go to Prowlarr in its links' settings, and Jellyfin's key
+  goes to Sonarr and Radarr in their connection's: request bodies, the only places one
+  app's key goes to another. They show it masked (`********`) afterwards, and Mediaplane
+  tests the masked client, link or connection, so the key isn't sent again for the
+  check.
+- Jellyfin's key is the one Jellyfin makes: Mediaplane reads it once from Jellyfin's list
+  of keys, which shows them in full, and keeps it in `state/secrets.json` at once. The
+  session it signs in for that is signed out of right after. The admin password goes to
+  Jellyfin only in request bodies: its startup wizard, its sign-in, and a change of its
+  password, sent with its key.
 - The admin password goes to qBittorrent only in request bodies: its preferences, sent
@@ -385,4 +408,7 @@ What remains:
 
-- One password opens every app that uses it: qBittorrent, Sonarr, Radarr and Prowlarr
-  today, and Jellyfin from Slice 5. A leak from one is a leak for all.
+- One password opens every app that uses it: qBittorrent, Sonarr, Radarr, Prowlarr and
+  Jellyfin. A leak from one is a leak for all.
+- `plan` and `apply` check Jellyfin's password by signing in. Jellyfin doesn't lock its
+  admin out after failed sign-ins (none after seven in a row, on Jellyfin 12.2), but its
+  activity log records each one, right or wrong, so a `plan` adds three lines there.
 - Sonarr, Radarr and Prowlarr give their password hash to anyone who holds their API
@@ -558,2 +584,27 @@ What remains:
 
+### T16. Someone else finishes an app's first-run setup
+
+Controls today:
+
+- Jellyfin's startup wizard is never published while it is open. `apply` starts Jellyfin
+  with no published port, its override's ports included, finishes the wizard over the
+  wiring network, and only then publishes it.
+- Before an app starts, Mediaplane reads its appdata (Jellyfin's `system.xml`) to see
+  whether its setup is done. A Jellyfin whose appdata was emptied starts its wizard
+  again: it starts unpublished again, even with its key stored.
+- Mediaplane signs in as the shared admin before it completes the wizard. If the first
+  user isn't one the shared admin can sign in as, someone else set it, and Mediaplane
+  leaves the wizard open, Jellyfin unpublished, and stops with what it found.
+
+What remains:
+
+- While the wizard is open, for the seconds Mediaplane takes, any container of the stack
+  can reach Jellyfin on the stack's networks. A compromised app could claim it first:
+  Mediaplane's sign-in then fails, and `apply` stops, completing no wizard for it.
+- An appdata Mediaplane can't read says nothing: with Jellyfin's key stored, Mediaplane
+  takes the setup as done.
+- Run outside Mediaplane (the ejectable command, or a restart of a published Jellyfin
+  whose appdata was emptied), Jellyfin starts published with its wizard open: stop it
+  before emptying its appdata, and set it up with `apply`.
+
 ## What the proxy does not stop
```

- [ ] **Step 6: The READMEs, the deploy guide and CONTRIBUTING**

**Change** `README.md`:

```diff
diff --git a/README.md b/README.md
index 3fa28fa..348a515 100644
--- a/README.md
+++ b/README.md
@@ -12,13 +12,14 @@ Compose and wires the apps together for you.**
 >   would do. `mediaplane apply` then starts the stack, confirms that every app is
->   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr and Prowlarr
->   (`mediaplane credentials` shows it). It links Sonarr and Radarr to qBittorrent:
->   download clients, categories and root folders. It links Prowlarr to Sonarr and
->   Radarr, so the indexers you add in Prowlarr reach both, with Byparr as Prowlarr's
->   proxy for indexers behind Cloudflare. `mediaplane vpn-check` confirms that
->   qBittorrent reaches the internet only through the VPN. Mediaplane runs in its own
->   hardened container, behind a Docker socket proxy, and reaches the apps over a
->   private network with no route out.
-> - **Next:** the rest of the wiring: Jellyfin, then Seerr, then Plex. Until that lands,
->   those still need setting up by hand. Jellyfin's wizard and Seerr's setup are open to
->   anyone who can reach them until you complete them, so complete them first.
+>   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr, Prowlarr and
+>   Jellyfin (`mediaplane credentials` shows it). It sets Jellyfin up before its web UI
+>   is published, with its Movies and Shows libraries. It links Sonarr and Radarr to
+>   qBittorrent: download clients, categories and root folders, and to Jellyfin, which
+>   they tell of each import. It links Prowlarr to Sonarr and Radarr, so the indexers you
+>   add in Prowlarr reach both, with Byparr as Prowlarr's proxy for indexers behind
+>   Cloudflare. `mediaplane vpn-check` confirms that qBittorrent reaches the internet
+>   only through the VPN. Mediaplane runs in its own hardened container, behind a Docker
+>   socket proxy, and reaches the apps over a private network with no route out.
+> - **Next:** the rest of the wiring: Seerr, then Plex. Until that lands, those still
+>   need setting up by hand. Seerr's setup is open to anyone who can reach it until you
+>   complete it, so complete it first.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -48,22 +49,23 @@ Mediaplane does that part for you:
 
-| Capability                                                                        | Status       |
-| --------------------------------------------------------------------------------- | ------------ |
-| Validate `stack.yaml`, with errors that say what to change                        | Done         |
-| Render a readable Compose project with images pinned by tag and digest            | Done         |
-| Check the host first: Docker versions, disk, data folder, ports, the VPN device   | Done         |
-| Refuse to publish web UIs on a cloud VM's private address by mistake              | Done         |
-| Predict exactly which containers will change, using Compose's own config hashes   | Done         |
-| Generate keys and start the stack (`mediaplane apply`)                            | Done         |
-| See each app's health and every past apply (`status`, `history`)                  | Done         |
-| Write a starter `stack.yaml` (`init`)                                             | Done         |
-| One admin login for qBittorrent, Sonarr, Radarr and Prowlarr (`credentials`)      | Done         |
-| Reach the apps' APIs over a private network with no route out                     | Done         |
-| A VPN kill switch, tested against a real WireGuard server, and `vpn-check`        | Done         |
-| Run in a hardened container, behind a Docker socket proxy                         | Done         |
-| Documentation generated from code: the `stack.yaml` and CLI references, app facts | Done         |
-| Link Sonarr and Radarr to qBittorrent: download clients, categories, root folders | Done         |
-| Link Prowlarr to Sonarr and Radarr, with Byparr or FlareSolverr as its proxy      | Done         |
-| Wire the rest together (media server, requests)                                   | Planned      |
-| Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
-| Web panel with a setup wizard                                                     | Planned (M2) |
+| Capability                                                                              | Status       |
+| --------------------------------------------------------------------------------------- | ------------ |
+| Validate `stack.yaml`, with errors that say what to change                              | Done         |
+| Render a readable Compose project with images pinned by tag and digest                  | Done         |
+| Check the host first: Docker versions, disk, data folder, ports, the VPN device         | Done         |
+| Refuse to publish web UIs on a cloud VM's private address by mistake                    | Done         |
+| Predict exactly which containers will change, using Compose's own config hashes         | Done         |
+| Generate keys and start the stack (`mediaplane apply`)                                  | Done         |
+| See each app's health and every past apply (`status`, `history`)                        | Done         |
+| Write a starter `stack.yaml` (`init`)                                                   | Done         |
+| One admin login for qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin                  | Done         |
+| Reach the apps' APIs over a private network with no route out                           | Done         |
+| A VPN kill switch, tested against a real WireGuard server, and `vpn-check`              | Done         |
+| Run in a hardened container, behind a Docker socket proxy                               | Done         |
+| Documentation generated from code: the `stack.yaml` and CLI references, app facts       | Done         |
+| Link Sonarr and Radarr to qBittorrent: download clients, categories, root folders       | Done         |
+| Link Prowlarr to Sonarr and Radarr, with Byparr or FlareSolverr as its proxy            | Done         |
+| Set Jellyfin up before it is published, with its libraries; the arrs tell it of imports | Done         |
+| Wire the rest together (requests, Plex)                                                 | Planned      |
+| Detect manual changes and offer Re-apply or "Keep mine"                                 | Planned      |
+| Web panel with a setup wizard                                                           | Planned (M2) |
 
@@ -106,6 +108,7 @@ Mediaplane works like `terraform plan` and `apply`. `plan` validates `stack.yaml
 the host, renders the Compose project and diffs it against what is running. It shows you
-the changes and touches nothing in your stack, apart from two small marks that checking a
-key can leave in an app: a category in qBittorrent, and a failure in an app's own status
-of a client or link. The [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it)
-says more. `apply` does the same, then makes those changes.
+the changes and touches nothing in your stack, apart from small marks that checking a key
+or a password can leave in an app: a category in qBittorrent, a failure in an app's own
+status of a client, link or connection, and a sign-in in Jellyfin's activity log. The
+[threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
+`apply` does the same, then makes those changes.
 
@@ -120,3 +123,4 @@ mediaplane plan
   │  and asks the apps
-  │  changes nothing in the stack
+  │  changes nothing in the stack,
+  │  but for the small marks above
   ▼
@@ -128,6 +132,11 @@ mediaplane apply
   ├─ pulls images, starts the apps
+  │  (Jellyfin with no port, until
+  │  it is set up)
   ├─ waits until every app is healthy
+  ├─ sets Jellyfin up, then
+  │  publishes it
   ├─ wires the apps through their
   │  APIs: the shared login, the
-  │  download path and indexers
+  │  download path, indexers and
+  │  the media server
   ├─ plans again: nothing left to do
@@ -136,3 +145,3 @@ mediaplane apply
 
-Next, `apply` will wire the rest of the apps through the same APIs (Slices 5 to 7).
+Next, `apply` will wire the rest of the apps through the same APIs (Slices 6 and 7).
 
@@ -159,3 +168,4 @@ A few principles hold throughout:
 Most of this is real output from a run on an arm64 VM, trimmed where marked. The wiring
-lines came later, from a run of the same stack with Slice 4. The stack is
+lines, the first-run setup's and the last apply's came later, from a run of the same
+stack with Slice 5. The stack is
 the example above without the VPN, which is why `plan` warns about qBittorrent, and with
@@ -189,3 +199,8 @@ Containers:
 Secrets to generate: admin.password, prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey, seerr.apiKey, sonarr.apiKey
+First-run setup:
+  + jellyfin (with no port published until it is done)
 Wiring:
+  > after start jellyfin.admin
+  > after start jellyfin.library_movies
+  > after start jellyfin.library_shows
   > after start qbittorrent.admin
@@ -197,2 +212,3 @@ Wiring:
   > after start radarr.root_folder
+  > after start radarr.connection_jellyfin
   > after start sonarr.admin
@@ -200,2 +216,3 @@ Wiring:
   > after start sonarr.root_folder
+  > after start sonarr.connection_jellyfin
   > after start prowlarr.admin
@@ -204,3 +221,3 @@ Wiring:
   > after start prowlarr.indexer_proxy
-Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 14 wiring checks after the start.
+Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 1 app to set up, 19 wiring checks after the start.
 
@@ -214,4 +231,9 @@ Pulling images (the first time can take several minutes)…
 Starting containers and waiting until every app is healthy…
-  done    containers: every app is running and healthy
+  done    containers: every app is running and healthy; started jellyfin without its ports, to set it up first
+Finishing first-run setup before publishing the web UIs…
+  done    first-run setup: set up jellyfin and saved jellyfin.apiKey; published jellyfin
 Wiring the apps…
+  done    wiring jellyfin.admin: adopted
+  done    wiring jellyfin.library_movies: created
+  done    wiring jellyfin.library_shows: created
   done    wiring qbittorrent.admin: adopted
@@ -223,2 +245,3 @@ Wiring the apps…
   done    wiring radarr.root_folder: created
+  done    wiring radarr.connection_jellyfin: created
   done    wiring sonarr.admin: created
@@ -226,2 +249,3 @@ Wiring the apps…
   done    wiring sonarr.root_folder: created
+  done    wiring sonarr.connection_jellyfin: created
   done    wiring prowlarr.admin: created
@@ -230,6 +254,6 @@ Wiring the apps…
   done    wiring prowlarr.indexer_proxy: created
-  done    wiring: qbittorrent.admin adopted; qbittorrent.preferences adopted; … prowlarr.indexer_proxy created
+  done    wiring: jellyfin.admin adopted; jellyfin.library_movies created; … prowlarr.indexer_proxy created
   done    verify: no changes remain
 
-Apply complete. Change record: 20261010T031836Z-17560c95
+Apply complete. Change record: 20261015T182931Z-ed479e70
 
@@ -249,3 +273,3 @@ seerr        running  healthy
 sonarr       running  healthy
-Last apply: 2026-10-10T03:18:36.677Z, success (20261010T031836Z-17560c95)
+Last apply: 2026-10-15T18:29:31.294Z, success (20261015T182931Z-ed479e70)
 
@@ -256,3 +280,3 @@ Admin login for the apps:
 
-Jellyfin     http://127.0.0.1:8096  (its login arrives in Slice 5)
+Jellyfin     http://127.0.0.1:8096
 Prowlarr     http://127.0.0.1:9696
@@ -285,8 +309,11 @@ Then follow [`deploy/README.md`](deploy/README.md) to start it and run
 - the secrets it would generate;
+- the first-run setup it would finish, under `First-run setup:`: Jellyfin's, with no
+  port published until it is done;
 - the wiring it would do in the apps, under `Wiring:`, such as setting the admin login or
   adding a download client. qBittorrent's login and settings show as `adopt` on a first
-  `apply`: its file from before its first start set them already.
+  `apply`: its file from before its first start set them already, as Jellyfin's
+  first-run setup sets its admin.
 
-It changes nothing in your stack, apart from two small marks that checking a key can
-leave in an app, which the
+It changes nothing in your stack, apart from small marks that checking a key or a
+password can leave in an app, which the
 [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) names. You
@@ -336,4 +363,4 @@ pnpm --silent mediaplane credentials --home .mediaplane-dev
 This starts real containers on this machine, with the web UIs on `localhost`. The last
-command shows the admin login, which qBittorrent, Sonarr, Radarr and Prowlarr use, and
-each app's address.
+command shows the admin login, which qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin
+use, and each app's address.
 The first `apply` downloads several GB of images, so it can take a while. To remove the
@@ -373,5 +400,6 @@ So Mediaplane isn't instead of a pipeline. It is built to run inside one:
 The pipeline decides what the stack is, and Mediaplane does the stateful part. Today
-that covers generating the keys, deploying, setting the shared login in the apps,
-linking Sonarr and Radarr to qBittorrent and Prowlarr to them, and checking. The rest of
-the wiring and change detection are what is being built next.
+that covers generating the keys, deploying, setting Jellyfin up and taking the key it
+makes, setting the shared login in the apps, linking Sonarr and Radarr to qBittorrent and
+Jellyfin and Prowlarr to them, and checking. The rest of the wiring and change detection
+are what is being built next.
 
@@ -391,2 +419,4 @@ and keep. What it adds is everything around the file:
 - Prowlarr linked to Sonarr and Radarr, with a Cloudflare solver as its indexer proxy;
+- Jellyfin set up before anyone else can reach it, with its libraries, and told of each
+  import by Sonarr and Radarr;
 - next, the rest of the wiring between the apps.
@@ -399,5 +429,5 @@ secrets, a socket proxy, a tested VPN kill switch, and a private wiring network.
 the apps to each other, with `plan` and `apply` and a history of what it did, and leaves
-the rest of each app's settings to you. Today it sets the shared login, links Sonarr
-and Radarr to qBittorrent, and Prowlarr to them; the media servers and Seerr come in
-Slices 5 to 7.
+the rest of each app's settings to you. Today it sets the shared login, sets Jellyfin
+up, links Sonarr and Radarr to qBittorrent and Jellyfin, and Prowlarr to them; Seerr and
+Plex come in Slices 6 and 7.
 
@@ -448,6 +478,6 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   (packaging), S3a (the shared admin and pre-start files), S3d (the VPN's kill-switch
-  test and `vpn-check`), S3b (the wiring framework), S3c (the download path) and S4
-  (indexers).
-- **Next:** S5 (Jellyfin).
-- **After that:** S6 to S9: requests, Plex, drift detection, and the release.
+  test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
+  (indexers) and S5 (Jellyfin).
+- **Next:** S6 (requests).
+- **After that:** S7 to S9: Plex, drift detection, and the release.
 
@@ -473,4 +503,4 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **[Runbook: wiring failed](docs/runbooks/wiring-failed.md):** an app refused Mediaplane's
-  key or a change, an arr can't reach qBittorrent, Prowlarr can't make its proxy, or
-  Mediaplane can't reach an app.
+  key or a change, Jellyfin's first-run setup failed, an arr can't reach qBittorrent or
+  Jellyfin, Prowlarr can't make its proxy, or Mediaplane can't reach an app.
 - **[Threat model](docs/security/threat-model.md):** what is protected, how, and what
```

**Change** `catalog/jellyfin/README.md`:

```diff
diff --git a/catalog/jellyfin/README.md b/catalog/jellyfin/README.md
index 2bd99cb..b8925cc 100644
--- a/catalog/jellyfin/README.md
+++ b/catalog/jellyfin/README.md
@@ -28,7 +28,50 @@ upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.
 - **It runs Jellyfin** whenever `media_server` is `jellyfin`, listed under `apps` or not,
-  with your data folder at `/data`. It publishes its web UI as `network.bind` says.
+  with your data folder at `/data`.
+- **It sets Jellyfin up before anyone else can reach it.** Jellyfin's startup wizard
+  answers whoever reaches it first, and whoever finishes it owns the server. So on its
+  first start, Jellyfin has no published port. `apply` finishes the wizard over the
+  stack's private wiring network, as the shared admin (`mediaplane credentials` shows the
+  login), signs in, makes an API key named `Mediaplane`, keeps it in
+  `state/secrets.json` at once, and signs out. Only then does it start Jellyfin again,
+  with its web UI published as `network.bind` says.
+
+  ```text
+  up: Jellyfin, no port
+    │
+    ▼
+  over the wiring network:
+  the wizard, as the shared
+  admin; sign in; the key,
+  kept at once; sign out
+    │
+    ▼
+  up again: Jellyfin
+  published
+  ```
+
+  `plan` lists it under `First-run setup:`, and never runs it. A Jellyfin whose wizard is
+  done, as its `system.xml` says, is never unpublished again.
+
+- **The shared admin** (`jellyfin.admin`) is the user the wizard made, named as
+  `admin.username`. A change of `admin.username` or `admin.password` reaches it through
+  Jellyfin's API. `plan` and `apply` check its password by signing in and out again,
+  which Jellyfin's activity log records, as it records any sign-in. Jellyfin doesn't
+  lock its admin out after failed sign-ins.
+- **Two libraries:** `Movies` (`jellyfin.library_movies`), of films, in
+  `/data/media/movies`, and `Shows` (`jellyfin.library_shows`), of shows, in
+  `/data/media/tv`: the folders Radarr and Sonarr file into. `apply` makes each folder
+  first, as the stack's `user:`, in a throwaway Jellyfin container. A new library gets
+  the options Jellyfin's own web UI gives one: the metadata and image downloaders that
+  Jellyfin turns on by default, and new files picked up as they come. Its other settings
+  are yours.
+- **Sonarr and Radarr tell it of imports.** With them in the stack, each gets a
+  connection to Jellyfin, `Jellyfin (Mediaplane)`, which has Jellyfin update its library
+  when a file is imported, upgraded, renamed or deleted (see
+  [Sonarr's](../sonarr/README.md) and [Radarr's](../radarr/README.md) READMEs).
+- **A health check that waits for the server.** In the first seconds of every start,
+  Jellyfin's `/health` answers `Degraded` while the server itself answers 503 to
+  everything else, so the check passes only on `Healthy`. Its start period is 120
+  seconds: failed checks don't count then, and the first that passes marks Jellyfin
+  healthy.
 - **Listing Plex as well** is an error, unless Plex says `enabled: false`.
-- **A longer start-up allowance.** Its health check has a start period of 120 seconds.
-  During it, failed checks don't count towards the retries, and the first check that
-  passes marks Jellyfin healthy.
 
@@ -36,7 +79,5 @@ upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.
 
-- **Slice 5:**
-  - first-run setup through Jellyfin's own API, with no port published until it is done;
-  - its API key, stored in `state/secrets.json`;
-  - the Movies and Shows libraries;
-  - the connections from Sonarr and Radarr.
+- **Slice 6:** Seerr's link to Jellyfin, signing in as its admin.
+- **Slice 8:** drift: reporting a setting changed by hand, rather than putting it back,
+  and Keep mine.
 
@@ -51,2 +92,7 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
+- **The `Movies` and `Shows` libraries' names, what they hold and their folders** are
+  Mediaplane's. A folder you add to one, or one of them you remove, is put back by the
+  next `apply` (Slice 8 adds Keep mine). Add a library of your own instead. A library you
+  rename is no longer Mediaplane's: the next `apply` makes `Movies` or `Shows` again.
+  Everything else in them, such as their metadata language, is yours.
 - **Anything else** goes in `compose.override.yaml` in the Mediaplane home. For example,
@@ -61,6 +107,25 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
+  A port you publish there is held back too while the wizard is open.
+
 ## Known issues
 
-- **The setup wizard is open.** Until Slice 5, Jellyfin's first-run wizard is open to
-  whoever reaches its port first. Finish it yourself as soon as `apply` is done, or keep
-  `network.bind: localhost` until you have.
+- **A wizard finished by hand, before Slice 5.** `apply` can't sign in as the shared
+  admin, so it can't make a key, and stops with
+  `refused the shared admin's sign-in: its startup wizard was finished with another login`.
+  Jellyfin stays published, and until then, `apply` wires no app. Set `admin.username`,
+  and `admin.password` to a file of your own, to Jellyfin's admin login, and apply again:
+  the other apps take that login too. A library of yours named Movies or Shows then
+  becomes Mediaplane's: `plan` shows its folders changing, so rename it first to keep it.
+  Or start Jellyfin afresh: stop Jellyfin first (`docker stop mediaplane-jellyfin-1`),
+  then remove `appdata/jellyfin`, then run `apply`. That loses its database and settings,
+  but not your media.
+- **Its key deleted in Jellyfin's dashboard** (API Keys). `plan` warns that Jellyfin
+  refuses Mediaplane's API key. Remove the `jellyfin` entry under `apps` from
+  `state/secrets.json`, keeping the file valid JSON, and apply: Mediaplane signs in as the
+  admin, makes a new key, and gives it to Sonarr and Radarr. Slice 8 does this for you.
+  The [wiring failed runbook](../../docs/runbooks/wiring-failed.md) has the details.
+- **Its `appdata/` emptied by hand.** Jellyfin starts its wizard again. Stop Jellyfin
+  first (`docker stop mediaplane-jellyfin-1`), then remove `appdata/jellyfin`, then run
+  `apply`: it sees in `system.xml` that the wizard is open, starts Jellyfin unpublished,
+  and sets it up again, with a new key. A Jellyfin still running, or started again
+  outside `apply`, with its appdata emptied, comes up published with its wizard open.
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 45d8109..65e5f14 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -70,2 +70,14 @@ LinuxServer.io image, unmodified.
   `<name> (Prowlarr)`, and keeps them in step: change them in Prowlarr, not here.
+- **Its connection to Jellyfin** (`sonarr.connection_jellyfin`), with Jellyfin as the
+  media server. Once Jellyfin's admin is in place, `apply` adds `Jellyfin (Mediaplane)`,
+  an Emby / Jellyfin connection, to Sonarr:
+  - its host is `jellyfin`, at Jellyfin's own port, and it has Jellyfin update its
+    library ("Update library");
+  - it is made with the events on that change a file: an episode imported, upgraded or
+    renamed, or a series or an episode's file deleted. Which events it has after that is yours;
+  - its key is Jellyfin's, which Sonarr shows masked. `plan` and `apply` check it with
+    Sonarr's own test of the connection: a refused key is set again, and any other
+    failure is Sonarr's own message, such as Jellyfin out of its reach. A test that
+    fails records a failure in Sonarr's status of the connection, as a test from its
+    web UI does, and a later pass resets it.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -75,5 +87,4 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 5 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 6 and 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 5:** the Jellyfin connection that refreshes your library on import.
 - **Slice 6:** Seerr's link to it.
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index a8ac5e6..4a54e9f 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -70,2 +70,14 @@ LinuxServer.io image, unmodified.
   `<name> (Prowlarr)`, and keeps them in step: change them in Prowlarr, not here.
+- **Its connection to Jellyfin** (`radarr.connection_jellyfin`), with Jellyfin as the
+  media server. Once Jellyfin's admin is in place, `apply` adds `Jellyfin (Mediaplane)`,
+  an Emby / Jellyfin connection, to Radarr:
+  - its host is `jellyfin`, at Jellyfin's own port, and it has Jellyfin update its
+    library ("Update library");
+  - it is made with the events on that change a file: a film imported, upgraded or
+    renamed, or a film or its file deleted. Which events it has after that is yours;
+  - its key is Jellyfin's, which Radarr shows masked. `plan` and `apply` check it with
+    Radarr's own test of the connection: a refused key is set again, and any other
+    failure is Radarr's own message, such as Jellyfin out of its reach. A test that
+    fails records a failure in Radarr's status of the connection, as a test from its
+    web UI does, and a later pass resets it.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -75,5 +87,4 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 5 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slices 6 and 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 5:** the Jellyfin connection that refreshes your library on import.
 - **Slice 6:** Seerr's link to it.
```

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index 00f5de7..c679157 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -13,9 +13,10 @@ never touch Mediaplane itself.
 
-> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent, and Prowlarr to
-> them, but the media server and Seerr are not wired yet (Slices 5 to 7 do that). On a
-> home network, `init` suggests publishing their web UIs on your LAN. Until the wiring
-> lands, Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until
-> you complete them, so complete them first.
+> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent and Jellyfin, and
+> Prowlarr to them, but Seerr is not wired yet (Slice 6 does that, Slice 7 with Plex). On
+> a home network, `init` suggests publishing the web UIs on your LAN. Until then, Seerr's
+> setup is open to anyone on your LAN until you complete it, so complete it first.
+> Jellyfin's startup wizard is never published while it is open: Mediaplane finishes it
+> first.
 >
-> qBittorrent, Sonarr, Radarr and Prowlarr have the shared admin login:
+> qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin have the shared admin login:
 > `mediaplane credentials` shows it. To keep the web UIs on this machine only, answer
@@ -142,5 +143,4 @@ nothing. Without a terminal it asks nothing: pass the flags in the
 
-  Until the wiring lands (Slices 5 and 6, and Slice 7 with Plex), Jellyfin's setup wizard
-  and Seerr's setup are open to anyone on your LAN until you complete them. Complete them
-  right after the first `apply`.
+  Until Slice 6 (Slice 7 with Plex), Seerr's setup is open to anyone on your LAN until
+  you complete it. Complete it right after the first `apply`.
 
@@ -151,5 +151,6 @@ nothing. Without a terminal it asks nothing: pass the flags in the
   password of your own only with `--reveal`, and its `--json` output leaves out either
-  unless you add `--reveal`. qBittorrent, Sonarr, Radarr and Prowlarr use it.
-  qBittorrent gets it before its first start. `apply` sets it in all four through their
-  API once they run, and sets it again whenever it changes.
+  unless you add `--reveal`. qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin use it.
+  qBittorrent gets it before its first start, and Jellyfin in its first-run setup.
+  `apply` sets it in all five through their API once they run, and sets it again
+  whenever it changes.
   - Removing your own `admin.password` brings back the password Mediaplane generated
```

**Change** `CONTRIBUTING.md`:

```diff
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
index 66bfb24..cced26a 100644
--- a/CONTRIBUTING.md
+++ b/CONTRIBUTING.md
@@ -51,2 +51,6 @@ through Gluetun, runs a WireGuard server too, so it needs the module as well.
 
+The Jellyfin test (`test/e2e/jellyfin.e2e.test.ts`) shows Jellyfin set up before its
+port is published, its libraries, and Sonarr's and Radarr's connections to it, each put
+back after a change by hand. It needs no outside account.
+
 The indexers test (`test/e2e/indexers.e2e.test.ts`) serves made-up indexers of its own,
```

- [ ] **Step 7: The spec and the roadmap**

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 1dd37d4..779af83 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -542,3 +542,3 @@ in `compose.override.yaml` is therefore wired automatically.
 | `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file. It also checks the home first, creates the data folder, adds a note before each question, and takes the WireGuard key on a hidden prompt (§11, Slice 3b) |
-| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key check can leave a mark in an app: §11, Slices 3c and 4); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
+| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4 and 5); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
 | `apply` | Converge on `stack.yaml` (§5) |
@@ -1355 +1355,85 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   S6 requests, S7 Plex, S8 drift and S9 release. The roadmap keeps the history.
+
+### Slice 5: Jellyfin (2026-10-15)
+
+- **Bootstrap before publish** (§5 steps 8 and 9, §6.4). An app whose first-run setup
+  anyone who reaches it could finish declares it in the catalog (`bootstrap`), with the
+  file in its appdata that says it is done.
+  - **Which apps, and when.** `plan` lists an app to set up when its key isn't stored, or
+    its appdata doesn't say its setup is done (Jellyfin's `system.xml`,
+    `IsStartupWizardCompleted`), under `First-run setup:` (`bootstrap` in `--json`). It
+    starts without its ports unless its appdata says the setup is done: then nobody can
+    claim it, and apply only signs in to make its key. A file Mediaplane can't read says
+    nothing, so the stored key decides. `plan` never runs a setup; it shows the app's
+    container recreated when it runs published, and checks its wiring after the start.
+  - **No published port.** The start step gives Compose one more file, on its standard
+    input, after `compose.override.yaml`, that sets the app's `ports` to `!reset []`
+    (Compose 2.24 and later, the floor preflight checks), so the override's ports go too.
+    `compose.yaml` itself always holds the ports, so the stack runs as written without
+    Mediaplane.
+  - **The bootstrap step** is a new step, after `start`, run only when `plan` lists a
+    setup. It reaches the app over the wiring network without a key, finishes its setup
+    as the shared admin, and keeps the key it makes in `state/secrets.json` at once (§5
+    step 4). Then it steps off the wiring network, as the start step does (Slice 3b, ADR
+    0011), and runs `up` again without that file, and Compose recreates the app with its
+    ports. §5 step 9's and §6.4's "re-render with ports" is this second `up` of
+    `compose.yaml` as written: nothing is rendered twice. An app whose setup failed while
+    it is still open stays unpublished; one whose setup is done is published even when
+    making its key failed.
+  - **No new Docker API call:** `up`, and a recreate, are what `apply` already does, and
+    the file goes on Compose's standard input (§7.2(2)).
+- **Jellyfin's setup** (§6.1), as Jellyfin 12.2 takes it: `GET /Startup/User` first,
+  which makes its first user (`POST /Startup/User` before it is refused, and a
+  `POST /Startup/Complete` without a user leaves a Jellyfin nobody can sign in to); then
+  `POST /Startup/User` with the shared admin (a 403 says a password is set already, from
+  a setup that stopped before it was done); then `AuthenticateByName`, which Jellyfin
+  takes before the wizard is completed, then `POST /Startup/Complete`. A first user the
+  shared admin can't sign in as isn't Mediaplane's: the wizard is left open, and the step
+  fails. The key is the newest named `Mediaplane` in `GET /Auth/Keys`, which lists keys
+  in full, else one made with `POST /Auth/Keys?app=Mediaplane`, which answers nothing,
+  read back from the list; then the session is signed out of. Every call carries
+  Jellyfin's client fields in `Authorization: MediaBrowser …`, with `Token="…"` once
+  there is a key: a sign-in without all four fields is refused (400).
+- **Jellyfin's health check** passes only once `/health` answers `Healthy`. At every
+  start, it answers 200 `Degraded` for a few seconds while the rest answers 503, then
+  Jellyfin restarts its server (probed).
+- **Jellyfin's resources** (§6.2):
+  - `jellyfin.admin`, the shared admin: known by the id `state/resources.json` records,
+    else by the admin's user name, so an integration's `observe` now sees what the stack
+    wants. Its password is checked by signing in and out again, which Jellyfin's
+    activity log records, as it does any sign-in: a third small mark `plan` can leave in
+    an app (§5.2). Jellyfin doesn't lock its admin out after failed sign-ins (none after
+    seven, probed). It is renamed, or given its password, with the key; Mediaplane makes
+    no other user.
+  - `jellyfin.library_movies` and `jellyfin.library_shows`: `Movies` (`movies`,
+    `/data/media/movies`) and `Shows` (`tvshows`, `/data/media/tv`), with §6.2's fields,
+    `paths` kept as one sorted list. They are named as §6.2 names them, without
+    "(Mediaplane)": they are what you browse. Each is known by its name: Jellyfin's id
+    for a library follows its folder, which a rename changes. Its folder is made first,
+    in a throwaway Jellyfin container. Jellyfin names a second library of one name
+    `<name>2`, so one is made only when none has the name, and it can't change what a
+    library holds, which an update refuses with what to do. A new library gets the
+    options Jellyfin's web UI gives one: its default metadata and image downloaders,
+    from `/Libraries/AvailableOptions`, internet metadata and real-time monitoring. A
+    library made without them still gets its metadata, but doesn't watch its folders.
+- **Sonarr's and Radarr's connection to Jellyfin** (§6.2): `<arr>.connection_jellyfin`,
+  an Emby / Jellyfin connection (`MediaBrowser`) named `Jellyfin (Mediaplane)`, with
+  host `jellyfin`, Jellyfin's container port and `updateLibrary`. `apiKey` is its secret,
+  checked with the arr's own `POST /notification/test`: a failure that names `ApiKey` is
+  an update. It is made with the triggers on that change a file: an import, an upgrade, a
+  rename, and the deletes; they stay the user's after that. The arr tests a new
+  connection with a trigger on as it saves it, `forceSave` or not; an update with
+  `forceSave` isn't tested. A test that fails records a failure in the arr's status of
+  the connection (`NotificationStatus`), and a later pass resets it, as for the download
+  client and Prowlarr's links (probed). Each requires `jellyfin.admin`, and the arrs come
+  `after` Jellyfin: while Jellyfin is to be set up, or refuses its key, `plan` leaves the
+  connection's key unchecked.
+- **The typed HTTP client** (§3.2) gains Jellyfin's ways: the `mediabrowser` key scheme,
+  a sign-in with a JSON body that takes 401 as its answer, a POST or DELETE whose answer
+  isn't read, and the same app with another key (a session's).
+- **One helper for an app's address** (`serviceAddress`): its service, or the service
+  whose network it runs in, and its container port. The download client, Prowlarr's
+  links and proxy, and the connection all use it.
+- **Jellyfin's key, deleted by hand,** shuts Mediaplane out of Jellyfin, and `plan` says
+  so. Removing it from `state/secrets.json` has the next `apply` sign in, make a new one,
+  and give it to the arrs' connections; Slice 8 automates that, with key recovery.
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index fcc5571..7d5b5d8 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -22,2 +22,3 @@ Detailed plans so far:
 - Slice 4: [`m1-s4-indexers.md`](m1-s4-indexers.md) (done).
+- Slice 5: [`m1-s5-jellyfin.md`](m1-s5-jellyfin.md) (done).
 
@@ -25,5 +26,5 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c and S4.
-- **Next:** S5 (Jellyfin).
-- **After that:** S6 to S9.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4 and S5.
+- **Next:** S6 (requests).
+- **After that:** S7 to S9.
 
@@ -144,2 +145,3 @@ each one, or corrects it in the catalog:
 | Seerr running as uid 1000 with `init: true`. **Verified on 2026-10-09** by `test/e2e/apply.e2e.test.ts` and `test/e2e/deploy.e2e.test.ts`: Seerr, rendered with `init: true`, runs healthy after apply's ownership step gives its appdata to uid 1000 | S2b (done) |
+| Jellyfin's health check. **Corrected in S5 (2026-10-15):** `/health` answers 200 `Degraded` in the first seconds of every start, while the rest answers 503, so the check now passes only on `Healthy`. `test/e2e/jellyfin.e2e.test.ts` sets Jellyfin up once it is healthy, over the wiring network | S5 (done) |
 
@@ -181,3 +183,4 @@ item, five S8 items, an S9 item and an M2 item. Slice 4 (2026-10-15) added four
 and its final review an S5 item, two S8 items, a probe in two others, two S9 test gaps
-and an S9 docs item. Each slice plan must address the items for that slice.
+and an S9 docs item. Slice 5 (2026-10-15) added an S6 item and six S8 items, and
+extended one. Each slice plan must address the items for that slice.
 
@@ -365,3 +368,3 @@ password, which are S3c's (and listed again below).
 
-**S5:**
+**S5:** all of these are in the S5 plan.
 
@@ -369,3 +372,4 @@ password, which are S3c's (and listed again below).
   `/health` answers 200 with `Degraded` while the server still answers 503 to
-  everything else (S2c). Look at a check that waits for the server itself.
+  everything else (S2c). Look at a check that waits for the server itself. **Done in
+  S5:** the check passes only on `Healthy`, at every start, not only the first.
 - **Small gaps from S4, as S5 extends the fakes and providers** for Jellyfin's
@@ -383,2 +387,13 @@ password, which are S3c's (and listed again below).
     arr's admin fails.
+  - **Done in S5:** all five. The fakes take a provider without `enable` as off, and their
+    tests of another app read it without adding it; `secretOf` and `numberOf` live in
+    `servarr-provider.ts`; `serviceAddress` gives every app's address; and
+    `packages/cli/src/run.test.ts` applies a stack with Prowlarr.
+
+**S6:**
+
+- **Seerr signs in as Jellyfin's admin** (spec §6.1), which Jellyfin's first-run setup
+  makes, and `jellyfin.admin` keeps as the shared admin (S5). Seerr's sign-in should
+  `require` `jellyfin.admin`, and Seerr come `after` Jellyfin, so that a Jellyfin still to
+  be set up, or one whose key is refused, skips it rather than fails it.
 
@@ -468,6 +483,7 @@ password, which are S3c's (and listed again below).
 - **`plan`'s key checks can record a failing status in the app; drift runs them on a
-  schedule.** A failing test of a download client (S3c) or a Prowlarr link (S4) records
-  a failure in the app's status of it (`DownloadClientStatus`, `ApplicationStatus`),
-  as a test from its web UI does, and a later pass resets it (S4's probe). Decide
-  whether scheduled drift may do that.
+  schedule.** A failing test of a download client (S3c), a Prowlarr link (S4) or an
+  arr's connection to Jellyfin (S5) records a failure in the app's status of it
+  (`DownloadClientStatus`, `ApplicationStatus`, `NotificationStatus`), as a test from
+  its web UI does, and a later pass resets it (S4's and S5's probes). Decide whether
+  scheduled drift may do that.
   - First, probe the row under repeated failing checks. The apps may escalate it, and
@@ -482,2 +498,23 @@ password, which are S3c's (and listed again below).
   can't read.
+- **Jellyfin's key, deleted by hand,** shuts Mediaplane out of Jellyfin (S5): `plan`
+  warns, and the runbook has the key removed from `state/secrets.json` so that `apply`
+  signs in as the admin and makes another. Automate it, with key recovery: a key
+  Jellyfin refuses, while its wizard is done, is made anew, and the arrs' connections
+  take it.
+- **Checking Jellyfin's admin password signs in** (S5), and Jellyfin's activity log keeps
+  three lines for each check. Drift every 15 minutes (M2) would add about 300 a day.
+  Decide whether drift checks it less often.
+- **Jellyfin's libraries are known by name** (S5). A library renamed by hand is left
+  as it is, and the next `apply` makes `Movies` or `Shows` again, on the same folder, so
+  the folder is in two libraries. Decide whether drift reports the renamed one. A folder
+  added to them by hand is put back: Keep mine must cover `paths`.
+- **The triggers of an arr's connection to Jellyfin are the user's** after it is made
+  (S5): a connection whose triggers were all turned off by hand still passes its test,
+  and tells Jellyfin of nothing. Decide whether drift reports it.
+- **A Jellyfin whose appdata Mediaplane can't read** (S5) is taken as set up when its key
+  is stored, so an emptied appdata there would start it published. Decide whether
+  `plan` should warn when it can't read `system.xml`.
+- **A failed first-run setup stops all wiring** (S5): the bootstrap step's failure skips
+  the wire step, as a failed start does. Let the wire step run past a failed first-run
+  setup, with that app's resources failed so `requires` skips them (spec §5.1).
 
```

- [ ] **Step 8: Check the docs rules, and commit**

Every diagram must be at most 40 columns wide, and no public doc may name the planning
process (controller, ruling, decision numbers). Read each line this prints, by its
meaning: Jellyfin is Slice 5 and built; requests Slice 6, Plex Slice 7, drift Slice 8 and
release Slice 9:

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git diff -U0 -- docs README.md CONTRIBUTING.md catalog deploy | grep '^+' | grep -i -E 'controller|ruling|\bD[0-9]+\b'
git grep -n -E 'Slice 5|\bS5\b' -- . ':!docs/plans/m1-s1*' ':!docs/plans/m1-s2*' ':!docs/plans/m1-s3*' ':!docs/plans/m1-s4*' ':!docs/plans/m1-s5*'
```

Expected: the check passes (1578 tests), the first `grep` prints nothing, and every line
the second prints speaks of Slice 5 as built.

```bash
git add -A CONTRIBUTING.md README.md catalog deploy docs packages
git commit -m "docs: Jellyfin set up before its port is published, its libraries, and the arrs' connections" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Slice 5 completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.37% of statements, 93.27% of branches, 98.61% of functions and
  99.33% of lines, with 1578 tests in 80 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too (Task 5, Step 4),
  and leaves no `mediaplane-e2e-*` container or network, and no new volume or
  `mediaplane-e2e-*` folder. When this plan was replayed, alone on the dev box, warm:
  - with Compose 5.5.1, 8 files and 22 tests in 592 s (Slice 4's suite took
    400 s; the Jellyfin file alone takes about a minute);
  - with Compose 2.38.2, the same in 635 s (Slice 4's: 439 s).

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] The socket proxy's allow-list is unchanged: `git diff c35e04c --
  deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints nothing (decisions 1, 14).
  `c35e04c` is `main` after S4.
- [ ] Jellyfin is never published while its wizard is open: the Jellyfin e2e reads no
  port and an open wizard after the first `up`, and the port only once the wizard is
  done; the deploy and VPN e2e tests set it up from the image, behind the proxy.
- [ ] No secret shows: the tests that check it pass (Jellyfin's key and the admin password
  in neither `state/resources.json` nor `apply`'s result, the connection's key masked,
  `expectNoSecrets` over the CLI's output with Jellyfin's key in the store).
- [ ] `plan` never runs a first-run setup and never makes a key (Task 2's "names the
  setup in plan, and never runs it there"; the e2e's first `plan`). Its marks in the apps
  are the three the spec, the threat model and `plan --help` name.
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  but the project's own names (its GitHub repo and schema URL, its GHCR image) and the
  tests' fake `/srv/data/home` paths, all there before this slice.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B c35e04c.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 1 (an extra Compose file on standard input, rather than two renders), 2
    (`system.xml` decides, beside the key), 8 (`jellyfin.admin`, and the third mark its
    sign-in leaves in Jellyfin's activity log), 9 (the libraries' names, identity and
    options), 10 (the connection's triggers) and 13 (what the e2e shows);
  - that the e2e tests on Compose v2.38.2 and Docker 28 are confirmed by the slice PR's
    first CI run, on amd64 and arm64, as they were locally with Compose 2.38.2 on arm64;
  - for the owner's manual-steps list: a Jellyfin whose wizard was finished by hand needs
    `admin.username` and `admin.password` set to its login, or its appdata removed; a
    Jellyfin key deleted in its dashboard is made again by removing it from
    `state/secrets.json`; and the Movies and Shows libraries' folders are put back by the
    next `apply`.
