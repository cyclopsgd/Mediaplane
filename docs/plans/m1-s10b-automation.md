# M1 Slice 10b: removal and rotation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the first part of the roadmap's S10b, "automation": what the stack does when
it changes, so that a script can drive it. Take an app out of `stack.yaml`, and `apply`
removes its container and what Mediaplane made for it in the other apps (spec §8.1(3)
step 4), but anything that is yours or holds what is yours, and keeps its appdata. Keep
mine works with `managed_by: external`, giving the line to add. A new Plex token reaches
the arrs and Seerr (`--rotate plex.token`); a Plex signed out of its account while it ran
is claimed again; Seerr holds Mediaplane's Jellyfin key, not one of its own, and is asked
when its file can't be read. Jellyfin's database is read in a process of its own, with a
deadline. The second part, S10c, pins the contract a script reads and writes the docs
that complete M1.

**Architecture:**

- **Removal** (spec §4.2, §8.1(3) step 4): a resource may say how it is removed
  (`ResourceSpec.remove`) and why one may not be (`cannotRemove`, read from the app).
  `plan` lists each resource Mediaplane recorded that the stack no longer wants, and that
  the app still holds as Mediaplane made it (the id and the name its record keeps), as a
  wiring `remove`; apply's wire step looks it up again, removes it, and forgets its record.
  Drift still reports it as `left`, now saying why `apply` leaves one (`stays`).
- **Keep mine with `managed_by: external`** (§4.2): `keep` succeeds without writing
  `stack.yaml`, and gives the line to add (`line`, `written: false`).
- **Jellyfin's database** (§6.1, threat model T4): read by Node itself, started with a
  fixed program, the database handed to it open, killed after 10 seconds.
- **Seerr** (§6.1, §6.4): a resource may name secrets the app made itself (`adoptSets`),
  which apply gives the stack's in place of the first time; the resource's record says
  which it gave (`given`). Seerr's setup is asked (`Bootstrap.open`) when its
  `settings.json` can't be read.
- **The Plex token** (§6.1, §10): `--rotate plex.token` takes your new token as a change
  for each resource that holds it, and has Seerr's setup sign in again with it
  (`Bootstrap.signsInWith`, `again`).
- **A Plex signed out** (§6.4): Plex's setup claims it itself through its API, while
  unpublished; `plan` warns while it runs published.
- **Tests:** unit tests on fakes made no kinder than the apps (each fake's new answers
  were probed); a script-shaped end-to-end test that takes Radarr and the solver out of a
  running stack on real Docker, reading only `--json` and exit codes; the nightly Plex
  test rotates the token and claims Plex again with a real plex.tv account.

**Tech Stack:** as Slice 10a (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2, `node:sqlite`). No new dependency and
no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3 (the success criteria; criterion 3, a second `apply` changes nothing);
- §4.2 ("Removing an app never deletes its `appdata/`", externally managed mode);
- §5 (the apply flow), §5.2 (`plan`, `apply`, `keep`);
- §6.1 (Plex's claim and token, key recovery), §6.3 (the drift model), §6.4 (first-run
  setups before publish);
- §7 (security: §7.2(2), no new proxy permission; §7.2(4), secrets);
- §8.1(3) (the end-to-end suite, step 4: "removes an app");
- §9 (the docs set), §10, §11 (every slice's refinements, Slice 10a's included).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S10 row and its list,
every item marked "Moved to S10b", "S9 and S10 (before going public)", and "After M1".

### S10b in two parts (decision 1)

S10b, as the roadmap lists it, is about 15 tasks: too large for one plan. It splits along
what each part changes, as S10 split before:

- **S10b, removal and rotation (this plan):** what the stack does when it changes.
  - What an app leaving the stack had in the others, removed (spec §8.1(3) step 4).
  - Keep mine with `managed_by: external`, its line to add in `mediaplane.keep/v1`.
  - Jellyfin's database read in a process of its own, with a deadline.
  - Seerr's own Jellyfin key replaced, and Seerr asked when its `settings.json` can't be
    read.
  - A new Plex token for the arrs and Seerr, Seerr signed in again with it (the fake
    Seerr's `/auth/me` fixed with it).
  - A Plex signed out of its account while it ran, claimed again.
  - Success criterion: a script, with no terminal and reading only `--json` and exit
    codes, deploys the Jellyfin stack on real Docker, takes Radarr and the Cloudflare
    solver out, and `apply` removes their containers and what they had in the other apps,
    leaves a category that holds a torrent until the torrent moves, keeps Radarr's
    appdata, and then changes nothing. The nightly Plex test rotates the token and claims
    a signed-out Plex again.
- **S10c, the automation contract and the docs (the next plan):** what a script reads.
  - The `--json` shapes pinned and in the generated docs: `history <id> --json`
    included, and `ok` on `credentials`, `status` and `history`.
  - Exit codes; commands that ask nothing when a script runs them.
  - `plan --help` and `drift --help` pointing at the published docs.
  - The "deploying with automation" guide with a short Ansible example, the full README
    and the add-an-app guide.
  - The test gaps, CI's end-to-end pulls made robust against a temporary registry error,
    S9's review items, which Compose versions work out a service differently, and the
    nightly Plex job's items.
  - Success criterion: a playbook deploys a stack, removes an app from it, and rebuilds
    the host, reading only the documented contract.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`): the exact `git diff -U1`
  output, with one line of context. Save it to a file and run `git apply <file>` from the
  repo root, or make the same edit by hand. Apply a task's blocks in the order given.
- **Blocks are fenced with four backticks,** so that a Markdown file's own fences inside
  one stay as they are.
- **Generated files are never edited by hand.** A step that changes the CLI says to run
  `pnpm docs:generate`, and names what it rewrites.
- Every block was applied in order to a fresh worktree at `7b2a169`, and each task's tests
  failed before its implementation and passed after it (see the completion checklist).

## Global Constraints

Everything in the Slice 1 to 10a Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md` to `docs/plans/m1-s10a-recovery.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses, hostnames, tokens or ids in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-admin-password`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps but for its documented marks;
- Docker is reached only through the `Runtime` (the end-to-end tests may call `docker`
  themselves);
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
- the integration contract (S3b to S10a) and bootstrap before publish (S5 to S10a) are
  unchanged but as decisions 2 to 11 say; keys go only to the stack's own addresses;
- never push, tag, release, or publish anything; never change the repository's settings.

The spec's exact values for this slice, verbatim:

- §4.2: "**Removing an app never deletes its `appdata/`.** The plan shows the container
  and its links being removed. Deleting data is a documented manual step."
- §4.2: "**Externally managed mode.** With `managed_by: external`, Mediaplane never
  writes `stack.yaml`. `migrate` and Keep mine print the snippet to add instead."
- §8.1(3), step 4: "removes an app, then asserts that its container and links are gone
  and its `appdata/` remains;"
- §6.1, Plex: "A claim token is fetched from plex.tv at apply time using the user's token,
  then passed as `PLEX_CLAIM` on first start, so the 4-minute claim expiry is never a
  problem".
- §6.3, the rules: "**Identity is the app-assigned ID** recorded in `resources.json`.";
  "**Drift never writes to an app.** Only `apply` does."
- §6.3, the table: "Managed resource missing | Deleted outside Mediaplane | `drift` and
  `plan` | Re-apply recreates it. Keep mine records `<app>.<resource>: unmanaged`, and
  Mediaplane stops managing it".
- §7.2(2): "Mediaplane never mounts the raw socket. A minimal proxy container allows only
  the endpoints Compose needs (containers, images, networks, volumes, and the reads used
  by `--wait`) and blocks `exec`, swarm, plugins, secrets, configs and system."
- §7.2(4): "Secrets are redacted in logs and change records."
- §2.3, criterion 3: "**Idempotent.** A second `apply` reports `No changes`, exits 0 and
  modifies nothing."

These are added or restated for this slice:

- **Secrets never appear** in output, `--json`, errors, change records,
  `state/resources.json`, logs, a command line, or end-to-end failure messages: each
  app's key and the admin password; the plex.tv token, a claim token, and Seerr's Plex
  and Jellyfin credentials. A resource's record names the secrets Mediaplane gave
  (`given`), never their values. The database reader gets the key's query on its standard
  input, and gives the key on its standard output, never in its arguments or
  environment. End-to-end checks compare secrets as yes or no.
- **Removing an app deletes only what Mediaplane's own records say it made,** and only
  after looking it up again and finding it still as Mediaplane made it: the same id and
  the same name. One that holds what is yours (a category with torrents) stays. An app's
  own records stay when it leaves, as its appdata does.
- **Fail closed:** an app that can't say whether a resource holds what is yours keeps it
  (the removal fails, and is tried again at the next `apply`); a Seerr that can't be asked
  whether its setup is open is set up again, unpublished; a database read that doesn't
  answer in time is a key file that couldn't be read; a Plex signed out is published only
  once plex.tv says its new token is your account's.
- **`plan` changes nothing.** Only `apply` removes, gives a new token, signs Seerr in
  again, or claims Plex.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and
  `deploy/deploy.test.ts` don't change.
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. This slice adds no Compose
  flag.
- **Commits** use Conventional Commits. Each message ends with exactly one trailer line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and never a `Claude-Session`
  line. The commit steps below pass it as a second `-m`.
- **Before every commit, run the full check:**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`. A task
  that changes the CLI runs `pnpm docs:generate` first, and commits the generated files
  with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it.
  - Short, plain sentences; lists rather than wide tables; no internal jargon.
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid,
    because Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.

## What was probed

On the dev box (aarch64, Docker 29.8, Compose 5.5.1), against the catalog's pinned images
(Sonarr 4.0.20, Radarr 6.4.4, Prowlarr 2.6.5, qBittorrent 5.2.4, Jellyfin 12.2, Seerr
3.5.0, Plex 1.43.4), in `mediaplane-e2e-probe*` projects of its own, from source at
`7b2a169` and then with this plan's code; plex.tv with an account kept for tests, its
token read from a file, never printed:

1. **What `--json` prints today.** `plan`, `apply`, `drift` and `keep` carry `ok`;
   `status` (`mediaplane.status/v1`), `history` (`mediaplane.history/v1`) and
   `credentials` (`mediaplane.credentials/v1`) don't. That is S10c's.
2. **An app taken out of a running stack, with `7b2a169`.** The Jellyfin stack applied,
   then Radarr removed from `stack.yaml` and Byparr disabled: `plan` removes their
   containers, and drift reports `qbittorrent.category_movies`,
   `prowlarr.application_radarr`, `prowlarr.indexer_proxy` and `seerr.server_radarr` as
   `left`, still in their apps.
3. **Deleting each through its app's API.**
   - Prowlarr's application and indexer proxy, and an arr's download client and
     notification: `DELETE /api/v1/<kind>/<id>` (or `/api/v3/`) answers 200 with `{}`,
     and 200 again for one that is gone. The `cloudflare` tag stays, on the indexers too.
   - qBittorrent: `POST /api/v2/torrents/removeCategories` answers 200, and 200 again for
     one that is gone. A torrent in the category loses it (`category: ''`), and, with
     Automatic Torrent Management on, its save path moves to `/data/torrents`: its files
     would move.
   - Seerr: `DELETE /api/v1/settings/radarr/<id>` answers 200 with the server; again,
     500 with an HTML page.
   - Once each is deleted by hand, drift is clear; the records stay.
4. **Seerr's Jellyfin key.** After Seerr's first sign-in, Jellyfin lists two keys, named
   `Mediaplane` and `Seerr`. Seerr given Mediaplane's key (`POST
   /api/v1/settings/jellyfin` with `apiKey`) answers 200 and keeps its server id; its user
   import still works; `DELETE /Auth/Keys/<Seerr's key>` answers 204, and Seerr keeps
   working.
5. **Seerr and the Plex token.** Seerr's `/api/v1/auth/me` and `/api/v1/user/1` never show
   its admin's Plex token; its database's `user.plexToken` holds it. plex.tv refuses to
   mint a second token by PIN without a person signing in (403, code 1068), so the probe
   used Plex's own server token, which plex.tv says is the same account's. `POST
   /api/v1/auth/plex` with it answers 200 as user 1, and Seerr's database then holds it.
   The original token was signed in again after.
6. **A Plex signed out while it runs.** `DELETE /myplex/account` with Plex's token
   unclaims it at once; `Preferences.xml` keeps `PlexOnlineToken=""`; it stays published.
   With `7b2a169`, `plan` lists Plex's setup, unpublished, and `apply` fails with
   `didn't claim itself as it started`: the image's claim step logs `Server already
   claimed`, since it looks only for the attribute's name. `POST /myplex/claim?token=<a
   claim token>` to Plex over the wiring network, with `Host` its address, answers 200:
   claimed again, the same machine id, a new token of your account. Sent with `Host`
   `plex:32400`, Plex answers 401 (its DNS-rebinding check, found in the nightly test's
   first run).
7. **SQLite and named pipes.** A read-only open of a named pipe at the database's name
   hangs (killed by `timeout` after 10 seconds); a pipe at its `-wal` makes the read fail
   at once (`disk I/O error`).
8. **The plan's code end to end.** The removal test (Task 2), and the nightly Plex test's
   rotation and claim (Tasks 6 and 7) with the test account, pass; every server claimed
   was removed from the account after.

## Decisions taken in this plan

Each task names the decisions it applies. The ones to look at first are marked
**(check)**.

1. **(check) S10b ships in two parts,** S10b (removal and rotation) and S10c (the
   automation contract and the docs), as "S10b in two parts" says above. The cut is the
   one S10 made: behaviour first, proven on real Docker by a script; then the contract
   that script reads, and the docs, proven by the playbook. Each part is about eight
   tasks. The CI pull flakiness and the other test gaps go to S10c, with the test-gaps
   work.
2. **What an app leaving the stack had in the others is removed** (spec §4.2, §8.1(3)
   step 4; the S8 item moved here). Only a resource Mediaplane recorded in
   `state/resources.json`, that the stack no longer wants, and that its app still holds
   as Mediaplane made it: the id and the name its record keeps (`madeAsRecorded`). One
   renamed, or held under another id, may be yours now, and stays. `plan` lists each as a
   wiring `remove`, after the app starts when it isn't settled; apply's wire step, after
   the app's wanted resources, looks each up again, removes it (`remove`), and forgets its
   record, saving `state/resources.json` at once. A kind with no `remove` stays. Drift
   still reports each as `left`, and now says why `apply` leaves one (`stays`). `keep
   <app>.<resource>` first keeps one as yours. Removal never touches the leaving app's own
   records, which stay with its appdata.
3. **(check) A qBittorrent category with a torrent in it stays** (probe 3): removing it
   takes the category from its torrents, and Automatic Torrent Management moves their
   files to `/data/torrents`. `cannotRemove` asks qBittorrent for the category's
   torrents; `plan` and drift say it stays, and why. A failed answer fails the removal.
4. **Seerr's media server is never removed:** it is Seerr's own setting, which a switch
   of media server sets up afresh (§10). Seerr's arr servers, Prowlarr's links and proxy,
   and the arrs' download clients and connections are removable (`DELETE`, probe 3).
5. **The new wiring action is additive within v1:** `remove` joins `mediaplane.plan/v1`'s
   and `mediaplane.change/v1`'s wiring actions. An older release lists a change record
   that holds one as one it can't read, as for any record of a later release.
6. **(check) Keep mine with `managed_by: external` succeeds and gives the line** (§4.2:
   "Keep mine print[s] the snippet to add instead"). `mediaplane.keep/v1` gains `line`
   and `written` (additive); it exits 0, with a warning (`keep.external`). It records
   nothing as applied, since `stack.yaml` doesn't hold the line yet; for `unmanaged`, it
   forgets the resource's record at once, so that no `apply` removes it meanwhile. A
   write it refuses gives the line too.
7. **(check) Jellyfin's database is read in a process of its own, with a deadline** (the
   S10a review item; threat model T4). That is a new way for the engine to start a
   process: Node itself (`process.execPath`), with a fixed program on `--eval`, no shell,
   an empty environment, the database handed to it open as fd 3 (SQLite opens
   `/proc/self/fd/3`, so the path is never opened again by name), the query on its
   standard input, the answer on its standard output (at most 64 KiB), killed after 10
   seconds (probe 7). The checks that the path is still the file read run after it
   answers. Anything else it answers is a key file that couldn't be read.
8. **(check) Seerr's own Jellyfin key is replaced with Mediaplane's** (the S6 item moved
   here). A resource may name the secrets its app made itself (`adoptSets`): until its
   record says Mediaplane gave them (`given`, names only, optional within
   `mediaplane.resources/v1`), apply takes them as a change, unchecked, so nothing is
   compared, as S8 decided for every secret (checked, never compared). Seerr's update then
   has Jellyfin delete the key Seerr held, only if Jellyfin lists it under the name Seerr
   gives its own (`Seerr`), and it isn't Mediaplane's (probe 4). A resource's `update`
   gets apply's `VerifyContext` for that. An install from before gets it at its next
   `apply`, since its record has no `given`.
9. **Seerr is asked when its `settings.json` can't be read** (the S6 item moved here), when
   Mediaplane's store says it set Seerr up (`setUp`): `plan` asks Seerr itself
   (`Bootstrap.open`, without its key) once it reaches it. One that says its setup is
   done stays as it is; one that says it is open, or can't be asked, is set up again,
   unpublished (fail closed), as before.
10. **(check) A new Plex token is rotated by `--rotate plex.token`** (the S7 items moved
    here). Mediaplane can't tell that a token changed by comparing secrets (S8), and
    Seerr never shows the one it holds (probe 5), so you say so. Each resource that holds
    it takes it as a change, unchecked, but one whose own app refuses it (Plex, for a
    token of another account) stays as checked. Seerr's setup, which says it signs in with
    `plex.token` (`signsInWith`), runs again, published (`again`): it checks through
    plex.tv that Seerr's admin is the new token's account, as for a Seerr set up already,
    and signs in again (probe 5). `plex-login` says to run it when it replaces a token.
11. **(check) A Plex signed out of its account is claimed through its API** (the S7 item
    moved here). That departs from §6.1's "passed as `PLEX_CLAIM` on first start": the
    image never uses `PLEX_CLAIM` once `Preferences.xml` has the attribute, even empty
    (probe 6). While Plex runs signed out, published, `plan` warns
    (`bootstrap.open-published`), and `apply` starts it unpublished, gets a claim token
    from plex.tv with your token, and posts it to Plex over the wiring network, to Plex's
    address (`AppApi.submit`'s `byAddress`), as Plex's DNS-rebinding check requires; then
    the checks of a first start publish it only once plex.tv says it is yours. A first
    start still uses `PLEX_CLAIM`.
12. **No new Docker API call:** the removals, the claim and Seerr's sign-in are the apps'
    APIs over the wiring network, and the database read is a local process (§7.2(2)).
13. **The proof.** `test/e2e/remove.e2e.test.ts` (Task 2) drives the CLI as a script
    would, on real Docker; the nightly Plex test (Tasks 6 and 7) rotates the token and
    claims a signed-out Plex with a real account; the request, apply, deploy and rebuild
    tests see Seerr holding Mediaplane's key (Task 5).

## File structure (new and changed in this slice)

- `packages/engine/src/integrations/types.ts`: `ResourceSpec.cannotRemove`, `remove`,
  `adoptSets`; `update`'s `ctx`.
- `packages/engine/src/integrations/wiring.ts`, `integrations/wire.ts`: the `remove`
  action, `Drift.stays`, `leftOf`, `madeAsRecorded`, `whyItStays`; `adoptSets`, `given`,
  `ask`, `rotated`.
- `packages/engine/src/integrations/resources.ts`: the record's `given`.
- `catalog/_shared/servarr-provider.ts`, `catalog/{prowlarr,qbittorrent,seerr}/integration.ts`:
  each resource's `remove`, qBittorrent's `cannotRemove`, Seerr's `adoptSets`.
- `packages/engine/src/keep.ts`: Keep mine with `managed_by: external`.
- `packages/engine/src/secrets/database.ts` (new), `secrets/recover.ts`: the database read.
- `packages/engine/src/plan/plan.ts`, `plan/bootstrap.ts`, `apply/bootstrap.ts`,
  `catalog/types.ts`: Seerr asked, `--rotate plex.token`, `again`, `signsInWith`,
  `bootstrap.open-published`.
- `catalog/seerr/bootstrap.ts`, `catalog/plex/bootstrap.ts`: Seerr signed in again; Plex
  claimed again.
- `packages/engine/src/http/client.ts`: `submit`'s `byAddress`.
- `packages/engine/src/history/records.ts`: the `remove` action and `again`.
- `packages/cli/src/output.ts`, `run.ts`, `plex-login.ts`: the new lines, `keep`'s line to
  add, `--rotate plex.token`.
- The fakes in `packages/engine/src/testing/`: deletes, torrents, Seerr's sessions and
  keys, a Plex signed out.
- `test/e2e/remove.e2e.test.ts` (new); `test/e2e/{plex,requests,apply,deploy,rebuild}.e2e.test.ts`.
- Docs: the apps' READMEs, `docs/architecture.md`, `docs/security/threat-model.md`, ADR
  0003, the runbooks, `README.md`, the spec and the roadmap; `docs/reference/cli.md`
  (generated).


### Task 1: Removal in the engine: what Mediaplane made that the stack no longer wants

Decisions 2 and 5. The contract gains `remove` and `cannotRemove`; `plan` lists each
resource Mediaplane recorded that the stack no longer wants, while its app still holds it
as made, as a wiring `remove`; apply's wire step removes it and forgets its record; drift
says why `apply` leaves one. No catalog resource has `remove` yet (Task 2), so nothing in
a real stack changes in this task.

**Files:**
- Modify: `packages/engine/src/integrations/types.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/integrations/wire.ts`, `packages/engine/src/history/records.ts`, `packages/cli/src/output.ts`
- Test: `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/integrations/wire.test.ts`, `packages/engine/src/history/records.test.ts`, `packages/cli/src/output.test.ts`

**Interfaces:**
- **Consumes:** `planWiring`, `wire`, `examine`, `Drift` (`kind: 'left'`), `KnownResource`, `writeResources` (unchanged).
- **Produces:**
  - `ResourceSpec.cannotRemove?(api: AppApi, observed: ObservedResource): Promise<string | undefined>` and `ResourceSpec.remove?(api: AppApi, observed: ObservedResource): Promise<void>`; each throws `AppApiError`.
  - `WiringAction` gains `'remove'` (in `mediaplane.plan/v1` and `mediaplane.change/v1`); `Drift.stays?: string` (why apply leaves a `left` one).
  - `leftOf(ctx: WiringContext, known: KnownResources, only?: string): { spec: ResourceSpec; address: string; record: KnownResource }[]` (the app's resources Mediaplane recorded that the stack no longer wants), `madeAsRecorded(observed: ObservedResource, record: KnownResource): boolean`, `whyItStays(spec: ResourceSpec, api: AppApi, observed: ObservedResource, record: KnownResource): Promise<string | undefined>`, all exported from `integrations/wiring.ts`.
  - Apply's wire step: `done` `<address> removed`, its record's detail `removed`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/integrations/wiring.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 082baad..ed188f4 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -85,2 +85,22 @@ function sonarrWith(resources: ResourceSpec[], ...overrides: string[]) {
 
+/**
+ * Sonarr's resource "gone", which the stack no longer wants and apply would remove: held
+ * as `held`, or not at all; with why it can't be removed, when `cannot` says. Plan never
+ * removes it.
+ */
+function leftBehind(
+  held: { id: number; name: string } | undefined,
+  cannot?: string,
+): ResourceSpec {
+  return {
+    ...FAKE_LOGIN,
+    name: 'gone',
+    desired: () => undefined,
+    observe: () =>
+      Promise.resolve(held === undefined ? undefined : { ...held, fields: {} }),
+    ...(cannot === undefined ? {} : { cannotRemove: () => Promise.resolve(cannot) }),
+    remove: () => Promise.reject(new Error('plan never removes')),
+  };
+}
+
 describe('planWiring', () => {
@@ -1678,3 +1698,10 @@ describe('planWiring: what drift adds (spec §6.3)', () => {
     );
-    expect(planned.drift).toEqual([{ resource: 'sonarr.gone', kind: 'left' }]);
+    // FAKE_LOGIN has no remove: apply leaves it, saying why.
+    expect(planned.drift).toEqual([
+      {
+        resource: 'sonarr.gone',
+        kind: 'left',
+        stays: "Mediaplane doesn't remove this kind of resource",
+      },
+    ]);
     // One the app can't say about is never said to be gone: it couldn't be looked at.
@@ -1695,2 +1722,75 @@ describe('planWiring: what drift adds (spec §6.3)', () => {
 
+  it('plans to remove what Mediaplane made that the stack no longer wants, only while the app holds it as made', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const made = { ...(RECORDED['sonarr.login'] as KnownResource), id: 7, name: 'gone' };
+    const planOf = (spec: ResourceSpec) =>
+      planWiring(
+        options(sonarr, {
+          stack: sonarrWith([FAKE_LOGIN, spec]),
+          known: { ...RECORDED, 'sonarr.gone': made },
+        }),
+      );
+    const asMade = await planOf(leftBehind({ id: 7, name: 'gone' }));
+    expect(asMade.changes).toEqual([
+      { resource: 'sonarr.login', action: 'unchanged' },
+      { resource: 'sonarr.gone', action: 'remove' },
+    ]);
+    expect(asMade.drift).toEqual([{ resource: 'sonarr.gone', kind: 'left' }]);
+    // Renamed in the app, or another of the name: maybe yours, so it stays, saying why.
+    const notAsMade =
+      "it is no longer as Mediaplane made it (its name or its id in the app has changed), so it may be yours: Mediaplane doesn't remove it";
+    for (const held of [
+      { id: 7, name: 'mine' },
+      { id: 8, name: 'gone' },
+    ]) {
+      const kept = await planOf(leftBehind(held));
+      expect(kept.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+      expect(kept.drift).toEqual([
+        { resource: 'sonarr.gone', kind: 'left', stays: notAsMade },
+      ]);
+    }
+    // One whose app holds what is yours in it stays too, as the resource says, redacted.
+    const yours = await planOf(
+      leftBehind({ id: 7, name: 'gone' }, `it holds 2 torrents, ${PASSWORD}`),
+    );
+    expect(yours.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+    expect(yours.drift).toEqual([
+      { resource: 'sonarr.gone', kind: 'left', stays: 'it holds 2 torrents, ***' },
+    ]);
+    // One the app can't say about is never removed: a check that couldn't be made.
+    const unsure = await planOf({
+      ...leftBehind({ id: 7, name: 'gone' }),
+      cannotRemove: () => Promise.reject(new AppApiError('no', { kind: 'server' })),
+    });
+    expect(unsure.changes).toEqual([
+      { resource: 'sonarr.login', action: 'unchanged' },
+      {
+        resource: 'sonarr.gone',
+        action: 'unknown',
+        reason:
+          "Mediaplane made sonarr.gone, which the stack no longer wants, and couldn't tell whether sonarr still holds it: no",
+      },
+    ]);
+    expect(unsure.drift).toEqual([]);
+  });
+
+  it('says what apply may remove once an app that is not settled has started, and only that', async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const record = (name: string) =>
+      ({ ...(RECORDED['sonarr.login'] as KnownResource), id: 7, name }) as KnownResource;
+    const kept: ResourceSpec = { ...FAKE_LOGIN, name: 'kept', desired: () => undefined };
+    const planned = await planWiring(
+      options(sonarr, {
+        stack: sonarrWith([FAKE_LOGIN, leftBehind(undefined), kept]),
+        changing: new Set(['sonarr']),
+        known: { 'sonarr.gone': record('gone'), 'sonarr.kept': record('kept') },
+      }),
+    );
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'after-start' },
+      { resource: 'sonarr.gone', action: 'after-start' },
+    ]);
+    expect(sonarr.app.requests).toEqual([]);
+  });
+
   it('sends an app no key it was found refusing, until apply checks it, nor checks what holds it', async () => {
````

**Change** `packages/engine/src/integrations/wire.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index ae81210..93d1ddf 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -1080,2 +1080,110 @@ describe('wire', () => {
   });
+
+  it('removes what Mediaplane made that the stack no longer wants, while still as made, and forgets its record', async () => {
+    const left = leftOver({ 7: 'gone', 8: 'mine' });
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const { run, home, actions } = await wireWith(sonarr, {
+      stack: left.stack,
+      known: {
+        ...RECORDED,
+        'sonarr.gone': made(7, 'gone'),
+        // Renamed in the app since: maybe yours, so it stays.
+        'sonarr.renamed': made(8, 'renamed'),
+        // Gone from the app already: nothing to remove.
+        'sonarr.vanished': made(9, 'vanished'),
+      },
+    });
+    expect(await run).toEqual(['sonarr.gone removed']);
+    expect(left.removed).toEqual([7]);
+    expect(actions).toEqual([
+      { step: 'wire', resource: 'sonarr.login', result: 'done', detail: 'unchanged' },
+      { step: 'wire', resource: 'sonarr.gone', result: 'done', detail: 'removed' },
+    ]);
+    expect(Object.keys(await readResources(home))).toEqual([
+      'sonarr.login',
+      'sonarr.renamed',
+      'sonarr.vanished',
+    ]);
+  });
+
+  it('fails a removal the app refuses, keeping its record, and each the plan named in an app it cannot reach', async () => {
+    const refusal = new AppApiError('Sonarr at http://sonarr:8989 refused it', {
+      kind: 'rejected',
+      status: 400,
+    });
+    const left = leftOver({ 7: 'gone' }, () => Promise.reject(refusal));
+    const known = { ...RECORDED, 'sonarr.gone': made(7, 'gone') };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const refused = await wireWith(sonarr, { stack: left.stack, known });
+    const failure = await refused.run.catch((thrown: unknown) => thrown);
+    expect((failure as WiringFailed).message).toBe('the wiring failed for sonarr.gone');
+    expect(refused.actions.at(-1)).toEqual({
+      step: 'wire',
+      resource: 'sonarr.gone',
+      result: 'failed',
+      error: 'Sonarr at http://sonarr:8989 refused it',
+    });
+    expect(Object.keys(await readResources(refused.home))).toEqual([
+      'sonarr.gone',
+      'sonarr.login',
+    ]);
+    // The app refuses Mediaplane's key: what the plan said it removes fails with it.
+    const refusing = await fakeSonarr({ key: 'f'.repeat(32) });
+    const unreached = await wireWith(refusing, {
+      stack: left.stack,
+      known,
+      planned: [{ resource: 'sonarr.gone', action: 'remove' }],
+    });
+    const cause = await unreached.run.catch((thrown: unknown) => thrown);
+    expect((cause as WiringFailed).message).toBe(
+      'the wiring failed for sonarr.login, sonarr.gone',
+    );
+    expect(left.removed).toEqual([]);
+  });
 });
+
+/** A record of a resource Mediaplane made in Sonarr, as `id` named `name`. */
+function made(id: number, name: string): KnownResource {
+  return { ...(RECORDED['sonarr.login'] as KnownResource), id, name };
+}
+
+/**
+ * The wiring stack, with Sonarr's FAKE_LOGIN and three resources it no longer wants,
+ * `gone`, `renamed` and `vanished`, which Sonarr holds as `held` says, by id: each one
+ * removed goes from `held` into `removed`, unless `remove` is given.
+ */
+function leftOver(
+  held: Record<number, string>,
+  remove?: ResourceSpec['remove'],
+): { stack: ReturnType<typeof stackOf>; removed: number[] } {
+  const removed: number[] = [];
+  const holds = new Map(Object.entries(held).map(([id, name]) => [Number(id), name]));
+  const spec = (name: string): ResourceSpec => ({
+    ...FAKE_LOGIN,
+    name,
+    desired: () => undefined,
+    observe: (_api, known) => {
+      const id = Number(known?.id);
+      const holding = holds.get(id);
+      return Promise.resolve(
+        holding === undefined ? undefined : { id, name: holding, fields: {} },
+      );
+    },
+    remove:
+      remove ??
+      ((_api, observed) => {
+        removed.push(Number(observed.id));
+        holds.delete(Number(observed.id));
+        return Promise.resolve();
+      }),
+  });
+  const resources = [FAKE_LOGIN, spec('gone'), spec('renamed'), spec('vanished')];
+  return {
+    stack: stackOf(
+      WIRED_CATALOG.map((def) =>
+        def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
+      ),
+    ),
+    removed,
+  };
+}
````

**Change** `packages/engine/src/history/records.test.ts`:

