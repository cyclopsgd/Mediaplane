# M1 Slice 6: requests — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a fresh `apply` of the whole stack wires everything with no clicking (success
criterion 1): Seerr starts with no published port, signs in through Jellyfin as the shared
admin once Jellyfin is set up, and is published only then; it is linked to Jellyfin with
the Movies and Shows libraries enabled, and to Sonarr and Radarr with a quality profile,
their root folder and `isDefault`; then its setup is finished with `initialize`.

**Architecture:**

- **Seerr's first sign-in is a first-run setup**, run by S5's bootstrap step before Seerr
  is published, because Seerr's setup is open to anyone on its port until then. The step
  grows, generically: a setup that makes no key (Seerr's key is Mediaplane's, in
  `API_KEY`), setups run in the order of the apps' integrations, and a setup that can wait
  (`SetupWaiting`) without failing the step, so the wire step still runs.
- **The typed client** gains a sign-in whose session lives in a cookie (`session`), to
  sign out of Seerr at once.
- **Seerr in the catalog** (`catalog/seerr/`): its API, its setup (`bootstrap.ts`), an
  integration of four resources (`seerr.media_server`, `seerr.server_sonarr`,
  `seerr.server_radarr`, `seerr.setup`), and `notWiredYet`, so that on a Plex stack it
  stays as it is until Slice 7.
- **The integration contract** gains `resolve`, for what only the app can say: Seerr's
  quality profile, which only the arr knows it has.
- **The fakes** gain a fake Seerr, and the arrs' quality profiles, as the pinned images
  answer.
- **An end-to-end test of the whole stack** on real Docker shows Seerr set up before it
  is published, signed in as the shared admin, linked to Jellyfin and both arrs (Seerr's
  own test of each passing), a second `apply` with no changes, and three hand changes put
  back.

**Tech Stack:** as Slice 5 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3, success criterion 1 ("Seerr is connected to Jellyfin, Sonarr and Radarr"), and
  criterion 3 (a second `apply` changes nothing);
- §4.3 (Seerr's first sign-in is a `bootstrap-api` step), §5 steps 4, 8 and 9, §5.1, and
  §5.2 (`plan` changes nothing in the stack, but for its documented marks);
- §6.1, Seerr's row and key recovery (`main.apiKey` from `settings.json`); §6.2, the
  Seerr row, the ordering and the default profile; §6.3 (secrets verified, never
  compared; identity by id, else by name); §6.4 (bootstrap before publish); §6.5 (Seerr
  ≥ 3.5.0);
- §7.2(2) (the socket proxy), §8.1(3), §9 (the documentation set), §10 (Seerr's risks),
  §11.

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S6 row ("The Seerr first
sign-in through the Jellyfin admin, libraries, the Sonarr/Radarr servers, initialize, and
the full-stack end-to-end test"; it proves success criterion 1), the S6 item in "Inputs
for later slices from the reviews" (Seerr's sign-in `requires` `jellyfin.admin`, and Seerr
comes `after` Jellyfin), and the S7 item about Seerr's `comingIn` on a Plex stack.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`), with one line of context. It
  is exact: save it to a file and run `git apply <file>` from the repo root, or make the
  same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact or a
  schema description says to run `pnpm docs:generate`, and names what it rewrites.
- Every block was applied in order to a fresh worktree at `6c72fa3`, and each task's
  tests failed before its implementation and passed after it (see the completion
  checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a, 3d, 3b, 3c, 4 and 5 Global Constraints still
holds (`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`, `m1-s3d-vpn-check.md`,
`m1-s3b-wiring.md`, `m1-s3c-download-path.md`, `m1-s4-indexers.md`, `m1-s5-jellyfin.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-admin-password`. Addresses in tests and docs come from the
  documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), private
  ranges, or `fd00::/8`;
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
- the integration contract (S3b, S3c, S5): `observe`, `create`, `update`, `requires`,
  `after` and `verify`; resource records hold names only; a resource that requires a
  failed or skipped one is `skipped`; a resource may `require` another app's only when
  that app comes before it through `after` (the catalog invariant test);
- the shared Servarr provider (`catalog/_shared/servarr-provider.ts`, S4) stays the one way
  to wire a Servarr provider; Seerr's servers are Seerr's settings, not Servarr providers;
- bootstrap before publish (S5): `plan` never runs a setup; an app whose setup is open
  is never published; the re-check before publishing stays;
- never push.

The spec's exact values for this slice, verbatim:

- §6.1, Seerr: "Generated, set through `API_KEY`"; "The key does nothing until a first
  user exists. Mediaplane signs in with `POST /api/v1/auth/jellyfin` as the Jellyfin
  admin it created, or with `POST /api/v1/auth/plex` and the user's token. It then
  configures Seerr through `/api/v1/settings/*` and finishes with
  `POST /api/v1/settings/initialize`"; "One media-server type per instance. `hostname` is
  never re-sent once the media server is configured, because doing so returns 500".
- §6.1, key recovery: "`main.apiKey` from Seerr's `settings.json`".
- §6.2: "Seerr → media server, Sonarr, Radarr | Media-server link with libraries enabled;
  Sonarr and Radarr servers with a default profile, root folder and `isDefault` |
  hostname, port, apiKey, activeProfile, activeDirectory, enabled libraries |
  `POST /api/v1/settings/sonarr/test`, `POST /api/v1/settings/radarr/test`"; "The `after`
  relationships give this order: qBittorrent and Jellyfin/Plex, then Sonarr and Radarr,
  then Prowlarr, then Seerr"; "Seerr's default profile is the first match from a
  preference list (`HD-1080p`, then `Any`), or else the first profile.
  `apps.seerr.sonarr_profile` and `apps.seerr.radarr_profile` override it."
- §6.3: "Secrets are verified, never compared."
- §6.4: "These start first with **no published ports**. Mediaplane completes setup over
  the internal Docker network, then re-renders with ports and recreates the container."
- §6.5: Seerr's floor is 3.5.0 ("Shape of the settings and library API"); the pin is
  `v3.5.0`.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records,
  `state/resources.json`, logs, human or JSON output, command lines, container
  environments, `docker inspect` or the public CI log. This slice adds:
  - **Seerr's key**, generated, in `API_KEY`, among the secrets every client redacts;
  - **the arrs' keys in Seerr**, sent in request bodies, which Seerr shows in clear:
    read back only to hand to Seerr's own test, never compared, kept or shown;
  - **Jellyfin's keys in Seerr**: the one Seerr makes itself, which Mediaplane reads in
    Seerr's answer and leaves there, and Mediaplane's, given only when Seerr's is
    refused;
  - **the admin password**, sent to Seerr only in its first sign-in, and never to a Seerr
    that is set up already;
  - **Seerr's session cookie**, kept out of every message, used only to sign out at once,
    never kept;
  - end-to-end failure messages show only statuses, lengths, yes-or-no checks, or an
    arr's `propertyName: errorMessage` list with every stored secret replaced (`getJson`,
    `jsonBody`, `servarrFailure`): never an app's body, and never a compared key.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and
  `deploy/deploy.test.ts` don't change.
- **`plan` never runs Seerr's first sign-in, and never sends `initialize`.**
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. This slice adds no Compose
  flag and no Docker call.
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
- **No renumbering.** Plex's `login.comingIn` stays `Slice 7`, and so does Seerr's on a
  Plex stack.

## Decisions taken in this plan

The spec, the roadmap and the reviews leave these open. Each is marked `Decision:` where
it is applied. The ones to look at first are marked **(check)**. Every fact about an app
below was probed on the pinned images (Seerr 3.5.0, `ghcr.io/seerr-team/seerr:v3.5.0`;
Jellyfin 12.2.0, `12.2ubu2604-ls53`, set up by S5's `apply`; Sonarr 4.0.20; Radarr 6.4.4)
on real Docker (29.8, Compose 5.5.1, aarch64) while writing this plan, unless it says it
was read from Seerr's own code in the image (`/app/server`).

1. **(check) Seerr's first sign-in is a first-run setup, not a wired resource** (Tasks 2,
   3; §4.3, §6.1, §6.4). Probed, before its first sign-in:
   - Seerr's API answers its public settings to anyone
     (`GET /api/v1/settings/public`: `initialized: false`, `mediaServerType: 4`, "not
     configured"), and refuses everything else: without a key, 401
     (`cookie 'connect.sid' required`, its request validator); with its key, 403 ("You do
     not have permission to access this endpoint"). The key does nothing until a first
     user exists, as §6.1 says.
   - `POST /api/v1/auth/jellyfin`, from the published port, with a `hostname` of the
     caller's choosing, made the Jellyfin admin who signed in Seerr's admin (`id: 1`,
     `permissions: 2`). Seerr's code takes any hostname there while no media server is
     set, so anyone who reaches Seerr's port before Mediaplane can sign in through a
     Jellyfin of their own and own it. Its Plex sign-in is open the same way (code).

   So §6.4's "apps that have anonymous first-run endpoints" includes Seerr: it starts with
   no published port, and S5's bootstrap step signs it in before publishing it. §4.3
   already lists Seerr's first sign-in as a `bootstrap-api` step. A wired resource would
   run after the publishing `up`, with the setup open on the LAN meanwhile. The roadmap's
   S6 item asks that the sign-in `require` `jellyfin.admin`, so that a Jellyfin still to
   be set up, or refusing its key, skips Seerr rather than fails it. A setup runs before
   the wire step, so it can't require a resource: decision 3 gives the same effect, and
   `seerr.media_server` does require `jellyfin.admin` (decision 8). Seerr's sign-in needs
   the admin's password, not Jellyfin's key: a Jellyfin that refuses Mediaplane's key
   doesn't stop it.
2. **(check) A setup that makes no key** (Task 2). Seerr's key is Mediaplane's
   (`API_KEY`), generated before Seerr first starts, so S5's rule, "set up while its key
   isn't stored", can't apply: `Bootstrap.secret` becomes optional. A setup without one
   is to do while its `done` file doesn't say it is done (Seerr's `settings.json`, whose
   `main.mediaServerType` is 1 to 3 once a media server is set). Probed: Seerr writes
   `settings.json` with a one-space indent, `"mediaServerType": 4` at its first start and
   `2` as the first sign-in sets Jellyfin; `appdata/seerr` is 1000:1000 (0775), the file
   0644, so Mediaplane's user reads it, through `appdata/` (0700). A file Mediaplane
   can't read says nothing, and no key can decide, so the app starts unpublished and is
   set up again on every `apply`, with `bootstrap.unreadable`; its setup then finds Seerr
   set up and only checks it (decision 4). That fails safe, at the cost of two recreates
   per `apply` while the file stays unreadable (roadmap S8 item).
3. **(check) Setups in order, and a setup that waits** (Task 2; the roadmap's S6 item).
   - The bootstrap step sets the apps up in the order of their integrations' `after`
     (`wiringOrder`), so Jellyfin's wizard is finished before Seerr signs in through it.
   - A setup may throw `SetupWaiting`: another app it goes through isn't ready for it.
     Seerr's does when Jellyfin refuses the shared admin's password (decision 4). A setup
     after an app whose own setup failed or waits waits too, without being run.
   - A setup that waits leaves its app as it was, unpublished, and doesn't fail the step:
     the step warns (`bootstrap.waiting`), the wire step runs, skipping that app's
     resources (and what requires them), and verify fails, listing the setup left to do
     (`seerr (first-run setup)`). A failed setup still fails the step and skips the wire
     step, as in S5.
   - Why the wire step must run: a stack whose `admin.password` changed, with a new
     Seerr, has Seerr's sign-in refused by Jellyfin until `jellyfin.admin` sets the new
     password, which only the wire step does. Failing the step there would skip the wire
     step on every `apply`. Waiting lets it set the password, and the next `apply` signs
     Seerr in (Task 4's CLI test runs exactly this).
4. **Seerr's setup, step by step** (Task 3; §6.1). Probed:
   - a wrong or empty password answers 401 `{"message":"INVALID_CREDENTIALS"}`, with no
     cookie; a hostname Seerr can't reach, 404 `INVALID_URL`;
   - the right one answers 200, the user, and `Set-Cookie: connect.sid=…` (30 days). Seerr
     then made itself a Jellyfin key named `Seerr` (Jellyfin's `GET /Auth/Keys`), keeps
     it in its Jellyfin settings, and leaves Jellyfin a device `Seerr` (`BOT_seerr`);
   - after that: the same sign-in with a `hostname` is 500
     (`Jellyfin hostname already configured`: §6.1's "never re-sent"); without one, 200
     (another session); a wrong password, 401;
   - `POST /api/v1/auth/logout` with the cookie answers `{"status":"ok"}`, and the
     session is gone (403 after); without a cookie, 401. Jellyfin still listed the device.

   So the setup asks whether Seerr is open (`mediaServerType` 4); signs in through
   Jellyfin with its service and container port from the stack (`serviceAddress`),
   `serverType: 2`, `useSsl: false`, `urlBase: ''` and no `email` (Seerr uses the
   Jellyfin name); and signs out at once with the session's cookie. It makes no key.
   A 401 means Jellyfin refused the shared admin: `SetupWaiting`. A Seerr found set up
   when its setup runs, though its file didn't say so when `apply` started it, is asked
   with its key, never with the password, which Seerr would pass to whatever Jellyfin it
   was set up with: it is Mediaplane's only if its admin is the shared admin
   (`GET /api/v1/auth/me`) and its Jellyfin the stack's (`GET /api/v1/settings/jellyfin`);
   anything else is refused as `auth`, so S5's claimed rule keeps it unpublished. A stack
   with no Jellyfin fails the setup. `Bootstrap.run` gets the resolved stack, for
   Jellyfin's address. S5's `claimed` message says "its setup was finished", not "its
   wizard", now that it serves two apps.
5. **The client's session** (Task 2). `AppApi.session(path, fields, cookie, secrets)` posts
   a JSON sign-in without the key, as `signIn` does (sent again only when nothing reached
   the app), and gives the same app's API carrying `Cookie: <cookie>=<value>` in place of
   the key, or undefined on a 401. A 2xx that sets no such cookie is a `protocol` failure.
   The cookie, and the sign-in's secrets, are kept out of every message of the session
   client. `signIn`'s and `session`'s fields may be of any JSON type (Seerr's sign-in has
   a port and a boolean).
6. **(check) Plex: Seerr isn't wired until Slice 7** (Task 3; the roadmap's S7 item). On a
   Plex stack, Seerr's sign-in is Plex's (§6.1), which Slice 7 brings. Giving Seerr an API
   would have every Plex stack's `apply` fail on Seerr's key, which does nothing until a
   first user exists. So the catalog gains `notWiredYet(config)`: the slice that wires the
   app in that stack, while Mediaplane doesn't yet. The resolver then leaves out the app's
   `api`, `integration` and `bootstrap`, so nothing calls it, and gives it that slice as
   its `login`. Seerr's is `'shared'`, through Jellyfin, on a Jellyfin stack, and
   `{ comingIn: 'Slice 7' }` on a Plex stack. That keeps the S7 item true without solving
   it: S7 still gives `login` a value for your own account, and removes `notWiredYet`.
   On a Plex stack, Seerr stays as before this slice: published, its setup open (its
   README and T2 say so).
7. **Seerr's API** (Task 3). Its port `web`; `ready: /api/v1/settings/public`, which
   answers anyone and calls nothing outside (`/api/v1/status`, its health check's path,
   asks GitHub for a newer version, Seerr's code shows); `check: /api/v1/auth/me`, which
   needs the key, and its admin (403 before);
   the key in `X-Api-Key`. Probed: `API_KEY` is in `settings.json` as `main.apiKey` from
   Seerr's first start (§6.1); restarted with another `API_KEY`, the new key worked, the
   old one was refused, and `settings.json` kept the first: Seerr takes its environment
   at every start. Seerr joins the wiring network on a Jellyfin stack.
8. **(check) `seerr.media_server`** (Task 4; §6.2). Probed:
   - `GET /api/v1/settings/jellyfin` gives `ip`, `port`, `useSsl`, `urlBase`, `libraries`
     and `apiKey`, the key in clear: Seerr's own, from its sign-in;
   - `POST /api/v1/settings/jellyfin` saves only once Seerr reaches Jellyfin at the merged
     settings with the merged key: an unknown host is 502 `INVALID_URL`, a refused key 401
     `INVALID_URL`, and neither is saved. A `hostname` field is kept as a stray setting:
     Seerr's field is `ip`. Re-sending `ip` and `port` is safe;
   - `GET /api/v1/settings/jellyfin/users` lists Jellyfin's users with the key Seerr
     holds: 200 while Jellyfin takes it, 500 (`{"message":""}`) once it is revoked;
   - libraries: `GET …/library` is `[]` until `POST …/library/sync` fetches Jellyfin's,
     each `{ id, name, enabled: false, type: movie | show }`; `PUT …/library/<id>` with
     `{ enabled: true }` enables one (404 for an unknown id, 400 for a non-boolean); a
     sync keeps what is enabled.

   So its fields are `hostname` (Seerr's `ip`) and `port`, Jellyfin's service and
   container port, and `libraries`: which of Mediaplane's Movies and Shows are enabled,
   in order (a library you enable is yours). `apiKey` is its secret: the key Seerr holds
   for Jellyfin, checked by using it (the users list), never compared (§6.3). Seerr keeps
   the key it made while it works; Mediaplane gives Seerr its own Jellyfin key only when
   Seerr's is refused, or Jellyfin moved. That leaves no unused key behind in Jellyfin,
   as replacing Seerr's would. An update syncs the libraries, then enables what is
   missing, and refuses a library Seerr can't find. `hostname` is never sent. It requires
   `jellyfin.admin` and both libraries.
9. **(check) `seerr.server_sonarr` and `seerr.server_radarr`** (Task 4; §6.2). Probed:
   - `POST /api/v1/settings/<arr>/test` with `hostname`, `port`, `apiKey` and `useSsl`
     (`baseUrl` optional, other fields ignored) answers 200 with the arr's `profiles`
     (Sonarr's and Radarr's own six: `Any`, `SD`, `HD-720p`, `HD-1080p`, `Ultra-HD`,
     `HD - 720p/1080p`) and `rootFolders`. A wrong key, an unknown host and a closed port
     all answer the same 500 (`Failed to connect to Sonarr`); no `apiKey` is a 400;
   - `GET /api/v1/settings/<arr>` shows each server with its key in clear, not masked;
   - `POST` makes one (201, ids from 0); `PUT …/<id>` replaces it whole, and refuses an
     `id` in the body (400, "read-only") and a missing required field; an unknown id is
     404 for Sonarr and a 500 HTML page for Radarr; `isDefault` clears the others' default.

   So each server, `<Arr> (Mediaplane)`, is found by id, else by name; its fields are
   `hostname`, `port`, `activeProfile` (the profile's name), `activeDirectory` (the arr's
   root folder, now exported as `ROOT_FOLDER`) and `isDefault`; `apiKey` is its secret.
   Though Seerr shows the key, it is checked, never compared (§6.3): Seerr's own test of
   the server it holds (§6.2's secret check). That test fails with one 500 whatever the
   cause, so a failure is tested again with the stack's key: a pass means the key was
   refused (an update), a second failure is Seerr not reaching the arr, in Seerr's words.
   A server is made with what Seerr's web UI gives a new one (no tags, no season folders,
   standard series, every new episode monitored, films "released") and updated by sending
   it back whole without its id. Each requires its arr's root folder.
10. **(check) The profile, and `resolve`** (Task 4; §6.2). The default profile is "the first
    match from a preference list (`HD-1080p`, then `Any`), or else the first profile",
    and only the arr knows its profiles, while `desired` is pure. So a resource may now
    `resolve` what only the app can say, filled into `desired` before its fields are
    compared, and kept in `resources.json` as applied. The servers ask the arr through
    Seerr's test, with the stack's key, and take `apps.seerr.<arr>_profile` when it is
    set: a name the arr lacks fails, listing those it has. `plan` leaves it unresolved,
    and the fields it fills uncompared, while a resource it requires is still to be put in
    place, as it leaves the secrets unchecked: the arr may not be up. A field left
    undefined is never compared, for `update` nor for `adopt`.
11. **`seerr.setup`** (Task 4; §6.1's "finishes with `initialize`"). Probed:
    `POST /api/v1/settings/initialize` answers `{"initialized":true}`, and again when sent
    twice. A singleton resource, `initialized`, read from Seerr's public settings, and
    sent while it is `false`, once Seerr's links are in place, which it requires. Seerr's
    web UI then stops showing its admin the setup wizard. Probed: before `initialize`,
    once Seerr has its admin, its setup is closed: the sign-in refuses a `hostname`, and
    its settings need the admin.
12. **`plan`'s marks** (Tasks 4, 6; §5.2). `plan` never runs Seerr's sign-in, and never
    sends `initialize`. Probed: Seerr's checks leave nothing in its settings, and a
    passing one logs nothing; each that fails logs an error line in Seerr's log (its
    Settings, Logs), and a test with a key the arr refuses logs an Info line in the arr's
    ("API was challenged"). No status row, unlike S4's and S5's. So the marks `plan` can
    leave are: a post-import category in qBittorrent (S3c); a failure in an app's status
    of a download client, Prowlarr link or arr connection (S4, S5); a sign-in in
    Jellyfin's activity log (S5); and these log lines (S6).
13. **The fakes answer as the apps do** (Task 1). A fake Seerr (`testing/seerr.ts`), served
    by `fakeStackApis` for `Host: seerr`, as decisions 1, 4, 8, 9 and 11 found it: open
    to the first sign-in through any reachable Jellyfin, then refusing a hostname; the
    key doing nothing until the first user; a session cookie, and a logout; Jellyfin
    settings saved only where Seerr reaches Jellyfin with the key, a stray `hostname`
    kept; the users list failing (500) on a revoked key; libraries synced from the fake
    Jellyfin, enabled one at a time; servers kept whole with their keys in clear, `id`
    read-only, required fields required, Radarr's 500 for an unknown id; a test that
    reaches the arr only by its service and port, without TLS or a URL base, with its
    key, and fails with one 500, logging a line; `initialize` taken twice; and
    `settings.json` kept as Seerr writes it. The fake arrs gain their six quality
    profiles. A shared `callFake` replaces the Jellyfin test's own request helper.
14. **(check) The end-to-end test, and where it stops** (Task 5). A new
    `test/e2e/requests.e2e.test.ts`, from source, on the whole stack of the other e2e
    tests (`stackFor`: Jellyfin, Sonarr, Radarr, Prowlarr with Byparr, qBittorrent
    without the VPN, Seerr). It shows: Seerr unpublished and open after the first `up`,
    set up before the publishing one, published after it, in the same container until
    then; the shared admin signing in to Seerr through Jellyfin as its admin, and another
    password refused; Seerr's key the one its `settings.json` holds; Seerr's Jellyfin at
    `jellyfin:8096` with Movies and Shows enabled, its key working; both servers as
    wanted, Seerr's own test of each passing; Seerr initialized; no secret in
    `resources.json` or apply's result; a second `apply` with no changes; and three hand
    changes put back by one `apply` that changes nothing else: Shows turned off, a wrong
    key in the Radarr server, and the `Any` profile in the Sonarr server.
    - **Why it stops at the links.** The brief asks for a request reaching the right arr,
      if that needs no outside account or metadata service. It does: Seerr's
      `POST /api/v1/request` looks the title up on TMDB (`MediaRequest.ts`), and the arr
      adds it by its TMDB or TVDB id through its own metadata service. Both are outside
      services, so the test stops at the links, and Seerr's own test of each, which calls
      the arr with the key it holds.
    - The other e2e stacks with Seerr (apply, plan, deploy) gain Seerr's setup and
      resources; the deploy test runs Seerr's setup from the image, behind the proxy, and
      shows Mediaplane in the image reading Seerr's `settings.json`, which uid 1000 owns.
15. **CI robustness** (Tasks 5, 6). S5's first arm64 run failed on a registry rate limit
    (`toomanyrequests` on `docker compose pull`, after apply's four tries). This slice
    adds no image, and every e2e file pulls only what is missing, so it adds no pull. CI
    doesn't change: the fix, an authenticated pull or a pull-through cache, needs a secret
    and a decision, so it goes on the roadmap's S9 list.
16. **No new Docker API call, and no proxy permission** (all tasks). Seerr's setup is the
    same unpublished `up` and recreate as Jellyfin's; the other new calls are Seerr's API
    over the wiring network. `deploy/mediaplane.compose.yaml` and `deploy/deploy.test.ts`
    don't change.
17. **The docs** (Task 6). The §9 set for what Tasks 1 to 5 built: the wiring-failed and
    app-won't-start runbooks; the architecture (bootstrap before publish for two apps,
    and the requests app); the threat model (Seerr's keys and cookie as assets, T2, T4,
    T5, T10, T16, and the new marks); the README (status, capabilities, flow, the
    example's output from a real run of the same stack with this slice); Seerr's,
    Jellyfin's, Sonarr's and Radarr's READMEs; the deploy guide; the spec (a "Slice 6"
    entry in §11, and §5.2's `plan` row); the roadmap (S6 done, the S6 item done, an S7
    item added and one changed, five S8 items added and one changed, and an S9 item).
    `docs/how-its-built.md` states no fact this slice changes, so it stays.

## File structure (new and changed in this slice)

`packages/engine/src/`:

- `http/client.ts` (+test): `AppApi.session`, `AppApiOptions.cookie`; `signIn`'s fields
  of any JSON type.
- `catalog/types.ts`: `Bootstrap.secret?`, `Bootstrap.run(api, admin, stack)` giving
  `string | undefined`; `AppDefinition.notWiredYet`.
- `plan/bootstrap.ts` (+test): a setup that makes no key.
- `apply/bootstrap.ts`, `apply/apply.ts` (+test): `SetupWaiting`, `WaitingSetup`, setups
  in order, waiting; the start step's detail for two apps; verify names a setup left.
- `integrations/wire.ts` (+test): `WireOptions.waiting`.
- `integrations/types.ts`, `integrations/wiring.ts` (+test): `ResourceSpec.resolve`;
  fields left undefined aren't compared.
- `resolver/resolve.ts` (+test): `notWiredYet`.
- `testing/`: `seerr.ts` (+test), new: `fakeSeerr`, `freshSeerr`, `FakeSeerr`,
  `FakeSeerrServer`, `FakeSeerrLibrary`, `SEERR_JELLYFIN`, `SEERR_NOT_CONFIGURED`;
  `http.ts`: `callFake`; `jellyfin.ts`: `makeApiKey`, `libraryId`; `wiring.ts`: Seerr's and
  the arrs' profiles in `FakeAppState`, `SERVARR_PROFILES`; `bootstrap.ts`: `FAKE_SIGN_IN`,
  `SIGN_IN_CATALOG`, `FakeSignInState`.

`catalog/`:

- `seerr/app.ts`: its API, setup, integration, `notWiredYet`, `login: 'shared'` and the
  profile options' descriptions; `seerr/bootstrap.ts` (+test) and
  `seerr/integration.ts` (+test), new.
- `sonarr/integration.ts`, `radarr/integration.ts`: `ROOT_FOLDER`.
- `catalog.test.ts`, `render.test.ts`, `jellyfin/integration.test.ts`: what changes.
- The generated facts in Seerr's README; the hand-written parts of Seerr's, Jellyfin's,
  Sonarr's and Radarr's READMEs (Task 6).

Elsewhere:

- `packages/cli/src/credentials.test.ts`, `run.test.ts`: Seerr's login, and a CLI-level
  `apply` with Seerr.
- `test/e2e/requests.e2e.test.ts`, new; the apply, plan and deploy e2e tests.
- docs: the two runbooks, the architecture, the threat model, the README, the deploy
  guide, the spec, the roadmap, and the generated `stack-yaml.md` and
  `stack.schema.json`.

**Tasks:**

1. The fakes: a fake Seerr, and the arrs' quality profiles, as the pinned images answer.
2. First-run setups that make no key, run in order and can wait; a sign-in session.
3. Seerr signed in through Jellyfin before it is published; not wired with Plex yet.
4. Seerr's links: Jellyfin with its libraries, Sonarr and Radarr, then `initialize`.
5. End-to-end: the whole stack wired with no clicking.
6. Docs.

**Out of scope here:**

- **Plex,** Seerr's Plex sign-in and its Plex media server: Slice 7 (the roadmap's S7
  items).
- **Drift and Keep mine** for Seerr's resources, how often drift may run Seerr's checks,
  and key recovery from `settings.json`: Slice 8.
- **A request from Seerr to an arr** in the end-to-end test: it needs TMDB (decision 14).
- **CI changes** for registry rate limits: Slice 9 (decision 15).

---

### Task 1: The fakes: a fake Seerr, and the arrs' quality profiles, as the pinned images answer

The unit tests of Tasks 2 to 4 run against `fakeStackApis`. It has no Seerr yet, and its
arrs have no quality profiles. This task adds them, answering as the pinned images do.

Decision: `fakeSeerr` answers Seerr's sign-in, logout, settings, libraries, servers,
tests and `initialize` as decisions 1, 4, 8, 9 and 11 found them, and keeps
`settings.json` in `seerr.configDir` when a test sets it (decision 13).
Decision: the fake arrs keep Sonarr's and Radarr's six quality profiles; Seerr's sign-in
makes a key named `Seerr` in the fake Jellyfin, through the fake's own `makeApiKey`
(decision 4).

**Files:**
- Create: `packages/engine/src/testing/seerr.ts`
- Modify: `packages/engine/src/testing/wiring.ts`, `packages/engine/src/testing/jellyfin.ts`,
  `packages/engine/src/testing/http.ts`, `packages/engine/src/testing/index.ts`
- Test: `packages/engine/src/testing/seerr.test.ts` (new),
  `packages/engine/src/testing/jellyfin.test.ts`

**Interfaces:**
- **Consumes:** S5's `fakeStackApis`, `FakeAppState`, `freshAppState` and the fake
  Jellyfin's state (`user`, `password`, `apiKeys`, `libraries`, `up`).
- **Produces:**
  - `FakeAppState` gains `profiles: { id: number; name: string }[]` (the arrs') and
    `seerr: FakeSeerr`; `SERVARR_PROFILES`;
  - `fakeStackApis()` answers `Host: seerr` with `fakeSeerr`, and lists `fake-seerr` in
    `addresses`;
  - from `@mediaplane/engine/testing`: `fakeSeerr(request, state, peek)`, `freshSeerr()`,
    `interface FakeSeerr { mediaServerType: number; users: string[]; jellyfin: { ip: string; port: number; apiKey: string; libraries: FakeSeerrLibrary[]; [setting: string]: unknown }; sonarr: FakeSeerrServer[]; radarr: FakeSeerrServer[]; initialized: boolean; sessions: string[]; errors: string[]; configDir?: string }`,
    `FakeSeerrServer`, `FakeSeerrLibrary`, `SEERR_JELLYFIN` (2), `SEERR_NOT_CONFIGURED` (4);
  - `callFake(port, path, init?)` giving `{ status, body, cookie }`;
    `makeApiKey(state, app)` and `libraryId(library)` from the fake Jellyfin.

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/testing/seerr.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callFake } from './http';
import { SEERR_JELLYFIN, SEERR_NOT_CONFIGURED } from './seerr';
import { tempDir } from './temp';
import { fakeStackApis, freshAppState, type FakeAppState } from './wiring';

const SEERR_KEY = '5'.repeat(32);
const SONARR_KEY = '1'.repeat(32);
const JELLYFIN_KEY = '7'.repeat(32);
const PASSWORD = 'fake-admin-password';

/** One call to the fake Seerr, or to the fake app `init.host` names. */
const call = (port: number, path: string, init: Parameters<typeof callFake>[2] = {}) =>
  callFake(port, path, { host: 'seerr:5055', ...init });

/** A stack's fakes: a Jellyfin set up with the admin and a key, Seerr fresh, Sonarr keyed. */
async function stack() {
  const apis = await fakeStackApis();
  const jellyfin: FakeAppState = {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: PASSWORD,
    apiKeys: [
      {
        AccessToken: JELLYFIN_KEY,
        AppName: 'Mediaplane',
        DateCreated: '2026-10-15T12:00:00.000Z',
      },
    ],
    libraries: [
      { Name: 'Movies', CollectionType: 'movies', Locations: [], LibraryOptions: {} },
      { Name: 'Shows', CollectionType: 'tvshows', Locations: [], LibraryOptions: {} },
      { Name: 'Music', CollectionType: 'music', Locations: [], LibraryOptions: {} },
    ],
  };
  apis.apps.set('jellyfin', jellyfin);
  const seerr = { ...freshAppState(), key: SEERR_KEY };
  apis.apps.set('seerr', seerr);
  apis.apps.set('sonarr', {
    ...freshAppState(),
    key: SONARR_KEY,
    rootFolders: [{ id: 1, path: '/data/media/tv' }],
  });
  return { apis, jellyfin, seerr, port: apis.app.port };
}

/** The first sign-in, as Mediaplane's setup sends it. */
const FIRST = {
  username: 'admin',
  password: PASSWORD,
  hostname: 'jellyfin',
  port: 8096,
  useSsl: false,
  urlBase: '',
  serverType: SEERR_JELLYFIN,
};

const keyed = { 'x-api-key': SEERR_KEY };

describe("fakeStackApis' Seerr", () => {
  it('lets whoever signs in first through Jellyfin set it up, and takes its key only after', async () => {
    const { port, jellyfin, seerr } = await stack();
    expect((await call(port, '/api/v1/settings/public')).body).toMatchObject({
      initialized: false,
      mediaServerType: SEERR_NOT_CONFIGURED,
    });
    // Its key does nothing yet; without it, the validator asks for a session.
    expect((await call(port, '/api/v1/auth/me', { headers: keyed })).status).toBe(403);
    expect(await call(port, '/api/v1/auth/me')).toMatchObject({
      status: 401,
      body: { message: "cookie 'connect.sid' required" },
    });
    const signIn = (body: unknown) => call(port, '/api/v1/auth/jellyfin', { body });
    expect(await signIn({ ...FIRST, password: 'fake-wrong' })).toMatchObject({
      status: 401,
      body: { message: 'INVALID_CREDENTIALS' },
      cookie: undefined,
    });
    expect(await signIn({ ...FIRST, hostname: 'elsewhere' })).toMatchObject({
      status: 404,
      body: { message: 'INVALID_URL' },
    });
    const first = await signIn(FIRST);
    expect(first).toMatchObject({ status: 200, body: { id: 1, permissions: 2 } });
    expect(first.cookie).toMatch(/^connect\.sid=s%3A[^;]+; Path=\/; HttpOnly/);
    // It made itself a key in Jellyfin, and uses it.
    const made = jellyfin.apiKeys.find((k) => k.AppName === 'Seerr');
    expect(made).toBeDefined();
    expect(seerr.seerr.jellyfin).toMatchObject({
      ip: 'jellyfin',
      port: 8096,
      apiKey: made?.AccessToken,
    });
    expect(seerr.seerr.mediaServerType).toBe(SEERR_JELLYFIN);
    expect((await call(port, '/api/v1/auth/me', { headers: keyed })).body).toEqual({
      id: 1,
      jellyfinUsername: 'admin',
      permissions: 2,
    });
    // Its hostname, once set, is never taken again; a sign-in without one still works.
    expect(await signIn(FIRST)).toMatchObject({
      status: 500,
      body: { error: 'Jellyfin hostname already configured' },
    });
    const { hostname: _h, port: _p, useSsl: _s, urlBase: _u, ...again } = FIRST;
    expect((await signIn(again)).status).toBe(200);
    expect((await signIn({ ...again, password: 'fake-wrong' })).status).toBe(401);
    expect(seerr.seerr.sessions).toHaveLength(2);
  });

  it('ends the session it gave when it signs out', async () => {
    const { port, seerr } = await stack();
    const { cookie } = await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const session = { cookie: (cookie ?? '').split(';')[0] ?? '' };
    expect((await call(port, '/api/v1/auth/me', { headers: session })).status).toBe(200);
    expect(await call(port, '/api/v1/auth/logout', { method: 'POST' })).toMatchObject({
      status: 401,
    });
    expect(
      await call(port, '/api/v1/auth/logout', { method: 'POST', headers: session }),
    ).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect(seerr.seerr.sessions).toEqual([]);
    expect((await call(port, '/api/v1/auth/me', { headers: session })).status).toBe(403);
  });

  it("saves its Jellyfin only where it reaches Jellyfin with the key, and lists Jellyfin's users only while Jellyfin takes its key", async () => {
    const { port, jellyfin, seerr } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const settings = '/api/v1/settings/jellyfin';
    const save = (body: unknown) => call(port, settings, { body, headers: keyed });
    const users = () => call(port, `${settings}/users`, { headers: keyed });
    expect(await save({ ip: 'elsewhere', port: 8096 })).toMatchObject({ status: 502 });
    expect(await save({ apiKey: '0'.repeat(32) })).toMatchObject({
      status: 401,
      body: { message: 'INVALID_URL' },
    });
    expect(seerr.seerr.jellyfin.ip).toBe('jellyfin');
    expect((await users()).status).toBe(200);
    // Its own key revoked in Jellyfin: the list fails, and Seerr logs it.
    jellyfin.apiKeys = jellyfin.apiKeys.filter((k) => k.AppName !== 'Seerr');
    const errors = seerr.seerr.errors.length;
    expect(await users()).toMatchObject({ status: 500, body: { message: '' } });
    expect(seerr.seerr.errors.length).toBe(errors + 1);
    expect(
      await save({ ip: 'jellyfin', port: 8096, useSsl: false, apiKey: JELLYFIN_KEY }),
    ).toMatchObject({ status: 200, body: { apiKey: JELLYFIN_KEY } });
    expect((await users()).status).toBe(200);
  });

  it("syncs Jellyfin's film and series libraries, keeping what is enabled, and enables them one at a time", async () => {
    const { port } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const sync = () =>
      call(port, '/api/v1/settings/jellyfin/library/sync', {
        method: 'POST',
        headers: keyed,
      });
    const synced = (await sync()).body as { id: string; name: string }[];
    expect(synced).toMatchObject([
      { name: 'Movies', enabled: false, type: 'movie' },
      { name: 'Shows', enabled: false, type: 'show' },
    ]);
    const enable = (id: string, body: unknown) =>
      call(port, `/api/v1/settings/jellyfin/library/${id}`, {
        method: 'PUT',
        body,
        headers: keyed,
      });
    expect((await enable(synced[0]?.id ?? '', { enabled: 'yes' })).status).toBe(400);
    expect((await enable('nosuch', { enabled: true })).status).toBe(404);
    expect(await enable(synced[0]?.id ?? '', { enabled: true })).toMatchObject({
      status: 200,
      body: { name: 'Movies', enabled: true },
    });
    expect((await sync()).body).toMatchObject([
      { name: 'Movies', enabled: true },
      { name: 'Shows', enabled: false },
    ]);
  });

  it('keeps an arr server whole, its key in clear, and tests one by reaching the arr with its key', async () => {
    const { port, seerr } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    const servers = '/api/v1/settings/sonarr';
    const server = {
      name: 'Sonarr (Mediaplane)',
      hostname: 'sonarr',
      port: 8989,
      apiKey: SONARR_KEY,
      useSsl: false,
      activeProfileId: 4,
      activeProfileName: 'HD-1080p',
      activeDirectory: '/data/media/tv',
      is4k: false,
      enableSeasonFolders: false,
      isDefault: true,
    };
    const send = (path: string, method: string, body: unknown) =>
      call(port, path, { method, body, headers: keyed });
    const { name: _n, ...nameless } = server;
    expect((await send(servers, 'POST', nameless)).status).toBe(400);
    expect((await send(servers, 'POST', { ...server, id: 3 })).status).toBe(400);
    expect(await send(servers, 'POST', server)).toMatchObject({
      status: 201,
      body: { id: 0 },
    });
    expect(await send(servers, 'POST', { ...server, name: 'Other' })).toMatchObject({
      status: 201,
      body: { id: 1 },
    });
    // A new default clears the old one.
    expect(seerr.seerr.sonarr.map((s) => s.isDefault)).toEqual([false, true]);
    expect((await call(port, servers, { headers: keyed })).body).toMatchObject([
      { id: 0, apiKey: SONARR_KEY },
      { id: 1 },
    ]);
    expect((await send(`${servers}/0`, 'PUT', { ...server, id: 0 })).status).toBe(400);
    expect((await send(`${servers}/0`, 'PUT', server)).status).toBe(200);
    expect((await send(`${servers}/9`, 'PUT', server)).status).toBe(404);
    expect((await send('/api/v1/settings/radarr/9', 'PUT', server)).status).toBe(500);

    const test = (body: unknown) => send(`${servers}/test`, 'POST', body);
    expect(await test(server)).toMatchObject({
      status: 200,
      body: {
        profiles: [{ id: 1, name: 'Any' }, {}, {}, { id: 4, name: 'HD-1080p' }, {}, {}],
        rootFolders: [{ id: 1, path: '/data/media/tv' }],
      },
    });
    const errors = seerr.seerr.errors.length;
    for (const wrong of [
      { apiKey: '0'.repeat(32) },
      { hostname: 'elsewhere' },
      { port: 1 },
      { useSsl: true },
    ]) {
      expect(await test({ ...server, ...wrong })).toMatchObject({
        status: 500,
        body: { message: 'Failed to connect to Sonarr' },
      });
    }
    expect(seerr.seerr.errors.length).toBe(errors + 4);
    const { apiKey: _k, ...keyless } = server;
    expect((await test(keyless)).status).toBe(400);
  });

  it('keeps settings.json in its config folder, naming its media server once it has one', async () => {
    const { port, seerr } = await stack();
    const dir = await tempDir('mediaplane-seerr-');
    seerr.seerr.configDir = dir;
    const written = () => readFile(join(dir, 'settings.json'), 'utf8');
    await call(port, '/api/v1/settings/public');
    expect(await written()).toBe('{\n "main": {\n  "mediaServerType": 4\n }\n}');
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    expect(await written()).toContain('"mediaServerType": 2');
  });

  it('is initialized by initialize, which it takes again', async () => {
    const { port } = await stack();
    await call(port, '/api/v1/auth/jellyfin', { body: FIRST });
    for (let i = 0; i < 2; i++) {
      expect(
        await call(port, '/api/v1/settings/initialize', {
          method: 'POST',
          headers: keyed,
        }),
      ).toMatchObject({ status: 200, body: { initialized: true } });
    }
    expect((await call(port, '/api/v1/settings/public')).body).toMatchObject({
      initialized: true,
    });
  });
});
```

**Change** `packages/engine/src/testing/jellyfin.test.ts`:

```diff
diff --git a/packages/engine/src/testing/jellyfin.test.ts b/packages/engine/src/testing/jellyfin.test.ts
index 5007d6f..5ace7cc 100644
--- a/packages/engine/src/testing/jellyfin.test.ts
+++ b/packages/engine/src/testing/jellyfin.test.ts
@@ -1,5 +1,5 @@
 import { readFile } from 'node:fs/promises';
-import { request } from 'node:http';
 import { join } from 'node:path';
 import { describe, expect, it } from 'vitest';
+import { callFake } from './http';
 import { FAKE_JELLYFIN_USER_ID } from './jellyfin';
@@ -15,46 +15,5 @@ const withToken = (token: string) => `${CLIENT}, Token="${token}"`;
 
-/** One call to a fake app as `host`: its status, and its body (as JSON when it is). */
-function call(
-  port: number,
-  path: string,
-  init: {
-    method?: string;
-    body?: unknown;
-    headers?: Record<string, string>;
-    host?: string;
-  } = {},
-): Promise<{ status: number; body: unknown }> {
-  const text = init.body === undefined ? undefined : JSON.stringify(init.body);
-  return new Promise((resolve, reject) => {
-    const sent = request(
-      {
-        host: '127.0.0.1',
-        port,
-        path,
-        method: init.method ?? (text === undefined ? 'GET' : 'POST'),
-        headers: {
-          host: init.host ?? 'jellyfin:8096',
-          ...(text === undefined ? {} : { 'content-type': 'application/json' }),
-          ...init.headers,
-        },
-      },
-      (reply) => {
-        const chunks: Buffer[] = [];
-        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
-        reply.on('end', () => {
-          const raw = Buffer.concat(chunks).toString('utf8');
-          let body: unknown = raw;
-          try {
-            body = JSON.parse(raw) as unknown;
-          } catch {
-            // Plain text, as Jellyfin's own refusals are.
-          }
-          resolve({ status: reply.statusCode ?? 0, body });
-        });
-      },
-    );
-    sent.on('error', reject);
-    sent.end(text);
-  });
-}
+/** One call to the fake Jellyfin, or to the fake app `init.host` names. */
+const call = (port: number, path: string, init: Parameters<typeof callFake>[2] = {}) =>
+  callFake(port, path, { host: 'jellyfin:8096', ...init });
 
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/testing`
Expected: FAIL. `seerr.test.ts` doesn't load
(`Cannot find module './seerr' imported from …/seerr.test.ts`), and the 18 tests of
`jellyfin.test.ts` fail with `TypeError: callFake is not a function`.

- [ ] **Step 3: Write the fakes**

**Change** `packages/engine/src/testing/http.ts`:

```diff
diff --git a/packages/engine/src/testing/http.ts b/packages/engine/src/testing/http.ts
index 1822faf..d49069e 100644
--- a/packages/engine/src/testing/http.ts
+++ b/packages/engine/src/testing/http.ts
@@ -1,2 +1,2 @@
-import { createServer, type IncomingHttpHeaders } from 'node:http';
+import { createServer, request, type IncomingHttpHeaders } from 'node:http';
 import type { AddressInfo } from 'node:net';
@@ -96 +96,51 @@ export async function closedPort(): Promise<number> {
 }
+
+/**
+ * One call to a fake app of fakeStackApis, as `init.host` (its Host header, which tells
+ * the apps apart): its status, its body (as JSON when it is), and the first cookie it set,
+ * if any. A body given is sent as JSON.
+ */
+export function callFake(
+  port: number,
+  path: string,
+  init: {
+    method?: string;
+    body?: unknown;
+    headers?: Record<string, string>;
+    host?: string;
+  } = {},
+): Promise<{ status: number; body: unknown; cookie: string | undefined }> {
+  const text = init.body === undefined ? undefined : JSON.stringify(init.body);
+  return new Promise((resolve, reject) => {
+    const sent = request(
+      {
+        host: '127.0.0.1',
+        port,
+        path,
+        method: init.method ?? (text === undefined ? 'GET' : 'POST'),
+        headers: {
+          host: init.host ?? 'localhost',
+          ...(text === undefined ? {} : { 'content-type': 'application/json' }),
+          ...init.headers,
+        },
+      },
+      (reply) => {
+        const chunks: Buffer[] = [];
+        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
+        reply.on('end', () => {
+          const raw = Buffer.concat(chunks).toString('utf8');
+          let body: unknown = raw;
+          try {
+            body = JSON.parse(raw) as unknown;
+          } catch {
+            // Plain text, as some apps' refusals are.
+          }
+          const cookie = reply.headers['set-cookie']?.[0];
+          resolve({ status: reply.statusCode ?? 0, body, cookie });
+        });
+      },
+    );
+    sent.on('error', reject);
+    sent.end(text);
+  });
+}
```

**Change** `packages/engine/src/testing/jellyfin.ts`:

```diff
diff --git a/packages/engine/src/testing/jellyfin.ts b/packages/engine/src/testing/jellyfin.ts
index bc0ad10..578616d 100644
--- a/packages/engine/src/testing/jellyfin.ts
+++ b/packages/engine/src/testing/jellyfin.ts
@@ -60,2 +60,16 @@ function token(state: FakeAppState): { value: string; count: number } {
 
+/**
+ * Make an API key named `app` in the Jellyfin `state`, as `POST /Auth/Keys?app=<app>`
+ * does, and give it: Seerr makes one so as it first signs in.
+ */
+export function makeApiKey(state: FakeAppState, app: string): string {
+  const key = token(state);
+  state.apiKeys.push({
+    AccessToken: key.value,
+    AppName: app,
+    DateCreated: new Date(Date.UTC(2026, 9, 15, 12, 0, key.count)).toISOString(),
+  });
+  return key.value;
+}
+
 /**
@@ -185,2 +199,10 @@ function availableOptions(type: string) {
 
+/**
+ * A library's id in Jellyfin (its `ItemId`), which follows its name here: Jellyfin's
+ * follows its folder, which a rename changes.
+ */
+export function libraryId(library: Pick<FakeLibrary, 'Name'>): string {
+  return Buffer.from(library.Name).toString('hex').padEnd(32, '0').slice(0, 32);
+}
+
 /** A library as /Library/VirtualFolders lists it. */
@@ -189,3 +211,3 @@ function shown(library: FakeLibrary) {
     ...library,
-    ItemId: Buffer.from(library.Name).toString('hex').padEnd(32, '0').slice(0, 32),
+    ItemId: libraryId(library),
     RefreshStatus: 'Idle',
@@ -319,8 +341,3 @@ export function fakeJellyfin(request: FakeRequest, state: FakeAppState): FakeRep
     if (app === null || app === '') return { status: 400, body: UNEXPLAINED };
-    const key = token(state);
-    state.apiKeys.push({
-      AccessToken: key.value,
-      AppName: app,
-      DateCreated: new Date(Date.UTC(2026, 9, 15, 12, 0, key.count)).toISOString(),
-    });
+    makeApiKey(state, app);
     return { status: 204 };
```

**Create** `packages/engine/src/testing/seerr.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import { libraryId, makeApiKey } from './jellyfin';
import type { FakeAppState } from './wiring';

/** Seerr's media-server types (its `MediaServerType`): Jellyfin is 2, none yet 4. */
export const SEERR_JELLYFIN = 2;
export const SEERR_NOT_CONFIGURED = 4;

/** A Sonarr or Radarr server, as Seerr keeps one: its key in clear, as Seerr shows it. */
export interface FakeSeerrServer {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  is4k: boolean;
  isDefault: boolean;
  [setting: string]: unknown;
}

/** One of Jellyfin's libraries, as Seerr keeps it once it has synced them. */
export interface FakeSeerrLibrary {
  id: string;
  name: string;
  enabled: boolean;
  type: 'movie' | 'show';
}

/** What the fake Seerr holds; a test may change it between calls. */
export interface FakeSeerr {
  /** SEERR_NOT_CONFIGURED until its first sign-in sets it. */
  mediaServerType: number;
  /** Its users, by the Jellyfin user each signed in as: the first is its admin (id 1). */
  users: string[];
  /** Its Jellyfin: where it is, the key it uses, and its libraries; ip '' until set. */
  jellyfin: {
    ip: string;
    port: number;
    apiKey: string;
    libraries: FakeSeerrLibrary[];
    [setting: string]: unknown;
  };
  /** Its Sonarr and Radarr servers. */
  sonarr: FakeSeerrServer[];
  radarr: FakeSeerrServer[];
  /** Whether its setup wizard is finished (`POST /settings/initialize`). */
  initialized: boolean;
  /** The values of the session cookies its sign-ins gave, until signed out. */
  sessions: string[];
  /** What it logged as errors: a check that fails logs a line, as Seerr does. */
  errors: string[];
  /**
   * Where Seerr keeps settings.json (its appdata folder): the fake writes it there as
   * Seerr does, naming its media-server type, on each request it answers. Unset: nowhere.
   */
  configDir?: string;
}

/**
 * settings.json, which Seerr writes into its config folder when it starts, and again as
 * its settings change: JSON with a one-space indent, its media-server type in `main`.
 */
function keepSettingsJson(seerr: FakeSeerr): void {
  if (seerr.configDir === undefined) return;
  const settings = { main: { mediaServerType: seerr.mediaServerType } };
  mkdirSync(seerr.configDir, { recursive: true });
  writeFileSync(
    join(seerr.configDir, 'settings.json'),
    JSON.stringify(settings, undefined, ' '),
  );
}

/** A fake Seerr as it first starts: nobody signed in, nothing set. */
export function freshSeerr(): FakeSeerr {
  return {
    mediaServerType: SEERR_NOT_CONFIGURED,
    users: [],
    jellyfin: { ip: '', port: 8096, apiKey: '', libraries: [] },
    sonarr: [],
    radarr: [],
    initialized: false,
    sessions: [],
    errors: [],
  };
}

/** How Seerr reaches each arr it can hold: its service, and its port. */
const ARRS = {
  sonarr: { name: 'Sonarr', port: 8989 },
  radarr: { name: 'Radarr', port: 7878 },
} as const;

/** What Seerr's request validator (its OpenAPI spec) requires of a server it saves. */
const REQUIRED = [
  'name',
  'hostname',
  'port',
  'apiKey',
  'useSsl',
  'activeProfileId',
  'activeProfileName',
  'activeDirectory',
  'is4k',
  'enableSeasonFolders',
  'isDefault',
];

/** Seerr's request validator refusing a request: 400, and where. */
function invalid(message: string): FakeReply {
  return { status: 400, body: { message: `request/${message}`, errors: [] } };
}

/** How Seerr refuses a call without a user it knows: no cookie at all, or no right. */
function refused(request: FakeRequest): FakeReply {
  return request.headers['x-api-key'] === undefined &&
    request.headers.cookie === undefined
    ? { status: 401, body: { message: "cookie 'connect.sid' required" } }
    : {
        status: 403,
        body: {
          status: 403,
          error: 'You do not have permission to access this endpoint',
        },
      };
}

/** The value of the cookie `connect.sid` in a Cookie header, if any. */
function sessionCookie(header: string | undefined): string | undefined {
  const match = /(?:^|;\s*)connect\.sid=([^;]*)/.exec(header ?? '');
  return match?.[1];
}

/**
 * Seerr 3.5's API, as fakeStackApis answers it, from `seerr` (`state.seerr`), as Seerr
 * answers it, and `peek`, the other apps it calls:
 * - before its first sign-in, anyone may sign in through a Jellyfin of their choosing
 *   (`POST /auth/jellyfin` with a hostname), and its key (`state.key`, any when empty)
 *   does nothing; the first Jellyfin admin who signs in is its admin, and sets its
 *   Jellyfin, where Seerr makes itself a key named "Seerr". After that, sending a
 *   hostname again is a 500, and a wrong password is 401;
 * - a sign-in gives a session cookie, `connect.sid`, until it signs out;
 * - its Jellyfin settings, saved only once Seerr reaches Jellyfin at them with their key;
 *   its libraries, synced from Jellyfin and enabled one by one; and a list of Jellyfin's
 *   users, which fails (500) while Jellyfin refuses Seerr's key;
 * - its Sonarr and Radarr servers, kept with their keys in clear, saved only whole (its
 *   validator requires their fields, and refuses an `id`), and tested by reaching the arr
 *   by its service, at its port, without TLS, with its key (`state.key` of the arr, any
 *   when empty); a failing test is a 500, and logs a line;
 * - `initialize`, which can be sent again.
 * It keeps settings.json in `seerr.configDir`, when that is set, as Seerr does.
 */
export function fakeSeerr(
  request: FakeRequest,
  state: FakeAppState,
  peek: (service: string) => FakeAppState | undefined,
): FakeReply {
  const reply = answer(request, state, peek);
  keepSettingsJson(state.seerr);
  return reply;
}

/** fakeSeerr's answer to `request`. */
function answer(
  request: FakeRequest,
  state: FakeAppState,
  peek: (service: string) => FakeAppState | undefined,
): FakeReply {
  const { seerr } = state;
  const { method } = request;
  const path = request.path.split('?')[0] ?? request.path;
  const body = () =>
    request.body === '' ? {} : (JSON.parse(request.body) as Record<string, unknown>);
  if (path === '/api/v1/status') return { status: 200, body: { version: '3.5.0' } };
  if (path === '/api/v1/settings/public' && method === 'GET') {
    return {
      status: 200,
      body: {
        initialized: seerr.initialized,
        mediaServerType: seerr.mediaServerType,
        applicationTitle: 'Seerr',
      },
    };
  }
  if (path === '/api/v1/auth/jellyfin' && method === 'POST') {
    return signIn(body(), seerr, peek('jellyfin'));
  }
  const cookie = sessionCookie(request.headers.cookie);
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    if (cookie === undefined) return refused(request);
    seerr.sessions = seerr.sessions.filter((s) => s !== cookie);
    return { status: 200, body: { status: 'ok' } };
  }
  // Its key acts as its admin, once there is one; a session, as whoever signed in.
  const keyed =
    typeof request.headers['x-api-key'] === 'string' &&
    (state.key === '' || request.headers['x-api-key'] === state.key) &&
    seerr.users.length > 0;
  if (!keyed && (cookie === undefined || !seerr.sessions.includes(cookie))) {
    return refused(request);
  }
  if (path === '/api/v1/auth/me' && method === 'GET') {
    return {
      status: 200,
      body: { id: 1, jellyfinUsername: seerr.users[0], permissions: 2 },
    };
  }
  if (path === '/api/v1/settings/initialize' && method === 'POST') {
    seerr.initialized = true;
    return { status: 200, body: { initialized: true } };
  }
  return (
    fakeSeerrJellyfin(request, path, body, seerr, peek('jellyfin')) ??
    fakeSeerrServers(request, path, body, seerr, peek) ?? { status: 404 }
  );
}

/** Whether Seerr reaches Jellyfin at `ip`:`port`: its service, while it runs, at 8096. */
function reachesJellyfin(
  ip: unknown,
  port: unknown,
  jellyfin: FakeAppState | undefined,
): jellyfin is FakeAppState {
  return jellyfin !== undefined && jellyfin.up && ip === 'jellyfin' && port === 8096;
}

/** Whether `key` is one of Jellyfin's keys. */
function jellyfinTakes(key: unknown, jellyfin: FakeAppState): boolean {
  return jellyfin.apiKeys.some((k) => k.AccessToken === key);
}

/** `POST /api/v1/auth/jellyfin`: a sign-in through Jellyfin, and the first one's setup. */
function signIn(
  sent: Record<string, unknown>,
  seerr: FakeSeerr,
  jellyfin: FakeAppState | undefined,
): FakeReply {
  if (
    seerr.mediaServerType !== SEERR_NOT_CONFIGURED &&
    seerr.mediaServerType !== SEERR_JELLYFIN
  ) {
    return { status: 500, body: { error: 'Jellyfin login is disabled' } };
  }
  if (typeof sent.username !== 'string' || sent.username === '') {
    return { status: 500, body: { error: 'You must provide an username' } };
  }
  const configured = seerr.jellyfin.ip !== '';
  if (configured && sent.hostname !== undefined) {
    return { status: 500, body: { error: 'Jellyfin hostname already configured' } };
  }
  if (!configured && sent.hostname === undefined) {
    return { status: 500, body: { error: 'No hostname provided.' } };
  }
  const at = configured
    ? { ip: seerr.jellyfin.ip, port: seerr.jellyfin.port }
    : { ip: sent.hostname, port: sent.port ?? 8096 };
  if (!reachesJellyfin(at.ip, at.port, jellyfin)) {
    return { status: 404, body: { message: 'INVALID_URL' } };
  }
  const right =
    jellyfin.user !== '' &&
    jellyfin.password !== '' &&
    sent.username === jellyfin.user &&
    sent.password === jellyfin.password;
  if (!right) return { status: 401, body: { message: 'INVALID_CREDENTIALS' } };
  if (seerr.users.length === 0) {
    if (sent.serverType !== SEERR_JELLYFIN) {
      return { status: 500, body: { message: 'NO_ADMIN_USER' } };
    }
    seerr.mediaServerType = SEERR_JELLYFIN;
    seerr.jellyfin.ip = String(at.ip);
    seerr.jellyfin.port = Number(at.port);
    seerr.jellyfin.apiKey = makeApiKey(jellyfin, 'Seerr');
  }
  if (!seerr.users.includes(sent.username)) seerr.users.push(sent.username);
  const session = `s%3Afake-session-${String(seerr.sessions.length + 1)}.signed`;
  seerr.sessions.push(session);
  return {
    status: 200,
    body: {
      id: seerr.users.indexOf(sent.username) + 1,
      jellyfinUsername: sent.username,
      permissions: seerr.users[0] === sent.username ? 2 : 32,
    },
    headers: { 'Set-Cookie': `connect.sid=${session}; Path=/; HttpOnly; SameSite=Lax` },
  };
}

/** Seerr's Jellyfin settings, its libraries and its list of Jellyfin's users. */
function fakeSeerrJellyfin(
  request: FakeRequest,
  path: string,
  body: () => Record<string, unknown>,
  seerr: FakeSeerr,
  jellyfin: FakeAppState | undefined,
): FakeReply | undefined {
  const { method } = request;
  const settings = '/api/v1/settings/jellyfin';
  const shown = () => ({
    name: 'jellyfin',
    useSsl: false,
    urlBase: '',
    externalHostname: '',
    serverId: 'fake',
    ...seerr.jellyfin,
  });
  if (path === settings && method === 'GET') return { status: 200, body: shown() };
  if (path === settings && method === 'POST') {
    const sent = body();
    const merged = { ...seerr.jellyfin, ...sent };
    // It asks Jellyfin for its system info at the merged settings first.
    if (!reachesJellyfin(merged.ip, merged.port, jellyfin)) {
      seerr.errors.push('Something went wrong testing Jellyfin connection');
      return { status: 502, body: { message: 'INVALID_URL' } };
    }
    if (!jellyfinTakes(merged.apiKey, jellyfin)) {
      seerr.errors.push('Something went wrong testing Jellyfin connection');
      return { status: 401, body: { message: 'INVALID_URL' } };
    }
    Object.assign(seerr.jellyfin, sent);
    return { status: 200, body: shown() };
  }
  const works =
    reachesJellyfin(seerr.jellyfin.ip, seerr.jellyfin.port, jellyfin) &&
    jellyfinTakes(seerr.jellyfin.apiKey, jellyfin);
  if (path === `${settings}/users` && method === 'GET') {
    if (!works) {
      seerr.errors.push('Something went wrong while getting the account');
      return { status: 500, body: { message: '' } };
    }
    return { status: 200, body: [{ username: jellyfin.user, id: 'fake' }] };
  }
  if (path === `${settings}/library` && method === 'GET') {
    return { status: 200, body: seerr.jellyfin.libraries };
  }
  if (path === `${settings}/library/sync` && method === 'POST') {
    if (!works) {
      seerr.errors.push('Something went wrong while getting libraries');
      return { status: 401, body: { message: 'INVALID_AUTH_TOKEN' } };
    }
    const found = jellyfin.libraries.flatMap((library): FakeSeerrLibrary[] => {
      const type =
        library.CollectionType === 'movies'
          ? 'movie'
          : library.CollectionType === 'tvshows'
            ? 'show'
            : undefined;
      if (type === undefined) return [];
      const id = libraryId(library);
      const held = seerr.jellyfin.libraries.find((l) => l.id === id);
      return [{ id, name: library.Name, enabled: held?.enabled ?? false, type }];
    });
    if (found.length === 0) {
      return { status: 404, body: { message: 'SYNC_ERROR_NO_LIBRARIES' } };
    }
    seerr.jellyfin.libraries = found;
    return { status: 200, body: found };
  }
  const library = /^\/api\/v1\/settings\/jellyfin\/library\/([^/]+)$/.exec(path);
  if (library !== null && method === 'PUT') {
    const { enabled } = body();
    if (typeof enabled !== 'boolean') return invalid('body/enabled must be boolean');
    const held = seerr.jellyfin.libraries.find((l) => l.id === library[1]);
    if (held === undefined) {
      return { status: 404, body: { message: 'Library does not exist.' } };
    }
    held.enabled = enabled;
    return { status: 200, body: held };
  }
  return undefined;
}

/** Seerr's Sonarr and Radarr servers, and its test of one. */
function fakeSeerrServers(
  request: FakeRequest,
  path: string,
  body: () => Record<string, unknown>,
  seerr: FakeSeerr,
  peek: (service: string) => FakeAppState | undefined,
): FakeReply | undefined {
  const match = /^\/api\/v1\/settings\/(sonarr|radarr)(?:\/(test|\d+))?$/.exec(path);
  if (match === null) return undefined;
  const arr = match[1] as keyof typeof ARRS;
  const { method } = request;
  const servers = seerr[arr];
  if (match[2] === 'test' && method === 'POST') {
    const sent = body();
    if (typeof sent.apiKey !== 'string') {
      return invalid("body must have required property 'apiKey'");
    }
    const held = peek(arr);
    const reached =
      held !== undefined &&
      held.up &&
      sent.hostname === arr &&
      sent.port === ARRS[arr].port &&
      sent.useSsl !== true &&
      (sent.baseUrl ?? '') === '';
    const takes =
      held !== undefined &&
      (held.key === '' ? sent.apiKey !== '' : sent.apiKey === held.key);
    if (!reached || !takes) {
      seerr.errors.push(`[${ARRS[arr].name}] Failed to retrieve system status`);
      return { status: 500, body: { message: `Failed to connect to ${ARRS[arr].name}` } };
    }
    return {
      status: 200,
      body: {
        profiles: held.profiles,
        rootFolders: held.rootFolders.map(({ id, path: folder }) => ({
          id,
          path: folder,
        })),
        languageProfiles: null,
        tags: [],
        urlBase: '',
      },
    };
  }
  if (match[2] === undefined && method === 'GET') return { status: 200, body: servers };
  const sent = body();
  if (method === 'POST' || method === 'PUT') {
    if ('id' in sent) return invalid('body/id is read-only');
    const missing = REQUIRED.find((field) => !(field in sent));
    if (missing !== undefined) {
      return invalid(`body must have required property '${missing}'`);
    }
  }
  const clearDefaults = () => {
    if (sent.isDefault !== true) return;
    for (const server of servers) {
      if (server.is4k === sent.is4k) server.isDefault = false;
    }
  };
  if (match[2] === undefined && method === 'POST') {
    clearDefaults();
    const made = { ...sent, id: (servers.at(-1)?.id ?? -1) + 1 } as FakeSeerrServer;
    servers.push(made);
    return { status: 201, body: made };
  }
  const index = servers.findIndex((s) => s.id === Number(match[2]));
  if (method === 'PUT') {
    if (index < 0) {
      // Radarr's route has no answer of its own for an id it doesn't hold.
      return arr === 'sonarr'
        ? { status: 404, body: { status: '404', message: 'Settings instance not found' } }
        : { status: 500, body: '<pre>Internal Server Error</pre>' };
    }
    clearDefaults();
    servers[index] = { ...sent, id: Number(match[2]) } as FakeSeerrServer;
    return { status: 200, body: servers[index] };
  }
  return undefined;
}
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index 48684c0..f56a27d 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -18,2 +18,3 @@ import {
 import { fakeProwlarr, type FakeProvider } from './prowlarr';
+import { fakeSeerr, freshSeerr, type FakeSeerr } from './seerr';
 import {
@@ -120,3 +121,4 @@ export interface FakeAppState {
    * Its API key, or any when empty: qBittorrent takes only this one, as a Bearer token,
-   * and Prowlarr's test of its link to Sonarr or Radarr passes only with the arr's.
+   * and Seerr only this one, once it has a user; Prowlarr's test of its link to Sonarr or
+   * Radarr, and Seerr's test of a server, pass only with the arr's.
    */
@@ -172,4 +174,18 @@ export interface FakeAppState {
   connections: FakeConnection[];
+  /** Sonarr's or Radarr's quality profiles: the six each makes at its first start. */
+  profiles: { id: number; name: string }[];
+  /** What Seerr holds (fakeSeerr). */
+  seerr: FakeSeerr;
 }
 
+/** The quality profiles Sonarr 4 and Radarr 6 make at their first start, in order. */
+export const SERVARR_PROFILES = [
+  'Any',
+  'SD',
+  'HD-720p',
+  'HD-1080p',
+  'Ultra-HD',
+  'HD - 720p/1080p',
+].map((name, i) => ({ id: i + 1, name }));
+
 /** A download client, as Sonarr and Radarr keep one. */
@@ -208,2 +224,4 @@ export function freshAppState(): FakeAppState {
     connections: [],
+    profiles: SERVARR_PROFILES.map((profile) => ({ ...profile })),
+    seerr: freshSeerr(),
   };
@@ -335,6 +353,8 @@ function fakeServarrDownloads(
  * Gluetun; Jellyfin has its startup wizard, sign-in, keys, user and libraries
- * (fakeJellyfin). Any key is taken, but qBittorrent takes only a Bearer token (X-Api-Key
- * gets a 403): its `key` when that is set; and Jellyfin only one of its own, in its
- * MediaBrowser header. `seams` send every app's calls there. `mkdir` is what the wire
- * step's folder helper does to them: pass it what a fake runtime's `run` is given.
+ * (fakeJellyfin); Seerr its sign-in through Jellyfin, its settings and its tests of the
+ * arrs (fakeSeerr). Any key is taken, but qBittorrent takes only a Bearer token (X-Api-Key
+ * gets a 403): its `key` when that is set; Jellyfin only one of its own, in its
+ * MediaBrowser header; and Seerr its `key`, once it has a user. `seams` send every app's
+ * calls there. `mkdir` is what the wire step's folder helper does to them: pass it what a
+ * fake runtime's `run` is given.
  */
@@ -370,2 +390,3 @@ export async function fakeStackApis(): Promise<{
     if (service === 'jellyfin') return fakeJellyfin(request, state);
+    if (service === 'seerr') return fakeSeerr(request, state, (other) => apps.get(other));
     const keyed =
@@ -417,2 +438,3 @@ export async function fakeStackApis(): Promise<{
       'radarr',
+      'seerr',
       'sonarr',
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index b61a6f2..60956ae 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -9,2 +9,3 @@ export * from './providers';
 export * from './schema';
+export * from './seerr';
 export * from './temp';
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/engine/src/testing`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/testing
git commit -m "test(engine): a fake Seerr, and the arrs' quality profiles, as the pinned images answer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1621 tests pass in 81 files (1614 in 80 before this slice).

---

### Task 2: First-run setups that make no key, run in order and can wait; a sign-in session

S5's bootstrap step knows one kind of setup: Jellyfin's, which makes the app's key. Seerr's
makes none, goes through Jellyfin, and must not stop the wiring while Jellyfin refuses
the shared admin. This task makes the step generic for that, and gives the client the
sign-in session Seerr's setup signs out of.

Decision: `Bootstrap.secret` is optional; a setup without one is to do while its `done`
file doesn't say so, and an unreadable one starts the app unpublished, with a warning
(decision 2).
Decision: setups run in the order of `after`; `SetupWaiting` leaves the app unpublished,
doesn't fail the step, and has the wire step skip the app's resources; a setup after one
that failed or waits waits too; verify names the setup left (decision 3).
Decision: `Bootstrap.run` gets the resolved stack (decision 4).
Decision: `AppApi.session` signs in and gives a client carrying the session's cookie
(decision 5).

**Files:**
- Modify: `packages/engine/src/http/client.ts`, `packages/engine/src/catalog/types.ts`,
  `packages/engine/src/plan/bootstrap.ts`, `packages/engine/src/apply/bootstrap.ts`,
  `packages/engine/src/apply/apply.ts`, `packages/engine/src/integrations/wire.ts`,
  `packages/engine/src/testing/bootstrap.ts`
- Test: `packages/engine/src/http/client.test.ts`,
  `packages/engine/src/plan/bootstrap.test.ts`, `packages/engine/src/apply/apply.test.ts`,
  `packages/engine/src/integrations/wire.test.ts`, `catalog/jellyfin/integration.test.ts`

**Interfaces:**
- **Consumes:** S5's `Bootstrap`, `inspectBootstrap`, `bootstrapApps`, `BootstrapFailed`,
  `fakeSetUpApp`, `SET_UP_CATALOG`; S3b's `wiringOrder`, `wire`.
- **Produces:**
  - `AppApi.session(path: string, fields: Readonly<Record<string, unknown>>, cookie: string, secrets: readonly string[]): Promise<AppApi | undefined>`;
    `AppApiOptions.cookie?: { name: string; value: string }`; `signIn`'s `fields` are
    `Readonly<Record<string, unknown>>`;
  - `interface Bootstrap { secret?: string; done; open(api); run(api, admin, stack: ResolvedStack): Promise<string | undefined> }`;
  - `class SetupWaiting extends Error`, `interface WaitingSetup { app: string; reason: string }`,
    and `bootstrapApps()` giving `{ store, detail, waiting: WaitingSetup[] }`;
  - `WireOptions.waiting?: readonly string[]`;
  - diagnostics `bootstrap.waiting` (a warning), and `bootstrap.unreadable` for a setup
    that makes no key;
  - from `@mediaplane/engine/testing`: `FAKE_SIGN_IN`, `SIGN_IN_CATALOG`, `FakeSignInState`,
    and `fakeSetUpApp()` giving `signIn` too.

- [ ] **Step 1: Write the failing tests, and the fixture they use**

The fixture first: a setup shaped like Seerr's, on the fixture Sonarr, served by
`fakeSetUpApp` when called as Sonarr.

**Change** `packages/engine/src/testing/bootstrap.ts`:

```diff
diff --git a/packages/engine/src/testing/bootstrap.ts b/packages/engine/src/testing/bootstrap.ts
index 41317f9..13b732b 100644
--- a/packages/engine/src/testing/bootstrap.ts
+++ b/packages/engine/src/testing/bootstrap.ts
@@ -3,2 +3,3 @@ import { join } from 'node:path';
 import { z } from 'zod';
+import { SetupWaiting } from '../apply/bootstrap';
 import type { Bootstrap, Catalog } from '../catalog/types';
@@ -7,3 +8,3 @@ import type { WiringSeams } from '../integrations/wiring';
 import { FIXTURE_API, fixtureCatalog } from './fixtures';
-import { fakeHttpApp, type FakeApp } from './http';
+import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';
 
@@ -57,2 +58,103 @@ export const SET_UP_CATALOG: Catalog = fixtureCatalog.map((def) =>
 
+/** Whether FAKE_SIGN_IN's app can still be claimed. */
+async function signInOpen(api: AppApi): Promise<boolean> {
+  return !(await api.get('/signed-in', z.looseObject({ done: z.boolean() }))).done;
+}
+
+/**
+ * A first-run setup shaped like Seerr's: it makes no key (the app's is Mediaplane's own),
+ * and is open until the shared admin signs in through Jellyfin (POST /sign-in, which keeps
+ * the session in the cookie `sid` and writes signed-in.txt in its appdata), then signs
+ * out. It waits (SetupWaiting) while that sign-in is refused, as Seerr's does while
+ * Jellyfin refuses the shared admin. Done already, it does nothing.
+ */
+export const FAKE_SIGN_IN: Bootstrap = {
+  done: { path: 'signed-in.txt', pattern: /^yes$/m },
+  open: signInOpen,
+  async run(api, admin, stack) {
+    if (!(await signInOpen(api))) return undefined;
+    const through = stack.apps.find((app) => app.def.id === 'jellyfin')?.def.id;
+    const session = await api.session(
+      '/sign-in',
+      { user: admin.username, password: admin.password, through },
+      'sid',
+      [admin.password],
+    );
+    if (session === undefined) {
+      throw new SetupWaiting(
+        `${api.name} at ${api.where} can't sign in yet: Jellyfin refused the shared admin (POST /sign-in)`,
+      );
+    }
+    await session.submit('POST', '/sign-out');
+    return undefined;
+  },
+};
+
+/**
+ * SET_UP_CATALOG, with Sonarr given FAKE_SIGN_IN, after Jellyfin, an API of its own and
+ * no resource.
+ */
+export const SIGN_IN_CATALOG: Catalog = SET_UP_CATALOG.map((def) =>
+  def.id === 'sonarr'
+    ? {
+        ...def,
+        api: { ...FIXTURE_API, ready: '/ready', check: '/check' },
+        integration: { after: ['jellyfin'], resources: [] },
+        bootstrap: FAKE_SIGN_IN,
+      }
+    : def,
+);
+
+/** What the app behind FAKE_SIGN_IN holds; a test may change it between calls. */
+export interface FakeSignInState {
+  /** Whether the shared admin has signed in, which is its setup. */
+  done: boolean;
+  /** Refuse the sign-in (401), as Jellyfin refusing the shared admin makes Seerr. */
+  refuse: boolean;
+  /** Its sessions' cookies, until signed out. */
+  sessions: string[];
+  /** Who signed in, as each sign-in named them, and through what. */
+  signedIn: { user: string; through: string }[];
+}
+
+/**
+ * The app behind FAKE_SIGN_IN, as Sonarr of the stack in `home`: /ready, /signed-in,
+ * /sign-in, /sign-out, and /check, which takes any key.
+ */
+function fakeSignInApp(
+  request: FakeRequest,
+  state: FakeSignInState,
+  home: string,
+): FakeReply {
+  const { method, path, headers } = request;
+  if (path === '/ready') return { status: 200 };
+  if (path === '/signed-in') return { status: 200, body: { done: state.done } };
+  if (path === '/sign-in' && method === 'POST') {
+    if (state.refuse) return { status: 401 };
+    const { user, through } = JSON.parse(request.body) as {
+      user: string;
+      through: string;
+    };
+    state.signedIn.push({ user, through });
+    state.done = true;
+    writeFileSync(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
+    const cookie = `fake-sid-${String(state.signedIn.length)}`;
+    state.sessions.push(cookie);
+    return {
+      status: 200,
+      body: {},
+      headers: { 'Set-Cookie': `sid=${cookie}; Path=/; HttpOnly` },
+    };
+  }
+  if (path === '/sign-out' && method === 'POST') {
+    const cookie = /^sid=(.*)$/.exec(headers.cookie ?? '')?.[1];
+    if (cookie === undefined || !state.sessions.includes(cookie)) return { status: 401 };
+    state.sessions = state.sessions.filter((s) => s !== cookie);
+    return { status: 200 };
+  }
+  if (path === '/check')
+    return { status: headers['x-api-key'] === undefined ? 401 : 200 };
+  return { status: 404 };
+}
+
 /** What the app behind FAKE_SETUP holds; a test may change it between calls. */
@@ -81,5 +183,6 @@ export interface FakeSetUpState {
  * key. A finished setup writes appdata/jellyfin/setup.txt, as Jellyfin writes its
- * system.xml.
- * `addresses` put Jellyfin's fake container on the wiring network, and `seams` send its
- * calls here.
+ * system.xml. Called as Sonarr (its Host header), it is the app behind FAKE_SIGN_IN, with
+ * `signIn` its state.
+ * `addresses` put Jellyfin's and Sonarr's fake containers on the wiring network, and
+ * `seams` send their calls here.
  */
@@ -88,2 +191,3 @@ export async function fakeSetUpApp(home: string): Promise<{
   state: FakeSetUpState;
+  signIn: FakeSignInState;
   seams: WiringSeams;
@@ -91,2 +195,8 @@ export async function fakeSetUpApp(home: string): Promise<{
 }> {
+  const signIn: FakeSignInState = {
+    done: false,
+    refuse: false,
+    sessions: [],
+    signedIn: [],
+  };
   const state: FakeSetUpState = {
@@ -103,2 +213,5 @@ export async function fakeSetUpApp(home: string): Promise<{
     const { method, path, headers } = request;
+    if ((headers.host ?? '').startsWith('sonarr:')) {
+      return fakeSignInApp(request, signIn, home);
+    }
     if (path === '/ready') return { status: 200 };
@@ -141,2 +254,3 @@ export async function fakeSetUpApp(home: string): Promise<{
     state,
+    signIn,
     seams: {
@@ -145,3 +259,3 @@ export async function fakeSetUpApp(home: string): Promise<{
     },
-    addresses: { 'fake-jellyfin': '127.0.0.1' },
+    addresses: { 'fake-jellyfin': '127.0.0.1', 'fake-sonarr': '127.0.0.1' },
   };
```

**Change** `packages/engine/src/http/client.test.ts`:

```diff
diff --git a/packages/engine/src/http/client.test.ts b/packages/engine/src/http/client.test.ts
index 3da2f62..8c4fa64 100644
--- a/packages/engine/src/http/client.test.ts
+++ b/packages/engine/src/http/client.test.ts
@@ -1252 +1252,89 @@ describe("createAppApi: Jellyfin's ways", () => {
 });
+
+describe("createAppApi: Seerr's session", () => {
+  const seerr = { name: 'Seerr', service: 'seerr', port: 5055 };
+  const COOKIE = 's%3Afake-session.signed';
+
+  it('signs in with JSON and without the key, and gives a client that carries the session cookie in place of the key', async () => {
+    const { api, app } = await sonarr(
+      (request) => {
+        if (request.path === '/api/v1/auth/jellyfin') {
+          const { password } = JSON.parse(request.body) as { password: string };
+          return password === PASSWORD
+            ? {
+                status: 200,
+                body: { id: 1 },
+                headers: { 'Set-Cookie': `connect.sid=${COOKIE}; Path=/; HttpOnly` },
+              }
+            : { status: 401, body: { message: 'INVALID_CREDENTIALS' } };
+        }
+        return { status: 200, body: { status: 'ok' } };
+      },
+      { ...seerr },
+    );
+    const signIn = (password: string) =>
+      api.session(
+        '/api/v1/auth/jellyfin',
+        { username: 'admin', password, port: 8096, useSsl: false },
+        'connect.sid',
+        [password],
+      );
+    expect(await signIn('fake-wrong-password')).toBeUndefined();
+    const session = await signIn(PASSWORD);
+    expect(session).toBeDefined();
+    await session?.submit('POST', '/api/v1/auth/logout');
+    const [refused, signedIn, signedOut] = app.requests;
+    expect(refused?.headers).not.toHaveProperty('x-api-key');
+    expect(signedIn).toMatchObject({
+      body: '{"username":"admin","password":"fake-admin-password","port":8096,"useSsl":false}',
+      headers: { 'content-type': 'application/json' },
+    });
+    expect(signedIn?.headers).not.toHaveProperty('cookie');
+    expect(signedOut?.headers.cookie).toBe(`connect.sid=${COOKIE}`);
+    expect(signedOut?.headers).not.toHaveProperty('x-api-key');
+    // The client it came from still carries its key, and no cookie.
+    await api.check('/api/v1/auth/me');
+    expect(app.requests[3]?.headers).toMatchObject({ 'x-api-key': KEY });
+    expect(app.requests[3]?.headers).not.toHaveProperty('cookie');
+  });
+
+  it('keeps the cookie and the password out of what it says, and fails a sign-in that sets no cookie', async () => {
+    const replies = [
+      {
+        status: 200,
+        body: {},
+        headers: { 'Set-Cookie': `connect.sid=${COOKIE}; Path=/` },
+      },
+      { status: 500, body: { message: `fake failure with ${COOKIE} and ${PW}` } },
+      { status: 200, body: {}, headers: { 'Set-Cookie': 'connect.sid=; Path=/' } },
+      { status: 400, body: { message: `bad ${PW}` } },
+    ];
+    const { api } = await sonarr(() => replies.shift() ?? { status: 404 }, {
+      ...seerr,
+      secrets: [],
+    });
+    const signIn = () =>
+      api.session('/api/v1/auth/jellyfin', { password: PW }, 'connect.sid', [PW]);
+    const session = await signIn();
+    const said = await failure(
+      session?.submit('POST', '/api/v1/auth/logout') ?? Promise.resolve(),
+    );
+    expect(said.message).toBe(
+      'Seerr at http://seerr:5055 (127.0.0.1) failed (HTTP 500): fake failure with *** and *** (POST /api/v1/auth/logout)',
+    );
+    expect(await failure(signIn())).toMatchObject({
+      kind: 'protocol',
+      message:
+        'Seerr at http://seerr:5055 (127.0.0.1) signed in, but set no connect.sid cookie (POST /api/v1/auth/jellyfin)',
+    });
+    expect((await failure(signIn())).message).toContain('bad ***');
+  });
+
+  it('sends a sign-in once it may have reached the app', async () => {
+    const { api, app } = await sonarr(() => ({ status: 503 }), { ...seerr });
+    expect(
+      await failure(api.session('/api/v1/auth/jellyfin', {}, 'connect.sid', [])),
+    ).toMatchObject({ kind: 'server', status: 503 });
+    expect(app.requests).toHaveLength(1);
+  });
+});
```

**Change** `packages/engine/src/plan/bootstrap.test.ts`:

```diff
diff --git a/packages/engine/src/plan/bootstrap.test.ts b/packages/engine/src/plan/bootstrap.test.ts
index bfac68f..0da3cfd 100644
--- a/packages/engine/src/plan/bootstrap.test.ts
+++ b/packages/engine/src/plan/bootstrap.test.ts
@@ -5,3 +5,3 @@ import { resolveStack, type ResolvedStack } from '../resolver/resolve';
 import { emptySecretStore, type SecretStore } from '../secrets/store';
-import { FAKE_SETUP, SET_UP_CATALOG } from '../testing/bootstrap';
+import { FAKE_SETUP, SET_UP_CATALOG, SIGN_IN_CATALOG } from '../testing/bootstrap';
 import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
@@ -141 +141,50 @@ apps:
 });
+
+describe('planBootstrap: a setup that makes no key', () => {
+  /**
+   * What plan finds of the stack, with Sonarr's FAKE_SIGN_IN and its signed-in.txt as
+   * `file` says, and Jellyfin's setup done and its key kept.
+   */
+  async function signInStack(file: { text: string } | 'absent' | 'unreadable') {
+    const home = await tempDir('mediaplane-bootstrap-');
+    const resolved = resolveStack(
+      fixtureConfig(STACK),
+      SIGN_IN_CATALOG,
+      FIXTURE_HOST,
+      home,
+    );
+    if (resolved.stack === undefined) throw new Error('the stack must resolve');
+    await setupFile(resolved.stack, 'done\n');
+    const path = join(home, 'appdata', 'sonarr', 'signed-in.txt');
+    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
+    if (file === 'unreadable') await mkdir(path);
+    else if (file !== 'absent') await writeFile(path, file.text);
+    return inspectBootstrap(resolved.stack, KEYED);
+  }
+
+  it('sets it up, unpublished, until its file says it is done: there is no key to say so', async () => {
+    expect((await signInStack('absent')).changes).toEqual([
+      { app: 'sonarr', unpublished: true },
+    ]);
+    expect((await signInStack({ text: 'no\n' })).changes).toEqual([
+      { app: 'sonarr', unpublished: true },
+    ]);
+    expect(await signInStack({ text: 'yes\n' })).toEqual({
+      changes: [],
+      diagnostics: [],
+    });
+  });
+
+  it("sets it up again, unpublished, and warns, when it can't read the file", async () => {
+    const found = await signInStack('unreadable');
+    expect(found.changes).toEqual([{ app: 'sonarr', unpublished: true }]);
+    expect(found.diagnostics).toHaveLength(1);
+    expect(found.diagnostics[0]).toMatchObject({
+      severity: 'warning',
+      code: 'bootstrap.unreadable',
+      message:
+        "Mediaplane can't read the file in sonarr's appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; sonarr starts unpublished, and is set up again, until it can",
+      hint: 'check the permissions of appdata/sonarr',
+    });
+  });
+});
```

**Change** `packages/engine/src/apply/apply.test.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 1abdece..f1cfe54 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -30,3 +30,8 @@ import { RuntimeError, type ContainerState, type Runtime } from '../runtime/type
 import { readSecretStore, writeSecretStore } from '../secrets/store';
-import { fakeSetUpApp, SET_UP_CATALOG, SET_UP_KEY } from '../testing/bootstrap';
+import {
+  fakeSetUpApp,
+  SET_UP_CATALOG,
+  SET_UP_KEY,
+  SIGN_IN_CATALOG,
+} from '../testing/bootstrap';
 import {
@@ -1828,3 +1833,3 @@ describe('apply: first-run setup before the ports are published', () => {
       message:
-        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished: its wizard was finished with another login while Mediaplane set it up. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says",
+        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished: its setup was finished with another login while Mediaplane set it up. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says",
     });
@@ -1852,3 +1857,3 @@ describe('apply: first-run setup before the ports are published', () => {
     expect(result.diagnostics.at(-1)?.message).toBe(
-      "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished: its wizard was finished with another login while Mediaplane set it up, and the next apply would publish it. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says",
+      "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the shared admin's sign-in (POST /signin); jellyfin's setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished: its setup was finished with another login while Mediaplane set it up, and the next apply would publish it. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says",
     );
@@ -2012 +2017,161 @@ describe('apply: first-run setup before the ports are published', () => {
 });
+
+describe('apply: a first-run setup that makes no key, after another', () => {
+  /**
+   * The stack with Jellyfin's FAKE_SETUP and Sonarr's FAKE_SIGN_IN, after it, and a Docker
+   * that notes, at each up, which apps it starts without their ports and where each setup
+   * stands then.
+   */
+  async function signInStack(catalog: Catalog = SIGN_IN_CATALOG) {
+    const home = await makeHome();
+    const setup = await fakeSetUpApp(home);
+    const docker = fakeDocker(home, { addresses: setup.addresses });
+    const ups: string[] = [];
+    const runtime: Runtime = {
+      ...docker,
+      up: (seconds, values, unpublished = []) => {
+        const shown =
+          unpublished.length === 0
+            ? 'all published'
+            : `${unpublished.join(' ')} unpublished`;
+        const jellyfin = setup.state.done ? 'done' : 'open';
+        const sonarr = setup.signIn.done ? 'done' : 'open';
+        ups.push(`${shown}; jellyfin ${jellyfin}, sonarr ${sonarr}`);
+        return docker.up(seconds, values, unpublished);
+      },
+    };
+    const run = () => apply(options(home, runtime, { catalog, wiring: setup.seams }));
+    return { home, setup, ups, run };
+  }
+
+  it('sets it up after the app it signs in through, keeps no key for it, signs out, and publishes both', async () => {
+    const { home, setup, ups, run } = await signInStack();
+    const first = await run();
+    expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
+    expect(first.outcome).toBe('success');
+    expect(first.plan.bootstrap).toEqual([
+      { app: 'jellyfin', unpublished: true },
+      { app: 'sonarr', unpublished: true },
+    ]);
+    expect(ups).toEqual([
+      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
+      'all published; jellyfin done, sonarr done',
+    ]);
+    expect(first.actions.find((a) => a.step === 'start')?.detail).toBe(
+      'every app is running and healthy; started jellyfin, sonarr without their ports, to set them up first',
+    );
+    expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+      'set up jellyfin, sonarr and saved jellyfin.apiKey; published jellyfin, sonarr',
+    );
+    // As the shared admin, in the stack it was given, and signed out of again.
+    expect(setup.signIn.signedIn).toEqual([{ user: 'admin', through: 'jellyfin' }]);
+    expect(setup.signIn.sessions).toEqual([]);
+    // Sonarr's key is Mediaplane's own, as generated: the setup made none.
+    expect((await readSecretStore(home)).apps.sonarr).toEqual({
+      apiKey: 'ab'.repeat(16),
+    });
+    expect((await run()).outcome).toBe('no-changes');
+  });
+
+  it('sets the apps up in the order of their integrations, not of their names', async () => {
+    // Jellyfin after Sonarr, here: Sonarr signs in first.
+    const catalog = SIGN_IN_CATALOG.map((def) => {
+      if (def.id === 'jellyfin') {
+        return { ...def, integration: { after: ['sonarr'], resources: [] } };
+      }
+      if (def.id === 'sonarr')
+        return { ...def, integration: { after: [], resources: [] } };
+      return def;
+    });
+    const { setup, run } = await signInStack(catalog);
+    expect((await run()).outcome).toBe('success');
+    const posts = setup.app.requests
+      .filter((r) => r.method === 'POST')
+      .map((r) => r.path);
+    expect(posts.slice(0, 2)).toEqual(['/sign-in', '/sign-out']);
+    expect(posts).toContain('/setup');
+  });
+
+  it('leaves one whose setup waits unpublished, wires the rest without it, and fails only at verify, which says what is left', async () => {
+    const { home, setup, ups, run } = await signInStack();
+    setup.signIn.refuse = true;
+    const waited = await run();
+    expect(waited.outcome).toBe('failed');
+    expect(waited.actions.map((a) => [a.step, a.resource ?? '', a.result])).toEqual([
+      ['keys', '', 'done'],
+      ['files', '', 'done'],
+      ['pull', '', 'done'],
+      ['ownership', '', 'done'],
+      ['start', '', 'done'],
+      ['bootstrap', '', 'done'],
+      ['wire', 'sonarr', 'skipped'],
+      ['wire', '', 'done'],
+      ['verify', '', 'failed'],
+    ]);
+    const reason =
+      "sonarr at http://sonarr:8989 (127.0.0.1) can't sign in yet: Jellyfin refused the shared admin (POST /sign-in)";
+    expect(waited.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+      `set up jellyfin and saved jellyfin.apiKey; published jellyfin; sonarr waits: ${reason}`,
+    );
+    expect(waited.actions.find((a) => a.resource === 'sonarr')?.detail).toBe(
+      "sonarr's first-run setup waits",
+    );
+    expect(waited.diagnostics).toContainEqual(
+      expect.objectContaining({
+        severity: 'warning',
+        code: 'bootstrap.waiting',
+        message: reason,
+        hint: `the rest of the stack is wired without sonarr, and the next apply sets it up; if it still waits, see ${RUNBOOK}`,
+      }),
+    );
+    expect(waited.diagnostics.at(-1)?.message).toContain('sonarr (first-run setup)');
+    // Jellyfin was published once set up; Sonarr, whose setup is still open, never was.
+    expect(ups).toEqual([
+      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
+      'sonarr unpublished; jellyfin done, sonarr open',
+    ]);
+    expect((await readSecretStore(home)).apps.jellyfin).toEqual({ apiKey: SET_UP_KEY });
+    // Once the sign-in works, the next apply sets it up and publishes it.
+    setup.signIn.refuse = false;
+    const then = await run();
+    expect(then.outcome).toBe('success');
+    expect(then.plan.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
+    expect(ups.slice(2)).toEqual([
+      'sonarr unpublished; jellyfin done, sonarr open',
+      'all published; jellyfin done, sonarr done',
+    ]);
+  });
+
+  it('keeps unpublished, and fails, an app with a setup but no API to finish it through', async () => {
+    const catalog = SET_UP_CATALOG.map((def) =>
+      def.id === 'jellyfin' ? { ...def, api: undefined } : def,
+    );
+    const { ups, run } = await signInStack(catalog);
+    const failed = await run();
+    expect(failed.outcome).toBe('failed');
+    expect(failed.diagnostics.at(-1)?.message).toBe(
+      "the first-run setup failed: jellyfin's container is not on the stack's wiring network, so Mediaplane can't reach it",
+    );
+    expect(ups).toEqual([
+      'jellyfin unpublished; jellyfin open, sonarr open',
+      'jellyfin unpublished; jellyfin open, sonarr open',
+    ]);
+  });
+
+  it('waits, without asking it, one that comes after an app whose setup failed', async () => {
+    const { setup, ups, run } = await signInStack();
+    setup.state.refuse = 'fake refusal';
+    const failed = await run();
+    expect(failed.outcome).toBe('failed');
+    expect(failed.diagnostics.at(-1)).toMatchObject({
+      code: 'apply.bootstrap-failed',
+      message:
+        "the first-run setup failed: jellyfin at http://jellyfin:8096 (127.0.0.1) refused the request (HTTP 400): fake refusal (POST /setup); sonarr waits: sonarr waits for jellyfin's first-run setup, which isn't done",
+    });
+    expect(setup.app.requests.some((r) => r.path === '/sign-in')).toBe(false);
+    expect(ups).toEqual([
+      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
+      'jellyfin sonarr unpublished; jellyfin open, sonarr open',
+    ]);
+  });
+});
```

**Change** `packages/engine/src/integrations/wire.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index abefb20..a183233 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -11,2 +11,3 @@ import { RuntimeError, type OneOffCommand } from '../runtime/types';
 import { fakeRuntime, type FakeRuntimeOptions } from '../testing/fakes';
+import { FIXTURE_API } from '../testing/fixtures';
 import { tempDir } from '../testing/temp';
@@ -264,2 +265,49 @@ describe('wire', () => {
 
+  it('skips the resources of an app whose first-run setup waits, and what needs them, asking it nothing', async () => {
+    // Jellyfin, after Sonarr, holds a resource that needs Sonarr's login.
+    const wired = WIRED_CATALOG.map((def) =>
+      def.id === 'jellyfin'
+        ? {
+            ...def,
+            api: FIXTURE_API,
+            integration: {
+              after: ['sonarr'],
+              resources: [
+                { ...FAKE_LOGIN, name: 'needs', requires: ['sonarr.login'] },
+                { ...FAKE_LOGIN, name: 'free' },
+              ],
+            },
+          }
+        : def,
+    );
+    const sonarr = await fakeSonarr({ key: KEY });
+    const { run, actions } = await wireWith(
+      {
+        seams: sonarr.seams,
+        addresses: { ...sonarr.addresses, 'fake-jellyfin': '127.0.0.1' },
+      },
+      {
+        stack: stackOf(wired),
+        store: {
+          version: 1,
+          apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
+          shared: { adminPassword: PASSWORD },
+        },
+        waiting: ['sonarr'],
+      },
+    );
+    expect(await run).toEqual(['jellyfin.free created']);
+    expect(
+      actions.map((a) => `${a.resource ?? ''} ${a.result} ${a.detail ?? ''}`),
+    ).toEqual([
+      "sonarr.login skipped sonarr's first-run setup waits",
+      'jellyfin.needs skipped sonarr.login was skipped',
+      'jellyfin.free done created',
+    ]);
+    // Only Jellyfin's calls: its key check, then its free resource.
+    expect(sonarr.app.requests.every((r) => r.headers.host === 'jellyfin:8096')).toBe(
+      true,
+    );
+  });
+
   it('says so when there is no wiring network after the start, and asks no app', async () => {
```

Jellyfin's setup now gets the stack, as `run` takes it:

**Change** `catalog/jellyfin/integration.test.ts`:

```diff
diff --git a/catalog/jellyfin/integration.test.ts b/catalog/jellyfin/integration.test.ts
index 20ce1fa..e5aa6ed 100644
--- a/catalog/jellyfin/integration.test.ts
+++ b/catalog/jellyfin/integration.test.ts
@@ -160,3 +160,3 @@ describe("Jellyfin's first-run setup", () => {
     expect(await jellyfinBootstrap.open(api)).toBe(true);
-    const key = await jellyfinBootstrap.run(api, ADMIN);
+    const key = await jellyfinBootstrap.run(api, ADMIN, contextOf().stack);
     expect(key).toMatch(/^[0-9a-f]{32}$/);
@@ -187,3 +187,3 @@ describe("Jellyfin's first-run setup", () => {
     const { api, state, app } = await jellyfin(setUp());
-    expect(await jellyfinBootstrap.run(api, ADMIN)).toBe(KEY);
+    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toBe(KEY);
     expect(state.apiKeys).toHaveLength(1);
@@ -199,3 +199,5 @@ describe("Jellyfin's first-run setup", () => {
     });
-    expect(await jellyfinBootstrap.run(api, ADMIN)).toMatch(/^[0-9a-f]{32}$/);
+    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toMatch(
+      /^[0-9a-f]{32}$/,
+    );
     expect(state.wizard).toBe('done');
@@ -210,3 +212,3 @@ describe("Jellyfin's first-run setup", () => {
     });
-    const refused = await failure(jellyfinBootstrap.run(api, ADMIN));
+    const refused = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
     expect(refused.message).toBe(
@@ -220,3 +222,5 @@ describe("Jellyfin's first-run setup", () => {
     const { api } = await jellyfin(setUp({ password: 'fake-someone-else' }));
-    expect((await failure(jellyfinBootstrap.run(api, ADMIN))).message).toContain(
+    expect(
+      (await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack))).message,
+    ).toContain(
       "refused the shared admin's sign-in: its startup wizard was finished with another login",
@@ -229,3 +233,3 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const failed = await failure(jellyfinBootstrap.run(api, ADMIN));
+    const failed = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
     expect(failed.status).toBe(502);
@@ -239,3 +243,5 @@ describe("Jellyfin's first-run setup", () => {
     });
-    expect((await failure(jellyfinBootstrap.run(both.api, ADMIN))).status).toBe(502);
+    expect(
+      (await failure(jellyfinBootstrap.run(both.api, ADMIN, contextOf().stack))).status,
+    ).toBe(502);
   });
@@ -259,3 +265,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    expect(await jellyfinBootstrap.run(api, ADMIN)).toBe('2'.repeat(32));
+    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toBe(
+      '2'.repeat(32),
+    );
     expect(state.apiKeys).toHaveLength(4);
@@ -273,3 +281,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    expect(await jellyfinBootstrap.run(api, ADMIN)).toBe('8'.repeat(32));
+    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toBe(
+      '8'.repeat(32),
+    );
   });
@@ -284,3 +294,3 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const made = await jellyfinBootstrap.run(api, ADMIN);
+    const made = await jellyfinBootstrap.run(api, ADMIN, contextOf().stack);
     expect(made).not.toBe(KEY);
@@ -293,3 +303,3 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const failed = await failure(jellyfinBootstrap.run(api, ADMIN));
+    const failed = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
     expect(failed.message).toBe(
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/engine/src/http packages/engine/src/plan/bootstrap.test.ts packages/engine/src/apply packages/engine/src/integrations/wire.test.ts catalog/jellyfin`
Expected: FAIL. 12 tests fail in 4 files:
- `client.test.ts`, 3: `api.session is not a function`;
- `plan/bootstrap.test.ts`, 2: a setup without a key is planned from a key it can't
  have: its file says it is done, and it is listed all the same
  (`expected { changes: [ { …(2) } ], …(1) } to deeply equal { changes: [], diagnostics: [] }`),
  and an unreadable file draws no warning (`expected [] to have a length of 1 but got +0`);
- `apply.test.ts`, 6: the two claimed-setup messages still say `its wizard was finished`;
  the fixture's sign-in is run without the stack (`stack.apps` of undefined), so the step
  fails (`expected [ { severity: 'error', …(3) } ] to deeply equal []`, and `'failed'` for
  `'success'`); the setup that waits fails the step, so the wire step is skipped
  (`expected [ [ 'keys', '', 'done' ], …(7) ] to deeply equal [ …(8) ]`); and a failure
  doesn't say the setup after it waits;
- `wire.test.ts`, 1: the waiting app's resources are wired
  (`expected [ 'sonarr.login created', …(2) ] to deeply equal [ 'jellyfin.free created' ]`).

"keeps unpublished, and fails, an app with a setup but no API to finish it through"
passes before Step 3: it pins S5's behaviour, which the new ordering must keep (such an
app goes last, and fails, unpublished).

- [ ] **Step 3: Write the client, the contract, plan, the bootstrap step and the wire step**

**Change** `packages/engine/src/http/client.ts`:

```diff
diff --git a/packages/engine/src/http/client.ts b/packages/engine/src/http/client.ts
index 3470650..59bfa3c 100644
--- a/packages/engine/src/http/client.ts
+++ b/packages/engine/src/http/client.ts
@@ -106,2 +106,4 @@ export interface AppApiOptions {
   key?: { scheme: KeyScheme; value?: string };
+  /** A session's cookie, sent in place of the key: what a session client carries. */
+  cookie?: { name: string; value: string };
   /**
@@ -179,3 +181,3 @@ export interface AppApi {
     path: string,
-    fields: Readonly<Record<string, string>>,
+    fields: Readonly<Record<string, unknown>>,
     schema: z.ZodType<T>,
@@ -183,2 +185,15 @@ export interface AppApi {
   ): Promise<T | undefined>;
+  /**
+   * POST `fields` as JSON, without the key, to an app's own sign-in that keeps its session
+   * in the cookie `cookie` (Seerr's `connect.sid`): the same app's API, carrying that
+   * cookie in place of the key, for what only the session can do, such as signing out;
+   * or undefined when the app refuses the sign-in (401). It is sent as `signIn` is, and
+   * the cookie is kept out of every message, as `secrets`, the values it sends, are.
+   */
+  session(
+    path: string,
+    fields: Readonly<Record<string, unknown>>,
+    cookie: string,
+    secrets: readonly string[],
+  ): Promise<AppApi | undefined>;
   /** Wait, until the deadline, for `path` to answer 200 without the key. */
@@ -205,2 +220,4 @@ interface Answer {
   location: string | undefined;
+  /** Each Set-Cookie header, as it came. */
+  cookies: readonly string[];
   body: string;
@@ -254,3 +271,6 @@ export function createAppApi(options: AppApiOptions): AppApi {
   // What the client sends is redacted whether or not the caller listed it.
-  const sent = options.key?.value === undefined ? [] : [options.key.value];
+  const sent = [
+    ...(options.key?.value === undefined ? [] : [options.key.value]),
+    ...(options.cookie === undefined ? [] : [options.cookie.value]),
+  ];
   const cleanAlways = redactor([...options.secrets, ...sent]);
@@ -280,2 +300,5 @@ export function createAppApi(options: AppApiOptions): AppApi {
       }
+      if (options.cookie !== undefined && !call.anonymous) {
+        headers.Cookie = `${options.cookie.name}=${options.cookie.value}`;
+      }
       if (call.body !== undefined) {
@@ -315,2 +338,3 @@ export function createAppApi(options: AppApiOptions): AppApi {
                 location: res.headers.location,
+                cookies: res.headers['set-cookie'] ?? [],
                 body: Buffer.concat(chunks).toString('utf8'),
@@ -587,2 +611,29 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
+    async session(path, fields, cookie, secrets) {
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
+      if (answer.status === 401) return undefined;
+      const value = cookieOf(answer.cookies, cookie);
+      if (value === undefined) {
+        throw failure(call, `signed in, but set no ${cookie} cookie`, {
+          kind: 'protocol',
+        });
+      }
+      return createAppApi({
+        ...options,
+        secrets: [...options.secrets, ...sent, ...secrets],
+        key: { scheme: options.key?.scheme ?? 'x-api-key' },
+        cookie: { name: cookie, value },
+      });
+    },
     async ready(path) {
@@ -605,2 +656,15 @@ export function createAppApi(options: AppApiOptions): AppApi {
 
+/** The value of the cookie `name` among Set-Cookie headers, if one sets it to something. */
+function cookieOf(headers: readonly string[], name: string): string | undefined {
+  for (const header of headers) {
+    const [pair = ''] = header.split(';');
+    const at = pair.indexOf('=');
+    if (at > 0 && pair.slice(0, at).trim() === name) {
+      const value = pair.slice(at + 1).trim();
+      if (value !== '') return value;
+    }
+  }
+  return undefined;
+}
+
 function toValues(secrets: readonly string[]): Record<string, string> {
```

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index a50982a..e461415 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -5,2 +5,3 @@ import type { AppApi, KeyScheme } from '../http/client';
 import type { Integration } from '../integrations/types';
+import type { ResolvedStack } from '../resolver/resolve';
 
@@ -122,7 +123,11 @@ export interface ApiSpec {
  * over the wiring network, without a key: Jellyfin's startup wizard, then the API key that
- * only the app can make.
+ * only the app can make; Seerr's first sign-in, through Jellyfin.
  */
 export interface Bootstrap {
-  /** The secret the setup makes, which the app creates (`createdBy: 'app'`): its key. */
-  secret: string;
+  /**
+   * The secret the setup makes, which the app creates (`createdBy: 'app'`): its key. None
+   * when Mediaplane chose the app's key (Seerr's, in `API_KEY`): its `done` file alone
+   * then says whether the setup is done.
+   */
+  secret?: string;
   /**
@@ -135,7 +140,14 @@ export interface Bootstrap {
   /**
-   * Finish what is left of the setup as the shared admin, and give the secret it made, or
-   * the one the app already holds for Mediaplane. Throws AppApiError, of kind `auth` when
-   * the app refuses the shared admin: an app the plan started unpublished then stays so.
+   * Finish what is left of the setup as the shared admin, in `stack`, and give the secret
+   * it made, or the one the app already holds for Mediaplane; undefined for a setup that
+   * makes none. Throws AppApiError, of kind `auth` when the app refuses the shared admin:
+   * an app the plan started unpublished then stays so. Throws SetupWaiting when another
+   * app the setup goes through isn't ready for it: Jellyfin refusing the shared admin that
+   * Seerr signs in as.
    */
-  run(api: AppApi, admin: { username: string; password: string }): Promise<string>;
+  run(
+    api: AppApi,
+    admin: { username: string; password: string },
+    stack: ResolvedStack,
+  ): Promise<string | undefined>;
 }
```

**Change** `packages/engine/src/plan/bootstrap.ts`:

```diff
diff --git a/packages/engine/src/plan/bootstrap.ts b/packages/engine/src/plan/bootstrap.ts
index 292be5f..054c1b4 100644
--- a/packages/engine/src/plan/bootstrap.ts
+++ b/packages/engine/src/plan/bootstrap.ts
@@ -28,6 +28,7 @@ export interface BootstrapPlan {
  * says the setup is done, when nobody can claim it any more. A file Mediaplane can't read
- * says nothing, so the stored key decides, with a warning that it can't tell. An app with a
- * setup that runs inside another app's network is an error: that app publishes its ports,
- * and `ports: !reset []` on the app's own service can't unpublish them. Reads only;
- * writes nothing.
+ * says nothing, so the stored key decides, with a warning that it can't tell; for a setup
+ * that makes no key (Seerr's), there is none to decide, so the app starts unpublished and
+ * is set up again, with that warning. An app with a setup that runs inside another app's
+ * network is an error: that app publishes its ports, and `ports: !reset []` on the app's
+ * own service can't unpublish them. Reads only; writes nothing.
  */
@@ -52,5 +53,10 @@ export async function inspectBootstrap(
     }
-    const stored = store.apps[app.def.id]?.[setup.secret] !== undefined;
+    // A key the app made says its setup was done once; without one, its file alone says.
+    const made =
+      setup.secret !== undefined && store.apps[app.def.id]?.[setup.secret] !== undefined;
     const done = await appSetupDone(stack.home, app);
-    if (done === undefined && stored) {
+    if (done === undefined && (made || setup.secret === undefined)) {
+      const decides = made
+        ? 'the stored key decides'
+        : `${app.def.name} starts unpublished, and is set up again, until it can`;
       diagnostics.push(
@@ -58,3 +64,3 @@ export async function inspectBootstrap(
           'bootstrap.unreadable',
-          `Mediaplane can't read the file in ${app.def.name}'s appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; the stored key decides`,
+          `Mediaplane can't read the file in ${app.def.name}'s appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; ${decides}`,
           { hint: `check the permissions of appdata/${app.def.id}` },
@@ -63,3 +69,5 @@ export async function inspectBootstrap(
     }
-    if (stored && done !== false) continue;
+    // Set up already: its key made, and its file not saying otherwise; or, for a setup
+    // that makes no key, its file saying so.
+    if (setup.secret === undefined ? done === true : made && done !== false) continue;
     changes.push({ app: app.def.id, unpublished: done !== true });
```

**Change** `packages/engine/src/apply/bootstrap.ts`:

```diff
diff --git a/packages/engine/src/apply/bootstrap.ts b/packages/engine/src/apply/bootstrap.ts
index b329bc3..3ff8db4 100644
--- a/packages/engine/src/apply/bootstrap.ts
+++ b/packages/engine/src/apply/bootstrap.ts
@@ -9,2 +9,3 @@ import {
   WIRING_RUNBOOK,
+  wiringOrder,
   type ReachedApp,
@@ -39,2 +40,19 @@ export interface BootstrapOptions {
 
+/**
+ * A first-run setup that can't run yet, because another app it goes through isn't ready
+ * for it: Jellyfin refusing the shared admin that Seerr signs in as, until the wire step
+ * sets Jellyfin's admin. It leaves the app as it was, unpublished, and doesn't fail the
+ * step: the wire step runs, skipping the app's resources, and the next apply sets it up.
+ * Its message is said to the user.
+ */
+export class SetupWaiting extends Error {
+  override readonly name = 'SetupWaiting';
+}
+
+/** An app whose first-run setup waits, and why (SetupWaiting). */
+export interface WaitingSetup {
+  app: string;
+  reason: string;
+}
+
 /** The first-run setup failed: what it said, and what to do. It keeps no cause. */
@@ -72,5 +90,10 @@ function withSecret(
  * starts again, publishing every app the plan started unpublished, but one whose setup
- * is still open: nobody else ever reaches an open setup. Returns the store with the new
- * keys and what it did; throws BootstrapFailed when a setup failed, once it has published
- * what it can.
+ * is still open: nobody else ever reaches an open setup.
+ *
+ * The apps go in the order of their integrations' `after`, so Jellyfin is set up before
+ * Seerr signs in through it. A setup that waits (SetupWaiting), or one after an app whose
+ * setup failed or waits, is left as it is, unpublished, and doesn't fail the step.
+ *
+ * Returns the store with the new keys, what it did, and the apps whose setup waits;
+ * throws BootstrapFailed when a setup failed, once it has published what it can.
  */
@@ -78,8 +101,16 @@ export async function bootstrapApps(
   options: BootstrapOptions,
-): Promise<{ store: SecretStore; detail: string }> {
+): Promise<{ store: SecretStore; detail: string; waiting: WaitingSetup[] }> {
   const { stack, runtime } = options;
-  const apps = options.pending.flatMap((change) => {
-    const app = stack.apps.find((a) => a.def.id === change.app);
-    return app?.def.bootstrap === undefined ? [] : [app];
-  });
+  // An app without an API isn't in the wiring order: it goes last, and setUp fails it.
+  const order = wiringOrder(stack).map((app) => app.def.id);
+  const rank = (app: ResolvedApp) => {
+    const at = order.indexOf(app.def.id);
+    return at < 0 ? order.length : at;
+  };
+  const apps = options.pending
+    .flatMap((change) => {
+      const app = stack.apps.find((a) => a.def.id === change.app);
+      return app?.def.bootstrap === undefined ? [] : [app];
+    })
+    .sort((a, b) => rank(a) - rank(b));
   const admin = await adminLogin(stack.config, options.home, options.store, options.env);
@@ -108,4 +139,7 @@ export async function bootstrapApps(
   let store = options.store;
-  const done: string[] = [];
+  const saved: string[] = [];
   const failed: string[] = [];
+  const waiting: WaitingSetup[] = [];
+  /** The apps whose setup failed or waits: one that comes after them waits too. */
+  const unfinished: ResolvedApp[] = [];
   const stillOpen: string[] = [];
@@ -113,9 +147,19 @@ export async function bootstrapApps(
     const change = options.pending.find((p) => p.app === app.def.id);
-    const result = await setUp(app, reached.get(app.def.id), admin, {
-      unpublished: change?.unpublished ?? true,
-      container: `${options.project}-${app.def.id}-1`,
-      home: options.home,
-    });
-    if (result.key !== undefined) {
-      const secret = app.def.bootstrap?.secret ?? '';
+    const before = unfinished.find((other) =>
+      (app.def.integration?.after ?? []).includes(other.def.id),
+    );
+    const result: SetUpResult =
+      before === undefined
+        ? await setUp(app, reached.get(app.def.id), admin, {
+            unpublished: change?.unpublished ?? true,
+            container: `${options.project}-${app.def.id}-1`,
+            home: options.home,
+            stack,
+          })
+        : {
+            waiting: `${app.def.name} waits for ${before.def.name}'s first-run setup, which isn't done`,
+            open: true,
+          };
+    const secret = app.def.bootstrap?.secret;
+    if (result.key !== undefined && secret !== undefined) {
       store = withSecret(store, app.def.id, secret, result.key);
@@ -123,8 +167,16 @@ export async function bootstrapApps(
       await writeSecretStore(options.home, store);
-      done.push(`${app.def.id}.${secret}`);
+      saved.push(`${app.def.id}.${secret}`);
+    }
+    // The key it just made too: a failure after it may come from the app's answer.
+    const clean = (said: string) =>
+      redact(
+        said,
+        redactionValues(result.key === undefined ? secrets : [...secrets, result.key]),
+      );
+    if (result.failure !== undefined) failed.push(clean(result.failure));
+    if (result.waiting !== undefined) {
+      waiting.push({ app: app.def.id, reason: clean(result.waiting) });
     }
-    if (result.failure !== undefined) {
-      // The key it just made too: a failure after it may come from the app's answer.
-      const known = result.key === undefined ? secrets : [...secrets, result.key];
-      failed.push(redact(result.failure, redactionValues(known)));
+    if (result.failure !== undefined || result.waiting !== undefined) {
+      unfinished.push(app);
       // An app the plan started published isn't unpublished now: its failure says so.
@@ -147,6 +199,12 @@ export async function bootstrapApps(
   }
+  const waits = waiting.map((w) => `${w.app} waits: ${w.reason}`);
   if (failed.length > 0) {
-    throw new BootstrapFailed(`the first-run setup failed: ${failed.join('; ')}`, HINT);
+    throw new BootstrapFailed(
+      `the first-run setup failed: ${[...failed, ...waits].join('; ')}`,
+      HINT,
+    );
   }
+  const finished = apps.filter((app) => !unfinished.includes(app)).map((a) => a.def.id);
   const published = unpublished.filter((app) => !stillOpen.includes(app));
+  const keys = saved.length === 0 ? '' : ` and saved ${saved.join(', ')}`;
   return {
@@ -154,5 +212,7 @@ export async function bootstrapApps(
     detail: [
-      `set up ${apps.map((a) => a.def.id).join(', ')} and saved ${done.join(', ')}`,
+      ...(finished.length === 0 ? [] : [`set up ${finished.join(', ')}${keys}`]),
       ...(published.length === 0 ? [] : [`published ${published.join(', ')}`]),
+      ...waits,
     ].join('; '),
+    waiting,
   };
@@ -160,3 +220,6 @@ export async function bootstrapApps(
 
-/** What `setUp` found: the key it made, and/or why the setup isn't finished or safe. */
+/**
+ * What `setUp` found: the key it made, and/or why the setup isn't finished or safe, or
+ * why it waits.
+ */
 interface SetUpResult {
@@ -164,2 +227,3 @@ interface SetUpResult {
   failure?: string;
+  waiting?: string;
   /** Whether the app must stay unpublished: it still looks open, or was claimed. */
@@ -192,3 +256,4 @@ async function looksOpen(
  * done its setup now looks (see `claimed`). One the plan started published was done
- * before this run, by hand say, and nobody can claim it.
+ * before this run, by hand say, and nobody can claim it. A setup that waits leaves the
+ * app as it was.
  */
@@ -198,3 +263,8 @@ async function setUp(
   admin: { username: string; password: string },
-  started: { unpublished: boolean; container: string; home: string },
+  started: {
+    unpublished: boolean;
+    container: string;
+    home: string;
+    stack: ResolvedStack;
+  },
 ): Promise<SetUpResult> {
@@ -207,3 +277,3 @@ async function setUp(
     await client.api.ready(api.ready);
-    const key = await bootstrap.run(client.api, admin);
+    const key = await bootstrap.run(client.api, admin, started.stack);
     const after = await looksOpen(bootstrap, client.api);
@@ -220,2 +290,8 @@ async function setUp(
   } catch (cause) {
+    if (cause instanceof SetupWaiting) {
+      return {
+        waiting: cause.message,
+        open: (await looksOpen(bootstrap, client.api)).open,
+      };
+    }
     if (!(cause instanceof AppApiError)) throw cause;
@@ -244,3 +320,3 @@ async function claimed(app: ResolvedApp, refused: string, home: string): Promise
   const next = done ? ', and the next apply would publish it' : '';
-  return `${said}: its wizard was finished with another login while Mediaplane set it up${next}. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says`;
+  return `${said}: its setup was finished with another login while Mediaplane set it up${next}. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says`;
 }
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 95aec62..a9f4a66 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -212,2 +212,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     await up(unpublished);
+    const [its, it] = unpublished.length === 1 ? ['its', 'it'] : ['their', 'them'];
     return [
@@ -217,5 +218,9 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
         ? []
-        : [`started ${unpublished.join(', ')} without its ports, to set it up first`]),
+        : [
+            `started ${unpublished.join(', ')} without ${its} ports, to set ${it} up first`,
+          ]),
     ].join('; ');
   });
+  /** The apps whose first-run setup waits: the wire step skips their resources. */
+  let waiting: string[] = [];
   if (shown.bootstrap.length > 0) {
@@ -235,2 +240,11 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
       store = set.store;
+      waiting = set.waiting.map((w) => w.app);
+      // The step goes on: the wire step may make the app ready, as the next apply finds.
+      for (const w of set.waiting) {
+        steps.diagnostics.push(
+          warning('bootstrap.waiting', w.reason, {
+            hint: `the rest of the stack is wired without ${w.app}, and the next apply sets it up; if it still waits, see ${runbookUrl('wiring-failed')}`,
+          }),
+        );
+      }
       return set.detail;
@@ -252,2 +266,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
         planned: shown.wiring,
+        waiting,
         ...(options.wiring === undefined ? {} : { seams: options.wiring }),
@@ -513,2 +528,3 @@ function remaining(result: PlanResult): string {
     ...result.unhealthy,
+    ...result.bootstrap.map((b) => `${b.app} (first-run setup)`),
     // An unknown one says why: its reason names the app and what failed, redacted.
```

**Change** `packages/engine/src/integrations/wire.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 9e19d21..5b2c0fb 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -49,2 +49,7 @@ export interface WireOptions {
   planned?: readonly WiringChange[];
+  /**
+   * Apps whose first-run setup waits (the bootstrap step's SetupWaiting): their resources
+   * are skipped, and so is what requires them.
+   */
+  waiting?: readonly string[];
   seams?: WiringSeams;
@@ -146,2 +151,14 @@ export async function wire(options: WireOptions): Promise<string[]> {
     const targets = wiringTargets(ctx);
+    if (options.waiting?.includes(app.def.id) === true) {
+      for (const target of targets) {
+        skipped.push(target);
+        options.record({
+          step: 'wire',
+          resource: target,
+          result: 'skipped',
+          detail: `${app.def.id}'s first-run setup waits`,
+        });
+      }
+      continue;
+    }
     const client = reached.get(app.def.id);
```

- [ ] **Step 4: Run them to see them pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog/jellyfin/integration.test.ts
git commit -m "feat(engine): first-run setups that make no key, run after the apps they sign in through, and can wait; a sign-in session in the typed client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1632 tests pass in 81 files.

---

### Task 3: Seerr signed in through Jellyfin before it is published; not wired with Plex yet

Seerr's setup is open to anyone on its port until its first sign-in. This task gives
Seerr its API and its setup, so `apply` starts it unpublished and signs it in through
Jellyfin as the shared admin first, and keeps it as it was on a Plex stack.

Decision: Seerr's first sign-in is a first-run setup (decisions 1, 4).
Decision: on a Plex stack the resolver drops Seerr's API, integration and setup, and its
login says Slice 7; on a Jellyfin stack it is `'shared'` (decision 6).
Decision: its API is ready at `/api/v1/settings/public` and checked at `/api/v1/auth/me`
(decision 7).

**Files:**
- Create: `catalog/seerr/bootstrap.ts`
- Modify: `catalog/seerr/app.ts`, `packages/engine/src/catalog/types.ts`,
  `packages/engine/src/resolver/resolve.ts`; `catalog/seerr/README.md` (generated)
- Test: `catalog/seerr/bootstrap.test.ts` (new), `catalog/catalog.test.ts`,
  `catalog/render.test.ts`, `packages/engine/src/resolver/resolve.test.ts`,
  `packages/cli/src/credentials.test.ts`

**Interfaces:**
- **Consumes:** Task 1's fake Seerr; Task 2's `Bootstrap`, `SetupWaiting` and
  `AppApi.session`; S5's `serviceAddress`.
- **Produces:**
  - `AppDefinition.notWiredYet?(config: StackConfig): { comingIn: string } | undefined`,
    applied by `resolveStack`;
  - `seerrBootstrap: Bootstrap` (`catalog/seerr/bootstrap.ts`), with
    `done: { path: 'settings.json', pattern: /"mediaServerType":\s*[123]\b/ }`;
  - Seerr's catalog entry with `api`, `bootstrap`, `notWiredYet` and `login: 'shared'`.

- [ ] **Step 1: Write the failing tests**

**Create** `catalog/seerr/bootstrap.test.ts`:

```ts
import {
  AppApiError,
  createAppApi,
  SetupWaiting,
  type ResolvedStack,
} from '@mediaplane/engine';
import {
  fakeStackApis,
  freshAppState,
  SEERR_JELLYFIN,
  wiringStack,
  type FakeAppState,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { seerrBootstrap } from './bootstrap';

const PASSWORD = 'fake-admin-password';
const ADMIN = { username: 'admin', password: PASSWORD };
const JELLYFIN_KEY = '7'.repeat(32);
const SEERR_KEY = '5'.repeat(32);

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;

/** A Jellyfin that Mediaplane set up: its wizard done, the shared admin, and its key. */
function jellyfinSetUp(more: Partial<FakeAppState> = {}): FakeAppState {
  return {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: PASSWORD,
    apiKeys: [
      {
        AccessToken: JELLYFIN_KEY,
        AppName: 'Mediaplane',
        DateCreated: '2026-10-15T12:00:00.000Z',
      },
    ],
    ...more,
  };
}

/** The stack's fakes, Seerr as it first starts unless `seerr` says, and a client of it. */
async function seerrOf(
  jellyfin: FakeAppState = jellyfinSetUp(),
  seerr: Partial<FakeAppState['seerr']> = {},
) {
  const apis = await fakeStackApis();
  apis.apps.set('jellyfin', jellyfin);
  const state = { ...freshAppState(), key: SEERR_KEY };
  Object.assign(state.seerr, structuredClone(seerr));
  apis.apps.set('seerr', state);
  const api = createAppApi({
    name: 'Seerr',
    service: 'seerr',
    port: 5055,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SEERR_KEY },
    secrets: [PASSWORD, JELLYFIN_KEY, SEERR_KEY],
    retry: { deadlineMs: 0 },
  });
  const calls = () => apis.app.requests.map(callOf);
  return { api, state, calls, stack: wiringStack(catalog, STACK) };
}

/** "METHOD /path" of a request. */
const callOf = ({ method, path }: FakeRequest) => `${method} ${path}`;

/** What the call threw. */
async function thrown(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}

/** Seerr as its first sign-in left it: the admin, and Jellyfin at its service. */
const SET_UP = {
  mediaServerType: SEERR_JELLYFIN,
  users: ['admin'],
  jellyfin: { ip: 'jellyfin', port: 8096, apiKey: JELLYFIN_KEY, libraries: [] },
};

describe("Seerr's first-run setup", () => {
  it('signs in through Jellyfin as the shared admin, which sets it up, then signs out', async () => {
    const { api, state, calls, stack } = await seerrOf();
    expect(await seerrBootstrap.open(api)).toBe(true);
    // Its key does nothing yet.
    expect(await thrown(api.check('/api/v1/auth/me'))).toMatchObject({
      kind: 'auth',
      status: 403,
    });
    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
    expect(state.seerr).toMatchObject({
      mediaServerType: SEERR_JELLYFIN,
      users: ['admin'],
      jellyfin: { ip: 'jellyfin', port: 8096 },
      // Signed out again.
      sessions: [],
    });
    expect(await seerrBootstrap.open(api)).toBe(false);
    await api.check('/api/v1/auth/me');
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/public',
      'POST /api/v1/auth/jellyfin',
      'POST /api/v1/auth/logout',
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
    ]);
  });

  it("waits while Jellyfin refuses the shared admin's password, leaving Seerr open", async () => {
    const { api, state, stack } = await seerrOf(
      jellyfinSetUp({ password: 'fake-other-password' }),
    );
    const waited = await thrown(seerrBootstrap.run(api, ADMIN, stack));
    expect(waited).toBeInstanceOf(SetupWaiting);
    expect((waited as Error).message).toBe(
      "Seerr at http://seerr:5055 (127.0.0.1) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)",
    );
    expect(state.seerr.users).toEqual([]);
    expect(await seerrBootstrap.open(api)).toBe(true);
  });

  it("fails, in Seerr's words and without the password, when Seerr can't reach Jellyfin", async () => {
    const { api, stack } = await seerrOf(jellyfinSetUp({ up: false }));
    const failed = await thrown(seerrBootstrap.run(api, ADMIN, stack));
    expect(failed).toBeInstanceOf(AppApiError);
    expect((failed as AppApiError).message).toBe(
      'Seerr at http://seerr:5055 (127.0.0.1) refused the request (HTTP 404): INVALID_URL (POST /api/v1/auth/jellyfin)',
    );
  });

  it("takes as done a Seerr set up with the shared admin and the stack's Jellyfin, asked with the key, never the password", async () => {
    const { api, calls, stack } = await seerrOf(jellyfinSetUp(), SET_UP);
    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
    expect(calls()).toEqual([
      'GET /api/v1/settings/public',
      'GET /api/v1/auth/me',
      'GET /api/v1/settings/jellyfin',
    ]);
  });

  it.each([
    ['another admin', { users: ['someone'] }],
    ['another Jellyfin', { jellyfin: { ...SET_UP.jellyfin, ip: 'elsewhere' } }],
    ['no admin at all', { users: [] }],
  ])('refuses as not its own a Seerr set up with %s', async (_what, more) => {
    const { api, calls, stack } = await seerrOf(jellyfinSetUp(), { ...SET_UP, ...more });
    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack));
    expect(refused).toBeInstanceOf(AppApiError);
    expect(refused).toMatchObject({ kind: 'auth' });
    expect(calls()).not.toContain('POST /api/v1/auth/jellyfin');
  });

  it('fails in a stack with no Jellyfin to sign in through', async () => {
    const { api, calls } = await seerrOf();
    const plex: ResolvedStack = wiringStack(
      catalog,
      STACK.replace(
        'media_server: jellyfin',
        'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
      ),
    );
    expect(await thrown(seerrBootstrap.run(api, ADMIN, plex))).toMatchObject({
      kind: 'rejected',
      message:
        "Seerr at http://seerr:5055 (127.0.0.1) can't be set up: the stack runs no Jellyfin for it to sign in through",
    });
    expect(calls()).toEqual([]);
  });

  it('says it is done once settings.json names a media server', () => {
    const { pattern } = seerrBootstrap.done;
    expect(seerrBootstrap.done.path).toBe('settings.json');
    // As Seerr writes it: JSON.stringify with a one-space indent.
    expect(pattern.test('{\n "main": {\n  "mediaServerType": 2,\n')).toBe(true);
    expect(pattern.test('{\n "main": {\n  "mediaServerType": 4,\n')).toBe(false);
    expect(pattern.test('{}')).toBe(false);
  });
});
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 14cbd17..4985541 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -2,3 +2,7 @@ import { readdir, readFile } from 'node:fs/promises';
 import { stackJsonSchema } from '@mediaplane/engine';
-import { undocumented, type DescribedSchema } from '@mediaplane/engine/testing';
+import {
+  undocumented,
+  wiringStack,
+  type DescribedSchema,
+} from '@mediaplane/engine/testing';
 import { describe, expect, it } from 'vitest';
@@ -39,2 +43,3 @@ describe('catalog', () => {
       'radarr',
+      'seerr',
       'sonarr',
@@ -58,9 +63,15 @@ describe('catalog', () => {
 
-  it('gives a first-run setup only to an app whose key it makes, and that its API carries', () => {
+  it('gives a first-run setup to the apps that open one to anyone, each with the key its API carries', () => {
     const set = catalog.filter((app) => app.bootstrap !== undefined);
-    expect(set.map((app) => app.id)).toEqual(['jellyfin']);
+    expect(set.map((app) => app.id)).toEqual(['jellyfin', 'seerr']);
     for (const app of set) {
-      const secret = app.bootstrap?.secret ?? '';
-      expect(app.secrets[secret]).toEqual({ createdBy: 'app' });
-      expect(app.api?.key.secret).toBe(secret);
+      const key = app.api?.key.secret ?? '';
+      const made = app.bootstrap?.secret;
+      // One whose setup makes its key names it; one that makes none has a key of
+      // Mediaplane's, which its done file can't stand in for.
+      if (made === undefined) expect(app.secrets[key]).toEqual({ generate: 'hex32' });
+      else {
+        expect(made).toBe(key);
+        expect(app.secrets[made]).toEqual({ createdBy: 'app' });
+      }
       expect(app.bootstrap?.done.path).not.toMatch(/^\/|\.\./);
@@ -69,2 +80,29 @@ describe('catalog', () => {
 
+  it("isn't wired with Plex yet, Seerr, whose login there comes with Slice 7", () => {
+    const seerr = (server: string) =>
+      wiringStack(
+        catalog,
+        `version: 1
+paths: { data: /srv/data }
+network: { bind: localhost }
+${server}
+apps:
+  sonarr: {}
+  qbittorrent: { vpn: false }
+  seerr: {}
+`,
+      ).apps.find((app) => app.def.id === 'seerr')?.def;
+    const plex = seerr('media_server: plex\nplex: { token: { env: PLEX_TOKEN } }');
+    expect([plex?.api, plex?.integration, plex?.bootstrap]).toEqual([
+      undefined,
+      undefined,
+      undefined,
+    ]);
+    expect(plex?.login).toEqual({ comingIn: 'Slice 7' });
+    const jellyfin = seerr('media_server: jellyfin');
+    expect(jellyfin?.api).toBeDefined();
+    expect(jellyfin?.bootstrap).toBeDefined();
+    expect(jellyfin?.login).toBe('shared');
+  });
+
   it("waits for Jellyfin's server itself: its /health says 200 Degraded at every start", () => {
@@ -96,3 +134,3 @@ describe('catalog', () => {
       ),
-    ).toEqual({ plex: 'Slice 7', seerr: 'Slice 6' });
+    ).toEqual({ plex: 'Slice 7' });
   });
```

**Change** `catalog/render.test.ts`:

```diff
diff --git a/catalog/render.test.ts b/catalog/render.test.ts
index 35d3eb6..4ae7f0c 100644
--- a/catalog/render.test.ts
+++ b/catalog/render.test.ts
@@ -174,2 +174,3 @@ describe('the real catalog', () => {
       'radarr default,wiring',
+      'seerr default,wiring',
       'sonarr default,wiring',
@@ -295,2 +296,5 @@ describe('the real catalog', () => {
     expect(compose.services.jellyfin).toBeUndefined();
+    // Seerr isn't wired with Plex until Slice 7: nothing calls it, so it stays off the
+    // wiring network.
+    expect(compose.services.seerr?.networks).toBeUndefined();
   });
```

**Change** `packages/engine/src/resolver/resolve.test.ts`:

```diff
diff --git a/packages/engine/src/resolver/resolve.test.ts b/packages/engine/src/resolver/resolve.test.ts
index 7c36977..d29d639 100644
--- a/packages/engine/src/resolver/resolve.test.ts
+++ b/packages/engine/src/resolver/resolve.test.ts
@@ -82,2 +82,45 @@ describe('resolveStack: which apps run', () => {
 
+describe('resolveStack: apps not wired yet', () => {
+  it('drops the API, integration and setup of an app not wired in this stack yet, and says when its login comes', () => {
+    const wired: Partial<AppDefinition> = {
+      api: {
+        port: 'web',
+        ready: '/ready',
+        key: { secret: 'apiKey', scheme: 'x-api-key' },
+        check: '/check',
+      },
+      integration: { after: [], resources: [] },
+      login: 'shared',
+      notWiredYet: (config) =>
+        config.media_server === 'plex' ? { comingIn: 'Slice 7' } : undefined,
+    };
+    const catalog = fixtureCatalog.map((def) =>
+      def.id === 'sonarr' ? { ...def, ...wired } : def,
+    );
+    const resolveWith = (server: string) =>
+      resolveStack(
+        fixtureConfig(
+          `${BASE.replace('media_server: jellyfin', server)}apps:\n  sonarr: {}\n  qbittorrent: {}\n`,
+        ),
+        catalog,
+        FIXTURE_HOST,
+        '/opt/mediaplane',
+      );
+    const withJellyfin = app(resolveWith('media_server: jellyfin'), 'sonarr')?.def;
+    expect(withJellyfin?.api).toBeDefined();
+    expect(withJellyfin?.integration).toBeDefined();
+    expect(withJellyfin?.login).toBe('shared');
+    const withPlex = app(
+      resolveWith('media_server: plex\nplex: { token: { env: PLEX_TOKEN } }'),
+      'sonarr',
+    )?.def;
+    expect(withPlex?.api).toBeUndefined();
+    expect(withPlex?.integration).toBeUndefined();
+    expect(withPlex?.bootstrap).toBeUndefined();
+    expect(withPlex?.login).toEqual({ comingIn: 'Slice 7' });
+    // Everything else stays as the catalog has it.
+    expect(withPlex?.ports).toEqual(withJellyfin?.ports);
+  });
+});
+
 describe('resolveStack: options and checks', () => {
```

**Change** `packages/cli/src/credentials.test.ts`:

```diff
diff --git a/packages/cli/src/credentials.test.ts b/packages/cli/src/credentials.test.ts
index 74810cb..58ee395 100644
--- a/packages/cli/src/credentials.test.ts
+++ b/packages/cli/src/credentials.test.ts
@@ -86,3 +86,3 @@ describe('mediaplane credentials', () => {
         'qBittorrent  http://127.0.0.1:8080',
-        'Seerr        http://127.0.0.1:5055  (its login arrives in Slice 6)',
+        'Seerr        http://127.0.0.1:5055',
         'Sonarr       http://127.0.0.1:8989',
@@ -93,2 +93,20 @@ describe('mediaplane credentials', () => {
 
+  it("says Seerr's login arrives with Slice 7 on a Plex stack, as Plex's does", async () => {
+    const home = await makeHome({
+      stack: STACK.replace(
+        'media_server: jellyfin',
+        'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
+      ),
+    });
+    const term = capture({ PLEX_TOKEN: 'fake-plex-token' });
+    expect(await run(['credentials', '--home', home], term.io, deps)).toBe(0);
+    expect(term.stdout().split('\n').slice(4)).toEqual([
+      'Plex         http://127.0.0.1:32400  (its login arrives in Slice 7)',
+      'qBittorrent  http://127.0.0.1:8080',
+      'Seerr        http://127.0.0.1:5055  (its login arrives in Slice 7)',
+      'Sonarr       http://127.0.0.1:8989',
+      '',
+    ]);
+  });
+
   it('leaves the password out of JSON unless --reveal is given', async () => {
@@ -120,4 +138,3 @@ describe('mediaplane credentials', () => {
           urls: ['http://127.0.0.1:5055'],
-          login: 'not-yet',
-          comingIn: 'Slice 6',
+          login: 'shared',
         },
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog packages/engine/src/resolver packages/cli/src/credentials.test.ts`
Expected: FAIL. `catalog/seerr/bootstrap.test.ts` doesn't load
(`Cannot find module './bootstrap'`), and 9 tests fail in 4 files:
- `catalog.test.ts`, 4: Seerr has no API (`expected [ 'jellyfin', 'prowlarr', …(3) ] …`)
  and no setup (`expected [ 'jellyfin' ] to deeply equal [ 'jellyfin', 'seerr' ]`), and
  its login still says Slice 6 (`expected { comingIn: 'Slice 6' } to deeply equal { comingIn: 'Slice 7' }`,
  and `{ plex: 'Slice 7', seerr: 'Slice 6' }` among the logins to come);
- `render.test.ts`, 1: Seerr isn't on the wiring network
  (`expected [ 'gluetun default,wiring', …(4) ] to deeply equal [ …(5) ]`);
- `credentials.test.ts`, 3: Seerr's login says it arrives in Slice 6;
- `resolve.test.ts`, 1: the app keeps its API on a Plex stack
  (`expected { port: 'web', ready: '/ready', …(2) } to be undefined`).

- [ ] **Step 3: Write `notWiredYet`, Seerr's setup and its catalog entry**

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index e461415..93ec230 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -185,2 +185,9 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   bootstrap?: Bootstrap;
+  /**
+   * The slice that wires the app in a stack with `config`, while Mediaplane doesn't yet,
+   * else undefined: the resolver then leaves out its `api`, `integration` and
+   * `bootstrap`, so nothing calls it there, and its `login` says that slice. Seerr with
+   * Plex, until Slice 7.
+   */
+  notWiredYet?(config: StackConfig): { comingIn: string } | undefined;
   /** App-specific settings under apps.<id> in stack.yaml. */
```

**Change** `packages/engine/src/resolver/resolve.ts`:

```diff
diff --git a/packages/engine/src/resolver/resolve.ts b/packages/engine/src/resolver/resolve.ts
index 176c2e8..444ba9d 100644
--- a/packages/engine/src/resolver/resolve.ts
+++ b/packages/engine/src/resolver/resolve.ts
@@ -59,2 +59,14 @@ const DEFAULT_SETTINGS: AppSettings = { enabled: true, env: {} };
 
+/**
+ * `def` as a stack with `config` runs it: without its API, integration and first-run
+ * setup, and with its login still to come, where Mediaplane doesn't wire it yet
+ * (`notWiredYet`).
+ */
+function wiredIn(def: AppDefinition, config: StackConfig): AppDefinition {
+  const later = def.notWiredYet?.(config);
+  if (later === undefined) return def;
+  const { api: _api, integration: _integration, bootstrap: _bootstrap, ...rest } = def;
+  return { ...rest, login: later };
+}
+
 /** "download-client:torrent" satisfies "download-client". */
@@ -105,3 +117,3 @@ export function resolveStack(
     return {
-      def,
+      def: wiredIn(def, config),
       settings,
```

**Create** `catalog/seerr/bootstrap.ts`:

```ts
import {
  AppApiError,
  serviceAddress,
  SetupWaiting,
  type AppApi,
  type Bootstrap,
} from '@mediaplane/engine';
import { z } from 'zod';

/** Seerr's media-server types (`MediaServerType`): Jellyfin's, and none yet. */
const JELLYFIN = 2;
const NOT_CONFIGURED = 4;

/** The sign-in through Jellyfin: Seerr's first one sets it up. */
const SIGN_IN = '/api/v1/auth/jellyfin';

const publicSettings = z.looseObject({ mediaServerType: z.number() });
const me = z.looseObject({ jellyfinUsername: z.string().nullable().optional() });
const jellyfinSettings = z.looseObject({ ip: z.string(), port: z.number() });

/**
 * Whether Seerr's setup is open: until its first sign-in sets its media server, anyone
 * who reaches it can sign in through a Jellyfin of their own and be its admin (probed).
 */
async function open(api: AppApi): Promise<boolean> {
  return (
    (await api.get('/api/v1/settings/public', publicSettings)).mediaServerType ===
    NOT_CONFIGURED
  );
}

/**
 * Seerr's first-run setup (spec §6.1, §6.4): its first sign-in, through Jellyfin, as the
 * shared admin that Jellyfin's setup made. That makes the shared admin Seerr's admin, and
 * sets Jellyfin, at its service and container port, as Seerr's media server. Mediaplane's
 * key, which Seerr takes from API_KEY, works from then on, so the session is signed out
 * of at once. The setup makes no key: Mediaplane chose Seerr's.
 * - Jellyfin refusing the shared admin's password (401) makes the setup wait
 *   (SetupWaiting): the wire step sets Jellyfin's admin, and the next apply signs in.
 * - Done already, as when Mediaplane couldn't read settings.json, it is Mediaplane's only
 *   when Seerr's admin is the shared admin and its Jellyfin the stack's: it is asked with
 *   the key, never by sending the password, which would go to whatever Jellyfin Seerr was
 *   set up with. Anything else is refused (`auth`), and Seerr stays unpublished.
 * - It is done once settings.json names a media server, which Seerr writes as the sign-in
 *   sets it.
 */
export const seerrBootstrap: Bootstrap = {
  done: { path: 'settings.json', pattern: /"mediaServerType":\s*[123]\b/ },
  open,
  async run(api, admin, stack) {
    const jellyfin = serviceAddress(
      stack.apps.find((app) => app.def.id === 'jellyfin'),
      'web',
    );
    if (jellyfin === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} can't be set up: the stack runs no Jellyfin for it to sign in through`,
        { kind: 'rejected' },
      );
    }
    if (!(await open(api))) {
      const { jellyfinUsername } = await api.get('/api/v1/auth/me', me);
      const held = await api.get('/api/v1/settings/jellyfin', jellyfinSettings);
      if (
        jellyfinUsername !== admin.username ||
        held.ip !== jellyfin.host ||
        held.port !== jellyfin.port
      ) {
        throw new AppApiError(
          `${api.name} at ${api.where} was set up with another login or another Jellyfin (GET /api/v1/auth/me, GET /api/v1/settings/jellyfin)`,
          { kind: 'auth', status: 403 },
        );
      }
      return undefined;
    }
    const session = await api.session(
      SIGN_IN,
      {
        username: admin.username,
        password: admin.password,
        hostname: jellyfin.host,
        port: jellyfin.port,
        useSsl: false,
        urlBase: '',
        serverType: JELLYFIN,
      },
      'connect.sid',
      [admin.password],
    );
    if (session === undefined) {
      throw new SetupWaiting(
        `${api.name} at ${api.where} can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST ${SIGN_IN})`,
      );
    }
    await session.submit('POST', '/api/v1/auth/logout');
    return undefined;
  },
};
```

**Change** `catalog/seerr/app.ts`:

```diff
diff --git a/catalog/seerr/app.ts b/catalog/seerr/app.ts
index f3e02dd..25d5f17 100644
--- a/catalog/seerr/app.ts
+++ b/catalog/seerr/app.ts
@@ -2,2 +2,3 @@ import { defineApp } from '@mediaplane/engine';
 import { z } from 'zod';
+import { seerrBootstrap } from './bootstrap';
 
@@ -32,2 +33,13 @@ export default defineApp({
   },
+  // Its key does nothing until its first sign-in has made its admin (probed).
+  api: {
+    port: 'web',
+    ready: '/api/v1/settings/public',
+    key: { secret: 'apiKey', scheme: 'x-api-key' },
+    check: '/api/v1/auth/me',
+  },
+  bootstrap: seerrBootstrap,
+  // With Plex, it signs in with your Plex account, which comes in Slice 7.
+  notWiredYet: (config) =>
+    config.media_server === 'jellyfin' ? undefined : { comingIn: 'Slice 7' },
   options: z.strictObject({
@@ -50,3 +62,3 @@ export default defineApp({
   extras: () => ({ init: true }),
-  login: { comingIn: 'Slice 6' },
+  login: 'shared',
   experimental: false,
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

Run: `pnpm vitest run catalog packages/engine/src/resolver packages/cli/src/credentials.test.ts`
Expected: PASS.

Run: `pnpm docs:generate`
Expected: it rewrites the facts in `catalog/seerr/README.md`: its API, on its `web` port,
with `apiKey` in the `X-Api-Key` header.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages
git commit -m "feat(catalog): Seerr set up before its port is published, signed in through Jellyfin as the shared admin, and not wired with Plex until Slice 7" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1645 tests pass in 82 files.

---

### Task 4: Seerr's links: Jellyfin with its libraries, Sonarr and Radarr, then `initialize`

Seerr is set up, but nothing is linked yet. This task adds its integration: Jellyfin as
its media server with the Movies and Shows libraries, Sonarr and Radarr with a quality
profile, their root folder and `isDefault`, then `initialize`. The profile needs the
contract's new `resolve`.

Decision: `seerr.media_server` keeps the key Seerr made while it works, checked through
Seerr's list of Jellyfin's users, and never sends `hostname` (decision 8).
Decision: the servers' key is checked with Seerr's own test of what it holds, tested
again with the stack's key to tell a refused key from an arr out of reach (decision 9).
Decision: a resource may `resolve` what only the app can say; the profile comes from the
arr through Seerr's test (decision 10).
Decision: `seerr.setup` sends `initialize` once the links are in place (decision 11).
Decision: a CLI-level `apply` with Seerr shows the whole flow, and a setup that waits for
Jellyfin's admin (decision 3).

**Files:**
- Create: `catalog/seerr/integration.ts`
- Modify: `packages/engine/src/integrations/types.ts`,
  `packages/engine/src/integrations/wiring.ts`, `catalog/sonarr/integration.ts`,
  `catalog/radarr/integration.ts`, `catalog/seerr/app.ts`; generated:
  `catalog/seerr/README.md`, `docs/reference/stack-yaml.md`,
  `docs/reference/stack.schema.json`
- Test: `catalog/seerr/integration.test.ts` (new), `catalog/catalog.test.ts`,
  `packages/engine/src/integrations/wiring.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1 to 3; S5's `LIBRARIES`, `secretOf`, `serviceAddress`; S3c's root
  folders.
- **Produces:**
  - `ResourceSpec.resolve?(api: AppApi, desired: DesiredResource, ctx: WiringContext): Promise<DesiredResource>`,
    which `examine` runs unless its options say `verify: false`;
  - `ROOT_FOLDER` from `catalog/sonarr/integration.ts` (`/data/media/tv`) and
    `catalog/radarr/integration.ts` (`/data/media/movies`);
  - `PREFERRED_PROFILES` (`['HD-1080p', 'Any']`) and Seerr's integration: after
    `jellyfin`, `radarr` and `sonarr`, resources `media_server`, `server_sonarr`,
    `server_radarr` and `setup`.

- [ ] **Step 1: Write the failing tests**

**Create** `catalog/seerr/integration.test.ts`:

```ts
import {
  AppApiError,
  createAppApi,
  type DesiredResource,
  type ResourceSpec,
  type WiringContext,
} from '@mediaplane/engine';
import {
  fakeStackApis,
  freshAppState,
  SERVARR_PROFILES,
  wiringStack,
  type FakeAppState,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { seerrBootstrap } from './bootstrap';
import integration from './integration';

const PASSWORD = 'fake-admin-password';
const ADMIN = { username: 'admin', password: PASSWORD };
const JELLYFIN_KEY = '7'.repeat(32);
const SEERR_KEY = '5'.repeat(32);
const SONARR_KEY = '1'.repeat(32);
const RADARR_KEY = '2'.repeat(32);
const KEYS = {
  jellyfin: { apiKey: JELLYFIN_KEY },
  seerr: { apiKey: SEERR_KEY },
  sonarr: { apiKey: SONARR_KEY },
  radarr: { apiKey: RADARR_KEY },
};

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  radarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;

/** Seerr's resource `name`. */
function resource(name: string): ResourceSpec {
  const spec = integration.resources.find((r) => r.name === name);
  if (spec === undefined) throw new Error(`Seerr has no resource ${name}`);
  return spec;
}

/** What Seerr's resources see in the stack `source`. */
function contextOf(source = STACK): WiringContext {
  const stack = wiringStack(catalog, source);
  const app = stack.apps.find((a) => a.def.id === 'seerr');
  if (app === undefined) throw new Error('no Seerr in the stack');
  return { stack, app, admin: ADMIN, keys: KEYS };
}

/** What `spec` wants, which the test stack always wants. */
function wanted(spec: ResourceSpec, ctx = contextOf()): DesiredResource {
  const desired = spec.desired(ctx);
  if (desired === undefined) throw new Error(`${spec.name} is wanted`);
  return desired;
}

/**
 * The stack's fakes: Jellyfin set up, with Movies and Shows; Sonarr and Radarr with their
 * keys and root folders; and Seerr, set up by its first sign-in. A client of Seerr, with
 * its key.
 */
async function seerr() {
  const apis = await fakeStackApis();
  const jellyfin: FakeAppState = {
    ...freshAppState(),
    wizard: 'done',
    user: 'admin',
    password: PASSWORD,
    apiKeys: [
      {
        AccessToken: JELLYFIN_KEY,
        AppName: 'Mediaplane',
        DateCreated: '2026-10-15T12:00:00.000Z',
      },
    ],
    libraries: [
      { Name: 'Movies', CollectionType: 'movies', Locations: [], LibraryOptions: {} },
      { Name: 'Shows', CollectionType: 'tvshows', Locations: [], LibraryOptions: {} },
    ],
  };
  apis.apps.set('jellyfin', jellyfin);
  const arr = (key: string, path: string): FakeAppState => ({
    ...freshAppState(),
    key,
    rootFolders: [{ id: 1, path }],
  });
  const sonarr = arr(SONARR_KEY, '/data/media/tv');
  const radarr = arr(RADARR_KEY, '/data/media/movies');
  apis.apps.set('sonarr', sonarr);
  apis.apps.set('radarr', radarr);
  const state: FakeAppState = { ...freshAppState(), key: SEERR_KEY };
  apis.apps.set('seerr', state);
  const api = createAppApi({
    name: 'Seerr',
    service: 'seerr',
    port: 5055,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-api-key', value: SEERR_KEY },
    secrets: [PASSWORD, JELLYFIN_KEY, SEERR_KEY, SONARR_KEY, RADARR_KEY],
    retry: { deadlineMs: 0 },
  });
  await seerrBootstrap.run(api, ADMIN, contextOf().stack);
  const calls = (from = 0) =>
    apis.app.requests.slice(from).map((r: FakeRequest) => `${r.method} ${r.path}`);
  return { api, apis, jellyfin, sonarr, radarr, state, calls };
}

/** What the call threw. */
async function thrown(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}

describe("Seerr's media server", () => {
  const spec = resource('media_server');

  it('is Jellyfin at its service, with Movies and Shows enabled, keeping the key Seerr made itself while it works', async () => {
    const { api, state, jellyfin, calls } = await seerr();
    const desired = wanted(spec);
    expect(desired).toEqual({
      name: 'Jellyfin',
      fields: { hostname: 'jellyfin', port: 8096, libraries: 'Movies,Shows' },
      secrets: { apiKey: JELLYFIN_KEY },
    });
    // Its first sign-in set Jellyfin, with a key of Seerr's own, and no library yet.
    const seerrKey = jellyfin.apiKeys.find((k) => k.AppName === 'Seerr')?.AccessToken;
    const observed = await spec.observe(api, undefined, desired);
    expect(observed).toEqual({
      id: null,
      name: 'Jellyfin',
      fields: { hostname: 'jellyfin', port: 8096, libraries: '' },
    });
    if (observed === undefined) throw new Error('observed');
    const before = calls().length;
    await spec.update(api, desired, observed);
    expect(calls(before)).toEqual([
      'GET /api/v1/settings/jellyfin/users',
      'POST /api/v1/settings/jellyfin/library/sync',
      'GET /api/v1/settings/jellyfin/library',
      `PUT /api/v1/settings/jellyfin/library/${state.seerr.jellyfin.libraries[0]?.id ?? ''}`,
      `PUT /api/v1/settings/jellyfin/library/${state.seerr.jellyfin.libraries[1]?.id ?? ''}`,
    ]);
    expect((await spec.observe(api, undefined, desired))?.fields.libraries).toBe(
      'Movies,Shows',
    );
    // Seerr's own key works: it stays, and nothing is logged for checking it.
    expect(state.seerr.jellyfin.apiKey).toBe(seerrKey);
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    expect(state.seerr.errors).toEqual([]);
  });

  it("gives Seerr Mediaplane's key once Jellyfin refuses its own, or Jellyfin moved", async () => {
    const { api, state, jellyfin } = await seerr();
    const desired = wanted(spec);
    jellyfin.apiKeys = jellyfin.apiKeys.filter((k) => k.AppName !== 'Seerr');
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    // The check fails, and Seerr logs that it did.
    expect(await spec.verify?.(api, desired, observed)).toBe(false);
    expect(state.seerr.errors).toHaveLength(1);
    await spec.update(api, desired, observed);
    expect(state.seerr.jellyfin).toMatchObject({ ip: 'jellyfin', apiKey: JELLYFIN_KEY });
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    // Pointed elsewhere by hand: put back, with the key.
    state.seerr.jellyfin.ip = 'elsewhere';
    const moved = await spec.observe(api, undefined, desired);
    expect(moved?.fields.hostname).toBe('elsewhere');
    if (moved === undefined) throw new Error('moved');
    await spec.update(api, desired, moved);
    expect(state.seerr.jellyfin.ip).toBe('jellyfin');
  });

  it('makes it when Seerr has no Jellyfin, and refuses to enable a library Jellyfin lacks', async () => {
    const { api, state, jellyfin } = await seerr();
    const desired = wanted(spec);
    state.seerr.jellyfin.ip = '';
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    expect(await spec.create(api, desired)).toEqual({ id: null });
    expect((await spec.observe(api, undefined, desired))?.fields).toEqual(desired.fields);
    const shows = jellyfin.libraries.find((l) => l.Name === 'Shows');
    if (shows !== undefined) shows.Name = 'Series';
    state.seerr.jellyfin.libraries = [];
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    const refused = await thrown(spec.update(api, desired, observed));
    expect(refused).toBeInstanceOf(AppApiError);
    expect((refused as Error).message).toBe(
      'Seerr at http://seerr:5055 (127.0.0.1) finds no Jellyfin library named Shows (POST /api/v1/settings/jellyfin/library/sync)',
    );
  });

  it('is wanted only with Jellyfin in the stack, and before Jellyfin has made its key', () => {
    const keyless = { ...contextOf(), keys: {} };
    expect(wanted(spec, keyless).secrets).toEqual({});
    const ctx = contextOf();
    const noJellyfin = {
      ...ctx,
      stack: {
        ...ctx.stack,
        apps: ctx.stack.apps.filter((a) => a.def.id !== 'jellyfin'),
      },
    };
    expect(spec.desired(noJellyfin)).toBeUndefined();
  });
});

describe.each([
  ['sonarr', 'Sonarr', 8989, '/data/media/tv', SONARR_KEY],
  ['radarr', 'Radarr', 7878, '/data/media/movies', RADARR_KEY],
] as const)("Seerr's %s server", (arr, name, port, folder, key) => {
  const spec = resource(`server_${arr}`);

  it("wants the arr at its service, its root folder, by default, and the profile it prefers from the arr's own", async () => {
    const { api, sonarr, radarr } = await seerr();
    const desired = wanted(spec);
    expect(desired).toEqual({
      name: `${name} (Mediaplane)`,
      fields: { hostname: arr, port, activeDirectory: folder, isDefault: true },
      secrets: { apiKey: key },
    });
    const ctx = contextOf();
    const resolved = await spec.resolve?.(api, desired, ctx);
    expect(resolved?.fields.activeProfile).toBe('HD-1080p');
    const held = arr === 'sonarr' ? sonarr : radarr;
    // Without HD-1080p, Any; without either, the arr's first.
    held.profiles = SERVARR_PROFILES.filter((p) => p.name !== 'HD-1080p');
    expect((await spec.resolve?.(api, desired, ctx))?.fields.activeProfile).toBe('Any');
    held.profiles = [{ id: 9, name: 'Mine' }];
    expect((await spec.resolve?.(api, desired, ctx))?.fields.activeProfile).toBe('Mine');
    held.profiles = [];
    expect(
      await thrown(spec.resolve?.(api, desired, ctx) ?? Promise.resolve()),
    ).toMatchObject({ kind: 'rejected' });
  });

  it('takes the profile the stack names, and refuses one the arr lacks, saying which it has', async () => {
    const { api } = await seerr();
    const named = contextOf(
      STACK.replace('  seerr: {}', `  seerr: { ${arr}_profile: Ultra-HD }`),
    );
    const desired = wanted(spec, named);
    expect((await spec.resolve?.(api, desired, named))?.fields.activeProfile).toBe(
      'Ultra-HD',
    );
    const missing = contextOf(
      STACK.replace('  seerr: {}', `  seerr: { ${arr}_profile: 4K }`),
    );
    const refused = await thrown(
      spec.resolve?.(api, desired, missing) ?? Promise.resolve(),
    );
    expect((refused as Error).message).toBe(
      `${name} has no quality profile named 4K, which apps.seerr.${arr}_profile names; it has Any, SD, HD-720p, HD-1080p, Ultra-HD, HD - 720p/1080p (POST /api/v1/settings/${arr}/test)`,
    );
  });

  it("is made as Seerr's web UI makes one, found by id, else by name, and its key checked with Seerr's own test", async () => {
    const { api, state, calls } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
    const { id } = await spec.create(api, desired);
    expect(id).toBe(0);
    expect(state.seerr[arr]).toEqual([
      expect.objectContaining({
        id: 0,
        name: `${name} (Mediaplane)`,
        hostname: arr,
        port,
        apiKey: key,
        useSsl: false,
        activeProfileId: 4,
        activeProfileName: 'HD-1080p',
        activeDirectory: folder,
        is4k: false,
        isDefault: true,
      }),
    ]);
    const observed = await spec.observe(api, undefined, desired);
    expect(observed).toEqual({
      id: 0,
      name: `${name} (Mediaplane)`,
      fields: desired.fields,
    });
    // By its id, renamed by hand.
    const held = state.seerr[arr][0];
    if (held !== undefined) held.name = 'Renamed';
    const known = {
      id: 0,
      name: `${name} (Mediaplane)`,
      fields: desired.fields,
      secrets: ['apiKey'],
      appliedAt: '2026-10-16T12:00:00.000Z',
    };
    expect((await spec.observe(api, known, desired))?.id).toBe(0);
    if (observed === undefined) throw new Error('observed');
    const before = calls().length;
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    expect(calls(before)).toEqual([
      `GET /api/v1/settings/${arr}`,
      `POST /api/v1/settings/${arr}/test`,
    ]);
    expect(state.seerr.errors).toEqual([]);
  });

  it("finds a refused key by testing again with the stack's, sets it with the server sent back whole, and says when Seerr can't reach the arr", async () => {
    const { api, state, sonarr, radarr } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    await spec.create(api, desired);
    const held = state.seerr[arr][0];
    if (held === undefined) throw new Error('held');
    // A wrong key, and a tag of the user's own.
    Object.assign(held, { apiKey: '0'.repeat(32), tags: [3] });
    const observed = await spec.observe(api, undefined, desired);
    if (observed === undefined) throw new Error('observed');
    expect(await spec.verify?.(api, desired, observed)).toBe(false);
    await spec.update(api, desired, observed);
    expect(state.seerr[arr][0]).toMatchObject({ id: 0, apiKey: key, tags: [3] });
    expect(await spec.verify?.(api, desired, observed)).toBe(true);
    // The arr down: Seerr's test fails either way, and that is what it says.
    (arr === 'sonarr' ? sonarr : radarr).up = false;
    const unreachable = await thrown(
      spec.verify?.(api, desired, observed) ?? Promise.resolve(),
    );
    expect((unreachable as Error).message).toBe(
      `Seerr at http://seerr:5055 (127.0.0.1) can't reach ${name} at http://${arr}:${String(port)} with the key it holds, or the stack's (POST /api/v1/settings/${arr}/test)`,
    );
    expect(await thrown(spec.create(api, desired))).toMatchObject({
      message: `Seerr at http://seerr:5055 (127.0.0.1) can't reach ${name} at http://${arr}:${String(port)} with the stack's key (POST /api/v1/settings/${arr}/test)`,
    });
  });

  it('puts back what was changed by hand: its profile, folder and default', async () => {
    const { api, state, sonarr, radarr } = await seerr();
    const desired =
      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
    await spec.create(api, desired);
    const held = state.seerr[arr][0];
    if (held === undefined) throw new Error('held');
    Object.assign(held, {
      activeProfileId: 1,
      activeProfileName: 'Any',
      activeDirectory: '/elsewhere',
      isDefault: false,
    });
    const observed = await spec.observe(api, undefined, desired);
    expect(observed?.fields).toMatchObject({
      activeProfile: 'Any',
      activeDirectory: '/elsewhere',
      isDefault: false,
    });
    if (observed === undefined) throw new Error('observed');
    await spec.update(api, desired, observed);
    expect(state.seerr[arr][0]).toMatchObject({
      activeProfileId: 4,
      activeProfileName: 'HD-1080p',
      activeDirectory: folder,
      isDefault: true,
    });
    // A profile that has gone from the arr since is refused, rather than sent by an id.
    (arr === 'sonarr' ? sonarr : radarr).profiles = [{ id: 1, name: 'Any' }];
    expect(await thrown(spec.update(api, desired, observed))).toMatchObject({
      message: `${name} has no quality profile named HD-1080p any more (POST /api/v1/settings/${arr}/test)`,
    });
  });
});

describe("Seerr's setup", () => {
  const spec = resource('setup');

  it('is initialized once its links are in place, which it requires', async () => {
    const { api, state, calls } = await seerr();
    expect(spec.requires).toEqual([
      'seerr.media_server',
      'seerr.server_sonarr',
      'seerr.server_radarr',
    ]);
    const desired = wanted(spec);
    const observed = await spec.observe(api, undefined, desired);
    expect(observed).toEqual({ id: null, name: 'setup', fields: { initialized: false } });
    if (observed === undefined) throw new Error('observed');
    await spec.update(api, desired, observed);
    expect(state.seerr.initialized).toBe(true);
    expect((await spec.observe(api, undefined, desired))?.fields.initialized).toBe(true);
    expect(await spec.create(api, desired)).toEqual({ id: null });
    expect(calls().filter((c) => c.endsWith('/initialize'))).toHaveLength(2);
  });
});
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 4985541..7d746d3 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -151,3 +151,3 @@ apps:
       catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
-    ).toEqual(['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']);
+    ).toEqual(['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'seerr', 'sonarr']);
   });
```

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 207b7a2..c82e54a 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -216,2 +216,86 @@ describe('planWiring', () => {
 
+  /**
+   * A login whose `profile`, a managed field, only the app can say (`resolve`): it wants
+   * "HD", and the app holds `held`. `asked` counts the resolutions.
+   */
+  function profiled(held: string, more: Partial<ResourceSpec> = {}) {
+    const asked: string[] = [];
+    const seen: unknown[] = [];
+    const spec: ResourceSpec = {
+      ...FAKE_LOGIN,
+      fields: ['user', 'profile'],
+      resolve: (_api, desired) => {
+        asked.push(desired.name);
+        return Promise.resolve({
+          ...desired,
+          fields: { ...desired.fields, profile: 'HD' },
+        });
+      },
+      observe: async (api, known, desired) => {
+        seen.push(desired?.fields);
+        const found = await FAKE_LOGIN.observe(api, known);
+        return found && { ...found, fields: { ...found.fields, profile: held } };
+      },
+      ...more,
+    };
+    return { spec, asked, seen };
+  }
+
+  /** resources.json, with the login recorded as wanted: its user, and the "HD" profile. */
+  const PROFILED: KnownResources = {
+    'sonarr.login': {
+      id: null,
+      name: 'login',
+      fields: { user: 'admin', profile: 'HD' },
+      secrets: ['password'],
+      appliedAt: '2026-10-10T12:00:00.000Z',
+    },
+  };
+
+  it('fills in what only the app can say before it compares, and looks the resource up with it', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const same = profiled('HD');
+    expect(
+      (
+        await planWiring(
+          options(sonarr, { stack: sonarrWith([same.spec]), known: PROFILED }),
+        )
+      ).changes,
+    ).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+    expect(same.asked).toEqual(['login']);
+    expect(same.seen).toEqual([{ user: 'admin', profile: 'HD' }]);
+    const other = profiled('SD');
+    expect(
+      (
+        await planWiring(
+          options(sonarr, { stack: sonarrWith([other.spec]), known: PROFILED }),
+        )
+      ).changes,
+    ).toEqual([{ resource: 'sonarr.login', action: 'update', changes: ['profile'] }]);
+  });
+
+  it('leaves it unfilled, and uncompared, while a resource it requires is yet to be made', async () => {
+    const first: ResourceSpec = {
+      ...FAKE_LOGIN,
+      name: 'first',
+      secrets: [],
+      observe: () => Promise.resolve(undefined),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const waiting = profiled('SD', { requires: ['sonarr.first'] });
+    expect(
+      (
+        await planWiring(
+          options(sonarr, { stack: sonarrWith([first, waiting.spec]), known: PROFILED }),
+        )
+      ).changes,
+    ).toEqual([
+      { resource: 'sonarr.first', action: 'create' },
+      // Only its user is compared, which resources.json records as wanted.
+      { resource: 'sonarr.login', action: 'unchanged' },
+    ]);
+    expect(waiting.asked).toEqual([]);
+    expect(waiting.seen).toEqual([{ user: 'admin' }]);
+  });
+
   it('leaves the secrets unchecked while a resource they require is to be updated, or could not be looked at', async () => {
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 4b24680..7aada64 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1137,2 +1137,109 @@ describe('mediaplane apply: Prowlarr in the stack', () => {
 
+describe('mediaplane apply: Seerr in the stack', () => {
+  const WITH_SEERR = STACK.replace('  qbittorrent: {}', '  qbittorrent: {}\n  seerr: {}');
+
+  /** A home of the stack with Seerr, whose fake Seerr keeps its settings.json there. */
+  async function seerrHome(): Promise<string> {
+    const home = await makeHome(WITH_SEERR);
+    const seerr = { ...freshAppState() };
+    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
+    apis.apps.set('seerr', seerr);
+    return home;
+  }
+
+  it('sets Seerr up through Jellyfin before publishing it, links it, initializes it, then leaves it as it is', async () => {
+    const home = await seerrHome();
+    const docker = fakeDocker(home);
+    const first = capture();
+    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
+    expect(first.stdout()).toContain(
+      '+ seerr (with no port published until it is done)\n',
+    );
+    expect(first.stdout()).toContain(
+      '  done    first-run setup: set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr\n',
+    );
+    for (const line of [
+      'seerr.media_server: updated libraries',
+      'seerr.server_sonarr: created',
+      'seerr.setup: updated initialized',
+    ]) {
+      expect(first.stdout()).toContain(`  done    wiring ${line}\n`);
+    }
+    const seerr = apis.apps.get('seerr')?.seerr;
+    expect(seerr).toMatchObject({
+      users: ['admin'],
+      initialized: true,
+      sessions: [],
+      jellyfin: { ip: 'jellyfin', port: 8096 },
+    });
+    expect(seerr?.sonarr).toMatchObject([
+      { name: 'Sonarr (Mediaplane)', hostname: 'sonarr', activeProfileName: 'HD-1080p' },
+    ]);
+    const known = await readResources(home);
+    expect(known['seerr.server_sonarr']).toMatchObject({
+      id: 0,
+      fields: {
+        hostname: 'sonarr',
+        port: 8989,
+        activeProfile: 'HD-1080p',
+        activeDirectory: '/data/media/tv',
+        isDefault: true,
+      },
+      secrets: ['apiKey'],
+    });
+    // Sonarr's key went to Seerr, and the admin password to Jellyfin through it.
+    const secrets = await secretsIn(home);
+    expectNoSecrets(first.stdout() + first.stderr(), secrets);
+    expectNoSecrets(JSON.stringify(known), secrets);
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+    expect(again.stdout()).toBe('No changes.\n');
+  });
+
+  it("waits for Jellyfin's admin, wiring the rest, when Jellyfin refuses Seerr's sign-in, then sets Seerr up", async () => {
+    // Jellyfin was set up before, its key kept, and its admin's password is another: the
+    // shared admin is refused until the wire step sets it.
+    const home = await seerrHome();
+    const key = '6'.repeat(32);
+    await mkdir(join(home, 'state'), { recursive: true });
+    await writeFile(
+      join(home, 'state', 'secrets.json'),
+      JSON.stringify({ version: 1, apps: { jellyfin: { apiKey: key } } }),
+    );
+    apis.apps.set('jellyfin', {
+      ...freshAppState(),
+      configDir: jellyfinConfig(home),
+      wizard: 'done',
+      user: 'admin',
+      password: 'fake-old-password',
+      apiKeys: [{ AccessToken: key, AppName: 'Mediaplane', DateCreated: AT }],
+    });
+    await mkdir(jellyfinConfig(home), { recursive: true });
+    await writeFile(
+      join(jellyfinConfig(home), 'system.xml'),
+      '<IsStartupWizardCompleted>true</IsStartupWizardCompleted>\n',
+    );
+    const docker = fakeDocker(home);
+    const waited = capture();
+    expect(await run(['apply', '--home', home, '--yes'], waited.io, deps(docker))).toBe(
+      1,
+    );
+    expect(waited.stdout()).toContain(
+      "  skipped wiring seerr.media_server: seerr's first-run setup waits\n",
+    );
+    expect(waited.stdout()).toContain(
+      '  done    wiring jellyfin.admin: updated password\n',
+    );
+    expect(waited.stderr()).toContain(
+      "warning: Seerr at http://seerr:5055 (127.0.0.1) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)\n",
+    );
+    expect(waited.stderr()).toContain('seerr (first-run setup)');
+    expect(apis.apps.get('seerr')?.seerr.users).toEqual([]);
+    // Jellyfin takes the shared admin now: the next apply sets Seerr up.
+    const then = capture();
+    expect(await run(['apply', '--home', home, '--yes'], then.io, deps(docker))).toBe(0);
+    expect(apis.apps.get('seerr')?.seerr.users).toEqual(['admin']);
+  });
+});
+
 describe('mediaplane status', () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog packages/engine/src/integrations/wiring.test.ts packages/cli/src/run.test.ts`
Expected: FAIL. `catalog/seerr/integration.test.ts` doesn't load
(`Cannot find module './integration'`), and 5 tests fail in 3 files:
- `catalog.test.ts`, 1: Seerr has no integration;
- `wiring.test.ts`, 2: `resolve` is never run, so the profile is compared as undefined
  (`expected [ { resource: 'sonarr.login', …(2) } ] to deeply equal [ { resource: 'sonarr.login', …(1) } ]`),
  and a field left to resolve is compared while what it requires waits;
- `run.test.ts`, 2: Seerr is set up, but none of its resources is wired
  (`… to contain '  done    wiring seerr.media_server: …'`), nor skipped while its setup
  waits.

- [ ] **Step 3: Write `resolve`, the root folders and Seerr's integration**

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index 4baf544..d980637 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -63,2 +63,14 @@ export interface ResourceSpec {
   desired(ctx: WiringContext): DesiredResource | undefined;
+  /**
+   * What the stack wants that only the app can say, filled into `desired` before its
+   * managed fields are compared: Seerr's quality profile, the first of its preferences
+   * that the arr offers. Throws AppApiError. `plan` leaves it out, and the fields it fills
+   * uncompared, while a resource this one requires is still to be put in place, as it
+   * leaves the secrets unchecked.
+   */
+  resolve?(
+    api: AppApi,
+    desired: DesiredResource,
+    ctx: WiringContext,
+  ): Promise<DesiredResource>;
   /**
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index abb8e4e..24778c2 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -250,3 +250,4 @@ export interface ExamineOptions {
    * or changed. The check could use what isn't there yet: Sonarr's own test of its
-   * download client makes a missing qBittorrent category, with no save path.
+   * download client makes a missing qBittorrent category, with no save path. What only
+   * the app can say (`resolve`) is left out too, and the fields it fills uncompared.
    */
@@ -273,4 +274,8 @@ export async function examine(
 ): Promise<Examined | undefined> {
-  const desired = spec.desired(ctx);
-  if (desired === undefined) return undefined;
+  const wanted = spec.desired(ctx);
+  if (wanted === undefined) return undefined;
+  const desired =
+    options.verify !== false && spec.resolve !== undefined
+      ? await spec.resolve(api, wanted, ctx)
+      : wanted;
   const observed = await spec.observe(api, known, desired);
@@ -279,3 +284,5 @@ export async function examine(
   }
-  const changes = spec.fields.filter(
+  // A field left to resolve isn't known yet: it isn't compared.
+  const compared = spec.fields.filter((field) => desired.fields[field] !== undefined);
+  const changes = compared.filter(
     (field) => observed.fields[field] !== desired.fields[field],
@@ -296,3 +303,3 @@ export async function examine(
     known !== undefined &&
-    spec.fields.every((field) => known.fields[field] === desired.fields[field]);
+    compared.every((field) => known.fields[field] === desired.fields[field]);
   return { desired, observed, action: recorded ? 'unchanged' : 'adopt', changes };
```

**Change** `catalog/sonarr/integration.ts`:

```diff
diff --git a/catalog/sonarr/integration.ts b/catalog/sonarr/integration.ts
index 908633f..3d85692 100644
--- a/catalog/sonarr/integration.ts
+++ b/catalog/sonarr/integration.ts
@@ -17,2 +17,5 @@ export const JELLYFIN_TRIGGERS = [
 
+/** Where Sonarr files series: its root folder, which Seerr's Sonarr server names too. */
+export const ROOT_FOLDER = '/data/media/tv';
+
 /**
@@ -28,3 +31,3 @@ export default servarrIntegration(
     servarrDownloadClient({ category: 'tv', setting: 'tvCategory' }),
-    servarrRootFolder('/data/media/tv'),
+    servarrRootFolder(ROOT_FOLDER),
     servarrJellyfin(JELLYFIN_TRIGGERS),
```

**Change** `catalog/radarr/integration.ts`:

```diff
diff --git a/catalog/radarr/integration.ts b/catalog/radarr/integration.ts
index bbbfeb7..9bcbe9d 100644
--- a/catalog/radarr/integration.ts
+++ b/catalog/radarr/integration.ts
@@ -17,2 +17,5 @@ export const JELLYFIN_TRIGGERS = [
 
+/** Where Radarr files films: its root folder, which Seerr's Radarr server names too. */
+export const ROOT_FOLDER = '/data/media/movies';
+
 /**
@@ -29,3 +32,3 @@ export default servarrIntegration(
     servarrDownloadClient({ category: 'movies', setting: 'movieCategory' }),
-    servarrRootFolder('/data/media/movies'),
+    servarrRootFolder(ROOT_FOLDER),
     servarrJellyfin(JELLYFIN_TRIGGERS),
```

**Create** `catalog/seerr/integration.ts`:

```ts
import {
  AppApiError,
  defineIntegration,
  serviceAddress,
  type AppApi,
  type DesiredResource,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';
import { secretOf } from '../_shared/secret';
import { LIBRARIES } from '../jellyfin/integration';
import { ROOT_FOLDER as MOVIES } from '../radarr/integration';
import { ROOT_FOLDER as TV } from '../sonarr/integration';

const SETTINGS = '/api/v1/settings';

/** The Jellyfin libraries Seerr has enabled: those Mediaplane makes, by name, in order. */
const WANTED = LIBRARIES.map((library) => library.name);

const library = z.looseObject({ id: z.string(), name: z.string(), enabled: z.boolean() });
const jellyfinSettings = z.looseObject({
  ip: z.string(),
  port: z.number(),
  libraries: z.array(library),
});

/** Which of Mediaplane's libraries Seerr has enabled, as one list: the managed field. */
function enabledOf(libraries: readonly z.infer<typeof library>[]): string {
  return WANTED.filter((name) =>
    libraries.some((held) => held.name === name && held.enabled),
  ).join(',');
}

/**
 * Whether Seerr reaches Jellyfin with the key it holds: its list of Jellyfin's users, which
 * it asks Jellyfin for with that key, fails with a 500 while Jellyfin refuses the key
 * (probed). That failure logs a line in Seerr's log, as one from its web UI does.
 */
async function heldKeyWorks(api: AppApi): Promise<boolean> {
  try {
    await api.check(`${SETTINGS}/jellyfin/users`);
    return true;
  } catch (cause) {
    if (cause instanceof AppApiError && cause.status === 500) return false;
    throw cause;
  }
}

/**
 * Point Seerr at Jellyfin, with Mediaplane's key for Jellyfin. Seerr saves it only once it
 * has reached Jellyfin there with that key. `ip` is the setting; a `hostname` would be
 * kept as a stray setting, and is the sign-in's field, which Seerr refuses once set.
 */
async function saveJellyfin(api: AppApi, desired: DesiredResource): Promise<void> {
  await api.submit('POST', `${SETTINGS}/jellyfin`, {
    ip: desired.fields.hostname,
    port: desired.fields.port,
    useSsl: false,
    urlBase: '',
    apiKey: secretOf(desired, 'apiKey'),
  });
}

/**
 * Enable Mediaplane's libraries in Seerr: Seerr learns Jellyfin's libraries by syncing
 * them, which keeps those it has enabled, and enables them one at a time. One it finds
 * no library of the name is refused: the Jellyfin library may have been renamed.
 */
async function enableLibraries(api: AppApi): Promise<void> {
  await api.submit('POST', `${SETTINGS}/jellyfin/library/sync`);
  const synced = await api.get(`${SETTINGS}/jellyfin/library`, z.array(library));
  for (const name of WANTED) {
    const held = synced.find((l) => l.name === name);
    if (held === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} finds no Jellyfin library named ${name} (POST ${SETTINGS}/jellyfin/library/sync)`,
        { kind: 'rejected' },
      );
    }
    if (!held.enabled) {
      await api.put(`${SETTINGS}/jellyfin/library/${encodeURIComponent(held.id)}`, {
        enabled: true,
      });
    }
  }
}

/**
 * Seerr's media server (spec §6.2): Jellyfin, at its service and container port, with its
 * Movies and Shows libraries enabled.
 * - Seerr's first sign-in sets it (bootstrap.ts), with a key Seerr makes itself in
 *   Jellyfin ("Seerr"), which Seerr shows in clear. That key stays while it works: the
 *   secret is checked by using it (Seerr's list of Jellyfin's users), never compared.
 *   Mediaplane gives Seerr its own Jellyfin key only when Seerr's is refused, or Jellyfin
 *   moves.
 * - `libraries` lists which of Mediaplane's are enabled; a library you enable is yours.
 * - It requires Jellyfin's admin and libraries, and Seerr comes after Jellyfin.
 */
const mediaServer: ResourceSpec = {
  name: 'media_server',
  fields: ['hostname', 'port', 'libraries'],
  secrets: ['apiKey'],
  requires: ['jellyfin.admin', 'jellyfin.library_movies', 'jellyfin.library_shows'],
  desired: ({ stack, keys }) => {
    const at = serviceAddress(
      stack.apps.find((app) => app.def.id === 'jellyfin'),
      'web',
    );
    if (at === undefined) return undefined;
    // Jellyfin makes its key in its first-run setup, which plan never runs: until then
    // the link is still wanted, and apply has the key by the wire step.
    const key = keys.jellyfin?.apiKey;
    const secrets: Record<string, string> = key === undefined ? {} : { apiKey: key };
    return {
      name: 'Jellyfin',
      fields: { hostname: at.host, port: at.port, libraries: WANTED.join(',') },
      secrets,
    };
  },
  async observe(api) {
    const held = await api.get(`${SETTINGS}/jellyfin`, jellyfinSettings);
    return held.ip === ''
      ? undefined
      : {
          id: null,
          name: 'Jellyfin',
          fields: {
            hostname: held.ip,
            port: held.port,
            libraries: enabledOf(held.libraries),
          },
        };
  },
  verify: (api) => heldKeyWorks(api),
  async create(api, desired) {
    await saveJellyfin(api, desired);
    await enableLibraries(api);
    return { id: null };
  },
  async update(api, desired, observed) {
    const moved =
      observed.fields.hostname !== desired.fields.hostname ||
      observed.fields.port !== desired.fields.port;
    if (moved || !(await heldKeyWorks(api))) await saveJellyfin(api, desired);
    if (observed.fields.libraries !== desired.fields.libraries) {
      await enableLibraries(api);
    }
  },
};

/** Seerr's quality profile preferences, when the stack names none (spec §6.2). */
export const PREFERRED_PROFILES = ['HD-1080p', 'Any'];

/** Sonarr and Radarr, as Seerr holds them. */
const ARRS = {
  sonarr: {
    name: 'Sonarr',
    folder: TV,
    option: 'sonarr_profile',
    // What Seerr's web UI gives a new server: standard series, anime as anime, every new
    // episode monitored, and no season folders. They stay yours after.
    extra: {
      seriesType: 'standard',
      animeSeriesType: 'anime',
      animeTags: [],
      enableSeasonFolders: false,
      monitorNewItems: 'all',
    },
  },
  radarr: {
    name: 'Radarr',
    folder: MOVIES,
    option: 'radarr_profile',
    extra: { minimumAvailability: 'released', enableSeasonFolders: false },
  },
} as const;

const server = z.looseObject({
  id: z.number(),
  name: z.string(),
  hostname: z.string(),
  port: z.number(),
  apiKey: z.string(),
  activeProfileName: z.string(),
  activeDirectory: z.string(),
  isDefault: z.boolean(),
});
const offered = z.looseObject({
  profiles: z.array(z.looseObject({ id: z.number(), name: z.string() })),
});

/**
 * Seerr's Sonarr or Radarr server (spec §6.2), named "<Arr> (Mediaplane)": the arr at its
 * service and container port, with its key, its root folder, a quality profile, and
 * `isDefault`, so requests go to it.
 * - The profile is the one `apps.seerr.<arr>_profile` names, else the first of
 *   PREFERRED_PROFILES that the arr has, else its first: only the arr can say which it
 *   has, so `resolve` asks it through Seerr's own test.
 * - Seerr shows the key in clear. It is checked, never compared, with Seerr's own test of
 *   the server it holds: one that fails is tested again with the stack's key, and only a
 *   pass then says the key was refused (an update); otherwise Seerr can't reach the arr,
 *   in its own words (500, "Failed to connect", probed, whatever the cause). A failing
 *   test logs a line in Seerr's log, and the arr one in its own, as from Seerr's web UI.
 * - Seerr keeps a server whole, its id read-only: an update sends it back as Seerr gave
 *   it, without the id, so its other settings stay yours.
 * - It requires the arr's root folder, which it names, and Seerr comes after the arr.
 */
function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
  const spec = ARRS[arr];
  const path = `${SETTINGS}/${arr}`;
  const name = `${spec.name} (Mediaplane)`;
  /** Seerr's test of `sent`: what the arr offers, or undefined when it fails. */
  const test = async (api: AppApi, sent: Record<string, unknown>) => {
    try {
      return await api.post(`${path}/test`, sent, offered);
    } catch (cause) {
      if (cause instanceof AppApiError && cause.status === 500) return undefined;
      throw cause;
    }
  };
  const reach = (desired: DesiredResource) => ({
    hostname: desired.fields.hostname,
    port: desired.fields.port,
    apiKey: secretOf(desired, 'apiKey'),
    useSsl: false,
  });
  const unreachable = (api: AppApi, at: string, how: string) =>
    new AppApiError(
      `${api.name} at ${api.where} can't reach ${spec.name} at ${at} ${how} (POST ${path}/test)`,
      { kind: 'rejected' },
    );
  /** The arr's profiles, as Seerr reaches it with the stack's key. */
  const profiles = async (api: AppApi, desired: DesiredResource) => {
    const found = await test(api, reach(desired));
    if (found === undefined) {
      const at = `http://${String(desired.fields.hostname)}:${String(desired.fields.port)}`;
      throw unreachable(api, at, "with the stack's key");
    }
    return found.profiles;
  };
  /** The profile `desired` names, as the arr has it. */
  const profileOf = async (api: AppApi, desired: DesiredResource) => {
    const wanted = desired.fields.activeProfile;
    const profile = (await profiles(api, desired)).find((p) => p.name === wanted);
    if (profile === undefined) {
      throw new AppApiError(
        `${spec.name} has no quality profile named ${String(wanted)} any more (POST ${path}/test)`,
        { kind: 'rejected' },
      );
    }
    return profile;
  };
  /** The server Seerr holds as `id`, without its id, which Seerr won't take back. */
  const heldOf = async (api: AppApi, id: unknown) => {
    const found = (await api.get(path, z.array(server))).find((s) => s.id === id);
    if (found === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} has no ${spec.name} server ${String(id)} (GET ${path})`,
        { kind: 'rejected' },
      );
    }
    const { id: _id, ...held } = found;
    return held;
  };
  return {
    name: `server_${arr}`,
    fields: ['hostname', 'port', 'activeProfile', 'activeDirectory', 'isDefault'],
    secrets: ['apiKey'],
    requires: [`${arr}.root_folder`],
    desired: ({ stack, keys }) => {
      const at = serviceAddress(
        stack.apps.find((app) => app.def.id === arr),
        'web',
      );
      if (at === undefined) return undefined;
      const key = keys[arr]?.apiKey;
      const secrets: Record<string, string> = key === undefined ? {} : { apiKey: key };
      return {
        name,
        fields: {
          hostname: at.host,
          port: at.port,
          activeDirectory: spec.folder,
          isDefault: true,
        },
        secrets,
      };
    },
    async resolve(api, desired, ctx) {
      const names = (await profiles(api, desired)).map((p) => p.name);
      const asked = ctx.app.context.options[spec.option];
      if (typeof asked === 'string' && !names.includes(asked)) {
        throw new AppApiError(
          `${spec.name} has no quality profile named ${asked}, which apps.seerr.${spec.option} names; it has ${names.join(', ')} (POST ${path}/test)`,
          { kind: 'rejected' },
        );
      }
      const chosen =
        typeof asked === 'string'
          ? asked
          : (PREFERRED_PROFILES.find((p) => names.includes(p)) ?? names[0]);
      if (chosen === undefined) {
        throw new AppApiError(
          `${spec.name} has no quality profile for Seerr to request with (POST ${path}/test)`,
          { kind: 'rejected' },
        );
      }
      return { ...desired, fields: { ...desired.fields, activeProfile: chosen } };
    },
    async observe(api, known) {
      const held = await api.get(path, z.array(server));
      const found =
        held.find((s) => known !== undefined && s.id === known.id) ??
        held.find((s) => s.name === name);
      return found === undefined
        ? undefined
        : {
            id: found.id,
            name: found.name,
            fields: {
              hostname: found.hostname,
              port: found.port,
              activeProfile: found.activeProfileName,
              activeDirectory: found.activeDirectory,
              isDefault: found.isDefault,
            },
          };
    },
    async verify(api, desired, observed) {
      const held = await heldOf(api, observed.id);
      if ((await test(api, held)) !== undefined) return true;
      if (
        (await test(api, { ...held, apiKey: secretOf(desired, 'apiKey') })) !== undefined
      ) {
        return false;
      }
      throw unreachable(
        api,
        `http://${held.hostname}:${String(held.port)}`,
        "with the key it holds, or the stack's",
      );
    },
    async create(api, desired) {
      const profile = await profileOf(api, desired);
      const made = await api.post(
        path,
        {
          name,
          ...reach(desired),
          activeProfileId: profile.id,
          activeProfileName: profile.name,
          activeDirectory: desired.fields.activeDirectory,
          tags: [],
          is4k: false,
          isDefault: true,
          syncEnabled: false,
          preventSearch: false,
          tagRequests: false,
          ...spec.extra,
        },
        z.looseObject({ id: z.number() }),
      );
      return { id: made.id };
    },
    async update(api, desired, observed) {
      const held = await heldOf(api, observed.id);
      const profile = await profileOf(api, desired);
      await api.put(`${path}/${String(observed.id)}`, {
        ...held,
        ...reach(desired),
        activeProfileId: profile.id,
        activeProfileName: profile.name,
        activeDirectory: desired.fields.activeDirectory,
        isDefault: true,
      });
    },
  };
}

/**
 * Seerr's setup, finished (spec §6.1): `POST /api/v1/settings/initialize`, once Seerr's
 * links are in place, which it requires. Seerr's web UI then stops showing its admin the
 * setup wizard. Seerr takes it again, but it is sent only while Seerr isn't initialized.
 */
const setup: ResourceSpec = {
  name: 'setup',
  fields: ['initialized'],
  secrets: [],
  requires: ['seerr.media_server', 'seerr.server_sonarr', 'seerr.server_radarr'],
  desired: () => ({ name: 'setup', fields: { initialized: true }, secrets: {} }),
  async observe(api) {
    const { initialized } = await api.get(
      `${SETTINGS}/public`,
      z.looseObject({ initialized: z.boolean() }),
    );
    return { id: null, name: 'setup', fields: { initialized } };
  },
  async create(api) {
    await api.submit('POST', `${SETTINGS}/initialize`);
    return { id: null };
  },
  update: (api) => api.submit('POST', `${SETTINGS}/initialize`),
};

/**
 * What Mediaplane wires in Seerr (spec §6.2): Jellyfin as its media server, with its
 * libraries; Sonarr and Radarr, each while the stack runs it; then its setup, finished.
 * Its first sign-in (bootstrap.ts) comes before, and makes its admin. It comes after
 * Jellyfin, Sonarr and Radarr, whose resources its own require.
 */
export default defineIntegration({
  after: ['jellyfin', 'radarr', 'sonarr'],
  resources: [mediaServer, seerrServer('sonarr'), seerrServer('radarr'), setup],
});
```

**Change** `catalog/seerr/app.ts`:

```diff
diff --git a/catalog/seerr/app.ts b/catalog/seerr/app.ts
index 25d5f17..7e542f3 100644
--- a/catalog/seerr/app.ts
+++ b/catalog/seerr/app.ts
@@ -3,2 +3,3 @@ import { z } from 'zod';
 import { seerrBootstrap } from './bootstrap';
+import integration from './integration';
 
@@ -44,2 +45,3 @@ export default defineApp({
     config.media_server === 'jellyfin' ? undefined : { comingIn: 'Slice 7' },
+  integration,
   options: z.strictObject({
@@ -50,3 +52,3 @@ export default defineApp({
       .describe(
-        'The Sonarr quality profile Seerr requests with. Not used yet (Slice 6).',
+        "The Sonarr quality profile Seerr requests with, by name. Unset: HD-1080p, else Any, else Sonarr's first.",
       ),
@@ -57,3 +59,3 @@ export default defineApp({
       .describe(
-        'The Radarr quality profile Seerr requests with. Not used yet (Slice 6).',
+        "The Radarr quality profile Seerr requests with, by name. Unset: HD-1080p, else Any, else Radarr's first.",
       ),
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

Run: `pnpm vitest run catalog packages/engine/src/integrations/wiring.test.ts packages/cli/src/run.test.ts`
Expected: PASS.

Run: `pnpm docs:generate`
Expected: it rewrites `catalog/seerr/README.md` (what it manages: its four resources),
`docs/reference/stack-yaml.md` and `docs/reference/stack.schema.json` (the profile
options' descriptions).

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages docs/reference
git commit -m "feat(catalog): Seerr linked to Jellyfin with its libraries, and to Sonarr and Radarr with a default profile, then initialized" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1666 tests pass in 83 files.

---

### Task 5: End-to-end: the whole stack wired with no clicking

Success criterion 1, on real Docker. The other e2e tests of stacks with Seerr learn its
setup and resources.

Decision: a new `requests.e2e.test.ts` on the whole stack, stopping at the links and
Seerr's own test of each, since a request needs TMDB (decision 14).
Decision: no new image, and no CI change (decision 15).

**Files:**
- Create: `test/e2e/requests.e2e.test.ts`
- Modify: `test/e2e/apply.e2e.test.ts`, `test/e2e/plan.e2e.test.ts`,
  `test/e2e/deploy.e2e.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1 to 4; `test/e2e/helpers.ts` (`makeHome`, `getJson`, `jsonBody`,
  `servarrFailure`, `wired`, `runTeardown`, `composeDown`, `expectWiringRemoved`).
- **Produces:** the e2e suite of 9 files.

- [ ] **Step 1: See the apply end-to-end test fail on Seerr's setup and resources**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/apply.e2e.test.ts`
Expected: FAIL in "starts the video stack healthy, then has nothing left to do". At the wiring network:
`expected { internal: true, members: [ …(6) ] } to deeply equal { internal: true, members: [ …(5) ] }`.
Seerr is on it now. The stack comes up healthy, and its first `apply` succeeds: Seerr is
set up, published and wired.

- [ ] **Step 2: Write the test, and update the others**

**Create** `test/e2e/requests.e2e.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  plan,
  readSecretStore,
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
  wired,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-requests`;
/** Seerr's web UI, on 127.0.0.1 once it is published. */
const SEERR = 5055;
/** Jellyfin's, where Seerr's key of its own shows in Jellyfin's list of keys. */
const JELLYFIN = 8096;
/**
 * What the whole stack wires, in the order apply wires it: Jellyfin and qBittorrent, the
 * arrs, Prowlarr, then Seerr, after Jellyfin and the arrs.
 */
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
  'prowlarr.admin',
  'prowlarr.application_sonarr',
  'prowlarr.application_radarr',
  'prowlarr.indexer_proxy',
  'seerr.media_server',
  'seerr.server_sonarr',
  'seerr.server_radarr',
  'seerr.setup',
];
/** Each arr, its web UI's port, and its root folder. */
const ARRS = [
  { app: 'sonarr', port: 8989, folder: '/data/media/tv' },
  { app: 'radarr', port: 7878, folder: '/data/media/movies' },
] as const;
/** A key that isn't the arr's: what a hand-made change leaves in a Seerr server. */
const WRONG_KEY = '9'.repeat(32);

/** A Sonarr or Radarr server, as Seerr shows it: its key in clear, never printed. */
interface Server {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  isDefault: boolean;
}

/** Seerr's Jellyfin, as it shows it: its key in clear, never printed. */
interface JellyfinSettings {
  ip: string;
  port: number;
  apiKey: string;
  libraries: { id: string; name: string; enabled: boolean }[];
}

/**
 * Seerr's container now, and its state as the stack's networks show it: whether its port
 * is published, and whether its setup is open, asked at its address on the wiring network
 * (from source, the host reaches it there). The media-server type is read strictly: an
 * answer without a number is an error, never "open".
 */
async function seerrState(runtime: Runtime): Promise<{ id: string; state: string }> {
  const container = (await runtime.containers()).find((c) => c.service === 'seerr');
  if (container === undefined) return { id: '', state: 'no container' };
  const address = (await runtime.wiringAddresses([container.id]))[container.id] ?? '';
  const answer = await fetch(
    `http://${address}:${String(SEERR)}/api/v1/settings/public`,
    {
      signal: AbortSignal.timeout(30_000),
    },
  );
  const { mediaServerType } = await jsonBody<{ mediaServerType?: unknown }>(
    answer,
    "Seerr's public settings",
  );
  if (typeof mediaServerType !== 'number') {
    throw new Error(
      `Seerr's public settings answered ${String(answer.status)} without a numeric mediaServerType`,
    );
  }
  const shown = container.published
    .map((p) => `${p.address}:${String(p.port)}`)
    .join(' ');
  // 4 is Seerr's "not configured": anyone who reaches it can still set it up.
  return {
    id: container.id,
    state: `ports ${shown === '' ? 'none' : shown}, setup ${mediaServerType === 4 ? 'open' : 'done'}`,
  };
}

describe('the whole stack, wired with no clicking', () => {
  it('signs Seerr in through Jellyfin before it is published, and links it to Jellyfin, Sonarr and Radarr', async () => {
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
      const docker = createDockerRuntime({ home, project: PROJECT });
      // Seerr as each up leaves it, and as the up that publishes it finds it, with the
      // container each reading saw.
      const seen: string[] = [];
      const ids: string[] = [];
      const record = async (when: string) => {
        const { id, state } = await seerrState(docker);
        seen.push(`${when}: ${state}`);
        ids.push(id);
      };
      const runtime: Runtime = {
        ...docker,
        up: async (seconds, values, unpublished = []) => {
          if (unpublished.length === 0) await record('before an up of every port');
          const result = await docker.up(seconds, values, unpublished);
          const what =
            unpublished.length === 0 ? 'every port' : `no ${unpublished.join(' ')} port`;
          await record(`after an up of ${what}`);
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

      // plan names both setups, and runs neither.
      expect((await plan(options)).bootstrap).toEqual([
        { app: 'jellyfin', unpublished: true },
        { app: 'seerr', unpublished: true },
      ]);

      // One apply wires the whole stack: Seerr starts with no published port, signs in
      // through Jellyfin once Jellyfin is set up, and only then is published.
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      expect(seen).toEqual([
        'after an up of no jellyfin seerr port: ports none, setup open',
        'before an up of every port: ports none, setup done',
        `after an up of every port: ports 127.0.0.1:${String(SEERR)}, setup done`,
      ]);
      expect(
        ids[0] !== '' && ids[1] === ids[0],
        'Seerr set up in the unpublished container',
      ).toBe(true);
      expect(ids[2] !== ids[1], 'Seerr published in a new container').toBe(true);
      expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
        'set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr',
      );
      expect(first.plan.wiring).toEqual(
        WIRED.map((resource) => ({ resource, action: 'after-start' })),
      );
      expect(wired(first.actions).slice(-4)).toEqual([
        // Its first sign-in set Jellyfin as its media server, with no library yet.
        ['seerr.media_server', 'updated libraries'],
        ['seerr.server_sonarr', 'created'],
        ['seerr.server_radarr', 'created'],
        ['seerr.setup', 'updated initialized'],
      ]);
      expect(wired(first.actions).map(([resource]) => resource)).toEqual(WIRED);

      const store = await readSecretStore(home);
      const keyOf = (app: string) => store.apps[app]?.apiKey ?? '';
      const password = store.shared?.adminPassword ?? '';
      // Seerr's key is the one Mediaplane made, as its own settings.json keeps it. The
      // file holds keys, so a failure says only what failed.
      let settings: { main?: { apiKey?: unknown } };
      try {
        settings = JSON.parse(
          await readFile(join(home, 'appdata', 'seerr', 'settings.json'), 'utf8'),
        ) as typeof settings;
      } catch {
        throw new Error("Seerr's settings.json could not be read as JSON");
      }
      expect(keyOf('seerr') !== '', 'no Seerr key stored').toBe(true);
      expect(
        settings.main?.apiKey === keyOf('seerr'),
        "Seerr's settings.json holds the stored key",
      ).toBe(true);
      const seerrKey = { 'X-Api-Key': keyOf('seerr') };
      const jellyfinHeader = {
        Authorization: `MediaBrowser Client="Mediaplane e2e", Device="e2e", DeviceId="mediaplane-e2e", Version="1", Token="${keyOf('jellyfin')}"`,
      };
      // The key Seerr made itself in Jellyfin, as it signed in: a secret too.
      const keys = await getJson<{ Items: { AccessToken: string; AppName: string }[] }>(
        JELLYFIN,
        '/Auth/Keys',
        jellyfinHeader,
      );
      const seerrsOwn = keys.Items.find((k) => k.AppName === 'Seerr')?.AccessToken ?? '';
      expect(seerrsOwn !== '', 'Seerr made itself a key in Jellyfin').toBe(true);
      const secrets = [
        ...Object.values(store.apps).flatMap((held) => Object.values(held)),
        password,
        seerrsOwn,
      ];
      const resources = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      for (const [what, text] of [
        ['resources.json', resources],
        ["apply's result", JSON.stringify(first)],
      ] as const) {
        for (const secret of secrets) {
          expect(text.includes(secret), `${what} holds a secret`).toBe(false);
        }
      }

      // The shared admin signs in to Seerr's published web UI through Jellyfin, as its
      // admin; another password doesn't.
      const signIn = (pw: string) =>
        api(
          SEERR,
          '/api/v1/auth/jellyfin',
          {},
          {
            method: 'POST',
            body: JSON.stringify({ username: 'admin', password: pw }),
            type: 'application/json',
            timeoutMs: 30_000,
          },
        );
      const right = await signIn(password);
      expect(right.status, 'the shared admin signs in to Seerr').toBe(200);
      const user = await jsonBody<{ id: number; permissions: number }>(
        right,
        "Seerr's sign-in",
      );
      expect([user.id, user.permissions], "as Seerr's admin").toEqual([1, 2]);
      const cookie = (right.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const out = await api(
        SEERR,
        '/api/v1/auth/logout',
        { Cookie: cookie },
        {
          method: 'POST',
        },
      );
      expect(out.status, 'signed out of Seerr').toBe(200);
      expect((await signIn('fake-not-the-password')).status).toBe(401);

      // Seerr's media server is Jellyfin, at its service, with Movies and Shows enabled.
      const jellyfinOf = () =>
        getJson<JellyfinSettings>(SEERR, '/api/v1/settings/jellyfin', seerrKey);
      const linked = await jellyfinOf();
      expect([linked.ip, linked.port], "Seerr's Jellyfin").toEqual([
        'jellyfin',
        JELLYFIN,
      ]);
      const enabled = (held: JellyfinSettings) =>
        held.libraries
          .filter((l) => l.enabled)
          .map((l) => l.name)
          .sort();
      expect(enabled(linked)).toEqual(['Movies', 'Shows']);
      // Seerr reaches Jellyfin with the key it holds: its list of Jellyfin's users works.
      const users = await api(SEERR, '/api/v1/settings/jellyfin/users', seerrKey);
      expect(users.status, "Seerr's list of Jellyfin's users").toBe(200);

      // Its Sonarr and Radarr servers: each arr at its service, its root folder, the
      // HD-1080p profile, by default, and Seerr's own test of each passes.
      const serversOf = (arr: string) =>
        getJson<Server[]>(SEERR, `/api/v1/settings/${arr}`, seerrKey);
      const testServer = async (arr: string, held: Server) => {
        const { id: _id, ...sent } = held;
        const tested = await api(SEERR, `/api/v1/settings/${arr}/test`, seerrKey, {
          method: 'POST',
          body: JSON.stringify(sent),
          type: 'application/json',
          timeoutMs: 60_000,
        });
        return tested.status === 200 ? 'passes' : await servarrFailure(tested, secrets);
      };
      for (const arr of ARRS) {
        const servers = await serversOf(arr.app);
        // Only what is compared is printed: the server holds the arr's key in clear.
        expect(
          servers.map((s) => [
            s.name,
            s.hostname,
            s.port,
            s.activeProfileName,
            s.activeDirectory,
            s.isDefault,
          ]),
          `Seerr's ${arr.app} server`,
        ).toEqual([
          [
            `${arr.app === 'sonarr' ? 'Sonarr' : 'Radarr'} (Mediaplane)`,
            arr.app,
            arr.port,
            'HD-1080p',
            arr.folder,
            true,
          ],
        ]);
        const [held] = servers;
        if (held === undefined) throw new Error(`no ${arr.app} server`);
        expect(await testServer(arr.app, held), `Seerr's test of ${arr.app}`).toBe(
          'passes',
        );
      }
      // Its setup is finished: its web UI no longer offers the wizard.
      const shown = await getJson<{ initialized: boolean }>(
        SEERR,
        '/api/v1/settings/public',
        {},
      );
      expect(shown.initialized).toBe(true);

      // A second apply changes nothing.
      const again = await apply({
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      });
      expect(again.outcome).toBe('no-changes');

      // Changed by hand in Seerr: Shows turned off, a wrong key in its Radarr server, and
      // the Any profile in its Sonarr server. apply puts each back, and nothing else
      // changes.
      const shows = linked.libraries.find((l) => l.name === 'Shows');
      const off = await api(
        SEERR,
        `/api/v1/settings/jellyfin/library/${shows?.id ?? 'missing'}`,
        seerrKey,
        {
          method: 'PUT',
          body: JSON.stringify({ enabled: false }),
          type: 'application/json',
        },
      );
      expect(off.status, 'Shows turned off by hand').toBe(200);
      const change = async (arr: string, edit: (held: Server) => Server) => {
        const [held] = await serversOf(arr);
        if (held === undefined) throw new Error(`no ${arr} server`);
        const { id, ...rest } = edit(held);
        const saved = await api(
          SEERR,
          `/api/v1/settings/${arr}/${String(id)}`,
          seerrKey,
          {
            method: 'PUT',
            body: JSON.stringify(rest),
            type: 'application/json',
          },
        );
        expect(saved.status, `${arr}'s server changed by hand`).toBe(200);
      };
      await change('radarr', (held) => ({ ...held, apiKey: WRONG_KEY }));
      await change('sonarr', (held) => ({
        ...held,
        activeProfileId: 1,
        activeProfileName: 'Any',
      }));
      expect(
        await testServer('radarr', (await serversOf('radarr'))[0] as Server),
      ).not.toBe('passes');
      const restored = await apply(options);
      expect(restored.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
        { resource: 'seerr.media_server', action: 'update', changes: ['libraries'] },
        { resource: 'seerr.server_sonarr', action: 'update', changes: ['activeProfile'] },
        { resource: 'seerr.server_radarr', action: 'update', changes: ['apiKey'] },
      ]);
      expect(restored.plan.containers.every((c) => c.action === 'unchanged')).toBe(true);
      expect(enabled(await jellyfinOf())).toEqual(['Movies', 'Shows']);
      for (const arr of ARRS) {
        const [held] = await serversOf(arr.app);
        if (held === undefined) throw new Error(`no ${arr.app} server`);
        expect(held.activeProfileName).toBe('HD-1080p');
        expect(await testServer(arr.app, held), `Seerr's test of ${arr.app}`).toBe(
          'passes',
        );
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
  }, 1_500_000);
});
```

**Change** `test/e2e/apply.e2e.test.ts`:

```diff
diff --git a/test/e2e/apply.e2e.test.ts b/test/e2e/apply.e2e.test.ts
index d09385b..5bfbb96 100644
--- a/test/e2e/apply.e2e.test.ts
+++ b/test/e2e/apply.e2e.test.ts
@@ -44,3 +44,3 @@ function mediaplane(...args: string[]): Promise<ExecResult> {
  * What the video stack wires, in the order apply wires it: Jellyfin and qBittorrent, then
- * the arrs, then Prowlarr.
+ * the arrs, then Prowlarr, then Seerr.
  */
@@ -66,2 +66,6 @@ const WIRED = [
   'prowlarr.indexer_proxy',
+  'seerr.media_server',
+  'seerr.server_sonarr',
+  'seerr.server_radarr',
+  'seerr.setup',
 ];
@@ -87,3 +91,3 @@ interface Resources {
 async function expectWiringNetwork(containers: readonly { service: string }[]) {
-  const wired = ['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr'];
+  const wired = ['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'seerr', 'sonarr'];
   expect(await wiringMembers(PROJECT)).toEqual({
@@ -292,2 +296,7 @@ describe('apply against real Docker', () => {
         ['prowlarr.indexer_proxy', 'created'],
+        // Seerr's first sign-in set Jellyfin as its media server, with no library yet.
+        ['seerr.media_server', 'updated libraries'],
+        ['seerr.server_sonarr', 'created'],
+        ['seerr.server_radarr', 'created'],
+        ['seerr.setup', 'updated initialized'],
       ]);
```

**Change** `test/e2e/plan.e2e.test.ts`:

```diff
diff --git a/test/e2e/plan.e2e.test.ts b/test/e2e/plan.e2e.test.ts
index 15e11d0..fb7e3da 100644
--- a/test/e2e/plan.e2e.test.ts
+++ b/test/e2e/plan.e2e.test.ts
@@ -84,4 +84,8 @@ describe('plan against real Docker', () => {
     ]);
-    // Jellyfin's startup wizard: apply finishes it before it publishes Jellyfin.
-    expect(result.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    // Jellyfin's startup wizard, and Seerr's first sign-in through it: apply finishes
+    // each before it publishes the app.
+    expect(result.bootstrap).toEqual([
+      { app: 'jellyfin', unpublished: true },
+      { app: 'seerr', unpublished: true },
+    ]);
   });
```

**Change** `test/e2e/deploy.e2e.test.ts`:

```diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index ca613fe..b8d9f31 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -364,3 +364,4 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     // sign in and make a new key). One it couldn't read would say nothing, and plan would
-    // start it unpublished.
+    // start it unpublished. It reads Seerr's settings.json, which uid 1000 owns, too:
+    // Seerr's setup is done, so it isn't listed.
     const store = await readSecretStore(home);
@@ -381,2 +382,3 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     // up, then published it, all through the proxy, and Sonarr tells it of imports.
+    // Slice 6: Seerr too, signed in through Jellyfin, then linked to it and to Sonarr.
     const applied = JSON.parse(first.stdout) as {
@@ -385,5 +387,8 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     };
-    expect(applied.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
+    expect(applied.plan.bootstrap).toEqual([
+      { app: 'jellyfin', unpublished: true },
+      { app: 'seerr', unpublished: true },
+    ]);
     expect(applied.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
-      'set up jellyfin and saved jellyfin.apiKey; published jellyfin',
+      'set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr',
     );
@@ -404,3 +409,8 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
       ['sonarr.connection_jellyfin', 'created'],
+      ['seerr.media_server', 'updated libraries'],
+      ['seerr.server_sonarr', 'created'],
+      ['seerr.setup', 'updated initialized'],
     ]);
+    // Seerr ended published too, as Docker says.
+    expect(await docker('port', `${STACK}-seerr-1`, '5055/tcp')).toBe('127.0.0.1:5055');
     expect((await stat(join(data, 'media', 'tv'))).isDirectory()).toBe(true);
```

- [ ] **Step 3: Run the two to see them pass**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/requests.e2e.test.ts test/e2e/apply.e2e.test.ts`
Expected: PASS. The requests test takes about a minute, the two about two and a half.

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

Expected: 9 files and 23 tests pass on each Compose (see the completion checklist for the
times). The last three print nothing, and `docker volume ls -q | wc -l` is
what it was.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): the whole stack wired with no clicking, Seerr signed in through Jellyfin before it is published, and its hand changes put back" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1666 tests pass in 83 files (the e2e files aren't among them).

---

### Task 6: Docs

The §9 set for what Tasks 1 to 5 built (decision 17). Each block below is a hand-written
doc; the generated parts were regenerated in Tasks 3 and 4.

- [ ] **Step 1: See the docs still promise Slice 6**

Run: `grep -rnE "Slice 6" README.md catalog/*/README.md deploy/README.md docs/architecture.md docs/security docs/runbooks | grep -vE "with Slice 6\.|before Slice 6,"`
Expected: 11 lines, in the README, Jellyfin's, Sonarr's, Radarr's and Seerr's READMEs, the deploy
guide, the architecture and the threat model, such as
`README.md:287:Seerr        http://127.0.0.1:5055  (its login arrives in Slice 6)`.

- [ ] **Step 2: The runbooks**

**Change** `docs/runbooks/wiring-failed.md`:

```diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 4357f49..2fc268d 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -6,5 +6,6 @@ and its `tv` and `movies` categories, in Sonarr and Radarr, qBittorrent as their
 client, their root folders and their connection to Jellyfin, in Prowlarr, its links to
-Sonarr and Radarr and its indexer proxy, and in Jellyfin, its first-run setup, before its
-port is published, and the Movies and Shows libraries. Later slices add the requests app
-and Plex.
+Sonarr and Radarr and its indexer proxy, in Jellyfin, its first-run setup, before its
+port is published, and the Movies and Shows libraries, and in Seerr, its first sign-in
+through Jellyfin, before its port is published, its links to Jellyfin, Sonarr and
+Radarr, and its setup, finished. Slice 7 adds Plex.
 
@@ -87,2 +88,14 @@ and Plex.
 
+- **`mediaplane apply` warns that Seerr's setup waits** (`bootstrap.waiting`), then fails
+  at verify with `seerr (first-run setup)` among what remains. Seerr signs in through
+  Jellyfin, as the shared admin, and Jellyfin refused that login. Seerr stays
+  unpublished; the rest of the stack is wired, and each of Seerr's resources is
+  `skipped`:
+
+  ```console
+    done    first-run setup: seerr waits: Seerr at http://seerr:5055 (172.19.0.6) can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password (POST /api/v1/auth/jellyfin)
+    …
+    skipped wiring seerr.media_server: seerr's first-run setup waits
+  ```
+
 - **`apply` stops at the same step** with a setup that reported success. Before
@@ -166,3 +179,6 @@ In `--json` output, each `diagnostics` entry has a `code`:
 - `bootstrap.unreadable` (a warning): Mediaplane can't read an app's setup-done file
-  while its key is stored, so it can't tell whether the setup is open.
+  while its key is stored, so it can't tell whether the setup is open. For Seerr, whose
+  key Mediaplane makes, the file alone says: it starts unpublished and is set up again.
+- `bootstrap.waiting` (a warning): an app's first-run setup waits for another app, as
+  Seerr's waits for Jellyfin to take the shared admin; the rest is wired without it.
 - `bootstrap.network-via` (an error): an app with a first-run setup runs inside another
@@ -199,2 +215,5 @@ differ, and a `reason` when it is `unknown`.
      read it (`MEDIAPLANE_UID` in the image, or your own user from source);
+   - for Seerr, `docker port mediaplane-seerr-1` likewise, and
+     `grep mediaServerType appdata/seerr/settings.json` says `2` (Jellyfin) once its
+     first sign-in is done, `4` before;
    - `mediaplane history <id>` shows the first-run setup step's result and error.
@@ -224,2 +243,5 @@ differ, and a `reason` when it is `unknown`.
     connections, whose own test refuses the old one (`updated apiKey`).
+  - **Seerr** takes the stored key from its environment at every start, whatever its
+    `settings.json` says, so a key made anew in its web UI lasts only until Seerr
+    restarts: `docker restart mediaplane-seerr-1` puts the stored one back.
   - Slice 8 restores a key at its source for you, and makes Jellyfin's anew.
@@ -274,3 +296,3 @@ differ, and a `reason` when it is `unknown`.
       again.
-    - **`its wizard was finished with another login while Mediaplane set it up`:** the
+    - **`its setup was finished with another login while Mediaplane set it up`:** the
       wizard was open when `apply` started Jellyfin, and something else reached it and
@@ -320,2 +342,49 @@ differ, and a `reason` when it is `unknown`.
   again: it signs in as the shared admin and tries again.
+- **`can't sign in through Jellyfin yet: Jellyfin refused the shared admin's password`**
+  (`bootstrap.waiting`). Seerr's first sign-in goes through Jellyfin, as the shared
+  admin, and Jellyfin's admin has another password: after `admin.password` changed, or
+  one changed in Jellyfin's dashboard. The same `apply` sets it again in Jellyfin
+  (`jellyfin.admin`), so run `apply` again, and it signs Seerr in. If `jellyfin.admin`
+  failed too, fix that first, as its own message says. Seerr stays unpublished until
+  then.
+- **`Seerr waits for Jellyfin's first-run setup, which isn't done`.** Jellyfin's setup
+  failed in the same `apply`, so Mediaplane didn't try Seerr's, which goes through it.
+  Fix Jellyfin's error, which comes first, then run `apply` again.
+- **`refused the request (HTTP 404): INVALID_URL (POST /api/v1/auth/jellyfin)`**
+  (`apply.bootstrap-failed`). Seerr can't reach Jellyfin at `jellyfin:8096` on the
+  stack's network. Check that Jellyfin is healthy (`mediaplane status jellyfin`), and
+  that no `compose.override.yaml` takes Jellyfin or Seerr off the stack's network, then
+  run `apply` again. Seerr stays unpublished.
+- **`was set up with another login or another Jellyfin`** (`apply.bootstrap-failed`).
+  Seerr's setup looked open when `apply` started it, unpublished, but Seerr was set up
+  when Mediaplane came to it, and not as the shared admin through the stack's Jellyfin.
+  Mediaplane never sends the password to such a Seerr, which would pass it on to its
+  Jellyfin; it asks with Seerr's key. Seerr stays unpublished, and what follows the
+  message says which of two causes it is, as for Jellyfin above. Check the safe one
+  first:
+  - **`Mediaplane can't read appdata/seerr/settings.json`:** this may be a Seerr you set
+    up yourself. Don't start it afresh: make the file readable by Mediaplane, then run
+    `apply` again.
+  - **`its setup was finished with another login while Mediaplane set it up`:** if you
+    did it, with another Jellyfin login, set `admin.username` and `admin.password` to it,
+    or sign in to Seerr and point it at the stack's Jellyfin. If you did not, start
+    Seerr afresh: stop it (`docker stop mediaplane-seerr-1`), remove `appdata/seerr`
+    (with `sudo`: uid 1000 owns it), and run `apply`. That loses Seerr's requests and
+    users, but nothing in the other apps.
+- **`can't reach Sonarr at http://sonarr:8989`** (or Radarr), for `seerr.server_sonarr`
+  or `seerr.server_radarr`. Seerr's own test of the server fails, with the key it holds
+  and with the stack's: Seerr can't reach the arr, whatever the cause (it says only
+  "Failed to connect"). Check that the arr is healthy (`mediaplane status sonarr`), and
+  that no override takes either off the stack's network, then run `apply` again. A key
+  that Seerr held wrong is never this one: Mediaplane finds it with the second test, and
+  sets it.
+- **`Sonarr has no quality profile named …, which apps.seerr.sonarr_profile names`** (or
+  Radarr). The profile in `stack.yaml` isn't one of the arr's: the message lists the
+  arr's. Set `apps.seerr.sonarr_profile` to one of them, or remove it for the default
+  (`HD-1080p`, else `Any`, else the arr's first), then run `apply`.
+- **`finds no Jellyfin library named Shows`** (or Movies), for `seerr.media_server`.
+  Seerr synced Jellyfin's libraries, and none had the name. Check that Seerr's Jellyfin
+  is the stack's (Seerr's settings, Jellyfin: `jellyfin`, port 8096), and that the
+  library is in Jellyfin's dashboard, as `jellyfin.library_shows` keeps it, then run
+  `apply` again.
 - **`Mediaplane can't read the file in Jellyfin's appdata`** (`bootstrap.unreadable`).
@@ -492,4 +561,7 @@ Then run `mediaplane apply`. It plans again and does only what is left
   [T16](../security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
-- **Keep `appdata/jellyfin` readable** by the user Mediaplane runs as, so `plan` can tell
-  whether Jellyfin's setup is open.
+- **Let `apply` sign Seerr in,** on a Jellyfin stack: don't finish Seerr's setup page by
+  hand. It goes through Jellyfin's admin, so keep that login the shared one.
+- **Keep `appdata/jellyfin` and `appdata/seerr` readable** by the user Mediaplane runs
+  as, so `plan` can tell whether their setup is open. Seerr's folder belongs to uid
+  1000, and its files are readable by all, as Seerr writes them.
 - **Leave the wiring network out of `compose.override.yaml`**
```

**Change** `docs/runbooks/app-wont-start.md`:

```diff
diff --git a/docs/runbooks/app-wont-start.md b/docs/runbooks/app-wont-start.md
index 4b5144c..e74f3d7 100644
--- a/docs/runbooks/app-wont-start.md
+++ b/docs/runbooks/app-wont-start.md
@@ -65,6 +65,7 @@
   Read its log (check 3) for what it is doing.
-- **Jellyfin runs, but its port isn't open.** `apply` starts Jellyfin with no published
-  port while its first-run setup is open, and publishes it only once the setup is
-  finished and Mediaplane has asked once more that it is. If `apply` failed at its
-  first-run setup step, or `plan` lists Jellyfin under `First-run setup:`, see
+- **Jellyfin or Seerr runs, but its port isn't open.** `apply` starts Jellyfin, and Seerr
+  with Jellyfin, with no published port while their first-run setup is open, and
+  publishes each only once its setup is finished and Mediaplane has asked once more that
+  it is. If `apply` failed at its first-run setup step, warned that Seerr's setup waits,
+  or `plan` lists the app under `First-run setup:`, see
   [wiring failed](wiring-failed.md). What this covers, and what voids it, is in
```

- [ ] **Step 3: The architecture and the threat model**

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 4fbb697..806f578 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -15,5 +15,6 @@ You describe the stack you want in one file, `stack.yaml`. Mediaplane then works
   made in qBittorrent, a failure recorded in an app's status of a client, link or
-  connection, and a sign-in in Jellyfin's activity log. It never runs an app's first-run
-  setup. The [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says
-  more;
+  connection, a sign-in in Jellyfin's activity log, and a line in Seerr's log for each of
+  its checks that fails (and one in the arr's, for a key the arr refuses). It never runs
+  an app's first-run setup, nor finishes Seerr's. The
+  [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more;
 - `apply` makes those changes, then plans again to check that nothing is left.
@@ -137,3 +138,3 @@ Not built yet:
 
-- the rest of the links between the apps: the requests app (Slice 6) and Plex (Slice 7);
+- Plex, and the links to it (Slice 7); until then, a Plex stack's Seerr isn't wired;
 - drift detection, with Keep mine (Slice 8).
@@ -308,3 +309,5 @@ Shows and Movies libraries.
 Jellyfin's startup wizard answers whoever reaches it, and whoever finishes it owns the
-server. So `apply` does not publish it while it is open (see
+server. So does Seerr's setup: until its first sign-in, anyone who reaches it can sign
+in through a Jellyfin of their own, and be its admin. So `apply` publishes neither
+while it is open (see
 [T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
@@ -314,20 +317,24 @@ for what voids that):
 plan
-  │ Jellyfin: its system.xml
-  │ doesn't say the wizard
-  │ is done
+  │ Jellyfin: system.xml says
+  │ the wizard isn't done;
+  │ Seerr: settings.json names
+  │ no media server
   ▼
 up --wait
-  │ Jellyfin with no port
+  │ both with no port
   │ published: one more
   │ Compose file, on stdin,
-  │ resets its ports
+  │ resets their ports
   ▼
 first-run setup, over the
-wiring network
-  │ the wizard, as the shared
-  │ admin; sign in; make the
-  │ key, keep it; sign out
+wiring network, in order
+  │ Jellyfin: the wizard, as
+  │ the shared admin; make
+  │ the key, keep it
+  │ Seerr: sign in through
+  │ Jellyfin, as that admin;
+  │ sign out
   ▼
 up --wait again
-  Jellyfin published
+  both published
 ```
@@ -340,5 +347,14 @@ up --wait again
   runs the setup. A file Mediaplane can't read says nothing: with the key stored, the
-  key decides, and `plan` warns (`bootstrap.unreadable`) that it can't tell. An app with
-  a setup can't run inside another app's network, which would publish its ports: `plan`
-  fails with `bootstrap.network-via`.
+  key decides, and `plan` warns (`bootstrap.unreadable`) that it can't tell. Seerr's
+  setup makes no key (Mediaplane makes Seerr's, in `API_KEY`), so its `settings.json`
+  alone says: one Mediaplane can't read has Seerr start unpublished, and set up again,
+  on every `apply`, with that warning. An app with a setup can't run inside another
+  app's network, which would publish its ports: `plan` fails with
+  `bootstrap.network-via`.
+- **In order.** The setups go in the order of the apps' integrations: Seerr comes after
+  Jellyfin. A setup that can't run yet waits: Seerr's, while Jellyfin refuses the shared
+  admin's password, or after Jellyfin's own setup failed. The app stays as it was,
+  unpublished; the step warns (`bootstrap.waiting`), the wire step wires the rest and
+  skips its resources, and verify fails with the setup left to do. The next `apply` sets
+  it up, once the wire step has set Jellyfin's admin.
 - **No port at all.** The file Compose gets on its standard input, after
@@ -350,4 +366,9 @@ up --wait again
   [T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)).
-- **The setup** reaches the app on the wiring network without a key, finishes its
-  wizard, and keeps the key it makes in `state/secrets.json` at once. Then Mediaplane
+- **The setup** reaches the app on the wiring network without a key. For Jellyfin, it
+  finishes its wizard, and keeps the key it makes in `state/secrets.json` at once. For
+  Seerr, it signs in through Jellyfin (`POST /api/v1/auth/jellyfin`, with Jellyfin's
+  service and port), as the shared admin: that makes it Seerr's admin, and Jellyfin
+  Seerr's media server. Seerr's key works from then on, so the session is signed out of
+  at once. A Seerr that is set up already is checked with its key, never by sending the
+  password, which it would pass to whatever Jellyfin it was set up with. Then Mediaplane
   steps off the wiring network, `up` runs again, without the extra file, and Compose
@@ -359,3 +380,3 @@ up --wait again
   unpublished, whose shared admin is then refused, stays unpublished whatever it says:
-  its wizard was finished with another login while Mediaplane set it up. Its appdata,
+  its setup was finished with another login while Mediaplane set it up. Its appdata,
   read again, tells that from a setup done by hand whose file Mediaplane can't read,
@@ -370,4 +391,4 @@ download path: qBittorrent's settings and categories, and Sonarr's and Radarr's
 client and root folder; the indexers: Prowlarr's links to Sonarr and Radarr, and its
-indexer proxy; and the media server: Jellyfin's libraries, and Sonarr's and Radarr's
-connection to it.
+indexer proxy; the media server: Jellyfin's libraries, and Sonarr's and Radarr's
+connection to it; and the requests app: Seerr's links to Jellyfin, Sonarr and Radarr.
 
@@ -381,3 +402,3 @@ mediaplane (the stack)
   sonarr, radarr, prowlarr,
-  jellyfin
+  jellyfin, seerr
   gluetun ─ qbittorrent
@@ -486,2 +507,36 @@ mediaplane (the stack)
 
+- **The requests app:**
+
+  ```text
+  seerr
+    │ media server: jellyfin,
+    │ Movies and Shows enabled
+    │ servers "<arr>
+    │ (Mediaplane)": the arr's
+    │ key, its root folder, a
+    │ profile, the default
+    ▼
+  jellyfin, sonarr, radarr
+  ```
+
+  - Seerr comes last, after Jellyfin, Sonarr and Radarr, once its first sign-in (above)
+    has made its admin: its key works only from then on.
+  - Its media server is Jellyfin, at `jellyfin:8096`, with Mediaplane's Movies and Shows
+    libraries enabled; a library you enable yourself stays yours. The key Seerr uses for
+    Jellyfin is the one Seerr made itself as it signed in. It stays while it works, which
+    Mediaplane checks with Seerr's list of Jellyfin's users; when Jellyfin refuses it,
+    Mediaplane gives Seerr its own Jellyfin key. It needs Jellyfin's admin and libraries
+    in place.
+  - Its Sonarr and Radarr servers reach each arr at its service and port, with its key,
+    file into its root folder, and are the default, so requests go there. The quality
+    profile is the one `apps.seerr.sonarr_profile` (or `radarr_profile`) names, else
+    `HD-1080p`, else `Any`, else the arr's first: only the arr knows which it has, so
+    Mediaplane asks it through Seerr's own test. Seerr shows a server's key in clear;
+    Mediaplane checks it with Seerr's test of the server it holds, never by comparing
+    it. Each needs its arr's root folder in place.
+  - Last, Seerr's setup is finished (`initialize`), once its links are in place, so its
+    web UI stops offering its admin the setup wizard.
+  - A request goes from Seerr to the arr through TMDB, an outside service: the end-to-end
+    tests stop at the links, and Seerr's own test of each.
+
 - **Each resource** is one of:
@@ -501,3 +556,4 @@ mediaplane (the stack)
 - **The wire step** waits until each app is ready (`/ping` for Sonarr, Radarr and
-  Prowlarr, `/System/Info/Public` for Jellyfin), checks that its key still works, then
+  Prowlarr, `/System/Info/Public` for Jellyfin, `/api/v1/settings/public` for Seerr),
+  checks that its key still works, then
   makes each resource what the stack
@@ -575,3 +631,3 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- the rest of the wiring, app by app: the requests app (Slice 6) and Plex (Slice 7);
+- Plex (Slice 7);
 - drift detection (Slice 8);
````

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index ed817fe..a32cf53 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -20,3 +20,5 @@ that power. None of them removes it.
 | Jellyfin's key, which Jellyfin made          | `state/secrets.json` (0600), and Sonarr's and Radarr's connections    | It opens Jellyfin's API, as its admin                      |
-| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin   |
+| Keys in Seerr: the arrs', and one Jellyfin's | Seerr's `settings.json`, in `appdata/`; Seerr shows them in clear     | They open Sonarr, Radarr and Jellyfin, as their admin      |
+| Seerr's session cookie, while it signs in    | Mediaplane's memory, for the moment of its first sign-in              | It opens Seerr, as its admin, until signed out             |
+| The shared admin password                    | `state/secrets.json` (0600) or `admin.password`; a hash in `appdata/` | It opens every app with a login, Seerr through Jellyfin    |
 | Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                     |
@@ -95,10 +97,11 @@ host network, read-only mounts
   nothing new for it. T5 says what its environment holds.
-- **The first-run setup.** An app whose setup anyone who reaches it could finish, which
-  is Jellyfin's startup wizard today, starts with no published port: `apply` gives
-  Compose one more file, on its standard input, that takes every port off it, those of
-  `compose.override.yaml` too. Mediaplane finishes the wizard over the wiring network, as
-  the shared admin, makes Jellyfin's key and keeps it, and only then starts Jellyfin
-  again with its port published (see T16). That uses the Docker API calls an `apply`
-  that recreates an app already makes, so the proxy allows nothing new for it. `plan`
-  never runs it.
+- **The first-run setup.** An app whose setup anyone who reaches it could finish starts
+  with no published port: Jellyfin, whose startup wizard is open, and Seerr, before its
+  first sign-in. `apply` gives Compose one more file, on its standard input, that takes
+  every port off them, those of `compose.override.yaml` too. Mediaplane finishes
+  Jellyfin's wizard over the wiring network, as the shared admin, makes Jellyfin's key
+  and keeps it; then it signs Seerr in through Jellyfin, as that admin, and signs out
+  again. Only then does it start them again with their ports published (see T16). That
+  uses the Docker API calls an `apply` that recreates an app already makes, so the proxy
+  allows nothing new for it. `plan` never runs it.
 - **The wiring.** `plan` and `apply` call the apps' APIs over the wiring network: from
@@ -111,3 +114,4 @@ host network, read-only mounts
   Jellyfin's sign-in is signed out of again, and its activity log records both, as it
-  records any sign-in.
+  records any sign-in. It signs in to Seerr only once, for its first sign-in, and signs
+  out at once: Seerr's own key works after that.
   `plan` checks a download client with the arr's own test, which also makes a missing
@@ -119,3 +123,7 @@ host network, read-only mounts
   fails, records a failure in that app's status of the client, link or connection, as a
-  test from the app's web UI does; a later pass resets it.
+  test from the app's web UI does; a later pass resets it. It checks Seerr's Sonarr and
+  Radarr servers with Seerr's own test, and the key Seerr holds for Jellyfin with
+  Seerr's list of Jellyfin's users. Those leave nothing in Seerr's settings, but each one
+  that fails logs a line in Seerr's log, and a test with a key the arr refuses logs one
+  in the arr's, as a test from Seerr's web UI does.
 - **The Cloudflare solver.** Byparr, or FlareSolverr, runs a browser for Prowlarr on the
@@ -144,4 +152,5 @@ host network, read-only mounts
     on the stack's own Docker network.
-  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, Jellyfin, and
-    qBittorrent, through Gluetun with a VPN) are on the stack's wiring network too. It is
+  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, Jellyfin, Seerr on a
+    Jellyfin stack, and qBittorrent, through Gluetun with a VPN) are on the stack's
+    wiring network too. It is
     internal: it gives them no way out, which they have on their own network.
@@ -189,3 +198,4 @@ Controls today:
   wizard is open: Mediaplane finishes it as the shared admin first (T16 says what voids
-  that). Jellyfin asks for a login from everywhere.
+  that). Jellyfin asks for a login from everywhere. So does Seerr, which publishes no
+  port until Mediaplane has signed it in through Jellyfin, as that admin.
 - With `login_on_lan: false`, qBittorrent lets only your LAN subnet skip its login, and
@@ -201,4 +211,5 @@ What remains:
 - On a home network, `init` suggests `bind: lan`, which puts the web UIs on your LAN.
-- Until Slice 6 (Slice 7 with Plex), Seerr's setup is open to whoever reaches it first.
-  Complete it right after the first `apply`, or keep `bind: localhost` until you have.
+- With Plex, until Slice 7, Seerr's setup is open to whoever reaches it first, through
+  a Jellyfin or a Plex account of their own. Complete it right after the first `apply`,
+  or keep `bind: localhost` until you have.
 - With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
@@ -267,2 +278,6 @@ What remains:
   and libraries.
+- Seerr holds Sonarr's and Radarr's keys, and a key of Jellyfin's, as its links need,
+  and shows them in clear to whoever holds its key or signs in as its admin. So a
+  compromised Seerr can drive Sonarr, Radarr and Jellyfin, and so can whoever has
+  Seerr's key or the shared admin login.
 - A link stays in Prowlarr when its arr leaves the stack, and keeps that arr's key,
@@ -308,2 +323,16 @@ Controls today:
   password, sent with its key.
+- Seerr's key is generated, and reaches Seerr in its environment (`API_KEY`), which it
+  takes at every start; Seerr also writes it into its `settings.json`. Sonarr's and
+  Radarr's keys go to Seerr in its servers' settings, request bodies again. Seerr shows
+  them in clear afterwards: Mediaplane reads them back only to hand them to Seerr's own
+  test of the server it holds, and never compares, keeps or shows them. The key Seerr
+  made itself in Jellyfin, which it also shows in clear, Mediaplane reads in Seerr's
+  answer and leaves there: it is never kept or shown, nor sent anywhere. When Jellyfin
+  refuses it, Mediaplane gives Seerr the Jellyfin key it holds itself, in a request
+  body, as it gives the arrs.
+- The admin password goes to Seerr only once, in its first sign-in's request body,
+  which Seerr passes to Jellyfin to check. The session cookie it answers with stays in
+  Mediaplane's memory, kept out of every message, for the one call that signs out at
+  once. Mediaplane never signs in to a Seerr that is set up already: it would pass the
+  password to whatever Jellyfin it was set up with.
 - The admin password goes to qBittorrent only in request bodies: its preferences, sent
@@ -325,3 +354,4 @@ Controls today:
   records hold only their paths.
-- `appdata/` holds credentials too: the apps' keys, and qBittorrent's password hash.
+- `appdata/` holds credentials too: the apps' keys, qBittorrent's password hash, and
+  Seerr's `settings.json`, with Sonarr's, Radarr's and a Jellyfin key in clear.
   The apps rewrite their own files readable by every user on the host (0644), so
@@ -412,3 +442,3 @@ What remains:
 - One password opens every app that uses it: qBittorrent, Sonarr, Radarr, Prowlarr and
-  Jellyfin. A leak from one is a leak for all.
+  Jellyfin, and Seerr, which asks Jellyfin. A leak from one is a leak for all.
 - `plan` and `apply` check Jellyfin's password by signing in. Jellyfin doesn't lock its
@@ -595,2 +625,13 @@ Controls today:
   this is under "What remains".
+- The same holds for Seerr, on a Jellyfin stack: until its first sign-in, anyone who
+  reaches it can sign in through a Jellyfin of their own and be its admin, as Seerr 3.5
+  does. `apply` starts it unpublished and, once Jellyfin is set up, signs it in through
+  Jellyfin as the shared admin, which makes that its admin and Jellyfin its media
+  server; only then does it publish Seerr. Its `settings.json` says whether its setup is
+  done; one Mediaplane can't read has Seerr start unpublished, and set up again, on
+  every `apply`.
+- A Seerr that is set up when Mediaplane comes to it, though its file didn't say so when
+  `apply` started it, is Mediaplane's only when its admin is the shared admin and its
+  Jellyfin the stack's. Mediaplane asks with Seerr's key, and never sends the password,
+  which Seerr would pass to its Jellyfin. Any other stays unpublished.
 - Before an app starts, Mediaplane reads its appdata (Jellyfin's `system.xml`) to see
@@ -615,4 +656,7 @@ What remains:
 
+- With Plex, Mediaplane doesn't set Seerr up until Slice 7: its setup is open on its
+  published port from its first start (see T2).
 - While the wizard is open, for the seconds Mediaplane takes, any container of the stack
-  can reach Jellyfin on the stack's networks. A compromised app could claim it first.
+  can reach Jellyfin on the stack's networks, and Seerr likewise until its first sign-in.
+  A compromised app could claim either first.
   If it sets the first user and leaves the wizard open, Mediaplane's sign-in fails, and
@@ -626,2 +670,9 @@ What remains:
   already treat as serious.
+- A Seerr claimed that way is set up when Mediaplane comes to it, with an admin that
+  isn't the shared admin, or a Jellyfin that isn't the stack's: it stays unpublished, and
+  `apply` stops. One claimed through the stack's own Jellyfin, as its admin, needed the
+  shared admin's password already.
+- A Seerr set up by hand before Slice 6, as its README then advised, is done, so it
+  starts published, and nobody can claim it. Mediaplane wires it with its key, whoever
+  its admin is.
 - A wizard finished by hand before `apply` started Jellyfin (from before Slice 5, say)
@@ -634,11 +685,11 @@ What remains:
   Fix the file's ownership, or the user Mediaplane runs as.
-- `compose.override.yaml` can void the guarantee that Jellyfin is set up before it is
-  published. Mediaplane resets Jellyfin's `ports`, so ports the override adds to Jellyfin
-  are held back too. But `!reset` covers only `ports`. An override that gives Jellyfin
-  `network_mode: host`, or any network setting that publishes it through another
-  service, publishes it while its wizard is open. Keep such settings out of the
+- `compose.override.yaml` can void the guarantee that Jellyfin and Seerr are set up
+  before they are published. Mediaplane resets their `ports`, so ports the override adds
+  to them are held back too. But `!reset` covers only `ports`. An override that gives
+  either `network_mode: host`, or any network setting that publishes it through another
+  service, publishes it while its setup is open. Keep such settings out of the
   override.
-- Run outside Mediaplane (the ejectable command, or a restart of a published Jellyfin
-  whose appdata was emptied), Jellyfin starts published with its wizard open: stop it
-  before emptying its appdata, and set it up with `apply`.
+- Run outside Mediaplane (the ejectable command, or a restart of a published Jellyfin or
+  Seerr whose appdata was emptied), the app starts published with its setup open: stop
+  it before emptying its appdata, and set it up with `apply`.
 
```

- [ ] **Step 4: The READMEs and the deploy guide**

The README's example output is from a real run of its stack with this slice (the same
stack as the e2e tests'), from source on an arm64 VM, trimmed where it says.

**Change** `README.md`:

```diff
diff --git a/README.md b/README.md
index 4bf9b74..f431b74 100644
--- a/README.md
+++ b/README.md
@@ -12,4 +12,4 @@ Compose and wires the apps together for you.**
 >   would do. `mediaplane apply` then starts the stack, confirms that every app is
->   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr, Prowlarr and
->   Jellyfin (`mediaplane credentials` shows it). It sets Jellyfin up before its web UI
+>   healthy, and sets one admin login in qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin
+>   and Seerr (`mediaplane credentials` shows it). It sets Jellyfin up before its web UI
 >   is published, with its Movies and Shows libraries, when `apply` runs the stack (the
@@ -20,8 +20,11 @@ Compose and wires the apps together for you.**
 >   add in Prowlarr reach both, with Byparr as Prowlarr's proxy for indexers behind
->   Cloudflare. `mediaplane vpn-check` confirms that qBittorrent reaches the internet
->   only through the VPN. Mediaplane runs in its own hardened container, behind a Docker
->   socket proxy, and reaches the apps over a private network with no route out.
-> - **Next:** the rest of the wiring: Seerr, then Plex. Until that lands, those still
->   need setting up by hand. Seerr's setup is open to anyone who can reach it until you
->   complete it, so complete it first.
+>   Cloudflare. It signs Seerr in through Jellyfin, as the same admin, before Seerr's web
+>   UI is published, and links Seerr to Jellyfin, with both libraries, and to Sonarr and
+>   Radarr, with a quality profile, ready for requests. `mediaplane vpn-check` confirms
+>   that qBittorrent reaches the internet only through the VPN. Mediaplane runs in its
+>   own hardened container, behind a Docker socket proxy, and reaches the apps over a
+>   private network with no route out.
+> - **Next:** Plex. Until that lands, a Plex stack still needs setting up by hand, Seerr
+>   included: its setup is open to anyone who can reach it until you complete it, so
+>   complete it first.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -61,3 +64,3 @@ Mediaplane does that part for you:
 | Write a starter `stack.yaml` (`init`)                                             | Done         |
-| One admin login for qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin            | Done         |
+| One admin login for qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr     | Done         |
 | Reach the apps' APIs over a private network with no route out                     | Done         |
@@ -69,3 +72,4 @@ Mediaplane does that part for you:
 | Set up Jellyfin before it is published, with its libraries and links              | Done         |
-| Wire the rest together (requests, Plex)                                           | Planned      |
+| Sign Seerr in through Jellyfin before it is published, and link it                | Done         |
+| Wire Plex, and Seerr with Plex                                                    | Planned      |
 | Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
@@ -112,3 +116,4 @@ the changes and touches nothing in your stack, apart from small marks that check
 or a password can leave in an app: a category in qBittorrent, a failure in an app's own
-status of a client, link or connection, and a sign-in in Jellyfin's activity log. The
+status of a client, link or connection, a sign-in in Jellyfin's activity log, and a line
+in Seerr's log (and an arr's) for a check of Seerr's that fails. The
 [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
@@ -134,11 +139,12 @@ mediaplane apply
   ├─ pulls images, starts the apps
-  │  (Jellyfin with no port, until
-  │  it is set up)
+  │  (Jellyfin and Seerr with no
+  │  port, until they are set up)
   ├─ waits until every app is healthy
-  ├─ sets Jellyfin up, then
-  │  publishes it
+  ├─ sets Jellyfin up, signs Seerr
+  │  in through it, then publishes
+  │  them
   ├─ wires the apps through their
   │  APIs: the shared login, the
-  │  download path, indexers and
-  │  the media server
+  │  download path, indexers, the
+  │  media server and requests
   ├─ plans again: nothing left to do
@@ -147,3 +153,3 @@ mediaplane apply
 
-Next, `apply` will wire the rest of the apps through the same APIs (Slices 6 and 7).
+Next, `apply` will wire Plex through the same APIs (Slice 7).
 
@@ -171,3 +177,3 @@ Most of this is real output from a run on an arm64 VM, trimmed where marked. The
 lines, the first-run setup's and the last apply's came later, from a run of the same
-stack with Slice 5. The stack is
+stack with Slice 6. The stack is
 the example above without the VPN, which is why `plan` warns about qBittorrent, and with
@@ -203,2 +209,3 @@ First-run setup:
   + jellyfin (with no port published until it is done)
+  + seerr (with no port published until it is done)
 Wiring:
@@ -223,3 +230,7 @@ Wiring:
   > after start prowlarr.indexer_proxy
-Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 1 app to set up, 19 wiring checks after the start.
+  > after start seerr.media_server
+  > after start seerr.server_sonarr
+  > after start seerr.server_radarr
+  > after start seerr.setup
+Plan: 6 files to write, 7 containers to change, 6 secrets to generate, 2 apps to set up, 23 wiring checks after the start.
 
@@ -233,5 +244,5 @@ Pulling images (the first time can take several minutes)…
 Starting containers and waiting until every app is healthy…
-  done    containers: every app is running and healthy; started jellyfin without its ports, to set it up first
+  done    containers: every app is running and healthy; started jellyfin, seerr without their ports, to set them up first
 Finishing first-run setup before publishing the web UIs…
-  done    first-run setup: set up jellyfin and saved jellyfin.apiKey; published jellyfin
+  done    first-run setup: set up jellyfin, seerr and saved jellyfin.apiKey; published jellyfin, seerr
 Wiring the apps…
@@ -256,6 +267,10 @@ Wiring the apps…
   done    wiring prowlarr.indexer_proxy: created
-  done    wiring: jellyfin.admin adopted; jellyfin.library_movies created; … prowlarr.indexer_proxy created
+  done    wiring seerr.media_server: updated libraries
+  done    wiring seerr.server_sonarr: created
+  done    wiring seerr.server_radarr: created
+  done    wiring seerr.setup: updated initialized
+  done    wiring: jellyfin.admin adopted; jellyfin.library_movies created; … seerr.setup updated initialized
   done    verify: no changes remain
 
-Apply complete. Change record: 20261015T182931Z-ed479e70
+Apply complete. Change record: 20261016T030144Z-2bc6267e
 
@@ -275,3 +290,3 @@ seerr        running  healthy
 sonarr       running  healthy
-Last apply: 2026-10-15T18:29:31.294Z, success (20261015T182931Z-ed479e70)
+Last apply: 2026-10-16T03:01:44.032Z, success (20261016T030144Z-2bc6267e)
 
@@ -286,3 +301,3 @@ qBittorrent  http://127.0.0.1:8080
 Radarr       http://127.0.0.1:7878
-Seerr        http://127.0.0.1:5055  (its login arrives in Slice 6)
+Seerr        http://127.0.0.1:5055
 Sonarr       http://127.0.0.1:8989
@@ -311,4 +326,4 @@ Then follow [`deploy/README.md`](deploy/README.md) to start it and run
 - the secrets it would generate;
-- the first-run setup it would finish, under `First-run setup:`: Jellyfin's, with no
-  port published until it is done;
+- the first-run setups it would finish, under `First-run setup:`: Jellyfin's, and
+  Seerr's first sign-in through it, each with no port published until it is done;
 - the wiring it would do in the apps, under `Wiring:`, such as setting the admin login or
@@ -366,3 +381,3 @@ This starts real containers on this machine, with the web UIs on `localhost`. Th
 command shows the admin login, which qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin
-use, and each app's address.
+use, and Seerr through Jellyfin, and each app's address.
 The first `apply` downloads several GB of images, so it can take a while. To remove the
@@ -403,5 +418,5 @@ The pipeline decides what the stack is, and Mediaplane does the stateful part. T
 that covers generating the keys, deploying, setting Jellyfin up and taking the key it
-makes, setting the shared login in the apps, linking Sonarr and Radarr to qBittorrent and
-Jellyfin and Prowlarr to them, and checking. The rest of the wiring and change detection
-are what is being built next.
+makes, signing Seerr in through it, setting the shared login in the apps, linking Sonarr
+and Radarr to qBittorrent and Jellyfin, Prowlarr to them, and Seerr to all three, and
+checking. Plex and change detection are what is being built next.
 
@@ -423,3 +438,5 @@ and keep. What it adds is everything around the file:
   libraries, and told of each import by Sonarr and Radarr;
-- next, the rest of the wiring between the apps.
+- Seerr signed in through Jellyfin before it is published, and linked to Jellyfin,
+  Sonarr and Radarr;
+- next, Plex.
 
@@ -432,4 +449,4 @@ the apps to each other, with `plan` and `apply` and a history of what it did, an
 the rest of each app's settings to you. Today it sets the shared login, sets Jellyfin
-up, links Sonarr and Radarr to qBittorrent and Jellyfin, and Prowlarr to them; Seerr and
-Plex come in Slices 6 and 7.
+and Seerr up, links Sonarr and Radarr to qBittorrent and Jellyfin, Prowlarr to them, and
+Seerr to all three; Plex comes in Slice 7.
 
@@ -489,5 +506,5 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
-  (indexers) and S5 (Jellyfin).
-- **Next:** S6 (requests).
-- **After that:** S7 to S9: Plex, drift detection, and the release.
+  (indexers), S5 (Jellyfin) and S6 (requests).
+- **Next:** S7 (Plex).
+- **After that:** S8 and S9: drift detection, and the release.
 
@@ -513,4 +530,5 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
 - **[Runbook: wiring failed](docs/runbooks/wiring-failed.md):** an app refused Mediaplane's
-  key or a change, Jellyfin's first-run setup failed, an arr can't reach qBittorrent or
-  Jellyfin, Prowlarr can't make its proxy, or Mediaplane can't reach an app.
+  key or a change, Jellyfin's or Seerr's first-run setup failed or waits, an arr can't
+  reach qBittorrent or Jellyfin, Seerr can't reach an arr, Prowlarr can't make its proxy,
+  or Mediaplane can't reach an app.
 - **[Threat model](docs/security/threat-model.md):** what is protected, how, and what
```

**Change** `catalog/seerr/README.md`:

```diff
diff --git a/catalog/seerr/README.md b/catalog/seerr/README.md
index 9c9b07b..2144c0f 100644
--- a/catalog/seerr/README.md
+++ b/catalog/seerr/README.md
@@ -28,4 +28,33 @@ Radarr. Mediaplane runs the upstream image, unmodified (see
 
-- **Its API key.** Generated once, and passed in `API_KEY`. It does nothing until Seerr
-  has its first user.
+With Jellyfin as the media server (with Plex, see Not built yet):
+
+- **Its first sign-in, before its web UI is published.** Until someone signs in, anyone
+  who reaches Seerr can sign in through a Jellyfin of their own and be its admin. So
+  `apply` starts Seerr with no port published, and once Jellyfin is set up, signs Seerr in
+  through Jellyfin as the shared admin: that makes the shared admin Seerr's admin, and
+  Jellyfin, at `jellyfin:8096`, its media server. It signs out again at once, and only
+  then publishes Seerr. `plan` lists it under `First-run setup:`; Seerr's `settings.json`
+  says when it is done (`mediaServerType`).
+- **Its login** is Jellyfin's: on Seerr's sign-in page, choose Jellyfin and use the
+  shared admin login (`mediaplane credentials`). It follows Jellyfin's, so a change of
+  `admin.password` reaches Seerr once it reaches Jellyfin. Seerr makes a user for anyone
+  else who signs in with a Jellyfin account, as it always does.
+- **Its API key.** Generated once, kept in `state/secrets.json`, and passed in
+  `API_KEY`, which Seerr takes at every start (its `settings.json` keeps the first). It
+  works once Seerr has its admin.
+- **Its media server** (`seerr.media_server`): Jellyfin, at its service and port, with
+  the Movies and Shows libraries enabled. A library you enable in Seerr stays yours.
+  Seerr uses the key it made itself in Jellyfin as it signed in (named `Seerr` in
+  Jellyfin's dashboard): Mediaplane checks that it works, and gives Seerr its own
+  Jellyfin key only when Jellyfin refuses Seerr's.
+- **Its Sonarr and Radarr servers** (`seerr.server_sonarr`, `seerr.server_radarr`), each
+  while the stack runs the arr, named `Sonarr (Mediaplane)` and `Radarr (Mediaplane)`:
+  the arr at its service and port, with its key, its root folder, a quality profile,
+  and set as the default, so requests go there. The profile is `HD-1080p`, else `Any`,
+  else the arr's first, unless you name one (below). The rest is what Seerr's own web UI
+  gives a new server, such as no season folders, and stays yours after. Seerr shows the
+  arr's key in clear; Mediaplane checks it with Seerr's own test of the server, which
+  calls the arr with it.
+- **Its setup, finished** (`seerr.setup`): once its links are in place, Mediaplane sends
+  Seerr's `initialize`, so it stops offering its admin the setup wizard.
 - **Its user.** Seerr's image runs as uid 1000, the `node` user. So before it starts,
@@ -37,3 +66,3 @@ Radarr. Mediaplane runs the upstream image, unmodified (see
 - **`LOG_LEVEL=info`.**
-- **Its web UI,** published as `network.bind` says.
+- **Its web UI,** published as `network.bind` says, once it is set up.
 
@@ -41,8 +70,6 @@ Radarr. Mediaplane runs the upstream image, unmodified (see
 
-- **Slice 6:**
-  - Seerr's first sign-in, as the Jellyfin admin;
-  - its links to Jellyfin, Sonarr and Radarr;
-  - `apps.seerr.sonarr_profile` and `radarr_profile`, which choose the quality profiles
-    it requests with.
-- **Slice 7:** with Plex, its first sign-in with your Plex token, and its link to Plex.
+- **Slice 7:** with Plex, its first sign-in with your Plex account, and its link to Plex.
+  Until then, on a Plex stack, Mediaplane doesn't call Seerr at all, and
+  `mediaplane credentials` says its login arrives in Slice 7.
+- **Slice 8:** drift detection and Keep mine for what it manages here.
 
@@ -55,2 +82,8 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   about it. See the [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
+- **The quality profiles** it requests with: `apps.seerr.sonarr_profile` and
+  `apps.seerr.radarr_profile`, each a profile's name, as the arr shows it. A name the
+  arr doesn't have fails, listing those it has.
+- **What Mediaplane manages** (the fields above) is put back by the next `apply` when
+  changed in Seerr: its Jellyfin, its libraries, and each server's host, port, profile,
+  root folder and default. Keep mine comes in Slice 8.
 - **Anything else** goes in `compose.override.yaml` in the Mediaplane home.
@@ -59,5 +92,13 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **Setup is open.** Until Slice 6 (Slice 7 with Plex), Seerr's setup page is open to
-  whoever reaches it first. Finish it yourself as soon as `apply` is done, or keep
+- **Setup is open with Plex.** Until Slice 7, on a Plex stack, Seerr's setup page is open
+  to whoever reaches it first. Finish it yourself as soon as `apply` is done, or keep
   `network.bind: localhost` until you have.
+- **A request needs the internet.** Seerr looks up films and series on TMDB, an outside
+  service, and the arrs look them up again on their own: Mediaplane's tests stop at the
+  links, and Seerr's own test of each.
+- **A failing check is logged.** `plan` and `apply` check Seerr's servers and its key for
+  Jellyfin; each check that fails logs a line in Seerr's log (Settings, Logs), and one
+  with a key the arr refuses, a line in the arr's.
+- **Jellyfin keeps a key named `Seerr`,** which Seerr made as it first signed in, and a
+  device of Seerr's sign-in. Both are Seerr's own: leave them.
 - **Removing it needs `sudo`.** `appdata/seerr` belongs to uid 1000, so unless you are
```

**Change** `catalog/jellyfin/README.md`:

```diff
diff --git a/catalog/jellyfin/README.md b/catalog/jellyfin/README.md
index e1f0ab1..8b31ad5 100644
--- a/catalog/jellyfin/README.md
+++ b/catalog/jellyfin/README.md
@@ -81,2 +81,8 @@ upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.
   [Sonarr's](../sonarr/README.md) and [Radarr's](../radarr/README.md) READMEs).
+- **Seerr signs in through it.** With Seerr in the stack, once Jellyfin is set up,
+  `apply` signs Seerr in through Jellyfin as the shared admin, before Seerr is published,
+  and links Seerr to it with both libraries enabled (see
+  [Seerr's README](../seerr/README.md)). That sign-in leaves Jellyfin a key named
+  `Seerr`, and a device of Seerr's, which Seerr uses: leave them. Seerr's sign-in page
+  then checks the shared admin login against Jellyfin.
 - **A health check that waits for the server.** In the first seconds of every start,
@@ -90,3 +96,2 @@ upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.
 
-- **Slice 6:** Seerr's link to Jellyfin, signing in as its admin.
 - **Slice 8:** drift: reporting a setting changed by hand, rather than putting it back,
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 6ac5bda..f3b5372 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -83,2 +83,8 @@ LinuxServer.io image, unmodified.
     web UI does, and a later pass resets it.
+- **Seerr's link to it.** With Seerr in the stack and Jellyfin as the media server,
+  `apply` adds `Sonarr (Mediaplane)` to Seerr (`seerr.server_sonarr`, see
+  [Seerr's README](../seerr/README.md)), with Sonarr's key, its root folder, and the
+  `HD-1080p` quality profile unless `apps.seerr.sonarr_profile` names another. Seerr then
+  sends the series people request to Sonarr. A failing test of it logs a line in
+  Sonarr's log when the key is refused.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -88,6 +94,5 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 6 and 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slice 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 6:** Seerr's link to it.
-- **Slice 7:** the same connection for Plex.
+- **Slice 7:** the same connection for Plex, and Seerr's link to it with Plex.
 
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 4a54e9f..d5aba46 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -82,2 +82,8 @@ LinuxServer.io image, unmodified.
     web UI does, and a later pass resets it.
+- **Seerr's link to it.** With Seerr in the stack and Jellyfin as the media server,
+  `apply` adds `Radarr (Mediaplane)` to Seerr (`seerr.server_radarr`, see
+  [Seerr's README](../seerr/README.md)), with Radarr's key, its root folder, and the
+  `HD-1080p` quality profile unless `apps.seerr.radarr_profile` names another. Seerr then
+  sends the films people request to Radarr. A failing test of it logs a line in Radarr's
+  log when the key is refused.
 - **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
@@ -87,6 +93,5 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slices 6 and 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
+The rest of the wiring arrives in Slice 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
 
-- **Slice 6:** Seerr's link to it.
-- **Slice 7:** the same connection for Plex.
+- **Slice 7:** the same connection for Plex, and Seerr's link to it with Plex.
 
```

**Change** `deploy/README.md`:

```diff
diff --git a/deploy/README.md b/deploy/README.md
index 04b3bc9..839c555 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -13,13 +13,14 @@ never touch Mediaplane itself.
 
-> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent and Jellyfin, and
-> Prowlarr to them, but Seerr is not wired yet (Slice 6 does that, Slice 7 with Plex). On
-> a home network, `init` suggests publishing the web UIs on your LAN. Until then, Seerr's
-> setup is open to anyone on your LAN until you complete it, so complete it first.
-> When `apply` runs the stack, Jellyfin's startup wizard is not published while it is
-> open: Mediaplane finishes it first. The threat model says what voids that:
+> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent and Jellyfin,
+> Prowlarr to them, and Seerr to all three; Plex is not wired yet (Slice 7). On a home
+> network, `init` suggests publishing the web UIs on your LAN. When `apply` runs the
+> stack, Jellyfin's startup wizard and Seerr's setup are not published while they are
+> open: Mediaplane finishes them first. The threat model says what voids that:
 > [T16](../docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
+> With Plex, until Slice 7, Seerr's setup is open to anyone on your LAN until you
+> complete it, so complete it first.
 >
-> qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin have the shared admin login:
-> `mediaplane credentials` shows it. To keep the web UIs on this machine only, answer
-> `localhost` when `init` asks (see [First run](#first-run)).
+> qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin have the shared admin login, and
+> Seerr through Jellyfin: `mediaplane credentials` shows it. To keep the web UIs on this
+> machine only, answer `localhost` when `init` asks (see [First run](#first-run)).
 
@@ -144,4 +145,4 @@ nothing. Without a terminal it asks nothing: pass the flags in the
 
-  Until Slice 6 (Slice 7 with Plex), Seerr's setup is open to anyone on your LAN until
-  you complete it. Complete it right after the first `apply`.
+  With Plex, until Slice 7, Seerr's setup is open to anyone on your LAN until you
+  complete it. Complete it right after the first `apply`.
 
@@ -152,6 +153,7 @@ nothing. Without a terminal it asks nothing: pass the flags in the
   password of your own only with `--reveal`, and its `--json` output leaves out either
-  unless you add `--reveal`. qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin use it.
-  qBittorrent gets it before its first start, and Jellyfin in its first-run setup.
-  `apply` sets it in all five through their API once they run, and sets it again
-  whenever it changes.
+  unless you add `--reveal`. qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin use it,
+  and Seerr through Jellyfin. qBittorrent gets it before its first start, Jellyfin in its
+  first-run setup, and Seerr in its first sign-in. `apply` sets it in the first five
+  through their API once they run, and sets it again whenever it changes; Seerr follows
+  Jellyfin.
   - Removing your own `admin.password` brings back the password Mediaplane generated
```

- [ ] **Step 5: The spec and the roadmap**

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 5511ca9..27a12f6 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -542,3 +542,3 @@ in `compose.override.yaml` is therefore wired automatically.
 | `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file. It also checks the home first, creates the data folder, adds a note before each question, and takes the WireGuard key on a hidden prompt (§11, Slice 3b) |
-| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4 and 5); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
+| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5 and 6); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
 | `apply` | Converge on `stack.yaml` (§5) |
@@ -1458 +1458,80 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   and give it to the arrs' connections; Slice 8 automates that, with key recovery.
+
+### Slice 6: requests (2026-10-16)
+
+- **Seerr's first sign-in is a first-run setup, before it is published** (§5 step 9,
+  §6.1, §6.4). Until its first sign-in, Seerr 3.5 lets anyone who reaches its port sign
+  in through a Jellyfin of their own choosing (`POST /api/v1/auth/jellyfin` with a
+  `hostname`) and be its admin, and its key does nothing (403) until that admin exists
+  (probed). So Seerr has a `bootstrap`, as Jellyfin does, and starts unpublished.
+  - **Done** is its `settings.json` naming a media server (`mediaServerType` 1 to 3; 4
+    is none). Its key is Mediaplane's (`API_KEY`), so a setup may make no key: such a
+    setup's `done` file alone says, and one Mediaplane can't read has the app start
+    unpublished, and set up again, on every `apply` (`bootstrap.unreadable`).
+  - **The setup** signs in through Jellyfin, at Jellyfin's service and container port,
+    as the shared admin, which makes it Seerr's admin and Jellyfin Seerr's media server,
+    then signs out (`POST /api/v1/auth/logout`, with the session's cookie, which the
+    typed client keeps out of every message). A Seerr found set up when its setup runs,
+    though its file didn't say so when `apply` started it, is Mediaplane's only when its
+    admin is the shared admin and its Jellyfin the stack's, asked with its key: the
+    password is never sent to it, since Seerr would pass it to its own Jellyfin. Any
+    other is refused as claimed (`auth`), and stays unpublished.
+  - **Order, and waiting** (the roadmap's S6 item). The setups run in the order of the
+    apps' integrations, so Seerr's comes after Jellyfin's. A setup may wait
+    (`SetupWaiting`): Seerr's, while Jellyfin refuses the shared admin's password, and
+    any setup after an app whose own setup failed or waits. A setup that waits leaves its
+    app as it was, unpublished; the step warns (`bootstrap.waiting`) and doesn't fail, the
+    wire step skips that app's resources (and what requires them), and verify fails with
+    the setup still listed. So a Jellyfin whose admin password changed gets it set by the
+    wire step, and the next `apply` signs Seerr in. The roadmap's sign-in that `requires`
+    `jellyfin.admin` is this wait: a setup runs before the wire step, so it can't require
+    a resource; Seerr's link to Jellyfin requires it.
+  - **With Plex, Seerr isn't wired until Slice 7** (`notWiredYet`): the resolver leaves
+    out its API, integration and setup on a Plex stack, so nothing calls it there, and
+    its `login` says Slice 7. Its login is `'shared'` with Jellyfin, through Jellyfin.
+- **Seerr's resources** (§6.2), after Jellyfin, Sonarr and Radarr:
+  - `seerr.media_server`: Jellyfin at its service and port (`hostname` and `port`, as
+    Seerr's settings `ip` and `port`), with the Movies and Shows libraries enabled
+    (`libraries`, those of Mediaplane's that are enabled; one you enable is yours). Its
+    `apiKey` is the key Seerr holds for Jellyfin, which Seerr made itself in its first
+    sign-in and shows in clear: it is checked by using it, never compared, through
+    Seerr's list of Jellyfin's users, which fails (500) while Jellyfin refuses it
+    (probed). Mediaplane gives Seerr its own Jellyfin key only when Seerr's is refused, or
+    Jellyfin's address changes. `hostname` is never sent: it is the sign-in's field, which
+    Seerr refuses once set (500), and a stray setting in `/api/v1/settings/jellyfin`.
+    Libraries are synced from Jellyfin, then enabled one at a time. It requires
+    `jellyfin.admin` and both libraries.
+  - `seerr.server_sonarr` and `seerr.server_radarr`, named `<Arr> (Mediaplane)`, each
+    while the stack runs the arr: `hostname`, `port`, `activeProfile` (the profile's
+    name), `activeDirectory` (the arr's root folder) and `isDefault`; `apiKey` is a
+    secret. Seerr shows the key in clear, but it is still checked, never compared, as
+    §6.3 says, with Seerr's own test (`POST /api/v1/settings/<arr>/test`) of the server
+    it holds. Seerr's test fails with one 500 whatever the cause (probed), so a failure
+    is tested again with the stack's key: a pass then means the key was refused (an
+    update); a second failure is Seerr not reaching the arr. A server is saved whole, its
+    id read-only (probed), and made with what Seerr's web UI gives a new one. Each
+    requires its arr's root folder.
+  - `seerr.setup`: `initialized`, set by `POST /api/v1/settings/initialize` while it is
+    false, once Seerr's links are in place, which it requires. Seerr takes it again
+    (probed), but it is sent once.
+- **Seerr's default profile** (§6.2) needs the arr's profiles, which only the arr has.
+  A resource may now `resolve` what only the app can say, before its fields are compared:
+  the servers ask the arr through Seerr's test. `apps.seerr.sonarr_profile` and
+  `radarr_profile` name a profile; one the arr lacks fails, listing those it has. `plan`
+  leaves it unresolved, and those fields uncompared, while a resource it requires is
+  still to be put in place, as it leaves secrets unchecked.
+- **`plan`'s marks** (§5.2): Seerr's checks leave nothing in its settings, but each that
+  fails logs a line in Seerr's log, and a test with a key the arr refuses logs one in the
+  arr's (probed). A passing check logs nothing.
+- **Seerr's key** is generated, set through `API_KEY`, which Seerr takes at every start,
+  and written by Seerr into `settings.json` (`main.apiKey`) at its first start (probed).
+  A key Seerr's web UI makes anew lasts until Seerr restarts.
+- **A request reaches the arr through outside services:** Seerr looks the title up on
+  TMDB, and the arr looks it up again on its own metadata service. So the end-to-end
+  test of the whole stack (success criterion 1) stops at the links: Seerr signed in
+  through Jellyfin, linked to Jellyfin with both libraries and to both arrs, each passing
+  Seerr's own test, a second `apply` with no changes, and hand changes put back.
+- **The typed HTTP client** gains a sign-in whose session lives in a cookie, kept out of
+  every message, and a sign-in's fields of any JSON type.
+- **No new Docker API call:** Seerr's setup is the same unpublished `up` and recreate as
+  Jellyfin's (§7.2(2)).
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index 9287f11..d4ba70a 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -23,2 +23,3 @@ Detailed plans so far:
 - Slice 5: [`m1-s5-jellyfin.md`](m1-s5-jellyfin.md) (done).
+- Slice 6: [`m1-s6-requests.md`](m1-s6-requests.md) (done).
 
@@ -26,5 +27,5 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4 and S5.
-- **Next:** S6 (requests).
-- **After that:** S7 to S9.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5 and S6.
+- **Next:** S7 (Plex).
+- **After that:** S8 and S9.
 
@@ -184,4 +185,5 @@ and its final review an S5 item, two S8 items, a probe in two others, two S9 tes
 and an S9 docs item. Slice 5 (2026-10-15) added an S6 item, six S8 items and an S9
-item, and extended one, and its final review an S8 item and four S9 items. Each slice
-plan must address the items for that slice.
+item, and extended one, and its final review an S8 item and four S9 items. Slice 6
+(2026-10-16) added an S7 item and changed one, added five S8 items and changed one, and
+added an S9 item. Each slice plan must address the items for that slice.
 
@@ -400,2 +402,10 @@ password, which are S3c's (and listed again below).
   be set up, or one whose key is refused, skips it rather than fails it.
+  - **Done in S6,** as a first-run setup: Seerr's setup is open to anyone on its port
+    until its first sign-in, so the sign-in runs before Seerr is published, where no
+    resource can be required. Setups run in the order of `after`, so Seerr's follows
+    Jellyfin's; it waits (`bootstrap.waiting`), unpublished, without failing the step,
+    while Jellyfin refuses the shared admin's password or after Jellyfin's setup failed,
+    and the wire step skips Seerr's resources. `seerr.media_server` requires
+    `jellyfin.admin`, so a Jellyfin that refuses its key skips it. Seerr's sign-in needs
+    the password, not Jellyfin's key.
 
@@ -411,5 +421,10 @@ password, which are S3c's (and listed again below).
   or the slice that brings it, so `credentials` says their login arrives in
-  Slice 7 (Plex) or Slice 6 (Seerr). Give `login` a value for your own account,
-  and use it for both. Seerr's `comingIn` says Slice 6 on a Plex stack too, where
-  Seerr's wiring comes in Slice 7 (S4): fix that with this item.
+  Slice 7. Give `login` a value for your own account, and use it for both. Since S6,
+  Seerr's `login` is `'shared'` on a Jellyfin stack, and on a Plex stack the catalog's
+  `notWiredYet` drops Seerr's API, integration and setup and makes its login say
+  Slice 7: remove that once Seerr's Plex sign-in is built.
+- **Seerr's Plex sign-in is open too** (S6, from Seerr 3.5's code). Before its first
+  user, `POST /api/v1/auth/plex` makes whoever signs in with a plex.tv account Seerr's
+  admin, as its Jellyfin sign-in does. Make it a first-run setup before Seerr is
+  published, as S6 made the Jellyfin one, and give Seerr's resources a Plex media server.
 - **Plex's web UI is at `/web`.** `credentials` prints `http://<address>:<port>`
@@ -520,3 +535,22 @@ password, which are S3c's (and listed again below).
   the wire step, as a failed start does. Let the wire step run past a failed first-run
-  setup, with that app's resources failed so `requires` skips them (spec §5.1).
+  setup, with that app's resources failed so `requires` skips them (spec §5.1). S6 did
+  this for a setup that waits (Seerr's, while Jellyfin refuses the shared admin), whose
+  app's resources are skipped; a failed one still stops the wiring.
+- **Seerr's checks log a line when they fail** (S6, probed): Seerr's own test of a
+  server, and its list of Jellyfin's users that checks its Jellyfin key, log an error in
+  Seerr's log, and a refused key one in the arr's. Decide how often scheduled drift may
+  run them.
+- **Seerr keeps its own Jellyfin key** (S6): the one its first sign-in made, named
+  `Seerr` in Jellyfin, which Mediaplane checks by using and never holds, so it can't be
+  rotated or redacted. Mediaplane gives Seerr its own Jellyfin key only when Seerr's is
+  refused. Decide whether drift should replace it, and remove the one Seerr made.
+- **A Seerr whose `settings.json` Mediaplane can't read** is set up again, unpublished,
+  on every `apply` (S6): two recreates each time, with a warning. Decide whether drift
+  reports it, or asks Seerr over the wiring network instead.
+- **Seerr's libraries are enabled by name, from Seerr's last sync** (S6). A library made
+  anew in Jellyfin has a new id; `plan` reads Seerr's last sync, which `apply` refreshes
+  only when the libraries differ. Decide whether drift syncs them, which writes to Seerr.
+- **Seerr's servers are its default** (S6): making `Sonarr (Mediaplane)` the default
+  clears a default of yours of the same kind, and a profile changed in Seerr is put back.
+  Keep mine must cover the servers' fields, and Seerr's libraries.
 - **A folder with a comma in its name, added by hand to a Jellyfin library** (S5), is
@@ -586,2 +620,7 @@ password, which are S3c's (and listed again below).
   instead of build.
+- **Registry rate limits in CI** (S6). S5's first arm64 run failed on
+  `toomanyrequests` during `docker compose pull`, after apply's four tries: the runners
+  pull every image afresh, anonymously. Pull with a read-only registry token kept as a
+  secret (never given to fork PRs), or through a pull-through cache, for the e2e and
+  image jobs. S6 adds no image: each e2e file pulls only what is missing.
 
```

- [ ] **Step 6: Check the docs rules, and commit**

```bash
grep -rnE "Slice 6" README.md catalog/*/README.md deploy/README.md docs/architecture.md docs/security docs/runbooks | grep -vE "with Slice 6\.|before Slice 6,"
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add README.md catalog deploy/README.md docs
git commit -m "docs: Seerr signed in through Jellyfin before it is published and linked to Jellyfin, Sonarr and Radarr; Slice 6 in the spec, the roadmap, the runbooks and the threat model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `grep` prints nothing, and the check passes (1666 tests). Every `text`
block in the changed docs is at most 40 columns wide.

## Slice 6 completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.64% of statements, 93.6% of branches, 98.8% of functions and 99.59% of lines, with 1666 tests in 83 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too (Task 5, Step 4),
  and leaves no `mediaplane-e2e-*` container or network, and no new volume or
  `mediaplane-e2e-*` folder. When this plan was replayed, alone on the dev box, warm:
  - with Compose 5.5.1, 9 files and 23 tests in 681 s (Slice 5's suite took 592 s; the
    requests file alone takes about a minute);
  - with Compose 2.38.2, the same in 718 s (Slice 5's: 635 s).

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] The socket proxy's allow-list is unchanged: `git diff 6c72fa3 --
  deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints nothing (decision 16).
  `6c72fa3` is `main` after S5.
- [ ] Seerr is never published while its setup is open: the requests e2e reads no port
  and an open setup after the first `up`, and the port only once its setup is done; the
  deploy e2e sets it up from the image, behind the proxy.
- [ ] No secret shows: the tests that check it pass (Seerr's, the arrs', Jellyfin's and
  Seerr's own Jellyfin key, and the admin password, in neither `state/resources.json` nor
  `apply`'s result; the session cookie and the password out of the client's messages;
  `expectNoSecrets` over the CLI's output with Seerr in the stack).
- [ ] `plan` never runs a first-run setup and never sends `initialize` (S5's "names the
  setup in plan, and never runs it there"; the requests e2e's first `plan`). Its marks in
  the apps are the four the spec, the threat model and the architecture name.
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  but the project's own names (its GitHub repo and schema URL, its GHCR image) and the
  tests' fake `/srv/data/home` paths, all there before this slice.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B 6c72fa3.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 1 (Seerr's sign-in as a first-run setup, not a resource that requires
    `jellyfin.admin`), 3 (a setup that waits, so the wire step runs), 6 (`notWiredYet` for
    Seerr with Plex), 8 (Seerr keeps the Jellyfin key it made while it works), 9 (the
    servers' keys, shown in clear, still checked by Seerr's own test, not compared), 10
    (`resolve` in the contract) and 14 (the e2e stops at the links, since a request needs
    TMDB);
  - that the e2e tests on Compose v2.38.2 and Docker 28 are confirmed by the slice PR's
    first CI run, on amd64 and arm64, as they were locally with Compose 2.38.2 on arm64;
  - for the owner's manual-steps list: a Plex stack's Seerr is still set up by hand, as
    soon as `apply` is done; a Seerr set up by hand before this slice is wired as it is,
    whoever its admin is; and Jellyfin keeps a key and a device named `Seerr`, which
    Seerr made.