````diff
diff --git a/packages/engine/src/history/records.test.ts b/packages/engine/src/history/records.test.ts
index d28725c..db69164 100644
--- a/packages/engine/src/history/records.test.ts
+++ b/packages/engine/src/history/records.test.ts
@@ -110,2 +110,24 @@ describe('history records', () => {
 
+  it('keeps what the plan removes from an app, as it keeps the rest of the wiring', async () => {
+    const home = await tempDir('mediaplane-history-');
+    const base = record('20261009T094312Z-00000005');
+    const removing: ChangeRecord = {
+      ...base,
+      plan: {
+        ...base.plan,
+        wiring: [{ resource: 'prowlarr.application_radarr', action: 'remove' }],
+      },
+      actions: [
+        {
+          step: 'wire',
+          resource: 'prowlarr.application_radarr',
+          result: 'done',
+          detail: 'removed',
+        },
+      ],
+    };
+    await writeRecord(home, removing);
+    expect(await readRecord(home, removing.id)).toEqual(removing);
+  });
+
   it('never writes a field it does not know', async () => {
````

**Change** `packages/cli/src/output.test.ts`:

````diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index 416f075..f479121 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -181,3 +181,9 @@ describe('printPlan: drift', () => {
           { resource: 'prowlarr.application_radarr', kind: 'left' },
+          {
+            resource: 'qbittorrent.category_movies',
+            kind: 'left',
+            stays: 'it holds 2 torrents',
+          },
         ],
+        wiring: [{ resource: 'prowlarr.application_radarr', action: 'remove' }],
       },
@@ -191,6 +197,10 @@ describe('printPlan: drift', () => {
         "  ! sonarr.download_client.apiKey: holds qbittorrent's key, which qbittorrent refuses",
-        '  ? prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply leaves it',
+        '  - prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply removes it',
+        '  ? qbittorrent.category_movies: still in the app, though the stack no longer wants it; apply leaves it: it holds 2 torrents',
         "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app, and has an app that made its own key, such as Jellyfin, make another; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows. mediaplane keep <app>.<key> keeps the app's own key instead.",
-        "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report.",
-        'No changes.',
+        '  apply removes what Mediaplane made that the stack no longer wants; to keep one as yours instead, run mediaplane keep <app>.<resource> first, which also stops the report.',
+        "  what apply leaves, as said above, is yours to remove in the app if you don't want it; or keep it with mediaplane keep <app>.<resource>, which stops the report.",
+        'Wiring:',
+        '  - remove      prowlarr.application_radarr',
+        'Plan: 1 resource to remove.',
         '',
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/integrations/wiring.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/history/records.test.ts packages/cli/src/output.test.ts`

Expected: FAIL: 7 tests in 4 files (149 run). `wiring.test.ts` sees no `remove` change for a resource left behind, and no `stays`; `wire.test.ts` sees nothing removed (`expected [] to deeply equal [ 'sonarr.gone removed' ]`) and no failure for a removal the app refuses; `records.test.ts` can't read a record that holds one (`Invalid option: expected one of "create"|"update"|"adopt"|...`); `output.test.ts` sees the old advice for a resource left in an app.

- [ ] **Step 3: Implement**

The contract: how a resource is removed, and why one isn't.

**Change** `packages/engine/src/integrations/types.ts`:

````diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index 73b6c4a..7fe3de8 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -179,2 +179,16 @@ export interface ResourceSpec {
   ): Promise<void>;
+  /**
+   * Why apply won't remove what the app holds (`observed`), though the stack no longer
+   * wants it, read from the app and never changing it: one that holds what is yours, such
+   * as a qBittorrent category with torrents in it. Undefined when it may. Plan and apply
+   * ask it before `remove`. Throws AppApiError.
+   */
+  cannotRemove?(api: AppApi, observed: ObservedResource): Promise<string | undefined>;
+  /**
+   * Remove what the app holds (`observed`), once the stack no longer wants it (spec
+   * §8.1(3) step 4): only one Mediaplane made, by its record, and still as it made it (its
+   * id and name). Without it, apply leaves such a resource in the app, and drift reports
+   * it. Throws AppApiError.
+   */
+  remove?(api: AppApi, observed: ObservedResource): Promise<void>;
 }
````

The plan: `remove`, `stays`, and the checks both plan and apply make.

**Change** `packages/engine/src/integrations/wiring.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 1700c13..7dd823d 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -45,6 +45,8 @@ export const PLAN_DEADLINE_MS = 15_000;
  *   checked after the start;
- * - `unknown`: Mediaplane couldn't ask the app (`reason`, and a warning, say why).
+ * - `unknown`: Mediaplane couldn't ask the app (`reason`, and a warning, say why);
+ * - `remove`: Mediaplane made it, by its record, the stack no longer wants it, and the app
+ *   still holds it as Mediaplane made it: apply removes it (spec §8.1(3) step 4).
  */
 export type WiringAction =
-  'create' | 'update' | 'adopt' | 'unchanged' | 'after-start' | 'unknown';
+  'create' | 'update' | 'adopt' | 'unchanged' | 'after-start' | 'unknown' | 'remove';
 
@@ -74,3 +76,4 @@ export interface WiringChange {
  * - `left`: the app still holds a resource Mediaplane made that the stack no longer
- *   wants, such as Prowlarr's link to an arr taken out of the stack.
+ *   wants, such as Prowlarr's link to an arr taken out of the stack. Apply removes it,
+ *   unless `stays` says why it leaves it there.
  */
@@ -93,2 +96,7 @@ export interface Drift {
   source?: string;
+  /**
+   * left: why apply leaves it in the app: Mediaplane doesn't remove that kind of resource,
+   * the app holds what is yours in it, or it is no longer as Mediaplane made it.
+   */
+  stays?: string;
 }
@@ -897,6 +905,6 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
       for (const resource of targets) add({ resource, action: 'after-start' });
-      // Drift and keep say they couldn't look at what is left there either; apply's
-      // wire step doesn't look at it.
-      if (options.drift !== undefined) {
-        for (const change of leftUnasked(ctx, options.known, only)) add(change);
+      // Drift and keep say they couldn't look at what is left there either; plan, at
+      // what apply's wire step may remove, once the app has started.
+      for (const change of leftUnasked(ctx, options.known, only)) {
+        if (options.drift !== undefined || removable(ctx, change.resource)) add(change);
       }
@@ -1047,3 +1055,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
       diagnostics.push(...left.diagnostics);
-      for (const change of left.unknown) add(change);
+      for (const change of left.changes) add(change);
     }
@@ -1069,2 +1077,4 @@ function redacted(planned: PlannedWiring, secrets: readonly string[]): PlannedWi
   const drift = planned.drift.map((entry): Drift => {
+    // Why one left stays can name what the app holds: a reason, redacted as it is.
+    if (entry.stays !== undefined) return { ...entry, stays: hidden(entry.stays) };
     const actual = hidden(entry.actual);
@@ -1125,3 +1135,3 @@ async function healthOf(
 /** The resources Mediaplane recorded in `ctx`'s app that the stack no longer wants. */
-function leftOf(
+export function leftOf(
   ctx: WiringContext,
@@ -1161,7 +1171,50 @@ function leftUnasked(
 
+/** Whether the resource at `address`, of `ctx`'s app, is of a kind apply removes. */
+function removable(ctx: WiringContext, address: string): boolean {
+  return (ctx.app.def.integration?.resources ?? []).some(
+    (spec) => resourceAddress(ctx.app, spec) === address && spec.remove !== undefined,
+  );
+}
+
+/**
+ * Whether what the app holds is the resource Mediaplane made, as its record says: the
+ * same id in the app, and the name Mediaplane gave it. One renamed, or one of the name
+ * with another id, may be yours now: apply never removes it.
+ */
+export function madeAsRecorded(
+  observed: ObservedResource,
+  record: KnownResource,
+): boolean {
+  return observed.id === record.id && observed.name === record.name;
+}
+
+/** Why apply leaves a resource it doesn't remove: there is no way to. */
+const CANT_REMOVE = "Mediaplane doesn't remove this kind of resource";
+
+/** Why apply leaves a resource that is no longer as Mediaplane made it. */
+const NOT_AS_MADE =
+  "it is no longer as Mediaplane made it (its name or its id in the app has changed), so it may be yours: Mediaplane doesn't remove it";
+
+/**
+ * Why apply leaves `observed`, the app's resource of `spec` that the stack no longer
+ * wants, in the app; undefined when it removes it. Throws AppApiError.
+ */
+export async function whyItStays(
+  spec: ResourceSpec,
+  api: AppApi,
+  observed: ObservedResource,
+  record: KnownResource,
+): Promise<string | undefined> {
+  if (spec.remove === undefined) return CANT_REMOVE;
+  if (!madeAsRecorded(observed, record)) return NOT_AS_MADE;
+  return spec.cannotRemove?.(api, observed);
+}
+
 /**
  * The resources Mediaplane made in `ctx`'s app, by its record, that the stack no longer
- * wants and the app still holds (`left`): apply doesn't remove them. One you stopped it
- * managing (`unmanaged`) is yours. One the app can't say about is a warning, and a change
- * it couldn't check (`unknown`), never said to be gone: drift isn't clear then.
+ * wants and the app still holds (`left`): apply removes each that it can (`remove`),
+ * still as Mediaplane made it (spec §8.1(3) step 4), and drift says why it leaves the
+ * others (`stays`). One you stopped it managing (`unmanaged`) is yours. One the app can't
+ * say about is a warning, and a change it couldn't check (`unknown`), never said to be
+ * gone, nor removed: drift isn't clear then.
  */
@@ -1173,10 +1226,20 @@ async function leftIn(
   only?: string,
-): Promise<{ drift: Drift[]; diagnostics: Diagnostic[]; unknown: WiringChange[] }> {
+): Promise<{ drift: Drift[]; diagnostics: Diagnostic[]; changes: WiringChange[] }> {
   const drift: Drift[] = [];
   const diagnostics: Diagnostic[] = [];
-  const unknown: WiringChange[] = [];
+  const changes: WiringChange[] = [];
   for (const { spec, address, record } of leftOf(ctx, known, only)) {
     try {
-      if ((await spec.observe(api, record)) !== undefined) {
+      const observed = await spec.observe(api, record);
+      if (observed === undefined) continue;
+      const stays = await whyItStays(spec, api, observed, record);
+      if (stays === undefined) {
         drift.push({ resource: address, kind: 'left' });
+        changes.push({ resource: address, action: 'remove' });
+      } else {
+        drift.push({
+          resource: address,
+          kind: 'left',
+          stays: redact(stays, redactionValues(secrets)),
+        });
       }
@@ -1191,6 +1254,6 @@ async function leftIn(
       );
-      unknown.push({ resource: address, action: 'unknown', reason: said });
+      changes.push({ resource: address, action: 'unknown', reason: said });
     }
   }
-  return { drift, diagnostics, unknown };
+  return { drift, diagnostics, changes };
 }
````

Apply's wire step: each removal after the app's wanted resources, its record forgotten at
once.

**Change** `packages/engine/src/integrations/wire.ts`:

````diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 360f024..d51dfb5 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -30,2 +30,3 @@ import {
   knownSecrets,
+  leftOf,
   notOnNetwork,
@@ -37,2 +38,3 @@ import {
   wantedResources,
+  whyItStays,
   WIRING_RUNBOOK,
@@ -108,3 +110,5 @@ const HINTS = {
  * is ready and check its key, then make each of its resources what the stack wants, and
- * record it in state/resources.json at once. It reads that file again first, under
+ * record it in state/resources.json at once; then remove what Mediaplane made there that
+ * the stack no longer wants, while it is still as Mediaplane made it, and forget its
+ * record (spec §8.1(3) step 4). It reads that file again first, under
  * apply's lock, and never writes over one it can't read. A resource that fails doesn't
@@ -228,4 +232,11 @@ export async function wire(options: WireOptions): Promise<string[]> {
     const ctx: WiringContext = { stack, app, admin, keys: appKeys };
-    const targets = wiringTargets(ctx);
     const appId = app.def.id;
+    // What the stack wants, and what apply's own plan said it removes from the app: each
+    // fails, or is skipped, with the app.
+    const targets = [
+      ...wiringTargets(ctx),
+      ...(options.planned ?? [])
+        .filter((change) => change.action === 'remove' && ownedBy(change.resource, appId))
+        .map((change) => change.resource),
+    ];
     const why = options.held?.includes(appId)
@@ -390,2 +401,37 @@ export async function wire(options: WireOptions): Promise<string[]> {
     }
+    // Then what Mediaplane made there that the stack no longer wants (spec §8.1(3) step
+    // 4): looked at again, removed only while still as Mediaplane made it, and forgotten.
+    for (const { spec, address, record } of leftOf(ctx, known)) {
+      if (spec.remove === undefined) continue;
+      try {
+        const observed = await spec.observe(client.api, record);
+        // Gone already, or one apply leaves, as plan said why.
+        if (observed === undefined) continue;
+        if ((await whyItStays(spec, client.api, observed, record)) !== undefined)
+          continue;
+        await spec.remove(client.api, observed);
+      } catch (cause) {
+        if (!(cause instanceof AppApiError)) throw stop([address], cause);
+        fail(address, cause.message, `wire.${cause.kind}`);
+        continue;
+      }
+      Reflect.deleteProperty(known, address);
+      try {
+        await writeResources(options.home, known, keys);
+      } catch (cause) {
+        // The app holds it no more, as the next plan will find: say so.
+        throw stop(
+          [address],
+          cause,
+          `${app.def.name} no longer holds it, but state/resources.json could not be saved: `,
+        );
+      }
+      done.push(`${address} removed`);
+      options.record({
+        step: 'wire',
+        resource: address,
+        result: 'done',
+        detail: 'removed',
+      });
+    }
   }
````

**Change** `packages/engine/src/history/records.ts`:

````diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index 08d1877..ed48e89 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -76,3 +76,6 @@ const recordShape = (object: typeof z.strictObject) =>
       }),
-      /** What the plan said of each managed resource. Added in Slice 3b. */
+      /**
+       * What the plan said of each managed resource. Added in Slice 3b; `remove` in Slice
+       * 10b, which an older release lists among the records it can't read.
+       */
       wiring: z
@@ -88,2 +91,3 @@ const recordShape = (object: typeof z.strictObject) =>
               'unknown',
+              'remove',
             ]),
````

The CLI's lines.

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 1463983..23e9ba0 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -52,2 +52,3 @@ const WIRING_MARKS: Record<WiringAction, string> = {
   unknown: '?',
+  remove: '-',
   unchanged: ' ',
@@ -88,3 +89,5 @@ export function driftLine(drift: Drift): string {
     case 'left':
-      return `  ? ${drift.resource}: still in the app, though the stack no longer wants it; apply leaves it`;
+      return drift.stays === undefined
+        ? `  - ${drift.resource}: still in the app, though the stack no longer wants it; apply removes it`
+        : `  ? ${drift.resource}: still in the app, though the stack no longer wants it; apply leaves it: ${drift.stays}`;
   }
@@ -95,4 +98,4 @@ export function driftLine(drift: Drift): string {
  * a field, a resource or a secret changed in an app, and an app's own key where the app
- * keeps it in a file of its own; it removes nothing the stack no longer wants, so it is
- * never said to.
+ * keeps it in a file of its own; and it removes what Mediaplane made that the stack no
+ * longer wants, but for what it says it leaves (`stays`).
  */
@@ -111,5 +114,10 @@ export function driftAdvice(drift: readonly Drift[]): string[] {
       : []),
-    ...(has('left')
+    ...(drift.some((d) => d.kind === 'left' && d.stays === undefined)
+      ? [
+          'apply removes what Mediaplane made that the stack no longer wants; to keep one as yours instead, run mediaplane keep <app>.<resource> first, which also stops the report',
+        ]
+      : []),
+    ...(drift.some((d) => d.kind === 'left' && d.stays !== undefined)
       ? [
-          "apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report",
+          "what apply leaves, as said above, is yours to remove in the app if you don't want it; or keep it with mediaplane keep <app>.<resource>, which stops the report",
         ]
@@ -227,2 +235,3 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     count(tally('create', 'update', 'adopt'), 'resource', 'to wire'),
+    count(tally('remove'), 'resource', 'to remove'),
     count(tally('after-start'), 'wiring check', 'after the start'),
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/integrations/wiring.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/history/records.test.ts packages/cli/src/output.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS. Nothing generated changes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): remove what Mediaplane made once the stack no longer wants it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Removal in the catalog, and a script takes an app out of a running stack

Decisions 2 to 4, and 13. Each resource an app can stop wanting while its app stays gets
its `remove`: Prowlarr's links and indexer proxy, the arrs' download clients and
connections (one shared Servarr provider), qBittorrent's categories, and Seerr's arr
servers. A category with a torrent in it stays (`cannotRemove`). The fakes answer each
delete as the apps did (probe 3): the Servarr apps 200 whether or not they hold it,
Seerr a 500 page for one it doesn't, and qBittorrent moves a torrent out of a removed
category. The end-to-end test drives the CLI as a playbook would.

**Files:**
- Create: `test/e2e/remove.e2e.test.ts`
- Modify: `catalog/_shared/servarr-provider.ts`, `catalog/prowlarr/integration.ts`, `catalog/qbittorrent/integration.ts`, `catalog/seerr/integration.ts`, `packages/engine/src/testing/providers.ts`, `packages/engine/src/testing/wiring.ts`, `packages/engine/src/testing/seerr.ts`
- Test: `catalog/catalog.test.ts`, `catalog/_shared/servarr-connection.test.ts`, `catalog/_shared/servarr-download.test.ts`, `catalog/prowlarr/integration.test.ts`, `catalog/qbittorrent/integration.test.ts`, `catalog/seerr/integration.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** `ResourceSpec.remove`, `ResourceSpec.cannotRemove` (Task 1); `AppApi.submit`, `AppApi.form`, `AppApi.get`.
- **Produces:**
  - `removeProvider(api: AppApi, kind: ProviderKind, id: ObservedResource['id']): Promise<void>` in `catalog/_shared/servarr-provider.ts`; `servarrProvider(...)` returns `remove` with `verify`.
  - `prowlarr.indexer_proxy`, `qbittorrent.category_tv`/`_movies`, `seerr.server_sonarr`/`_radarr` gain `remove`; the categories gain `cannotRemove` (`it holds a torrent, which removing it would move to /data/torrents: …`).
  - Fakes: `FakeAppState.torrents` (qBittorrent's `torrents/info` and `removeCategories`); every Servarr provider `DELETE` answers 200 `{}`; the fake Seerr's server `DELETE`.

- [ ] **Step 1: Write the failing tests**

The fakes first, as the apps answered (probe 3).

**Change** `packages/engine/src/testing/providers.ts`:

````diff
diff --git a/packages/engine/src/testing/providers.ts b/packages/engine/src/testing/providers.ts
index 785c7f5..bb036c6 100644
--- a/packages/engine/src/testing/providers.ts
+++ b/packages/engine/src/testing/providers.ts
@@ -103,5 +103,5 @@ export interface FakeProviderKind<P extends FakeProviderBase> {
 /**
- * One kind of provider at `path`, as Sonarr, Radarr and Prowlarr serve them: listed, read
- * and updated by id, made from `templates`, and tested by `test`, with a masked key
- * standing for the one held.
+ * One kind of provider at `path`, as Sonarr, Radarr and Prowlarr serve them: listed, read,
+ * updated and removed by id, made from `templates`, and tested by `test`, with a masked
+ * key standing for the one held.
  * - A new provider is tested as it is saved, with forceSave too (which skips only the
@@ -141,3 +141,4 @@ export function fakeProviders<P extends FakeProviderBase>(
     if (failed !== undefined) return failed;
-    const made = { ...sent, id: held.length + 1 };
+    // A removed provider's id isn't given again.
+    const made = { ...sent, id: Math.max(0, ...held.map((p) => p.id)) + 1 };
     held.push(made);
@@ -164,2 +165,7 @@ export function fakeProviders<P extends FakeProviderBase>(
   }
+  // A removal: 200, whether or not it held one of that id (probed).
+  if (one !== null && one[2] === undefined && method === 'DELETE') {
+    if (found !== undefined) held.splice(held.indexOf(found), 1);
+    return { status: 200, body: {} };
+  }
   return undefined;
````

**Change** `packages/engine/src/testing/wiring.ts`:

````diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index 0dbd906..cbc153b 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -122,2 +122,4 @@ export interface FakeAppState {
   categories: Record<string, string>;
+  /** qBittorrent's torrents: each one's category ("" for none) and save path. */
+  torrents: { hash: string; category: string; savePath: string }[];
   /**
@@ -216,2 +218,3 @@ export function freshAppState(): FakeAppState {
     categories: {},
+    torrents: [],
     key: '',
@@ -384,3 +387,4 @@ function fakeServarrDownloads(
  * its links to them, its indexer proxies and its tags (fakeProwlarr); qBittorrent has /,
- * app/version, its sign-in (with its ban), preferences and categories, answered as
+ * app/version, its sign-in (with its ban), preferences, categories, removed too, and its
+ * torrents by category, answered as
  * qBittorrent 5.2 answers them, and is `apps`' "qbittorrent" also when reached through
@@ -588,2 +592,26 @@ function fakeQbittorrent(request: FakeRequest, state: FakeAppState): FakeReply {
   }
+  const listed = /^\/api\/v2\/torrents\/info\?category=(.*)$/.exec(path);
+  if (listed !== null) {
+    const wanted = decodeURIComponent(listed[1] ?? '');
+    return {
+      status: 200,
+      body: state.torrents
+        .filter((t) => t.category === wanted)
+        .map((t) => ({ hash: t.hash, category: t.category, save_path: t.savePath })),
+    };
+  }
+  // As qBittorrent 5.2 does (probed): 200 whether or not it held them, and each torrent of
+  // one removed loses its category, and goes to the default save path (Automatic Torrent
+  // Management).
+  if (path === '/api/v2/torrents/removeCategories') {
+    const gone = (form.get('categories') ?? '').split('\n');
+    for (const removed of gone) Reflect.deleteProperty(state.categories, removed);
+    for (const torrent of state.torrents) {
+      if (gone.includes(torrent.category)) {
+        torrent.category = '';
+        torrent.savePath = String(state.preferences.save_path);
+      }
+    }
+    return { status: 200 };
+  }
   return { status: 404 };
````

**Change** `packages/engine/src/testing/seerr.ts`:

````diff
diff --git a/packages/engine/src/testing/seerr.ts b/packages/engine/src/testing/seerr.ts
index d14e90f..3e9467a 100644
--- a/packages/engine/src/testing/seerr.ts
+++ b/packages/engine/src/testing/seerr.ts
@@ -756,2 +756,9 @@ function fakeSeerrServers(
   }
+  // A removal answers with the server; one Seerr doesn't hold, 500 (probed on Radarr's).
+  if (method === 'DELETE' && match[2] !== undefined) {
+    const [removed] = index < 0 ? [] : servers.splice(index, 1);
+    return removed === undefined
+      ? { status: 500, body: '<pre>Internal Server Error</pre>' }
+      : { status: 200, body: removed };
+  }
   return undefined;
````

Which resources are removable, and each one's removal.

**Change** `catalog/catalog.test.ts`:

````diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index d77e5ec..ff54cda 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -416,2 +416,38 @@ apps:
 
+  it('removes each resource the stack can stop wanting while its app stays, and only those', () => {
+    // Spec §8.1(3) step 4: when an app leaves, what Mediaplane made for it in the others
+    // goes. Each of these is wanted only while another app, or a setting, is in the stack;
+    // what an app always holds while it runs (its admin, its libraries) is never left.
+    const removable = catalog.flatMap((app) =>
+      (app.integration?.resources ?? [])
+        .filter((resource) => resource.remove !== undefined)
+        .map((resource) => `${app.id}.${resource.name}`),
+    );
+    expect(removable).toEqual([
+      'prowlarr.application_sonarr',
+      'prowlarr.application_radarr',
+      'prowlarr.indexer_proxy',
+      'qbittorrent.category_tv',
+      'qbittorrent.category_movies',
+      'radarr.download_client',
+      'radarr.connection_jellyfin',
+      'radarr.connection_plex',
+      'seerr.server_sonarr',
+      'seerr.server_radarr',
+      'sonarr.download_client',
+      'sonarr.connection_jellyfin',
+      'sonarr.connection_plex',
+    ]);
+    // Seerr's media server is a setting of Seerr's, which can't be taken away: Seerr is set
+    // up again for another media server (spec §10), and drift reports the old one.
+    const seerr = catalog.find((app) => app.id === 'seerr');
+    const servers = (seerr?.integration?.resources ?? []).filter((resource) =>
+      resource.name.startsWith('media_server'),
+    );
+    expect(servers.map((resource) => resource.remove === undefined)).toEqual([
+      true,
+      true,
+    ]);
+  });
+
   it('gives an integration to the apps Mediaplane wires so far', () => {
````

**Change** `catalog/_shared/servarr-connection.test.ts`:

````diff
diff --git a/catalog/_shared/servarr-connection.test.ts b/catalog/_shared/servarr-connection.test.ts
index ad43e9e..eca7fb3 100644
--- a/catalog/_shared/servarr-connection.test.ts
+++ b/catalog/_shared/servarr-connection.test.ts
@@ -197,2 +197,15 @@ describe("an arr's connection to Jellyfin", () => {
 
+  it('is removed by its id once the stack moves to Plex, which wants it no more', async () => {
+    const { api, apis, state } = await sonarr();
+    await connection.create(api, wanted());
+    const observed = await connection.observe(api, undefined);
+    if (observed === undefined) throw new Error('no connection');
+    await connection.remove?.(api, observed);
+    expect(apis.app.requests.at(-1)).toMatchObject({
+      method: 'DELETE',
+      path: '/api/v3/notification/1',
+    });
+    expect(state.connections).toEqual([]);
+  });
+
   it("refuses a trigger the arr's template lacks, saying which, before it sends anything", async () => {
````

**Change** `catalog/_shared/servarr-download.test.ts`:

````diff
diff --git a/catalog/_shared/servarr-download.test.ts b/catalog/_shared/servarr-download.test.ts
index 61f83e3..d3daffc 100644
--- a/catalog/_shared/servarr-download.test.ts
+++ b/catalog/_shared/servarr-download.test.ts
@@ -206,2 +206,16 @@ describe('servarrDownloadClient', () => {
 
+  it('is removed by its id once the stack has no qBittorrent, and a new one never takes that id', async () => {
+    const { api, app, state } = await sonarr();
+    await client.create(api, wanted());
+    const observed = await client.observe(api, undefined);
+    if (observed === undefined) throw new Error('no client');
+    await client.remove?.(api, observed);
+    expect(app.requests.at(-1)).toMatchObject({
+      method: 'DELETE',
+      path: '/api/v3/downloadclient/1',
+    });
+    expect(state.downloadClients).toEqual([]);
+    expect(await client.observe(api, undefined)).toBeUndefined();
+  });
+
   it("checks the key with the app's own test of the client it holds: a refusal means update", async () => {
````

**Change** `catalog/prowlarr/integration.test.ts`:

````diff
diff --git a/catalog/prowlarr/integration.test.ts b/catalog/prowlarr/integration.test.ts
index cd734d6..b3047a3 100644
--- a/catalog/prowlarr/integration.test.ts
+++ b/catalog/prowlarr/integration.test.ts
@@ -196,2 +196,22 @@ apps:
 
+  it('is removed by its id once its arr leaves the stack, and the other link stays', async () => {
+    const { api, app, state, apps } = await prowlarr();
+    const toRadarr = resource('application_radarr');
+    // Prowlarr tests a new link as it saves it: Radarr takes its key too.
+    apps.set('radarr', { ...freshAppState(), key: RADARR_KEY });
+    await toSonarr.create(api, wanted(toSonarr));
+    await toRadarr.create(api, wanted(toRadarr));
+    const observed = await toRadarr.observe(api, undefined);
+    expect(observed?.id).toBe(2);
+    if (observed === undefined) throw new Error('no link to Radarr');
+    await toRadarr.remove?.(api, observed);
+    expect(app.requests.at(-1)).toMatchObject({
+      method: 'DELETE',
+      path: '/api/v1/applications/2',
+    });
+    expect(state.applications.map((a) => a.name)).toEqual(['Sonarr (Mediaplane)']);
+    // Sent again, as after an apply cut short: Prowlarr answers 200 all the same.
+    await toRadarr.remove?.(api, observed);
+  });
+
   it("checks the arr's key with Prowlarr's own test of the link it holds: a refusal means update", async () => {
@@ -462,2 +482,19 @@ describe('the indexer proxy', () => {
 
+  it('is removed once the stack has no Cloudflare solver, leaving the tag, which your indexers carry', async () => {
+    const { api, app, state } = await prowlarr();
+    await proxy.create(api, wanted(proxy));
+    expect(proxy.desired(contextOf(stack('  byparr: { enabled: false }\n')))).toBe(
+      undefined,
+    );
+    const observed = await proxy.observe(api, undefined);
+    if (observed === undefined) throw new Error('no proxy');
+    await proxy.remove?.(api, observed);
+    expect(app.requests.at(-1)).toMatchObject({
+      method: 'DELETE',
+      path: '/api/v1/indexerproxy/1',
+    });
+    expect(state.proxies).toEqual([]);
+    expect(state.tags).toEqual([{ id: 1, label: 'cloudflare' }]);
+  });
+
   it('keeps the tag Prowlarr has, and puts back the tags and settings it manages', async () => {
````

**Change** `catalog/qbittorrent/integration.test.ts`:

````diff
diff --git a/catalog/qbittorrent/integration.test.ts b/catalog/qbittorrent/integration.test.ts
index e9a3842..e9c08d9 100644
--- a/catalog/qbittorrent/integration.test.ts
+++ b/catalog/qbittorrent/integration.test.ts
@@ -371,2 +371,29 @@ apps:
 
+    it('removes a category its arr left, but never one that holds a torrent, which would lose it', async () => {
+      const { api, state } = await qbittorrent({
+        categories: { tv: '/data/torrents/tv', movies: '/data/torrents/movies' },
+        torrents: [
+          { hash: 'a'.repeat(40), category: 'movies', savePath: '/data/torrents/movies' },
+        ],
+      });
+      const observed = { id: 'movies', name: 'movies', fields: {} };
+      expect(await movies.cannotRemove?.(api, observed)).toBe(
+        'it holds a torrent, which removing it would move to /data/torrents: move it to another category first, or keep it',
+      );
+      state.torrents.push({
+        hash: 'b'.repeat(40),
+        category: 'movies',
+        savePath: '/data/torrents/movies',
+      });
+      expect(await movies.cannotRemove?.(api, observed)).toBe(
+        'it holds 2 torrents, which removing it would move to /data/torrents: move them to another category first, or keep it',
+      );
+      // Moved elsewhere, it holds none: it goes, and the category tv stays.
+      for (const torrent of state.torrents) torrent.category = 'tv';
+      expect(await movies.cannotRemove?.(api, observed)).toBeUndefined();
+      await movies.remove?.(api, observed);
+      expect(state.categories).toEqual({ tv: '/data/torrents/tv' });
+      expect(state.torrents.map((t) => t.category)).toEqual(['tv', 'tv']);
+    });
+
     it("says qBittorrent's own words when it refuses", async () => {
````

**Change** `catalog/seerr/integration.test.ts`:

````diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index 90d14b9..3889481 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -637,2 +637,17 @@ describe.each([
 
+  it('is removed by its id once the stack no longer runs the arr, and only as Seerr holds it', async () => {
+    const { api, state, calls } = await seerr();
+    const desired =
+      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
+    await spec.create(api, desired);
+    const observed = await spec.observe(api, undefined, desired);
+    if (observed === undefined) throw new Error('observed');
+    const before = calls().length;
+    await spec.remove?.(api, observed);
+    expect(calls(before)).toEqual([`DELETE /api/v1/settings/${arr}/0`]);
+    expect(state.seerr[arr]).toEqual([]);
+    // Seerr answers 500 for one it doesn't hold, as the real one does: never sent blind.
+    await expect(spec.remove?.(api, observed)).rejects.toThrow(AppApiError);
+  });
+
   it("finds a refused key by testing again with the stack's, sets it with the server sent back whole, and says when Seerr can't reach the arr", async () => {
````

**Change** `packages/cli/src/run.test.ts`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index c35ea98..a215463 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1242,2 +1242,38 @@ describe('mediaplane apply: Prowlarr in the stack', () => {
 
+  it("removes Prowlarr's indexer proxy once the stack drops its Cloudflare solver, then changes nothing", async () => {
+    const home = await makeHome(WITH_PROWLARR);
+    const docker = fakeDocker(home);
+    expect(
+      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
+    ).toBe(0);
+    await writeFile(
+      join(home, 'stack.yaml'),
+      `${WITH_PROWLARR}  byparr: { enabled: false }\n`,
+    );
+    const shown = capture();
+    expect(await run(['plan', '--home', home, '--json'], shown.io, deps(docker))).toBe(2);
+    const planned = JSON.parse(shown.stdout()) as {
+      containers: { service: string; action: string }[];
+      wiring: { resource: string; action: string }[];
+    };
+    expect(planned.wiring.filter((w) => w.action === 'remove')).toEqual([
+      { resource: 'prowlarr.indexer_proxy', action: 'remove' },
+    ]);
+    expect(planned.containers).toContainEqual({ service: 'byparr', action: 'remove' });
+    const applied = capture();
+    expect(await run(['apply', '--home', home, '--yes'], applied.io, deps(docker))).toBe(
+      0,
+    );
+    expect(applied.stdout()).toContain(
+      '  done    wiring prowlarr.indexer_proxy: removed\n',
+    );
+    expect(apis.apps.get('prowlarr')?.proxies).toEqual([]);
+    expect(Object.keys(await readResources(home))).not.toContain(
+      'prowlarr.indexer_proxy',
+    );
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+    expect(again.stdout()).toBe('No changes.\n');
+  });
+
   it("skips Prowlarr's link to Sonarr when Sonarr's admin fails, and still makes the proxy", async () => {
````

The end-to-end test: the CLI as a script runs it, no terminal, only `--json` and exit
codes.

**Create** `test/e2e/remove.e2e.test.ts`:

````ts
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeExec, readSecretStore, type ExecResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  composeDown,
  docker,
  expectWiringRemoved,
  getJson,
  makeHome,
  qbittorrentForm,
  REPO,
  runTeardown,
  stackFor,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-remove`;

const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

/** Where the apps' web UIs are, on 127.0.0.1. */
const PORTS = { prowlarr: 9696, qbittorrent: 8080, seerr: 5055 } as const;

/** A torrent of no real content: a made-up hash, added stopped, never started. */
const TORRENT = '0123456789abcdef0123456789abcdef01234567';

/**
 * `mediaplane <args>` as a script runs it (spec §5.2): from source, without a terminal, so
 * it asks nothing; only its exit code and its --json are read.
 */
async function mediaplane(...args: string[]): Promise<{ code: number; json: unknown }> {
  const result: ExecResult = await nodeExec(
    process.execPath,
    ['--import', 'tsx', MAIN, ...args, '--json'],
    {
      cwd: REPO,
      env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT },
      timeoutMs: 900_000,
    },
  );
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // Its own text is never shown: it could hold what the command printed of an app.
    throw new Error(
      `mediaplane ${args[0] ?? ''} --json printed no JSON (exit ${String(result.code)}, ${String(result.stdout.length)} characters)`,
    );
  }
  return { code: result.code, json };
}

interface Applied {
  schema: string;
  outcome: string;
  changed: boolean;
  actions: { step: string; resource?: string; result: string; detail?: string }[];
}

interface Planned {
  schema: string;
  containers: { service: string; action: string }[];
  wiring: { resource: string; action: string }[];
  drift: { resource: string; kind: string; stays?: string }[];
}

/** What apply removed from the apps, by resource. */
function removed(applied: Applied): string[] {
  return applied.actions
    .filter((a) => a.step === 'wire' && a.detail === 'removed')
    .map((a) => a.resource ?? '');
}

/** What the plan would remove from the apps, by resource. */
function toRemove(planned: Planned): string[] {
  return planned.wiring.filter((w) => w.action === 'remove').map((w) => w.resource);
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

describe('an app removed from the stack, by a script (spec §8.1(3) step 4)', () => {
  it('takes its container and what Mediaplane made for it in the other apps, keeps its appdata and what is yours, and changes nothing after', async () => {
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
      // Deployed, then applied again: nothing to change (spec §2.3, criterion 3).
      const first = await mediaplane('apply', '--home', home, '--yes');
      expect(first.code).toBe(0);
      expect(first.json).toMatchObject({
        schema: 'mediaplane.apply/v1',
        outcome: 'success',
        changed: true,
      });
      const again = await mediaplane('apply', '--home', home, '--yes');
      expect([again.code, again.json]).toMatchObject([0, { changed: false }]);

      const store = await readSecretStore(home);
      const key = (app: string) => store.apps[app]?.apiKey ?? '';
      const secrets = [
        ...Object.values(store.apps).flatMap((s) => Object.values(s)),
        store.shared?.adminPassword ?? '',
      ];
      // A torrent of yours, filed under Radarr's category: it keeps the category.
      await qbittorrentForm(
        PORTS.qbittorrent,
        '/api/v2/torrents/add',
        key('qbittorrent'),
        {
          urls: `magnet:?xt=urn:btih:${TORRENT}&dn=fake`,
          category: 'movies',
          stopped: 'true',
        },
      );

      // Radarr out of the stack, and Prowlarr's Cloudflare solver too.
      const data = join(home, 'data');
      await writeFile(
        join(home, 'stack.yaml'),
        `${stackFor(data).replace('  radarr: {}\n', '')}  byparr: { enabled: false }\n`,
      );
      const shown = await mediaplane('plan', '--home', home);
      expect(shown.code).toBe(2);
      const planned = shown.json as Planned;
      expect(planned.schema).toBe('mediaplane.plan/v1');
      expect(planned.containers.filter((c) => c.action === 'remove')).toEqual([
        { service: 'byparr', action: 'remove' },
        { service: 'radarr', action: 'remove' },
      ]);
      expect(toRemove(planned)).toEqual([
        'prowlarr.application_radarr',
        'prowlarr.indexer_proxy',
        'seerr.server_radarr',
      ]);
      expect(planned.drift).toContainEqual({
        resource: 'qbittorrent.category_movies',
        kind: 'left',
        stays:
          'it holds a torrent, which removing it would move to /data/torrents: move it to another category first, or keep it',
      });

      const applied = await mediaplane('apply', '--home', home, '--yes');
      expect(applied.code).toBe(0);
      const result = applied.json as Applied;
      expect(result.outcome).toBe('success');
      expect(removed(result)).toEqual(toRemove(planned));
      expectNoSecret("apply's JSON", JSON.stringify(applied.json), secrets);

      // Gone from the apps, as each app's own API says; the rest stays.
      const keyed = (app: keyof typeof PORTS) => ({ 'X-Api-Key': key(app) });
      const links = await getJson<{ name: string }[]>(
        PORTS.prowlarr,
        '/api/v1/applications',
        keyed('prowlarr'),
      );
      expect(links.map((l) => l.name)).toEqual(['Sonarr (Mediaplane)']);
      expect(
        await getJson<unknown[]>(
          PORTS.prowlarr,
          '/api/v1/indexerproxy',
          keyed('prowlarr'),
        ),
      ).toEqual([]);
      expect(
        await getJson<unknown[]>(PORTS.seerr, '/api/v1/settings/radarr', keyed('seerr')),
      ).toEqual([]);
      const categories = () =>
        getJson<Record<string, unknown>>(
          PORTS.qbittorrent,
          '/api/v2/torrents/categories',
          { Authorization: `Bearer ${key('qbittorrent')}` },
        );
      expect(Object.keys(await categories()).sort()).toEqual(['movies', 'tv']);
      // Radarr's container is gone; its appdata stays, a manual step to delete (§4.2).
      const services = await docker(
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${PROJECT}`,
        '--format',
        '{{.Label "com.docker.compose.service"}}',
      );
      expect(services.split('\n').sort()).not.toContain('radarr');
      expect(services.split('\n')).not.toContain('byparr');
      expect((await stat(join(home, 'appdata', 'radarr', 'config.xml'))).isFile()).toBe(
        true,
      );
      // What it removed is forgotten; what it left is still recorded.
      const known = JSON.parse(
        await readFile(join(home, 'state', 'resources.json'), 'utf8'),
      ) as { resources: Record<string, unknown> };
      expect(Object.keys(known.resources)).toContain('qbittorrent.category_movies');
      for (const resource of toRemove(planned)) {
        expect(Object.keys(known.resources)).not.toContain(resource);
      }

      // The torrent moved to another category: Radarr's category goes too.
      await qbittorrentForm(
        PORTS.qbittorrent,
        '/api/v2/torrents/setCategory',
        key('qbittorrent'),
        { hashes: TORRENT, category: 'tv' },
      );
      const later = await mediaplane('plan', '--home', home);
      expect([later.code, toRemove(later.json as Planned)]).toEqual([
        2,
        ['qbittorrent.category_movies'],
      ]);
      const last = await mediaplane('apply', '--home', home, '--yes');
      expect([last.code, removed(last.json as Applied)]).toEqual([
        0,
        ['qbittorrent.category_movies'],
      ]);
      expect(Object.keys(await categories())).toEqual(['tv']);

      // Nothing left to change, and nothing drifted.
      const settled = await mediaplane('apply', '--home', home, '--yes');
      expect([settled.code, settled.json]).toMatchObject([0, { changed: false }]);
      const drift = await mediaplane('drift', '--home', home);
      expect([drift.code, drift.json]).toMatchObject([
        0,
        { schema: 'mediaplane.drift/v1', clear: true, drift: [] },
      ]);
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 1_800_000);
});
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run catalog/catalog.test.ts catalog/_shared/servarr-connection.test.ts catalog/_shared/servarr-download.test.ts catalog/prowlarr/integration.test.ts catalog/qbittorrent/integration.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts`

Expected: FAIL: 9 tests in 7 files (369 run). `catalog.test.ts` finds no removable resource (`expected [] to deeply equal [ Array(13) ]`); each resource's own test sees no `DELETE` (`expected { method: 'GET', … } to match object { method: 'DELETE', … }`), qBittorrent's no reason a category with a torrent stays; `run.test.ts` sees Prowlarr's indexer proxy left after the solver goes.

- [ ] **Step 3: Implement**

**Change** `catalog/_shared/servarr-provider.ts`:

````diff
diff --git a/catalog/_shared/servarr-provider.ts b/catalog/_shared/servarr-provider.ts
index 2862be0..6b5571b 100644
--- a/catalog/_shared/servarr-provider.ts
+++ b/catalog/_shared/servarr-provider.ts
@@ -184,2 +184,14 @@ export async function updateProvider(
 
+/**
+ * Remove the provider with the app's id `id` (spec §8.1(3) step 4): Sonarr, Radarr and
+ * Prowlarr answer 200 whether or not they held it (probed), so it is safe to send again.
+ */
+export async function removeProvider(
+  api: AppApi,
+  kind: ProviderKind,
+  id: ObservedResource['id'],
+): Promise<void> {
+  await api.submit('DELETE', `${kind.path}/${String(id)}`);
+}
+
 /**
@@ -259,5 +271,5 @@ export interface ProviderOptions {
 /**
- * The parts of a resource spec that a Servarr provider has in common, found, tested, made
- * and updated through the functions above: the spec adds its name, fields, secrets,
- * requirements and what it wants.
+ * The parts of a resource spec that a Servarr provider has in common, found, tested, made,
+ * updated and removed through the functions above: the spec adds its name, fields,
+ * secrets, requirements and what it wants.
  */
@@ -266,3 +278,3 @@ export function servarrProvider(
 ): Pick<ResourceSpec, 'observe' | 'create' | 'update'> &
-  Required<Pick<ResourceSpec, 'verify'>> {
+  Required<Pick<ResourceSpec, 'verify' | 'remove'>> {
   const { kind, name, credentials, fieldsOf, settingsOf, topOf } = options;
@@ -288,2 +300,3 @@ export function servarrProvider(
       updateProvider(api, kind, observed.id, settingsOf(desired), topOf(desired)),
+    remove: (api, observed) => removeProvider(api, kind, observed.id),
   };
````

**Change** `catalog/prowlarr/integration.ts`:

````diff
diff --git a/catalog/prowlarr/integration.ts b/catalog/prowlarr/integration.ts
index ad8c4e8..b6aaa87 100644
--- a/catalog/prowlarr/integration.ts
+++ b/catalog/prowlarr/integration.ts
@@ -15,2 +15,3 @@ import {
   findProvider,
+  removeProvider,
   secretOf,
@@ -248,2 +249,4 @@ const indexerProxy: ResourceSpec = {
   },
+  // Once the stack has no solver: the `cloudflare` tag stays, on your indexers too.
+  remove: (api, observed) => removeProvider(api, PROXIES, observed.id),
 };
````

**Change** `catalog/qbittorrent/integration.ts`:

````diff
diff --git a/catalog/qbittorrent/integration.ts b/catalog/qbittorrent/integration.ts
index b0bd411..683b114 100644
--- a/catalog/qbittorrent/integration.ts
+++ b/catalog/qbittorrent/integration.ts
@@ -30,2 +30,3 @@ const SET_PREFERENCES = '/api/v2/app/setPreferences';
 const CATEGORIES_PATH = '/api/v2/torrents/categories';
+const TORRENTS_PATH = '/api/v2/torrents/info';
 
@@ -215,3 +216,4 @@ function categoryOf(stack: ResolvedStack, arr: string, name: string): string {
  * qBittorrent knows a category by its name: it gives it no id. One Mediaplane made before
- * under another name stays as it is, yours.
+ * under another name stays as it is, yours. Once `arr` leaves the stack, apply removes it,
+ * unless it holds a torrent.
  */
@@ -254,2 +256,17 @@ function category(arr: string, name: string): ResourceSpec {
     },
+    // Removing a category takes it from its torrents, and Automatic Torrent Management
+    // then moves their files to the default save path (probed): they are yours, so a
+    // category that holds any stays.
+    async cannotRemove(api, observed) {
+      const held = await api.get(
+        `${TORRENTS_PATH}?category=${encodeURIComponent(observed.name)}`,
+        z.array(z.unknown()),
+      );
+      if (held.length === 0) return undefined;
+      const many = held.length === 1 ? 'a torrent' : `${String(held.length)} torrents`;
+      return `it holds ${many}, which removing it would move to ${DEFAULT_SAVE_PATH}: move ${held.length === 1 ? 'it' : 'them'} to another category first, or keep it`;
+    },
+    async remove(api, observed) {
+      await api.form('/api/v2/torrents/removeCategories', { categories: observed.name });
+    },
   };
````

**Change** `catalog/seerr/integration.ts`:

````diff
diff --git a/catalog/seerr/integration.ts b/catalog/seerr/integration.ts
index 0b40693..c20e81e 100644
--- a/catalog/seerr/integration.ts
+++ b/catalog/seerr/integration.ts
@@ -463,2 +463,3 @@ const offered = z.looseObject({
  * - It requires the arr's root folder, which it names, and Seerr comes after the arr.
+ * - Once the stack no longer runs the arr, apply removes it (spec §8.1(3) step 4).
  */
@@ -650,2 +651,5 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
     },
+    // Once the stack no longer runs the arr. Seerr answers 500 for a server it doesn't
+    // hold (probed), so it is removed only as observed, just before.
+    remove: (api, observed) => api.submit('DELETE', `${path}/${String(observed.id)}`),
   };
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run catalog/catalog.test.ts catalog/_shared/servarr-connection.test.ts catalog/_shared/servarr-download.test.ts catalog/prowlarr/integration.test.ts catalog/qbittorrent/integration.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts`
Expected: PASS. Then, alone on the machine, with nothing else running in Docker:
`pnpm vitest run --config vitest.e2e.config.ts test/e2e/remove.e2e.test.ts` passes in
about a minute and a half, warm.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS. Nothing generated changes: no catalog fact changed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(catalog): remove each link, proxy, category and server an app leaving the stack had" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Keep mine when automation owns stack.yaml

Decision 6. With `managed_by: external`, `keep` writes no `stack.yaml` and succeeds,
giving the line to add (`line`, `written: false`) with a warning; a write it refuses
gives the line too. For `unmanaged`, it forgets the resource's record at once, so that
no `apply` removes it (Task 1) before `stack.yaml` holds the line.

**Files:**
- Modify: `packages/engine/src/keep.ts`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`, `docs/reference/cli.md` (generated)
- Test: `packages/engine/src/keep.test.ts`, `packages/cli/src/output.test.ts`

**Interfaces:**
- **Consumes:** `keep`, `KeepResult`, `printKeep`, `writeResources` (unchanged); `leftOf` (Task 1), through `plan`.
- **Produces:**
  - `KeepResult.line?: string` (the line under `overrides:`, as keep writes it) and `KeepResult.written?: boolean` (false when keep didn't write it), within `mediaplane.keep/v1`.
  - The warning `keep.external`; `keep`'s exit code 0 with the line to add (`EXIT_CODES`).

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/keep.test.ts`:

````diff
diff --git a/packages/engine/src/keep.test.ts b/packages/engine/src/keep.test.ts
index dccccd0..3232b72 100644
--- a/packages/engine/src/keep.test.ts
+++ b/packages/engine/src/keep.test.ts
@@ -104,2 +104,4 @@ describe('keep', () => {
       value: 'someone',
+      line: 'sonarr.login.user: someone',
+      written: true,
       diagnostics: [],
@@ -299,9 +301,2 @@ describe('keep', () => {
     const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
-    // Owned by automation.
-    const external = await home(`${STACK}managed_by: external\n`);
-    const result = await keep(options(external, sonarr, 'sonarr.login.user'));
-    expect(result.diagnostics[0]).toMatchObject({
-      code: 'keep.external',
-      hint: `${line}, where it is kept, such as your playbook`,
-    });
     // A link to the file, which a rewrite would replace.
@@ -310,5 +305,4 @@ describe('keep', () => {
     await symlink(join(linked, 'real.yaml'), join(linked, 'stack.yaml'));
-    expect(
-      (await keep(options(linked, sonarr, 'sonarr.login.user'))).diagnostics[0],
-    ).toMatchObject({
+    const refused = await keep(options(linked, sonarr, 'sonarr.login.user'));
+    expect(refused.diagnostics[0]).toMatchObject({
       code: 'keep.stack-file',
@@ -319,2 +313,8 @@ describe('keep', () => {
     });
+    // The line is a field of its own too, for a script.
+    expect(refused).toMatchObject({
+      ok: false,
+      line: 'sonarr.login.user: someone',
+      written: false,
+    });
     // A file it can't add the line to without changing more of it.
@@ -333,2 +333,73 @@ describe('keep', () => {
 
+  it('gives the line to add, writing no stack.yaml, when automation owns it: a field stays unrecorded until stack.yaml holds it', async () => {
+    const external = `${STACK}managed_by: external\n`;
+    const dir = await home(external);
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    const kept = await keep(options(dir, sonarr, 'sonarr.login.user'));
+    expect(kept).toEqual({
+      ok: true,
+      key: 'sonarr.login.user',
+      value: 'someone',
+      line: 'sonarr.login.user: someone',
+      written: false,
+      diagnostics: [
+        expect.objectContaining({
+          severity: 'warning',
+          code: 'keep.external',
+          hint: 'add this line under overrides: in stack.yaml where it is kept, such as your playbook: sonarr.login.user: someone',
+        }),
+      ],
+    });
+    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(external);
+    // Not recorded: until stack.yaml holds the line, apply puts back what it applied.
+    expect((await readResources(dir))['sonarr.login']).toEqual(RECORD);
+    // The playbook adds the line: apply then only adopts what the app holds.
+    await writeFile(
+      join(dir, 'stack.yaml'),
+      `${external}overrides:\n  ${kept.line ?? ''}\n`,
+    );
+    const after = await plan({ ...options(dir, sonarr, ''), drift: { now: () => AT } });
+    expect(after.wiring).toEqual([{ resource: 'sonarr.login', action: 'adopt' }]);
+    expect(after.drift).toEqual([]);
+  });
+
+  it('forgets a resource left in the app when automation owns stack.yaml, so apply never removes it', async () => {
+    const gone: ResourceSpec = {
+      ...FAKE_LOGIN,
+      name: 'gone',
+      desired: () => undefined,
+      remove: () => Promise.reject(new Error('never removed')),
+    };
+    const catalog = WIRED_CATALOG.map((def) =>
+      def.id === 'sonarr'
+        ? { ...def, integration: { after: [], resources: [FAKE_LOGIN, gone] } }
+        : def,
+    );
+    const external = `${STACK}managed_by: external\n`;
+    const dir = await home(external);
+    await writeResources(dir, {
+      'sonarr.login': RECORD,
+      'sonarr.gone': { ...RECORD, name: 'gone' },
+    });
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const kept = await keep(options(dir, sonarr, 'sonarr.gone', { catalog }));
+    expect(kept).toMatchObject({
+      ok: true,
+      value: 'unmanaged',
+      line: 'sonarr.gone: unmanaged',
+      written: false,
+    });
+    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(external);
+    expect(Object.keys(await readResources(dir))).toEqual(['sonarr.login']);
+    // Nothing left for apply to remove, nor for drift to report, before the line lands.
+    const after = await plan({
+      ...options(dir, sonarr, '', { catalog }),
+      drift: { now: () => AT },
+    });
+    expect([after.wiring, after.drift]).toEqual([
+      [{ resource: 'sonarr.login', action: 'unchanged' }],
+      [],
+    ]);
+  });
+
   it('gives the line to add when stack.yaml has other names, or the write itself fails', async () => {
````

**Change** `packages/cli/src/output.test.ts`:

````diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index f479121..2ee958f 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -630,2 +630,35 @@ describe('printKeep', () => {
   });
+
+  it('gives the line to add, on standard output and in JSON, when stack.yaml is managed outside Mediaplane', () => {
+    const kept = {
+      ok: true,
+      key: 'sonarr.download_client.category',
+      value: 'television',
+      line: 'sonarr.download_client.category: television',
+      written: false,
+      diagnostics: [],
+    };
+    const term = capture();
+    printKeep(kept, { json: false }, term.io);
+    expect(term.stdout()).toBe(
+      'Add this line under overrides: in stack.yaml, where it is kept:\n  sonarr.download_client.category: television\nUntil stack.yaml holds it, apply puts back what it applied, and drift reports it.\n',
+    );
+    const left = capture();
+    printKeep(
+      {
+        ...kept,
+        key: 'prowlarr.application_radarr',
+        value: 'unmanaged',
+        line: 'prowlarr.application_radarr: unmanaged',
+      },
+      { json: false },
+      left.io,
+    );
+    expect(left.stdout()).toBe(
+      'Add this line under overrides: in stack.yaml, where it is kept:\n  prowlarr.application_radarr: unmanaged\nMediaplane has forgotten that it made it, so apply never removes it. Until stack.yaml holds the line, apply makes it again if the stack still wants it.\n',
+    );
+    const json = capture();
+    printKeep(kept, { json: true }, json.io);
+    expect(JSON.parse(json.stdout())).toEqual({ schema: 'mediaplane.keep/v1', ...kept });
+  });
 });
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/keep.test.ts packages/cli/src/output.test.ts`

Expected: FAIL: 5 tests in 2 files (68 run). `keep.test.ts` gets `ok: false` with `managed_by: external` where it expects `ok: true` and the line, and no `line` or `written` after a write; `output.test.ts` prints `Wrote …` where it expects `Add this line under overrides: in stack.yaml, …`.

- [ ] **Step 3: Implement**

**Change** `packages/engine/src/keep.ts`:

````diff
diff --git a/packages/engine/src/keep.ts b/packages/engine/src/keep.ts
index 6b53033..8e67ef9 100644
--- a/packages/engine/src/keep.ts
+++ b/packages/engine/src/keep.ts
@@ -69,2 +69,15 @@ export interface KeepResult {
   holders?: string[];
+  /**
+   * The line under `overrides:` in stack.yaml that keeps it, as keep writes it
+   * (`sonarr.download_client.category: television`): written, or for you to add. Given
+   * whenever keep got as far as the line, so also when it couldn't write it. Added in
+   * Slice 10b.
+   */
+  line?: string;
+  /**
+   * Whether keep wrote `line` into stack.yaml: false when stack.yaml is managed outside
+   * Mediaplane (managed_by: external), where you add it, or when it couldn't. Added in
+   * Slice 10b.
+   */
+  written?: boolean;
   diagnostics: Diagnostic[];
@@ -101,4 +114,5 @@ function keyTarget(catalog: PlanOptions['catalog'], path: string): KeyTarget | u
  * and its group (not an ACL), and never a secret, and then records the value as applied
- * in state/resources.json, so that drift is clear and apply has nothing to do for it. It
- * runs under apply's lock.
+ * in state/resources.json, so that drift is clear and apply has nothing to do for it.
+ * With managed_by: external it writes no stack.yaml, and gives the line to add
+ * (keptOutside). It runs under apply's lock.
  */
@@ -227,14 +241,13 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
     // Quoted where `overrides: { … }` would need it, and right under a block one too.
-    const byHand = `add this line under overrides: in stack.yaml yourself: ${overrideLine(key, value, true)}`;
+    const line = overrideLine(key, value, true);
+    const byHand = `add this line under overrides: in stack.yaml yourself: ${line}`;
     const external = () =>
-      refused([
-        error(
-          'keep.external',
-          `stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane doesn't write it`,
-          { hint: `${byHand}, where it is kept, such as your playbook` },
-        ),
-      ]);
-    if (context.stack.config.managed_by === 'external') return external();
-    const cannot = (why: string) =>
-      refused([error('keep.stack-file', why, { hint: byHand })]);
+      keptOutside(home, address, { key, value, line, field }, result.diagnostics);
+    // Awaited here: the lock is released only once it is done.
+    if (context.stack.config.managed_by === 'external') return await external();
+    const cannot = (why: string): KeepResult => ({
+      ...refused([error('keep.stack-file', why, { hint: byHand })]),
+      line,
+      written: false,
+    });
     // Read once, through one handle, as it is checked: the file written is the one read.
@@ -245,3 +258,3 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
     const current = parseConfig(file.text);
-    if (current.ok && current.config.managed_by === 'external') return external();
+    if (current.ok && current.config.managed_by === 'external') return await external();
     if (current.ok && current.config.overrides[address] === UNMANAGED) {
@@ -289,3 +302,3 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
     }
-    return { ok: true, key, value, diagnostics };
+    return { ok: true, key, value, line, written: true, diagnostics };
   } finally {
@@ -295,2 +308,49 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
 
+/**
+ * Keep mine where stack.yaml is managed outside Mediaplane (spec §4.2, managed_by:
+ * external): it writes no stack.yaml, and gives the line to add (`line`, `written:
+ * false`), with a warning that says so; you add it where the file is kept, such as your
+ * playbook. It records nothing as applied, as stack.yaml doesn't hold it yet: apply puts
+ * back what the app holds until it does. A resource kept as `unmanaged` is forgotten
+ * though (its record in state/resources.json), so that apply never removes it, nor drift
+ * reports it, while the line is on its way: Mediaplane only removes what its record says
+ * it made.
+ */
+async function keptOutside(
+  home: string,
+  address: string,
+  kept: { key: string; value: Scalar; line: string; field: string | undefined },
+  planned: readonly Diagnostic[],
+): Promise<KeepResult> {
+  const { key, value, line, field } = kept;
+  const diagnostics = [
+    ...planned,
+    warning(
+      'keep.external',
+      `stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane didn't write it`,
+      {
+        hint: `add this line under overrides: in stack.yaml where it is kept, such as your playbook: ${line}`,
+      },
+    ),
+  ];
+  if (field === undefined) {
+    try {
+      const known = await readResources(home);
+      if (Object.hasOwn(known, address)) {
+        Reflect.deleteProperty(known, address);
+        await writeResources(home, known);
+      }
+    } catch (cause) {
+      diagnostics.push(
+        warning(
+          'keep.record',
+          `state/resources.json could not be updated to forget ${address}: ${cause instanceof Error ? cause.message : String(cause)}`,
+          { hint: 'add the line, then run apply: Mediaplane then stops managing it' },
+        ),
+      );
+    }
+  }
+  return { ok: true, key, value, line, written: false, diagnostics };
+}
+
 /**
````

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 23e9ba0..c582b5c 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -335,4 +335,16 @@ export function printKeep(result: KeepResult, options: { json: boolean }, io: Io
   }
+  const resource = result.value === 'unmanaged' && result.key.split('.').length === 2;
+  if (result.written === false) {
+    // managed_by: external: the line is yours to add, where stack.yaml is kept.
+    io.stdout(
+      `Add this line under overrides: in stack.yaml, where it is kept:\n  ${result.line ?? overrideLine(result.key, result.value, true)}\n${
+        resource
+          ? 'Mediaplane has forgotten that it made it, so apply never removes it. Until stack.yaml holds the line, apply makes it again if the stack still wants it.\n'
+          : 'Until stack.yaml holds it, apply puts back what it applied, and drift reports it.\n'
+      }`,
+    );
+    return;
+  }
   io.stdout(
-    result.value === 'unmanaged' && result.key.split('.').length === 2
+    resource
       ? `Wrote ${result.key}: unmanaged under overrides: in stack.yaml. Mediaplane no longer manages it, and apply doesn't make it again.\n`
````

**Change** `packages/cli/src/run.ts`:

````diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 504fe4f..83cce18 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -119,2 +119,3 @@ export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
     '0: stack.yaml keeps what the app holds, or stops managing what was deleted',
+    '0: or, with managed_by: external, the line to add to stack.yaml is given',
     "0: or state/secrets.json keeps an app's own key, which the app takes",
````

- [ ] **Step 4: Regenerate the CLI reference**

Run: `pnpm docs:generate`
Expected: it rewrites `docs/reference/cli.md`, whose exit codes for `keep` now say that,
with `managed_by: external`, the line to add is given.

- [ ] **Step 5: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/keep.test.ts packages/cli/src/output.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine,cli): keep gives the line to add when automation owns stack.yaml" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Jellyfin's database read in a process of its own, with a deadline

Decision 7. The read moves out of Mediaplane's own process, into Node itself started with
a fixed program, so that a named pipe a compromised Jellyfin puts at its database can't
hang `plan` (probe 7): it is killed after 10 seconds. Its request goes on its standard
input, its answer, the key, comes on its standard output; its environment is empty; the
database is handed to it open, as fd 3. Recovery's checks that the path is still the file
read run after it answers. The unit tests run the real child, on real SQLite files.

**Files:**
- Create: `packages/engine/src/secrets/database.ts`
- Modify: `packages/engine/src/secrets/recover.ts`
- Test: `packages/engine/src/secrets/recover.test.ts`, `test/e2e/deploy.e2e.test.ts`

**Interfaces:**
- **Consumes:** `readKeyFile`, `KeyFile`'s `sqlite: { query; column }` (S10a).
- **Produces:**
  - `queryDatabase(fd: number, url: URL, sqlite: { query: string; column: string }, seams?: DatabaseSeams): Promise<DatabaseAnswer>`, never throwing, with `type DatabaseAnswer = { found: 'row'; value: unknown } | { found: 'none' } | { found: 'failed'; why: string }`.
  - `DATABASE_DEADLINE_MS` (10 000), `DATABASE_PROGRAM`, and `interface DatabaseSeams { deadlineMs?; program?; started?; answered? }`, for tests.
  - `readKeyFile(home, app, file, seams?: DatabaseSeams)`: the new last parameter.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/secrets/recover.test.ts`:

````diff
diff --git a/packages/engine/src/secrets/recover.test.ts b/packages/engine/src/secrets/recover.test.ts
index 3fe20f2..879f77f 100644
--- a/packages/engine/src/secrets/recover.test.ts
+++ b/packages/engine/src/secrets/recover.test.ts
@@ -13,5 +13,4 @@ import {
 import { join } from 'node:path';
-import type * as Sqlite from 'node:sqlite';
 import { DatabaseSync } from 'node:sqlite';
-import { afterEach, describe, expect, it, vi } from 'vitest';
+import { describe, expect, it, vi } from 'vitest';
 import type { Catalog, KeyFile } from '../catalog/types';
@@ -24,28 +23,2 @@ import { emptySecretStore, type SecretStore } from './store';
 
-/**
- * What runs as SQLite opens a database, once: `before`, between Mediaplane's own open and
- * SQLite's, as another process swapping the file would; `after`, once SQLite has it.
- */
-const sqliteOpen: { before?: () => void; after?: () => void } = vi.hoisted(() => ({}));
-
-vi.mock('node:sqlite', async (importOriginal) => {
-  const actual = await importOriginal<typeof Sqlite>();
-  class Hooked extends actual.DatabaseSync {
-    constructor(...args: ConstructorParameters<typeof actual.DatabaseSync>) {
-      const { before, after } = sqliteOpen;
-      delete sqliteOpen.before;
-      before?.();
-      super(...args);
-      delete sqliteOpen.after;
-      after?.();
-    }
-  }
-  return { ...actual, DatabaseSync: Hooked };
-});
-
-afterEach(() => {
-  delete sqliteOpen.before;
-  delete sqliteOpen.after;
-});
-
 const KEY = 'a'.repeat(32);
@@ -320,4 +293,5 @@ describe('readKeyFile', () => {
     const db = join(home, 'appdata', 'jellyfin', 'data', 'app.db');
-    // A pipe in its place would hang SQLite's open, which doesn't wait without a writer.
-    sqliteOpen.before = () => {
+    // As its reading process starts, after Mediaplane's own open: a pipe in its place
+    // would hang SQLite's open, which doesn't wait without a writer.
+    const started = () => {
       renameSync(db, `${db}.aside`);
@@ -325,3 +299,3 @@ describe('readKeyFile', () => {
     };
-    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
+    expect(await readKeyFile(home, 'jellyfin', DATABASE, { started })).toEqual({
       found: 'unreadable',
@@ -331,2 +305,81 @@ describe('readKeyFile', () => {
 
+  it('takes nothing from a read of a pipe put in place of the log once checked: SQLite refuses it', async () => {
+    const home = await homeWithDatabase([]);
+    const folder = join(home, 'appdata', 'jellyfin', 'data');
+    const app = new DatabaseSync(join(folder, 'app.db'));
+    try {
+      // In use, with its log and index beside it, as Jellyfin keeps it.
+      app.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
+      app
+        .prepare('INSERT INTO ApiKeys (DateCreated, Name, AccessToken) VALUES (?, ?, ?)')
+        .run('2026-10-26 06:09:30.4', 'Mediaplane', KEY);
+      const wal = join(folder, 'app.db-wal');
+      // After Mediaplane looked at the log, before SQLite opens it (threat model, T4).
+      const started = () => {
+        renameSync(wal, `${wal}.aside`);
+        execFileSync('mkfifo', [wal]);
+      };
+      expect(await readKeyFile(home, 'jellyfin', DATABASE, { started })).toEqual({
+        found: 'unreadable',
+        why: 'it could not be read as a database (disk I/O error)',
+      });
+    } finally {
+      app.close();
+    }
+  });
+
+  it('stops a read that never answers, as one hung on a pipe would, and takes nothing from it', async () => {
+    const home = await homeWithDatabase([
+      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
+    ]);
+    const before = Date.now();
+    expect(
+      await readKeyFile(home, 'jellyfin', DATABASE, {
+        program: 'setInterval(() => {}, 1000)',
+        deadlineMs: 1_000,
+      }),
+    ).toEqual({
+      found: 'unreadable',
+      why: 'it was not read within 1 seconds, so its read was stopped',
+    });
+    expect(Date.now() - before).toBeLessThan(5_000);
+  });
+
+  it('takes nothing from a read that gives no answer it understands, or too long a one', async () => {
+    const home = await homeWithDatabase([
+      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
+    ]);
+    const read = (program: string) =>
+      readKeyFile(home, 'jellyfin', DATABASE, { program, deadlineMs: 5_000 });
+    expect(await read('process.stdout.write("not JSON")')).toEqual({
+      found: 'unreadable',
+      why: 'its read gave no answer Mediaplane understands',
+    });
+    expect(await read('process.exit(3)')).toEqual({
+      found: 'unreadable',
+      why: 'its read gave no answer Mediaplane understands',
+    });
+    expect(
+      await read(`process.stdout.write(JSON.stringify({ ok: true, more: 1 }))`),
+    ).toEqual({
+      found: 'unreadable',
+      why: 'its read gave no answer Mediaplane understands',
+    });
+    expect(await read(`process.stdout.write('x'.repeat(70000))`)).toEqual({
+      found: 'unreadable',
+      why: 'its read gave more than one row would',
+    });
+  });
+
+  it('reads in a process with no environment of its own, and the key goes nowhere but its answer', async () => {
+    const home = await homeWithDatabase([
+      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
+    ]);
+    // A program that answers with what its environment holds, as a key.
+    const program = `process.stdout.write(JSON.stringify({ ok: true, row: { value: Object.keys(process.env).join(',') || 'none' } }))`;
+    expect(
+      await readKeyFile(home, 'jellyfin', DATABASE, { program, deadlineMs: 5_000 }),
+    ).toEqual({ found: 'key', value: 'none' });
+  });
+
   it('says a database that went, or left the folder, once open is unreadable, with no path', async () => {
@@ -336,6 +389,6 @@ describe('readKeyFile', () => {
     const db = join(home, 'appdata', 'jellyfin', 'data', 'app.db');
-    sqliteOpen.after = () => {
+    const answered = () => {
       unlinkSync(db);
     };
-    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
+    expect(await readKeyFile(home, 'jellyfin', DATABASE, { answered })).toEqual({
       found: 'unreadable',
@@ -348,3 +401,3 @@ describe('readKeyFile', () => {
     const at = join(moved, 'appdata', 'jellyfin', 'data', 'app.db');
-    sqliteOpen.after = () => {
+    const away = () => {
       renameSync(at, join(moved, 'outside.db'));
@@ -352,3 +405,3 @@ describe('readKeyFile', () => {
     };
-    expect(await readKeyFile(moved, 'jellyfin', DATABASE)).toEqual({
+    expect(await readKeyFile(moved, 'jellyfin', DATABASE, { answered: away })).toEqual({
       found: 'unreadable',
````

The deploy test's note on the read in the image.

**Change** `test/e2e/deploy.e2e.test.ts`:

````diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index 6c9c8cb..235fe18 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -366,3 +366,4 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     // qBittorrent.conf, Seerr's settings.json, which uid 1000 owns, and Jellyfin's
-    // database, read through node:sqlite in the image's bundle. So it lists no setup:
+    // database, read through node:sqlite by a Node process of its own, which the image's
+    // CLI starts with a deadline (Slice 10b). So it lists no setup:
     // Jellyfin's key is found, and its system.xml says its wizard is done; Seerr's
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/secrets/recover.test.ts`

Expected: FAIL: 6 tests in 1 file (30 run). The read still runs in Mediaplane's own process, which never calls the tests' seams, so each takes the key where it expects none (`expected { found: 'key', … } to deeply equal { found: 'unreadable', … }`): a program that hangs, one that answers nonsense or too much, one that prints its environment, a database replaced or removed once opened, and a pipe at the `-wal`.

- [ ] **Step 3: Implement**

**Create** `packages/engine/src/secrets/database.ts`:

````ts
import { spawn } from 'node:child_process';
import { z } from 'zod';

/** How long the database read may take, in ms, before its process is killed. */
export const DATABASE_DEADLINE_MS = 10_000;

/** The most the database read may print: one row of one column, as JSON. */
const ANSWER_LIMIT = 64 * 1024;

/**
 * What the child process runs: it opens the database at the URL its standard input
 * gives, read-only, through the file descriptor it was handed as its fd 3, runs the one
 * query, and prints what came back as one line of JSON: the column's value of the first
 * row, none, or the error's code and SQLite's own message. Nothing else: no file of its
 * own, no network, and an empty environment.
 */
export const DATABASE_PROGRAM = `import { DatabaseSync } from 'node:sqlite';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { url, query, column } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const say = (answer) => process.stdout.write(JSON.stringify(answer) + '\\n');
try {
  const db = new DatabaseSync(new URL(url), { readOnly: true });
  try {
    const row = db.prepare(query).get();
    say(row === undefined ? { ok: true } : { ok: true, row: { value: row[column] ?? null } });
  } finally {
    db.close();
  }
} catch (cause) {
  say({ ok: false, code: cause?.code ?? null, message: cause?.code === 'ERR_SQLITE_ERROR' ? String(cause.message) : null });
}
`;

const answer = z.union([
  z.strictObject({
    ok: z.literal(true),
    row: z.strictObject({ value: z.unknown() }).optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().nullable(),
    message: z.string().nullable(),
  }),
]);

/** What the read found: the first row's value, none, or why it couldn't read. */
export type DatabaseAnswer =
  { found: 'row'; value: unknown } | { found: 'none' } | { found: 'failed'; why: string };

/** For tests: how the read runs. */
export interface DatabaseSeams {
  deadlineMs?: number;
  /** The program the child process runs, DATABASE_PROGRAM by default. */
  program?: string;
  /** Called as the child process is started, and once it has answered. */
  started?: () => void;
  answered?: () => void;
}

/** Why a read failed, from its error's code, as a key file's read says it. */
function failure(code: string | null, message: string | null): string {
  if (code === 'ERR_SQLITE_ERROR' && message !== null) {
    return `it could not be read as a database (${message})`;
  }
  return code === null ? 'it could not be read' : `it could not be read (${code})`;
}

/**
 * Run `sqlite.query` on the database Mediaplane holds open as `fd`, opened by SQLite at
 * `url` (`/proc/self/fd/3`, the same open file, as the child process sees it), in a
 * process of its own: a database whose file, or whose write-ahead log, is swapped for a
 * pipe just as SQLite opens it would hang SQLite's open (threat model T4); a process can
 * be stopped, where a call in this one can't. The child is Node itself
 * (`process.execPath`), with no shell, an empty environment and no flag but its program;
 * its request comes on its standard input, and its answer, which holds the key, on its
 * standard output, never on a command line. One that doesn't answer within the deadline
 * (DATABASE_DEADLINE_MS) is killed, and the read failed; so did one that exits without an
 * answer Mediaplane understands, or prints more than one row would. Never throws.
 */
export function queryDatabase(
  fd: number,
  url: URL,
  sqlite: { query: string; column: string },
  seams: DatabaseSeams = {},
): Promise<DatabaseAnswer> {
  const deadlineMs = seams.deadlineMs ?? DATABASE_DEADLINE_MS;
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (result: DatabaseAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolvePromise(result);
    };
    seams.started?.();
    const child = spawn(
      process.execPath,
      [
        '--no-warnings',
        '--input-type=module',
        '--eval',
        seams.program ?? DATABASE_PROGRAM,
      ],
      { stdio: ['pipe', 'pipe', 'ignore', fd], env: {} },
    );
    const timer = setTimeout(() => {
      settle({
        found: 'failed',
        why: `it was not read within ${String(deadlineMs / 1000)} seconds, so its read was stopped`,
      });
    }, deadlineMs);
    const { stdin, stdout } = child;
    // Both are pipes, as `stdio` asks: only a guard.
    if (stdin === null || stdout === null) {
      settle({ found: 'failed', why: 'its read could not be started' });
      return;
    }
    let output = '';
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > ANSWER_LIMIT) {
        settle({ found: 'failed', why: 'its read gave more than one row would' });
      }
    });
    child.on('error', (cause: NodeJS.ErrnoException) => {
      settle({ found: 'failed', why: failure(cause.code ?? null, null) });
    });
    child.on('close', () => {
      seams.answered?.();
      let parsed: z.infer<typeof answer>;
      try {
        // Never the answer's own text in a message: it holds the key.
        parsed = answer.parse(JSON.parse(output));
      } catch {
        settle({
          found: 'failed',
          why: 'its read gave no answer Mediaplane understands',
        });
        return;
      }
      if (!parsed.ok) {
        settle({ found: 'failed', why: failure(parsed.code, parsed.message) });
      } else if (parsed.row === undefined) {
        settle({ found: 'none' });
      } else {
        settle({ found: 'row', value: parsed.row.value });
      }
    });
    stdin.on('error', () => {
      // It exited before reading its request: its answer, or none, says why.
    });
    stdin.end(JSON.stringify({ url: url.href, ...sqlite }));
  });
}
````

**Change** `packages/engine/src/secrets/recover.ts`:

````diff
diff --git a/packages/engine/src/secrets/recover.ts b/packages/engine/src/secrets/recover.ts
index ae95731..bb4bf13 100644
--- a/packages/engine/src/secrets/recover.ts
+++ b/packages/engine/src/secrets/recover.ts
@@ -3,3 +3,2 @@ import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
 import { join, posix } from 'node:path';
-import { DatabaseSync } from 'node:sqlite';
 import { pathToFileURL } from 'node:url';
@@ -14,2 +13,3 @@ import { isInside } from '../util/path';
 import { compare } from '../util/sort';
+import { queryDatabase, type DatabaseSeams } from './database';
 import { APP_SECRET, UNKEEPABLE_KEY, type SecretStore } from './store';
@@ -59,17 +59,20 @@ async function besideIt(path: string): Promise<'none' | 'file' | 'other'> {
 /**
- * How SQLite opens the database Mediaplane holds open as `fd`, at `path`, without writing
- * anything beside it; undefined when its write-ahead log or its index (-wal, -shm) is not a
- * regular file, which is never opened. One in use has both beside it, which a read-only
- * open reads, as the app's own readers do, making nothing. One closed cleanly has neither,
- * and all it holds is in the file: a read-only open would make both, as Mediaplane's user,
- * in the app's folder (probed), so it is opened immutable, which makes nothing.
+ * How SQLite, in the process that reads it (queryDatabase), opens the database Mediaplane
+ * holds open, at `path`, without writing anything beside it; undefined when its write-ahead
+ * log or its index (-wal, -shm) is not a regular file, which is never opened. One in use
+ * has both beside it, which a read-only open reads, as the app's own readers do, making
+ * nothing. One closed cleanly has neither, and all it holds is in the file: a read-only
+ * open would make both, as Mediaplane's user, in the app's folder (probed), so it is
+ * opened immutable, which makes nothing.
  *
- * SQLite is given the open file (/proc/self/fd/<fd>), not the path: it opens the file by
- * the name that link has as it opens it, so a file put at the path after Mediaplane
- * checked it, a pipe included, is never what it opens (probed). What is left: another file
- * put at that very name between SQLite's look at the link and its own open, or the file
- * unlinked and one named "<name> (deleted)" put beside it, in that instant.
- * readDatabaseKey checks again once SQLite has it.
+ * SQLite is given the open file, which that process is handed as its fd 3
+ * (/proc/self/fd/3), not the path: it opens the file by the name that link has as it opens
+ * it, so a file put at the path after Mediaplane checked it, a pipe included, is never
+ * what it opens (probed). What is left: another file put at that very name between
+ * SQLite's look at the link and its own open, or the file unlinked and one named "<name>
+ * (deleted)" put beside it, in that instant, or a pipe at the -wal after the check, which
+ * would hang the open: the process is then stopped at its deadline. readDatabaseKey checks
+ * again once it has answered.
  */
-async function databaseAt(path: string, fd: number): Promise<URL | undefined> {
+async function databaseAt(path: string): Promise<URL | undefined> {
   const log = await besideIt(`${path}-wal`);
@@ -77,3 +80,3 @@ async function databaseAt(path: string, fd: number): Promise<URL | undefined> {
   if (log === 'other' || index === 'other') return undefined;
-  const url = pathToFileURL(`/proc/self/fd/${String(fd)}`);
+  const url = pathToFileURL('/proc/self/fd/3');
   url.searchParams.set('mode', 'ro');
@@ -122,3 +125,4 @@ async function insideFolder(real: string, folder: string): Promise<boolean> {
  * which an app that owns its folder could otherwise use to have Mediaplane take another
- * app's key, or another file, as its own. Never throws.
+ * app's key, or another file, as its own. A database is read in a process of its own,
+ * with a deadline (queryDatabase); `seams` are for tests. Never throws.
  */
@@ -128,2 +132,3 @@ export async function readKeyFile(
   file: KeyFile,
+  seams: DatabaseSeams = {},
 ): Promise<KeyFound> {
@@ -137,3 +142,3 @@ export async function readKeyFile(
     ? readTextKey(path, folder, outside, file)
-    : readDatabaseKey(path, folder, outside, file.sqlite);
+    : readDatabaseKey(path, folder, outside, file.sqlite, seams);
 }
@@ -213,5 +218,5 @@ async function readUpTo(handle: FileHandle, limit: number): Promise<string | und
  * A SQLite database: opened by Mediaplane, as a text key file is, checked to be a regular
- * file in the app's folder, and given to SQLite open (databaseAt), so that SQLite reads
- * the file checked. Once SQLite has it, the path must still be that file, and its name
- * still in the folder.
+ * file in the app's folder, and handed open to the process that reads it (databaseAt,
+ * queryDatabase), so that SQLite reads the file checked. Once it has answered, the path
+ * must still be that file, and its name still in the folder, or what it read is dropped.
  */
@@ -222,2 +227,3 @@ async function readDatabaseKey(
   sqlite: { query: string; column: string },
+  seams: DatabaseSeams,
 ): Promise<KeyFound> {
@@ -234,29 +240,14 @@ async function readDatabaseKey(
     if (!(await insideFolder(await realpath(fd), folder))) return outside;
-    const at = await databaseAt(path, handle.fd);
+    const at = await databaseAt(path);
     if (at === undefined) return BESIDE;
-    let db: DatabaseSync;
-    try {
-      db = new DatabaseSync(at, { readOnly: true });
-    } catch (cause) {
-      return databaseFailure(cause);
-    }
-    try {
-      // Swapped for another file, or moved out of the folder, since it was checked?
-      const now = await lstat(path);
-      if (now.dev !== opened.dev || now.ino !== opened.ino) return CHANGED;
-      if (!(await insideFolder(await realpath(fd), folder))) return outside;
-      let row;
-      try {
-        row = db.prepare(sqlite.query).get();
-      } catch (cause) {
-        return databaseFailure(cause);
-      }
-      const value = row?.[sqlite.column];
-      if (row === undefined) return { found: 'none' };
-      return typeof value === 'string' && value !== ''
-        ? { found: 'key', value }
-        : { found: 'unreadable', why: `its ${sqlite.column} isn't text` };
-    } finally {
-      db.close();
-    }
+    const read = await queryDatabase(handle.fd, at, sqlite, seams);
+    // Swapped for another file, or moved out of the folder, since it was checked?
+    const now = await lstat(path);
+    if (now.dev !== opened.dev || now.ino !== opened.ino) return CHANGED;
+    if (!(await insideFolder(await realpath(fd), folder))) return outside;
+    if (read.found === 'failed') return { found: 'unreadable', why: read.why };
+    if (read.found === 'none') return { found: 'none' };
+    return typeof read.value === 'string' && read.value !== ''
+      ? { found: 'key', value: read.value }
+      : { found: 'unreadable', why: `its ${sqlite.column} isn't text` };
   } catch (cause) {
@@ -269,14 +260,2 @@ async function readDatabaseKey(
 
-/**
- * Why SQLite couldn't read a database: its own message, which names what failed (a table,
- * a lock), never a value; any other error by its code alone.
- */
-function databaseFailure(cause: unknown): KeyFound {
-  if (codeOf(cause) !== 'ERR_SQLITE_ERROR') {
-    return { found: 'unreadable', why: because(cause) };
-  }
-  const said = cause instanceof Error ? cause.message : String(cause);
-  return { found: 'unreadable', why: `it could not be read as a database (${said})` };
-}
-
 /** Why a key file found gave no key Mediaplane can keep; undefined for none at all. */
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/secrets/recover.test.ts`
Expected: PASS, in a few seconds: the hanging read is stopped after 1 second, the deadline
the test gives.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS. Nothing generated changes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): read Jellyfin's database in a process of its own, with a deadline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Seerr holds Mediaplane's Jellyfin key, and is asked when its file can't be read

Decisions 8 and 9. A resource may name the secrets its app made itself (`adoptSets`):
the first time apply records it, it gives the app the stack's, unchecked, and records
that it did (`given`). Seerr's media server names its Jellyfin key, so Seerr gets
Mediaplane's, and Jellyfin's own copy of the key Seerr made is deleted, only when
Jellyfin lists it under Seerr's name (probe 4). A Seerr whose `settings.json` can't be
read, and that Mediaplane set up, is asked itself whether its setup is open. The fakes
make what the apps made: the fake Seerr makes its own Jellyfin key as it first signs in,
and the fake Jellyfin deletes a key.

**Files:**
- Modify: `packages/engine/src/integrations/types.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/integrations/wire.ts`, `packages/engine/src/integrations/resources.ts`, `packages/engine/src/plan/bootstrap.ts`, `packages/engine/src/plan/plan.ts`, `catalog/seerr/integration.ts`, `packages/engine/src/testing/{bootstrap,jellyfin,seerr}.ts`
- Test: `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/integrations/wire.test.ts`, `packages/engine/src/plan/bootstrap.test.ts`, `packages/engine/src/apply/apply.test.ts`, `catalog/seerr/integration.test.ts`, `packages/cli/src/run.test.ts`, `test/e2e/{requests,apply,deploy,rebuild}.e2e.test.ts`

**Interfaces:**
- **Consumes:** `examine`, `wire`, `planBootstrap`, `Bootstrap.open`, `VerifyContext.peer` (unchanged); `KnownResource` (Task 1).
- **Produces:**
  - `ResourceSpec.adoptSets?: readonly string[]`; `ResourceSpec.update(api, observed, desired, changes, ctx?: VerifyContext)`.
  - `KnownResource.given?: string[]` (`state/resources.json`, optional within `mediaplane.resources/v1`): the secrets Mediaplane gave in place of the app's own.
  - `BootstrapPlan.ask?: string[]` (apps to ask, left out when none); `PlanWiringOptions.ask?: readonly string[]`; `PlannedWiring.open?: Record<string, boolean>`.
  - `seerr.media_server`: `adoptSets: ['apiKey']`; its update deletes Seerr's own Jellyfin key (`DELETE /Auth/Keys/<key>`) when Jellyfin lists it with `AppName` `Seerr`.
  - Fakes: the fake Seerr's `madeKey` (the Jellyfin key it made), the fake Jellyfin's `DELETE /Auth/Keys/<key>` (204), `FakeSignInState.unsure` (Seerr answering 500).

- [ ] **Step 1: Write the failing tests**

The fakes first: Seerr makes its own key, as it did (probe 4).

**Change** `packages/engine/src/testing/seerr.ts`:

````diff
diff --git a/packages/engine/src/testing/seerr.ts b/packages/engine/src/testing/seerr.ts
index 3e9467a..4889f01 100644
--- a/packages/engine/src/testing/seerr.ts
+++ b/packages/engine/src/testing/seerr.ts
@@ -59,2 +59,4 @@ export interface FakeSeerr {
   };
+  /** The key it made in Jellyfin as it first signed in through it, named Seerr. */
+  madeKey?: string;
   /** Its users who signed in through Plex, by plex.tv account id: the first is its admin. */
@@ -571,3 +573,4 @@ function signIn(
     seerr.jellyfin.urlBase = typeof at.urlBase === 'string' ? at.urlBase : '';
-    seerr.jellyfin.apiKey = makeApiKey(jellyfin, 'Seerr');
+    seerr.madeKey = makeApiKey(jellyfin, 'Seerr');
+    seerr.jellyfin.apiKey = seerr.madeKey;
   }
````

**Change** `packages/engine/src/testing/jellyfin.ts`:

````diff
diff --git a/packages/engine/src/testing/jellyfin.ts b/packages/engine/src/testing/jellyfin.ts
index 47066c5..7334ba8 100644
--- a/packages/engine/src/testing/jellyfin.ts
+++ b/packages/engine/src/testing/jellyfin.ts
@@ -346,2 +346,10 @@ export function fakeJellyfin(request: FakeRequest, state: FakeAppState): FakeRep
   }
+  // A key removed by its value, as Jellyfin's dashboard does: 204 (probed), and refused
+  // at once from then on.
+  const removing = /^\/Auth\/Keys\/([^/]+)$/.exec(path);
+  if (removing !== null && method === 'DELETE') {
+    const gone = decodeURIComponent(removing[1] ?? '');
+    state.apiKeys = state.apiKeys.filter((k) => k.AccessToken !== gone);
+    return { status: 204 };
+  }
   return fakeJellyfinLibrary(request, url, state, body) ?? { status: 404 };
````

**Change** `packages/engine/src/testing/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/testing/bootstrap.ts b/packages/engine/src/testing/bootstrap.ts
index c024429..da77797 100644
--- a/packages/engine/src/testing/bootstrap.ts
+++ b/packages/engine/src/testing/bootstrap.ts
@@ -192,2 +192,4 @@ export interface FakeSignInState {
   notReady: boolean;
+  /** Answer /signed-in with 500, as an app that can't say whether its setup is open. */
+  unsure?: boolean;
   /** Who the app belongs to (its admin, the first user): undefined until it is set up. */
@@ -211,3 +213,7 @@ function fakeSignInApp(
   if (path === '/ready') return { status: state.notReady ? 503 : 200 };
-  if (path === '/signed-in') return { status: 200, body: { done: state.done } };
+  if (path === '/signed-in') {
+    return state.unsure === true
+      ? { status: 500, body: 'fake failure' }
+      : { status: 200, body: { done: state.done } };
+  }
   if (path === '/signed-in/own') {
````

**Change** `packages/engine/src/integrations/wiring.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index ed188f4..4e60c71 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -1776,2 +1776,98 @@ describe('planWiring: what drift adds (spec §6.3)', () => {
 
+  it('gives in place of a secret the app made itself, unchecked, the first time it records the resource', async () => {
+    let verified = 0;
+    const own: ResourceSpec = {
+      ...FAKE_LOGIN,
+      adoptSets: ['password'],
+      verify: () => {
+        verified++;
+        return Promise.resolve(true);
+      },
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const first = await planWiring(options(sonarr, { stack: sonarrWith([own]) }));
+    expect(first.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
+    ]);
+    expect(first.checks).toEqual([
+      {
+        resource: 'sonarr.login',
+        secret: 'password',
+        verdict: 'unchecked',
+        reason: "the app made its own at its first-run setup: apply gives it the stack's",
+      },
+    ]);
+    expect(verified).toBe(0);
+    // Recorded by a release before, which gave none: given once, all the same.
+    const older = await planWiring(
+      options(sonarr, { stack: sonarrWith([own]), known: RECORDED }),
+    );
+    expect(older.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
+    ]);
+    // Given since, as the record says: checked by using it, as any secret.
+    const given = {
+      'sonarr.login': {
+        ...(RECORDED['sonarr.login'] as KnownResource),
+        given: ['password'],
+      },
+    };
+    const after = await planWiring(
+      options(sonarr, { stack: sonarrWith([own]), known: given }),
+    );
+    expect(after.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+    expect(verified).toBe(1);
+  });
+
+  it('asks an app itself whether its setup is open, before its key, when plan is told to', async () => {
+    const asking = (open: () => Promise<boolean>) =>
+      stackOf(
+        WIRED_CATALOG.map((def) =>
+          def.id === 'sonarr'
+            ? {
+                ...def,
+                bootstrap: {
+                  done: { path: 'setup.txt', pattern: /done/ },
+                  open,
+                  run: () => Promise.resolve(undefined),
+                },
+              }
+            : def,
+        ),
+      );
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const done = await planWiring(
+      options(sonarr, {
+        stack: asking(() => Promise.resolve(false)),
+        ask: ['sonarr'],
+        known: RECORDED,
+      }),
+    );
+    expect([done.open, done.changes]).toEqual([
+      { sonarr: false },
+      [{ resource: 'sonarr.login', action: 'unchanged' }],
+    ]);
+    // Open: it takes no key yet, and is set up first, so it is checked after that.
+    const before = sonarr.app.requests.length;
+    const open = await planWiring(
+      options(sonarr, { stack: asking(() => Promise.resolve(true)), ask: ['sonarr'] }),
+    );
+    expect([open.open, open.changes]).toEqual([
+      { sonarr: true },
+      [{ resource: 'sonarr.login', action: 'after-start' }],
+    ]);
+    expect(sonarr.app.requests.slice(before)).toEqual([]);
+    // One that can't say is not in `open`: plan sets it up again (fail closed).
+    const unsure = await planWiring(
+      options(sonarr, {
+        stack: asking(() => Promise.reject(new AppApiError('no', { kind: 'server' }))),
+        ask: ['sonarr'],
+        known: RECORDED,
+      }),
+    );
+    expect(unsure.open).toEqual({});
+    // Not told to ask: no answer at all.
+    expect((await planWiring(options(sonarr))).open).toBeUndefined();
+  });
+
   it('says what apply may remove once an app that is not settled has started, and only that', async () => {
````

**Change** `packages/engine/src/integrations/wire.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index 93d1ddf..d5624d6 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -1081,2 +1081,25 @@ describe('wire', () => {
 
+  it('gives the stack its own secret in place of one the app made itself, once, and records that it did', async () => {
+    const own: ResourceSpec = { ...FAKE_LOGIN, adoptSets: ['password'] };
+    const stack = stackOf(
+      WIRED_CATALOG.map((def) =>
+        def.id === 'sonarr'
+          ? { ...def, integration: { after: [], resources: [own] } }
+          : def,
+      ),
+    );
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'its-own' });
+    const first = await wireWith(sonarr, { stack, known: RECORDED });
+    expect(await first.run).toEqual(['sonarr.login updated password']);
+    expect(sonarr.state.password).toBe(PASSWORD);
+    expect((await readResources(first.home))['sonarr.login']?.given).toEqual([
+      'password',
+    ]);
+    const again = await wireWith(sonarr, {
+      stack,
+      known: await readResources(first.home),
+    });
+    expect(await again.run).toEqual([]);
+  });
+
   it('removes what Mediaplane made that the stack no longer wants, while still as made, and forgets its record', async () => {
````

**Change** `packages/engine/src/plan/bootstrap.test.ts`:

````diff
diff --git a/packages/engine/src/plan/bootstrap.test.ts b/packages/engine/src/plan/bootstrap.test.ts
index 3bfef49..1519ce3 100644
--- a/packages/engine/src/plan/bootstrap.test.ts
+++ b/packages/engine/src/plan/bootstrap.test.ts
@@ -220,2 +220,15 @@ describe('planBootstrap: a setup that makes no key', () => {
   });
+
+  it('leaves one Mediaplane set up to be asked of the app itself, saying so, when it cannot read the file', async () => {
+    const found = await signInStack('unreadable', RECORDED);
+    expect([found.changes, found.ask]).toEqual([[], ['sonarr']]);
+    expect(found.diagnostics).toEqual([
+      expect.objectContaining({
+        severity: 'warning',
+        code: 'bootstrap.unreadable',
+        message:
+          "Mediaplane can't read the file in sonarr's appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; Mediaplane asks sonarr itself, and sets it up again, unpublished, only if it says its setup is open, or can't be asked",
+      }),
+    ]);
+  });
 });
````

**Change** `packages/engine/src/apply/apply.test.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 40c40f1..b4087b4 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -3169,3 +3169,4 @@ describe('apply: a first-run setup that makes no key, after another', () => {
     const run = () => apply(options(home, runtime, { catalog, wiring: setup.seams }));
-    return { home, setup, ups, run };
+    const planned = () => plan(options(home, runtime, { catalog, wiring: setup.seams }));
+    return { home, setup, ups, run, planned };
   }
@@ -3520,4 +3521,4 @@ describe('apply: a first-run setup that makes no key, after another', () => {
 
-  it("fails every apply at verify while a setup that makes no key can't read its file", async () => {
-    const { home, setup, ups, run } = await signInStack();
+  it("asks a setup that makes no key, which Mediaplane set up, itself while its file can't be read, and sets it up again only if it says it is open", async () => {
+    const { home, setup, ups, run, planned } = await signInStack();
     // The app says it is set up, by the shared admin; its file can't be read to say so.
@@ -3526,12 +3527,18 @@ describe('apply: a first-run setup that makes no key, after another', () => {
     await mkdir(join(home, 'appdata', 'sonarr', 'signed-in.txt'), { recursive: true });
-    for (const attempt of [1, 2]) {
-      const result = await run();
-      expect(result.outcome, `apply ${String(attempt)}`).toBe('failed');
-      expect(result.diagnostics).toContainEqual(
-        expect.objectContaining({ code: 'bootstrap.unreadable', severity: 'warning' }),
-      );
-      expect(result.diagnostics.at(-1)?.message).toContain('sonarr (first-run setup)');
-    }
-    // Started unpublished on each apply, and published only once its setup has shown it
-    // is Mediaplane's (its owner is the shared admin).
+    // Nothing records it as Mediaplane's yet: set up unpublished, as before, and recorded.
+    const first = await run();
+    expect(first.outcome).toBe('success');
+    expect((await readSecretStore(home)).setUp).toEqual(['sonarr']);
+    // From then on Sonarr is asked itself: its setup is done, so it stays as it is, and the
+    // plan, verify's too, is done, with the warning that the file can't be read.
+    const second = await run();
+    expect(second.outcome).toBe('no-changes');
+    expect(second.plan.bootstrap).toEqual([]);
+    expect(second.diagnostics).toContainEqual(
+      expect.objectContaining({
+        code: 'bootstrap.unreadable',
+        message:
+          "Mediaplane can't read the file in sonarr's appdata that says whether its first-run setup is done, so it can't tell whether the setup is open; Mediaplane asks sonarr itself, and sets it up again, unpublished, only if it says its setup is open, or can't be asked",
+      }),
+    );
     expect(ups).toEqual([
@@ -3539,5 +3546,19 @@ describe('apply: a first-run setup that makes no key, after another', () => {
       'all published; jellyfin done, sonarr done',
-      'sonarr unpublished; jellyfin done, sonarr done',
-      'all published; jellyfin done, sonarr done',
     ]);
+    // Open again, as after its appdata was reset by hand: set up again, unpublished.
+    setup.signIn.done = false;
+    setup.signIn.owner = undefined;
+    const reopened = await planned();
+    expect(reopened.bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
+    expect(reopened.containers.find((c) => c.service === 'sonarr')?.action).toBe(
+      'recreate',
+    );
+    // Its wiring is checked once it is set up, as any app's whose setup is open.
+    expect(reopened.wiring.filter((w) => w.resource.startsWith('sonarr'))).toEqual([
+      { resource: 'sonarr', action: 'after-start' },
+    ]);
+    // Done, but it can't say so: unsure is open (fail closed).
+    setup.signIn.done = true;
+    setup.signIn.unsure = true;
+    expect((await planned()).bootstrap).toEqual([{ app: 'sonarr', unpublished: true }]);
   });
````

**Change** `catalog/seerr/integration.test.ts`:

````diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index 3889481..97aaebe 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -320,2 +320,51 @@ describe("Seerr's media server", () => {
 
+  it("gives Seerr Mediaplane's Jellyfin key in place of the one it made, and removes that one from Jellyfin", async () => {
+    const { api, apis, state, jellyfin, calls } = await seerr();
+    // Given the first time Mediaplane records the link, rather than checked.
+    expect(spec.adoptSets).toEqual(['apiKey']);
+    const desired = wanted(spec);
+    const own = state.seerr.madeKey;
+    expect(jellyfin.apiKeys.map((k) => k.AppName)).toEqual(['Mediaplane', 'Seerr']);
+    const observed = await spec.observe(api, undefined, desired);
+    if (observed === undefined) throw new Error('observed');
+    // Jellyfin as apply's wire step reached it, with Mediaplane's key.
+    const toJellyfin = createAppApi({
+      name: 'Jellyfin',
+      service: 'jellyfin',
+      port: 8096,
+      endpoint: { host: '127.0.0.1', port: apis.app.port },
+      key: { scheme: 'mediabrowser', value: JELLYFIN_KEY },
+      secrets: [JELLYFIN_KEY],
+      retry: { deadlineMs: 0 },
+    });
+    const ctx = {
+      readOnly: false,
+      peer: (app: string) => (app === 'jellyfin' ? toJellyfin : undefined),
+    };
+    const before = calls().length;
+    await spec.update(api, desired, observed, ['apiKey'], ctx);
+    expect(calls(before).slice(0, 4)).toEqual([
+      'GET /api/v1/settings/jellyfin',
+      'POST /api/v1/settings/jellyfin',
+      'GET /Auth/Keys',
+      `DELETE /Auth/Keys/${own ?? ''}`,
+    ]);
+    expect(state.seerr.jellyfin.apiKey).toBe(JELLYFIN_KEY);
+    expect(jellyfin.apiKeys.map((k) => k.AppName)).toEqual(['Mediaplane']);
+    // Given again later, as when Seerr's is refused: Mediaplane's own key is never removed.
+    await spec.update(api, desired, observed, ['apiKey'], ctx);
+    expect(jellyfin.apiKeys.map((k) => k.AppName)).toEqual(['Mediaplane']);
+  });
+
+  it("leaves in Jellyfin a key Seerr held that isn't one it made, or when Jellyfin can't be asked", async () => {
+    const { api, state, jellyfin } = await seerr();
+    const desired = wanted(spec);
+    const observed = await spec.observe(api, undefined, desired);
+    if (observed === undefined) throw new Error('observed');
+    // No Jellyfin to ask: Seerr gets Mediaplane's key, and its own stays in Jellyfin.
+    await spec.update(api, desired, observed, ['apiKey']);
+    expect(state.seerr.jellyfin.apiKey).toBe(JELLYFIN_KEY);
+    expect(jellyfin.apiKeys.map((k) => k.AppName)).toEqual(['Mediaplane', 'Seerr']);
+  });
+
   it('enables only the libraries an override names, and leaves the others to you', async () => {
````

**Change** `packages/cli/src/run.test.ts`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index a215463..c40bcea 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1299,5 +1299,3 @@ describe('mediaplane apply: Seerr in the stack', () => {
   function seerrsOwn(): string {
-    const own = apis.apps
-      .get('jellyfin')
-      ?.apiKeys.find((k) => k.AppName === 'Seerr')?.AccessToken;
+    const own = apis.apps.get('seerr')?.seerr.madeKey;
     if (own === undefined) throw new Error('Seerr made no key in Jellyfin');
@@ -1327,3 +1325,3 @@ describe('mediaplane apply: Seerr in the stack', () => {
     for (const line of [
-      'seerr.media_server: updated libraries',
+      'seerr.media_server: updated libraries, apiKey',
       'seerr.server_sonarr: created',
@@ -1340,2 +1338,10 @@ describe('mediaplane apply: Seerr in the stack', () => {
     });
+    // Seerr holds Mediaplane's Jellyfin key now, and the one it made is gone from Jellyfin.
+    const jellyfinKey = (await readSecretStore(home)).apps.jellyfin?.apiKey;
+    expect(seerr?.jellyfin.apiKey === jellyfinKey, "Seerr holds Mediaplane's key").toBe(
+      true,
+    );
+    expect(apis.apps.get('jellyfin')?.apiKeys.map((k) => k.AppName)).toEqual([
+      'Mediaplane',
+    ]);
     expect(seerr?.sonarr).toMatchObject([
````

The end-to-end tests see Seerr holding Mediaplane's key, and Jellyfin only that one; the
request test makes Seerr's `settings.json` unreadable, and sees Seerr asked.

**Change** `test/e2e/requests.e2e.test.ts`:

````diff
diff --git a/test/e2e/requests.e2e.test.ts b/test/e2e/requests.e2e.test.ts
index 75e832b..d562ce6 100644
--- a/test/e2e/requests.e2e.test.ts
+++ b/test/e2e/requests.e2e.test.ts
@@ -17,3 +17,5 @@ import {
   api,
+  BUSYBOX,
   composeDown,
+  docker as dockerCli,
   expectWiringRemoved,
@@ -225,4 +227,5 @@ describe('the whole stack, wired with no clicking', () => {
       expect(wired(first.actions).slice(-4)).toEqual([
-        // Its first sign-in set Jellyfin as its media server, with no library yet.
-        ['seerr.media_server', 'updated libraries'],
+        // Its first sign-in set Jellyfin as its media server, with no library yet, and a
+        // key Seerr made itself, which Mediaplane's replaces (Slice 10b).
+        ['seerr.media_server', 'updated libraries, apiKey'],
         ['seerr.server_sonarr', 'created'],
@@ -241,2 +244,24 @@ describe('the whole stack, wired with no clicking', () => {
       expect((await plan(options)).bootstrap).toEqual([]);
+      // Its settings.json made unreadable, as root, to every user but root: Seerr is
+      // asked itself, says its setup is done, and stays as it is (Slice 10b).
+      const chmod = (mode: string) =>
+        dockerCli(
+          'run',
+          '--rm',
+          '-v',
+          `${join(home, 'appdata', 'seerr')}:/seerr`,
+          BUSYBOX,
+          'chmod',
+          mode,
+          '/seerr/settings.json',
+        );
+      await chmod('000');
+      try {
+        const asked = await plan(options);
+        expect(asked.bootstrap).toEqual([]);
+        expect(asked.changed).toBe(false);
+        expect(asked.diagnostics.map((d) => d.code)).toContain('bootstrap.unreadable');
+      } finally {
+        await chmod('644');
+      }
       const keyOf = (app: string) => store.apps[app]?.apiKey ?? '';
@@ -268,3 +293,5 @@ describe('the whole stack, wired with no clicking', () => {
       };
-      // The key Seerr made itself in Jellyfin, as it signed in: a secret too.
+      // Seerr made itself a key in Jellyfin as it signed in; Mediaplane gave it its own
+      // in its place, and removed Seerr's: Jellyfin holds Mediaplane's alone, which Seerr
+      // holds (it shows its Jellyfin key, compared here, yes or no).
       const keys = await getJson<{ Items: { AccessToken: string; AppName: string }[] }>(
@@ -274,8 +301,14 @@ describe('the whole stack, wired with no clicking', () => {
       );
-      const seerrsOwn = keys.Items.find((k) => k.AppName === 'Seerr')?.AccessToken ?? '';
-      expect(seerrsOwn !== '', 'Seerr made itself a key in Jellyfin').toBe(true);
+      expect(keys.Items.map((k) => k.AppName)).toEqual(['Mediaplane']);
+      const held = await getJson<{ apiKey: string }>(
+        SEERR,
+        '/api/v1/settings/jellyfin',
+        seerrKey,
+      );
+      expect(held.apiKey === keyOf('jellyfin'), "Seerr holds Mediaplane's key").toBe(
+        true,
+      );
       const secrets = [
-        ...Object.values(store.apps).flatMap((held) => Object.values(held)),
+        ...Object.values(store.apps).flatMap((value) => Object.values(value)),
         password,
-        seerrsOwn,
       ];
````

**Change** `test/e2e/apply.e2e.test.ts`:

````diff
diff --git a/test/e2e/apply.e2e.test.ts b/test/e2e/apply.e2e.test.ts
index 5bfbb96..89bb85b 100644
--- a/test/e2e/apply.e2e.test.ts
+++ b/test/e2e/apply.e2e.test.ts
@@ -296,4 +296,5 @@ describe('apply against real Docker', () => {
         ['prowlarr.indexer_proxy', 'created'],
-        // Seerr's first sign-in set Jellyfin as its media server, with no library yet.
-        ['seerr.media_server', 'updated libraries'],
+        // Seerr's first sign-in set Jellyfin as its media server, with no library yet,
+        // and a key of its own, which Mediaplane's replaces.
+        ['seerr.media_server', 'updated libraries, apiKey'],
         ['seerr.server_sonarr', 'created'],
@@ -321,3 +322,5 @@ describe('apply against real Docker', () => {
       ).toBe(false);
-      // Lost state: apply adopts what the apps hold, by name, and changes none of it.
+      // Lost state: apply adopts what the apps hold, by name, and changes none of it, but
+      // for giving Seerr its Jellyfin key again, as the first time (Slice 10b): the one
+      // Seerr holds already.
       await rm(join(home, 'state', 'resources.json'));
@@ -326,3 +329,7 @@ describe('apply against real Docker', () => {
       expect(adopted.plan.wiring.filter((w) => w.action !== 'unchanged')).toEqual(
-        WIRED.map((resource) => ({ resource, action: 'adopt' })),
+        WIRED.map((resource) =>
+          resource === 'seerr.media_server'
+            ? { resource, action: 'update', changes: ['apiKey'] }
+            : { resource, action: 'adopt' },
+        ),
       );
````

**Change** `test/e2e/deploy.e2e.test.ts`:

````diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index 235fe18..4d7b9e6 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -475,3 +475,3 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
       ['sonarr.connection_jellyfin', 'created'],
-      ['seerr.media_server', 'updated libraries'],
+      ['seerr.media_server', 'updated libraries, apiKey'],
       ['seerr.server_sonarr', 'created'],
````

**Change** `test/e2e/rebuild.e2e.test.ts`:

````diff
diff --git a/test/e2e/rebuild.e2e.test.ts b/test/e2e/rebuild.e2e.test.ts
index 1b44b4c..072f104 100644
--- a/test/e2e/rebuild.e2e.test.ts
+++ b/test/e2e/rebuild.e2e.test.ts
@@ -192,3 +192,8 @@ describe('a host rebuilt from stack.yaml and its appdata (spec §6.1, §6.3, §1
       expect(wired(rebuilt.actions).filter(([, detail]) => detail !== 'adopted')).toEqual(
-        ADMINS.map((resource) => [resource, 'updated password']),
+        [
+          ...ADMINS.map((resource) => [resource, 'updated password']),
+          // Its record gone, Seerr's Jellyfin key is given again, as the first time: the
+          // one it holds, Mediaplane's, so nothing goes from Jellyfin (Slice 10b).
+          ['seerr.media_server', 'updated apiKey'],
+        ],
       );
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/integrations/wiring.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/plan/bootstrap.test.ts packages/engine/src/apply/apply.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts`

Expected: FAIL: 7 tests in 6 files (390 run). `wiring.test.ts` checks a secret the app made itself where it expects it given, unchecked, and asks no app whether its setup is open; `wire.test.ts` records no `given` (`expected undefined to deeply equal [ 'apiKey' ]`); `bootstrap.test.ts` and `apply.test.ts` set Seerr up again rather than ask it (`expected 'failed' to be 'success'`); `seerr/integration.test.ts` and `run.test.ts` see Seerr keep the key it made, and Jellyfin keep two.

- [ ] **Step 3: Implement**

The contract: secrets the app made itself, and the context an update gets.

**Change** `packages/engine/src/integrations/types.ts`:

````diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index 7fe3de8..d35ce39 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -107,2 +107,9 @@ export interface ResourceSpec {
   secrets: readonly string[];
+  /**
+   * Secrets the app makes for itself at its first-run setup, such as the Jellyfin key
+   * Seerr makes as it first signs in: apply gives the app the stack's in their place the
+   * first time it records the resource, rather than check what the app holds, so that the
+   * stack's own key is the one to rotate (an update naming them).
+   */
+  adoptSets?: readonly string[];
   /**
@@ -171,3 +178,4 @@ export interface ResourceSpec {
    * differs, fields and secrets, as plan says it: a secret named there was found refused,
-   * and needs no other check.
+   * or is one to give in place of the app's own (`adoptSets`), and needs no other check.
+   * `ctx` is apply's VerifyContext: the other apps it may ask.
    */
@@ -178,2 +186,3 @@ export interface ResourceSpec {
     changes?: readonly string[],
+    ctx?: VerifyContext,
   ): Promise<void>;
````

**Change** `packages/engine/src/integrations/resources.ts`:

````diff
diff --git a/packages/engine/src/integrations/resources.ts b/packages/engine/src/integrations/resources.ts
index 32b2d22..47e68c0 100644
--- a/packages/engine/src/integrations/resources.ts
+++ b/packages/engine/src/integrations/resources.ts
@@ -23,2 +23,8 @@ const knownSchema = z.looseObject({
   secrets: z.array(z.string()),
+  /**
+   * The names of the secrets Mediaplane gave the app in place of ones the app made itself
+   * (a resource's `adoptSets`: Seerr's Jellyfin key), so that it gives them only once.
+   * Added in Slice 10b; an older release keeps it as a field it doesn't know.
+   */
+  given: z.array(z.string()).optional(),
   appliedAt: z.iso.datetime(),
````

**Change** `packages/engine/src/integrations/wiring.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 7dd823d..d5ad3a6 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -438,2 +438,8 @@ const LACKED: Verdict = {
 
+/** Why a secret the app made itself at its first-run setup isn't checked. */
+const REPLACED: Verdict = {
+  verdict: 'unchecked',
+  reason: "the app made its own at its first-run setup: apply gives it the stack's",
+};
+
 /** Why a secret beside a new one (FRESH, LACKED) isn't checked. */
@@ -552,2 +558,8 @@ export async function examine(
   const fresh = spec.secrets.filter((secret) => newVerdict(secret) !== undefined);
+  // A secret the app made itself at its first-run setup, replaced with the stack's until
+  // the record says Mediaplane gave it (`adoptSets`, the record's `given`): a change,
+  // never checked.
+  const replacing = (spec.adoptSets ?? []).filter(
+    (secret) => spec.secrets.includes(secret) && !(record?.given ?? []).includes(secret),
+  );
   // A field that differs makes it an update, which sets the secrets too: checking them
@@ -558,7 +570,11 @@ export async function examine(
       ? []
-      : changes.length > 0
-        ? unchecked('a managed field differs: apply sets the secrets with it')
-        : fresh.length > 0
-          ? eachSecret(spec, address, (secret) => newVerdict(secret) ?? WITH_NEW)
-          : await checkSecrets(spec, api, address, desired, observed, known, options);
+      : replacing.length > 0
+        ? eachSecret(spec, address, (secret) =>
+            replacing.includes(secret) ? REPLACED : WITH_NEW,
+          )
+        : changes.length > 0
+          ? unchecked('a managed field differs: apply sets the secrets with it')
+          : fresh.length > 0
+            ? eachSecret(spec, address, (secret) => newVerdict(secret) ?? WITH_NEW)
+            : await checkSecrets(spec, api, address, desired, observed, known, options);
   const refused = checks.filter((check) => check.verdict === 'refused');
@@ -566,2 +582,3 @@ export async function examine(
   if (changes.length === 0) changes.push(...fresh);
+  changes.push(...replacing.filter((secret) => !changes.includes(secret)));
   if (record !== undefined) {
@@ -813,2 +830,7 @@ export interface PlanWiringOptions {
   lacking?: Readonly<Record<string, readonly string[]>>;
+  /**
+   * The apps whose first-run setup plan asks the app itself about (BootstrapPlan.ask), as
+   * it reaches each: `open` gives the answers.
+   */
+  ask?: readonly string[];
   seams?: WiringSeams;
@@ -824,2 +846,7 @@ export interface PlannedWiring {
   checks: SecretCheck[];
+  /**
+   * Of `ask`, by app, whether its first-run setup is open (Bootstrap.open), as the app
+   * itself said; one it couldn't ask isn't here.
+   */
+  open?: Record<string, boolean>;
 }
@@ -847,2 +874,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
   const checks: SecretCheck[] = [];
+  const open: Record<string, boolean> = {};
   /** The apps that took Mediaplane's key: what a check may ask of another app. */
@@ -912,2 +940,17 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
     }
+    // Whether its first-run setup is open, as it says itself, without its key: asked
+    // first, since an app whose setup is open takes no key.
+    const setup = app.def.bootstrap;
+    if (setup !== undefined && options.ask?.includes(app.def.id) === true) {
+      try {
+        open[app.def.id] = await setup.open(client.api);
+      } catch (cause) {
+        if (!(cause instanceof AppApiError)) throw cause;
+      }
+      // Open, it takes no key, and is set up first: its wiring is checked after that.
+      if (open[app.def.id] === true) {
+        for (const resource of targets) add({ resource, action: 'after-start' });
+        continue;
+      }
+    }
     const name = app.def.api?.key.secret;
@@ -1058,3 +1101,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
   }
-  return redacted({ changes, diagnostics, drift, checks }, [
+  const planned = redacted({ changes, diagnostics, drift, checks }, [
     ...options.secrets,
@@ -1062,2 +1105,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
   ]);
+  return options.ask === undefined ? planned : { ...planned, open };
 }
````

**Change** `packages/engine/src/integrations/wire.ts`:

````diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index d51dfb5..4ce6c90 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -10,2 +10,3 @@ import { stackKeys } from '../secrets/values';
 import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
+import { compare } from '../util/sort';
 import { desiredOf } from './overrides';
@@ -356,3 +357,9 @@ export async function wire(options: WireOptions): Promise<string[]> {
         } else if (result.action === 'update' && result.observed !== undefined) {
-          await spec.update(client.api, result.desired, result.observed, result.changes);
+          await spec.update(
+            client.api,
+            result.desired,
+            result.observed,
+            result.changes,
+            context,
+          );
         }
@@ -366,2 +373,6 @@ export async function wire(options: WireOptions): Promise<string[]> {
       const { checks: _checks, ...prior } = known[address] ?? {};
+      // The secrets Mediaplane gave in place of the app's own (`adoptSets`), by name.
+      const gave = (spec.adoptSets ?? []).filter(
+        (secret) => result.action === 'create' || result.changes.includes(secret),
+      );
       known[address] = {
@@ -373,2 +384,9 @@ export async function wire(options: WireOptions): Promise<string[]> {
         appliedAt: options.now().toISOString(),
+        ...(gave.length === 0
+          ? {}
+          : {
+              given: [...new Set([...(known[address]?.given ?? []), ...gave])].sort(
+                compare,
+              ),
+            }),
       };
````

The setup asked, in the plan.

**Change** `packages/engine/src/plan/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/plan/bootstrap.ts b/packages/engine/src/plan/bootstrap.ts
index dc72345..33e3697 100644
--- a/packages/engine/src/plan/bootstrap.ts
+++ b/packages/engine/src/plan/bootstrap.ts
@@ -27,2 +27,9 @@ export interface BootstrapPlan {
   held: BootstrapChange[];
+  /**
+   * The apps with a setup that makes no key, which Mediaplane set up (`setUp`), whose file
+   * that says the setup is done it can't read: plan asks the app itself (`Bootstrap.open`)
+   * once it reaches it, and sets it up again, unpublished, only when the app says its
+   * setup is open, or can't be asked. Left out when there are none.
+   */
+  ask?: string[];
   diagnostics: Diagnostic[];
@@ -52,4 +59,5 @@ export interface PasswordsToCome {
  * says nothing, so the stored key decides, with a warning that it can't tell; for a setup
- * that makes no key (Seerr's), there is none to decide, so the app starts unpublished and
- * is set up again, with that warning. A setup that makes no key counts as done only when
+ * that makes no key (Seerr's), there is none to decide: the app itself is asked (`ask`)
+ * when the store names it, and otherwise it starts unpublished and is set up again, with
+ * that warning. A setup that makes no key counts as done only when
  * its file says so and the store names the app (`setUp`): an app set up by someone else,
@@ -67,2 +75,3 @@ export async function inspectBootstrap(
   const changes: BootstrapChange[] = [];
+  const ask: string[] = [];
   const diagnostics: Diagnostic[] = [];
@@ -86,2 +95,6 @@ export async function inspectBootstrap(
     const done = await appSetupDone(stack.home, app);
+    // Set up by Mediaplane, as its record says: the app itself is asked, once plan
+    // reaches it, rather than set up again every time.
+    const known = store.setUp?.includes(app.def.id) === true;
+    const asked = setup.secret === undefined && done === undefined && known;
     if (done === undefined && (made || setup.secret === undefined)) {
@@ -89,3 +102,5 @@ export async function inspectBootstrap(
         ? 'the stored key decides'
-        : `${app.def.name} starts unpublished, and is set up again, until it can`;
+        : asked
+          ? `Mediaplane asks ${app.def.name} itself, and sets it up again, unpublished, only if it says its setup is open, or can't be asked`
+          : `${app.def.name} starts unpublished, and is set up again, until it can`;
       diagnostics.push(
@@ -101,3 +116,2 @@ export async function inspectBootstrap(
     // (the store names it): a file alone doesn't say who set the app up.
-    const known = store.setUp?.includes(app.def.id) === true;
     if (setup.secret === undefined ? done === true && known : made && done !== false) {
@@ -105,2 +119,6 @@ export async function inspectBootstrap(
     }
+    if (asked) {
+      ask.push(app.def.id);
+      continue;
+    }
     changes.push({
@@ -117,2 +135,3 @@ export async function inspectBootstrap(
     held: [...kept.held, ...through.held],
+    ...(ask.length === 0 ? {} : { ask }),
     diagnostics: [...diagnostics, ...kept.diagnostics, ...through.diagnostics],
````

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 1f5703d..292b8cd 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -373,2 +373,4 @@ export async function planStack(
   let checks: SecretCheck[] = [];
+  /** What the apps asked about their own setup said (PlannedWiring.open). */
+  let open: Record<string, boolean> = {};
   // In memory: the secrets apply would generate, so that a first plan can say what it
@@ -433,2 +435,3 @@ export async function planStack(
         lacking: Object.fromEntries(notIn.map((app) => [app, [admin.password]])),
+        ...(setups.ask === undefined ? {} : { ask: setups.ask }),
       });
@@ -436,2 +439,3 @@ export async function planStack(
       wiring = planned.changes;
+      open = planned.open ?? {};
       diagnostics.push(...planned.diagnostics);
@@ -460,2 +464,23 @@ export async function planStack(
   }
+  // An app whose appdata can't say whether its setup is done, asked itself: set up again,
+  // unpublished, unless it said its setup is done (fail closed: one that couldn't be asked
+  // is too). Its wiring is then checked after the start, as for any app set up first.
+  const reopened = (setups.ask ?? []).filter((app) => open[app] !== false);
+  if (reopened.length > 0) {
+    const theirs = (resource: string) =>
+      reopened.some((app) => resource === app || resource.startsWith(`${app}.`));
+    bootstrap = [...bootstrap, ...reopened.map((app) => ({ app, unpublished: true }))];
+    containers = containers.map((change) =>
+      reopened.includes(change.service) && change.action !== 'create'
+        ? { ...change, action: 'recreate' }
+        : change,
+    );
+    wiring = wiring.map((change) =>
+      theirs(change.resource)
+        ? { resource: change.resource, action: 'after-start' }
+        : change,
+    );
+    drift = drift.filter((entry) => !theirs(entry.resource));
+    checks = checks.filter((check) => !theirs(check.resource));
+  }
   return {
````

Seerr's media server.

**Change** `catalog/seerr/integration.ts`:

````diff
diff --git a/catalog/seerr/integration.ts b/catalog/seerr/integration.ts
index c20e81e..b778925 100644
--- a/catalog/seerr/integration.ts
+++ b/catalog/seerr/integration.ts
@@ -177,2 +177,30 @@ async function saveJellyfin(api: AppApi, desired: DesiredResource): Promise<void
 
+/** The name Seerr gives the key it makes in Jellyfin as it first signs in (probed). */
+const SEERR_KEY_NAME = 'Seerr';
+
+const jellyfinKeys = z.looseObject({
+  Items: z.array(z.looseObject({ AccessToken: z.string(), AppName: z.unknown() })),
+});
+
+/**
+ * Remove from Jellyfin the key Seerr held (`held`) before Mediaplane gave it the stack's
+ * (`given`): only one Jellyfin lists under the name Seerr gives the key it makes, which
+ * Seerr no longer holds. Asked of Jellyfin with Mediaplane's key; nothing when Jellyfin
+ * can't be asked, or the key was the stack's. Every key Jellyfin lists is kept out of
+ * what the run says. Throws AppApiError.
+ */
+async function retireOwnKey(
+  jellyfin: AppApi | undefined,
+  held: string,
+  given: string,
+): Promise<void> {
+  if (jellyfin === undefined || held === '' || held === given) return;
+  const { Items } = await jellyfin.get('/Auth/Keys', jellyfinKeys);
+  for (const key of Items) jellyfin.addSecret(key.AccessToken);
+  if (!Items.some((key) => key.AccessToken === held && key.AppName === SEERR_KEY_NAME)) {
+    return;
+  }
+  await jellyfin.submit('DELETE', `/Auth/Keys/${encodeURIComponent(held)}`);
+}
+
 /**
@@ -223,5 +251,7 @@ async function enableLibraries(
  *   Jellyfin ("Seerr"), which Seerr shows in clear: once read, it is kept out of what
- *   the run says. That key stays while it works: the secret is checked by using it
- *   (Seerr's list of Jellyfin's users), never compared. Mediaplane gives Seerr its own
- *   Jellyfin key only when Seerr's is refused, or Jellyfin moves.
+ *   the run says. The first time Mediaplane records the link (`adoptSets`), it gives Seerr
+ *   its own Jellyfin key in its place, and removes Seerr's from Jellyfin, so that one key,
+ *   Mediaplane's, is the one to rotate. From then on the secret is checked by using it
+ *   (Seerr's list of Jellyfin's users), never compared, and given again when refused, or
+ *   when Jellyfin moves.
  * - `libraries` lists which of Mediaplane's are enabled; a library you enable is yours.
@@ -238,2 +268,3 @@ const mediaServer: ResourceSpec = {
   secrets: ['apiKey'],
+  adoptSets: ['apiKey'],
   requires: ['jellyfin.admin', 'jellyfin.library_movies', 'jellyfin.library_shows'],
@@ -282,3 +313,3 @@ const mediaServer: ResourceSpec = {
   },
-  async update(api, desired, observed, changes = []) {
+  async update(api, desired, observed, changes = [], ctx) {
     const moved = !atStack(desired, observed);
@@ -286,5 +317,9 @@ const mediaServer: ResourceSpec = {
     // in Seerr's log, so one is enough (the owner's decision of 2026-10-17). One left
-    // unchecked, because a field differs, is checked here, once.
+    // unchecked, because a field differs, is checked here, once. So is the one Seerr made
+    // itself at its first sign-in (`adoptSets`), which then goes from Jellyfin.
     if (moved || changes.includes('apiKey') || !(await heldKeyWorks(api))) {
+      const held = (await api.get(`${SETTINGS}/jellyfin`, heldJellyfinSettings)).apiKey;
+      api.addSecret(held);
       await saveJellyfin(api, desired);
+      await retireOwnKey(ctx?.peer('jellyfin'), held, secretOf(desired, 'apiKey'));
     }
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/integrations/wiring.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/plan/bootstrap.test.ts packages/engine/src/apply/apply.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts`
Expected: PASS. Then, alone on the machine, with nothing else running in Docker, each of
`test/e2e/requests.e2e.test.ts`, `test/e2e/apply.e2e.test.ts` and
`test/e2e/rebuild.e2e.test.ts` passes with
`pnpm vitest run --config vitest.e2e.config.ts <file>` (about two minutes each, warm).

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS. Nothing generated changes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine,catalog): give Seerr Mediaplane's Jellyfin key in place of its own, and ask Seerr when its file can't be read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: A new Plex token for the arrs and Seerr: `--rotate plex.token`

Decision 10. `plan --rotate plex.token` and `apply --rotate plex.token` take your new
token as a change, unchecked, for each resource that holds it, but one whose own app
refuses it; and list Seerr's setup again, published (`again`), since its setup says it
signs in with `plex.token` (`signsInWith`). Seerr's setup then checks through plex.tv that
Seerr's admin is the new token's account, and signs in again with it (probe 5). The fake
Seerr's `/auth/me` answers each session as its own user (the S7 item). `plex-login` says
to run the rotation when it saves a token in place of another. The nightly Plex test
rotates to Plex's own server token, the same account's (probe 5).

**Files:**
- Modify: `packages/engine/src/plan/plan.ts`, `packages/engine/src/plan/bootstrap.ts`, `packages/engine/src/apply/bootstrap.ts`, `packages/engine/src/catalog/types.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/history/records.ts`, `catalog/seerr/bootstrap.ts`, `packages/cli/src/run.ts`, `packages/cli/src/output.ts`, `packages/cli/src/plex-login.ts`, `packages/engine/src/testing/seerr.ts`, `docs/reference/cli.md` (generated)
- Test: `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/integrations/wiring.test.ts`, `catalog/seerr/bootstrap.test.ts`, `packages/cli/src/run.test.ts`, `packages/cli/src/plex-login.test.ts`, `test/e2e/plex.e2e.test.ts`

**Interfaces:**
- **Consumes:** `ROTATABLE`, `rotation`, `examine`'s `fresh` (S10a); `Bootstrap.run`, `seerrPlexBootstrap`'s ownership check (S7).
- **Produces:**
  - `PLEX_TOKEN_PATH` (`'plex.token'`); `ROTATABLE` is `['admin.password', 'plex.token']`; the error `rotate.no-plex` on a stack without Plex.
  - `PlanWiringOptions.rotated?` / `ExamineOptions.rotated?: readonly string[]` (the values you rotated), with the verdict `you rotated it: apply gives the app the new one`.
  - `Bootstrap.signsInWith?: readonly string[]`; `BootstrapContext.again?: boolean`; `BootstrapChange.again?: boolean` (in `mediaplane.plan/v1` and, optional, `mediaplane.change/v1`); the setup's detail `signed in again to <apps>`.
  - `seerrPlexBootstrap.signsInWith: ['plex.token']`.

- [ ] **Step 1: Write the failing tests**

The fake Seerr answers each session as its own user.

**Change** `packages/engine/src/testing/seerr.ts`:

````diff
diff --git a/packages/engine/src/testing/seerr.ts b/packages/engine/src/testing/seerr.ts
index 4889f01..a5c1df5 100644
--- a/packages/engine/src/testing/seerr.ts
+++ b/packages/engine/src/testing/seerr.ts
@@ -330,3 +330,6 @@ function answer(
   if (path === '/api/v1/auth/me' && method === 'GET') {
-    const plexId = seerr.plexUsers[0];
+    // The key acts as its admin; a session, as whoever signed in, with that user's own
+    // Jellyfin login and plex.tv account.
+    const id = keyed ? 1 : (seerr.sessionIds[cookie ?? ''] ?? 1);
+    const plexId = seerr.plexUsers[id - 1];
     return {
@@ -334,5 +337,4 @@ function answer(
       body: {
-        // The key acts as its admin; a session, as whoever signed in.
-        id: keyed ? 1 : (seerr.sessionIds[cookie ?? ''] ?? 1),
-        jellyfinUsername: seerr.users[0] ?? null,
+        id,
+        jellyfinUsername: seerr.users[id - 1] ?? null,
         plexId: plexId ?? null,
````

**Change** `packages/engine/src/plan/plan.test.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 1b6a0c5..ab2c68e 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -1501,3 +1501,3 @@ describe('plan: rotating the admin password', () => {
       'rotate.unknown',
-      "Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password",
+      "Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password, plex.token",
     ]);
````

**Change** `packages/engine/src/integrations/wiring.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 4e60c71..97c7e5e 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -1776,2 +1776,21 @@ describe('planWiring: what drift adds (spec §6.3)', () => {
 
+  it('takes a secret you rotated as a change, unchecked: the old one the app holds still passes', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, { known: RECORDED, rotated: [PASSWORD] }),
+    );
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
+    ]);
+    expect(planned.checks).toEqual([
+      {
+        resource: 'sonarr.login',
+        secret: 'password',
+        verdict: 'unchecked',
+        reason: 'you rotated it: apply gives the app the new one',
+      },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
+  });
+
   it('gives in place of a secret the app made itself, unchecked, the first time it records the resource', async () => {
````

**Change** `catalog/seerr/bootstrap.test.ts`:

````diff
diff --git a/catalog/seerr/bootstrap.test.ts b/catalog/seerr/bootstrap.test.ts
index c8d58d7..025e103 100644
--- a/catalog/seerr/bootstrap.test.ts
+++ b/catalog/seerr/bootstrap.test.ts
@@ -738,2 +738,50 @@ describe("Seerr's first-run setup, with Plex", () => {
 
+  it('signs in again with your new token, once Seerr is shown to be yours, and Seerr keeps it as its admin', async () => {
+    const renewed = 'fake-plex-token-0002';
+    const { api, state, calls, ctx, stack, plexTv } = await plexSeerrOf(SIGNED_IN);
+    plexTv.state.accounts.push({ id: FAKE_PLEX_ACCOUNT.id, token: renewed });
+    const again: BootstrapContext = {
+      ...ctx,
+      given: { plex: { token: renewed } },
+      again: true,
+    };
+    expect(seerrBootstrap.signsInWith).toEqual(['plex.token']);
+    expect(await seerrBootstrap.run(api, ADMIN, stack, again)).toBeUndefined();
+    expect(state.seerr.plexTokens[FAKE_PLEX_ACCOUNT.id]).toBe(renewed);
+    expect(state.seerr.sessions).toEqual([]);
+    // Asked whose it is first, with its key; then signed in, as its admin, and out.
+    expect(calls().slice(-5)).toEqual([
+      'GET /api/v1/auth/me',
+      'GET /api/v1/settings/plex',
+      'POST /api/v1/auth/plex',
+      'GET /api/v1/auth/me',
+      'POST /api/v1/auth/logout',
+    ]);
+    // Without `again`, it signs in to nothing.
+    const before = calls().length;
+    expect(await seerrBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
+    expect(calls().slice(before)).not.toContain('POST /api/v1/auth/plex');
+  });
+
+  it("says Seerr keeps the old token when it can't check the new one at plex.tv", async () => {
+    const renewed = 'fake-plex-token-0002';
+    const { api, state, ctx, stack, plexTv } = await plexSeerrOf(SIGNED_IN);
+    plexTv.state.accounts.push({ id: FAKE_PLEX_ACCOUNT.id, token: renewed });
+    // Seerr's own call to plex.tv fails: plex.tv answers Mediaplane, but not Seerr.
+    state.seerr.failing = ['/api/v1/auth/plex'];
+    state.seerr.failStatus = 500;
+    const refused = await thrown(
+      seerrBootstrap.run(api, ADMIN, stack, {
+        ...ctx,
+        given: { plex: { token: renewed } },
+        again: true,
+      }),
+    );
+    expect(refused).toMatchObject({ kind: 'rejected' });
+    expect((refused as Error).message).toContain(
+      "couldn't sign in again with your new Plex token, which it checks at plex.tv",
+    );
+    expect(state.seerr.plexTokens[FAKE_PLEX_ACCOUNT.id]).toBe(TOKEN);
+  });
+
   it('refuses a Seerr set up with another plex.tv account, or another Plex, as claimed', async () => {
````

**Change** `packages/cli/src/run.test.ts`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index c40bcea..cf800b6 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -434,3 +434,4 @@ describe('mediaplane plan', () => {
           code: 'rotate.unknown',
-          message: "Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password",
+          message:
+            "Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password, plex.token",
         },
@@ -447,3 +448,3 @@ describe('mediaplane plan', () => {
     expect(refused.stderr()).toContain(
-      "error: Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password",
+      "error: Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password, plex.token",
     );
@@ -1721,2 +1722,108 @@ apps:
 
+  it('gives your new Plex token to the arrs, and signs Seerr in again with it, under --rotate plex.token', async () => {
+    const { home, docker } = await plexHome();
+    await writeFile(join(home, 'stack.yaml'), `${PLEX_STACK}  seerr: {}\n`);
+    const seerr = freshAppState();
+    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
+    apis.apps.set('seerr', seerr);
+    expect(
+      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
+    ).toBe(0);
+    // A new token of your account, as plex-login --force saves it; the old one works too.
+    const renewed = 'fake-plex-token-0002';
+    plexTv.state.accounts.push({ id: FAKE_PLEX_ACCOUNT.id, token: renewed });
+    await writeFile(join(home, 'secrets', 'plex-token'), `${renewed}\n`);
+    const quiet = capture();
+    expect(await run(['plan', '--home', home], quiet.io, deps(docker))).toBe(0);
+    const shown = capture();
+    expect(
+      await run(
+        ['plan', '--home', home, '--rotate', 'plex.token', '--json'],
+        shown.io,
+        deps(docker),
+      ),
+    ).toBe(2);
+    const planned = JSON.parse(shown.stdout()) as {
+      wiring: { resource: string; action: string }[];
+      bootstrap: unknown[];
+    };
+    expect(planned.wiring.filter((w) => w.action !== 'unchanged')).toEqual([
+      { resource: 'sonarr.connection_plex', action: 'update', changes: ['authToken'] },
+    ]);
+    expect(planned.bootstrap).toEqual([
+      { app: 'seerr', unpublished: false, again: true },
+    ]);
+    const applied = capture();
+    expect(
+      await run(
+        ['apply', '--home', home, '--yes', '--rotate', 'plex.token'],
+        applied.io,
+        deps(docker),
+      ),
+    ).toBe(0);
+    expect(applied.stdout()).toContain(
+      '  done    first-run setup: signed in again to seerr\n',
+    );
+    expect(applied.stdout()).toContain(
+      '  done    wiring sonarr.connection_plex: updated authToken\n',
+    );
+    expect(apis.apps.get('sonarr')?.connections[0]?.fields).toContainEqual({
+      name: 'authToken',
+      value: renewed,
+    });
+    expect(seerr.seerr.plexTokens[FAKE_PLEX_ACCOUNT.id]).toBe(renewed);
+    expect(seerr.seerr.sessions).toEqual([]);
+    expect((await readSecretStore(home)).setUp).toEqual(['plex', 'seerr']);
+    expectNoSecrets(applied.stdout() + applied.stderr(), [...plexSecrets(), renewed]);
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+  });
+
+  it("gives no app a new Plex token of another account, which Plex refuses, and Seerr's stays its own", async () => {
+    const { home, docker } = await plexHome();
+    await writeFile(join(home, 'stack.yaml'), `${PLEX_STACK}  seerr: {}\n`);
+    const seerr = freshAppState();
+    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
+    apis.apps.set('seerr', seerr);
+    expect(
+      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
+    ).toBe(0);
+    const other = 'fake-plex-token-0003';
+    plexTv.state.accounts.push({ id: 7_000_002, token: other });
+    await writeFile(join(home, 'secrets', 'plex-token'), `${other}\n`);
+    const applied = capture();
+    expect(
+      await run(
+        ['apply', '--home', home, '--yes', '--rotate', 'plex.token'],
+        applied.io,
+        deps(docker),
+      ),
+    ).toBe(1);
+    expect(applied.stdout() + applied.stderr()).toContain(
+      'was set up with another plex.tv account or another Plex',
+    );
+    // Sonarr's connection and Seerr keep the token that works; Seerr stays recorded.
+    expect(apis.apps.get('sonarr')?.connections[0]?.fields).toContainEqual({
+      name: 'authToken',
+      value: FAKE_PLEX_ACCOUNT.token,
+    });
+    expect(seerr.seerr.plexTokens[FAKE_PLEX_ACCOUNT.id]).toBe(FAKE_PLEX_ACCOUNT.token);
+    expect((await readSecretStore(home)).setUp).toEqual(['plex', 'seerr']);
+  });
+
+  it('refuses --rotate plex.token on a stack with no Plex', async () => {
+    const home = await makeHome();
+    const term = capture();
+    expect(
+      await run(
+        ['plan', '--home', home, '--rotate', 'plex.token'],
+        term.io,
+        deps(fakeDocker(home)),
+      ),
+    ).toBe(1);
+    expect(term.stderr()).toContain(
+      "error: plex.token is rotated only in a stack with Plex, which this one doesn't run\n",
+    );
+  });
+
   it('starts nothing when plex.tv refuses your token, and says to sign in again', async () => {
````

**Change** `packages/cli/src/plex-login.test.ts`:

````diff
diff --git a/packages/cli/src/plex-login.test.ts b/packages/cli/src/plex-login.test.ts
index 23a8302..0184775 100644
--- a/packages/cli/src/plex-login.test.ts
+++ b/packages/cli/src/plex-login.test.ts
@@ -124,2 +124,7 @@ describe('mediaplane plex-login', () => {
     expect(forced.said).not.toContain('new-plex-token');
+    // In place of a token: the apps that hold the old one get the new one by a rotation.
+    const again = await login(home, plexTv.client, ['--force']);
+    expect(again.stdout).toContain(
+      'Signed in. Saved your Plex token in secrets/plex-token. Next: run "mediaplane apply --rotate plex.token", which gives it to the apps that hold the old one, then you can sign the old one out at plex.tv.\n',
+    );
   });
````

The nightly Plex test rotates the token.

**Change** `test/e2e/plex.e2e.test.ts`:

````diff
diff --git a/test/e2e/plex.e2e.test.ts b/test/e2e/plex.e2e.test.ts
index afa3090..1de553a 100644
--- a/test/e2e/plex.e2e.test.ts
+++ b/test/e2e/plex.e2e.test.ts
@@ -2,2 +2,3 @@ import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
 import { join } from 'node:path';
+import { DatabaseSync } from 'node:sqlite';
 import { catalog } from '@mediaplane/catalog';
@@ -554,2 +555,39 @@ describe.skipIf(PLEX_TOKEN_FILE === undefined)(
         expect(claims.length, 'no claim token asked for by the second apply').toBe(1);
+
+        // A new token of your account, as plex-login --force saves one: Plex's own is a
+        // token of your account too, as plex.tv said above. --rotate plex.token gives it
+        // to both arrs, and signs Seerr in again with it (Slice 10b).
+        await saveToken(home, serverToken);
+        const rotated = await apply({ ...options, rotate: ['plex.token'] });
+        expect(rotated.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
+        expect(rotated.outcome).toBe('success');
+        expect(rotated.plan.bootstrap).toEqual([
+          { app: 'seerr', unpublished: false, again: true },
+        ]);
+        expect(rotated.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+          'signed in again to seerr',
+        );
+        expect(
+          wired(rotated.actions).filter(([, detail]) => detail !== 'unchanged'),
+        ).toEqual([
+          ['radarr.connection_plex', 'updated authToken'],
+          ['sonarr.connection_plex', 'updated authToken'],
+        ]);
+        // Seerr keeps its admin's token in its own database, which its API never shows:
+        // read there, read-only, and compared as yes or no.
+        const seerrDb = new DatabaseSync(join(home, 'appdata/seerr/db/db.sqlite3'), {
+          readOnly: true,
+        });
+        try {
+          const row = seerrDb.prepare('SELECT plexToken FROM user WHERE id = 1').get();
+          expect(row?.plexToken === serverToken, 'Seerr holds the new token').toBe(true);
+        } finally {
+          seerrDb.close();
+        }
+        expectNoSecret("the rotation's result", JSON.stringify(rotated), [
+          ...secrets,
+          ...claims,
+        ]);
+        expect((await apply(options)).outcome).toBe('no-changes');
+        await saveToken(home, token);
       } catch (failure) {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/plan/plan.test.ts packages/engine/src/integrations/wiring.test.ts catalog/seerr/bootstrap.test.ts packages/cli/src/run.test.ts packages/cli/src/plex-login.test.ts`

Expected: FAIL: 9 tests in 5 files (300 run). `plan.test.ts` and `run.test.ts` refuse `--rotate plex.token` (`Mediaplane doesn't rotate plex.token`); `wiring.test.ts` checks a rotated secret where it expects it unchecked; `seerr/bootstrap.test.ts` finds no `signsInWith`, and Seerr never signs in again; `plex-login.test.ts` doesn't say to run the rotation.

- [ ] **Step 3: Implement**

The contract: what a setup signs in with, and a setup run again.

**Change** `packages/engine/src/catalog/types.ts`:

````diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index fd40946..58dc4bd 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -180,2 +180,7 @@ export interface BootstrapContext {
   plexTv: PlexTv;
+  /**
+   * The setup is done, and signs in again with what you gave anew (`--rotate plex.token`:
+   * Seerr, with your new Plex token), once it has shown the app is Mediaplane's.
+   */
+  again?: boolean;
 }
@@ -204,2 +209,9 @@ export interface Bootstrap {
   open(api: AppApi): Promise<boolean>;
+  /**
+   * The secrets you give that the setup signs in with, by their path in stack.yaml
+   * (`plex.token`, Seerr's on a Plex stack): rotating one (`--rotate`) has the setup, done
+   * already, run again, published, with `again` (BootstrapContext), so that the app takes
+   * the new one. The app keeps the one it signed in with, and can't be asked which.
+   */
+  signsInWith?: readonly string[];
   /**
````

**Change** `packages/engine/src/plan/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/plan/bootstrap.ts b/packages/engine/src/plan/bootstrap.ts
index 33e3697..6ab21f8 100644
--- a/packages/engine/src/plan/bootstrap.ts
+++ b/packages/engine/src/plan/bootstrap.ts
@@ -16,2 +16,7 @@ export interface BootstrapChange {
   unpublished: boolean;
+  /**
+   * Its setup is done, and it signs in again, published, with what you gave anew
+   * (`--rotate plex.token`: Seerr, with your new Plex token). Added in Slice 10b.
+   */
+  again?: boolean;
 }
````

**Change** `packages/engine/src/history/records.ts`:

````diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index ed48e89..b231213 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -98,5 +98,14 @@ const recordShape = (object: typeof z.strictObject) =>
         .optional(),
-      /** The apps whose first-run setup the plan said apply would finish. Added in Slice 5. */
+      /**
+       * The apps whose first-run setup the plan said apply would finish. Added in Slice 5;
+       * `again`, a setup done that signs in again (--rotate plex.token), in Slice 10b.
+       */
       bootstrap: z
-        .array(object({ app: z.string(), unpublished: z.boolean() }))
+        .array(
+          object({
+            app: z.string(),
+            unpublished: z.boolean(),
+            again: z.boolean().optional(),
+          }),
+        )
         .optional(),
````

The rotation in the plan, and the verdict.

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 292b8cd..d704627 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -102,4 +102,6 @@ export interface PlanOptions {
   /**
-   * The secrets Mediaplane generated to generate anew, and set in every app that holds them
-   * (ROTATABLE): `admin.password`, unless it is yours.
+   * The secrets to rotate, and set in every app that holds them (ROTATABLE):
+   * `admin.password`, which Mediaplane generates anew, unless it is yours; `plex.token`,
+   * the new token you put in its file (`plex-login --force`), which the arrs' connections
+   * to Plex are given, and Seerr signs in again with.
    */
@@ -108,4 +110,7 @@ export interface PlanOptions {
 
+/** Your Plex token, as stack.yaml names it (`plex.token`). */
+export const PLEX_TOKEN_PATH = 'plex.token';
+
 /** The secrets `rotate` takes. */
-export const ROTATABLE: readonly string[] = [ADMIN_PASSWORD_PATH];
+export const ROTATABLE: readonly string[] = [ADMIN_PASSWORD_PATH, PLEX_TOKEN_PATH];
 
@@ -384,2 +389,7 @@ export async function planStack(
   const secrets = knownSecrets(values, preview, admin, given);
+  // Your new Plex token, under --rotate plex.token: each resource that holds it is given
+  // it, unchecked, as the apps hold the old one, which still works.
+  const newToken = rotating.plexToken
+    ? [given.plex?.token ?? ''].filter((value) => value !== '')
+    : [];
   // Keep mine's values (spec §6.3): an override that names nothing Mediaplane manages,
@@ -436,2 +446,3 @@ export async function planStack(
         ...(setups.ask === undefined ? {} : { ask: setups.ask }),
+        ...(newToken.length === 0 ? {} : { rotated: newToken }),
       });
@@ -464,2 +475,15 @@ export async function planStack(
   }
+  // A setup that signs in with what you rotate signs in again, published, once it is shown
+  // to be Mediaplane's: Seerr keeps the Plex token it signed in with (spec §6.1), and
+  // can't be asked which, so it takes the new one only so.
+  const again = stack.apps.filter(
+    (app) =>
+      (options.rotate ?? []).some((name) =>
+        (app.def.bootstrap?.signsInWith ?? []).includes(name),
+      ) && ![...bootstrap, ...held].some((b) => b.app === app.def.id),
+  );
+  bootstrap = [
+    ...bootstrap,
+    ...again.map((app) => ({ app: app.def.id, unpublished: false, again: true })),
+  ];
   // An app whose appdata can't say whether its setup is done, asked itself: set up again,
@@ -471,3 +495,7 @@ export async function planStack(
       reopened.some((app) => resource === app || resource.startsWith(`${app}.`));
-    bootstrap = [...bootstrap, ...reopened.map((app) => ({ app, unpublished: true }))];
+    // Set up afresh, unpublished: its sign-in again, if it had one, is that setup's.
+    bootstrap = [
+      ...bootstrap.filter((b) => !reopened.includes(b.app)),
+      ...reopened.map((app) => ({ app, unpublished: true })),
+    ];
     containers = containers.map((change) =>
@@ -555,3 +583,3 @@ function rotation(
   stack: ResolvedStack,
-): { password: boolean; diagnostics: Diagnostic[] } {
+): { password: boolean; plexToken: boolean; diagnostics: Diagnostic[] } {
   const diagnostics = rotate.flatMap((name) => {
@@ -565,2 +593,13 @@ function rotation(
     }
+    // Yours, always: you put the new one in its file, and apply gives it to the apps.
+    if (name === PLEX_TOKEN_PATH) {
+      return stack.apps.some((app) => app.def.id === 'plex')
+        ? []
+        : [
+            error(
+              'rotate.no-plex',
+              `${name} is rotated only in a stack with Plex, which this one doesn't run`,
+            ),
+          ];
+    }
     return stack.config.admin.password === undefined
@@ -577,3 +616,7 @@ function rotation(
   });
-  return { password: rotate.includes(ADMIN_PASSWORD_PATH), diagnostics };
+  return {
+    password: rotate.includes(ADMIN_PASSWORD_PATH),
+    plexToken: rotate.includes(PLEX_TOKEN_PATH),
+    diagnostics,
+  };
 }
````

**Change** `packages/engine/src/integrations/wiring.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index d5ad3a6..664848b 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -412,2 +412,8 @@ export interface ExamineOptions {
   lacks?: readonly string[];
+  /**
+   * The values of the secrets you rotated (`--rotate plex.token`: your new Plex token). As
+   * `fresh`: a change, which apply sets, and isn't checked, since the old one, which the
+   * app holds, still passes its check.
+   */
+  rotated?: readonly string[];
 }
@@ -438,2 +444,8 @@ const LACKED: Verdict = {
 
+/** Why a secret you rotated isn't checked. */
+const ROTATED: Verdict = {
+  verdict: 'unchecked',
+  reason: 'you rotated it: apply gives the app the new one',
+};
+
 /** Why a secret the app made itself at its first-run setup isn't checked. */
@@ -555,2 +567,6 @@ export async function examine(
     if ((options.fresh ?? []).includes(value)) return FRESH;
+    // Never one the key's own app refuses (`blocked`): Plex, a token of another account.
+    if ((options.rotated ?? []).includes(value) && options.blocked === undefined) {
+      return ROTATED;
+    }
     return (options.lacks ?? []).includes(value) ? LACKED : undefined;
@@ -828,2 +844,4 @@ export interface PlanWiringOptions {
   fresh?: readonly string[];
+  /** The values of the secrets you rotated (ExamineOptions.rotated). */
+  rotated?: readonly string[];
   /** By app, the values it has never had (ExamineOptions.lacks). */
@@ -1023,2 +1041,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
           ...(options.fresh === undefined ? {} : { fresh: options.fresh }),
+          ...(options.rotated === undefined ? {} : { rotated: options.rotated }),
           ...(options.lacking?.[app.def.id] === undefined
````

Apply's bootstrap step, and Seerr's setup.

**Change** `packages/engine/src/apply/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/apply/bootstrap.ts b/packages/engine/src/apply/bootstrap.ts
index b33a692..fa5388d 100644
--- a/packages/engine/src/apply/bootstrap.ts
+++ b/packages/engine/src/apply/bootstrap.ts
@@ -166,6 +166,9 @@ export async function bootstrapApps(options: BootstrapOptions): Promise<Bootstra
   // before the app is set up again, and made again only when the setup succeeds, so an
-  // app claimed meanwhile isn't taken as Mediaplane's by the next plan.
+  // app claimed meanwhile isn't taken as Mediaplane's by the next plan. One that only
+  // signs in again (`again`) is done, and stays recorded whatever its sign-in does.
   const stale = apps.filter(
     (app) =>
-      app.def.bootstrap?.secret === undefined && (store.setUp ?? []).includes(app.def.id),
+      app.def.bootstrap?.secret === undefined &&
+      (store.setUp ?? []).includes(app.def.id) &&
+      options.pending.find((p) => p.app === app.def.id)?.again !== true,
   );
@@ -240,3 +243,3 @@ export async function bootstrapApps(options: BootstrapOptions): Promise<Bootstra
             stack,
-            ctx,
+            ctx: change?.again === true ? { ...ctx, again: true } : ctx,
           })
@@ -325,3 +328,7 @@ export async function bootstrapApps(options: BootstrapOptions): Promise<Bootstra
   const waits = waiting.map((w) => `${w.app} waits: ${w.reason}`);
-  const finished = apps.filter((app) => !unfinished.includes(app)).map((a) => a.def.id);
+  const done = apps.filter((app) => !unfinished.includes(app)).map((a) => a.def.id);
+  const signedInAgain = (id: string) =>
+    options.pending.some((p) => p.app === id && p.again === true);
+  const finished = done.filter((id) => !signedInAgain(id));
+  const again = done.filter(signedInAgain);
   const published = unpublished.filter((app) => !stillOpen.includes(app));
@@ -332,2 +339,3 @@ export async function bootstrapApps(options: BootstrapOptions): Promise<Bootstra
       ...(finished.length === 0 ? [] : [`set up ${finished.join(', ')}${keys}`]),
+      ...(again.length === 0 ? [] : [`signed in again to ${again.join(', ')}`]),
       ...(published.length === 0 ? [] : [`published ${published.join(', ')}`]),
````

**Change** `catalog/seerr/bootstrap.ts`:

````diff
diff --git a/catalog/seerr/bootstrap.ts b/catalog/seerr/bootstrap.ts
index c9f8f2b..ca41fff 100644
--- a/catalog/seerr/bootstrap.ts
+++ b/catalog/seerr/bootstrap.ts
@@ -233,2 +233,5 @@ async function runPlex(
     await ownPlexSetup(api, ctx, token, plex);
+    // Yours, as your token's account is its admin: it takes your new token by signing in
+    // with it (probed: the admin's stored token is replaced, and its id stays 1).
+    if (ctx.again === true) await signInAgain(api, token);
     return;
@@ -264,2 +267,34 @@ async function runPlex(
 
+/**
+ * Sign Seerr's admin in again with your Plex token, once Seerr is shown to be yours
+ * (`ownPlexSetup`): Seerr keeps the token its admin last signed in with, and reaches Plex
+ * with it, so a new one reaches it only so (`--rotate plex.token`). The session must be
+ * its admin's, as a first sign-in's must; then it is signed out of. Seerr checks the token
+ * at plex.tv, and answers 500 when it can't.
+ */
+async function signInAgain(api: AppApi, token: string): Promise<void> {
+  let session: AppApi | undefined;
+  try {
+    session = await api.session(PLEX_SIGN_IN, { authToken: token }, 'connect.sid', [
+      token,
+    ]);
+  } catch (cause) {
+    if (cause instanceof AppApiError && cause.status === 500) {
+      throw new AppApiError(
+        `${api.name} at ${api.where} couldn't sign in again with your new Plex token, which it checks at plex.tv: ${cause.message}. It still holds the old one; check that Seerr reaches plex.tv, then run apply --rotate plex.token again`,
+        { kind: 'rejected' },
+      );
+    }
+    throw cause;
+  }
+  if (session === undefined) {
+    throw new AppApiError(
+      `${api.name} at ${api.where} refused the sign-in with your new Plex token (POST ${PLEX_SIGN_IN})`,
+      { kind: 'rejected' },
+    );
+  }
+  await requireAdmin(api, session);
+  await signOut(session);
+}
+
 /**
@@ -317,2 +352,4 @@ export const seerrBootstrap: Bootstrap = {
   open,
+  // On a Plex stack, with your token: rotated, Seerr signs in again with the new one.
+  signsInWith: ['plex.token'],
   claimedHint,
````

The CLI.

**Change** `packages/cli/src/run.ts`:

````diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 83cce18..9138efb 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -248,3 +248,3 @@ export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
 const ROTATE_HELP =
-  'generate a secret Mediaplane generated anew, and set it in every app that holds it: admin.password (not one of your own)';
+  'set a secret anew in every app that holds it: admin.password, which Mediaplane generates anew (not one of your own), or plex.token, the new token in its file';
 
````

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index c582b5c..df086f2 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -205,6 +205,8 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     io.stdout('First-run setup:\n');
-    for (const { app, unpublished } of result.bootstrap) {
+    for (const { app, unpublished, again } of result.bootstrap) {
       const how = unpublished
         ? 'with no port published until it is done'
-        : 'signing in as the admin, to make its key';
+        : again === true
+          ? 'signing in again, with what you rotated'
+          : 'signing in as the admin, to make its key';
       io.stdout(`  + ${app} (${how})\n`);
````

**Change** `packages/cli/src/plex-login.ts`:

````diff
diff --git a/packages/cli/src/plex-login.ts b/packages/cli/src/plex-login.ts
index b1acbde..c58e2c2 100644
--- a/packages/cli/src/plex-login.ts
+++ b/packages/cli/src/plex-login.ts
@@ -123,2 +123,10 @@ export async function plexLogin(
     await writeFileAtomic(path, `${token}\n`, 0o600);
+    // A token in place of another: Sonarr, Radarr and Seerr hold the old one, which only
+    // a rotation gives them the new one in place of.
+    const next =
+      options.fromInit === true
+        ? ''
+        : saved === undefined
+          ? ' Next: run "mediaplane apply".'
+          : ' Next: run "mediaplane apply --rotate plex.token", which gives it to the apps that hold the old one, then you can sign the old one out at plex.tv.';
     report(options, io, {
@@ -127,3 +135,3 @@ export async function plexLogin(
       replaced: existing !== undefined,
-      said: `Signed in. Saved your Plex token in ${shown}.${options.fromInit === true ? '' : ' Next: run "mediaplane apply".'}`,
+      said: `Signed in. Saved your Plex token in ${shown}.${next}`,
     });
````

- [ ] **Step 4: Regenerate the CLI reference**

Run: `pnpm docs:generate`
Expected: it rewrites `docs/reference/cli.md`, whose `--rotate` now names `plex.token`.

- [ ] **Step 5: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/plan/plan.test.ts packages/engine/src/integrations/wiring.test.ts catalog/seerr/bootstrap.test.ts packages/cli/src/run.test.ts packages/cli/src/plex-login.test.ts`
Expected: PASS. The nightly test needs a plex.tv account's token: it runs in Task 7's
Step 5.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine,catalog): give your new Plex token to the arrs and Seerr with --rotate plex.token" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: A Plex signed out of its account while it ran, claimed again

Decision 11. A Plex signed out (its web UI's sign-out) is unclaimed at once, still
published, and its image never claims it again (probe 6). `plan` warns while an app whose
setup is to be done runs published (`bootstrap.open-published`); `apply` starts Plex
unpublished, as before, and Plex's setup now claims it itself, through its API, while
unclaimed: a claim token from plex.tv, posted to Plex over the wiring network, to its
address (`submit`'s `byAddress`), since Plex refuses a claim sent to its name. The fake
Plex signs out, keeps `PlexOnlineToken=""`, and refuses a claim sent to a name, as Plex
did; the fake Docker publishes ports as Compose says.

**Files:**
- Modify: `catalog/plex/bootstrap.ts`, `packages/engine/src/http/client.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/testing/{fakes,plex,wiring}.ts`
- Test: `catalog/plex/bootstrap.test.ts`, `packages/engine/src/http/client.test.ts`, `packages/cli/src/run.test.ts`, `test/e2e/plex.e2e.test.ts`

**Interfaces:**
- **Consumes:** `plexBootstrap`, `plexTv.claimToken`, `BootstrapContext.addSecret` (S7); `planBootstrap` (Task 5).
- **Produces:**
  - `AppApi.submit(method, path, body?, how?: { byAddress?: boolean })`: with `byAddress`, `Host` is the address and port Mediaplane reaches the app at, not its name.
  - The warning `bootstrap.open-published` (`<App> runs published, though its first-run setup isn't shown to be done: …`).
  - Plex's setup error `was signed out of its plex.tv account, and Mediaplane couldn't get a claim token from plex.tv to claim it again, so it stays unpublished`.
  - Fakes: `FakePlex.signedOut`, `signOutFakePlex(plex)`, the fake Plex's `POST /myplex/claim` and `DELETE /myplex/account`; the fake Docker's containers' `published` ports.

- [ ] **Step 1: Write the failing tests**

The fakes first: a Plex signed out, as Plex answered (probe 6).

**Change** `packages/engine/src/testing/plex.ts`:

````diff
diff --git a/packages/engine/src/testing/plex.ts b/packages/engine/src/testing/plex.ts
index 1aa35cb..1bd3a2e 100644
--- a/packages/engine/src/testing/plex.ts
+++ b/packages/engine/src/testing/plex.ts
@@ -73,2 +73,8 @@ export interface FakePlex {
   configDir?: string;
+  /**
+   * Signed out of its plex.tv account while it ran (`DELETE /myplex/account`, as its web
+   * UI's sign-out does): unclaimed, with `PlexOnlineToken=""` in its Preferences.xml, which
+   * the image's own claim step takes for a claim, so a PLEX_CLAIM is never used (probed).
+   */
+  signedOut?: boolean;
 }
@@ -122,3 +128,8 @@ function keepPreferences(plex: FakePlex): void {
   mkdirSync(dirname(path), { recursive: true });
-  const token = plex.serverToken === '' ? '' : ` PlexOnlineToken="${plex.serverToken}"`;
+  const token =
+    plex.serverToken !== ''
+      ? ` PlexOnlineToken="${plex.serverToken}"`
+      : plex.signedOut === true
+        ? ' PlexOnlineToken=""'
+        : '';
   writeFileSync(
@@ -140,2 +151,27 @@ export function claimFakePlex(
   plexTv: FakePlexTvState,
+): boolean {
+  // The image's step looks for PlexOnlineToken's name: signed out, it skips the claim.
+  if (plex.signedOut === true) return false;
+  return claimWith(plex, claim, plexTv);
+}
+
+/**
+ * The fake Plex signed out of its plex.tv account while it runs, as its web UI's sign-out
+ * does (`DELETE /myplex/account`): unclaimed at once, and Preferences.xml rewritten with
+ * `PlexOnlineToken=""` (probed).
+ */
+export function signOutFakePlex(plex: FakePlex): void {
+  Object.assign(plex, { owner: null, serverToken: '', signedOut: true });
+  keepPreferences(plex);
+}
+
+/**
+ * A claim of the fake Plex for the account that asked plex.tv for `claim`, as Plex makes
+ * it, from the image's step or from `POST /myplex/claim`: a token plex.tv doesn't know, or
+ * one used already, or a Plex claimed already, claims nothing.
+ */
+function claimWith(
+  plex: FakePlex,
+  claim: string | undefined,
+  plexTv: FakePlexTvState,
 ): boolean {
@@ -144,4 +180,7 @@ export function claimFakePlex(
   known.used = true;
+  plex.signedOut = false;
   plex.owner = known.account;
   plex.serverToken = `fake-server-token-${String(plexTv.servers.length + 1).padStart(2, '0')}`;
+  // Claimed again, it is the same server to plex.tv, with a new token.
+  plexTv.servers = plexTv.servers.filter((s) => s.machineId !== plex.machineId);
   plexTv.servers.push({
@@ -268,3 +307,17 @@ export function fakePlex(
   }
+  // Unclaimed, it is claimed by anyone who posts a claim token of their account to its
+  // address (probed: 200; to a name, its DNS-rebinding check refuses it, 401). One that
+  // claims nothing is refused (any refusal will do: not probed).
+  if (url.pathname === '/myplex/claim' && method === 'POST' && plex.owner === null) {
+    const host = (request.headers.host ?? '').split(':')[0] ?? '';
+    if (!/^\d+(\.\d+){3}$/.test(host)) return UNAUTHORIZED;
+    return claimWith(plex, query('token'), plexTv)
+      ? { status: 200, body: { MyPlex: { signInState: 'ok' } } }
+      : BAD_REQUEST;
+  }
   if (!plexTakes(plex, request.headers['x-plex-token'], plexTv)) return UNAUTHORIZED;
+  if (url.pathname === '/myplex/account' && method === 'DELETE') {
+    signOutFakePlex(plex);
+    return { status: 200, body: { MyPlex: { signInState: 'none' } } };
+  }
   if (url.pathname === '/' && method === 'GET') {
````

**Change** `packages/engine/src/testing/wiring.ts`:

````diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index cbc153b..8ad8238 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -427,3 +427,5 @@ export async function fakeStackApis(plexTv: FakePlexTvState = freshPlexTv()): Pr
     const host = (headers.host ?? '').split(':')[0] ?? '';
-    const service = host === 'gluetun' ? 'qbittorrent' : host;
+    // Every fake app is at one address: a Plex claim, which goes to an address, is Plex's.
+    const byAddress = /^\d+(\.\d+){3}$/.test(host) && path.startsWith('/myplex/claim');
+    const service = host === 'gluetun' ? 'qbittorrent' : byAddress ? 'plex' : host;
     const state = stateOf(service);
````

**Change** `packages/engine/src/testing/fakes.ts`:

````diff
diff --git a/packages/engine/src/testing/fakes.ts b/packages/engine/src/testing/fakes.ts
index 76d2dd8..0a94c43 100644
--- a/packages/engine/src/testing/fakes.ts
+++ b/packages/engine/src/testing/fakes.ts
@@ -321,3 +321,15 @@ export function fakeDocker(
       const env = parseEnvFile(await readFile(join(home, ENV_PATH), 'utf8'));
-      containers = running(fakeHash(stringify(compose), env));
+      // Each publishing its ports, as compose.yaml's "<address>:<port>:<port>" gives them.
+      containers = running(fakeHash(stringify(compose), env)).map((container) => ({
+        ...container,
+        published: (
+          (compose.services[container.service]?.ports as unknown[] | undefined) ?? []
+        )
+          .map((port) => /^(.+):(\d+):\d+$/.exec(String(port)))
+          .flatMap((match) =>
+            match === null
+              ? []
+              : [{ address: match[1] ?? '', port: Number(match[2]), protocol: 'tcp' }],
+          ),
+      }));
       return result;
````

**Change** `packages/engine/src/http/client.test.ts`:

````diff
diff --git a/packages/engine/src/http/client.test.ts b/packages/engine/src/http/client.test.ts
index 370f259..5619c4a 100644
--- a/packages/engine/src/http/client.test.ts
+++ b/packages/engine/src/http/client.test.ts
@@ -1269,2 +1269,12 @@ describe("createAppApi: Jellyfin's ways", () => {
 
+  it('sends Host as the address it reaches the app at, when asked, as an unclaimed Plex takes a claim', async () => {
+    const { api, app } = await sonarr(() => ({ status: 200 }));
+    await api.submit('POST', '/myplex/claim?token=x', undefined, { byAddress: true });
+    await api.submit('POST', '/other');
+    expect(app.requests.map((r) => r.headers.host)).toEqual([
+      `127.0.0.1:${String(app.port)}`,
+      'sonarr:8989',
+    ]);
+  });
+
   it('signs in with JSON and without the key: the answer, or nothing when refused, never the password', async () => {
````

**Change** `catalog/plex/bootstrap.test.ts`:

````diff
diff --git a/catalog/plex/bootstrap.test.ts b/catalog/plex/bootstrap.test.ts
index 5b05e38..9be08cf 100644
--- a/catalog/plex/bootstrap.test.ts
+++ b/catalog/plex/bootstrap.test.ts
@@ -487,2 +487,51 @@ describe("Plex's first-run setup", () => {
 
+  it('claims again, through its API, a Plex signed out of your account while it ran, which its image never would', async () => {
+    const { api, state, plexTv, ctx, stack } = await plexOf(60_000);
+    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    // Signed out, as its web UI does: PlexOnlineToken="" in Preferences.xml, which the
+    // image's claim step takes for a claim, so a PLEX_CLAIM goes unused.
+    Object.assign(state.plex, { owner: null, serverToken: '', signedOut: true });
+    // Asked, it says it is open, and keeps its Preferences.xml as signed out.
+    expect(await plexBootstrap.open(api)).toBe(true);
+    expect(
+      claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state),
+    ).toBe(false);
+    expect(await plexBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
+    expect(state.plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
+    expect(state.plex.signedOut).toBe(false);
+    // One claim token more, for your account, used by this claim.
+    expect(plexTv.state.claims.at(-1)).toMatchObject({
+      account: FAKE_PLEX_ACCOUNT.id,
+      used: true,
+    });
+  });
+
+  it('keeps a Plex signed out of your account unpublished when plex.tv gives no claim token, and says what to do', async () => {
+    const { api, state, plexTv, stack } = await plexOf(60_000);
+    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    Object.assign(state.plex, { owner: null, serverToken: '', signedOut: true });
+    // Asked, it says it is open, and keeps its Preferences.xml as signed out.
+    expect(await plexBootstrap.open(api)).toBe(true);
+    const failed = await thrown(
+      plexBootstrap.run(api, ADMIN, stack, {
+        given: { plex: { token: 'revoked-plex-token-0' } },
+        plexTv: plexTv.client,
+      }),
+    );
+    expect(failed).toMatchObject({
+      kind: 'rejected',
+      message:
+        'Plex at http://plex:32400 (127.0.0.1) was signed out of its plex.tv account, and Mediaplane couldn\'t get a claim token from plex.tv to claim it again, so it stays unpublished: plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json). plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again',
+    });
+    expect(state.plex.owner).toBeNull();
+    // plex.tv not answering is unsure, never a refusal.
+    const silent = await thrown(
+      plexBootstrap.run(api, ADMIN, stack, {
+        given: { plex: { token: TOKEN } },
+        plexTv: { ...plexTv.client, claimToken: () => Promise.reject(new Error('down')) },
+      }),
+    );
+    expect(silent).toMatchObject({ kind: 'auth', unsure: true });
+  });
+
   it("keeps a Plex that didn't claim itself unpublished, saying why", async () => {
````

**Change** `packages/cli/src/run.test.ts`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index cf800b6..91ad9ff 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -43,2 +43,3 @@ import {
   SET_UP_JELLYFIN,
+  signOutFakePlex,
   tempDir,
@@ -1813,2 +1814,35 @@ apps:
 
+  it('warns of a Plex signed out of your account while it runs, published, and claims it again before publishing it', async () => {
+    const { home, plex, docker } = await plexHome();
+    expect(
+      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
+    ).toBe(0);
+    const machineId = plex.machineId;
+    // Its web UI's sign-out (DELETE /myplex/account): unclaimed at once, still published.
+    signOutFakePlex(plex);
+    const shown = capture();
+    expect(await run(['plan', '--home', home], shown.io, deps(docker))).toBe(2);
+    expect(shown.stdout()).toContain(
+      '+ plex (with no port published until it is done)\n',
+    );
+    expect(shown.stderr()).toContain(
+      "warning: Plex runs published, though its first-run setup isn't shown to be done: whoever reaches it may finish the setup before Mediaplane does, as anyone can claim a Plex signed out of its plex.tv account\n",
+    );
+    docker.calls.length = 0;
+    const applied = capture();
+    expect(await run(['apply', '--home', home, '--yes'], applied.io, deps(docker))).toBe(
+      0,
+    );
+    // Unpublished first, claimed through its API (its image left PLEX_CLAIM unused),
+    // then published: the same server, yours.
+    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
+      'up unpublished plex with plex.PLEX_CLAIM',
+      'up',
+    ]);
+    expect([plex.owner, plex.machineId]).toEqual([FAKE_PLEX_ACCOUNT.id, machineId]);
+    expectNoSecrets(applied.stdout() + applied.stderr(), plexSecrets());
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+  });
+
   it('refuses --rotate plex.token on a stack with no Plex', async () => {
````

The nightly Plex test signs Plex out, and sees it claimed again.

**Change** `test/e2e/plex.e2e.test.ts`:

````diff
diff --git a/test/e2e/plex.e2e.test.ts b/test/e2e/plex.e2e.test.ts
index 1de553a..d47921f 100644
--- a/test/e2e/plex.e2e.test.ts
+++ b/test/e2e/plex.e2e.test.ts
@@ -592,2 +592,39 @@ describe.skipIf(PLEX_TOKEN_FILE === undefined)(
         await saveToken(home, token);
+
+        // Signed out of your account while it runs, as its web UI's sign-out does: Plex
+        // is unclaimed at once, and still published. plan says so; apply starts it
+        // unpublished, claims it again through its API (its image never would: its
+        // Preferences.xml keeps an empty PlexOnlineToken), and publishes it (Slice 10b).
+        const out = await api(
+          PLEX,
+          '/myplex/account',
+          { Accept: 'application/json', 'X-Plex-Token': token },
+          { method: 'DELETE' },
+        );
+        expect(out.status, "Plex's sign-out").toBe(200);
+        const unclaimed = await plan(options);
+        expect(unclaimed.bootstrap).toEqual([{ app: 'plex', unpublished: true }]);
+        expect(unclaimed.diagnostics.map((d) => d.code)).toContain(
+          'bootstrap.open-published',
+        );
+        const reclaimed = await apply(options);
+        expect(reclaimed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
+        expect(reclaimed.outcome).toBe('success');
+        expect(await plexState(docker)).toBe(
+          `ports 127.0.0.1:${String(PLEX)}, claim none, claimed`,
+        );
+        // The same server, its new token your account's again.
+        const after = await preferencesIn(home);
+        mask(after.serverToken);
+        expect(after.machineId === machineId, 'the same server').toBe(true);
+        expect(
+          (await plexTv.accountId(after.serverToken)) === (await plexTv.accountId(token)),
+          'claimed again for your account',
+        ).toBe(true);
+        expectNoSecret("the claim's result", JSON.stringify(reclaimed), [
+          ...secrets,
+          ...claims,
+          after.serverToken,
+        ]);
+        expect((await apply(options)).outcome).toBe('no-changes');
       } catch (failure) {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/http/client.test.ts catalog/plex/bootstrap.test.ts packages/cli/src/run.test.ts`

Expected: FAIL: 4 tests in 3 files (206 run). `client.test.ts` sends `Host` as the app's name where it asks for its address (`expected [ 'sonarr:8989', 'sonarr:8989' ] to deeply equal [ '127.0.0.1:…', 'sonarr:8989' ]`); `plex/bootstrap.test.ts` sees Plex fail to claim itself where it expects a claim through its API; `run.test.ts` gets no `Plex runs published` warning.

- [ ] **Step 3: Implement**

**Change** `packages/engine/src/http/client.ts`:

````diff
diff --git a/packages/engine/src/http/client.ts b/packages/engine/src/http/client.ts
index a34ec63..02578b0 100644
--- a/packages/engine/src/http/client.ts
+++ b/packages/engine/src/http/client.ts
@@ -154,5 +154,12 @@ export interface AppApi {
    * its body isn't read (Jellyfin answers 204). A POST is sent again only when nothing
-   * reached the app; a DELETE, like a GET.
+   * reached the app; a DELETE, like a GET. `byAddress` sends `Host` as the address it
+   * reaches the app at, not its service's name: an unclaimed Plex takes a claim, with no
+   * key, only so (its DNS-rebinding check refuses a name, probed).
    */
-  submit(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void>;
+  submit(
+    method: 'POST' | 'DELETE',
+    path: string,
+    body?: unknown,
+    how?: { byAddress?: boolean },
+  ): Promise<void>;
   /** POST a JSON body with the key, and the JSON answer, checked with `schema`. */
@@ -251,2 +258,4 @@ interface Call {
   anonymous?: boolean;
+  /** With `Host` as the endpoint's address and port, not the service's name. */
+  byAddress?: boolean;
   /** Secrets this call sends, which the options don't list: a sign-in's password. */
@@ -338,3 +347,6 @@ export function createAppApi(options: AppApiOptions): AppApi {
       const headers: Record<string, string> = {
-        Host: host,
+        Host:
+          call.byAddress === true
+            ? `${options.endpoint.host}:${String(options.endpoint.port)}`
+            : host,
         'User-Agent': 'Mediaplane',
@@ -586,5 +598,10 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
-    async submit(method, path, body) {
+    async submit(method, path, body, how = {}) {
       await send(
-        { method, path, ...(body === undefined ? {} : { body: json(body) }) },
+        {
+          method,
+          path,
+          ...(body === undefined ? {} : { body: json(body) }),
+          ...(how.byAddress === true ? { byAddress: true } : {}),
+        },
         method === 'DELETE',
````

**Change** `catalog/plex/bootstrap.ts`:

````diff
diff --git a/catalog/plex/bootstrap.ts b/catalog/plex/bootstrap.ts
index c55195d..f7fc8db 100644
--- a/catalog/plex/bootstrap.ts
+++ b/catalog/plex/bootstrap.ts
@@ -175,2 +175,60 @@ async function accountOf(
 
+/**
+ * A Preferences.xml of a Plex signed out of its plex.tv account while it ran, as its web
+ * UI's sign-out does (`DELETE /myplex/account`, probed): it keeps the attribute, empty.
+ */
+const SIGNED_OUT = /\sPlexOnlineToken=""/;
+
+/**
+ * Whether Plex, in the stack at `home`, was signed out of its account while it ran: the
+ * image's own claim step then never uses PLEX_CLAIM, since it looks only for the
+ * attribute's name (probed: "Server already claimed"). A file that can't be read says
+ * no: the setup's own read of it says why it fails.
+ */
+async function signedOut(home: string): Promise<boolean> {
+  try {
+    return SIGNED_OUT.test(
+      await readFile(join(home, 'appdata', 'plex', PREFERENCES), 'utf8'),
+    );
+  } catch {
+    return false;
+  }
+}
+
+/**
+ * Claim an unclaimed Plex for your account through its own API, as the image's claim step
+ * would: a claim token from plex.tv, with your token, posted to Plex over the wiring
+ * network while it is unpublished (`POST /myplex/claim`, which an unclaimed Plex takes
+ * from anyone, probed: 200). The claim token is a secret of the run; the setup goes on to
+ * check whose Plex is, as after its first start.
+ */
+async function claimAgain(
+  api: AppApi,
+  ctx: BootstrapContext,
+  token: string,
+): Promise<void> {
+  let claim: string;
+  try {
+    claim = await ctx.plexTv.claimToken(token);
+  } catch (cause) {
+    const why = cause instanceof PlexTvError ? cause.message : failedCall(cause);
+    throw new AppApiError(
+      `${api.name} at ${api.where} was signed out of its plex.tv account, and Mediaplane couldn't get a claim token from plex.tv to claim it again, so it stays unpublished: ${why}. ${claimHint(cause)}`,
+      cause instanceof PlexTvError && !cause.unsure
+        ? { kind: 'rejected' }
+        : { kind: 'auth', unsure: true },
+    );
+  }
+  api.addSecret(claim);
+  // By its address: Plex's DNS-rebinding check refuses a claim sent to a name (probed).
+  await api.submit(
+    'POST',
+    `/myplex/claim?token=${encodeURIComponent(claim)}`,
+    undefined,
+    {
+      byAddress: true,
+    },
+  );
+}
+
 /** What to do when plex.tv gives no claim token, failing with `cause`. */
@@ -243,2 +301,6 @@ export const plexBootstrap: Bootstrap = {
     }
+    // Signed out of its account while it ran: claimed again here, before the wait.
+    if ((await signedOut(stack.home)) && !(await identityOf(api)).claimed) {
+      await claimAgain(api, ctx, token);
+    }
     // As long as apply waits for an app, as Plex claims itself as it first starts.
````

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index d704627..5508a29 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -513,2 +513,21 @@ export async function planStack(
   }
+  // An app to set up first that runs published now, as a Plex signed out of its account
+  // while it ran: until apply starts it again without its ports, whoever reaches it may
+  // finish its setup first (spec §6.4). Said, as apply puts it right.
+  for (const change of bootstrap.filter((b) => b.unpublished)) {
+    const published = current.some(
+      (c) => c.service === change.app && c.state === 'running' && c.published.length > 0,
+    );
+    if (!published) continue;
+    const name = stack.apps.find((a) => a.def.id === change.app)?.def.name ?? change.app;
+    diagnostics.push(
+      warning(
+        'bootstrap.open-published',
+        `${name} runs published, though its first-run setup isn't shown to be done: whoever reaches it may finish the setup before Mediaplane does, as anyone can claim a Plex signed out of its plex.tv account`,
+        {
+          hint: `run apply now: it starts ${name} again without its ports, and finishes the setup first`,
+        },
+      ),
+    );
+  }
   return {
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/http/client.test.ts catalog/plex/bootstrap.test.ts packages/cli/src/run.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the nightly Plex test, with a plex.tv account kept for tests**

Run, with the token of an account kept for tests in a file of mode 0600, never your own:
`MEDIAPLANE_E2E_PLEX_TOKEN_FILE=<that file> MEDIAPLANE_E2E_PLEX_SERVERS=<a new file> pnpm vitest run --config vitest.e2e.config.ts test/e2e/plex.e2e.test.ts`,
then `MEDIAPLANE_E2E_PLEX_TOKEN_FILE=<that file> MEDIAPLANE_E2E_PLEX_SERVERS=<the same file> pnpm exec tsx test/e2e/plex-cleanup.ts`.
Expected: 3 tests pass, in about four minutes; the rotation gives both arrs' connections
the new token and Seerr signs in again with it; Plex signed out is claimed again, the
same server, unpublished until it is shown to be yours. The clean-up then finds no
server of the test's left on the account. Without such a token, skip this step: the
nightly job runs it.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS. Nothing generated changes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(catalog,engine): claim again a Plex signed out of your account while it ran, and warn while it runs published" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Docs

The §9 set for what Tasks 1 to 7 built. The generated CLI reference was regenerated in
Tasks 3 and 6.

**Files:**
- Modify: `README.md`, `catalog/{plex,prowlarr,qbittorrent,radarr,seerr,sonarr}/README.md`, `docs/adr/0003-drift-detect-and-warn-with-keep-mine.md`, `docs/architecture.md`, `docs/design/m1-engine-cli.md`, `docs/plans/m1-roadmap.md`, `docs/runbooks/drift-reported.md`, `docs/runbooks/rebuilding-a-host.md`, `docs/runbooks/wiring-failed.md`, `docs/security/threat-model.md`

**Interfaces:**
- **Consumes:** Tasks 1 to 7: the plan's `- remove` and `?` lines, `keep.external`, `bootstrap.open-published`, `--rotate plex.token`.
- **Produces:** the spec's §11 "Slice 10b"; the roadmap's S10b and S10c, and each S10b item settled or pointed to S10c.

- [ ] **Step 1: See the docs still promise what this slice builds**

Run: `test "$(grep -rlE '\*\*Slice 10b:\*\* a way|\*\*Next:\*\* S10b|A link stays when its arr leaves|indexer proxy stays when the stack drops|Next:\*\* driving Mediaplane from automation' README.md catalog docs/runbooks docs/architecture.md docs/security docs/adr docs/plans/m1-roadmap.md | wc -l)" -eq 0`

Expected: it exits 1: four files still say it is to come, or that what Mediaplane made stays: `README.md` and the roadmap (`**Next:** S10b (automation)`), Seerr's README (`**Slice 10b:** a way to give Seerr a new Plex token`) and Prowlarr's (`A link stays when its arr leaves the stack`).

- [ ] **Step 2: The apps' READMEs**

**Change** `catalog/prowlarr/README.md`:

````diff
diff --git a/catalog/prowlarr/README.md b/catalog/prowlarr/README.md
index 04ba16c..d14ca01 100644
--- a/catalog/prowlarr/README.md
+++ b/catalog/prowlarr/README.md
@@ -152,10 +152,12 @@ to the solver only when the site answers with a Cloudflare challenge.
   internet anyway: its health check loads a web page.
-- **A link stays when its arr leaves the stack.** Remove Sonarr or Radarr from
-  `stack.yaml`, and Mediaplane stops managing its link, but leaves it in Prowlarr, which
-  then reports it as failing. Delete it in Prowlarr's web UI (Settings, then Apps).
-- **The indexer proxy stays when the stack drops its Cloudflare solver.** With no Byparr
-  and no FlareSolverr, Mediaplane stops managing the proxy, but leaves it in Prowlarr,
-  which still sends the challenged requests of indexers tagged `cloudflare` to it, where
-  they now fail, since the solver is gone. Delete it in Prowlarr's web UI (Settings, then
-  Indexers, under Indexer Proxies), or turn a solver on again.
+- **A link goes when its arr leaves the stack.** Remove Sonarr or Radarr from
+  `stack.yaml`, and the next `apply` removes its link from Prowlarr, which holds the arr's
+  key, once `plan` has said so (`- remove prowlarr.application_radarr`). One renamed in
+  Prowlarr stays, as it may be yours now: `plan` and `drift` say so; delete it in
+  Prowlarr's web UI (Settings, then Apps) if you don't want it.
+- **The indexer proxy goes when the stack drops its Cloudflare solver.** With no Byparr
+  and no FlareSolverr, the next `apply` removes the proxy from Prowlarr, so it no longer
+  sends the challenged requests of indexers tagged `cloudflare` to a solver that is gone.
+  The `cloudflare` tag stays, on your indexers too. To keep the proxy instead, run
+  `mediaplane keep prowlarr.indexer_proxy` before that `apply`.
 - **Set up before Slice 3a.** If Prowlarr first started before Mediaplane wrote its
````

**Change** `catalog/qbittorrent/README.md`:

````diff
diff --git a/catalog/qbittorrent/README.md b/catalog/qbittorrent/README.md
index 5b3f1b6..feff773 100644
--- a/catalog/qbittorrent/README.md
+++ b/catalog/qbittorrent/README.md
@@ -131,2 +131,7 @@ holds for it`. Neither drift nor `plan` sends that key again until `apply` check
   drift again.
+- **A category goes when its arr leaves the stack,** but only while no torrent is in it:
+  removing a category takes it from its torrents, and Automatic Torrent Management then
+  moves their files to `/data/torrents` (probed). So `plan` says the category stays, and
+  why; move its torrents to another category in qBittorrent, and the next `apply` removes
+  it. Or keep it with `mediaplane keep qbittorrent.category_movies`.
 
````

**Change** `catalog/sonarr/README.md`:

````diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index c9d4b9e..63bd11e 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -176 +176,6 @@ LinuxServer.io image, unmodified.
   lock it out of Sonarr.
+- **Taken out of the stack,** Sonarr's container goes at the next `apply`, and so does
+  what Mediaplane made for it in the other apps: Prowlarr's link to it, qBittorrent's
+  `tv` category (unless a torrent is in it), and Seerr's Sonarr server. Its `appdata/`
+  stays: deleting it is yours to do. Its connection to Jellyfin, or to Plex, goes when the
+  stack moves to the other media server.
````

**Change** `catalog/radarr/README.md`:

````diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 9343302..65067a6 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -183 +183,6 @@ LinuxServer.io image, unmodified.
   lock it out of Radarr.
+- **Taken out of the stack,** Radarr's container goes at the next `apply`, and so does
+  what Mediaplane made for it in the other apps: Prowlarr's link to it, qBittorrent's
+  `movies` category (unless a torrent is in it), and Seerr's Radarr server. Its
+  `appdata/` stays: deleting it is yours to do. Its connection to Jellyfin, or to Plex,
+  goes when the stack moves to the other media server.
````

**Change** `catalog/seerr/README.md`:

````diff
diff --git a/catalog/seerr/README.md b/catalog/seerr/README.md
index 43cf806..46b6f04 100644
--- a/catalog/seerr/README.md
+++ b/catalog/seerr/README.md
@@ -68,7 +68,11 @@ With Jellyfin as the media server (with Plex, see below):
   puts it back), and the Movies and Shows libraries enabled. A library you enable in
-  Seerr stays yours. Seerr uses the key it made itself in Jellyfin as it signed in
-  (named `Seerr` in Jellyfin's dashboard): Mediaplane checks that it works, and gives
-  Seerr its own Jellyfin key only when Jellyfin refuses Seerr's, or Jellyfin moves,
-  when Seerr's libraries are synced again too. Seerr shows that key in clear: Mediaplane
-  keeps it out of all it prints and records. Seerr sets Jellyfin's id (`serverId`) at
+  Seerr stays yours. Seerr makes itself a key in Jellyfin as it first signs in (named
+  `Seerr` in Jellyfin's dashboard); the first time Mediaplane records the link, it gives
+  Seerr Mediaplane's own Jellyfin key in its place, and removes Seerr's from Jellyfin, so
+  one key is the one to rotate. A Seerr set up before then gets Mediaplane's key at its
+  next `apply` too, and the key it held goes from Jellyfin if Jellyfin lists it as
+  Seerr's. From then on Mediaplane checks that the key works, and gives it again when
+  Jellyfin refuses it, or Jellyfin moves, when Seerr's libraries are synced again too.
+  Seerr shows its key in clear: Mediaplane keeps it out of all it prints and records.
+  Seerr sets Jellyfin's id (`serverId`) at
   its first sign-in and on each link it saves: a link with an empty id reads as not
@@ -145,5 +149,14 @@ With Jellyfin as the media server (with Plex, see below):
 
-## Not built yet
+## Known issues
 
-- **Slice 10b:** a way to give Seerr a new Plex token: it keeps the one it signed in with.
+- **On a Plex stack, Seerr keeps the token it signed in with,** and reaches Plex with it.
+  A new token from `plex-login --force` reaches it with
+  `mediaplane apply --rotate plex.token`, which signs Seerr in again with it, once plex.tv
+  says Seerr's admin is the new token's account.
+- **A server goes when its arr leaves the stack:** the next `apply` removes
+  `Radarr (Mediaplane)` from Seerr once Radarr is out of `stack.yaml`. One renamed in
+  Seerr stays, as it may be yours now.
+- **Its `settings.json` unreadable** (say, its mode changed by hand): a Seerr Mediaplane
+  set up is asked itself whether its setup is done, and stays as it is when it says so,
+  with a warning (`bootstrap.unreadable`).
 
````

**Change** `catalog/plex/README.md`:

````diff
diff --git a/catalog/plex/README.md b/catalog/plex/README.md
index de0e9a8..4794d4b 100644
--- a/catalog/plex/README.md
+++ b/catalog/plex/README.md
@@ -184,6 +184,14 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
   [threat model](../../docs/security/threat-model.md#t4-an-app-is-compromised) says more.
-- **A new token from `plex-login` reaches the arrs only once the old one is refused.**
-  Sonarr and Radarr keep the token they hold while Plex takes it, and get yours at the
-  next `apply` when Plex refuses theirs. Seerr keeps the token it signed in with, and
-  Mediaplane can't give it another yet (Slice 10b).
+- **A new token from `plex-login --force` reaches the apps with
+  `mediaplane apply --rotate plex.token`.** Sonarr and Radarr keep the token they hold
+  while Plex takes it, and Seerr keeps the one its admin signed in with, so a plain
+  `apply` changes nothing. With `--rotate plex.token`, `apply` gives the new one to both
+  arrs' connections, and signs Seerr in again with it, once it has asked plex.tv that
+  Seerr's admin is the new token's account; then you can sign the old one out at
+  plex.tv. A token of another account, which Plex refuses, is given to no app.
+  `plex-login` says so when it saves a token in place of another.
+- **Signed out of your account while it runs** (its web UI's sign-out), Plex is
+  unclaimed, and still published: `plan` warns (`bootstrap.open-published`). The next
+  `apply` starts it without its ports, claims it again for your account through its own
+  API, as its image won't, and publishes it: the same server, with its libraries.
 - **A Plex claimed outside `apply`,** with another account, stays unpublished: see the
````

- [ ] **Step 3: The architecture, the threat model, the ADR and the runbooks**

`docs/architecture.md` gains a section, "An app taken out of the stack", with its diagram.

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 311dbe5..b993c75 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -366,3 +366,5 @@ name, and adopted
   `settings.json`, Gluetun's `auth/config.toml`, and Jellyfin's database, opened
-  read-only with Node's own SQLite. A key file that is there but can't be read, or holds
+  read-only with Node's own SQLite, in a process of its own that is stopped after 10
+  seconds, so that a named pipe put in the database's place can't hang `plan`. A key
+  file that is there but can't be read, or holds
   another app's key, stops `plan` (`keys.unrecoverable`): a new key would lock Mediaplane
@@ -451,5 +453,9 @@ up --wait again
   is checked (below). The record is dropped when a pending setup runs, and made again
-  only by a success. A file Mediaplane can't read has Seerr start unpublished, and set
-  up again, on every `apply`, with that warning, and each such `apply` fails at verify
-  (exit 1), until the file is readable. An app with a setup can't run inside another
+  only by a success. When Mediaplane can't read that file, a Seerr its record names is
+  asked itself, with that warning: it stays as it is when it says its setup is done, and
+  is set up again, unpublished, when it says it is open, or can't be asked. One with no
+  record starts unpublished, and is set up again. An app that runs published while its
+  setup is to be done, as a Plex signed out of its account while it ran, has `plan` warn
+  (`bootstrap.open-published`): whoever reaches it may finish the setup first, until
+  `apply` starts it again without its ports. An app with a setup can't run inside another
   app's network, which would publish its ports: `plan` fails with
@@ -482,2 +488,9 @@ up --wait again
   key: Plex's key is your token.
+- **A Plex signed out of your account while it ran** (its web UI's sign-out) is
+  unclaimed at once, keeps `PlexOnlineToken=""` in `Preferences.xml`, and stays
+  published until the next `apply`, so `plan` warns. Its image never claims it again: its
+  claim step looks only for that attribute's name (probed). So Plex's setup claims it
+  itself, unpublished, through Plex's own API: a claim token from plex.tv, with your
+  token, posted over the wiring network (`POST /myplex/claim`), then the same checks as
+  after its first start. It is the same server to plex.tv, with its libraries.
 - **Seerr on a Plex stack** signs in with your Plex token (`POST /api/v1/auth/plex`),
@@ -486,3 +499,6 @@ up --wait again
   must be the one plex.tv says your token is, and its Plex unset or the stack's, without
-  TLS. It is never signed in to, which would give your token to whoever set it up.
+  TLS. It is never signed in to, which would give your token to whoever set it up, but
+  for a rotation: Seerr keeps the token its admin signed in with, and reaches Plex with
+  it, so `apply --rotate plex.token` signs it in again with the new one, once those
+  checks show it is yours (`First-run setup:` lists it, published, "signing in again").
 - **Seerr's first sign-in must be its admin's,** through Jellyfin or with your Plex
@@ -691,3 +707,6 @@ mediaplane (the stack)
     requires that library. A connection held with TLS or a URL base reads as moved, so
-    the token is never sent to an address read from the arr.
+    the token is never sent to an address read from the arr. An old token that still
+    works passes the test, so a new one from `plex-login --force` reaches the arrs with
+    `apply --rotate plex.token`, which gives it to each connection unchecked, but for one
+    Plex refuses (a token of another account).
   - Mediaplane never sets Plex's remote access, nor the settings that let a client in
@@ -716,8 +735,13 @@ mediaplane (the stack)
     base or TLS set in Seerr counts as Jellyfin moved, and is put back), with Mediaplane's
-    Movies and Shows libraries enabled; a library you enable yourself stays yours. The key
-    Seerr uses for Jellyfin is the one Seerr made itself as it signed in. It stays while
-    it works, which Mediaplane checks with Seerr's list of Jellyfin's users. When Jellyfin
-    refuses it, or Jellyfin moves, Mediaplane gives Seerr its own Jellyfin key; on a move,
-    Seerr's libraries are synced again too, since another Jellyfin has other library ids.
-    It needs Jellyfin's admin and libraries in place.
+    Movies and Shows libraries enabled; a library you enable yourself stays yours. Seerr
+    makes itself a key in Jellyfin as it first signs in; the first time Mediaplane records
+    the link, it gives Seerr its own Jellyfin key in its place, and removes Seerr's from
+    Jellyfin, so one key, Mediaplane's, is the one to rotate. From then on the key Seerr
+    holds is checked with Seerr's list of Jellyfin's users, and given again when Jellyfin
+    refuses it, or Jellyfin moves; on a move, Seerr's libraries are synced again too,
+    since another Jellyfin has other library ids. It needs Jellyfin's admin and libraries
+    in place.
+  - Seerr's `settings.json` says whether its setup is done. When Mediaplane can't read
+    it, Seerr itself is asked, if Mediaplane set it up before: it is set up again,
+    unpublished, only when it says its setup is open, or can't be asked.
   - Its Sonarr and Radarr servers reach each arr at its service and port, with its key,
@@ -813,4 +837,4 @@ O ≠ L, O ≠ D: drift, changed
   - a resource Mediaplane made that the stack no longer wants, still in the app, looked
-    up by its record; one whose app can't say, or stopped answering, counts as not looked
-    at.
+    up by its record, which `apply` removes, or why it leaves it (`stays`); one whose app
+    can't say, or stopped answering, counts as not looked at.
 
@@ -821,4 +845,4 @@ O ≠ L, O ≠ D: drift, changed
   back a field, a resource or a secret, and a key changed at its source where the app
-  keeps it in a file of its own; what is left in an app is removed by hand, or kept,
-  until Slice 10b. Its exit code is 0 when nothing changed and every resource and secret
+  keeps it in a file of its own; and it removes what is left in an app, unless `keep`
+  keeps it first. Its exit code is 0 when nothing changed and every resource and secret
   was checked, and 2 otherwise.
@@ -862,9 +886,48 @@ O ≠ L, O ≠ D: drift, changed
   it can't write safely, or fails to write, giving the line to add instead
-  ([ADR 0003](adr/0003-drift-detect-and-warn-with-keep-mine.md)). Keeping a download
-  client's category gives qBittorrent's category that name: `apply` makes it, and drift
-  is clear once it has.
+  ([ADR 0003](adr/0003-drift-detect-and-warn-with-keep-mine.md)). With
+  `managed_by: external`, it writes no `stack.yaml`, and gives the line (`line` in its
+  `--json`, with `written: false`) for your automation to add, recording nothing until
+  `stack.yaml` holds it; a resource kept as `unmanaged` is forgotten at once, so that
+  `apply` never removes it meanwhile. Keeping a download client's category gives
+  qBittorrent's category that name: `apply` makes it, and drift is clear once it has.
 - **Keep mine of a key:** `mediaplane keep <app>.<key>` keeps an app's own key, changed
   at its source, as [Rebuilding a host](#rebuilding-a-host) says.
-- **Not yet:** removing what Mediaplane made when its app leaves the stack (Slice 10b);
-  drift on a schedule (M2).
+- **Not yet:** drift on a schedule (M2).
+
+## An app taken out of the stack
+
+Take an app out of `stack.yaml` (or set `enabled: false`) and `apply` removes its
+container, and what Mediaplane made for it in the other apps (spec §8.1(3) step 4). Its
+`appdata/` stays: deleting it is yours to do.
+
+```text
+plan
+  │ each resource Mediaplane
+  │ recorded that the stack
+  │ no longer wants, looked
+  │ up in its app
+  ▼
+remove, when the app holds
+it as Mediaplane made it
+(its id and its name), and
+nothing of yours is in it
+  │
+  ▼
+apply's wire step: looked
+up again, removed, and its
+record forgotten
+```
+
+- **What goes:** Prowlarr's link to an arr that left, and its indexer proxy once the
+  stack has no Cloudflare solver (the `cloudflare` tag stays, on your indexers too);
+  qBittorrent's category of an arr that left; Seerr's server of an arr that left; an
+  arr's download client, and its connection to a media server that left.
+- **What stays, and why, in `plan` and `drift`:** a resource renamed in its app, or
+  found under its name with another id, may be yours now; a qBittorrent category with a
+  torrent in it, since removing it would move the torrent's files (Automatic Torrent
+  Management, probed); and Seerr's media server, a setting Seerr can't drop (switching
+  media servers sets Seerr up afresh). `mediaplane keep <app>.<resource>` keeps one as
+  yours, and stops the report.
+- **The left app's own resources** (its admin, its root folder) stay recorded, as its
+  appdata stays: added back, it is found as it was.
 
@@ -977,4 +1040,4 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- automation (Slice 10b): removing what Mediaplane made when its app leaves the stack,
-  a new Plex token for the arrs and Seerr, the `--json` contract, and the docs that
+- the automation contract (Slice 10c): the `--json` shapes pinned and in the generated
+  docs, exit codes, the automation guide with a short Ansible example, and the docs that
   complete M1.
````

**Change** `docs/security/threat-model.md`:

````diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 8e470cb..5864c71 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -356,17 +356,16 @@ What remains:
   setting that looks right but isn't.
-- A compromised Jellyfin can still hang `plan`, `drift` or `keep` while they read its
-  database's key, with a named pipe:
-  - one put at the database's own name in the instant between SQLite looking up the
-    file Mediaplane holds open and opening it by that name;
-  - or one put in place of its write-ahead log or index (`-wal`, `-shm`) after
-    Mediaplane checked them, before SQLite opens them at its first read. That window is
-    wider: a pipe at `-wal` hangs the read (probed).
-
-  It is a hang, never a read or a write through the pipe. Another file put at the
-  database's name in that instant can be read instead, unless Mediaplane's check after
-  SQLite's open sees it; and a folder on the way swapped for a link and back as quickly
-  can do the same. Such a read is bounded by the fixed `ApiKeys` query, and a key that
-  is another app's is refused. Nothing is written either way. A file swapped in at the
-  database's path at any other time is never what SQLite opens. Reading the database in
-  a process of its own, with a deadline, is S10b's.
+- A compromised Jellyfin can still make `plan`, `drift` or `keep` wait while they read
+  its database's key, with a named pipe put at the database's own name in the instant
+  between SQLite looking up the file Mediaplane holds open and opening it by that name:
+  SQLite's open waits on a pipe (probed). The read runs in a process of its own, Node
+  with an empty environment, the database handed to it open, which Mediaplane stops
+  after 10 seconds: the read is then a key file that couldn't be read, never a key (Slice
+  10b). A pipe put in place of its write-ahead log (`-wal`) after Mediaplane checked it
+  makes SQLite refuse the read (`disk I/O error`, probed). It is never a read or a write
+  through the pipe. Another file put at the database's name in that instant can be read
+  instead, unless Mediaplane's check once the read has answered sees it, and then what
+  was read is dropped; and a folder on the way swapped for a link and back as quickly can
+  do the same. Such a read is bounded by the fixed `ApiKeys` query, and a key that is
+  another app's is refused. Nothing is written either way. A file swapped in at the
+  database's path at any other time is never what SQLite opens.
 
@@ -389,5 +388,7 @@ What remains:
   share your other servers with it as you need.
-- A link stays in Prowlarr when its arr leaves the stack, and keeps that arr's key,
-  until it is removed by hand (in Prowlarr's web UI). `mediaplane drift` reports it, as
-  still in the app though the stack no longer wants it; removing it for you is Slice 10b.
+- A link Mediaplane made in Prowlarr, which holds an arr's key, is removed by the next
+  `apply` once its arr leaves the stack, as is each server of Seerr's and each download
+  client or connection an arr holds for an app that left (Slice 10b): only one its
+  record says it made, held as it made it. One renamed in its app stays, as it may be
+  yours, and keeps the key until you remove it; `mediaplane drift` reports it.
 - The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
@@ -438,7 +439,11 @@ Controls today:
   test of the server it holds, at the stack's address for the arr, and never compares,
-  keeps or shows them. The key Seerr made itself in Jellyfin, which it also shows in
-  clear, Mediaplane reads in Seerr's answer and leaves there: it is never kept, nor sent
-  anywhere, and it is replaced with `***` in every message, as the stack's own secrets
-  are, once read. When Jellyfin refuses it, or Jellyfin moves, Mediaplane gives Seerr the
-  Jellyfin key it holds itself, in a request body, as it gives the arrs.
+  keeps or shows them. The key Seerr made itself in Jellyfin as it first signed in, which
+  it also shows in clear, is replaced the first time Mediaplane records Seerr's link to
+  Jellyfin: Mediaplane gives Seerr the Jellyfin key it holds itself, in a request body,
+  as it gives the arrs, then removes from Jellyfin the key Seerr held, only one Jellyfin
+  lists under the name Seerr gives its own (Slice 10b). So no second admin key of
+  Jellyfin's lingers. The one Seerr held is never kept, nor sent anywhere but in that
+  removal to Jellyfin, and it is replaced with `***` in every message once read. When
+  Jellyfin refuses the key Seerr holds, or Jellyfin moves, Mediaplane gives it its own
+  again.
 - The admin password goes to Seerr only once, in its first sign-in's request body,
@@ -484,2 +489,9 @@ Controls today:
   yours, Plex, and Seerr.
+- A Plex signed out of your account while it ran is unclaimed, and stays published until
+  the next `apply`: anyone who reaches it can claim it. `plan` and `drift` warn
+  (`bootstrap.open-published`). Its image never claims it again with a claim token (its
+  Preferences.xml keeps an empty `PlexOnlineToken`, probed), so the setup does, while
+  Plex is unpublished: a second claim token, fetched by the setup with your token, sent
+  to Plex in the query of `POST /myplex/claim` over the wiring network, replaced with
+  `***` in every message, and never kept (Slice 10b).
 - Plex's own token, which its claim makes, is in Plex's `Preferences.xml`, which Plex
@@ -667,2 +679,7 @@ What remains:
   through each app's key. A password of your own is rotated in its file.
+- A new Plex token, from `plex-login --force`, reaches the apps that hold the old one
+  with `mediaplane apply --rotate plex.token`: the arrs' connections to Plex, and Seerr,
+  which signs in again with it, once it is shown to be your account's Seerr (Slice 10b).
+  Only then can you sign the old one out at plex.tv without breaking them. A token of
+  another account, which Plex refuses, is given to no app.
 
````

**Change** `docs/adr/0003-drift-detect-and-warn-with-keep-mine.md`:

````diff
diff --git a/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md b/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md
index ca85426..9a711a0 100644
--- a/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md
+++ b/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md
@@ -51,5 +51,6 @@ address after five failed sign-ins in a row.
   `stack.yaml` that is a link, has other names, belongs to another user or to a group
-  its user isn't in, or is managed by automation (`managed_by: external`, checked again
-  in the file it writes), and one it fails to write, and gives the line to add by hand
-  instead. It never writes a value with a control character, a line or paragraph
+  its user isn't in, and one it fails to write, and gives the line to add by hand
+  instead. A file managed by automation (`managed_by: external`, checked again in the
+  file it writes) is never written: keep gives the line to add (`line` in its `--json`),
+  and succeeds (Slice 10b). It never writes a value with a control character, a line or paragraph
   separator, or one that turns the direction of text, which an editor could show as
@@ -110,4 +111,8 @@ address after five failed sign-ins in a row.
   either way, the app refuses the secret the stack has. Its message says both.
-- **A resource left in an app is reported, never removed.** Removing what Mediaplane made
-  when its app leaves the stack needs a delete for every kind of resource: Slice 10b.
+- **A resource left in an app is reported, and `apply` removes it** (Slice 10b, spec
+  §8.1(3) step 4): only what Mediaplane's record says it made, still as it made it (its id
+  and its name), and nothing of yours in it, such as a qBittorrent category with a
+  torrent. Drift reports it until then, and says why `apply` leaves one it won't remove;
+  `mediaplane keep <app>.<resource>` keeps one as yours. Drift itself still never writes
+  to an app.
 - **After upgrading to Slice 8, `plan` adopts each root folder once,** changing nothing
````

**Change** `docs/runbooks/drift-reported.md`:

````diff
diff --git a/docs/runbooks/drift-reported.md b/docs/runbooks/drift-reported.md
index 6c9ec55..409b983 100644
--- a/docs/runbooks/drift-reported.md
+++ b/docs/runbooks/drift-reported.md
@@ -78,6 +78,13 @@ Each line says what kind of drift it is:
   fails counts towards qBittorrent's ban of an address after five failed sign-ins.
-- `?` **still in the app, though the stack no longer wants it:** Mediaplane made it, such
-  as Prowlarr's link to Sonarr, and Sonarr has since left the stack. `apply` leaves it:
-  remove it in the app, or keep it as yours with `mediaplane keep <app>.<resource>`.
-  Removing it for you comes in Slice 10b.
+- `-` **still in the app, though the stack no longer wants it; apply removes it:**
+  Mediaplane made it, such as Prowlarr's link to Sonarr, and Sonarr has since left the
+  stack. The next `apply` removes it, and forgets its record. To keep it as yours
+  instead, run `mediaplane keep <app>.<resource>` before that `apply`.
+- `?` **still in the app, though the stack no longer wants it; apply leaves it:** the
+  line says why: it was renamed in its app, or is held there under another id, so it may
+  be yours now; it holds what is yours (a qBittorrent category with a torrent in it,
+  which removing it would move); or Mediaplane doesn't remove that kind of resource
+  (Seerr's media server). Remove it in the app if you don't want it, or keep it with
+  `mediaplane keep <app>.<resource>`, which stops the report. For the category, move its
+  torrents to another category in qBittorrent first, and the next `apply` removes it.
 
@@ -204,6 +211,11 @@ Choose, for each change, which side wins.
   other names (hard links), one that belongs to another user, or to a group Mediaplane's
-  user isn't in, one written as a single `{ … }` block, one it can't parse, one managed
-  by automation (`managed_by: external`, checked again in the file it is about to
-  write), or one whose folder it can't write in. The error gives the line to add under
-  `overrides:` yourself.
+  user isn't in, one written as a single `{ … }` block, one it can't parse, or one whose
+  folder it can't write in. The error gives the line to add under `overrides:` yourself.
+
+With `managed_by: external` in `stack.yaml` (checked again in the file it is about to
+write), automation owns the file, and `keep` never writes it: it succeeds, and gives the
+line to add where your automation keeps `stack.yaml` (`line`, with `written: false`, in
+`--json`). Until `stack.yaml` holds it, `apply` puts back what it applied, and drift still
+reports the field. A resource kept as `unmanaged` is forgotten at once instead, so
+`apply` never removes it meanwhile.
 
````

**Change** `docs/runbooks/wiring-failed.md`:

````diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index b4088c6..7ff7a31 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -124,2 +124,17 @@ Plex token, before its port is published, and links to Plex.
   call that carries it.
+- **`plan` warns `bootstrap.open-published`** (`Plex runs published, though its first-run
+setup isn't shown to be done`): Plex was signed out of your plex.tv account while it
+  ran, as its web UI's sign-out does, and anyone who reaches it can claim it now. Run
+  `apply` at once: it starts Plex again without its ports, claims it for your account
+  through Plex's own API (its image doesn't claim a Plex signed out so), and publishes it
+  once it is shown to be yours. If that fails with
+  `was signed out of its plex.tv account, and Mediaplane couldn't get a claim token`,
+  Plex stays unpublished: check your token, as below, and run `apply` again.
+- **Sonarr, Radarr and Seerr still hold your old Plex token** after
+  `mediaplane plex-login --force`: they keep one that works. Run
+  `mediaplane apply --rotate plex.token`: it gives the new token to both arrs'
+  connections, and signs Seerr in again with it (`First-run setup:` lists Seerr,
+  "signing in again"). A token of another plex.tv account is given to no app, and Seerr's
+  sign-in fails with `was set up with another plex.tv account or another Plex`: sign in
+  with `plex-login --force` as Seerr's own account.
 - **`apply` stops at the same step** with a setup that reported success. Before
````

**Change** `docs/runbooks/rebuilding-a-host.md`:

````diff
diff --git a/docs/runbooks/rebuilding-a-host.md b/docs/runbooks/rebuilding-a-host.md
index a4fde0e..7dbadd0 100644
--- a/docs/runbooks/rebuilding-a-host.md
+++ b/docs/runbooks/rebuilding-a-host.md
@@ -62,2 +62,5 @@ the app's key, which it recovered. `mediaplane credentials` shows the new one on
   stack, Plex and Seerr are asked the same way, through plex.tv, whose account they are.
+  `apply` then also gives Seerr Mediaplane's Jellyfin key again (`seerr.media_server
+updated apiKey`), as the first time: the record that it did went with `state/`, and
+  the key Seerr holds is that one already, so nothing goes from Jellyfin.
 
````

- [ ] **Step 4: The README**

**Change** `README.md`:

````diff
diff --git a/README.md b/README.md
index 29ac90e..422abaa 100644
--- a/README.md
+++ b/README.md
@@ -47,3 +47,8 @@ Compose and wires the apps together for you.**
 >   or kept with `mediaplane keep`.
-> - **Next:** driving Mediaplane from automation.
+> - **Taking an app out:** remove it from `stack.yaml`, and `apply` removes its
+>   container, and what Mediaplane made for it in the other apps (Prowlarr's link,
+>   qBittorrent's category, Seerr's server), keeping its appdata and anything of yours.
+>   A new Plex token reaches the arrs and Seerr with `apply --rotate plex.token`.
+> - **Next:** the contract for driving Mediaplane from automation, and the docs that
+>   complete M1.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -99,2 +104,4 @@ Mediaplane does that part for you:
 | Rebuild a host from `stack.yaml` and its appdata                                  | Done    |
+| Take an app out, and what it had in the other apps goes with it                   | Done    |
+| A new Plex token for the arrs and Seerr (`apply --rotate plex.token`)             | Done    |
 | Deploy with automation such as Ansible                                            | Planned |
@@ -597,6 +604,6 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex), S8 (drift), S9 (releases and
-  safe updates) and S10a (recovery). Between S7 and
+  safe updates), S10a (recovery) and S10b (removal and rotation). Between S7 and
   S8, smaller changes added a guided install (`deploy/install.sh`, and `init` asking for
   your own admin password and signing you in to Plex) and hardware transcoding.
-- **Next:** S10b (automation), which completes M1.
+- **Next:** S10c (the automation contract and the docs), which completes M1.
 
````

- [ ] **Step 5: The spec and the roadmap**

The spec's §4.2 and §5.2 point at the new entry; §11 gains "Slice 10b".

**Change** `docs/design/m1-engine-cli.md`:

````diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 00a2337..5be762b 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -351,3 +351,4 @@ Rules:
 - **Externally managed mode.** With `managed_by: external`, Mediaplane never
-  writes `stack.yaml`. `migrate` and Keep mine print the snippet to add instead.
+  writes `stack.yaml`. `migrate` and Keep mine print the snippet to add instead
+  (§11, Slices 9 and 10b).
 - **`vpn.addresses`** is optional and sets the WireGuard address for providers
@@ -551,6 +552,6 @@ in `compose.override.yaml` is therefore wired automatically.
 | `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5, 6, 7 and 8; it never calls plex.tv); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
-| `apply` | Converge on `stack.yaml` (§5). `--rotate admin.password`, which `plan` takes too, generates a new admin password, and sets it in every app (§11, Slice 10a) |
+| `apply` | Converge on `stack.yaml` (§5), removing what Mediaplane made for an app the stack no longer wants (§11, Slice 10b). `--rotate admin.password`, which `plan` takes too, generates a new admin password, and sets it in every app (§11, Slice 10a); `--rotate plex.token` gives your new Plex token to every app that holds the old one (§11, Slice 10b) |
 | `status [app]` | Container health, VPN state, and the last apply's outcome |
 | `drift` | Report drift only (§6.3): it changes nothing in the apps but for its checks' marks, fewer than `plan`'s, and keeps what it found of each secret, and of each app's own key, in `state/resources.json`; like `plan`, it joins the wiring network in the image, and like `apply` it holds `state/lock` while it runs (§11, Slice 8) |
-| `keep <path>` | Keep mine: record a drifted value, or a resource deleted or left in an app, as an override, adding one line to `stack.yaml`, and record it as applied in `state/resources.json`; or, for an app's own key changed at its source (`<app>.<key>`), keep the key its own file holds in `state/secrets.json`, which the next `apply` gives to each resource that holds the old one (§11, Slice 10a); like `plan`, it joins the wiring network in the image, and it holds `state/lock` while it runs (§11, Slice 8) |
+| `keep <path>` | Keep mine: record a drifted value, or a resource deleted or left in an app, as an override, adding one line to `stack.yaml`, and record it as applied in `state/resources.json` (with `managed_by: external`, it writes no `stack.yaml`, and gives the line to add: §11, Slice 10b); or, for an app's own key changed at its source (`<app>.<key>`), keep the key its own file holds in `state/secrets.json`, which the next `apply` gives to each resource that holds the old one (§11, Slice 10a); like `plan`, it joins the wiring network in the image, and it holds `state/lock` while it runs (§11, Slice 8) |
 | `history [id]` | List change records, or show one in full |
@@ -2276 +2277,91 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   written there between `compose stop` and `up`, which apply already makes (§7.2(2)).
+
+### Slice 10b: removal and rotation (2026-10-26)
+
+- **What was S10b ships in two parts** (§2.3; the roadmap gives each part's items): S10b,
+  removal and rotation (what an app leaving the stack had in the others, a new Plex
+  token, a Plex signed out of its account, Seerr's own Jellyfin key, Seerr asked when its
+  file can't be read, Keep mine with `managed_by: external`, and a deadline on Jellyfin's
+  database read); and S10c, the automation contract and the docs that complete M1 (the
+  `--json` shapes pinned and in the generated docs, exit codes, commands that ask nothing
+  when a script runs them, the automation guide with a short Ansible example, the full
+  README, the add-an-app guide, the test gaps, and S9's review items).
+- **What an app leaving the stack had in the others goes** (§4.2, §8.1(3) step 4). A
+  resource may say how it is removed (`remove`), and why one may not be (`cannotRemove`,
+  read from the app). `plan` lists each resource Mediaplane recorded that the stack no
+  longer wants, and that the app holds as Mediaplane made it (the id and the name its
+  record keeps), as `remove` (a new wiring action, within `mediaplane.plan/v1` and
+  `mediaplane.change/v1`; an older release lists such a change record as one it can't
+  read); one of an app that isn't settled yet, as checked after the start. Apply's wire
+  step, after an app's wanted resources, looks each up again, removes it, and forgets its
+  record (`removed`). Drift still reports each as `left`, and says why `apply` leaves
+  one (`stays`): Mediaplane doesn't remove that kind; it is renamed in its app, or held
+  there under another id, so it may be yours; or it holds what is yours.
+  - **What is removed** (probed on the pinned images): Prowlarr's link to an arr that left
+    and its indexer proxy once the stack has no solver (`DELETE`, 200 whether or not
+    Prowlarr held it; the `cloudflare` tag stays), an arr's download client and its
+    connections (the same), qBittorrent's category of an arr that left
+    (`removeCategories`, 200 either way), and Seerr's server of an arr that left
+    (`DELETE /api/v1/settings/<arr>/<id>`, which answers 500 for one Seerr doesn't hold,
+    so it is removed only as just observed).
+  - **What stays:** a qBittorrent category with a torrent in it, since removing it takes
+    the category from the torrent and Automatic Torrent Management moves its files to
+    `/data/torrents` (probed); Seerr's media server, a setting of Seerr's, which a switch of
+    media server sets up afresh (§10); and the left app's own records, as its appdata
+    stays.
+  - **Keep mine first** keeps one as yours (`<app>.<resource>: unmanaged`), and `apply`
+    never removes a resource it has no record of.
+- **Keep mine with `managed_by: external`** (§4.2, §5.2). Keep writes no `stack.yaml` and
+  succeeds: `mediaplane.keep/v1` gives the line to add (`line`, and `written: false`),
+  with a warning (`keep.external`); a write it refuses gives the line too. It records
+  nothing as applied, since `stack.yaml` doesn't hold the line yet, but forgets the record
+  of a resource kept `unmanaged`, so that `apply` never removes it meanwhile. Once
+  `stack.yaml` holds the line, `plan` adopts what the app holds.
+- **Jellyfin's database is read in a process of its own** (§6.1, threat model T4): Node
+  itself (`process.execPath`), with a fixed program on `--eval`, no shell, an empty
+  environment, the database handed to it open as its fd 3 (SQLite opens
+  `/proc/self/fd/3`), its request on its standard input and its answer, which holds the
+  key, on its standard output. It is killed after 10 seconds (`DATABASE_DEADLINE_MS`):
+  SQLite's open waits on a named pipe at the database's name (probed), which a compromised
+  Jellyfin could put there in an instant. The checks that the path is still the file read
+  run once it has answered, and drop what it read otherwise. A pipe at the `-wal` makes
+  SQLite refuse the read (`disk I/O error`, probed). Anything it doesn't answer as
+  expected is a key file that couldn't be read.
+- **Seerr's own Jellyfin key is replaced** (§6.1, §6.2). Seerr makes a key named `Seerr`
+  in Jellyfin as it first signs in (probed). A resource may name secrets the app made
+  itself (`adoptSets`): until its record says Mediaplane gave them (`given`, names only,
+  an optional field within `mediaplane.resources/v1`), they are a change, never checked.
+  So the first `apply` that records `seerr.media_server` gives Seerr Mediaplane's own
+  Jellyfin key, then has Jellyfin remove the key Seerr held, when Jellyfin lists it under
+  the name Seerr gives its own (probed: 204, Seerr keeps working); a Seerr set up before
+  gets it at its next `apply`. One key, Mediaplane's, is then the one to rotate. A
+  resource's `update` gets apply's VerifyContext, for Jellyfin's client.
+- **Seerr is asked when its `settings.json` can't be read** (§6.4). A Seerr whose setup
+  Mediaplane recorded (`setUp`) is asked itself, as plan reaches it (`Bootstrap.open`,
+  without its key): one that says its setup is done stays as it is, published; one that
+  says it is open, or can't be asked, is set up again, unpublished (fail closed). So such
+  an `apply` no longer fails at verify each time.
+- **A new Plex token** (§6.1, §10). The arrs keep a token Plex takes, and Seerr the one
+  its admin signed in with, which its API never shows (probed). `plan --rotate
+  plex.token` and `apply --rotate plex.token` take your new token as a change, unchecked,
+  for each resource that holds it (the arrs' connections to Plex), but for one whose
+  key's own app refuses it (Plex, for a token of another account); and list Seerr's
+  setup again, published (`again`, within the plan's and the change record's
+  `bootstrap`), since a setup may say which secrets you give it signs in with
+  (`signsInWith`). Seerr's setup then checks, as for a Seerr set up already, that its
+  admin is the new token's account, and signs in again with it (probed: Seerr keeps the
+  new token as its admin's, id 1), and out; its record stays whatever the sign-in does.
+  `plex-login` says to run it when it saves a token in place of another. Only on a Plex
+  stack (`rotate.no-plex`).
+- **A Plex signed out of its account while it ran is claimed again** (§6.4). Its web
+  UI's sign-out (`DELETE /myplex/account`) unclaims it at once, published, and its
+  `Preferences.xml` keeps `PlexOnlineToken=""`, so its image never uses `PLEX_CLAIM`: its
+  claim step looks only for that attribute's name (probed: "Server already claimed").
+  `plan` lists its setup, and warns that it runs published (`bootstrap.open-published`,
+  for any app whose setup is to be done and which publishes ports now). Apply starts it
+  unpublished, and Plex's setup claims it itself, while it is unclaimed: a claim token
+  from plex.tv, with your token, posted to Plex over the wiring network, to its address
+  (`POST /myplex/claim`; Plex's DNS-rebinding check refuses one sent to a name, probed);
+  then the checks of a first start. The same server, its new token your account's.
+- **No new Docker API call:** the removals, the claim and Seerr's sign-in are the apps'
+  APIs over the wiring network; the database read is a local process (§7.2(2)).
````

The roadmap: S10 in three parts, S10b's and S10c's lists, and each item settled.

**Change** `docs/plans/m1-roadmap.md`:

````diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index 3ef5ec1..c742e1e 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -4,4 +4,4 @@
 
-M1 is too large for one implementation plan, so it is delivered in 16 vertical
-slices: S1, S2 in three parts, S3 in four, S4 to S9, and S10 in two. Each slice:
+M1 is too large for one implementation plan, so it is delivered in 17 vertical
+slices: S1, S2 in three parts, S3 in four, S4 to S9, and S10 in three. Each slice:
 
@@ -28,2 +28,3 @@ Detailed plans so far:
 - Slice 10a: [`m1-s10a-recovery.md`](m1-s10a-recovery.md) (done).
+- Slice 10b: [`m1-s10b-automation.md`](m1-s10b-automation.md) (done).
 
@@ -31,3 +32,4 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8, S9 and S10a.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8, S9, S10a and
+  S10b.
 - **Between S7 and S8 (2026-10-17), outside the slices** by the lighter route for small
@@ -36,3 +38,3 @@ Where M1 stands (the README shows the same):
   `deploy/install.sh`.
-- **Next:** S10b (automation), which completes M1.
+- **Next:** S10c (the automation contract and the docs), which completes M1.
   [After M1](#after-m1) has what comes next.
@@ -64,3 +66,3 @@ Where M1 stands (the README shows the same):
 | S9 | **Releases and safe updates** | Versioned, published releases, and updating Mediaplane without touching the stack (listed below) | §8.2, §9 | Success criterion 7 |
-| S10 | **Recovery and automation**, in two parts: S10a and S10b | Rebuilding a host, and running Mediaplane from automation (listed below) | §6.1 (key recovery), §6.3, §9 | M1 is done |
+| S10 | **Recovery and automation**, in three parts: S10a, S10b and S10c | Rebuilding a host, and running Mediaplane from automation (listed below) | §6.1 (key recovery), §6.3, §9 | M1 is done |
 
@@ -110,3 +112,3 @@ playbook. That completes M1.
 
-### S10 is delivered in two parts (decided 2026-10-26)
+### S10 is delivered in three parts (decided 2026-10-26)
 
@@ -136,3 +138,3 @@ relies on, with the docs that complete M1).
     a minimum of 6 for every stack (2026-10-26).
-- **S10b: automation.**
+- **S10b: automation, as first planned.**
   - Delivers: removing what Mediaplane made when its app leaves the stack (§8.1(3) step
@@ -149,2 +151,31 @@ relies on, with the docs that complete M1).
     reading only the documented contract.
+  - **Split again on 2026-10-26** ([plan](m1-s10b-automation.md), decision 1), by what
+    each part changes: S10b, what the stack does when it changes (behaviour); S10c, the
+    contract a script reads, and the docs that complete M1.
+- **S10b: removal and rotation** ([plan](m1-s10b-automation.md)).
+  - Delivers: what an app leaving the stack had in the others removed (spec §8.1(3)
+    step 4), but what is yours, or no longer as Mediaplane made it; Keep mine with
+    `managed_by: external` giving the line to add in `mediaplane.keep/v1`; Jellyfin's
+    database read in a process of its own, with a deadline; Seerr's own Jellyfin key
+    replaced with Mediaplane's, and Seerr asked when its `settings.json` can't be read;
+    a new Plex token for the arrs and Seerr (`--rotate plex.token`, Seerr signed in again,
+    the fake Seerr's `/auth/me` answering each session as its own user); a Plex signed out
+    of its account while it runs claimed again through its API, with a warning while it
+    runs published.
+  - Proves: a script, with no terminal and reading only `--json` and exit codes, deploys
+    the Jellyfin stack, takes Radarr and the Cloudflare solver out, and `apply` removes
+    their containers and what they had in the other apps, leaves a qBittorrent category
+    that holds a torrent until the torrent moves, keeps Radarr's appdata, and then changes
+    nothing, on real Docker; the nightly Plex job rotates the token and claims Plex again.
+- **S10c: the automation contract and the docs.**
+  - Delivers: the `--json` shapes pinned and in the generated docs (`history <id>
+    --json` included, and `ok` on `credentials`, `status` and `history`), exit codes,
+    commands that ask nothing when a script runs them, and a second `apply` that changes
+    nothing; `plan --help` and `drift --help` pointing at the published docs; the
+    "deploying with automation" guide with a short Ansible example, the full README and
+    the add-an-app guide; the test gaps below, CI's end-to-end pulls made robust against a
+    temporary registry error, S9's review items, which Compose versions work out a
+    service differently, and the nightly Plex job's items.
+  - Proves: a playbook deploys a stack, removes an app from it, and rebuilds the host,
+    reading only the documented contract.
 
@@ -600,2 +631,7 @@ password, which are S3c's (and listed again below).
     keys Mediaplane holds doesn't touch.
+  - **Done in S10b:** `apply --rotate plex.token` signs Seerr in again with your new
+    token, once plex.tv says Seerr's admin is that token's account (probed: Seerr keeps
+    it as its admin's); `plex-login` says to run it. A revoked token Seerr holds still
+    can't be seen through Seerr's API (probed: it never shows it), so drift can't report
+    it: the rotation is the way.
 - **The arrs keep a Plex token while Plex takes it** (S7): a new token from `plex-login`
@@ -607,2 +643,4 @@ password, which are S3c's (and listed again below).
     which Mediaplane can't tell by comparing secrets.
+  - **Done in S10b:** you say so, with `--rotate plex.token`: each arr's connection is
+    given the new token, unchecked, but for one Plex refuses (another account's).
 - **Plex's libraries are known by name** (S7), as Jellyfin's are: one renamed by hand
@@ -628,2 +666,7 @@ password, which are S3c's (and listed again below).
     plex.tv. A rebuilt host's Plex is checked again by S7's setup (S10a).
+  - **Done in S10b,** probed with a real claim: Plex's sign-out unclaims it at once,
+    leaving `PlexOnlineToken=""`, which its image takes for a claim, so `PLEX_CLAIM` goes
+    unused. Plex's setup now claims it itself, through its API, to its address; `plan`
+    and drift warn while it runs published (`bootstrap.open-published`). The nightly job
+    signs it out and checks it is claimed again.
 - **Every setup gets every stored key** (S7): `BootstrapContext.keys` holds each app's,
@@ -646,2 +689,4 @@ password, which are S3c's (and listed again below).
   - **Moved to S10b,** with signing Seerr in again.
+  - **Done in S10b:** the fake answers a session as its own user, whose `plexId` and
+    `jellyfinUsername` are that user's.
 
@@ -754,2 +799,5 @@ password, which are S3c's (and listed again below).
     **Moved to S10b:** it changes what the stack holds, not what Mediaplane recovers.
+  - **Done in S10b:** `apply` removes each, while its app holds it as Mediaplane made it,
+    and nothing of yours is in it; drift says why it leaves one. The end-to-end test takes
+    Radarr and the solver out of a running stack.
 - **Settings Mediaplane manages in Prowlarr are put back.** A link's addresses, sync
@@ -846,2 +894,5 @@ password, which are S3c's (and listed again below).
   - **Moved to S10b,** with the other rotations of what Seerr holds.
+  - **Done in S10b:** the first time Mediaplane records the link, it gives Seerr its own
+    Jellyfin key, and has Jellyfin remove the one Seerr held, when Jellyfin lists it as
+    Seerr's (`adoptSets`, the record's `given`): one key to rotate.
 - **A Seerr whose `settings.json` Mediaplane can't read** is set up again, unpublished,
@@ -855,2 +906,4 @@ password, which are S3c's (and listed again below).
     lacks the key.
+  - **Done in S10b:** a Seerr Mediaplane set up is asked itself whether its setup is
+    open (`Bootstrap.open`), and set up again only if it says so, or can't be asked.
 - **Seerr's libraries are enabled by name, from Seerr's last sync** (S6). A library made
@@ -882,2 +935,4 @@ password, which are S3c's (and listed again below).
   - **S10's are S10b's** (split on 2026-10-26): S10a settles none of the items below.
+  - **S10b's are S10c's** (split again on 2026-10-26), but for Jellyfin's database read,
+    done in S10b, as its item says.
 - **Decided by the owner on 2026-10-17:**
@@ -1003,3 +1058,3 @@ password, which are S3c's (and listed again below).
     GHCR's and lscr.io's pulls stay anonymous, and apply's own pull retries stay.
-- **Which Compose versions work out a service differently (open, for S10b).** Updating
+- **Which Compose versions work out a service differently (open, for S10c).** Updating
   Mediaplane never touches the stack, but a later `apply` runs the image's own Docker
@@ -1010,3 +1065,3 @@ password, which are S3c's (and listed again below).
   and say so in Renovate's pull request for a Compose bump.
-- **From S9's reviews, for S10b.** None hides a fault in S9's releases:
+- **From S9's reviews, for S10c.** None hides a fault in S9's releases:
   - a test that Renovate can read the tag of each image pinned outside the catalog
@@ -1024,3 +1079,3 @@ password, which are S3c's (and listed again below).
     the stack's user and group (1000), replayed on both Composes.
-- **From S10a's reviews, for S10b:**
+- **From S10a's reviews:**
   - read Jellyfin's database in a process of its own, with a deadline, so that a pipe
@@ -1029,6 +1084,16 @@ password, which are S3c's (and listed again below).
     design;
+    - **Done in S10b:** Node itself, with a fixed program, no shell, an empty
+      environment and the database handed to it open, killed after 10 seconds. Probed: a
+      pipe at the database's name hangs SQLite's open; one at the `-wal` makes it refuse
+      the read;
   - the pinned `--json` contract says what `history <id> --json` prints of a later
     release's record. Until then it prints `mediaplane.change/v1`'s fields only, and
-    the fields it doesn't know stay in the file.
-- **Before the first real migration** of `stack.yaml` (none is planned, S10a and S10b
+    the fields it doesn't know stay in the file. **For S10c.**
+- **CI's end-to-end image pulls are flaky (for S10c, with the test gaps).** On
+  2026-10-26, `apply.pull-failed` (four tries, a temporary registry error) failed the
+  end-to-end job twice, on amd64 and arm64, and a rerun passed each time. Make the
+  end-to-end tests robust against it, without weakening what `apply` itself reports:
+  pull the catalog's pinned images in the job first, with retries and a backoff, or give
+  the harness a longer retry budget than apply's.
+- **Before the first real migration** of `stack.yaml` (none is planned, S10a to S10c
   included; spec §11, Slice 9): make the commands that only read `stack.yaml`
````

- [ ] **Step 6: See the docs promise nothing this slice built**

Run: `test "$(grep -rlE '\*\*Slice 10b:\*\* a way|\*\*Next:\*\* S10b|A link stays when its arr leaves|indexer proxy stays when the stack drops|Next:\*\* driving Mediaplane from automation' README.md catalog docs/runbooks docs/architecture.md docs/security docs/adr docs/plans/m1-roadmap.md | wc -l)" -eq 0`
Expected: it exits 0. Every `text` diagram is 40 columns at most, and none is Mermaid.

- [ ] **Step 7: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: removal, the Plex token's rotation and claim, Seerr's key, and keep with external stacks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


## Slice 10b completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 97.84% statements, 92.97% branches, 97.69% functions and 98.99% lines, with 2578 tests in 113 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too, and leaves no
  `mediaplane-e2e-*` container, network, volume or image, and no `mediaplane-e2e-*`
  folder. When this plan was replayed, alone on the dev box, warm, with a plex.tv test
  account's token (so the nightly test ran too, and removed the servers it claimed):
  - with Compose 5.5.1, 31 tests passed in 14 files, in 21 min 24 s (the removal test alone took about a minute and a half);
  - with Compose 2.38.2, 31 passed in 14 files, in 22 min 11 s. A first run there failed one test on a temporary registry error as images were pulled (`apply.pull-failed`, the flakiness S10c takes on), and passed on the rerun.

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] An app is taken out of a running stack by a script (`test/e2e/remove.e2e.test.ts`):
  its container and what it had in the other apps are gone, a category holding a torrent
  stays until the torrent moves, its `appdata/` remains, and a last `apply` changes
  nothing. It passes on both Composes.
- [ ] The nightly Plex test rotates the token and claims a signed-out Plex again: run it
  with the test account's token (Task 7, Step 5), or see the nightly job pass on `main`
  once this slice merges.
- [ ] The socket proxy's allow-list is unchanged:
  `git diff 7b2a169 -- deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints
  nothing (decision 12). `7b2a169` is `main` before this slice.
- [ ] No committed file contains a real path, user name, host name, address or token:
  `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing but the
  project's own names (its GitHub repo and schema URL, its GHCR image, the workflows'
  repository guards, the release notes' install commands) and the tests' fake
  `/srv/data/home` paths.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B 7b2a169.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse: 1 (the
    split), 3 (a category with torrents stays), 6 (Keep mine with `managed_by:
    external`), 7 (the database read in a process of its own), 8 (Seerr's own Jellyfin
    key replaced), 10 (`--rotate plex.token`) and 11 (a signed-out Plex claimed through
    its API, beside §6.1's `PLEX_CLAIM`);
  - that S10c's plan comes next, from the roadmap's S10c list.

There are no owner's steps in this slice. The nightly job's `PLEX_TOKEN` is S7's.
